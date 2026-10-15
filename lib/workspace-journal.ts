import { isSnapshot, type Snapshot } from "./data";

const JOURNAL_VERSION = 1;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PendingWorkspaceJournal = {
  version: typeof JOURNAL_VERSION;
  ownerId: string;
  baseRevision: number | null;
  /** `manual` journals must never be auto-synced until Phase 2 supplies a revision protocol. */
  syncStrategy: "revisioned" | "manual";
  operationId: string;
  createdAt: string;
  snapshot: Snapshot;
};

export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class WorkspaceJournalError extends Error {
  constructor(message: string, readonly code: "INVALID_JOURNAL" | "STORAGE_UNAVAILABLE" | "STORAGE_WRITE_FAILED" | "ACKNOWLEDGMENT_REJECTED") {
    super(message);
  }
}

const workspaceKey = (ownerId: string) => `pakki-baat-workspace:${ownerId}`;
const pendingKey = (ownerId: string) => `pakki-baat-workspace-pending:${ownerId}`;

export function localWorkspaceStorageKey(ownerId: string) {
  return workspaceKey(ownerId);
}

export function pendingWorkspaceJournalKey(ownerId: string) {
  return pendingKey(ownerId);
}

function validOwnerId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isPendingWorkspaceJournal(value: unknown): value is PendingWorkspaceJournal {
  if (!value || typeof value !== "object") return false;
  const journal = value as Partial<PendingWorkspaceJournal>;
  return journal.version === JOURNAL_VERSION
    && validOwnerId(journal.ownerId)
    && ((journal.syncStrategy === "revisioned" && Number.isSafeInteger(journal.baseRevision) && Number(journal.baseRevision) >= 1)
      || (journal.syncStrategy === "manual" && journal.baseRevision === null))
    && validOwnerId(journal.operationId)
    && validTimestamp(journal.createdAt)
    && isSnapshot(journal.snapshot);
}

function browserStorage(storage?: WorkspaceStorage): WorkspaceStorage {
  if (storage) return storage;
  if (typeof localStorage === "undefined") {
    throw new WorkspaceJournalError("This browser cannot safely save workspace changes.", "STORAGE_UNAVAILABLE");
  }
  return localStorage;
}

function readRaw(storage: WorkspaceStorage, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    throw new WorkspaceJournalError("This browser cannot read workspace storage safely.", "STORAGE_UNAVAILABLE");
  }
}

function writeVerified(storage: WorkspaceStorage, key: string, serialized: string, failure: string) {
  try {
    storage.setItem(key, serialized);
    if (readRaw(storage, key) !== serialized) throw new Error("Storage did not retain the write.");
  } catch (error) {
    if (error instanceof WorkspaceJournalError) throw error;
    throw new WorkspaceJournalError(failure, "STORAGE_WRITE_FAILED");
  }
}

export function readPendingWorkspaceJournal(ownerId: string, storage?: WorkspaceStorage): PendingWorkspaceJournal | null {
  if (!validOwnerId(ownerId)) return null;
  const raw = readRaw(browserStorage(storage), pendingKey(ownerId));
  if (!raw) return null;
  try {
    const journal: unknown = JSON.parse(raw);
    return isPendingWorkspaceJournal(journal) && journal.ownerId === ownerId ? journal : null;
  } catch {
    return null;
  }
}

export type WorkspaceRecovery =
  | { source: "pending"; snapshot: Snapshot; journal: PendingWorkspaceJournal }
  | { source: "local"; snapshot: Snapshot }
  | { source: "none" }
  | { source: "invalid-pending" };

/**
 * A valid pending journal is authoritative because it is written before the
 * normal local snapshot. Invalid journal data is deliberately not deleted:
 * callers must surface recovery rather than silently discard it.
 */
export function readWorkspaceRecovery(ownerId: string, storage?: WorkspaceStorage): WorkspaceRecovery {
  if (!validOwnerId(ownerId)) return { source: "none" };
  const target = browserStorage(storage);
  const pendingRaw = readRaw(target, pendingKey(ownerId));
  if (pendingRaw) {
    try {
      const journal: unknown = JSON.parse(pendingRaw);
      if (!isPendingWorkspaceJournal(journal) || journal.ownerId !== ownerId) return { source: "invalid-pending" };
      return { source: "pending", snapshot: journal.snapshot, journal };
    } catch {
      return { source: "invalid-pending" };
    }
  }
  const workspaceRaw = readRaw(target, workspaceKey(ownerId));
  if (!workspaceRaw) return { source: "none" };
  try {
    const snapshot: unknown = JSON.parse(workspaceRaw);
    return isSnapshot(snapshot) ? { source: "local", snapshot } : { source: "none" };
  } catch {
    return { source: "none" };
  }
}

