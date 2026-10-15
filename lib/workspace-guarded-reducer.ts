import { type Snapshot } from "./data";
import { decideWorkspaceMutationGate, type WorkspaceMutationGateDecision } from "./workspace-mutation-gate";
import { planWorkspaceMutation, type WorkspaceMutationOperation } from "./workspace-mutation-plan";
import { commitWorkspaceTransaction, type LedgerDirtyRecord } from "./workspace-transaction";
import { type PendingWorkspaceJournal, type WorkspaceStorage } from "./workspace-journal";
import { decideSpecialWorkflow, type SpecialWorkflowInput } from "./workspace-special-workflow";
import { hasMatchingVerifiedBackupPrecondition, type VerifiedBackupPrecondition } from "./verified-workspace-backup";

export type GuardedWorkspaceState = { ownerId: string | null; snapshot: Snapshot | null; latestOperationId: string | null; recovery: "clear" | "conflict" | "manual" | "pending"; journalStatus: string | null; recoveryReason: string | null };
export type GuardedWorkspaceAction =
  | { type: "hydrate"; ownerId: string; snapshot: Snapshot; recovery: GuardedWorkspaceState["recovery"]; journalStatus?: string | null; recoveryReason?: string | null }
  | { type: "owner-reset" }
  | { type: "resolve-recovery"; ownerId: string; snapshot: Snapshot; operationId: string }
  | { type: "apply-committed-user"; ownerId: string; snapshot: Snapshot; operationId: string; journal: PendingWorkspaceJournal }
  | { type: "apply-cloud-acknowledgment"; ownerId: string; operationId: string; snapshot: Snapshot; revision: number };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Reducer never creates journals; ordinary user state can enter only with a matching durable journal. */
export function guardedWorkspaceReducer(state: GuardedWorkspaceState, action: GuardedWorkspaceAction): GuardedWorkspaceState {
  if (action.type === "owner-reset") return { ownerId: null, snapshot: null, latestOperationId: null, recovery: "clear", journalStatus: null, recoveryReason: null };
  if (action.type === "hydrate") return { ownerId: action.ownerId, snapshot: action.snapshot, latestOperationId: null, recovery: action.recovery, journalStatus: action.journalStatus || null, recoveryReason: action.recoveryReason || null };
  if (action.type === "resolve-recovery") {
    if (state.ownerId !== action.ownerId || state.recovery === "manual") return state;
    return { ...state, snapshot: action.snapshot, latestOperationId: action.operationId, recovery: "clear", journalStatus: null, recoveryReason: null };
  }
  if (action.type === "apply-cloud-acknowledgment") {
    if (state.ownerId !== action.ownerId || state.latestOperationId !== action.operationId || state.recovery !== "pending"
      || !same(state.snapshot, action.snapshot) || !Number.isSafeInteger(action.revision) || action.revision < 1) return state;
    return { ...state, recovery: "clear", journalStatus: "cloud-confirmed", recoveryReason: `Workspace journal was confirmed at cloud revision ${action.revision}.` };
  }
  if (state.ownerId !== action.ownerId || state.recovery === "conflict" || state.recovery === "manual"
    || action.journal.ownerId !== action.ownerId || action.journal.operationId !== action.operationId
    || !same(action.journal.snapshot, action.snapshot)) return state;
  return { ...state, snapshot: action.snapshot, latestOperationId: action.operationId, recovery: "pending", journalStatus: "journal-pending", recoveryReason: "A durable workspace journal is awaiting exact cloud acknowledgment." };
}

export type GuardedCommitInput = {
  state: GuardedWorkspaceState; activeOwnerId: string | null; operation: WorkspaceMutationOperation;
  operationId: string; createdAt: string; baseRevision: number | null; ledgerDirty: LedgerDirtyRecord | null;
  pendingJournal: PendingWorkspaceJournal | null; gate: WorkspaceMutationGateDecision; storage?: WorkspaceStorage;
  special?: SpecialWorkflowInput;
  verifiedBackup?: VerifiedBackupPrecondition;
};
export type GuardedCommitResult = { accepted: true; state: GuardedWorkspaceState; journal: PendingWorkspaceJournal; cloudUploadAllowed: boolean } | { accepted: false; state: GuardedWorkspaceState; reason: string };

/** Synchronous adapter contract: gate → plan → durable transaction → reducer application. */
export function commitAndApplyGuardedMutation(input: GuardedCommitInput): GuardedCommitResult {
  const ownerId = input.activeOwnerId;
  if (!ownerId || !input.state.snapshot || input.state.ownerId !== ownerId) return { accepted: false, state: input.state, reason: "Workspace owner is not ready for this operation." };
  if (input.pendingJournal && (input.pendingJournal.ownerId !== ownerId || input.state.latestOperationId !== input.pendingJournal.operationId)) {
    return { accepted: false, state: input.state, reason: "Pending journal does not match the current guarded owner state." };
  }
  if (!input.gate.allowed) return { accepted: false, state: input.state, reason: input.gate.reason };
  if (input.special) {
    const special = decideSpecialWorkflow(input.special);
    if (!special.mayCommitJournal) return { accepted: false, state: input.state, reason: special.reason };
  }
  const planned = planWorkspaceMutation(input.state.snapshot, input.operation);
  if (!planned.accepted) return { accepted: false, state: input.state, reason: planned.reason };
  if (planned.requiresVerifiedBackup && !hasMatchingVerifiedBackupPrecondition(input.verifiedBackup, ownerId, input.operationId, input.state.snapshot)) {
    return { accepted: false, state: input.state, reason: "This destructive workspace operation requires a fresh verified safety backup for the current account and snapshot." };
  }
  try {
    const committed = commitWorkspaceTransaction({ ownerId, current: input.state.snapshot, update: () => planned.snapshot, baseRevision: input.baseRevision, operationId: input.operationId, createdAt: input.createdAt, ledgerDirty: input.ledgerDirty, storage: input.storage });
    const next = guardedWorkspaceReducer(input.state, { type: "apply-committed-user", ownerId, snapshot: committed.snapshot, operationId: committed.journal.operationId, journal: committed.journal });
    if (next === input.state) return { accepted: false, state: input.state, reason: "Durable journal could not be applied to this owner state." };
    return { accepted: true, state: next, journal: committed.journal, cloudUploadAllowed: committed.automaticCloudSyncAllowed };
  } catch (error) { return { accepted: false, state: input.state, reason: error instanceof Error ? error.message : "Could not durably save workspace changes." }; }
}
