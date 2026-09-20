"use client";
import { useEffect, useState } from "react";
import SimpleVoiceButton from "./simple-voice-button";
import type { Job } from "@/lib/data";

const VOICE_PROCESSING_MESSAGES = [
  "Listening closely…",
  "Writing down the useful bits…",
  "Making your hisaab neat ✨",
];

type Props = {
  message: string;
  onMessageChange: (message: string) => void;
  onCapture: () => void;
  onToast: (message: string) => void;
  onDraft: (job: Job) => void;
  onSendVoice: (
    file: File,
    duration: number,
    transcript: string
  ) => Promise<void>;
  voiceBusy: boolean;
};

export default function ChatComposer({
  message,
  onMessageChange,
  onCapture,
  onToast,
  onSendVoice,
  voiceBusy,
}: Props) {
  const [processingMessageIndex, setProcessingMessageIndex] = useState(0);
    useEffect(() => {
    if (!voiceBusy) {
      setProcessingMessageIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setProcessingMessageIndex((current) => (current + 1) % VOICE_PROCESSING_MESSAGES.length);
    }, 1300);
    return () => window.clearInterval(timer);
  }, [voiceBusy]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      onToast(`Processing ${f.name}...`);
      e.target.value = "";
    }
  };

  const handleVoiceRecordingComplete = async (audioBlob: Blob, duration: number) => {
    if (voiceBusy) return;
    const extension = audioBlob.type.includes("mp4")
      ? "m4a"
      : audioBlob.type.includes("ogg")
        ? "ogg"
        : "webm";
    const file = new File([audioBlob], `pakki-baat-voice-note.${extension}`, {
      type: audioBlob.type || "audio/webm",
    });

    onToast("Got it — turning your voice into entry details ✨");
    try {
      await onSendVoice(file, duration, "");
      onMessageChange("");
    } catch (err) {
      onToast(
        err instanceof Error ? err.message : "Could not process the voice note."
      );
    }
  };

  const handleSend = () => {
    onCapture();
  };

  const handleVoiceError = (error: string) => {
    onToast(
      error.includes("Permission denied")
        ? "Please allow microphone access in your browser, then try again."
        : error
    );
  };

  const uploadControl = (
    <label
      className="chat-attach-button"
      aria-label="Attach screenshot or voice note"
      title="Attach screenshot or voice note"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 1 1-2.8-2.8l8.5-8.5" />
      </svg>
      <input
        type="file"
        id="screenshot-upload"
        accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg"
        onChange={handleFileUpload}
      />
    </label>
  );

  const sendControl = (
    <button
      type="button"
      className="send-icon-button"
      aria-label="Organise details"
      title="Organise details"
      onClick={handleSend}
      disabled={voiceBusy || !message.trim()}
    >
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12h14 m-6-6 6 6-6 6" />
      </svg>
    </button>
  );

  return (
    <div className="composer">
      <div className={`smart-input-shell${voiceBusy ? " is-processing" : ""}`}>
        {voiceBusy ? (
          <div className="voice-processing-card" role="status" aria-live="polite">
            <div className="voice-processing-visual" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="voice-processing-copy">
              <span className="voice-processing-kicker">PAKKI BAAT IS ON IT</span>
              <strong key={processingMessageIndex}>{VOICE_PROCESSING_MESSAGES[processingMessageIndex]}</strong>
              <small>Your voice is being turned into clean entry details.</small>
            </div>
            <div className="voice-processing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </div>
        ) : (
          <>
            <div className="smart-input-topline">
              <span className="smart-input-status"><i /> Quick add</span>
              <span>Type or voice</span>
            </div>

            <div className="smart-compose-field">
              <textarea
                id="paste-input"
                aria-label="Customer message"
                placeholder="Tell me what happened… e.g. 2 kg cake, ₹2,000 total, ₹1,000 received"
                value={message}
                onChange={(e) => onMessageChange(e.target.value)}
                maxLength={6000}
              />

              <div className="smart-compose-tool left">{uploadControl}</div>
              <div className="smart-compose-tool right">
                {message.trim() ? (
                  sendControl
                ) : (
                  <SimpleVoiceButton
                    onRecordingComplete={handleVoiceRecordingComplete}
                    onError={handleVoiceError}
                  />
                )}
              </div>
            </div>

            <div className="smart-input-footer">
              <span>Pakki Baat will organise the details for you.</span>
              <span>{message.length}/6000</span>
            </div>
          </>
        )}
      </div>

      
    </div>
  );
}
