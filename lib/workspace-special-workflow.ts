import type { PendingWorkspaceJournal } from "./workspace-journal";

export type SpecialWorkflow = "reminder-save" | "undo" | "import-restore" | "pre-operation-backup";
export type SpecialWorkflowState = "preflight" | "journal-durable" | "cloud-pending" | "cloud-confirmed" | "conflict" | "failed";
export type SpecialWorkflowDecision = { state: SpecialWorkflowState; mayCommitJournal: boolean; mayApplySnapshot: boolean; mayRequestBackup: boolean; reason: string };
export type SpecialWorkflowInput = {
  workflow: SpecialWorkflow; ownerMatches: boolean; storageHealthy: boolean; cloudAvailable: boolean;
  ledgerDirtyConflict: boolean; journal: PendingWorkspaceJournal | null; latestOperationId: string | null;
  backupRequired: boolean; backupConfirmed: boolean; cloudAcknowledged: boolean; cloudConflict: boolean;
};

/** Pure policy. A caller supplies verified outcomes; this helper never writes cloud or storage. */
export function decideSpecialWorkflow(input: SpecialWorkflowInput): SpecialWorkflowDecision {
  if (!input.ownerMatches) return { state: "failed", mayCommitJournal: false, mayApplySnapshot: false, mayRequestBackup: false, reason: "Account changed before the workspace operation could run." };
  if (!input.storageHealthy) return { state: "failed", mayCommitJournal: false, mayApplySnapshot: false, mayRequestBackup: false, reason: "Workspace journal storage is unavailable." };
  if (input.ledgerDirtyConflict || input.cloudConflict) return { state: "conflict", mayCommitJournal: false, mayApplySnapshot: false, mayRequestBackup: false, reason: "A ledger or cloud conflict must be resolved before replacing the workspace." };
  if (input.journal && input.journal.operationId !== input.latestOperationId) return { state: "conflict", mayCommitJournal: false, mayApplySnapshot: false, mayRequestBackup: false, reason: "A newer or unknown pending workspace operation exists." };
  if (input.journal?.syncStrategy === "manual") return { state: "conflict", mayCommitJournal: false, mayApplySnapshot: false, mayRequestBackup: false, reason: "A manual-recovery journal cannot be replaced automatically." };
  if (input.backupRequired && !input.backupConfirmed) {
    return { state: "preflight", mayCommitJournal: false, mayApplySnapshot: false, mayRequestBackup: input.cloudAvailable, reason: input.cloudAvailable ? "A confirmed cloud safety backup is required before this destructive operation." : "A required cloud safety backup cannot be confirmed while offline." };
  }
  if (!input.cloudAvailable) return { state: "preflight", mayCommitJournal: false, mayApplySnapshot: false, mayRequestBackup: false, reason: "Cloud/revision reconciliation is unavailable; preserve the current workspace." };
  if (!input.journal) return { state: "preflight", mayCommitJournal: true, mayApplySnapshot: false, mayRequestBackup: false, reason: "Preflight passed; commit the complete replacement snapshot to the journal first." };
  if (!input.cloudAcknowledged) return { state: "journal-durable", mayCommitJournal: false, mayApplySnapshot: false, mayRequestBackup: false, reason: "The journal is durable but its exact cloud acknowledgment is still pending." };
  return { state: "cloud-confirmed", mayCommitJournal: false, mayApplySnapshot: true, mayRequestBackup: false, reason: "Exact journal snapshot and owner were confirmed by cloud coordination." };
}

/** Reminder save never uses the legacy direct RPC in the guarded path. */
export function reminderWorkflowPolicy(input: Omit<SpecialWorkflowInput, "workflow" | "backupRequired" | "backupConfirmed">) {
  return decideSpecialWorkflow({ ...input, workflow: "reminder-save", backupRequired: false, backupConfirmed: true });
}
