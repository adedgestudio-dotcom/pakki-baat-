"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function ChatSheet({ open, onClose, label, children, scrollKey }: { open: boolean; onClose: () => void; label: string; children: ReactNode; scrollKey?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) { const content = ref.current?.querySelector<HTMLElement>(".hisaab-sheet-content"); if (content) content.scrollTop = 0; } }, [open, scrollKey]);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const marker = `hisaab-${Date.now()}-${Math.random()}`;
    if (window.history.state?.hisaabSheet) window.history.replaceState({ ...window.history.state, hisaabSheet: marker }, "");
    else window.history.pushState({ ...window.history.state, hisaabSheet: marker }, "");
    const handleBack = () => { if (window.history.state?.hisaabSheet !== marker) onClose(); };
    window.addEventListener("popstate", handleBack);
    dialog.showModal();
    return () => { window.removeEventListener("popstate", handleBack); dialog.close(); previous?.focus(); window.setTimeout(() => { if (window.history.state?.hisaabSheet === marker) window.history.back(); }, 0); };
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(<dialog ref={ref} className="hisaab-sheet" aria-label={label} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="hisaab-sheet-content"><button type="button" className="hisaab-sheet-close" aria-label={`Close ${label}`} onClick={onClose}>×</button>{children}</div>
  </dialog>, document.body);
}
