import { isSnapshot, type Snapshot } from "./data";
import { isPendingWorkspaceJournal, type PendingWorkspaceJournal } from "./workspace-journal";

export type LedgerDirtySnapshot = { snapshot: Snapshot; revision: number };
export type WorkspaceRecoveryState = "cloud-current" | "journal-acknowledged" | "journal-pending" | "journal-manual-recovery" | "ledger-pending" | "recovery-conflict" | "cloud-unavailable-local-pending";
export type ReconciliationInput = {
  ownerId: string;
  cloudAvailable: boolean;
  cloudOwnerId: string | null;
  cloudSnapshot: Snapshot | null;
  cloudRevision: number | null;
  ledgerEnabled: boolean;
  journal: unknown;
  ledgerDirty: LedgerDirtySnapshot | null;
  localSnapshot: Snapshot | null;
};
export type ReconciliationResult = {
  state: WorkspaceRecoveryState;
  displaySnapshot: Snapshot | null;
  automaticUploadAllowed: boolean;
  acknowledgmentCandidate: PendingWorkspaceJournal | null;
  preserve: { journal: boolean; ledgerDirty: boolean; localSnapshot: boolean };
  reason: string;
};

function equalJson(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }
function validJournalForOwner(journal: unknown, ownerId: string): journal is PendingWorkspaceJournal {
  return isPendingWorkspaceJournal(journal) && journal.ownerId === ownerId;
}
function conflict(displaySnapshot: Snapshot | null, reason: string, journal: boolean, ledgerDirty: boolean, localSnapshot: boolean): ReconciliationResult {
  return { state: "recovery-conflict", displaySnapshot, automaticUploadAllowed: false, acknowledgmentCandidate: null, preserve: { journal, ledgerDirty, localSnapshot }, reason };
}

/** Pure policy only: it never clears storage, mutates data, or starts a cloud write. */
export function reconcileWorkspaceRecovery(input: ReconciliationInput): ReconciliationResult {
  const local = input.localSnapshot && isSnapshot(input.localSnapshot) ? input.localSnapshot : null;
  const cloud = input.cloudSnapshot && isSnapshot(input.cloudSnapshot) ? input.cloudSnapshot : null;
  const dirty = input.ledgerDirty && isSnapshot(input.ledgerDirty.snapshot) ? input.ledgerDirty : null;
  const hasJournal = input.journal !== null && input.journal !== undefined;
  if (hasJournal && !validJournalForOwner(input.journal, input.ownerId)) {
    return conflict(local || cloud, "Pending workspace journal is invalid or belongs to another account.", true, Boolean(dirty), Boolean(local));
  }
  const journal = validJournalForOwner(input.journal, input.ownerId) ? input.journal : null;
  if (input.cloudAvailable && input.cloudOwnerId !== input.ownerId) {
    return conflict(journal?.snapshot || local || cloud, "Cloud workspace identity changed during recovery.", Boolean(journal), Boolean(dirty), Boolean(local));
  }
  if (journal && dirty && !equalJson(journal.snapshot, dirty.snapshot)) {
    return conflict(journal.snapshot, "Pending journal and ledger retry payload differ.", true, true, Boolean(local));
  }
  if (journal?.syncStrategy === "manual") {
    return { state: "journal-manual-recovery", displaySnapshot: journal.snapshot, automaticUploadAllowed: false, acknowledgmentCandidate: null, preserve: { journal: true, ledgerDirty: Boolean(dirty), localSnapshot: Boolean(local) }, reason: "This pending change has no safe cloud revision and must not use legacy auto-save." };
  }
  if (!input.cloudAvailable) {
    const display = journal?.snapshot || dirty?.snapshot || local;
    return { state: "cloud-unavailable-local-pending", displaySnapshot: display, automaticUploadAllowed: false, acknowledgmentCandidate: null, preserve: { journal: Boolean(journal), ledgerDirty: Boolean(dirty), localSnapshot: Boolean(local) }, reason: "Cloud state is unavailable; local recovery data is preserved." };
  }
  if (journal) {
    if (!cloud || input.cloudRevision === null) {
      return { state: "journal-manual-recovery", displaySnapshot: journal.snapshot, automaticUploadAllowed: false, acknowledgmentCandidate: null, preserve: { journal: true, ledgerDirty: Boolean(dirty), localSnapshot: Boolean(local) }, reason: "Cloud revision is unavailable; pending data cannot be auto-uploaded." };
    }
    if (equalJson(journal.snapshot, cloud)) {
      return { state: "journal-acknowledged", displaySnapshot: cloud, automaticUploadAllowed: false, acknowledgmentCandidate: journal, preserve: { journal: true, ledgerDirty: Boolean(dirty), localSnapshot: Boolean(local) }, reason: "Cloud contains the exact pending snapshot; conditional acknowledgment is allowed." };
    }
    if (journal.baseRevision === input.cloudRevision) {
      return { state: "journal-pending", displaySnapshot: journal.snapshot, automaticUploadAllowed: input.ledgerEnabled, acknowledgmentCandidate: null, preserve: { journal: true, ledgerDirty: Boolean(dirty), localSnapshot: Boolean(local) }, reason: "Pending snapshot is based on the current cloud revision." };
    }
    return conflict(journal.snapshot, "Cloud revision advanced while a pending workspace journal existed.", true, Boolean(dirty), Boolean(local));
  }
  if (dirty) {
    if (!cloud || input.cloudRevision === null) return { state: "cloud-unavailable-local-pending", displaySnapshot: dirty.snapshot, automaticUploadAllowed: false, acknowledgmentCandidate: null, preserve: { journal: false, ledgerDirty: true, localSnapshot: Boolean(local) }, reason: "Ledger retry payload is preserved until cloud state is available." };
    if (equalJson(dirty.snapshot, cloud)) return { state: "ledger-pending", displaySnapshot: cloud, automaticUploadAllowed: false, acknowledgmentCandidate: null, preserve: { journal: false, ledgerDirty: true, localSnapshot: Boolean(local) }, reason: "Ledger retry payload already matches cloud; existing ledger acknowledgment may clear it." };
    if (dirty.revision === input.cloudRevision) return { state: "ledger-pending", displaySnapshot: dirty.snapshot, automaticUploadAllowed: true, acknowledgmentCandidate: null, preserve: { journal: false, ledgerDirty: true, localSnapshot: Boolean(local) }, reason: "Existing ledger exact-payload retry remains eligible." };
    return conflict(dirty.snapshot, "Cloud revision advanced while a ledger retry payload existed.", false, true, Boolean(local));
  }
  return { state: "cloud-current", displaySnapshot: cloud || local, automaticUploadAllowed: false, acknowledgmentCandidate: null, preserve: { journal: false, ledgerDirty: false, localSnapshot: Boolean(local) }, reason: cloud ? "Cloud workspace is current." : "No workspace snapshot is available." };
}
