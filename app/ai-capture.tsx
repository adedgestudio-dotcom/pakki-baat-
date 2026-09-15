"use client";

import { useEffect, useRef, useState } from "react";
import { cloudToken } from "@/lib/cloud";
import type { Job } from "@/lib/data";

type Props = { message: string; onMessageChange: (message: string) => void; onDraft: (job: Job) => void; onSendVoice: (file: File, duration: number, transcript: string) => Promise<void>; compact?: boolean; externalBusy?: boolean };

export default function AiCapture({ message, onMessageChange, onDraft, onSendVoice, compact = false, externalBusy = false }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [voiceNote, setVoiceNote] = useState<File | null>(null);
  const [voiceUrl, setVoiceUrl] = useState("");
  const [voiceTranscribed, setVoiceTranscribed] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clockTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const urlRef = useRef("");
  const alive = useRef(true);
  const cancelled = useRef(false);
  const starting = useRef(false);

  useEffect(() => {
    alive.current = true;
    fetch("/api/extract").then((r) => r.json()).then((data) => {
      if (alive.current) setEnabled(Boolean(data.enabled));
    }).catch(() => {});
    return () => {
      alive.current = false;
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (clockTimer.current) clearInterval(clockTimer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  function clearVoice() {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = "";
    setVoiceUrl("");
    setVoiceNote(null);
    setVoiceTranscribed(false);
    setSeconds(0);
  }

  async function extract(file?: File, mode: "extract" | "transcribe" = "extract") {
    setBusy(true);
    setError("");
    try {
      const token = await cloudToken();
      const form = new FormData();
      form.set("text", message);
      form.set("today", new Date().toLocaleDateString("en-CA"));
      if (file) form.set("file", file);
      form.set("mode", mode);
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not read the note.");
      if (mode === "transcribe") {
        const transcript = String(result.text || "").trim();
        if (!transcript) throw new Error("No speech was detected. Try recording again.");
        onMessageChange([message.trim(), transcript].filter(Boolean).join("\n").slice(0, 6000));
        setVoiceTranscribed(true);
        return;
      }
      const draft = result.draft;
      if (file) clearVoice();
      onDraft({
        id: "",
        customer: String(draft.customer || "").slice(0, 100),
        work: String(draft.work || "").slice(0, 500),
        total: Math.max(0, Number(draft.total) || 0),
        paid: Math.max(0, Number(draft.paid) || 0),
        date: /^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? draft.date : "",
        time: /^\d{2}:\d{2}$/.test(draft.time) ? draft.time : "",
        status: "Waiting",
        source: String(draft.source || message).slice(0, 12000),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the note.");
    } finally {
      setBusy(false);
    }
  }

  function stopRecording() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  function cancelRecording() {
    cancelled.current = true;
    stopRecording();
  }

  async function startRecording() {
    if (starting.current || recording || externalBusy) return;
    starting.current = true;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("This browser cannot record audio. Try Chrome or Edge on a secure connection.");
      starting.current = false;
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      const mediaRecorder = new MediaRecorder(media, { audioBitsPerSecond: 32_000 });
      cancelled.current = false;
      recorder.current = mediaRecorder;
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      mediaRecorder.onerror = () => {
        cancelled.current = true;
        setError("Recording stopped unexpectedly. Please try again.");
        stopRecording();
      };
      mediaRecorder.onstop = () => {
        if (stopTimer.current) clearTimeout(stopTimer.current);
        if (clockTimer.current) clearInterval(clockTimer.current);
        media.getTracks().forEach((track) => track.stop());
        if (!alive.current) return;
        setRecording(false);
        if (cancelled.current) return;
        if (!chunks.length) {
          setError("No audio was captured. Please try again.");
          return;
        }
        const mime = mediaRecorder.mimeType.split(";")[0] || "audio/webm";
        const extension = mime.includes("mp4") ? "m4a" : "webm";
        const file = new File(chunks, `pakki-baat-voice-note.${extension}`, { type: mime });
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(file);
        setVoiceUrl(urlRef.current);
        setVoiceTranscribed(false);
        setVoiceNote(file);
      };
      mediaRecorder.start();
      setSeconds(0);
      setRecording(true);
      clockTimer.current = setInterval(() => setSeconds((value) => value + 1), 1000);
      stopTimer.current = setTimeout(stopRecording, 60_000);
    } catch (cause) {
      stream.current?.getTracks().forEach((track) => track.stop());
      setError(cause instanceof Error && cause.name === "NotAllowedError"
        ? "Microphone access was denied. Allow it in your browser settings and try again."
        : "Could not start the microphone. Please try again.");
    } finally {
      starting.current = false;
    }
  }

  async function sendVoice() {
    if (!voiceNote || busy || externalBusy) return;
    setBusy(true);
    setError("");
    try {
      await onSendVoice(voiceNote, seconds, voiceTranscribed ? message.trim() : "");
      clearVoice();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the voice note.");
    } finally {
      setBusy(false);
    }
  }

  function downloadVoice() {
    if (!voiceUrl || !voiceNote) return;
    const link = document.createElement("a");
    link.href = voiceUrl;
    link.download = voiceNote.name;
    link.click();
  }

  const mic = <button
    type="button"
    className={recording ? "chat-mic recording" : "chat-mic"}
    aria-label={recording ? "Stop recording" : "Record voice note"}
    title={recording ? "Stop recording" : "Record voice note"}
    disabled={busy || externalBusy}
    onClick={recording ? stopRecording : startRecording}
  ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z M5 11a7 7 0 0 0 14 0 M12 18v3 M9 21h6"/></svg></button>;

  return <div className={compact ? "compact-capture" : "ai-capture"}>
    <div className={compact ? "capture-inline" : "capture-tools"}>
      <label className={compact ? "chat-attach" : "upload"} aria-label="Attach screenshot or voice note" title="Attach screenshot or voice note">
        {compact ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 1 1-2.8-2.8l8.5-8.5"/></svg> : "Screenshot / voice note"}
        <input type="file" disabled={!enabled || busy || recording || externalBusy} accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg" onChange={(event) => { const file = event.target.files?.[0]; if (file) void extract(file); event.target.value = ""; }}/>
      </label>
      {mic}
      {!compact && enabled && <button className="outline" disabled={busy || !message.trim() || recording} onClick={() => void extract()}>{busy ? "Reading details…" : "Read text with AI"}</button>}
    </div>
    {recording && <div className="voice-status" role="status"><span className="voice-dot"/>Recording {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · Tap mic to stop <button type="button" onClick={cancelRecording}>Cancel</button></div>}
    {voiceNote && voiceUrl && !recording && <div className="voice-preview">
      <div className="voice-preview-title">Voice note ready <span>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span></div>
      <button type="button" className="voice-send-primary" disabled={busy || externalBusy} onClick={() => void sendVoice()}>{busy ? "Sending voice…" : "Send voice in chat →"}</button>
      <audio controls src={voiceUrl} aria-label="Play recorded voice note"/>
      {voiceTranscribed && <small>Transcript ready in the message box. Review it, then send this voice note.</small>}
      <div className="voice-actions"><button type="button" onClick={downloadVoice}>Download</button><button type="button" onClick={clearVoice}>Discard</button>{enabled && <button type="button" disabled={busy || externalBusy || voiceNote.size > 2_000_000} onClick={() => void extract(voiceNote, "transcribe")}>{busy ? "Transcribing…" : "Transcribe with OpenAI"}</button>}{enabled && <button type="button" disabled={busy || externalBusy || voiceNote.size > 2_000_000} onClick={() => void extract(voiceNote)}>{busy ? "Reading…" : "Read details with AI"}</button>}</div>
      <small>{enabled ? "Send voice posts your recording in this chat and sends it to OpenAI for transcription. The audio stays on this device for playback." : "Send voice posts your recording in this chat. AI transcription needs server setup before it can read what you said."}</small>
    </div>}
    {error && <p className="voice-error" role="alert">{error}</p>}
  </div>;
}
