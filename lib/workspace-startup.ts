import { type Snapshot } from "./data";
import { readWorkspaceRecovery, type WorkspaceStorage } from "./workspace-journal";
import { reconcileWorkspaceRecovery, type LedgerDirtySnapshot, type ReconciliationResult } from "./workspace-reconciliation";

export type StartupCloudWorkspace = {
  available: boolean;
  ownerId: string | null;
  snapshot: Snapshot | null;
  revision: number | null;
  ledgerEnabled: boolean;
};

/** Reads the account-scoped recovery journal before selecting any cloud display state. */
export function reconcileWorkspaceStartup(input: {
  ownerId: string;
  localSnapshot: Snapshot | null;
  ledgerDirty: LedgerDirtySnapshot | null;
  cloud: StartupCloudWorkspace;
  storage?: WorkspaceStorage;
}): ReconciliationResult {
  let journal: unknown = null;
  try {
    const recovery = readWorkspaceRecovery(input.ownerId, input.storage);
    journal = recovery.source === "pending" ? recovery.journal : recovery.source === "invalid-pending" ? { invalidPendingJournal: true } : null;
  } catch {
    // A storage read failure is not permission to ignore a possibly pending
    // journal. The reconciliation helper will preserve local data and block
    // automatic writes under an explicit recovery conflict.
    journal = { unreadablePendingJournal: true };
  }
  return reconcileWorkspaceRecovery({
    ownerId: input.ownerId,
    cloudAvailable: input.cloud.available,
    cloudOwnerId: input.cloud.ownerId,
    cloudSnapshot: input.cloud.snapshot,
    cloudRevision: input.cloud.revision,
    ledgerEnabled: input.cloud.ledgerEnabled,
    journal,
    ledgerDirty: input.ledgerDirty,
    localSnapshot: input.localSnapshot,
  });
}
