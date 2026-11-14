import { isSnapshot, type Snapshot } from "./data";

export type BackupFrequency = "off" | "manual" | "daily" | "weekly" | "monthly";
export type BackupSettings = { frequency: BackupFrequency; time_of_day: string | null; tz: string; anchor_day: number | null; customers: string[]; last_run_at: string | null };

export function validateWorkspaceBackup(value: unknown): Snapshot {
  if (!isSnapshot(value)) throw new Error("This workspace backup is damaged or invalid.");
  const jobs = new Set(value.jobs.map(job => job.id));
  const payments = value.payments || [];
  if (payments.some(payment => payment.jobId && !jobs.has(payment.jobId)) ||
      new Set(payments.map(payment => payment.id)).size !== payments.length) {
    throw new Error("This workspace backup has invalid payment links.");
  }
  return value;
}

export function restoreWorkspaceSnapshot(backup: unknown, current: unknown): Snapshot {
  const restored = validateWorkspaceBackup(backup);
  validateWorkspaceBackup(current);
  return restored;
}

export async function hashWorkspaceSnapshot(snapshot: Snapshot): Promise<string> {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(snapshot))));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function workspaceBackupDateTime(createdAt: string, tz: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(createdAt)).map(part => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${parts.dayPeriod.toLowerCase()}`;
}
export function workspaceBackupFileName(createdAt: string, tz: string, beforeRestore = false): string {
  return `${beforeRestore ? "Before restore" : "Pakki Baat backup"} ${workspaceBackupDateTime(createdAt, tz)}`;
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
  for (let offset = 0; offset <= 35; offset++) {
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
