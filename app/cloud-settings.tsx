"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cloudConfigured, cloudSnapshotsEqual, currentSession, loadWorkspaceBackups, loadBackupSettings, readLedgerDirty, restoreCloud, saveWorkspaceBackup, setBackupSettings, signInWithGoogle, watchSession, LEGACY_WORKSPACE_READ_ONLY_MESSAGE, type WorkspaceBackup } from "@/lib/cloud";
import { anchorDayForSave, restoreWorkspaceSnapshot, scheduledSlot, validateWorkspaceBackup, workspaceBackupDateTime, workspaceBackupFileName, type BackupFrequency, type BackupSettings } from "@/lib/customer-backup";
import { isSnapshot, type Snapshot } from "@/lib/data";
import { runWorkspaceBackup } from "@/lib/workspace-daily-backup-lifecycle";

const emptySettings = (): BackupSettings => ({ frequency: "off", time_of_day: null, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, anchor_day: null, customers: [], last_run_at: null });
const dateLabel = (value: string | Date) => new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
function backupLabel(createdAt: string, tz: string, now: number) {
  const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const date = new Date(createdAt);
  const today = day(new Date(now));
  const yesterday = day(new Date(now - 86_400_000));
  const datePart = day(date) === today ? "Today" : day(date) === yesterday ? "Yesterday" : new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(date).toLowerCase();
  return `${datePart}, ${time}`;
}
function friendlyRestoreError(error: unknown) {
  const message = error instanceof Error ? error.message : "Please try again.";
  if (message.includes("CUSTOMER_LIMIT_REACHED")) return "This backup has more customers than your plan allows. Nothing was changed.";
  if (/JOB_CHARGE_RECONCILIATION_FAILED|JOB_PAYMENT_RECONCILIATION_FAILED|INVALID_/.test(message)) return "This backup can't be restored safely. Nothing was changed.";
  if (message.includes("WORKSPACE_REVISION_CONFLICT")) return "Your data changed on another device. Reload and try again.";
  return message;
}
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

