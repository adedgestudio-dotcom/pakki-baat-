"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { currentSession } from "@/lib/cloud";
import { PHOTO_MAX_BYTES, PHOTO_TYPES, validatePhoto } from "@/lib/entry-photo";
import { shrinkPhoto } from "./shrink-photo";
import PhotoPreview from "./photo-preview";
import PhotoViewer from "./photo-viewer";

export default function HisaabEntryPhoto({ ownerId, entryId, canUpload, capture, countOnly = false, thumb = false, initialFile, entryNumber, onAttached, onPreviewCancel }: { ownerId: string | null; entryId: string; canUpload: boolean; capture?: "environment"; countOnly?: boolean; thumb?: boolean; initialFile?: File | null; entryNumber?: number; onAttached?: () => void; onPreviewCancel?: () => void }) {
  const root = useRef<HTMLElement>(null), generation = useRef(0), objectUrl = useRef("");
  const requests = useRef(new Set<AbortController>()), uploading = useRef(false);
  const [url, setUrl] = useState(""), [checked, setChecked] = useState(false), [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [previewFile, setPreviewFile] = useState<File | null>(initialFile || null), [previewUrl, setPreviewUrl] = useState(() => initialFile ? URL.createObjectURL(initialFile) : ""), [viewer, setViewer] = useState(false), [status, setStatus] = useState("");
  useEffect(() => { if (previewUrl) return () => URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const clearImage = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = "";
    setUrl("");
  }, []);
  const scopedFetch = useCallback(async (init?: RequestInit) => {
    const session = await currentSession();
    if (!ownerId || session?.user.id !== ownerId) throw new Error("Sign in to the correct account to use entry photos.");
    const controller = new AbortController();
    requests.current.add(controller);
    const timer = window.setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch("/api/hisaab-photo?entryId=" + encodeURIComponent(entryId), {
        ...init, cache: "no-store", signal: controller.signal,
        headers: { Authorization: "Bearer " + session.access_token },
      });
      if ((await currentSession())?.user.id !== ownerId) throw new Error("Your account changed. Reopen this entry.");
      return response;
    } finally { window.clearTimeout(timer); requests.current.delete(controller); }
  }, [ownerId, entryId]);
  const load = useCallback(async () => {
    if (!ownerId || !navigator.onLine) return;
    const token = generation.current;
    try {
      const response = await scopedFetch();
      if (token !== generation.current) return;
      if (response.status === 404) { clearImage(); setChecked(true); setError(""); return; }
      if (!response.ok) throw new Error((await response.json()).error || "Could not load the photo. Retry online.");
      const blob = await response.blob();
      if (token !== generation.current) return;
      clearImage(); objectUrl.current = URL.createObjectURL(blob); setUrl(objectUrl.current); setChecked(true); setError("");
    } catch (cause) {
      if (token === generation.current) { setChecked(false); setError(cause instanceof Error ? cause.message : "Could not load the photo."); }
    }
  }, [ownerId, scopedFetch, clearImage]);
  useEffect(() => {
    generation.current++;
    clearImage(); setChecked(false); setStatus(""); setError("");
    const details = root.current?.closest("details");
    const readWhenVisible = () => { if (!details || details.open) void load(); };
    const connectionChanged = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) readWhenVisible();
      else {
        generation.current++;
        for (const request of requests.current) request.abort();
        clearImage(); setChecked(false); setBusy(false); uploading.current = false; setError("");
      }
    };
    setOnline(navigator.onLine); readWhenVisible();
    details?.addEventListener("toggle", readWhenVisible);
    const photoChanged = (event: Event) => { if ((event as CustomEvent).detail === `${ownerId}:${entryId}` && !uploading.current) void load(); };
    window.addEventListener("hisaab-photo-changed", photoChanged);
    window.addEventListener("online", connectionChanged); window.addEventListener("offline", connectionChanged);
    const pendingRequests = requests.current;
    return () => {
      generation.current++;
      for (const request of pendingRequests) request.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      details?.removeEventListener("toggle", readWhenVisible);
      window.removeEventListener("hisaab-photo-changed", photoChanged);
      window.removeEventListener("online", connectionChanged); window.removeEventListener("offline", connectionChanged);
    };
  }, [load, clearImage, ownerId, entryId]);
  async function upload(file: File) {
    if (!ownerId || !online || !navigator.onLine || !canUpload || !checked || uploading.current || url || !previewFile) return;
    const token = generation.current;
    uploading.current = true; setBusy(true); setError("");
    try {
      let prepared = file;
      try { prepared = await shrinkPhoto(file); } catch { prepared = file; }
      if (prepared.size > PHOTO_MAX_BYTES) { try { prepared = await shrinkPhoto(file, 1280, 0.65); } catch { prepared = file; } }
      validatePhoto(prepared);
      const form = new FormData(); form.set("entryId", entryId); form.set("photo", prepared);
      const response = await scopedFetch({ method: "POST", body: form });
      if (token !== generation.current) return;
      if (response.status === 409) { await load(); throw new Error(`Entry ${entryNumber || ""} already has a photo. Choose another entry.`); }
      if (!response.ok) throw new Error((await response.json()).error || "Upload failed. Retry online.");
      setPreviewFile(null); setPreviewUrl(""); setStatus("Photo attached"); await load();
      window.dispatchEvent(new CustomEvent("hisaab-photo-changed", { detail: `${ownerId}:${entryId}` }));
      onAttached?.();
    } catch (cause) {
      if (token === generation.current) setError(cause instanceof Error ? cause.message : "Upload failed. Retry online.");
    } finally { if (token === generation.current) { uploading.current = false; setBusy(false); } }
  }
  if (thumb) return <>{online && checked && url && <button type="button" className="hisaab-photo-thumb" aria-label="View photo" onClick={event => { event.stopPropagation(); setViewer(true); }}><img src={url} alt="" /></button>}<PhotoViewer open={viewer} src={url} onClose={() => setViewer(false)}/></>;
  if (countOnly) return url && online && checked ? <small className="hisaab-photo-count">1 photo</small> : null;
  if (!ownerId) return null;
  return (
    <section ref={root} className="hisaab-entry-photo" aria-label="Entry photo">
      <strong>Photos{url ? " (1)" : ""}</strong>
      <small>JPG, PNG or WebP, up to 4 MB. Needs internet.</small>
      {entryNumber && url && !previewFile && !status && <p role="alert">Entry {entryNumber} already has a photo. Choose another entry.</p>}
      {!online ? <p>Reconnect to view or add this entry&apos;s photo.</p> : previewFile && previewUrl ? (
        <PhotoPreview src={previewUrl} busy={busy} error={error} existing={!!url} ready={(checked || !!error) && online && canUpload} entryNumber={entryNumber} onCancel={() => { setPreviewFile(null); setPreviewUrl(""); setError(""); onPreviewCancel?.(); }} onAttach={() => { if (!checked) void load(); else void upload(previewFile); }}/>
      ) : url ? (
        // Private authenticated bytes are displayed through a short-lived object URL, never a public asset URL.
        <button type="button" className="hisaab-photo-image-button" aria-label="View photo" onClick={() => setViewer(true)}><img src={url} alt="Photo attached to this Hisaab entry" className="hisaab-entry-photo-image" /></button>
      ) : checked && canUpload ? (
        <>
          <p>No photos yet. Tap Add photo.</p>
          {/* The native file input stays in the label for keyboard and screen-reader use. */}
          <label className={busy ? "hisaab-entry-photo-upload is-busy" : "hisaab-entry-photo-upload"}>
            <span aria-hidden="true">Add photo</span>
            <input type="file" capture={capture} className="hisaab-entry-photo-input" aria-label="Add entry photo" accept="image/jpeg,image/png,image/webp" disabled={busy}
              onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (!PHOTO_TYPES.some(type => type === file.type)) { setError("Choose a JPG, PNG or WebP photo."); return; } setError(""); setPreviewFile(file); setPreviewUrl(URL.createObjectURL(file)); }} />
          </label>
        </>
      ) : checked ? <p>No photo attached. An active plan is required to upload.</p> : <p>Open this entry online to check its photo.</p>}
      {busy && <p role="status">Uploading…</p>}
      {status && <p role="status">{status}</p>}
      {error && !previewFile && <p role="alert">{error}</p>}
      {online && error && !previewFile && <button type="button" className="outline" disabled={busy} onClick={() => void load()}>Retry photo</button>}
      <PhotoViewer open={viewer} src={url} onClose={() => setViewer(false)}/>
    </section>
  );
}
