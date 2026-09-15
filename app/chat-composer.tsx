"use client";

import AiCapture from "./ai-capture";
import type { Job } from "@/lib/data";

type Props = {
  message: string;
  onMessageChange: (message: string) => void;
  onCapture: () => void;
  onToast: (message: string) => void;
  onDraft: (job: Job) => void;
  onSendVoice: (file: File, duration: number, transcript: string) => Promise<void>;
  voiceBusy: boolean;
};

export default function ChatComposer({ message, onMessageChange, onCapture, onToast, onDraft, onSendVoice, voiceBusy }: Props) {
  return <div className="composer">
    <div className="chat-compose-row">
      <AiCapture compact message={message} onMessageChange={onMessageChange} onDraft={onDraft} onSendVoice={onSendVoice} externalBusy={voiceBusy}/>
      <textarea
        aria-label="Message the assistant"
        placeholder="Message Pakki Baat…"
        value={message}
        onChange={(event) => onMessageChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!voiceBusy) onCapture(); } }}
        maxLength={6000}
      />
      <button type="button" className="chat-send" aria-label="Send message" title="Send message" disabled={!message.trim() || voiceBusy} onClick={onCapture}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>
      </button>
    </div>
    <div className="composer-actions">
      <span>{message.length}/6000 · Send a message to continue</span>
    </div>
    <button className="paste-note" onClick={async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) return onToast("Clipboard is empty.");
        onMessageChange(text.slice(0, 6000));
      } catch { onToast("Please paste into the message box."); }
    }}>Paste a copied message</button>
    <p className="composer-hint">Record a voice note or type a message. Review everything before saving.</p>
  </div>;
}
