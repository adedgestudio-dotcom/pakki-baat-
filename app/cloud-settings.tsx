"use client";

import { useEffect, useState } from "react";
import {
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

export default function CloudSettings({ snapshot, onRestore }: { snapshot: Snapshot; onRestore: (snapshot: Snapshot) => void; dark?: boolean; onToggleTheme?: () => void }) {
  const [logged, setLogged] = useState(false);
  const [checking, setChecking] = useState(cloudConfigured);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [backups, setBackups] = useState<WorkspaceBackup[]>([]);
  const [retention, setRetention] = useState<15|30|null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const latestHealthy = backups.find(item => isSnapshot(item.payload));
  const latestHealthyAt = latestHealthy ? new Date(latestHealthy.created_at) : null;
  const protectedLabel = latestHealthyAt
    ? `✓ Protected · Last backup: ${latestHealthyAt.toLocaleDateString("en-IN", { day:"numeric", month:"short" })}, ${latestHealthyAt.toLocaleTimeString("en-IN", { hour:"numeric", minute:"2-digit" })}`
    : "Backup will start after your next saved change.";

  async function refreshBackups() {
    try {
      const [items, days] = await Promise.all([loadWorkspaceBackups(), loadWorkspaceBackupRetention()]);
      setBackups(items);
      setRetention(days);
      setShowSetup(days === null);
    } catch {
      setBackups([]);
    }
  }

  useEffect(() => {
    if (!cloudConfigured) return;
    void currentSession().then(session => {
      setLogged(Boolean(session));
      if (session) void refreshBackups();
    }).catch(()=>setStatus("Could not check your sign-in. Please try again.")).finally(()=>setChecking(false));
    return watchSession(session => {
      setLogged(Boolean(session));
      setChecking(false);
      if (session) void refreshBackups(); else setBackups([]);
    });
  }, []);

  async function action(run:()=>Promise<void>) {
    setBusy(true); setStatus("");
    try { await run(); }
    catch(cause) { setStatus(cause instanceof Error ? cause.message : "Please try again."); }
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

  async function restoreVersion(backup:WorkspaceBackup) {
    if (!isSnapshot(backup.payload)) { setStatus("This backup is damaged or invalid. Choose an earlier backup."); return; }
    if (!confirm("Restore this backup? Pakki Baat will first save your current workspace as a safety copy.")) return;
    await action(async()=>{
      if (!isSnapshot(snapshot)) throw new Error("Current workspace could not be verified.");
      await saveWorkspaceBackup(snapshot,"pre_restore");
      onRestore(backup.payload as Snapshot);
      await saveCloud(backup.payload);
      setStatus("Backup restored ✓ Your previous workspace was saved as a safety copy.");
      await refreshBackups();
    });
  }

  async function importBackup(file:File) {
    await action(async()=>{
      if (file.size > 10_000_000) throw new Error("Backup is too large.");
      const parsed: unknown = JSON.parse(await file.text());
      if (!isSnapshot(parsed)) throw new Error("This is not a valid Pakki Baat backup file.");
      if (!confirm("Backup verified ✓ Restore this file? Your current workspace will first be saved as a safety copy.")) return;
      if (!isSnapshot(snapshot)) throw new Error("Current workspace could not be verified.");
      await saveWorkspaceBackup(snapshot,"pre_restore");
      onRestore(parsed);
      await saveCloud(parsed);
      setStatus("Backup file verified and restored ✓");
      await refreshBackups();
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