export default function CloudSettings({ snapshot, onRestore, onPauseAutosave, onUseCloudData, onToast = () => {}, scheduledProgress = null, scheduledError = "", onClearScheduledError = () => {}, ownerId, backupLockReason }: { snapshot: Snapshot; onRestore: (snapshot: Snapshot) => void; onPauseAutosave: (paused: boolean) => void; onUseCloudData: () => Promise<void>; onToast?: (message: string) => void; scheduledProgress?: number | null; scheduledError?: string; onClearScheduledError?: () => void; ownerId: string | null; backupLockReason: "loading" | "no-plan" | "conflict" | "legacy" | null }) {
  const [logged, setLogged] = useState(false), [checking, setChecking] = useState(cloudConfigured), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [backups, setBackups] = useState<WorkspaceBackup[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<WorkspaceBackup | null>(null);
  const [selectedBackupId, setSelectedBackupId] = useState("");
  const [backupMenuOpen, setBackupMenuOpen] = useState(false);
  const [highlightedBackupIndex, setHighlightedBackupIndex] = useState(0);
  const backupMenuRef = useRef<HTMLDivElement>(null);
  const backupListRef = useRef<HTMLDivElement>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [restoreHint, setRestoreHint] = useState(false);
  const [confirmCloudData, setConfirmCloudData] = useState(false);
  const [draft, setDraft] = useState<BackupSettings>(emptySettings);
  const [savedSettings, setSavedSettings] = useState<BackupSettings>(emptySettings);
  const [now, setNow] = useState(() => Date.now());
  const [progress, setProgress] = useState<number | null>(null);
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
  const sortedBackups = [...backups].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const regularBackups = sortedBackups.filter(backup => backup.backup_kind !== "pre_restore");
  const safetyBackups = sortedBackups.filter(backup => backup.backup_kind === "pre_restore");
  const menuBackups = [...regularBackups, ...safetyBackups];
  const last = sortedBackups[0];
  const selectedBackup = sortedBackups.find(backup => backup.id === selectedBackupId);
  const selectedSnapshot = selectedBackup && isSnapshot(selectedBackup.payload) ? selectedBackup.payload : null;
  const currentIds = new Set(snapshot.jobs.map(job => job.id));
  const selectedIds = new Set(selectedSnapshot?.jobs.map(job => job.id) || []);
  const entriesRemoved = snapshot.jobs.filter(job => !selectedIds.has(job.id)).length;
  const entriesReturned = selectedSnapshot?.jobs.filter(job => !currentIds.has(job.id)).length || 0;
  const nextSlot = scheduledSlot(savedSettings, new Date(now), true);
  const scheduleNeedsTime = ["daily", "weekly", "monthly"].includes(draft.frequency);
  const controlsBusy = busy || scheduledProgress !== null;
  const displayedProgress = progress ?? scheduledProgress;
  const canBackup = backupLockReason === null;
  const saveDisabled = controlsBusy || !canBackup || scheduleNeedsTime && !draft.time_of_day;
  useEffect(() => {
    if (!backupMenuOpen) return;
    const onOutsideTap = (event: PointerEvent) => {
      if (!backupMenuRef.current?.contains(event.target as Node)) setBackupMenuOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setBackupMenuOpen(false); backupMenuRef.current?.querySelector("button")?.focus(); }
    };
    document.addEventListener("pointerdown", onOutsideTap);
    document.addEventListener("keydown", onEscape);
    const frame = requestAnimationFrame(() => { backupListRef.current?.scrollIntoView({ block: "nearest" }); backupListRef.current?.focus(); });
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", onOutsideTap); document.removeEventListener("keydown", onEscape); };
  }, [backupMenuOpen]);
  useEffect(() => {
    if (backupMenuOpen) backupListRef.current?.querySelector(`[data-backup-index="${highlightedBackupIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [backupMenuOpen, highlightedBackupIndex]);
  useEffect(() => { if (controlsBusy || !canBackup) setBackupMenuOpen(false); }, [controlsBusy, canBackup]);
  function chooseBackup(backup: WorkspaceBackup) {
    setSelectedBackupId(backup.id);
    setRestoreHint(false);
    setBackupMenuOpen(false);
    backupMenuRef.current?.querySelector("button")?.focus();
  }
  function backupMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedBackupIndex(index => Math.max(0, Math.min(menuBackups.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" && menuBackups[highlightedBackupIndex]) {
      event.preventDefault(); chooseBackup(menuBackups[highlightedBackupIndex]);
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true); setStatus("");
    try { await action(); } catch (error) { if (restoreStartedRef.current) { onPauseAutosave(false); restoreStartedRef.current = false; } setStatus(friendlyRestoreError(error)); }
    finally { setBusy(false); }
  }
  async function saveSettings() {
    if (!ownerId || saveDisabled) return;
    await run(async () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const next = { ...draft, tz, customers: [], anchor_day: anchorDayForSave(draft.frequency, tz) };
      await setBackupSettings(next, ownerId);
      setDraft(next); setSavedSettings(next); setScheduleOpen(false); setStatus("Backup settings saved.");
    });
  }
  async function backUpNow() {
    if (!ownerId || !canBackup || controlsBusy) return;
    onClearScheduledError(); setProgress(0);
    await run(async () => {
      try {
        const result = await runWorkspaceBackup(snapshot, savedSettings, ownerId, "manual", (done, total) => setProgress(Math.round(done / total * 100)));
        setStatus(result); onToast(result); await refresh(true);
      } catch (error) { throw error; }
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
      restoreWorkspaceSnapshot(restored, snapshot);
      onPauseAutosave(true); restoreStartedRef.current = true;
      await saveWorkspaceBackup(snapshot, "pre_restore", ownerId);
      await restoreCloud(restored, ownerId);
      if ((await currentSession())?.user.id !== ownerId) throw new Error("ACCOUNT_CHANGED: restore was saved to the original account. Sign in again.");
      onRestore(restored);
      restoreStartedRef.current = false;
      setSelectedBackupId(""); setRestoreHint(true);
      onToast(`Restored ✓ ${workspaceBackupFileName(backup.created_at, savedSettings.tz, backup.backup_kind === "pre_restore")}`);
      await refresh(true).catch(() => {});
    });
  }

  return <div className="cloud-settings backup-page">
    <div className="backup-page-intro"><div><h3>Backup</h3><p>Back up your whole workspace.</p></div></div>
    {!cloudConfigured ? <div className="notice">Cloud backup is not connected yet.</div> : checking ? <div className="notice">Checking your backup…</div> : !logged ? <><div className="notice">Sign in to use backups.</div><button className="google-sign-in" disabled={busy} onClick={() => void run(signInWithGoogle)}>Continue with Google</button></> : <>
      {backupLockReason && <div className="notice" role="status">{backupLockReason === "loading" ? "Loading your data…" : backupLockReason === "no-plan" ? "Backups need an active plan." : backupLockReason === "legacy" ? LEGACY_WORKSPACE_READ_ONLY_MESSAGE : <>This phone&apos;s data is different from your cloud data. <button type="button" className="outline" disabled={busy} onClick={() => setConfirmCloudData(true)}>Use cloud data</button></>}</div>}
      <section className="backup-simple-card backup-run-card">
        <strong>{last ? `✓ Last backup: ${backupLabel(last.created_at, savedSettings.tz, now)}` : "No backup yet"}</strong>
        {displayedProgress !== null && <div className="backup-progress" role="progressbar" aria-valuenow={displayedProgress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${displayedProgress}%` }} /></div>}
        {displayedProgress !== null && <small>Backing up… {displayedProgress}%</small>}
        {scheduledError && <small role="alert">{scheduledError}</small>}
        <button type="button" className="primary backup-run-button" disabled={controlsBusy || !canBackup} onClick={() => void backUpNow()}>Back up now</button>
        <div className="backup-auto-card">
          <div className="backup-auto-summary"><strong>Auto backup: {["daily", "weekly", "monthly"].includes(savedSettings.frequency) ? `${savedSettings.frequency[0].toUpperCase()}${savedSettings.frequency.slice(1)} at ${timeLabel(savedSettings.time_of_day)}` : "Off"}</strong><button type="button" className="outline" aria-expanded={scheduleOpen} onClick={() => setScheduleOpen(value => !value)}>Change</button></div>
          {scheduleOpen && <div className="backup-auto-form"><label className="backup-auto-field">Repeat<select aria-label="Repeat" value={draft.frequency} disabled={controlsBusy || !canBackup} onChange={event => setDraft(previous => ({ ...previous, frequency: event.target.value as BackupFrequency, time_of_day: null }))}><option value="off">Off</option><option value="manual">Only when I tap Back up</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>{scheduleNeedsTime && <div className="backup-auto-field"><span>Backup time</span><ClockPicker value={draft.time_of_day} disabled={controlsBusy || !canBackup} onChange={value => setDraft(previous => ({ ...previous, time_of_day: value }))}/></div>}<button type="button" className="primary backup-auto-save" disabled={saveDisabled} onClick={() => void saveSettings()}>Save</button></div>}
          {nextSlot && <div className="backup-next-slot"><strong>Next backup: {dateLabel(nextSlot)}</strong><small className="backup-next-help">Keep the app open at backup time. If closed, it runs when you next open it.</small></div>}
        </div>
        <small>Kept for 30 days (up to 60). Photos are not included.</small>
      </section>
      <section className="backup-simple-card backup-restore-card"><strong>Restore from a backup</strong>
        {backups.length ? <><div className="backup-picker" ref={backupMenuRef}>
          <button type="button" className="backup-picker-trigger" aria-label="Choose a backup" aria-haspopup="listbox" aria-expanded={backupMenuOpen} aria-controls="backup-picker-list" disabled={controlsBusy || !canBackup} onClick={() => { setHighlightedBackupIndex(Math.max(0, menuBackups.findIndex(backup => backup.id === selectedBackupId))); setBackupMenuOpen(open => !open); }} onKeyDown={event => { if (!backupMenuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setHighlightedBackupIndex(event.key === "ArrowDown" ? 0 : menuBackups.length - 1); setBackupMenuOpen(true); } }}><span>{selectedBackup ? `${backupLabel(selectedBackup.created_at, savedSettings.tz, now)} · ${isSnapshot(selectedBackup.payload) ? selectedBackup.payload.jobs.length : "?"} entries` : "Select a backup…"}</span><span className={`backup-picker-chevron${backupMenuOpen ? " open" : ""}`} aria-hidden="true" /></button>
          {backupMenuOpen && <div id="backup-picker-list" className="backup-picker-list" role="listbox" aria-label="Choose a backup" aria-activedescendant={`backup-picker-option-${highlightedBackupIndex}`} tabIndex={-1} ref={backupListRef} onKeyDown={backupMenuKeyDown}>
            {([ ["Backups", regularBackups], ["Safety copies (before restore)", safetyBackups] ] as const).map(([heading, rows]) => rows.length > 0 && <div className="backup-picker-group" key={heading}><div className="backup-picker-heading">{heading}</div>{rows.map(backup => { const index = menuBackups.findIndex(row => row.id === backup.id); const selected = backup.id === selectedBackupId; return <div id={`backup-picker-option-${index}`} key={backup.id} data-backup-index={index} role="option" aria-selected={selected} className={`backup-picker-option${selected ? " selected" : ""}${index === highlightedBackupIndex ? " highlighted" : ""}`} onMouseEnter={() => setHighlightedBackupIndex(index)} onClick={() => chooseBackup(backup)}><span>{backupLabel(backup.created_at, savedSettings.tz, now)}</span><span className="backup-picker-option-meta">{isSnapshot(backup.payload) ? backup.payload.jobs.length : "?"} entries{selected && <span className="backup-picker-check" aria-hidden="true">✓</span>}</span></div>; })}</div>)}
          </div>}
        </div>
          {selectedBackup && <div className="backup-restore-summary">This backup: {selectedSnapshot?.jobs.length ?? "?"} entries · {selectedSnapshot ? new Set(selectedSnapshot.jobs.map(job => job.customer)).size : "?"} customers. Now: {snapshot.jobs.length} entries.{entriesRemoved > 0 && <p>{entriesRemoved} entries added after this backup will be removed.</p>}{entriesReturned > 0 && <p>{entriesReturned} entries missing now will come back.</p>}</div>}
          <button type="button" className="primary backup-run-button" disabled={!selectedBackup || controlsBusy || !canBackup} onClick={() => selectedBackup && setRestoreTarget(selectedBackup)}>Restore</button></> : <div className="notice">No backups yet. Tap Back up now.</div>}
        {restoreHint && <small>To undo, restore the newest safety copy.</small>}
      </section>
    </>}
    {restoreTarget && <div className="modal-backdrop backup-restore-confirm-backdrop"><section className="backup-restore-confirm" role="dialog" aria-modal="true" aria-labelledby="backup-restore-title"><h2 id="backup-restore-title">Restore this backup?</h2><p>{workspaceBackupDateTime(restoreTarget.created_at, savedSettings.tz)}</p><p>Now {snapshot.jobs.length} entries → Backup {isSnapshot(restoreTarget.payload) ? restoreTarget.payload.jobs.length : "?"} entries.</p><small>A safety copy of your current data is saved first.</small><div className="backup-restore-confirm-actions"><button type="button" className="outline" onClick={() => setRestoreTarget(null)}>No</button><button type="button" className="primary" onClick={() => void restoreBackup(restoreTarget)}>Yes, restore</button></div></section></div>}
    {confirmCloudData && <div className="modal-backdrop backup-restore-confirm-backdrop"><section className="backup-restore-confirm" role="dialog" aria-modal="true" aria-label="Use cloud data"><p>Changes made only on this phone will be lost.</p><div><button type="button" disabled={busy} onClick={() => setConfirmCloudData(false)}>No</button><button type="button" className="primary" disabled={busy} onClick={() => void run(async () => { await onUseCloudData(); setConfirmCloudData(false); setStatus("Cloud data loaded on this phone."); })}>Yes</button></div></section></div>}
    {status && <p role="status">{status}</p>}
  </div>;
}
