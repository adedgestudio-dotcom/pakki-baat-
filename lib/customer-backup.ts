import { normalizeCustomerName } from "./customer-name";
import type { CustomerNote, Job, Payment, Reminder, Snapshot } from "./data";

export type BackupFrequency = "off" | "manual" | "daily" | "weekly" | "monthly";
export type BackupSettings = { frequency: BackupFrequency; time_of_day: string | null; tz: string; anchor_day: number | null; customers: string[]; last_run_at: string | null };
export type CustomerSlice = { customer_key: string; customer_name: string; jobs: Job[]; payments: Payment[]; notes: CustomerNote[]; reminders: Reminder[]; phone: string | null };
export type CustomerBackupItem = { customer_key: string; customer_name: string; payload: CustomerSlice; content_hash: string };

const keyOf = (name: string) => normalizeCustomerName(name);
export function customerNames(snapshot: Snapshot): string[] {
  const names = [...snapshot.jobs.map(j => j.customer), ...(snapshot.payments || []).map(p => p.customer), ...(snapshot.notes || []).map(n => n.customer), ...(snapshot.reminders || []).map(r => r.customer || ""), ...Object.keys(snapshot.customerPhones || {})];
  const byKey = new Map<string, string>();
  for (const name of names) if (keyOf(name) && !byKey.has(keyOf(name))) byKey.set(keyOf(name), name);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}
export function sliceCustomer(snapshot: Snapshot, name: string): CustomerSlice {
  const customer_key = keyOf(name);
  const customer_name = customerNames(snapshot).find(candidate => keyOf(candidate) === customer_key) || name;
  const jobs = snapshot.jobs.filter(j => keyOf(j.customer) === customer_key);
  const payments = (snapshot.payments || []).filter(p => keyOf(p.customer) === customer_key);
  const notes = (snapshot.notes || []).filter(n => keyOf(n.customer) === customer_key);
  const reminders = (snapshot.reminders || []).filter(r => keyOf(r.customer || "") === customer_key);
  const phoneKey = Object.keys(snapshot.customerPhones || {}).find(k => keyOf(k) === customer_key);
  return { customer_key, customer_name, jobs, payments, notes, reminders, phone: phoneKey ? snapshot.customerPhones![phoneKey] : null };
}
const validDate = (value: unknown, optional = false) => typeof value === "string" && (optional && !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().startsWith(value));
const validTimestamp = (value: unknown, optional = false) => optional && (value === undefined || value === "") || typeof value === "string" && !Number.isNaN(Date.parse(value));
export function validateCustomerSlice(slice: CustomerSlice): boolean {
  if (!slice || !slice.customer_key || slice.customer_key !== keyOf(slice.customer_name) || !Array.isArray(slice.jobs) || !Array.isArray(slice.payments) || !Array.isArray(slice.notes) || !Array.isArray(slice.reminders)) return false;
  const ids = new Set<string>();
  const unique = (id: unknown) => { if (typeof id !== "string" || !id.trim() || ids.has(id)) return false; ids.add(id); return true; };
  if (!slice.jobs.every(j => j && unique(j.id) && keyOf(j.customer) === slice.customer_key && Number.isFinite(j.total) && j.total >= 0 && Number.isFinite(j.paid) && j.paid >= 0 && j.paid <= j.total && validDate(j.date, true) && validTimestamp(j.createdAt, true))) return false;
  const jobIds = new Set(slice.jobs.map(j => j.id));
  if (!slice.payments.every(p => p && unique(p.id) && keyOf(p.customer) === slice.customer_key && Number.isFinite(p.amount) && p.amount >= 0 && validDate(p.date) && validTimestamp(p.createdAt) && !!p.jobId && jobIds.has(p.jobId))) return false;
  if (!slice.notes.every(n => n && unique(n.id) && keyOf(n.customer) === slice.customer_key && validTimestamp(n.createdAt))) return false;
  if (!slice.reminders.every(r => r && unique(r.id) && keyOf(r.customer || "") === slice.customer_key && validDate(r.date) && validTimestamp(r.createdAt) && (!r.jobId || jobIds.has(r.jobId)))) return false;
  return slice.phone === null || typeof slice.phone === "string" && slice.phone.length <= 20;
}
export async function hashCustomerSlice(slice: CustomerSlice): Promise<string> {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)])) : value;
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(slice)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function prepareCustomerBackups(snapshot: Snapshot, selected: string[]): Promise<{ items: CustomerBackupItem[]; skipped: string[] }> {
  const names = new Map(customerNames(snapshot).map(name => [keyOf(name), name]));
  const items: CustomerBackupItem[] = [], skipped: string[] = [];
  for (const key of [...new Set(selected.map(keyOf))].sort()) {
    const name = names.get(key);
    if (!name) { skipped.push(key); continue; }
    const payload = sliceCustomer(snapshot, name);
    if (!validateCustomerSlice(payload)) { skipped.push(name); continue; }
    items.push({ customer_key: key, customer_name: name, payload, content_hash: await hashCustomerSlice(payload) });
  }
  return { items, skipped };
}

