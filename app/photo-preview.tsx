"use client";
import "./photo-flow.css";

export default function PhotoPreview({ src, busy, error, existing, ready, entryNumber, onCancel, onAttach }: { src: string; busy: boolean; error: string; existing: boolean; ready: boolean; entryNumber?: number; onCancel: () => void; onAttach: () => void }) {
  return <div className="hisaab-photo-preview"><img src={src} alt="Photo waiting to be attached" /><p>This photo will be attached to this entry</p>{existing && <p role="alert">Entry {entryNumber || ""} already has a photo. Choose another entry.</p>}{!ready && !existing && <p role="status">Checking this entry…</p>}{error && <p role="alert">{error}</p>}<div className="hisaab-photo-preview-actions"><button type="button" className="outline" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="primary" disabled={busy || existing || !ready} onClick={onAttach}>{busy ? "Uploading…" : error ? "Retry" : "Attach photo"}</button></div></div>;
}
