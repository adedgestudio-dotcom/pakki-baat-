"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cloudConfigured, cloudSnapshotsEqual, currentSession, loadBackupList, loadBackupPayload, loadBackupSettings, readLedgerDirty, restoreCloud, saveWorkspaceBackup, setBackupSettings, signInWithGoogle, watchSession, LEGACY_WORKSPACE_READ_ONLY_MESSAGE, type WorkspaceBackupSummary } from "@/lib/cloud";
import { anchorDayForSave, backupKindLabel, groupWorkspaceBackups, lastRegularBackup, undoRestoreBackup, restoreWorkspaceSnapshot, scheduledSlot, validateWorkspaceBackup, workspaceBackupDateTime, workspaceBackupFileName, type BackupFrequency, type BackupSettings } from "@/lib/customer-backup";
import { isSnapshot, type Snapshot } from "@/lib/data";
import { ManualWorkspaceBackupRunner } from "@/lib/workspace-daily-backup-lifecycle";
import SelectMenu from "./select-menu";

const emptySettings = (): BackupSettings => ({ frequency: "off", time_of_day: null, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, anchor_day: null, customers: [], last_run_at: null });
function dateLabel(value: string | Date, tz: string, now: number) {
  const date = new Date(value);
  const day = (item: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(item);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(date).toLowerCase();
  return day(date) === day(new Date(now)) ? `Today at ${time}` : new Intl.DateTimeFormat("en-IN", { timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
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

export function clampClockMinute(value: number): number { return Math.max(0, Math.min(59, Math.trunc(value))); }
export function clockTime24(hour: number, minute: number, period: "AM" | "PM"): string {
  return `${String(hour % 12 + (period === "PM" ? 12 : 0)).padStart(2, "0")}:${String(clampClockMinute(minute)).padStart(2, "0")}`;
}
function ClockPicker({ value, disabled, onChange }: { value: string | null; disabled: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState<number | null>(null);
  const [minute, setMinute] = useState<number | null>(null);
  const [period, setPeriod] = useState<"AM" | "PM" | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!fieldRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); fieldRef.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const openPicker = () => {
    const [h, m] = value ? value.split(":").map(Number) : [NaN, NaN];
    setHour(Number.isFinite(h) ? h % 12 || 12 : null);
    setMinute(Number.isFinite(m) ? clampClockMinute(m) : null);
    setPeriod(Number.isFinite(h) ? h < 12 ? "AM" : "PM" : null);
    setOpen(true);
  };
  return <div className="backup-clock-field" ref={fieldRef}>
    <button type="button" className="backup-clock-trigger" disabled={disabled} onClick={openPicker} aria-haspopup="dialog" aria-expanded={open}>{timeLabel(value)} <span aria-hidden="true">◷</span></button>
    {open && <div className="backup-clock-popover" role="dialog" aria-label="Pick backup time">
      <div className="backup-clock-heading">{hour ?? "--"}:{minute === null ? "--" : String(minute).padStart(2, "0")} {period ?? ""}</div>
      <strong>Hour</strong><div className="backup-clock-chips">{Array.from({ length: 12 }, (_, i) => i + 1).map(choice => <button key={choice} type="button" aria-pressed={hour === choice} className={hour === choice ? "selected" : ""} onClick={() => setHour(choice)}>{choice}</button>)}</div>
      <strong>Minute</strong><div className="backup-clock-chips">{Array.from({ length: 12 }, (_, i) => i * 5).map(choice => <button key={choice} type="button" aria-pressed={minute === choice} className={minute === choice ? "selected" : ""} onClick={() => setMinute(choice)}>{String(choice).padStart(2, "0")}</button>)}</div>
      <label className="backup-clock-minute">MM <input type="number" inputMode="numeric" min="0" max="59" placeholder="MM" value={minute ?? ""} onChange={event => setMinute(event.target.value === "" ? null : clampClockMinute(Number(event.target.value)))} /></label>
      <div className="backup-clock-period"><button type="button" aria-pressed={period === "AM"} className={period === "AM" ? "selected" : ""} onClick={() => setPeriod("AM")}>AM</button><button type="button" aria-pressed={period === "PM"} className={period === "PM" ? "selected" : ""} onClick={() => setPeriod("PM")}>PM</button></div>
      <div className="backup-clock-actions"><button type="button" onClick={() => setOpen(false)}>Cancel</button><button type="button" disabled={hour === null || minute === null || period === null} onClick={() => { if (hour !== null && minute !== null && period !== null) onChange(clockTime24(hour, minute, period)); setOpen(false); }}>OK</button></div>
    </div>}
  </div>;
}

export default function CloudSettings({ snapshot, onRestore, onPauseAutosave, onUseCloudData, onToast = () => {}, ownerId, backupLockReason }: { snapshot: Snapshot; onRestore: (snapshot: Snapshot) => void; onPauseAutosave: (paused: boolean) => void; onUseCloudData: () => Promise<void>; onToast?: (message: string) => void; ownerId: string | null; backupLockReason: "loading" | "no-plan" | "conflict" | "legacy" | null }) {
  const [logged, setLogged] = useState(false), [checking, setChecking] = useState(cloudConfigured), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [backups, setBackups] = useState<WorkspaceBackupSummary[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<WorkspaceBackupSummary | null>(null);
  const [selectedBackupId, setSelectedBackupId] = useState("");
  const [selectedPayload, setSelectedPayload] = useState<{ id: string; payload: unknown } | null>(null);
  const [backupMenuOpen, setBackupMenuOpen] = useState(false);
  const [highlightedBackupIndex, setHighlightedBackupIndex] = useState(0);
  const backupMenuRef = useRef<HTMLDivElement>(null);
  const backupListRef = useRef<HTMLDivElement>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [undoConfirm, setUndoConfirm] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState("");
  const [confirmCloudData, setConfirmCloudData] = useState(false);
  const [draft, setDraft] = useState<BackupSettings>(emptySettings);
  const [savedSettings, setSavedSettings] = useState<BackupSettings>(emptySettings);
  const [now, setNow] = useState(() => Date.now());
  const [progress, setProgress] = useState<number | null>(null);
  const requestRef = useRef(0), ownerRef = useRef(ownerId), restoreStartedRef = useRef(false), manualBackupRef = useRef(new ManualWorkspaceBackupRunner());
  useEffect(() => { ownerRef.current = ownerId; const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, [ownerId]);

  const refresh = useCallback(async (preserveDraft = false) => {
    if (!ownerId) return;
    const request = ++requestRef.current;
    const [nextSettings, nextBackups] = await Promise.all([loadBackupSettings(ownerId), loadBackupList(ownerId)]);
    if (request !== requestRef.current || ownerRef.current !== ownerId) return;
    setSavedSettings(nextSettings); setDraft(previous => preserveDraft ? { ...previous, last_run_at: nextSettings.last_run_at } : nextSettings); setBackups(nextBackups);
  }, [ownerId]);
  useEffect(() => {
    if (!cloudConfigured) return;
    void currentSession().then(session => { setLogged(session?.user.id === ownerId); if (session?.user.id === ownerId) void refresh(); }).catch(() => setStatus("Could not check your sign-in.")).finally(() => setChecking(false));
    return watchSession(session => { const same = session?.user.id === ownerId; setLogged(same); setChecking(false); if (same) void refresh(); else { ++requestRef.current; setBackups([]); setSelectedBackupId(""); setSelectedPayload(null); setRestoreNotice(""); setUndoConfirm(false); setDraft(emptySettings()); setSavedSettings(emptySettings()); } });
  }, [ownerId, refresh]);
  const { regular: regularBackups } = groupWorkspaceBackups(backups);
  const menuBackups = regularBackups;
  const undoBackup = undoRestoreBackup(backups, now);
  useEffect(() => { if (!restoreNotice) return; const timer = window.setTimeout(() => setRestoreNotice(""), 30_000); return () => window.clearTimeout(timer); }, [restoreNotice]);
  const last = lastRegularBackup(backups);
  const selectedBackup = regularBackups.find(backup => backup.id === selectedBackupId);
  const selectedSnapshot = selectedBackup && selectedPayload?.id === selectedBackup.id && isSnapshot(selectedPayload.payload) ? selectedPayload.payload : null;
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const restoreOptionLabel = (backup: WorkspaceBackupSummary) => `${backupKindLabel(backup.backup_kind)} · ${workspaceBackupDateTime(backup.created_at, deviceTz)}`;
  const currentIds = new Set(snapshot.jobs.map(job => job.id));
  const selectedIds = new Set(selectedSnapshot?.jobs.map(job => job.id) || []);
  const entriesRemoved = snapshot.jobs.filter(job => !selectedIds.has(job.id)).length;
  const entriesReturned = selectedSnapshot?.jobs.filter(job => !currentIds.has(job.id)).length || 0;
  const nextSlot = scheduledSlot(savedSettings, new Date(now), true);
  const scheduleNeedsTime = ["daily", "weekly", "monthly"].includes(draft.frequency);
  const controlsBusy = busy;
  const displayedProgress = progress;
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
  async function chooseBackup(backup: WorkspaceBackupSummary) {
    setSelectedBackupId(backup.id);
    setSelectedPayload(null);
    setBackupMenuOpen(false);
    backupMenuRef.current?.querySelector("button")?.focus();
    if (!ownerId) return;
    await run(async () => {
      const payload = await loadBackupPayload(backup.id, ownerId);
      if (payload === null) throw new Error("This backup is empty or could not be loaded.");
      validateWorkspaceBackup(payload);
      setSelectedPayload({ id: backup.id, payload });
    });
  }
  function backupMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedBackupIndex(index => Math.max(0, Math.min(menuBackups.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" && menuBackups[highlightedBackupIndex]) {
      event.preventDefault(); void chooseBackup(menuBackups[highlightedBackupIndex]);
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
    const runner = manualBackupRef.current;
    if (!ownerId || !canBackup || controlsBusy || runner.isRunning) return;
    setProgress(0);
    await run(async () => {
      try {
        const result = await runner.run(snapshot, savedSettings, ownerId, (done, total) => setProgress(Math.round(done / total * 100)));
        if (!result) return;
        setStatus(result); onToast(result); await refresh(true);
      } catch (error) { throw error; }
      finally { setProgress(null); }
    });
  }
  async function restoreBackup(backup: WorkspaceBackupSummary) {
    if (!ownerId || !canBackup || !backups.some(row => row.id === backup.id)) return;
    if (backup.backup_kind === "pre_restore" && undoRestoreBackup(backups)?.id !== backup.id) return;
    setRestoreTarget(null);
    await run(async () => {
      const payload = await loadBackupPayload(backup.id, ownerId);
      if (payload === null) throw new Error("This backup is empty or could not be loaded.");
      const restored = validateWorkspaceBackup(payload);
      validateWorkspaceBackup(snapshot);
      if ((await currentSession())?.user.id !== ownerId) throw new Error("ACCOUNT_CHANGED: sign in to the original account.");
      const dirty = readLedgerDirty(ownerId);
      if (dirty && !cloudSnapshotsEqual(dirty.snapshot, snapshot)) throw new Error("Workspace changed during restore. Retry with the latest data.");
      restoreWorkspaceSnapshot(restored, snapshot);
      onPauseAutosave(true); restoreStartedRef.current = true;
      const safety = await saveWorkspaceBackup(snapshot, "pre_restore", ownerId);
      await restoreCloud(restored, ownerId);
      if ((await currentSession())?.user.id !== ownerId) throw new Error("ACCOUNT_CHANGED: restore was saved to the original account. Sign in again.");
      onRestore(restored);
      restoreStartedRef.current = false;
      setSelectedBackupId(""); setSelectedPayload(null);
      setNow(Date.now());
      setBackups(previous => [{ id: safety.id, backup_kind: "pre_restore", created_at: safety.created_at, entry_count: snapshot.jobs.length, customer_count: new Set(snapshot.jobs.map(job => job.customer)).size }, ...previous]);
      setRestoreNotice(`Restored ✓ ${workspaceBackupFileName(backup.created_at, savedSettings.tz, backup.backup_kind === "pre_restore")}`);
      await refresh(true).catch(() => {});
    });
  }

  return <div className="cloud-settings backup-page">
    <div className="backup-page-intro"><div><h3>Backup</h3><p>Back up your whole workspace.</p></div></div>
    {!cloudConfigured ? <div className="notice">Cloud backup is not connected yet.</div> : checking ? <div className="notice">Checking your backup…</div> : !logged ? <><div className="notice">Sign in to use backups.</div><button className="google-sign-in" disabled={busy} onClick={() => void run(signInWithGoogle)}>Continue with Google</button></> : <>
      {backupLockReason && <div className="notice" role="status">{backupLockReason === "loading" ? "Loading your data…" : backupLockReason === "no-plan" ? "Backups need an active plan." : backupLockReason === "legacy" ? LEGACY_WORKSPACE_READ_ONLY_MESSAGE : <>This phone&apos;s data is different from your cloud data. <button type="button" className="outline" disabled={busy} onClick={() => setConfirmCloudData(true)}>Use cloud data</button></>}</div>}
      <section className="backup-simple-card backup-run-card">
        <strong>{last ? `✓ Last backup: ${backupLabel(last.created_at, savedSettings.tz, now)}` : "No regular backup yet."}</strong>
        {displayedProgress !== null && <div className="backup-progress" role="progressbar" aria-valuenow={displayedProgress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${displayedProgress}%` }} /></div>}
        {displayedProgress !== null && <small>Backing up… {displayedProgress}%</small>}
        <button type="button" className="primary backup-run-button" disabled={controlsBusy || !canBackup} onClick={() => void backUpNow()}>Back up now</button>
        <div className="backup-auto-card">
          <div className="backup-auto-summary"><strong>Auto backup: {["daily", "weekly", "monthly"].includes(savedSettings.frequency) ? `${savedSettings.frequency[0].toUpperCase()}${savedSettings.frequency.slice(1)} at ${timeLabel(savedSettings.time_of_day)}` : "Off"}</strong><button type="button" className="outline" aria-expanded={scheduleOpen} onClick={() => setScheduleOpen(value => !value)}>Change</button></div>
          {scheduleOpen && <div className="backup-auto-form"><label className="backup-auto-field">Repeat<SelectMenu aria-label="Repeat" value={draft.frequency} disabled={controlsBusy || !canBackup} onChange={value => setDraft(previous => ({ ...previous, frequency: value as BackupFrequency, time_of_day: null }))} options={[{value:"off",label:"Off"},{value:"manual",label:"Only when I tap Back up"},{value:"daily",label:"Daily"},{value:"weekly",label:"Weekly"},{value:"monthly",label:"Monthly"}]} /></label>{scheduleNeedsTime && <div className="backup-auto-field"><span>Backup time</span><ClockPicker value={draft.time_of_day} disabled={controlsBusy || !canBackup} onChange={value => setDraft(previous => ({ ...previous, time_of_day: value }))}/></div>}<button type="button" className="primary backup-auto-save" disabled={saveDisabled} onClick={() => void saveSettings()}>Save</button></div>}
          {nextSlot && <div className="backup-next-slot"><strong>Next backup: {dateLabel(nextSlot, savedSettings.tz, now)}</strong><small className="backup-next-help">Backups run automatically at this time, even when the app is closed.</small></div>}
        </div>
        <small>Kept for 30 days (up to 60). Photos are not included.</small>
      </section>
      <section className="backup-simple-card backup-restore-card"><strong>Restore from a backup</strong>
        {regularBackups.length ? <><div className="backup-picker" ref={backupMenuRef}>
          <button type="button" className="backup-picker-trigger" aria-label="Choose a backup" aria-haspopup="listbox" aria-expanded={backupMenuOpen} aria-controls="backup-picker-list" disabled={controlsBusy || !canBackup} onClick={() => { setHighlightedBackupIndex(Math.max(0, menuBackups.findIndex(backup => backup.id === selectedBackupId))); setBackupMenuOpen(open => !open); }} onKeyDown={event => { if (!backupMenuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setHighlightedBackupIndex(event.key === "ArrowDown" ? 0 : menuBackups.length - 1); setBackupMenuOpen(true); } }}><span>{selectedBackup ? `${restoreOptionLabel(selectedBackup)} · ${selectedBackup.entry_count} entries · ${selectedBackup.customer_count} customers` : "Select a backup…"}</span><span className={`backup-picker-chevron${backupMenuOpen ? " open" : ""}`} aria-hidden="true" /></button>
          {backupMenuOpen && <div className="backup-picker-panel"><div id="backup-picker-list" className="backup-picker-list" role="listbox" aria-label="Choose a backup" aria-activedescendant={`backup-picker-option-${highlightedBackupIndex}`} tabIndex={-1} ref={backupListRef} onKeyDown={backupMenuKeyDown}>
            <div className="backup-picker-group"><div className="backup-picker-heading">Regular backups</div>{regularBackups.map((backup, index) => { const selected = backup.id === selectedBackupId; return <div id={`backup-picker-option-${index}`} key={backup.id} data-backup-index={index} role="option" aria-selected={selected} className={`backup-picker-option${selected ? " selected" : ""}${index === highlightedBackupIndex ? " highlighted" : ""}`} onMouseEnter={() => setHighlightedBackupIndex(index)} onClick={() => void chooseBackup(backup)}><span>{restoreOptionLabel(backup)}</span><span className="backup-picker-option-meta">{backup.entry_count} entries · {backup.customer_count} customers{selected && <span className="backup-picker-check" aria-hidden="true">✓</span>}</span></div>; })}</div>
          </div></div>}
        </div>
          {selectedBackup && <div className="backup-restore-summary">This backup: {selectedSnapshot?.jobs.length ?? "?"} entries · {selectedSnapshot ? new Set(selectedSnapshot.jobs.map(job => job.customer)).size : "?"} customers. Now: {snapshot.jobs.length} entries.{entriesRemoved > 0 && <p>{entriesRemoved} entries added after this backup will be removed.</p>}{entriesReturned > 0 && <p>{entriesReturned} entries missing now will come back.</p>}</div>}
          <button type="button" className="primary backup-run-button" disabled={!selectedBackup || !selectedSnapshot || controlsBusy || !canBackup} onClick={() => selectedBackup && selectedSnapshot && setRestoreTarget(selectedBackup)}>Restore</button></> : <div className="notice">No backups yet. Tap Back up now.</div>}
        {undoBackup && <button type="button" className="outline" disabled={controlsBusy || !canBackup} onClick={() => setUndoConfirm(true)}>Undo last restore</button>}
      </section>
    </>}
    {restoreTarget && <div className="modal-backdrop backup-restore-confirm-backdrop"><section className="backup-restore-confirm" role="dialog" aria-modal="true" aria-labelledby="backup-restore-title"><button type="button" className="modal-close-x" aria-label="Close" onClick={() => setRestoreTarget(null)}>×</button><h2 id="backup-restore-title">Restore this backup?</h2><p>{workspaceBackupDateTime(restoreTarget.created_at, deviceTz)}</p><p>Now {snapshot.jobs.length} entries → Backup {restoreTarget.entry_count} entries.</p><small>A safety copy of your current data is saved first.</small><div className="backup-restore-confirm-actions"><button type="button" className="outline" onClick={() => setRestoreTarget(null)}>No</button><button type="button" className="primary" onClick={() => void restoreBackup(restoreTarget)}>Yes, restore</button></div></section></div>}
    {undoConfirm && undoBackup && <div className="modal-backdrop backup-restore-confirm-backdrop"><section className="backup-restore-confirm" role="dialog" aria-modal="true" aria-label="Undo last restore"><button type="button" className="modal-close-x" aria-label="Close" onClick={() => setUndoConfirm(false)}>×</button><p>Go back to how your data was before the last restore?</p><div className="backup-restore-confirm-actions"><button type="button" className="outline" onClick={() => setUndoConfirm(false)}>Cancel</button><button type="button" className="primary" disabled={controlsBusy || !canBackup} onClick={() => { setUndoConfirm(false); setRestoreNotice(""); void restoreBackup(undoBackup); }}>Undo restore</button></div></section></div>}
    {confirmCloudData && <div className="modal-backdrop backup-restore-confirm-backdrop"><section className="backup-restore-confirm" role="dialog" aria-modal="true" aria-label="Use cloud data"><button type="button" className="modal-close-x" aria-label="Close" disabled={busy} onClick={() => setConfirmCloudData(false)}>×</button><p>Changes made only on this phone will be lost.</p><div><button type="button" disabled={busy} onClick={() => setConfirmCloudData(false)}>No</button><button type="button" className="primary" disabled={busy} onClick={() => void run(async () => { await onUseCloudData(); setConfirmCloudData(false); setStatus("Cloud data loaded on this phone."); })}>Yes</button></div></section></div>}
    {restoreNotice && <p role="status">{restoreNotice} {undoBackup && <button type="button" disabled={controlsBusy || !canBackup} onClick={() => setUndoConfirm(true)}>Undo</button>}</p>}
    {status && <p role="status">{status}</p>}
  </div>;
}
