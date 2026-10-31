"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { presentWorkspaceBackupStatus, type WorkspaceCloudSaveStatus } from "@/lib/workspace-backup-status";
import type { DailyBackupStatus } from "@/lib/workspace-daily-backup-coordinator";
import { datedRecoveryHistoryState, loadWorkspaceBackupHistory } from "@/lib/workspace-backup-history";

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


function todayUtc() {
  const date = new Date();
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`;
}

export default function CloudSettings({ snapshot, onRestore, onPauseAutosave, ownerId, cloudSaveStatus, dailyBackupStatus, dailyBackupGeneration }: { snapshot: Snapshot; onRestore: (snapshot: Snapshot) => void; onPauseAutosave: (paused: boolean) => void; ownerId: string | null; cloudSaveStatus: WorkspaceCloudSaveStatus; dailyBackupStatus: DailyBackupStatus; dailyBackupGeneration: number; dark?: boolean; onToggleTheme?: () => void }) {
  const [logged, setLogged] = useState(false);
  const [checking, setChecking] = useState(cloudConfigured);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [backupHistory, setBackupHistory] = useState<{ ownerId: string; rows: WorkspaceBackup[] } | null>(null);
  const [backupHistoryState, setBackupHistoryState] = useState<"checking"|"loaded"|"unavailable">("checking");
  const [retentionState, setRetentionState] = useState<"checking"|"loaded"|"schema-unavailable"|"unavailable">("checking");
  const backupHistoryRequestRef = useRef(0);
  const currentOwnerRef = useRef(ownerId);
  currentOwnerRef.current = ownerId;
  const backups = backupHistory?.ownerId === ownerId ? backupHistory.rows : [];
  const [retention, setRetention] = useState<15|30|null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const latestDatedRecovery = backups.find(item => item.backup_kind === "daily" && isSnapshot(item.payload));
  const latestDatedRecoveryAt = latestDatedRecovery ? new Date(latestDatedRecovery.created_at) : null;
  const datedRecoveryHistory = datedRecoveryHistoryState({ backups, historyState: backupHistoryState, utcDay: todayUtc(), matchesCurrentSnapshot: payload => isSnapshot(payload) && cloudSnapshotsEqual(payload, snapshot) });
  const protectedLabel = latestDatedRecoveryAt
    ? `Dated recovery history Â· Last copy: ${latestDatedRecoveryAt.toLocaleDateString("en-IN", { day:"numeric", month:"short" })}, ${latestDatedRecoveryAt.toLocaleTimeString("en-IN", { hour:"numeric", minute:"2-digit" })}`
    : "No dated recovery copy is listed yet.";
  const statusSummary = presentWorkspaceBackupStatus({ cloud: cloudSaveStatus, recovery: dailyBackupStatus, ownerId, generation: dailyBackupGeneration, datedRecoveryHistory });

  const refreshBackups = useCallback(async () => {
    if (!ownerId) {
      setBackupHistory(null);
      setBackupHistoryState("checking");
      setRetention(null);
      setRetentionState("checking");
      return;
    }
    const requestId = ++backupHistoryRequestRef.current;
    setBackupHistoryState("checking");
    setRetentionState("checking");
    const result = await loadWorkspaceBackupHistory({ ownerId, currentSession, loadBackups: loadWorkspaceBackups, loadRetention: loadWorkspaceBackupRetention });
    if (requestId !== backupHistoryRequestRef.current || currentOwnerRef.current !== ownerId) return;
    if (result.state === "cancelled") {
      setBackupHistory(null);
      setBackupHistoryState("checking");
      setRetention(null);
      setRetentionState("checking");
      return;
    }
    setRetention(result.retention);
    setRetentionState(result.retentionState);
    setShowSetup(result.state === "loaded" && result.retentionState === "loaded" && result.retention === null);
    if (result.state === "unavailable") {
      setBackupHistory(null);
      setBackupHistoryState("unavailable");
      return;
    }
    setBackupHistory({ ownerId, rows: result.backups });
    setBackupHistoryState("loaded");
  }, [ownerId]);

  useEffect(() => {
    if (!cloudConfigured) return;
    void currentSession().then(session => {
      setLogged(Boolean(session));
      if (session && session.user.id === ownerId) void refreshBackups();
    }).catch(()=>setStatus("Could not check your sign-in. Please try again.")).finally(()=>setChecking(false));
    return watchSession(session => {
      setLogged(Boolean(session));
      setChecking(false);
      if (session && session.user.id === ownerId) void refreshBackups(); else { setBackupHistory(null); setBackupHistoryState("checking"); setRetention(null); setRetentionState("checking"); }
    });
  }, [ownerId, refreshBackups]);

  const currentBackupConfirmation = dailyBackupStatus.state === "confirmed" && dailyBackupStatus.ownerId === ownerId && dailyBackupStatus.generation === dailyBackupGeneration;
  useEffect(() => {
    if (currentBackupConfirmation) void refreshBackups();
  }, [currentBackupConfirmation, refreshBackups]);

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
      setRetentionState("loaded");
      setShowSetup(false);
      setStatus(`Your ${days}-day backup preference was saved.`);
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
    return `${backup.backup_kind==="pre_restore"?"Safety copy":"Automatic backup"} Â· ${d.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})} Â· ${d.toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit"})}`;
  };

  return <div className="cloud-settings backup-page">
    <div className="backup-page-intro">
      <div><h3>Automatic backup</h3><p>Pakki Baat keeps dated recovery copies on your account so an older good copy stays available.</p></div>
      {logged && <span className={retentionState === "unavailable" || retentionState === "schema-unavailable" ? "backup-status-pill warning" : retention ? "backup-status-pill ok" : "backup-status-pill"}>{retentionState === "schema-unavailable" ? "Retention setup unavailable" : retentionState === "unavailable" ? "Retention unavailable" : retention ? `${retention}-day preference` : "Retention setup needed"}</span>}
    </div>
    {logged && <div className="backup-protected-line">{protectedLabel}</div>}
    {logged && <section className="backup-status-summary" aria-label="Backup status">
      <div className={`backup-status-row ${statusSummary.cloud.tone}`}><span>Workspace save</span><strong>{statusSummary.cloud.label}</strong>{statusSummary.cloud.detail && <small>{statusSummary.cloud.detail}</small>}</div>
      <div className={`backup-status-row ${statusSummary.recovery.tone}`}><span>Daily recovery copy</span><strong>{statusSummary.recovery.label}</strong>{statusSummary.recovery.detail && <small>{statusSummary.recovery.detail}</small>}</div>
    </section>}

    {!cloudConfigured ? <div className="notice">Cloud backup is not connected yet.</div>
    : checking ? <div className="notice">Checking your backup…</div>
    : !logged ? <><div className="notice">Sign in to protect this workspace with automatic server backups.</div><button className="google-sign-in" disabled={busy} onClick={()=>action(signInWithGoogle)}>Continue with Google</button></>
    : <>
      <section className="backup-simple-card">
        <span><strong>Preferred backup history</strong><small>{retentionState === "schema-unavailable" ? "Retention preferences are not available on this server. Backup history is shown separately." : retentionState === "unavailable" ? "Preference could not be loaded. Backup history is shown separately." : retention ? "Saved as your preference. It does not guarantee how long existing recovery copies are kept." : "Choose a preference for dated backup history. It does not guarantee how long existing recovery copies are kept."}</small></span>
        <div className="backup-retention-options">
          <button type="button" className={retention===15?"active":""} aria-pressed={retention===15} disabled={busy} onClick={()=>void chooseRetention(15)}><strong>15 days</strong><small>Preference</small></button>
          <button type="button" className={retention===30?"active":""} aria-pressed={retention===30} disabled={busy} onClick={()=>void chooseRetention(30)}><strong>30 days</strong><small>Preference</small></button>
        </div>
      </section>

      <section className="backup-history">
        <div><strong>Backup history</strong><small>Each day is kept as its own recovery point. A newer day does not overwrite an older day.</small></div>
        {backups.length ? backups.map(backup => {
          const healthy=isSnapshot(backup.payload);
          return <div className="backup-history-row" key={backup.id}>
            <span><strong>{label(backup)}</strong><small>{healthy?"Available for restore":"Invalid backup — restore blocked"}</small></span>
            <div className="backup-row-actions">
              <button type="button" className="outline" disabled={busy||!healthy} onClick={()=>void restoreVersion(backup)}>Restore</button>
              <button type="button" className="outline" disabled={!healthy} onClick={()=>healthy&&downloadBackup(backup.payload as Snapshot,new Date(backup.created_at))}>Download</button>
            </div>
          </div>;
        }) : <div className="notice">{backupHistoryState === "unavailable" ? "Backup history is unavailable right now, so a dated recovery copy cannot be confirmed." : currentBackupConfirmation ? "Today's recovery copy is still being checked. It is not ready until it appears in dated backup history." : "No dated backups yet. Your first successful recovery copy will appear here."}</div>}
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

    {logged && showSetup && <div className="modal-backdrop backup-setup-backdrop" onClick={()=>setShowSetup(false)}>
      <section className="backup-setup-modal" role="dialog" aria-modal="true" aria-labelledby="backup-setup-title" aria-describedby="backup-setup-description" onClick={e=>e.stopPropagation()} onKeyDown={event=>{if(event.key==="Escape")setShowSetup(false)}}>
        <span className="eyebrow">BACKUP SETUP</span><h2 id="backup-setup-title">Choose how long to keep backups</h2>
        <p id="backup-setup-description">Choose a saved preference only. It does not yet guarantee how long recovery copies are kept.</p>
        <div className="backup-retention-options backup-setup-options" aria-label="Preferred backup history">
          <button type="button" className="active" aria-pressed="true" autoFocus disabled={busy} onClick={()=>void chooseRetention(15)}><span><strong>15 days</strong><small>Save preference</small></span><b className="backup-selection-check" aria-hidden="true">✓</b></button>
          <button type="button" aria-pressed="false" disabled={busy} onClick={()=>void chooseRetention(30)}><span><strong>30 days</strong><small>Save preference</small></span><b className="backup-selection-check" aria-hidden="true">✓</b></button>
        </div>
        <button type="button" className="text-button backup-setup-later" onClick={()=>setShowSetup(false)}>Choose later</button>
      </section>
    </div>}
  </div>;
}
