"use client";
import { useState, useRef, useEffect } from "react";

interface AudioPlayerProps {
  audioBlob: Blob;
  audioUrl?: string;
  duration: number;
  onDelete?: () => void;
  onTranscribe?: () => void;
  onDownload?: () => void;
}

export default function AudioPlayer({
  audioBlob,
  audioUrl,
  duration,
  onDelete,
  onTranscribe,
  onDownload,
}: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string>("");

  useEffect(() => {
    const url = audioUrl || URL.createObjectURL(audioBlob);
    audioUrlRef.current = url;

    const audio = new Audio(url);
    audioRef.current = audio;

    audio.addEventListener("timeupdate", () => {
      setCurrentTime(audio.currentTime);
    });

    audio.addEventListener("ended", () => {
      setIsPlaying(false);
      setCurrentTime(0);
    });

    return () => {
      audio.pause();
      if (!audioUrl) URL.revokeObjectURL(url);
    };
  }, [audioBlob, audioUrl]);

  const togglePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const safeDuration = duration > 0 ? duration : Math.max(currentTime, 1);
  const progress = Math.min(100, (currentTime / safeDuration) * 100);

  return (
    <div className="audio-player">
      <button
        className="audio-play-button"
        onClick={togglePlayPause}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
        ) : (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <div className="audio-info">
        <div className="audio-progress-bar">
          <div className="audio-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="audio-time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </div>

      <div className="audio-actions">
        {onTranscribe && (
          <button
            className="audio-action-button transcribe"
            onClick={onTranscribe}
            title="Transcribe to text"
          >
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
              <path d="M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        )}
        {onDownload && (
          <button
            className="audio-action-button download"
            onClick={onDownload}
            title="Download voice"
            aria-label="Download voice"
          >
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
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
          </button>
        )}
        {onDelete && (
          <button
            className="audio-action-button delete"
            onClick={onDelete}
            title="Delete recording"
          >
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
              <path d="M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
