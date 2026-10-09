"use client";

import { useEffect, useState } from "react";
import {
  cloudSnapshotsEqual,
  readLedgerDirty,
  cloudConfigured,
  currentSession,
  loadWorkspaceBackups,
  loadWorkspaceBackupRetention,
  saveCloud,
  saveWorkspaceBackup,
  setWorkspaceBackupRetention,
  signInWithGoogle,
  watchSession,
  type WorkspaceBackup,
} from "@/lib/cloud";
import { isSnapshot, type Snapshot } from "@/lib/data";

function safeName(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `PakkiBaat_Backup_${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBackup(snapshot: Snapshot, createdAt = new Date()) {
  downloadBlob(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }), safeName(createdAt) + ".json");
}

export default function CloudSettings({ snapshot, onRestore, onPauseAutosave, ownerId }: { snapshot: Snapshot; onRestore: (snapshot: Snapshot) => void; onPauseAutosave: (paused: boolean) => void; ownerId: string | null; dark?: boolean; onToggleTheme?: () => void }) {
  const [logged, setLogged] = useState(false);
  const [checking, setChecking] = useState(cloudConfigured);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [backupHistory, setBackupHistory] = useState<{ ownerId: string; rows: WorkspaceBackup[] } | null>(null);
  const backups = backupHistory?.ownerId === ownerId ? backupHistory.rows : [];
  const [retention, setRetention] = useState<15|30|null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const latestHealthy = backups.find(item => isSnapshot(item.payload));
  const latestHealthyAt = latestHealthy ? new Date(latestHealthy.created_at) : null;
  const protectedLabel = latestHealthyAt
    ? `✓ Protected · Last backup: ${latestHealthyAt.toLocaleDateString("en-IN", { day:"numeric", month:"short" })}, ${latestHealthyAt.toLocaleTimeString("en-IN", { hour:"numeric", minute:"2-digit" })}`
    : "Backup will start after your next saved change.";

  async function refreshBackups() {
    try {
      const session = await currentSession();
      if (!session || !ownerId || session.user.id !== ownerId) { setBackupHistory(null); return; }
      const [items, days] = await Promise.all([loadWorkspaceBackups(ownerId), loadWorkspaceBackupRetention()]);
      if ((await currentSession())?.user.id !== ownerId) { setBackupHistory(null); return; }
      setBackupHistory({ ownerId, rows: items });
      setRetention(days);
      setShowSetup(days === null);
    } catch {
      setBackupHistory(null);
    }
  }

  useEffect(() => {
    if (!cloudConfigured) return;
    void currentSession().then(session => {
      setLogged(Boolean(session));
      if (session && session.user.id === ownerId) void refreshBackups();
    }).catch(()=>setStatus("Could not check your sign-in. Please try again.")).finally(()=>setChecking(false));
    return watchSession(session => {
      setLogged(Boolean(session));
      setChecking(false);
      if (session && session.user.id === ownerId) void refreshBackups(); else setBackupHistory(null);
    });
  }, [ownerId]);

  async function action(run:()=>Promise<void>) {
    setBusy(true); setStatus("");
    try { await run(); }
    catch(cause) { onPauseAutosave(false); setStatus(cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }

  async function chooseRetention(days:15|30) {
    await action(async()=>{
      await setWorkspaceBackupRetention(days);
      setRetention(days);
      setShowSetup(false);
      setStatus(`Automatic backups will be kept for ${days} days.`);
      await refreshBackups();
    });
  }

  async function applyRestore(restoreSnapshot: Snapshot, successMessage: string) {
    if (!ownerId || backupHistory?.ownerId !== ownerId) throw new Error("Backup history belongs to another sign-in. Reload before restoring.");
    if ((await currentSession())?.user.id !== ownerId) throw new Error("ACCOUNT_CHANGED: sign in to the original account.");
    if (!isSnapshot(snapshot)) throw new Error("Current workspace could not be verified for a safety copy.");
    onPauseAutosave(true);
    await saveWorkspaceBackup(snapshot, "pre_restore", ownerId);
    const dirty = readLedgerDirty(ownerId);
    if (dirty && !cloudSnapshotsEqual(dirty.snapshot, snapshot)) throw new Error("Workspace changed during restore. Retry with the latest data.");
    await saveCloud(restoreSnapshot, ownerId);
    if ((await currentSession())?.user.id !== ownerId) throw new Error("ACCOUNT_CHANGED: restore was saved to the original account. Sign in again.");
    onRestore(restoreSnapshot);
    setStatus(successMessage);
    await refreshBackups();
  }

  async function restoreVersion(backup: WorkspaceBackup) {
    if (!ownerId || backupHistory?.ownerId !== ownerId || !backups.some(row => row.id === backup.id)) {
      setStatus("Backup history belongs to another sign-in. Reload before restoring."); return;
    }
    if (!isSnapshot(backup.payload)) { setStatus("This backup is damaged or invalid."); return; }
    if (!confirm("Restore this backup? Pakki Baat will first save your current workspace as a safety copy.")) return;
    await action(() => applyRestore(backup.payload as Snapshot, "Backup restored ✓ Your previous workspace was saved as a safety copy."));
  }

  async function importBackup(file: File) {
    await action(async () => {
      if (file.size > 10_000_000) throw new Error("Backup is too large.");
      const parsed: unknown = JSON.parse(await file.text());
      if (!isSnapshot(parsed)) throw new Error("This is not a valid Pakki Baat backup file.");
      if (!confirm("Backup verified ✓ Restore this file? Your current workspace will first be saved as a safety copy.")) return;
      await applyRestore(parsed, "Backup file verified and restored ✓");
    });
  }

  const label=(backup:WorkspaceBackup)=>{
    const d=new Date(backup.created_at);
    return `${backup.backup_kind==="pre_restore"?"Safety copy":"Automatic backup"} · ${d.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})} · ${d.toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit"})}`;
  };

  return <div className="cloud-settings backup-page">
    <div className="backup-page-intro">
      <div><h3>Automatic backup</h3><p>Pakki Baat keeps dated recovery copies on your account so an older good copy stays available.</p></div>
      {logged && <span className={retention ? "backup-status-pill ok" : "backup-status-pill"}>{retention ? "On" : "Setup needed"}</span>}
    </div>
    {logged && <div className="backup-protected-line">{protectedLabel}</div>}

    {!cloudConfigured ? <div className="notice">Cloud backup is not connected yet.</div>
    : checking ? <div className="notice">Checking your backup…</div>
    : !logged ? <><div className="notice">Sign in to protect this workspace with automatic server backups.</div><button className="google-sign-in" disabled={busy} onClick={()=>action(signInWithGoogle)}>Continue with Google</button></>
    : <>
      <section className="backup-simple-card">
        <span><strong>Keep backups for</strong><small>Older server backups are removed automatically.</small></span>
        <div className="backup-retention-options">
          <button type="button" className={retention===15?"active":""} disabled={busy} onClick={()=>void chooseRetention(15)}>15 days</button>
          <button type="button" className={retention===30?"active":""} disabled={busy} onClick={()=>void chooseRetention(30)}>30 days</button>
        </div>
      </section>

      <section className="backup-history">
        <div><strong>Backup history</strong><small>Each day is kept as its own recovery point. A newer day does not overwrite an older day.</small></div>
        {backups.length ? backups.map(backup => {
          const healthy=isSnapshot(backup.payload);
          return <div className="backup-history-row" key={backup.id}>
            <span><strong>{label(backup)}</strong><small>{healthy?"✓ Verified":"Invalid backup — restore blocked"}</small></span>
            <div className="backup-row-actions">
              <button type="button" className="outline" disabled={busy||!healthy} onClick={()=>void restoreVersion(backup)}>Restore</button>
              <button type="button" className="outline" disabled={!healthy} onClick={()=>healthy&&downloadBackup(backup.payload as Snapshot,new Date(backup.created_at))}>Download</button>
            </div>
          </div>;
        }) : <div className="notice">No dated backups yet. Your first saved change will create one automatically.</div>}
      </section>

      <section className="backup-export-card">
        <div><strong>Keep a copy on your device</strong><small>Save a restorable copy on your device.</small></div>
        <div className="backup-export-actions">
          <button type="button" className="primary" onClick={()=>downloadBackup(snapshot)}>Download Backup</button>
          <label className="upload restore-backup-button"><span className="restore-backup-main">Restore from File</span><input type="file" accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];if(file)void importBackup(file);e.target.value="";}}/></label>
        </div>
        <small>For readable financial statements, PDF downloads and printing, use Reports.</small>
      </section>
    </>}

    {status && <p role="status">{status}</p>}

    {logged && showSetup && <div className="modal-backdrop" onClick={()=>setShowSetup(false)}>
      <section className="backup-setup-modal" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}>
        <span className="eyebrow">BACKUP SETUP</span><h2>Choose how long to keep backups</h2>
        <p>Your workspace is protected. Choose how much dated backup history you want Pakki Baat to keep.</p>
        <div className="backup-retention-options"><button className="active" disabled={busy} onClick={()=>void chooseRetention(15)}>15 days</button><button disabled={busy} onClick={()=>void chooseRetention(30)}>30 days</button></div>
        <button className="text-button" onClick={()=>setShowSetup(false)}>Choose later</button>
      </section>
    </div>}
  </div>;
}
