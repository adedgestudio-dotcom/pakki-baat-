"use client";
import { useState } from "react";
import SimpleVoiceButton from "./simple-voice-button";
import type { Job } from "@/lib/data";

type Props = {
  message: string;
  onMessageChange: (message: string) => void;
  onCapture: () => void;
  onToast: (message: string) => void;
  onDraft: (job: Job) => void;
  voiceBusy: boolean;
};

export default function ChatComposer({
  message,
  onMessageChange,
  onCapture,
  onToast,
  voiceBusy,
}: Props) {
  const [showInputOptions, setShowInputOptions] = useState(false);
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      onToast(`Processing ${f.name}...`);
      e.target.value = "";
    }
  };

  const handleVoiceError = (error: string) => {
    onToast(
      error.includes("Permission denied")
        ? "Please allow microphone access in your browser, then try again."
        : error
    );
  };

  const handleSend = () => {\n    if (!message.trim() || voiceBusy) return;\n    onCapture();\n  };\n\n  const uploadControl = (
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
      aria-label={"Send message"}
      title={"Send message"}
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
      <div className="input-options-toggle mobile-only">
        <button
          className="icon-button-pin"
          aria-label="More input options"
          onClick={() => setShowInputOptions(!showInputOptions)}
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
            <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 1 1-2.8-2.8l8.5-8.5" />
          </svg>
        </button>
      </div>

      {showInputOptions && (
        <div className="input-options-menu mobile-only">
          <button
            onClick={() => {
              document.getElementById("paste-input")?.focus();
              setShowInputOptions(false);
            }}
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
              <path d="M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Type message
          </button>
          <button
            onClick={() => {
              document.getElementById("screenshot-upload")?.click();
              setShowInputOptions(false);
            }}
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
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-5-5L5 21" />
            </svg>
            Screenshot
          </button>
          <button
            onClick={() => {
              setShowInputOptions(false);
              onToast("Tap the microphone, speak, then tap it again to stop.");
            }}
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
            Voice note
          </button>
        </div>
      )}

      <div className="chat-compose-row">
        <div className="desktop-input-actions">{uploadControl}</div>

        <div className="input-with-mic">
          <textarea
            id="paste-input"
            aria-label="Customer message"
            placeholder="Type or speak what happened…"
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            maxLength={6000}
            disabled={voiceBusy}
          />

          <div className="input-mic-button">
            {message.trim() ? sendControl : <SimpleVoiceButton onTranscript={onMessageChange} onError={handleVoiceError} />}
          </div>
        </div>
      </div>

      <div className="composer-actions">
        <span className="char-counter">
          {message.length}/6000 · You can edit before sending
        </span>
        {message.trim() && (
          <button
            className="primary check-details-button"
            onClick={handleSend}
            disabled={voiceBusy}
          >
            Send{" "}
            <svg
              width="18"
              height="18"
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
        )}
      </div>

      <div className="ai-note">On phone, tap the mic and speak. Your words appear here before you send.</div>
    </div>
  );
}
