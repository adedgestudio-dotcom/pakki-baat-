"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { currentSession } from "@/lib/cloud";
import { validatePhoto } from "@/lib/entry-photo";

export default function HisaabEntryPhoto({ ownerId, entryId, canUpload }: { ownerId: string | null; entryId: string; canUpload: boolean }) {
  const root = useRef<HTMLElement>(null), generation = useRef(0), objectUrl = useRef("");
  const requests = useRef(new Set<AbortController>()), uploading = useRef(false);
  const [url, setUrl] = useState(""), [checked, setChecked] = useState(false), [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [retryFile, setRetryFile] = useState<File | null>(null);
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
    window.addEventListener("online", connectionChanged); window.addEventListener("offline", connectionChanged);
    const pendingRequests = requests.current;
    return () => {
      generation.current++;
      for (const request of pendingRequests) request.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      details?.removeEventListener("toggle", readWhenVisible);
      window.removeEventListener("online", connectionChanged); window.removeEventListener("offline", connectionChanged);
    };
  }, [load, clearImage]);
  async function upload(file: File) {
    if (!ownerId || !online || !navigator.onLine || !canUpload || !checked || uploading.current || url) return;
    try { validatePhoto(file); } catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid photo."); return; }
    const token = generation.current;
    uploading.current = true; setBusy(true); setRetryFile(file); setError("");
    try {
      const form = new FormData(); form.set("entryId", entryId); form.set("photo", file);
      const response = await scopedFetch({ method: "POST", body: form });
      if (token !== generation.current) return;
      if (!response.ok && response.status !== 409) throw new Error((await response.json()).error || "Upload failed. Retry online.");
      setRetryFile(null); await load();
    } catch (cause) {
      if (token === generation.current) setError(cause instanceof Error ? cause.message : "Upload failed. Retry online.");
    } finally { if (token === generation.current) { uploading.current = false; setBusy(false); } }
  }
  if (!ownerId) return null;
  return (
    <section ref={root} className="hisaab-entry-photo" aria-label="Entry photo">
      <strong>Entry photo</strong>
      <small>One JPG, PNG or WebP, up to 5 MB. Upload and viewing require internet.</small>
      {!online ? <p>Reconnect to view or add this entry&apos;s photo.</p> : url ? (
        // Private authenticated bytes are displayed through a short-lived object URL, never a public asset URL.
        <img src={url} alt="Photo attached to this Hisaab entry" className="hisaab-entry-photo-image" />
      ) : checked && canUpload ? (
        <label className="hisaab-entry-photo-upload">Add one photo
          <input type="file" aria-label="Add entry photo" accept="image/jpeg,image/png,image/webp" disabled={busy}
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
        </label>
      ) : checked ? <p>No photo attached. An active plan is required to upload.</p> : <p>Open this entry online to check its photo.</p>}
      {busy && <p role="status">Uploading photo…</p>}
      {error && <p role="alert">{error}</p>}
      {online && error && <button type="button" className="outline" disabled={busy} onClick={() => { if (retryFile && checked) void upload(retryFile); else void load(); }}>Retry photo</button>}
    </section>
  );
}
