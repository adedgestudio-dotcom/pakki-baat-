"use client";
import { useState } from "react";

interface SimpleVoiceButtonProps {
  onRecordingComplete: (audioBlob: Blob, duration: number) => void;
  onError: (error: string) => void;
}

export default function SimpleVoiceButton({
  onRecordingComplete,
  onError,
}: SimpleVoiceButtonProps) {
  const [isRecording, setIsRecording] = useState(false);

  const handleClick = async () => {
    if (isRecording) {
      // Stop recording
      setIsRecording(false);
      onRecordingComplete(new Blob(), 5);
      return;
    }

    // Start recording
    try {
      console.log("🎤 Requesting microphone...");
      
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone not supported");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("✅ Got microphone access");
      
      setIsRecording(true);
      
      // Stop tracks after test
      setTimeout(() => {
        stream.getTracks().forEach(track => track.stop());
        setIsRecording(false);
        console.log("✅ Recording test complete");
        onRecordingComplete(new Blob(), 3);
      }, 3000);
      
    } catch (err) {
      console.error("❌ Error:", err);
      onError(err instanceof Error ? err.message : "Failed to access microphone");
    }
  };

  return (
    <button
      type="button"
      className="whatsapp-mic-button"
      onClick={handleClick}
      aria-label={isRecording ? "Recording..." : "Record voice note"}
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
