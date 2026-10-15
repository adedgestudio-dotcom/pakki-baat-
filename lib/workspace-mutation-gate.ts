import type { PendingWorkspaceJournal } from "./workspace-journal";

export type WorkspaceMutationGateState =
  | "writable"
  | "pending-revisioned-journal"
  | "manual-journal"
  | "recovery-conflict"
  | "cloud-unavailable"
  | "ledger-dirty-pending"
  | "owner-mismatch"
  | "storage-failure";
export type WorkspaceMutationGateDecision = { allowed: boolean; state: WorkspaceMutationGateState; reason: string; mayReplacePendingJournal: boolean };

/** Pure fail-closed gate. Only the current boundary may replace its own pending journal. */
export function decideWorkspaceMutationGate(input: {
  activeOwnerId: string | null; operationOwnerId: string; storageHealthy: boolean; cloudAvailable: boolean;
  recoveryConflict: boolean; ledgerDirtyPending: boolean; journal: PendingWorkspaceJournal | null;
  latestBoundaryOperationId: string | null;
}): WorkspaceMutationGateDecision {
  if (!input.storageHealthy) return { allowed: false, state: "storage-failure", reason: "This device cannot safely retain workspace changes.", mayReplacePendingJournal: false };
  if (!input.activeOwnerId || input.activeOwnerId !== input.operationOwnerId) return { allowed: false, state: "owner-mismatch", reason: "Sign in to the correct account before saving.", mayReplacePendingJournal: false };
  if (input.recoveryConflict) return { allowed: false, state: "recovery-conflict", reason: "Resolve the workspace recovery conflict before editing.", mayReplacePendingJournal: false };
  if (input.journal?.syncStrategy === "manual") return { allowed: false, state: "manual-journal", reason: "This pending change needs manual recovery before editing.", mayReplacePendingJournal: false };
  if (input.journal) {
    const own = input.latestBoundaryOperationId === input.journal.operationId;
    return { allowed: own, state: "pending-revisioned-journal", reason: own ? "Replace the current pending change." : "A pending workspace change must be recovered first.", mayReplacePendingJournal: own };
  }
  if (input.ledgerDirtyPending) return { allowed: false, state: "ledger-dirty-pending", reason: "A ledger change is awaiting its exact retry.", mayReplacePendingJournal: false };
  if (!input.cloudAvailable) return { allowed: false, state: "cloud-unavailable", reason: "Cloud state is unavailable; preserve local recovery before editing.", mayReplacePendingJournal: false };
  return { allowed: true, state: "writable", reason: "Workspace is writable.", mayReplacePendingJournal: false };
}
