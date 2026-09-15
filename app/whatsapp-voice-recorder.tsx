"use client";
import { useState, useRef, useEffect } from "react";

interface WhatsAppVoiceRecorderProps {
  onRecordingComplete: (audioBlob: Blob, duration: number) => void;
  onError: (error: string) => void;
}

export default function WhatsAppVoiceRecorder({
  onRecordingComplete,
  onError,
}: WhatsAppVoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [slideDistance, setSlideDistance] = useState(0);
  const [isLocked, setIsLocked] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startXRef = useRef(0);
  const buttonRef = useRef<HTMLButtonElement>(null);

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

  const startRecording = async (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();

    console.log("🎤 Starting recording...");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        const error = "Voice recording is not supported in your browser";
        console.error("❌", error);
        throw new Error(error);
      }

      console.log("📱 Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      });

      console.log("✅ Microphone access granted");
      streamRef.current = stream;

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
        if (chunksRef.current.length > 0 && duration >= 1) {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          onRecordingComplete(blob, duration);
        }
        cleanup();
        setIsRecording(false);
        setIsLocked(false);
        setDuration(0);
        setSlideDistance(0);
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setDuration(0);

      // Get initial touch/mouse position
      if ("touches" in e) {
        startXRef.current = e.touches[0].clientX;
      } else {
        startXRef.current = e.clientX;
      }

      // Start timer
      timerRef.current = setInterval(() => {
        setDuration((prev) => {
          if (prev >= 300) {
            stopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);

      // Add haptic feedback if available
      if ("vibrate" in navigator) {
        navigator.vibrate(50);
      }
    } catch (err) {
      console.error("Recording error:", err);
      if (err instanceof Error) {
        if (err.name === "NotAllowedError") {
          onError("Microphone access denied");
        } else if (err.name === "NotFoundError") {
          onError("No microphone found");
        } else {
          onError(err.message);
        }
      }
      cleanup();
    }
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isRecording || isLocked) return;

    let currentX: number;
    if ("touches" in e) {
      currentX = e.touches[0].clientX;
    } else {
      currentX = e.clientX;
    }

    const distance = startXRef.current - currentX;
    setSlideDistance(Math.max(0, distance));

    // Cancel if slid too far (150px)
    if (distance > 150) {
      cancelRecording();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      chunksRef.current = []; // Clear chunks to prevent saving
    }
    cleanup();
    setIsRecording(false);
    setIsLocked(false);
    setDuration(0);
    setSlideDistance(0);

    if ("vibrate" in navigator) {
      navigator.vibrate([30, 30]);
    }
  };

  const handleRelease = () => {
    if (!isRecording) return;

    if (duration < 1) {
      // Too short, cancel
      cancelRecording();
      onError("Recording too short. Hold for at least 1 second.");
      return;
    }

    stopRecording();
  };

  const toggleLock = () => {
    setIsLocked(!isLocked);
    if ("vibrate" in navigator) {
      navigator.vibrate(50);
    }
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
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const cancelOpacity = Math.min(slideDistance / 150, 1);

  return (
    <>
      {/* Recording indicator overlay */}
      {isRecording && (
        <div className="whatsapp-recording-overlay">
          {/* Slide to cancel hint */}
          <div
            className="slide-to-cancel-hint"
            style={{ opacity: 1 - cancelOpacity }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5 M12 19l-7-7 7-7" />
            </svg>
            <span>Slide to cancel</span>
          </div>

          {/* Recording time */}
          <div className="recording-time-display">
            <div className="recording-pulse-dot" />
            <span>{formatDuration(duration)}</span>
          </div>

          {/* Lock button */}
          {!isLocked && (
            <button
              className="whatsapp-lock-button"
              onClick={toggleLock}
              aria-label="Lock recording"
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
                <rect x="5" y="11" width="14" height="10" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </button>
          )}

          {/* Cancel indicator */}
          <div
            className="cancel-indicator"
            style={{
              opacity: cancelOpacity,
              transform: `translateX(-${slideDistance}px)`,
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 6 12 12 M6 18 18 6" />
            </svg>
          </div>
        </div>
      )}

      {/* Locked recording panel */}
      {isRecording && isLocked && (
        <div className="whatsapp-locked-panel">
          <div className="locked-info">
            <div className="recording-pulse-dot" />
            <span className="locked-time">{formatDuration(duration)}</span>
          </div>

          <div className="locked-waveform">
            <div className="locked-wave-bar" />
            <div className="locked-wave-bar" />
            <div className="locked-wave-bar" />
            <div className="locked-wave-bar" />
            <div className="locked-wave-bar" />
          </div>

          <div className="locked-actions">
            <button
              className="locked-delete-button"
              onClick={cancelRecording}
              aria-label="Delete recording"
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
                <path d="M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              </svg>
            </button>
            <button
              className="locked-send-button"
              onClick={stopRecording}
              aria-label="Send recording"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Microphone button */}
      <button
        ref={buttonRef}
        className={`whatsapp-mic-button ${isRecording ? "recording" : ""}`}
        onMouseDown={startRecording}
        onMouseUp={handleRelease}
        onMouseLeave={handleRelease}
        onMouseMove={handleMove}
        onTouchStart={startRecording}
        onTouchEnd={handleRelease}
        onTouchMove={handleMove}
        aria-label={isRecording ? "Release to send" : "Hold to record"}
        style={{
          transform: isRecording
            ? `translateX(-${Math.min(slideDistance, 100)}px)`
            : "none",
        }}
      >
        {isRecording ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
          </svg>
        ) : (
          <svg
            width="24"
            height="24"
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
