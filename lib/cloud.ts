import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { isSnapshot, type Snapshot } from "./data";
import { acknowledgePendingWorkspaceJournal, isPendingWorkspaceJournal, type PendingWorkspaceJournal } from "./workspace-journal";
import { canonicalWorkspaceSnapshotDigest, verifyWorkspaceBackupConfirmation, type VerifiedWorkspaceBackupConfirmation } from "./verified-workspace-backup";

let base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
let key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
let client: SupabaseClient | null = base && key ? createClient(base, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;
let configPromise: Promise<SupabaseClient | null> | null = null;

export const cloudConfigured = true;

function makeClient() {
  if (!base || !key) return null;
  client ||= createClient(base, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

async function loadRuntimeConfig() {
  if (client) return client;
  if (typeof window === "undefined") return makeClient();
  configPromise ||= fetch("/api/public-config", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return null;
      const config = await response.json();
      base = String(config.supabaseUrl || base || "");
      key = String(config.supabaseAnonKey || key || "");
      return makeClient();
    })
    .catch(() => null);
  return configPromise;
}

async function configuredClient() {
  const ready = await loadRuntimeConfig();
  if (!ready) throw new Error("Cloud connection is not configured yet.");
  return ready;
}

export async function signInWithGoogle() {
  const { error } = await (await configuredClient()).auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + "/" },
  });
  if (error) throw error;
}

export async function signInWithPassword(email: string, password: string) {
  const { data, error } = await (await configuredClient()).auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  return data.session;
}

export async function currentSession() {
  const ready = await loadRuntimeConfig();
  if (!ready) return null;
  const { data, error } = await ready.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function watchSession(onChange: (session: Session | null) => void) {
  let unsubscribe = () => {};
  void loadRuntimeConfig().then((ready) => {
    if (!ready) return;
    const { data } = ready.auth.onAuthStateChange((_event, session) => onChange(session));
    unsubscribe = () => data.subscription.unsubscribe();
  });
  return () => unsubscribe();
}

export async function cloudToken() {
  const session = await currentSession();
  if (!session) throw new Error("Continue with Google in Settings to use AI.");
  return session.access_token;
}

class CloudRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}
export function isRetryableCloudError(error: unknown) {
  if (error instanceof CloudRequestError) return error.status >= 500;
  if (error instanceof Error && /^(INVALID_|ACCOUNT_CHANGED|WORKSPACE_REVISION_CONFLICT|LEDGER_|JOB_|PAYMENT_|CHARGE_|REUSED_)/.test(error.message)) return false;
  return true;
}

async function request(path: string, body?: unknown, token?: string) {
  await configuredClient();
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { apikey: key, "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  const result = raw ? JSON.parse(raw) : null;
  if (!response.ok) throw new CloudRequestError(result?.message || result?.error_description || result?.msg || "Cloud request failed.", response.status, result?.code);
  return result;
}

export type CloudWorkspaceState = { ownerId: string; snapshot: unknown; revision: number | null; ledgerEnabled: boolean };
type SaveState = { revision: number | null; ledgerEnabled: boolean; tail: Promise<unknown>; uncertain: { payload: unknown; revision: number } | null; conflict: boolean };
const saveStates = new Map<string, SaveState>();

/** A save result tied to the exact payload submitted by this caller. */
export type CloudWorkspaceSaveAcknowledgment = { ownerId: string; snapshot: Snapshot; revision: number | null };
export type JournalCloudSaveResult =
  | { status: "acknowledged"; acknowledgment: CloudWorkspaceSaveAcknowledgment }
  | { status: "pending"; reason: string }
  | { status: "conflict"; reason: string }
  | { status: "manual"; reason: string }
  | { status: "account-changed"; reason: string };
/**
 * Journal-only transport result. Unlike savePendingWorkspaceJournal this does
 * not alter local storage: a coordinator must validate and acknowledge the
 * exact journal it submitted.
 */
export type JournalRevisionedTransportResult =
  | { status: "cloud-acknowledged"; acknowledgment: CloudWorkspaceSaveAcknowledgment }
  | { status: "offline" | "ambiguous" | "pending" | "conflict" | "manual" | "account-changed"; reason: string };
type SaveCloudOptions = { expectedRevision?: number };

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right))
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equalJson(value === undefined ? null : value, right[index] === undefined ? null : right[index]));
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && equalJson(a[key], b[key]));
}

