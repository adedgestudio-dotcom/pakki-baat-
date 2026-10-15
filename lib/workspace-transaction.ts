import { isSnapshot, type Snapshot } from "./data";
import { commitPendingWorkspaceSnapshot, type PendingWorkspaceJournal, type WorkspaceStorage, WorkspaceJournalError } from "./workspace-journal";

export class WorkspaceTransactionError extends Error {
  constructor(message: string, readonly code: "INVALID_CURRENT_SNAPSHOT" | "INVALID_NEXT_SNAPSHOT" | "LEDGER_DIRTY_CONFLICT") { super(message); }
}

function cloneSnapshot(snapshot: Snapshot): Snapshot { return JSON.parse(JSON.stringify(snapshot)) as Snapshot; }
function equalJson(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

/** Builds one complete snapshot without mutating either the current value or the caller's updater input. */
export function buildWorkspaceSnapshot(current: Snapshot, update: (draft: Snapshot) => Snapshot): Snapshot {
  if (!isSnapshot(current)) throw new WorkspaceTransactionError("Current workspace snapshot is invalid.", "INVALID_CURRENT_SNAPSHOT");
  const next = update(cloneSnapshot(current));
  if (!isSnapshot(next)) throw new WorkspaceTransactionError("Next workspace snapshot is invalid.", "INVALID_NEXT_SNAPSHOT");
  return cloneSnapshot(next);
}

export type LedgerDirtyRecord = { snapshot: Snapshot; revision: number };
/** A differing ledger-dirty record is a hard stop: Phase 1B must not replace its exact retry payload. */
export function ledgerDirtyConflict(candidate: Snapshot, dirty: LedgerDirtyRecord | null | undefined) { return Boolean(dirty && !equalJson(candidate, dirty.snapshot)); }

export type WorkspaceTransactionInput = {
  ownerId: string; current: Snapshot; update: (draft: Snapshot) => Snapshot;
  /** `null` produces a manual-only journal; it cannot auto-sync. */
  baseRevision: number | null; operationId: string; createdAt: string;
  ledgerDirty?: LedgerDirtyRecord | null; storage?: WorkspaceStorage;
};
export type CommittedWorkspaceTransaction = { snapshot: Snapshot; journal: PendingWorkspaceJournal; automaticCloudSyncAllowed: boolean };

export function commitWorkspaceTransaction(input: WorkspaceTransactionInput): CommittedWorkspaceTransaction {
  const snapshot = buildWorkspaceSnapshot(input.current, input.update);
  if (ledgerDirtyConflict(snapshot, input.ledgerDirty)) throw new WorkspaceTransactionError("A ledger change is already pending. Resolve sync before saving another workspace change.", "LEDGER_DIRTY_CONFLICT");
  const journal: PendingWorkspaceJournal = input.baseRevision === null
    ? { version: 1, ownerId: input.ownerId, baseRevision: null, syncStrategy: "manual", operationId: input.operationId, createdAt: input.createdAt, snapshot }
    : { version: 1, ownerId: input.ownerId, baseRevision: input.baseRevision, syncStrategy: "revisioned", operationId: input.operationId, createdAt: input.createdAt, snapshot };
  try { commitPendingWorkspaceSnapshot(journal, input.storage); }
  catch (error) { if (error instanceof WorkspaceJournalError) throw error; throw error; }
  return { snapshot, journal, automaticCloudSyncAllowed: journal.syncStrategy === "revisioned" };
}
