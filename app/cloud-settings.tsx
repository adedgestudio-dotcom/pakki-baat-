"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cloudConfigured, cloudSnapshotsEqual, currentSession, deleteCustomerBackups, loadCustomerBackups, loadBackupSettings, loadReportLedger, readLedgerDirty, saveCloud, saveWorkspaceBackup, setBackupCustomers, setBackupSettings, signInWithGoogle, watchSession, type CustomerBackup } from "@/lib/cloud";
import { anchorDayForSave, customerNames, entriesAddedAfterBackup, hashCustomerSlice, restoreCustomer, scheduledSlot, sliceCustomer, validateCustomerSlice, type BackupFrequency, type BackupSettings } from "@/lib/customer-backup";
import { normalizeCustomerName } from "@/lib/customer-name";
import { isSnapshot, type Snapshot } from "@/lib/data";
import { runSelectedCustomerBackup } from "@/lib/workspace-daily-backup-lifecycle";

const emptySettings = (): BackupSettings => ({ frequency: "off", time_of_day: null, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", anchor_day: null, customers: [], last_run_at: null });
const dateLabel = (value: string | Date) => new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const sizeLabel = (value: unknown) => `${Math.max(1, Math.ceil(new TextEncoder().encode(JSON.stringify(value)).length / 1024))} KB`;

export default function CloudSettings({ snapshot, onRestore, onPauseAutosave, ownerId, canBackup }: { snapshot: Snapshot; onRestore: (snapshot: Snapshot) => void; onPauseAutosave: (paused: boolean) => void; ownerId: string | null; canBackup: boolean }) {
  const [logged, setLogged] = useState(false), [checking, setChecking] = useState(cloudConfigured), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(""), [query, setQuery] = useState(""), [restoreQuery, setRestoreQuery] = useState("");
  const [backups, setBackups] = useState<CustomerBackup[]>([]);
  const [draft, setDraft] = useState<BackupSettings>(emptySettings), [hashes, setHashes] = useState<Record<string, string>>({});
  const [restoreCustomers, setRestoreCustomers] = useState<string[]>([]), [days, setDays] = useState<"" | "7" | "15" | "30" | "custom">("");
  const [customFrom, setCustomFrom] = useState(""), [customTo, setCustomTo] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const requestRef = useRef(0), ownerRef = useRef(ownerId), restoreStartedRef = useRef(false);
  useEffect(() => { ownerRef.current = ownerId; const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, [ownerId]);

  const refresh = useCallback(async (preserveDraft = false) => {
    if (!ownerId) return;
    const request = ++requestRef.current;
    const [nextSettings, nextBackups] = await Promise.all([loadBackupSettings(ownerId), loadCustomerBackups(ownerId)]);
    if (request !== requestRef.current || ownerRef.current !== ownerId) return;
    setDraft(previous => preserveDraft ? { ...previous, last_run_at: nextSettings.last_run_at } : nextSettings); setBackups(nextBackups);
  }, [ownerId]);
  useEffect(() => {
    if (!cloudConfigured) return;
    void currentSession().then(session => { setLogged(session?.user.id === ownerId); if (session?.user.id === ownerId) void refresh(); }).catch(() => setStatus("Could not check your sign-in.")).finally(() => setChecking(false));
    return watchSession(session => { const same = session?.user.id === ownerId; setLogged(same); setChecking(false); if (same) void refresh(); else { ++requestRef.current; setBackups([]); setDraft(emptySettings()); } });
  }, [ownerId, refresh]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const name of customerNames(snapshot)) { const slice = sliceCustomer(snapshot, name); if (validateCustomerSlice(slice)) next[slice.customer_key] = await hashCustomerSlice(slice); }
      if (!cancelled) setHashes(next);
    })();
    return () => { cancelled = true; };
  }, [snapshot]);

  const names = [...new Map([...draft.customers.map(key => backups.find(row => row.customer_key === key)?.customer_name || key), ...customerNames(snapshot)].map(name => [normalizeCustomerName(name), name])).values()].sort((a, b) => a.localeCompare(b));
  const nameByKey = new Map(names.map(name => [normalizeCustomerName(name), name]));
  const latestByKey = new Map<string, CustomerBackup>();
  for (const backup of backups) if (!latestByKey.has(backup.customer_key)) latestByKey.set(backup.customer_key, backup);
  const selectedCopies = [...latestByKey.values()].filter(row => draft.customers.includes(row.customer_key));
  const last = backups.find(row => draft.customers.includes(row.customer_key));
  const nextSlot = scheduledSlot(draft, new Date(now), true);
  const scheduleNeedsTime = ["daily", "weekly", "monthly"].includes(draft.frequency);
  const saveDisabled = busy || !canBackup || draft.customers.length === 0 || scheduleNeedsTime && !draft.time_of_day;
  const visibleNames = names.filter(name => normalizeCustomerName(name).includes(normalizeCustomerName(query)));
  const restoreNames = [...new Map(backups.map(b => [b.customer_key, b.customer_name])).entries()].filter(([, name]) => normalizeCustomerName(name).includes(normalizeCustomerName(restoreQuery)));
  const filteredBackups = !restoreCustomers.length && !days ? [] : backups.filter(b => {
    if (restoreCustomers.length && !restoreCustomers.includes(b.customer_key)) return false;
    const date = Date.parse(b.created_at);
    if (days === "custom") return (!customFrom || date >= Date.parse(customFrom)) && (!customTo || date < Date.parse(customTo) + 86400000);
    return !days || date >= now - Number(days) * 86400000;
  });

  async function run(action: () => Promise<void>) {
    setBusy(true); setStatus("");
    try { await action(); } catch (error) { if (restoreStartedRef.current) { onPauseAutosave(false); restoreStartedRef.current = false; } setStatus(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }
  async function saveSettings() {
    if (!ownerId || saveDisabled) return;
    await run(async () => {
      const next = { ...draft, anchor_day: anchorDayForSave(draft.frequency, draft.tz) };
      await setBackupSettings(next, ownerId);
      setDraft(next); setStatus("Backup settings saved.");
    });
  }
  async function backUpNow() {
    if (!ownerId || !canBackup || !draft.customers.length) return;
    await run(async () => { await setBackupCustomers(draft.customers, ownerId); setStatus(await runSelectedCustomerBackup(snapshot, draft, ownerId)); await refresh(true); });
  }
  async function selectAll() {
    if (!ownerId || !canBackup) return;
    const customers = names.map(normalizeCustomerName);
    await run(async () => { await setBackupCustomers(customers, ownerId); setDraft(previous => ({ ...previous, customers })); });
  }
  async function toggleCustomer(key: string) {
    if (draft.customers.includes(key)) {
      if (!confirm(`Stop backing up ${nameByKey.get(key) || key}? Existing backup copies for this customer will be deleted.`)) return;
      if (!ownerId) return;
      await run(async () => { await deleteCustomerBackups([key], ownerId); setBackups(rows => rows.filter(row => row.customer_key !== key)); setDraft(previous => { const customers = previous.customers.filter(item => item !== key); return customers.length ? { ...previous, customers } : { ...previous, customers, frequency: "off", time_of_day: null, anchor_day: null }; }); setStatus("Customer backup copies deleted."); });
    } else if (ownerId && canBackup) {
      const customers = [...draft.customers, key];
      await run(async () => { await setBackupCustomers(customers, ownerId); setDraft(previous => ({ ...previous, customers })); });
    }
  }
  async function restoreVersion(backup: CustomerBackup) {
    if (!ownerId || !canBackup || !backups.some(row => row.id === backup.id)) return;
    if (!validateCustomerSlice(backup.payload) || backup.customer_key !== backup.payload.customer_key || await hashCustomerSlice(backup.payload) !== backup.content_hash) { setStatus("This customer backup is damaged or invalid."); return; }
    const added = entriesAddedAfterBackup(snapshot, backup.payload);
    if (!confirm(`Restore ${backup.customer_name} from ${dateLabel(backup.created_at)}? ${added} entries added after this backup will be removed from ${backup.customer_name}. A safety copy is saved first.`)) return;
    await run(async () => {
      if ((await currentSession())?.user.id !== ownerId) throw new Error("ACCOUNT_CHANGED: sign in to the original account.");
      if (!isSnapshot(snapshot)) throw new Error("Current workspace could not be verified for a safety copy.");
      onPauseAutosave(true); restoreStartedRef.current = true;
      await saveWorkspaceBackup(snapshot, "pre_restore", ownerId);
      const dirty = readLedgerDirty(ownerId);
      if (dirty && !cloudSnapshotsEqual(dirty.snapshot, snapshot)) throw new Error("Workspace changed during restore. Retry with the latest data.");
      const ledger = await loadReportLedger(ownerId);
      const historicalJobs = new Set(ledger.map(row => row.job_id).filter((id): id is string => typeof id === "string"));
      const historicalPayments = new Set(ledger.flatMap(row => [row.metadata?.payment_id, row.metadata?.legacy_payment_id]).filter((id): id is string => typeof id === "string"));
      const restored = restoreCustomer(snapshot, backup.payload, historicalJobs, historicalPayments);
      if (!isSnapshot(restored.snapshot)) throw new Error("Restored customer data is invalid.");
      await saveCloud(restored.snapshot, ownerId);
      if ((await currentSession())?.user.id !== ownerId) throw new Error("ACCOUNT_CHANGED: restore was saved to the original account. Sign in again.");
      onRestore(restored.snapshot);
      restoreStartedRef.current = false;
      setStatus(`Customer restored. ${restored.copiedJobs} entries restored as new copies${restored.copiedJobs ? ". Photos won't re-link for those." : "."}`);
    });
  }

  return <div className="cloud-settings backup-page">
    <div className="backup-page-intro"><div><h3>Backup</h3><p>Choose the customers you want to protect.</p></div></div>
    {!cloudConfigured ? <div className="notice">Cloud backup is not connected yet.</div> : checking ? <div className="notice">Checking your backup…</div> : !logged ? <><div className="notice">Sign in to use customer backups.</div><button className="google-sign-in" disabled={busy} onClick={() => void run(signInWithGoogle)}>Continue with Google</button></> : <>
      <section className="backup-simple-card"><span><strong>{last ? `Last backup: ${dateLabel(last.created_at)} · ${sizeLabel(selectedCopies.map(row => row.payload))}` : "Last backup: None yet"}</strong><small>Photos are not part of backups.</small></span><button type="button" className="primary" disabled={busy || !canBackup || !draft.customers.length} onClick={() => void backUpNow()}>Back up</button></section>
      <section className="backup-history"><div><strong>Customers to back up</strong><small>Choose at least one customer.</small></div><input type="search" aria-label="Search customers to back up" placeholder="Search customers" value={query} onChange={event => setQuery(event.target.value)}/><button type="button" className="outline" disabled={busy || !canBackup || !names.length} onClick={() => void selectAll()}>Select all</button>
        {visibleNames.map(name => { const key = normalizeCustomerName(name), latest = latestByKey.get(key); const state = !latest ? "Not backed up" : hashes[key] === latest.content_hash ? "Backed up" : "Changed since backup"; return <label className="backup-history-row" key={key}><span><strong>{name}</strong><small>{state}</small></span><input type="checkbox" checked={draft.customers.includes(key)} disabled={busy || !canBackup} onChange={() => void toggleCustomer(key)}/></label>; })}
      </section>
      <section className="backup-simple-card"><span><strong>Automatic backups</strong><small>Choose when Pakki Baat makes customer copies.</small></span><div><select aria-label="Automatic backups" value={draft.frequency} disabled={busy || !canBackup} onChange={event => setDraft(previous => ({ ...previous, frequency: event.target.value as BackupFrequency, time_of_day: null }))}><option value="off">Off</option><option value="manual">Only when I tap Back up</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>{scheduleNeedsTime && <label>Backup time <input type="time" value={draft.time_of_day || ""} onChange={event => setDraft(previous => ({ ...previous, time_of_day: event.target.value || null }))}/></label>}<button type="button" className="primary" disabled={saveDisabled} onClick={() => void saveSettings()}>Save</button></div>{nextSlot && <div><strong>Next backup: {dateLabel(nextSlot)}</strong><small style={{ display: "block", color: "#728075" }}>Keep the app open at backup time. If closed, it runs when you next open it.</small></div>}</section>
      <section className="backup-history"><div><strong>Restore a customer</strong><small>Only the selected customer is replaced.</small></div><input type="search" aria-label="Search restore customers" placeholder="Search customers" value={restoreQuery} onChange={event => setRestoreQuery(event.target.value)}/><div>{restoreNames.map(([key, name]) => <label key={key} style={{ marginRight: 12 }}><input type="checkbox" checked={restoreCustomers.includes(key)} onChange={() => setRestoreCustomers(previous => previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key])}/>{name}</label>)}</div><label>Days <select aria-label="Restore days" value={days} onChange={event => setDays(event.target.value as typeof days)}><option value="">Choose days</option><option value="7">7 days</option><option value="15">15 days</option><option value="30">30 days</option><option value="custom">Custom</option></select></label>{days === "custom" && <div><input type="date" aria-label="From date" value={customFrom} onChange={event => setCustomFrom(event.target.value)}/><input type="date" aria-label="To date" value={customTo} onChange={event => setCustomTo(event.target.value)}/></div>}
        {filteredBackups.map(backup => { const slice = backup.payload; const total = slice.jobs.reduce((sum, job) => sum + job.total, 0), pending = slice.jobs.reduce((sum, job) => sum + job.total - job.paid, 0); return <div className="backup-history-row" key={backup.id}><span><strong>{backup.customer_name} · {dateLabel(backup.created_at)}</strong><small>{slice.jobs.length} entries · Total ₹{total.toLocaleString("en-IN")} · Pending ₹{pending.toLocaleString("en-IN")}</small></span><button type="button" className="outline" disabled={busy || !canBackup} onClick={() => void restoreVersion(backup)}>Restore</button></div>; })}
        {!restoreCustomers.length && !days && <div className="notice">Choose a customer or days to see backup versions.</div>}
      </section>
    </>}
    {status && <p role="status">{status}</p>}
  </div>;
}
