"use client";

import { useEffect, useState } from "react";
import { cloudConfigured, currentSession, loadCloud, saveCloud, signInWithGoogle, signOut, watchSession } from "@/lib/cloud";
import { isSnapshot, type Snapshot } from "@/lib/data";

export default function CloudSettings({ snapshot, onRestore, dark, onToggleTheme }: { snapshot: Snapshot; onRestore: (snapshot: Snapshot) => void; dark: boolean; onToggleTheme: () => void }) {
  const [logged, setLogged] = useState(false);
  const [checking, setChecking] = useState(cloudConfigured);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!cloudConfigured) return;
    void currentSession()
      .then((session) => setLogged(Boolean(session)))
      .catch(() => setStatus("Could not check your sign-in. Please try again."))
      .finally(() => setChecking(false));
    return watchSession((session) => {
      setLogged(Boolean(session));
      setChecking(false);
    });
  }, []);

  async function action(run: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    try { await run(); }
    catch (cause) { setStatus(cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }

  return <div className="cloud-settings">
    <div className="theme-control">
      <div><strong>Appearance</strong><small>Choose the look that feels comfortable.</small></div>
      <button type="button" className={dark ? "switch on" : "switch"} role="switch" aria-checked={dark} aria-label="Toggle dark mode" onClick={onToggleTheme}><span /></button>
    </div>
    <h3>Keep your business with you</h3>
    <p>Sign in with Google to keep this workspace linked to your account and use AI voice transcription.</p>
    {!cloudConfigured
      ? <div className="notice">Cloud setup is not connected yet. Local trial features work now.</div>
      : checking
        ? <div className="notice">Checking your sign-in…</div>
        : !logged
          ? <button className="google-sign-in" disabled={busy} onClick={() => action(signInWithGoogle)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2.1 1-3.4 1a5.9 5.9 0 0 1-5.5-4.1H3.1v2.7A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.5 14a6 6 0 0 1 0-3.9V7.3H3.1a10 10 0 0 0 0 9.4L6.5 14Z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.9 1.5l2.9-2.8A9.7 9.7 0 0 0 3.1 7.3l3.4 2.8A5.9 5.9 0 0 1 12 5.9Z"/></svg>
              Continue with Google
            </button>
          : <div className="cloud-buttons">
              <button className="primary" disabled={busy} onClick={() => action(async () => { if (!confirm("Replace your cloud backup with this device’s workspace? Export a local backup first if needed.")) return; await saveCloud(snapshot); setStatus("Cloud backup saved."); })}>Save cloud backup</button>
              <button className="outline" disabled={busy} onClick={() => action(async () => { const saved = await loadCloud(); if (!saved) { setStatus("No cloud backup yet."); return; } if (!isSnapshot(saved)) throw new Error("The cloud backup is not a valid workspace."); if (confirm("Restore cloud backup? This replaces this device’s current workspace.")) { onRestore(saved); setStatus("Cloud backup restored."); } })}>Restore cloud backup</button>
              <button className="text-button" disabled={busy} onClick={() => action(async () => { await signOut(); setStatus("Signed out. Sign in again to see your workspace."); })}>Sign out</button>
            </div>}
    {status && <p role="status">{status}</p>}
    <small>Your workspace is saved to the signed-in account. Signing out hides that account’s business data on this device.</small>
  </div>;
}