export function commitPendingWorkspaceSnapshot(journal: PendingWorkspaceJournal, storage?: WorkspaceStorage) {
  if (!isPendingWorkspaceJournal(journal)) {
    throw new WorkspaceJournalError("Workspace changes were not saved because the pending journal is invalid.", "INVALID_JOURNAL");
  }
  const target = browserStorage(storage);
  const serializedJournal = JSON.stringify(journal);
  const serializedSnapshot = JSON.stringify(journal.snapshot);

  // The journal is the recovery record. If the second write fails it remains
  // intact and wins during recovery, rather than leaving a false success.
  writeVerified(target, pendingKey(journal.ownerId), serializedJournal, "Could not safely retain pending workspace changes on this device.");
  writeVerified(target, workspaceKey(journal.ownerId), serializedSnapshot, "Workspace snapshot write failed. The pending recovery copy was retained.");
  return journal;
}

/**
 * Reinstates a coordinator-cleared journal only after a later consumer rejects
 * its exact cloud acknowledgment. It never overwrites a newer pending journal
 * or a different local snapshot.
 */
export function restoreExactPendingWorkspaceJournal(journal: PendingWorkspaceJournal, storage?: WorkspaceStorage) {
  if (!isPendingWorkspaceJournal(journal)) {
    throw new WorkspaceJournalError("Workspace recovery journal is invalid.", "INVALID_JOURNAL");
  }
  const recovery = readWorkspaceRecovery(journal.ownerId, storage);
  if (recovery.source === "invalid-pending") {
    throw new WorkspaceJournalError("Workspace recovery contains an invalid pending journal.", "ACKNOWLEDGMENT_REJECTED");
  }
  if (recovery.source === "pending") {
    if (JSON.stringify(recovery.journal) !== JSON.stringify(journal)) {
      throw new WorkspaceJournalError("A newer pending workspace journal must not be overwritten.", "ACKNOWLEDGMENT_REJECTED");
    }
    return journal;
  }
  if (recovery.source === "local" && JSON.stringify(recovery.snapshot) !== JSON.stringify(journal.snapshot)) {
    throw new WorkspaceJournalError("A different local workspace snapshot must not be overwritten.", "ACKNOWLEDGMENT_REJECTED");
  }
  return commitPendingWorkspaceSnapshot(journal, storage);
}

/**
 * Deletes only the exact journal supplied by a trusted caller that has already
 * confirmed the same owner and snapshot in cloud storage. This module performs
 * no cloud calls; callers must not treat this as cloud acknowledgment by itself.
 */
export function acknowledgePendingWorkspaceJournal(
  ownerId: string,
  acknowledged: PendingWorkspaceJournal,
  confirmedCloudSnapshot: Snapshot,
  storage?: WorkspaceStorage,
) {
  if (!validOwnerId(ownerId) || !isPendingWorkspaceJournal(acknowledged) || acknowledged.ownerId !== ownerId
    || JSON.stringify(acknowledged.snapshot) !== JSON.stringify(confirmedCloudSnapshot)) {
    throw new WorkspaceJournalError("Pending workspace acknowledgment was rejected.", "ACKNOWLEDGMENT_REJECTED");
  }
  const target = browserStorage(storage);
  const key = pendingKey(ownerId);
  const expected = JSON.stringify(acknowledged);
  let current: string | null;
  try { current = target.getItem(key); }
  catch { throw new WorkspaceJournalError("Could not read pending workspace storage for acknowledgment.", "STORAGE_UNAVAILABLE"); }
  if (current !== expected) throw new WorkspaceJournalError("Pending workspace changed before acknowledgment.", "ACKNOWLEDGMENT_REJECTED");
  try {
    target.removeItem(key);
    if (target.getItem(key) !== null) throw new Error("Storage did not remove the journal.");
  } catch {
    throw new WorkspaceJournalError("Could not acknowledge pending workspace storage safely.", "STORAGE_WRITE_FAILED");
  }
  return true;
}
