"use client";
import { useEffect, useRef, useState } from "react";

interface SimpleVoiceButtonProps {
  onRecordingComplete: (audioBlob: Blob, duration: number) => void;
  onError: (error: string) => void;
}

export default function SimpleVoiceButton({
  onRecordingComplete,
  onError,
}: SimpleVoiceButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
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

    recorder.stop();
  }

  async function startRecording() {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Voice recording is not supported in this browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = mediaRecorder;
      startedAtRef.current = Date.now();
      setDuration(0);

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

        const recordedSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const type = mediaRecorder.mimeType || "audio/webm";
        const audioBlob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];

        if (!audioBlob.size) {
          onError("I could not capture audio. Please try recording again.");
          return;
        }

        onRecordingComplete(audioBlob, recordedSeconds);
      };

      mediaRecorder.onerror = () => {
        onError("Recording failed. Please try again.");
        stopRecording();
      };

      mediaRecorder.start();
      setIsRecording(true);
      timerRef.current = window.setInterval(() => {
        setDuration(Math.round((Date.now() - startedAtRef.current) / 1000));
      }, 250);
    } catch (err) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setIsRecording(false);
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

  return (
    <button
      type="button"
      className={isRecording ? "whatsapp-mic-button recording" : "whatsapp-mic-button"}
      onClick={handleClick}
      aria-label={isRecording ? "Stop recording" : "Record voice note"}
      title={isRecording ? `Stop recording (${duration}s)` : "Record voice note"}
    >
      {isRecording ? (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
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
  );
}
