"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./photo-flow.css";

export default function PhotoViewer({ open, src, onClose }: { open: boolean; src: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const marker = `photo-viewer-${Date.now()}-${Math.random()}`;
    window.history.pushState({ ...window.history.state, photoViewer: marker }, "");
    const handleBack = () => { if (window.history.state?.photoViewer !== marker) onClose(); };
    window.addEventListener("popstate", handleBack);
    dialog.showModal();
    return () => { window.removeEventListener("popstate", handleBack); dialog.close(); window.setTimeout(() => { if (window.history.state?.photoViewer === marker) window.history.back(); }, 0); };
  }, [open]);
  if (!open || !src || typeof document === "undefined") return null;
  return createPortal(<dialog ref={ref} className="hisaab-photo-viewer" aria-label="View photo" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><button type="button" aria-label="Close photo" onClick={onClose}>✕</button><img src={src} alt="Photo attached to this Hisaab entry" /></dialog>, document.body);
}
