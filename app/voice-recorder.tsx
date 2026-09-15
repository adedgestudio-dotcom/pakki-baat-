"use client";
import { useState, useRef, useEffect } from "react";

interface VoiceRecorderProps {
  onRecordingComplete: (audioBlob: Blob, duration: number) => void;
  onError: (error: string) => void;
}

export default function VoiceRecorder({
  onRecordingComplete,
  onError,
}: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.ondataavailable = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      chunksRef.current = [];
    };
  }, []);

  const startRecording = async () => {
    try {
      // Check browser support
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Voice recording is not supported in your browser. Please use Chrome, Firefox, or Safari."
        );
      }

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      });

      streamRef.current = stream;

      // Create MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "audio/wav";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        onRecordingComplete(blob, duration);
        cleanup();
      };

      // Start recording
      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);
      setDuration(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setDuration((prev) => {
          if (prev >= 300) {
            // 5 minutes max
            stopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      console.error("Recording error:", err);
      if (err instanceof Error) {
        if (err.name === "NotAllowedError") {
          onError(
            "Microphone access denied. Please allow microphone access in your browser settings."
          );
        } else if (err.name === "NotFoundError") {
          onError("No microphone found. Please connect a microphone.");
        } else {
          onError(err.message || "Failed to start recording");
        }
      }
      cleanup();
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      if (isPaused) {
        mediaRecorderRef.current.resume();
        timerRef.current = setInterval(() => {
          setDuration((prev) => {
            if (prev >= 300) {
              stopRecording();
              return prev;
            }
            return prev + 1;
          });
        }, 1000);
      } else {
        mediaRecorderRef.current.pause();
        if (timerRef.current) clearInterval(timerRef.current);
      }
      setIsPaused(!isPaused);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      if (timerRef.current) clearInterval(timerRef.current);
    } else {
      cleanup();
    }
  };

  const cancelRecording = () => {
    cleanup();
    setIsRecording(false);
    setIsPaused(false);
    setDuration(0);
  };

  const cleanup = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (!isRecording) {
    return (
      <button
        className="voice-record-button"
        onClick={startRecording}
        aria-label="Start voice recording"
        title="Start voice recording"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z M5 11a7 7 0 0 0 14 0 M12 18v3 M9 21h6" />
        </svg>
      </button>
    );
  }

  return (
    <div className="voice-recording-panel">
      <div className="recording-indicator">
        <div className="pulse-dot" />
        <span className="recording-text">Recording...</span>
      </div>

      <div className="recording-duration">{formatDuration(duration)}</div>

      <div className="recording-waveform">
        <div className="wave-bar" />
        <div className="wave-bar" />
        <div className="wave-bar" />
        <div className="wave-bar" />
        <div className="wave-bar" />
      </div>

      <div className="recording-controls">
        <button
          className="recording-control-button cancel"
          onClick={cancelRecording}
          aria-label="Cancel recording"
        >
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
            <path d="m6 6 12 12 M6 18 18 6" />
          </svg>
        </button>

        <button
          className="recording-control-button pause"
          onClick={pauseRecording}
          aria-label={isPaused ? "Resume recording" : "Pause recording"}
        >
          {isPaused ? (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          )}
        </button>

        <button
          className="recording-control-button stop"
          onClick={stopRecording}
          aria-label="Stop recording"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      </div>

      <div className="recording-hint">
        {isPaused ? "Recording paused" : "Tap stop when finished"}
      </div>
    </div>
  );
}
