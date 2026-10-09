"use client";

import { useEffect, useState } from "react";
import { blockCloudSaves, clearLedgerDirty, cloudConfigured, cloudSnapshotsEqual, currentSession, loadCloud, loadCloudState, loadWorkspaceBackups, readLedgerDirty, saveCloud, saveWorkspaceBackup, signInWithGoogle, signOut, watchSession, type WorkspaceBackup } from "@/lib/cloud";
import { isSnapshot, type Snapshot } from "@/lib/data";

export default function CloudSettings({ snapshot, onRestore, onPauseAutosave, ownerId }: { snapshot: Snapshot; onRestore: (snapshot: Snapshot) => void; onPauseAutosave: (paused: boolean) => void; ownerId: string | null; dark?: boolean; onToggleTheme?: () => void }) {
  const [logged, setLogged] = useState(false);
  const [checking, setChecking] = useState(cloudConfigured);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [backupHistory, setBackupHistory] = useState<{ ownerId: string; rows: WorkspaceBackup[] } | null>(null);
  const backups = backupHistory?.ownerId === ownerId ? backupHistory.rows : [];

  async function refreshBackups() {
    try {
      const session = await currentSession();
      if (!session) { setBackupHistory(null); return; }
      const rows = await loadWorkspaceBackups(session.user.id);
      setBackupHistory({ ownerId: session.user.id, rows });
    } catch { setBackupHistory(null); }
  }

  useEffect(() => {
    if (!cloudConfigured) return;
    void currentSession()
      .then((session) => {
        setLogged(Boolean(session));
        if (session) void refreshBackups();
      })
      .catch(() => setStatus("Could not check your sign-in. Please try again."))
      .finally(() => setChecking(false));
    return watchSession((session) => {
      setLogged(Boolean(session));
      setChecking(false);
      if (session) void refreshBackups(); else setBackupHistory(null);
    });
  }, []);

  async function action(run: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    try { await run(); }
    catch (cause) { onPauseAutosave(false); setStatus(cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }

  async function restoreVersion(backup: WorkspaceBackup) {
    if (!ownerId || backupHistory?.ownerId !== ownerId || !backupHistory.rows.some((row) => row.id === backup.id)) {
      setStatus("Backup history belongs to another sign-in. Reload the history before restoring.");
      return;
    }
    if (!isSnapshot(backup.payload)) {
      setStatus("This backup is damaged or invalid. Choose an earlier backup.");
      return;
    }
    const restoreSnapshot = backup.payload;
    if (!isSnapshot(restoreSnapshot)) {
      setStatus("This backup is damaged or invalid. Choose an earlier backup.");
      return;
    }
    if (!confirm("Restore this backup? Pakki Baat will first save your current workspace as a safety copy.")) return;
    await action(async () => {
      onPauseAutosave(true);
      if (!isSnapshot(snapshot)) throw new Error("Current workspace is not valid enough to create a safety copy.");
      if (!ownerId) throw new Error("Sign in before restoring a cloud backup.");
      await saveWorkspaceBackup(snapshot, "pre_restore", ownerId);
      const dirty = readLedgerDirty(ownerId);
      if (dirty && !cloudSnapshotsEqual(dirty.snapshot, snapshot)) throw new Error("Workspace changed during restore. Please retry so the safety copy includes your latest changes.");
      await saveCloud(restoreSnapshot, ownerId);
      if ((await currentSession())?.user.id !== ownerId) throw new Error("ACCOUNT_CHANGED: restore was saved to the original account, but this device switched accounts. Sign in again to load it.");
      onRestore(restoreSnapshot);
      setStatus("Backup restored ✓ Your previous workspace was saved as a safety copy.");
      await refreshBackups();
    });
  }

  async function restoreCurrentCloud() {
    if (!ownerId) throw new Error("Sign in before restoring a cloud backup.");
    onPauseAutosave(true);
    const saved = await loadCloud(ownerId);
    if (!saved) { onPauseAutosave(false); setStatus("No cloud backup yet."); return; }
    if (!isSnapshot(saved)) throw new Error("The current cloud workspace is not valid. Use Backup history below to restore an earlier healthy copy.");
    if (!confirm("Restore current cloud workspace? This replaces this device’s current workspace.")) { onPauseAutosave(false); return; }
    if (isSnapshot(snapshot)) await saveWorkspaceBackup(snapshot, "pre_restore", ownerId);
    const dirty = readLedgerDirty(ownerId);
    if (dirty && !cloudSnapshotsEqual(dirty.snapshot, snapshot)) throw new Error("Workspace changed during restore. Please retry so the safety copy includes your latest changes.");
    const current = await loadCloudState();
    if (current.ownerId !== ownerId || !cloudSnapshotsEqual(current.snapshot, saved)) {
      blockCloudSaves(ownerId);
      throw new Error("Cloud changed during restore. Please review and try again.");
    }
    if ((await currentSession())?.user.id !== ownerId) throw new Error("ACCOUNT_CHANGED: sign in to the original account before restoring.");
    clearLedgerDirty(ownerId, snapshot);
    onRestore(saved);
    setStatus("Cloud backup restored.");
    await refreshBackups();
  }

  const backupLabel = (backup: WorkspaceBackup) => {
    const date = new Date(backup.created_at);
    return `${backup.backup_kind === "pre_restore" ? "Safety copy" : "Automatic backup"} · ${date.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})} ${date.toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit"})}`;
  };

  return <div className="cloud-settings">
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
          : <>
              <div className="cloud-buttons">
                <button className="primary" disabled={busy} onClick={() => action(async () => { if (!confirm("Replace your cloud workspace with this device’s workspace?")) return; if (!ownerId) throw new Error("Sign in before saving a cloud backup."); await saveCloud(snapshot, ownerId); await saveWorkspaceBackup(snapshot, "daily", ownerId); await refreshBackups(); setStatus("Cloud backup saved."); })}>Save cloud backup</button>
                <button className="outline" disabled={busy} onClick={() => action(restoreCurrentCloud)}>Restore cloud backup</button>
                <button className="text-button" disabled={busy} onClick={() => action(async () => { await signOut(); setStatus("Signed out. Sign in again to see your workspace."); })}>Sign out</button>
              </div>
              <div className="backup-history">
                <div><strong>Automatic backup history</strong><small>Pakki Baat keeps recent dated copies so one damaged backup cannot replace every good copy.</small></div>
                {backups.length ? backups.map(backup => <div className="backup-history-row" key={backup.id}><span><strong>{backupLabel(backup)}</strong><small>{isSnapshot(backup.payload) ? "Healthy backup" : "Invalid backup — restore blocked"}</small></span><button type="button" className="outline" disabled={busy || !isSnapshot(backup.payload)} onClick={()=>void restoreVersion(backup)}>Restore</button></div>) : <div className="notice">No dated backups yet. The first one is created automatically after your next saved change.</div>}
              </div>
            </>}
    {status && <p role="status">{status}</p>}
    <small>Your workspace is saved to the signed-in account. Automatic dated backups keep recent recovery points. Signing out hides that account’s business data on this device.</small>
  </div>;
}
