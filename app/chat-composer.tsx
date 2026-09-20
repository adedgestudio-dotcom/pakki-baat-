"use client";
import { useEffect, useState } from "react";
import SimpleVoiceButton from "./simple-voice-button";
import AudioPlayer from "./audio-player";
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
  const [showInputOptions, setShowInputOptions] = useState(false);
  const [processingMessageIndex, setProcessingMessageIndex] = useState(0);
  const [voiceDraft, setVoiceDraft] = useState<{
    file: File;
    url: string;
    duration: number;
  } | null>(null);

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

  const handleVoiceRecordingComplete = (audioBlob: Blob, duration: number) => {
    if (voiceDraft?.url) URL.revokeObjectURL(voiceDraft.url);

    const extension = audioBlob.type.includes("mp4")
      ? "m4a"
      : audioBlob.type.includes("ogg")
        ? "ogg"
        : "webm";
    const file = new File([audioBlob], `pakki-baat-voice-note.${extension}`, {
      type: audioBlob.type,
    });

    setVoiceDraft({ file, url: URL.createObjectURL(file), duration });
    onToast("Voice note ready. Tap send when you are ready.");
  };

  const sendVoiceDraft = () => {
    if (!voiceDraft || voiceBusy) return;

    const draft = voiceDraft;
    onSendVoice(draft.file, draft.duration, message.trim())
      .then(() => {
        URL.revokeObjectURL(draft.url);
        setVoiceDraft(null);
        onMessageChange("");
      })
      .catch((err) => {
        onToast(
          err instanceof Error ? err.message : "Failed to process voice recording"
        );
      });
  };

  const discardVoiceDraft = () => {
    if (!voiceDraft) return;
    URL.revokeObjectURL(voiceDraft.url);
    setVoiceDraft(null);
  };

  const handleSend = () => {
    if (voiceDraft) {
      sendVoiceDraft();
      return;
    }

    onCapture();
  };

  const formatDuration = (seconds: number) => {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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
      aria-label={voiceDraft ? "Send voice note" : "Organise details"}
      title={voiceDraft ? "Send voice note" : "Organise details"}
      onClick={handleSend}
      disabled={voiceBusy || (!message.trim() && !voiceDraft)}
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

            <div className="chat-compose-row">
              <div className="desktop-input-actions">{uploadControl}</div>

              <div className="input-with-mic">
                <textarea
                  id="paste-input"
                  aria-label="Customer message"
                  placeholder={voiceDraft ? "Add a note before sending voice..." : "Tell me what happened… e.g. 2 kg cake, ₹2,000 total, ₹1,000 received"}
                  value={message}
                  onChange={(e) => onMessageChange(e.target.value)}
                  maxLength={6000}
                />

                <div className="input-mic-button">
                  {message.trim() || voiceDraft ? (
                    sendControl
                  ) : (
                    <SimpleVoiceButton
                      onRecordingComplete={handleVoiceRecordingComplete}
                      onError={handleVoiceError}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="smart-input-footer">
              <span>Pakki Baat will organise the details for you.</span>
              <span>{message.length}/6000</span>
            </div>
          </>
        )}
      </div>

      {voiceDraft && (
        <div className="voice-draft-card">
          <div>
            <strong>Voice note ready</strong>
            <small>Recorded {formatDuration(voiceDraft.duration)}</small>
          </div>
          <AudioPlayer
            audioBlob={voiceDraft.file}
            audioUrl={voiceDraft.url}
            duration={voiceDraft.duration}
          />
          <div className="voice-draft-actions">
            <button type="button" className="outline" onClick={discardVoiceDraft} disabled={voiceBusy}>
              Delete
            </button>
            <button type="button" className="primary" onClick={sendVoiceDraft} disabled={voiceBusy}>
              {voiceBusy ? "Sending..." : "Send voice"}
            </button>
          </div>
        </div>
      )}

      
    </div>
  );
}
