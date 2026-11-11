"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./photo-flow.css";

export default function PhotoViewer({ open, src, onClose }: { open: boolean; src: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    dialog.showModal();
    return () => { dialog.close(); };
  }, [open]);
  if (!open || !src || typeof document === "undefined") return null;
  return createPortal(<dialog ref={ref} className="hisaab-photo-viewer" aria-label="View photo" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><button type="button" aria-label="Close photo" onClick={onClose}>✕</button><img src={src} alt="Photo attached to this Hisaab entry" /></dialog>, document.body);
}
