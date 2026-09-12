"use client";
import { useState } from "react";
import VoiceRecorder from "./voice-recorder";

interface ChatComposerProps {
  message: string;
  onMessageChange: (message: string) => void;
  onCapture: () => void;
  onToast: (message: string) => void;
}

function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const p: Record<string, string> = {
    chat: "M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 1 1 19 0Z M7 9h9 M7 13h6",
    arrow: "M5 12h14 m-6-6 6 6-6 6",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={p[name] || p.chat} />
    </svg>
  );
}

export default function ChatComposer({
  message,
  onMessageChange,
  onCapture,
  onToast,
}: ChatComposerProps) {
  const [showInputOptions, setShowInputOptions] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      onToast(`Processing ${f.name}...`);
      e.target.value = "";
    }
  };

  const handleVoiceRecordingComplete = (audioBlob: Blob, duration: number) => {
    setShowVoiceRecorder(false);
    onToast(
      `Voice recording captured (${duration}s). AI transcription coming soon!`
    );
    // In production, you would send this to your AI API for transcription
    console.log("Audio blob:", audioBlob, "Duration:", duration);
  };

  const handleVoiceError = (error: string) => {
    setShowVoiceRecorder(false);
    onToast(error);
  };

  return (
    <div className="composer">
      {/* Mobile: Pin icon with popup menu */}
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

      {/* Mobile: Options popup menu */}
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
              const input = document.getElementById(
                "paste-message-input"
              ) as HTMLInputElement;
              if (input) {
                input.click();
              }
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
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
              <path d="M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2 2 2 0 0 0-2-2H11a2 2 0 0 0-2 2Z" />
            </svg>
            Paste message
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
              setShowVoiceRecorder(true);
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
        {/* Desktop: Inline icons */}
        <div className="desktop-input-actions">
          <button
            className="icon-button desktop-only"
            aria-label="Attach file or screenshot"
            title="Attach file or screenshot"
            onClick={() => document.getElementById("file-upload")?.click()}
          >
            <svg
              width="21"
              height="21"
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
          <input
            type="file"
            id="file-upload"
            accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/mp4,audio/wav,audio/webm"
            style={{ display: "none" }}
            onChange={handleFileUpload}
          />
          <input
            type="file"
            id="screenshot-upload"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={handleFileUpload}
          />
          <input
            type="file"
            id="paste-message-input"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                const reader = new FileReader();
                reader.onload = (event) => {
                  const text = event.target?.result as string;
                  onMessageChange(text);
                  onToast("Message pasted from file");
                };
                reader.readAsText(f);
                e.target.value = "";
              }
            }}
          />
          <button
            className="icon-button desktop-only"
            aria-label="Record voice note"
            title="Record voice note"
            onClick={() => setShowVoiceRecorder(true)}
          >
            <svg
              width="21"
              height="21"
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
        </div>

        <textarea
          id="paste-input"
          aria-label="Customer message"
          placeholder="Paste a message or tell me what's needed…"
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          maxLength={6000}
        />

        <button
          type="button"
          className="chat-send"
          aria-label="Check details"
          title="Check details"
          onClick={onCapture}
          disabled={!message.trim()}
        >
          <Icon name="arrow" size={19} />
        </button>
      </div>

      <div className="composer-actions">
        <span>{message.length}/6000 · Review before saving</span>
        <button
          className="primary"
          onClick={onCapture}
          disabled={!message.trim()}
        >
          Check details <Icon name="arrow" size={18} />
        </button>
      </div>

      <div className="ai-note">
        Voice notes and attachments need AI setup; manual text capture works
        now.
      </div>

      {/* Voice Recorder Modal */}
      {showVoiceRecorder && (
        <VoiceRecorder
          onRecordingComplete={handleVoiceRecordingComplete}
          onError={handleVoiceError}
        />
      )}
    </div>
  );
}
