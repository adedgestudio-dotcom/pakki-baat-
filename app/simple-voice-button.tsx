"use client";
import { useEffect, useRef, useState } from "react";

type SpeechRecognitionResultLike = {
  0?: { transcript?: string };
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SimpleVoiceButtonProps {
  onRecordingComplete: (audioBlob: Blob, duration: number, transcript?: string) => void;
  onError: (error: string) => void;
}

export default function SimpleVoiceButton({
  onRecordingComplete,
  onError,
}: SimpleVoiceButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const totalPausedMsRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const liveTranscriptRef = useRef("");

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
    };
  }, []);

  function pickMimeType() {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];

    return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    recognitionRef.current?.stop();
    recorder.stop();
  }

  function togglePause() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    if (recorder.state === "recording") {
      recorder.pause();
      recognitionRef.current?.stop();
      pausedAtRef.current = Date.now();
      setIsPaused(true);
      return;
    }

    if (recorder.state === "paused") {
      if (pausedAtRef.current) totalPausedMsRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = 0;
      recorder.resume();
      setIsPaused(false);
    }
  }

  async function startRecording() {
    try {
      if (!window.isSecureContext) {
        throw new Error("Voice needs a secure HTTPS page on phone. Open the Vercel app instead of the local 192.168… address.");
      }
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Voice recording is not supported in this browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      liveTranscriptRef.current = "";
      const speechWindow = window as typeof window & {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      };
      const Recognition =
        speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
      if (Recognition) {
        try {
          const recognition = new Recognition();
          recognition.lang = navigator.language || "en-IN";
          recognition.interimResults = true;
          recognition.continuous = true;
          recognition.onresult = (event) => {
            let transcript = "";
            for (let index = 0; index < event.results.length; index += 1) {
              transcript += event.results[index]?.[0]?.transcript || "";
            }
            liveTranscriptRef.current = transcript.trim();
          };
          recognition.onerror = () => {
            // Audio recording still continues; Groq transcription is the fallback.
          };
          recognition.onend = () => {
            recognitionRef.current = null;
          };
          recognitionRef.current = recognition;
          recognition.start();
        } catch {
          recognitionRef.current = null;
        }
      }

      const mimeType = pickMimeType();
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = mediaRecorder;
      startedAtRef.current = Date.now();
      pausedAtRef.current = 0;
      totalPausedMsRef.current = 0;
      setDuration(0);
      setIsPaused(false);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }

        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);
        setIsPaused(false);

        const finalPausedMs = totalPausedMsRef.current + (pausedAtRef.current ? Date.now() - pausedAtRef.current : 0);
        const recordedSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current - finalPausedMs) / 1000));
        const type = mediaRecorder.mimeType || "audio/webm";
        const audioBlob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];

        if (!audioBlob.size) {
          onError("I could not capture audio. Please try recording again.");
          return;
        }

        // Give mobile speech recognition a brief moment to deliver its final words.
        window.setTimeout(() => {
          onRecordingComplete(
            audioBlob,
            recordedSeconds,
            liveTranscriptRef.current.trim()
          );
        }, 220);
      };

      mediaRecorder.onerror = () => {
        onError("Recording failed. Please try again.");
        stopRecording();
      };

      mediaRecorder.start();
      setIsRecording(true);
      timerRef.current = window.setInterval(() => {
        if (!pausedAtRef.current) setDuration(Math.round((Date.now() - startedAtRef.current - totalPausedMsRef.current) / 1000));
      }, 250);
    } catch (err) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setIsRecording(false);
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        onError("Microphone permission is blocked. Allow microphone access for Pakki Baat in your browser settings, then try again.");
        return;
      }
      onError(err instanceof Error ? err.message : "Failed to access microphone");
    }
  }

  const handleClick = async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    await startRecording();
  };

  const formattedDuration = `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`;

  return (
    <>
      {isRecording && (
        <div className={isPaused ? "voice-recording-pill is-paused" : "voice-recording-pill"} role="status" aria-live="polite">
          <span className="recording-live-dot" />
          <span className="recording-strip-time">{formattedDuration}</span>
          <span className="recording-wave-line" aria-hidden="true">
            {Array.from({ length: 12 }).map((_, index) => (
              <span key={index} style={{ animationDelay: `${index * 0.06}s` }} />
            ))}
          </span>
          <button
            type="button"
            className="voice-pause-button"
            onClick={togglePause}
            aria-label={isPaused ? "Resume recording" : "Pause recording"}
            title={isPaused ? "Resume recording" : "Pause recording"}
          >
            {isPaused ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            )}
          </button>
        </div>
      )}
      <button
        type="button"
        className={isRecording ? "whatsapp-mic-button recording" : "whatsapp-mic-button"}
        onClick={handleClick}
        aria-label={isRecording ? "Stop recording" : "Record voice note"}
        title={isRecording ? `Stop recording (${duration}s)` : "Record voice note"}
      >
        {isRecording ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z M5 11a7 7 0 0 0 14 0 M12 18v3 M9 21h6" />
          </svg>
        )}
      </button>
    </>
  );
}