const dirtyKey = (ownerId: string) => `pakki-baat-ledger-dirty:${ownerId}`;
export function readLedgerDirty(ownerId: string): { snapshot: Snapshot; revision: number } | null {
  try {
    const raw = localStorage.getItem(dirtyKey(ownerId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as { snapshot?: unknown; revision?: unknown };
    if (!isSnapshot(record.snapshot) || !Number.isSafeInteger(record.revision) || Number(record.revision) < 0) return null;
    return { snapshot: record.snapshot, revision: Number(record.revision) };
  } catch { return null; }
}

export function markLedgerDirty(ownerId: string, snapshot: Snapshot, baseRevision?: number) {
  const state = saveStates.get(ownerId);
  if (!state?.ledgerEnabled || !state.revision) return;
  try {
    const existing = readLedgerDirty(ownerId);
    localStorage.setItem(dirtyKey(ownerId), JSON.stringify({ snapshot, revision: existing?.revision ?? baseRevision ?? state.revision }));
  } catch { throw new Error("Cannot safely save an offline ledger change on this device."); }
}

export function clearLedgerDirty(ownerId: string, saved?: unknown) {
  const dirty = readLedgerDirty(ownerId);
  if (!saved || (dirty && equalJson(dirty.snapshot, saved))) localStorage.removeItem(dirtyKey(ownerId));
}

async function accountSession(ownerId?: string) {
  const session = await currentSession();
  if (!session || (ownerId && session.user.id !== ownerId)) throw new Error("ACCOUNT_CHANGED: sign in to the correct account before saving.");
  return session;
}

export async function loadCloudState(): Promise<CloudWorkspaceState> {
  const session = await accountSession();
  const ownerId = session.user.id;
  let modes: { enabled?: boolean }[];
  try {
    modes = await request("/rest/v1/workspace_ledger_modes?select=enabled", undefined, session.access_token);
  } catch (error) {
    // A pre-Phase-1C-A production schema has no mode table. Other failures
    // must fail closed rather than treating an unreadable flag as disabled.
    if (!(error instanceof CloudRequestError) || !["PGRST205", "42P01"].includes(error.code || "") || !error.message.includes("workspace_ledger_modes")) throw error;
    modes = [];
  }
  await accountSession(ownerId);
  const ledgerEnabled = modes[0]?.enabled === true;
  // Payload and revision must come from one row read. Separate requests could
  // pair an old snapshot with a newer revision and overwrite another device.
  const rows = await request(ledgerEnabled
    ? "/rest/v1/workspaces?select=payload,revision"
    : "/rest/v1/workspaces?select=payload", undefined, session.access_token);
  await accountSession(ownerId);
  const revision = rows[0]?.revision;
  if (ledgerEnabled && (!Number.isSafeInteger(revision) || revision < 1)) throw new Error("LEDGER_WORKSPACE_REVISION_MISSING");
  const previous = saveStates.get(ownerId);
  saveStates.set(ownerId, { revision: Number.isSafeInteger(revision) ? revision : null, ledgerEnabled, tail: previous?.tail ?? Promise.resolve(), uncertain: null, conflict: false });
  return { ownerId, snapshot: rows[0]?.payload ?? null, revision: Number.isSafeInteger(revision) ? revision : null, ledgerEnabled };
}

export function ledgerModeForAccount(ownerId: string) { return saveStates.get(ownerId)?.ledgerEnabled === true; }
/** The revision observed during the current authenticated workspace hydration. */
export function workspaceRevisionForAccount(ownerId: string): number | null {
  const state = saveStates.get(ownerId);
  return state?.ledgerEnabled && Number.isSafeInteger(state.revision) ? state.revision : null;
}
export function cloudSnapshotsEqual(a: unknown, b: unknown) { return equalJson(a, b); }
export function reconcileLedgerHydration(server: Snapshot, revision: number, local: Snapshot | null, dirty: { snapshot: Snapshot; revision: number } | null) {
  if (dirty) {
    if (equalJson(dirty.snapshot, server)) return { snapshot: server, conflict: false, markUnknown: false, clearDirty: true };
    return { snapshot: dirty.snapshot, conflict: dirty.revision !== revision, markUnknown: false, clearDirty: false };
  }
  if (local && !equalJson(local, server)) return { snapshot: local, conflict: true, markUnknown: true, clearDirty: false };
  return { snapshot: server, conflict: false, markUnknown: false, clearDirty: false };
}
export function blockCloudSaves(ownerId: string) {
  const state = saveStates.get(ownerId);
  if (state?.ledgerEnabled) state.conflict = true;
}

export async function saveCloud(snapshot: unknown, expectedOwnerId?: string, options?: SaveCloudOptions): Promise<CloudWorkspaceSaveAcknowledgment> {
  const session = await accountSession(expectedOwnerId);
  const ownerId = session.user.id;
  if (!saveStates.has(ownerId)) await loadCloudState();
  const foundState = saveStates.get(ownerId);
  if (!foundState) throw new Error("Cloud workspace state is unavailable.");
  const state: SaveState = foundState;
  const operation = state.tail.catch(() => {}).then(async () => {
    if (state.conflict) throw new Error("WORKSPACE_REVISION_CONFLICT: cloud data changed. Your local copy was kept; reload only after resolving the conflict.");
    const current = await accountSession(ownerId);
    if (!state.ledgerEnabled) {
      await request("/rest/v1/rpc/save_workspace", { payload: snapshot }, current.access_token);
      await accountSession(ownerId);
      if (!isSnapshot(snapshot)) throw new Error("INVALID_WORKSPACE_SNAPSHOT");
      return { ownerId, snapshot, revision: null };
    }
    if (!isSnapshot(snapshot) || !state.revision) throw new Error("INVALID_LEDGER_WORKSPACE_SNAPSHOT");
    async function atomicSave(payload: unknown, revision: number) {
      let reply: unknown;
      try {
        reply = await request("/rest/v1/rpc/save_workspace_with_ledger", { payload, expected_revision: revision }, (await accountSession(ownerId)).access_token);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("WORKSPACE_REVISION_CONFLICT")) state.conflict = true;
        else if (isRetryableCloudError(error)) state.uncertain = { payload, revision };
        throw error;
      }
      const next = (reply as { revision?: unknown })?.revision;
      if (!Number.isSafeInteger(next) || Number(next) < revision) throw new Error("INVALID_LEDGER_SAVE_RESPONSE");
      state.revision = Number(next);
      state.uncertain = null;
    }
    let retriedExactExpectedPayload = false;
    if (state.uncertain) {
      const pending = state.uncertain;
      await atomicSave(pending.payload, pending.revision);
      retriedExactExpectedPayload = options?.expectedRevision === pending.revision && equalJson(pending.payload, snapshot);
    }
    if (options?.expectedRevision !== undefined && !retriedExactExpectedPayload && state.revision !== options.expectedRevision) {
      throw new Error("WORKSPACE_REVISION_CONFLICT: cloud revision changed before the pending journal could be saved.");
    }
    if (!retriedExactExpectedPayload) await atomicSave(snapshot, state.revision);
    await accountSession(ownerId);
    clearLedgerDirty(ownerId, snapshot);
    return { ownerId, snapshot, revision: state.revision };
  });
  state.tail = operation;
  return operation;
}

function journalFailure(error: unknown): JournalRevisionedTransportResult {
  const message = error instanceof Error ? error.message : "Cloud save could not be confirmed.";
  if (message.startsWith("ACCOUNT_CHANGED")) return { status: "account-changed", reason: message };
  if (message.startsWith("WORKSPACE_REVISION_CONFLICT")) return { status: "conflict", reason: message };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { status: "offline", reason: message };
  if (isRetryableCloudError(error)) return { status: "ambiguous", reason: message };
  return { status: "pending", reason: message };
}

/**
 * Narrow journal-only transport. The shared saveCloud primitive remains
 * private to this module; guarded callers receive no generic saveCloud API.
 * This function deliberately does not clear the local journal.
 */
export async function uploadRevisionedWorkspaceJournal(journal: unknown, expectedOwnerId?: string): Promise<JournalRevisionedTransportResult> {
  if (!isPendingWorkspaceJournal(journal)) return { status: "conflict", reason: "Pending workspace journal is invalid or does not belong to this account." };
  if (expectedOwnerId && journal.ownerId !== expectedOwnerId) return { status: "account-changed", reason: "Pending workspace journal belongs to a different account." };
  if (journal.syncStrategy !== "revisioned" || journal.baseRevision === null) {
    return { status: "manual", reason: "This pending workspace journal has no safe cloud revision and cannot be auto-uploaded." };
  }
  try {
    const before = await accountSession(journal.ownerId);
    if (!saveStates.has(journal.ownerId)) await loadCloudState();
    const state = saveStates.get(journal.ownerId);
    // A revisioned journal must never fall through to the old last-write-wins
    // RPC if ledger mode is unavailable or disabled.
    if (!state?.ledgerEnabled || state.revision === null) {
      return { status: "pending", reason: "Cloud ledger revision is unavailable; the pending journal was not uploaded." };
    }
    const acknowledgment = await saveCloud(journal.snapshot, before.user.id, { expectedRevision: journal.baseRevision });
    const after = await accountSession(journal.ownerId);
    if (after.user.id !== acknowledgment.ownerId || acknowledgment.ownerId !== journal.ownerId
      || !equalJson(acknowledgment.snapshot, journal.snapshot) || acknowledgment.revision === null) {
      return { status: "pending", reason: "Cloud save response could not be matched to the pending journal." };
    }
    return { status: "cloud-acknowledged", acknowledgment };
  } catch (error) {
    return journalFailure(error);
  }
}

/**
 * Backwards-compatible journal helper. New guarded code should use the
 * coordinator with uploadRevisionedWorkspaceJournal so local acknowledgment
 * and reducer handoff remain explicit.
 */
export async function savePendingWorkspaceJournal(journal: unknown, expectedOwnerId?: string): Promise<JournalCloudSaveResult> {
  const uploaded = await uploadRevisionedWorkspaceJournal(journal, expectedOwnerId);
  if (uploaded.status !== "cloud-acknowledged") {
    if (uploaded.status === "offline" || uploaded.status === "ambiguous") return { status: "pending", reason: uploaded.reason };
    if (uploaded.status === "pending") return { status: "pending", reason: uploaded.reason };
    if (uploaded.status === "conflict") return { status: "conflict", reason: uploaded.reason };
    if (uploaded.status === "manual") return { status: "manual", reason: uploaded.reason };
    return { status: "account-changed", reason: uploaded.reason };
  }
  const pending = journal as PendingWorkspaceJournal;
  try {
    acknowledgePendingWorkspaceJournal(pending.ownerId, pending, uploaded.acknowledgment.snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pending journal acknowledgment could not be stored.";
    return { status: "pending", reason: message };
  }
  return { status: "acknowledged", acknowledgment: uploaded.acknowledgment };
}

export async function loadCloud(expectedOwnerId?: string) {
  const session = await accountSession(expectedOwnerId);
  const pending = saveStates.get(session.user.id)?.tail;
  if (pending) await pending.catch(() => {});
  const rows = await request("/rest/v1/workspaces?select=payload", undefined, session.access_token);
  await accountSession(session.user.id);
  return rows[0]?.payload || null;
}

export type WorkspaceBackup = {
  id: string;
  payload: unknown;
  backup_kind: "daily" | "pre_restore";
  backup_day: string;
  created_at: string;
};

export async function saveWorkspaceBackup(snapshot: unknown, kind: "daily" | "pre_restore" = "daily", expectedOwnerId?: string) {
  const session = await accountSession(expectedOwnerId);
  await request("/rest/v1/rpc/save_workspace_backup", { payload: snapshot, kind }, session.access_token);
}

/**
 * Isolated verified-backup path for the future guarded reducer. Legacy callers
 * must continue using saveWorkspaceBackup until their workflows are migrated.
 */
export async function saveVerifiedWorkspaceBackup(snapshot: Snapshot, kind: "daily" | "pre_restore" = "pre_restore", expectedOwnerId?: string): Promise<VerifiedWorkspaceBackupConfirmation> {
  if (!isSnapshot(snapshot)) throw new Error("INVALID_WORKSPACE_SNAPSHOT");
  const session = await accountSession(expectedOwnerId);
  const ownerId = session.user.id;
  // Calculate before requesting the server write so unsupported canonical forms
  // fail before a backup could be created but not independently verified.
  await canonicalWorkspaceSnapshotDigest(snapshot);
  const reply = await request("/rest/v1/rpc/save_workspace_backup_verified", { payload: snapshot, kind }, session.access_token);
  await accountSession(ownerId);
  const row = Array.isArray(reply) ? reply[0] : reply;
  return verifyWorkspaceBackupConfirmation(snapshot, ownerId, kind, row);
}

export async function loadWorkspaceBackups(expectedOwnerId?: string): Promise<WorkspaceBackup[]> {
  const session = await accountSession(expectedOwnerId);
  const rows = await request(
    "/rest/v1/workspace_backups?select=id,payload,backup_kind,backup_day,created_at&order=created_at.desc&limit=120",
    undefined,
    session.access_token
  );
  await accountSession(session.user.id);
  return rows;
}

export async function loadWorkspaceBackupRetention(): Promise<15 | 30 | null> {
  const rows = await request(
    "/rest/v1/workspace_backup_preferences?select=retention_days",
    undefined,
    await cloudToken()
  );
  return rows[0]?.retention_days === 30 ? 30 : rows[0]?.retention_days === 15 ? 15 : null;
}

export async function setWorkspaceBackupRetention(days: 15 | 30) {
  await request("/rest/v1/rpc/set_workspace_backup_retention", { days }, await cloudToken());
}

export type SubscriptionInfo = {
  plan: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  bonus_voice_seconds?: number;
};

export async function loadServerTime(): Promise<number> {
  const token = await cloudToken();
  const response = await fetch("/api/server-time", {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.serverNow) throw new Error(result?.error || "Could not load server time.");
  const serverMs = new Date(result.serverNow).getTime();
  if (!Number.isFinite(serverMs)) throw new Error("Invalid server time.");
  return serverMs;
}

export async function loadSubscription(): Promise<SubscriptionInfo | null> {
  const rows = await request(
    "/rest/v1/subscriptions?select=plan,status,period_start,period_end,bonus_voice_seconds",
    undefined,
    await cloudToken()
  );
  return rows[0] || null;
}

export type VoiceUsageInfo = {
  voice_seconds: number;
};

export async function loadVoiceUsage(): Promise<VoiceUsageInfo> {
  const token = await cloudToken();
  const response = await fetch("/api/voice-usage", {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || "Could not load voice usage.");
  return { voice_seconds: Math.max(0, Number(result?.voice_seconds || 0)) };
}

function trialDeviceSignature() {
  const nav = navigator;
  const screenInfo = window.screen;
  return [
    nav.userAgent,
    nav.platform || "",
    nav.language || "",
    String(nav.hardwareConcurrency || ""),
    String(nav.maxTouchPoints || ""),
    String(screenInfo?.width || ""),
    String(screenInfo?.height || ""),
    String(screenInfo?.colorDepth || ""),
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
  ].join("|");
}

export async function claimFreeTrial() {
  if (typeof window === "undefined") return { allowed: true, reason: "server" };
  const storageKey = "pakki-baat-device-id-v1";
  let deviceId = localStorage.getItem(storageKey);
  if (!deviceId) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    deviceId = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(storageKey, deviceId);
  }
  const token = await cloudToken();
  const response = await fetch("/api/trial/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ deviceId, deviceSignature: trialDeviceSignature() }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || "Could not check free trial.");
  return result as { allowed: boolean; reason: string };
}

export async function signOut() {
  const { error } = await (await configuredClient()).auth.signOut();
  if (error) throw error;
}