export function restoreCustomer(snapshot: Snapshot, slice: CustomerSlice, historicalJobIds = new Set<string>(), historicalPaymentIds = new Set<string>(), makeId = () => crypto.randomUUID()): { snapshot: Snapshot; copiedJobs: number } {
  if (!validateCustomerSlice(slice)) throw new Error("This customer backup is damaged or invalid.");
  const key = slice.customer_key;
  const currentJobs = snapshot.jobs.filter(j => keyOf(j.customer) === key);
  const currentPayments = (snapshot.payments || []).filter(p => keyOf(p.customer) === key);
  const currentJobIds = new Set(currentJobs.map(j => j.id));
  const currentPaymentIds = new Set(currentPayments.map(p => p.id));
  const otherJobs = snapshot.jobs.filter(j => keyOf(j.customer) !== key);
  const otherPayments = (snapshot.payments || []).filter(p => keyOf(p.customer) !== key);
  const used = new Set([...otherJobs, ...otherPayments, ...(snapshot.notes || []).filter(n => keyOf(n.customer) !== key), ...(snapshot.reminders || []).filter(r => keyOf(r.customer || "") !== key)].map(item => item.id));
  const fresh = () => { let id: string; do { id = makeId(); } while (!id || used.has(id)); used.add(id); return id; };
  const remapped = new Map<string, string>();
  let copiedJobs = 0;
  const jobs = slice.jobs.map(j => { const copy = !currentJobIds.has(j.id) && historicalJobIds.has(j.id); const id = copy || used.has(j.id) ? fresh() : j.id; used.add(id); if (id !== j.id) { remapped.set(j.id, id); copiedJobs++; } return { ...j, id }; });
  const payments = slice.payments.map(p => { const id = !currentPaymentIds.has(p.id) && historicalPaymentIds.has(p.id) || used.has(p.id) ? fresh() : p.id; used.add(id); return { ...p, id, jobId: remapped.get(p.jobId!) || p.jobId }; });
  const notes = slice.notes.map(n => { const id = used.has(n.id) ? fresh() : n.id; used.add(id); return { ...n, id }; });
  const reminders = slice.reminders.map(r => { const id = used.has(r.id) ? fresh() : r.id; used.add(id); return { ...r, id, jobId: r.jobId ? remapped.get(r.jobId) || r.jobId : undefined }; });
  const customerPhones = Object.fromEntries(Object.entries(snapshot.customerPhones || {}).filter(([name]) => keyOf(name) !== key));
  if (slice.phone !== null) customerPhones[slice.customer_name] = slice.phone;
  return { snapshot: { ...snapshot, jobs: [...otherJobs, ...jobs], payments: [...otherPayments, ...payments], notes: [...(snapshot.notes || []).filter(n => keyOf(n.customer) !== key), ...notes], reminders: [...(snapshot.reminders || []).filter(r => keyOf(r.customer || "") !== key), ...reminders], customerPhones }, copiedJobs };
}

function zonedParts(date: Date, tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map(p => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}
export function anchorDayForSave(frequency: BackupFrequency, tz: string, now = new Date()): number | null {
  const local = zonedParts(now, tz);
  if (frequency === "monthly") return Math.min(28, local.day);
  if (frequency === "weekly") return new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  return null;
}
function localSlotUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string) {
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let value = desired;
  for (let i = 0; i < 4; i++) { const p = zonedParts(new Date(value), tz); const actual = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute); value += desired - actual; }
  // A spring-forward wall time may not exist. Run at the next matching minute.
  for (let i = 0; i < 3; i++) { const p = zonedParts(new Date(value), tz); if (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) >= desired) break; value += 60_000 * 60; }
  return new Date(value);
}
export function scheduledSlot(settings: BackupSettings, now = new Date(), next = false): Date | null {
  if (!settings.time_of_day || !["daily", "weekly", "monthly"].includes(settings.frequency)) return null;
  const match = /^(\d{2}):(\d{2})/.exec(settings.time_of_day);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const today = zonedParts(now, settings.tz);
  for (let offset = next ? 0 : 0; offset <= 35; offset++) {
    const local = new Date(Date.UTC(today.year, today.month - 1, today.day + (next ? offset : -offset)));
    const day = local.getUTCDate();
    if (settings.frequency === "weekly" && local.getUTCDay() !== settings.anchor_day || settings.frequency === "monthly" && day !== settings.anchor_day) continue;
    const slot = localSlotUtc(local.getUTCFullYear(), local.getUTCMonth() + 1, day, hour, minute, settings.tz);
    if (next ? slot > now : slot <= now) return slot;
  }
  return null;
}
export function backupDue(settings: BackupSettings, now = new Date()) {
  const slot = scheduledSlot(settings, now);
  return slot && (!settings.last_run_at || Date.parse(settings.last_run_at) < slot.getTime()) ? slot : null;
}
