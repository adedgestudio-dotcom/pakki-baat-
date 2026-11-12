"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./photo-flow.css";

export default function PhotoViewer({ open, src, onClose, onDelete, error }: { open: boolean; src: string; onClose: () => void; onDelete?: () => Promise<void>; error?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false), [deleting, setDeleting] = useState(false), [deleteError, setDeleteError] = useState("");
  const close = () => { if (deleting) return; setConfirming(false); setDeleteError(""); onClose(); };
  async function confirmDelete() {
    if (!onDelete || deleting) return;
    setDeleting(true); setDeleteError("");
    try { await onDelete(); setConfirming(false); onClose(); }
    catch (cause) { setDeleteError(cause instanceof Error ? cause.message : "Could not delete this photo."); }
    finally { setDeleting(false); }
  }
  useEffect(() => { if (!open) { setConfirming(false); setDeleting(false); setDeleteError(""); } }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    dialog.showModal();
    return () => { dialog.close(); };
  }, [open]);
  if (!open || !src || typeof document === "undefined") return null;
  return createPortal(<dialog ref={ref} className={`hisaab-photo-viewer${onDelete ? " has-delete" : ""}`} aria-label="View photo" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}><button type="button" aria-label="Close photo" disabled={deleting} onClick={close}>✕</button><img src={src} alt="Photo attached to this Hisaab entry"/>{onDelete && <div style={{ position: "absolute", left: 16, right: 16, bottom: "calc(16px + env(safe-area-inset-bottom))", display: "grid", gap: 10, justifyItems: "center", zIndex: 2 }}>
    {confirming ? <><p role="alert" style={{ margin: 0, textAlign: "center", color: "#fff" }}>Delete this photo? This can&apos;t be undone.</p><div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 420 }}><button type="button" disabled={deleting} onClick={() => { setConfirming(false); setDeleteError(""); }} style={{ flex: 1, minHeight: 44, borderRadius: 12, border: "1px solid #7d8b80", background: "#26352c", color: "#fff" }}>Cancel</button><button type="button" disabled={deleting} onClick={() => void confirmDelete()} style={{ flex: 1, minHeight: 44, borderRadius: 12, border: "1px solid #d88e86", background: "#632922", color: "#fff" }}>{deleting ? "Deleting…" : "Delete"}</button></div></> : <button type="button" onClick={() => setConfirming(true)} style={{ width: "100%", maxWidth: 420, minHeight: 44, borderRadius: 12, border: "1px solid #d88e86", background: "#281c1a", color: "#f2aaa1", fontWeight: 650 }}>Delete photo</button>}
    {(error || deleteError) && <p role="alert" style={{ margin: 0, color: "#ffb5ac", textAlign: "center" }}>{error || deleteError}</p>}
  </div>}</dialog>, document.body);
}
