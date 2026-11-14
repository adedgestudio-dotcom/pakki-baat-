"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cloudConfigured, cloudSnapshotsEqual, currentSession, loadWorkspaceBackups, loadBackupSettings, loadReportLedger, readLedgerDirty, saveCloud, saveWorkspaceBackup, setBackupSettings, signInWithGoogle, watchSession, type WorkspaceBackup } from "@/lib/cloud";
import { anchorDayForSave, restoreWorkspaceSnapshot, scheduledSlot, validateWorkspaceBackup, workspaceBackupFileName, type BackupFrequency, type BackupSettings } from "@/lib/customer-backup";
import { isSnapshot, type Snapshot } from "@/lib/data";
import { runWorkspaceBackup } from "@/lib/workspace-daily-backup-lifecycle";

const emptySettings = (): BackupSettings => ({ frequency: "off", time_of_day: null, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", anchor_day: null, customers: [], last_run_at: null });
const dateLabel = (value: string | Date) => new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const timeLabel = (value: string | null) => {
  if (!value) return "Pick a time";
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
};

function ClockPicker({ value, disabled, onChange }: { value: string | null; disabled: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"hour" | "minute">("hour");
  const [hour, setHour] = useState<number | null>(null);
  const [minute, setMinute] = useState<number | null>(null);
  const [period, setPeriod] = useState<"AM" | "PM" | null>(null);
  const openPicker = () => {
    const [h, m] = value ? value.split(":").map(Number) : [NaN, NaN];
    setHour(Number.isFinite(h) ? h % 12 || 12 : null);
    setMinute(Number.isFinite(m) ? Math.round(m / 5) * 5 % 60 : null);
    setPeriod(Number.isFinite(h) ? h < 12 ? "AM" : "PM" : null);
    setStep("hour"); setOpen(true);
  };
  const choices = step === "hour" ? Array.from({ length: 12 }, (_, i) => i + 1) : Array.from({ length: 12 }, (_, i) => i * 5);
  return <div className="backup-clock-field">
    <button type="button" className="backup-clock-trigger" disabled={disabled} onClick={openPicker} aria-haspopup="dialog" aria-expanded={open}>{timeLabel(value)} <span aria-hidden="true">◷</span></button>
    {open && <div className="backup-clock-popover" role="dialog" aria-label="Pick backup time" onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
      <div className="backup-clock-heading"><button type="button" className={step === "hour" ? "selected" : ""} onClick={() => setStep("hour")}>{hour === null ? "Hour" : hour}</button><span>:</span><button type="button" className={step === "minute" ? "selected" : ""} onClick={() => setStep("minute")}>{minute === null ? "Min" : String(minute).padStart(2, "0")}</button></div>
      <div className="backup-clock-dial" aria-label={step === "hour" ? "Choose hour" : "Choose minutes"}>{choices.map((choice, index) => <button key={choice} type="button" className={(step === "hour" ? hour : minute) === choice ? "selected" : ""} style={{ left: `${50 + 39 * Math.sin(index * Math.PI / 6)}%`, top: `${50 - 39 * Math.cos(index * Math.PI / 6)}%` }} onClick={() => { if (step === "hour") { setHour(choice); setStep("minute"); } else setMinute(choice); }}>{step === "minute" ? String(choice).padStart(2, "0") : choice}</button>)}</div>
      <div className="backup-clock-period"><button type="button" className={period === "AM" ? "selected" : ""} onClick={() => setPeriod("AM")}>AM</button><button type="button" className={period === "PM" ? "selected" : ""} onClick={() => setPeriod("PM")}>PM</button></div>
      <div className="backup-clock-actions"><button type="button" onClick={() => setOpen(false)}>Cancel</button><button type="button" disabled={hour === null || minute === null || period === null} onClick={() => { onChange(`${String(hour! % 12 + (period === "PM" ? 12 : 0)).padStart(2, "0")}:${String(minute).padStart(2, "0")}`); setOpen(false); }}>OK</button></div>
    </div>}
  </div>;
}

export default function CloudSettings({ snapshot, onRestore, onPauseAutosave, onToast = () => {}, scheduledProgress = null, scheduledError = "", onClearScheduledError = () => {}, ownerId, canBackup }: { snapshot: Snapshot; onRestore: (snapshot: Snapshot) => void; onPauseAutosave: (paused: boolean) => void; onToast?: (message: string) => void; scheduledProgress?: number | null; scheduledError?: string; onClearScheduledError?: () => void; ownerId: string | null; canBackup: boolean }) {
  const [logged, setLogged] = useState(false), [checking, setChecking] = useState(cloudConfigured), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [backups, setBackups] = useState<WorkspaceBackup[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<WorkspaceBackup | null>(null);
  const [draft, setDraft] = useState<BackupSettings>(emptySettings);
  const [savedSettings, setSavedSettings] = useState<BackupSettings>(emptySettings);
  const [now, setNow] = useState(() => Date.now());
  const [progress, setProgress] = useState<number | null>(null);
  const [backupFailed, setBackupFailed] = useState(false);
  const requestRef = useRef(0), ownerRef = useRef(ownerId), restoreStartedRef = useRef(false);
  useEffect(() => { ownerRef.current = ownerId; const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, [ownerId]);

  const refresh = useCallback(async (preserveDraft = false) => {
    if (!ownerId) return;
    const request = ++requestRef.current;
    const [nextSettings, nextBackups] = await Promise.all([loadBackupSettings(ownerId), loadWorkspaceBackups(ownerId)]);
    if (request !== requestRef.current || ownerRef.current !== ownerId) return;
    setSavedSettings(nextSettings); setDraft(previous => preserveDraft ? { ...previous, last_run_at: nextSettings.last_run_at } : nextSettings); setBackups(nextBackups);
  }, [ownerId]);
  useEffect(() => {
    if (!cloudConfigured) return;
    void currentSession().then(session => { setLogged(session?.user.id === ownerId); if (session?.user.id === ownerId) void refresh(); }).catch(() => setStatus("Could not check your sign-in.")).finally(() => setChecking(false));
    return watchSession(session => { const same = session?.user.id === ownerId; setLogged(same); setChecking(false); if (same) void refresh(); else { ++requestRef.current; setBackups([]); setDraft(emptySettings()); setSavedSettings(emptySettings()); } });
  }, [ownerId, refresh]);
  const last = backups[0];
  const nextSlot = scheduledSlot(savedSettings, new Date(now), true);
  const scheduleNeedsTime = ["daily", "weekly", "monthly"].includes(draft.frequency);
  const controlsBusy = busy || scheduledProgress !== null;
  const displayedProgress = progress ?? scheduledProgress;
  const saveDisabled = controlsBusy || !canBackup || scheduleNeedsTime && !draft.time_of_day;

  async function run(action: () => Promise<void>) {
    setBusy(true); setStatus("");
    try { await action(); } catch (error) { if (restoreStartedRef.current) { onPauseAutosave(false); restoreStartedRef.current = false; } setStatus(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }
  async function saveSettings() {
    if (!ownerId || saveDisabled) return;
    await run(async () => {
      const next = { ...draft, customers: [], anchor_day: anchorDayForSave(draft.frequency, draft.tz) };
      await setBackupSettings(next, ownerId);
      setDraft(next); setSavedSettings(next); setStatus("Backup settings saved.");
    });
  }
  async function backUpNow() {
    if (!ownerId || !canBackup || controlsBusy) return;
    setBackupFailed(false); onClearScheduledError(); setProgress(0);
    await run(async () => {
      try {
        const result = await runWorkspaceBackup(snapshot, savedSettings, ownerId, "manual", (done, total) => setProgress(Math.round(done / total * 100)));
        setStatus(result); onToast(result); await refresh(true);
      } catch (error) { setBackupFailed(true); throw error; }
      finally { setProgress(null); }
    });
  }
  async function restoreBackup(backup: WorkspaceBackup) {
    if (!ownerId || !canBackup || !backups.some(row => row.id === backup.id)) return;
    setRestoreTarget(null);
    await run(async () => {
      const restored = validateWorkspaceBackup(backup.payload);
      validateWorkspaceBackup(snapshot);
      if ((await currentSession())?.user.id !== ownerId) throw new Error("ACCOUNT_CHANGED: sign in to the original account.");
      const dirty = readLedgerDirty(ownerId);
      if (dirty && !cloudSnapshotsEqual(dirty.snapshot, snapshot)) throw new Error("Workspace changed during restore. Retry with the latest data.");
      const ledger = await loadReportLedger(ownerId);
      const historicalJobs = new Set(ledger.map(row => row.job_id).filter((id): id is string => typeof id === "string"));
      const historicalPayments = new Set(ledger.flatMap(row => [row.metadata?.payment_id, row.metadata?.legacy_payment_id]).filter((id): id is string => typeof id === "string"));
      restoreWorkspaceSnapshot(restored, snapshot, historicalJobs, historicalPayments);
      onPauseAutosave(true); restoreStartedRef.current = true;
      await saveWorkspaceBackup(snapshot, "pre_restore", ownerId);
      await saveCloud(restored, ownerId);
      if ((await currentSession())?.user.id !== ownerId) throw new Error("ACCOUNT_CHANGED: restore was saved to the original account. Sign in again.");
      onRestore(restored);
      restoreStartedRef.current = false;
      setStatus(`Restored ${workspaceBackupFileName(backup.created_at, savedSettings.tz, backup.backup_kind === "pre_restore")}.`);
      await refresh(true).catch(() => {});
    });
  }

  return <div className="cloud-settings backup-page">
    <div className="backup-page-intro"><div><h3>Backup</h3><p>Back up your whole workspace.</p></div></div>
    {!cloudConfigured ? <div className="notice">Cloud backup is not connected yet.</div> : checking ? <div className="notice">Checking your backup…</div> : !logged ? <><div className="notice">Sign in to use backups.</div><button className="google-sign-in" disabled={busy} onClick={() => void run(signInWithGoogle)}>Continue with Google</button></> : <>
      <section className="backup-simple-card backup-run-card"><span><strong>{last ? `Last backup: ${workspaceBackupFileName(last.created_at, savedSettings.tz, last.backup_kind === "pre_restore")}` : "Last backup: None yet"}</strong><small>Photos are not part of backups.</small><small>Backups are kept for 30 days (up to 60).</small></span>{displayedProgress !== null && <div className="backup-progress" role="progressbar" aria-valuenow={displayedProgress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${displayedProgress}%` }} /></div>}{displayedProgress !== null && <small>Backing up… {displayedProgress}%</small>}{scheduledError && <small role="alert">{scheduledError}</small>}<button type="button" className="primary backup-run-button" disabled={controlsBusy || !canBackup} onClick={() => void backUpNow()}>{backupFailed || scheduledError ? "Retry" : "Back up"}</button>
      <div className="backup-auto-card"><div className="backup-auto-heading"><strong>Automatic backups</strong><small>Choose when Pakki Baat makes workspace copies.</small></div><div className="backup-auto-form"><label className="backup-auto-field">Repeat<select aria-label="Repeat" value={draft.frequency} disabled={controlsBusy || !canBackup} onChange={event => setDraft(previous => ({ ...previous, frequency: event.target.value as BackupFrequency, time_of_day: null }))}><option value="off">Off</option><option value="manual">Only when I tap Back up</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>{scheduleNeedsTime && <div className="backup-auto-field"><span>Backup time</span><ClockPicker value={draft.time_of_day} disabled={controlsBusy || !canBackup} onChange={value => setDraft(previous => ({ ...previous, time_of_day: value }))}/></div>}<button type="button" className="primary backup-auto-save" disabled={saveDisabled} onClick={() => void saveSettings()}>Save</button></div>{nextSlot && <div className="backup-next-slot"><strong>Next backup: {dateLabel(nextSlot)}</strong><small className="backup-next-help">Keep the app open at backup time. If closed, it runs when you next open it.</small></div>}</div></section>
      <section className="backup-history"><div><strong>Restore from a backup</strong></div>
        {[...backups].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map(backup => <div className="backup-history-row" key={backup.id}><strong>{workspaceBackupFileName(backup.created_at, savedSettings.tz, backup.backup_kind === "pre_restore")}</strong><button type="button" className="outline" disabled={controlsBusy || !canBackup} onClick={() => setRestoreTarget(backup)}>Restore</button></div>)}
        {!backups.length && <div className="notice">No saved backups yet.</div>}
      </section>
    </>}
    {restoreTarget && <div className="modal-backdrop backup-restore-confirm-backdrop"><section className="backup-restore-confirm" role="dialog" aria-modal="true" aria-label="Confirm restore"><p>Restore backup {workspaceBackupFileName(restoreTarget.created_at, savedSettings.tz, restoreTarget.backup_kind === "pre_restore")}? Your app will show exactly the entries from that backup: Now {snapshot.jobs.length} entries → Backup {isSnapshot(restoreTarget.payload) ? restoreTarget.payload.jobs.length : "?"} entries. A safety copy of your current data is saved first.</p><div><button type="button" onClick={() => setRestoreTarget(null)}>No</button><button type="button" className="primary" onClick={() => void restoreBackup(restoreTarget)}>Yes</button></div></section></div>}
    {status && <p role="status">{status}</p>}
  </div>;
}
