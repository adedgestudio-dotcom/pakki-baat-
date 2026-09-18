"use client";
import { useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

interface Props {
  onTranscript: (text: string) => void;
  onError: (error: string) => void;
}

export default function SimpleVoiceButton({ onTranscript, onError }: Props) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");

  useEffect(() => () => recognitionRef.current?.abort(), []);

  function recognitionConstructor() {
    if (typeof window === "undefined") return null;
    const w = window as any;
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
  }

  function stop() {
    recognitionRef.current?.stop();
  }

  function start() {
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      onError("Voice typing is not available in this browser. Use your phone keyboard microphone or type the message.");
      return;
    }

    finalRef.current = "";
    const recognition: SpeechRecognitionLike = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-IN";

    recognition.onresult = (event: any) => {
      let finalText = finalRef.current;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = String(event.results[i][0]?.transcript || "");
        if (event.results[i].isFinal) finalText += text + " ";
        else interim += text;
      }
      finalRef.current = finalText;
      onTranscript((finalText + interim).trim());
    };
    recognition.onerror = (event: any) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        onError(event.error === "not-allowed" ? "Please allow microphone access, then try again." : "Voice typing stopped. You can continue by typing.");
      }
      setListening(false);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  return (
    <>
      {listening && (
        <div className="inline-recording-strip voice-typing-strip" role="status">
          <span className="recording-live-dot" />
          <span>Listening… speak naturally</span>
          <span className="recording-strip-hint">Tap stop when done</span>
        </div>
      )}
      <button
        type="button"
        className={listening ? "whatsapp-mic-button recording" : "whatsapp-mic-button"}
        onClick={listening ? stop : start}
        aria-label={listening ? "Stop voice typing" : "Voice type"}
        title={listening ? "Stop voice typing" : "Voice type"}
      >
        {listening ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z M5 11a7 7 0 0 0 14 0 M12 18v3 M9 21h6" />
          </svg>
        )}
      </button>
    </>
  );
}
