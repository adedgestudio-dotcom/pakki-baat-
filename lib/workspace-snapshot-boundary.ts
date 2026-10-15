"use client";

import { useCallback, useReducer, useRef } from "react";
import { isSnapshot, type Snapshot } from "./data";
import {
  commitAndApplyGuardedMutation,
  guardedWorkspaceReducer,
  type GuardedCommitResult,
  type GuardedWorkspaceState,
} from "./workspace-guarded-reducer";
import { decideWorkspaceMutationGate } from "./workspace-mutation-gate";
import { type WorkspaceMutationOperation } from "./workspace-mutation-plan";
import { isPendingWorkspaceJournal, readWorkspaceRecovery, type PendingWorkspaceJournal, type WorkspaceStorage } from "./workspace-journal";
import {
  applyJournalCloudAcknowledgment,
  isTrustedJournalCloudAcknowledgment,
  type JournalCloudAcknowledgment,
} from "./workspace-journal-coordinator";
import { type LedgerDirtyRecord } from "./workspace-transaction";
import { type SpecialWorkflowInput } from "./workspace-special-workflow";
import { type ReconciliationResult, type WorkspaceRecoveryState } from "./workspace-reconciliation";
import { type VerifiedBackupPrecondition } from "./verified-workspace-backup";

type BoundaryRecovery = GuardedWorkspaceState["recovery"];
type BoundaryResult =
  | { accepted: true; state: GuardedWorkspaceState }
  | { accepted: false; state: GuardedWorkspaceState; reason: string };

export type PrivilegedWorkspaceHydration = {
  ownerId: string;
  activeOwnerId: string | null;
  snapshot: Snapshot;
  /** A caller may carry a reconciliation conflict forward, but cannot downgrade a pending journal to clear. */
  recovery?: BoundaryRecovery;
  storage?: WorkspaceStorage;
};

export type WorkspaceBoundaryMutation = {
  activeOwnerId: string | null;
  operation: WorkspaceMutationOperation;
  operationId: string;
  createdAt: string;
  baseRevision: number | null;
  ledgerDirty: LedgerDirtyRecord | null;
  storageHealthy: boolean;
  cloudAvailable: boolean;
  storage?: WorkspaceStorage;
  special?: SpecialWorkflowInput;
  verifiedBackup?: VerifiedBackupPrecondition;
};

/**
 * A cloud acknowledgment is accepted only after the coordinator has removed
 * this exact journal locally. The journal is supplied so the boundary can
 * prove that the acknowledgment corresponds to its latest durable operation.
 */
export type WorkspaceBoundaryCloudAcknowledgment = {
  activeOwnerId: string | null;
  sessionOwnerId: string | null;
  journal: PendingWorkspaceJournal;
  acknowledgment: JournalCloudAcknowledgment;
  storage?: WorkspaceStorage;
};

export type ReconciledWorkspaceHydration = {
  ownerId: string;
  activeOwnerId: string | null;
  reconciliation: ReconciliationResult;
  storage?: WorkspaceStorage;
};

const ownerUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The guarded boundary is deliberately unavailable to `LOCAL_WORKSPACE_ID` / anonymous workspaces. */
export function isGuardedWorkspaceOwner(ownerId: string | null | undefined): ownerId is string {
  return typeof ownerId === "string" && ownerUuid.test(ownerId);
}

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return JSON.parse(JSON.stringify(snapshot)) as Snapshot;
}

function cloneState(state: GuardedWorkspaceState): GuardedWorkspaceState {
  return { ...state, snapshot: state.snapshot ? cloneSnapshot(state.snapshot) : null };
}

function rejected(state: GuardedWorkspaceState, reason: string): BoundaryResult {
  return { accepted: false, state: cloneState(state), reason };
}

/**
 * Isolated owner-scoped boundary for the future guarded cutover. It is not
 * used by workspace.tsx yet. User writes are delegated to the existing
 * journal-first transaction adapter before this controller exposes new state.
 */
export class WorkspaceSnapshotBoundary {
  private state: GuardedWorkspaceState = { ownerId: null, snapshot: null, latestOperationId: null, recovery: "clear", journalStatus: null, recoveryReason: null };
  private revision = 0;
  private readonly subscribers = new Set<() => void>();

  getState(): GuardedWorkspaceState {
    return cloneState(this.state);
  }

  getRevision(): number {
    return this.revision;
  }

  /** Isolated consumers may observe successful state transitions without polling. */
  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  privilegedHydrate(input: PrivilegedWorkspaceHydration): BoundaryResult {
    if (input.activeOwnerId !== input.ownerId) return rejected(this.state, "Workspace owner changed during hydration.");
    if (!isGuardedWorkspaceOwner(input.ownerId)) return rejected(this.state, "Anonymous and local workspaces must not enter guarded mode.");
    if (!isSnapshot(input.snapshot)) return rejected(this.state, "Hydration snapshot is invalid.");

    try {
      const recovery = readWorkspaceRecovery(input.ownerId, input.storage);
      if (recovery.source === "invalid-pending") {
        return rejected(this.state, "Pending workspace recovery is invalid and must be resolved before hydration.");
      }
      if (recovery.source === "pending") {
        if (JSON.stringify(recovery.snapshot) !== JSON.stringify(input.snapshot)) {
          return rejected(this.state, "Hydration would overwrite a pending workspace journal.");
        }
        const journalRecovery: BoundaryRecovery = recovery.journal.syncStrategy === "manual" ? "manual" : "pending";
        this.state = guardedWorkspaceReducer(this.state, { type: "hydrate", ownerId: input.ownerId, snapshot: cloneSnapshot(recovery.snapshot), recovery: journalRecovery, journalStatus: recovery.journal.syncStrategy === "manual" ? "journal-manual-recovery" : "journal-pending", recoveryReason: "A pending workspace journal was restored before cloud data." });
      } else {
        this.state = guardedWorkspaceReducer(this.state, { type: "hydrate", ownerId: input.ownerId, snapshot: cloneSnapshot(input.snapshot), recovery: input.recovery || "clear" });
      }
      return { accepted: true, state: this.getState() };
    } catch {
      return rejected(this.state, "Workspace storage cannot be safely inspected during hydration.");
    }
  }

  /** Applies the pure startup reconciler's selected snapshot without losing its recovery diagnosis. */
  privilegedHydrateReconciled(input: ReconciledWorkspaceHydration): BoundaryResult {
    const { reconciliation } = input;
    if (input.activeOwnerId !== input.ownerId) return rejected(this.state, "Workspace owner changed during reconciliation hydration.");
    if (!isGuardedWorkspaceOwner(input.ownerId)) return rejected(this.state, "Anonymous and local workspaces must not enter guarded mode.");
    if (!reconciliation.displaySnapshot || !isSnapshot(reconciliation.displaySnapshot)) return rejected(this.state, "Reconciliation did not provide a valid workspace snapshot.");
    try {
      const recovery = readWorkspaceRecovery(input.ownerId, input.storage);
      if (recovery.source === "invalid-pending") return rejected(this.state, "Pending workspace recovery is invalid and must be resolved before hydration.");
      if (recovery.source === "pending" && JSON.stringify(recovery.snapshot) !== JSON.stringify(reconciliation.displaySnapshot)) {
        return rejected(this.state, "Reconciliation would overwrite a pending workspace journal.");
      }
      if (reconciliation.preserve.journal && recovery.source !== "pending") {
        return rejected(this.state, "Reconciliation journal artifact changed before hydration.");
      }
      const mapped = boundaryRecoveryFor(reconciliation.state);
      this.state = guardedWorkspaceReducer(this.state, {
        type: "hydrate",
        ownerId: input.ownerId,
        snapshot: cloneSnapshot(reconciliation.displaySnapshot),
        recovery: mapped,
        journalStatus: reconciliation.state,
        recoveryReason: reconciliation.reason,
      });
      return { accepted: true, state: this.getState() };
    } catch {
      return rejected(this.state, "Workspace storage cannot be safely inspected during reconciliation hydration.");
    }
  }

  /** Logout/reset is privileged but never removes another account's journal. */
  privilegedReset(activeOwnerId: string | null): BoundaryResult {
    if (activeOwnerId && this.state.ownerId && activeOwnerId !== this.state.ownerId) {
      return rejected(this.state, "Workspace owner changed before reset.");
    }
    this.state = guardedWorkspaceReducer(this.state, { type: "owner-reset" });
    return { accepted: true, state: this.getState() };
  }

  dispatchUserMutation(input: WorkspaceBoundaryMutation): GuardedCommitResult {
    const ownerId = this.state.ownerId;
    if (!ownerId || !this.state.snapshot) return { accepted: false, state: this.getState(), reason: "Workspace is not hydrated for this account." };
    if (input.activeOwnerId !== ownerId) return { accepted: false, state: this.getState(), reason: "Workspace owner changed before saving." };

    let journal: PendingWorkspaceJournal | null = null;
    try {
      const recovery = readWorkspaceRecovery(ownerId, input.storage);
      if (recovery.source === "invalid-pending") return { accepted: false, state: this.getState(), reason: "Pending workspace recovery is invalid and must be resolved before editing." };
      journal = recovery.source === "pending" ? recovery.journal : null;
    } catch {
      return { accepted: false, state: this.getState(), reason: "Workspace storage cannot be safely inspected before saving." };
    }

    if (this.state.recovery === "conflict" || this.state.recovery === "manual") {
      return { accepted: false, state: this.getState(), reason: "Resolve workspace recovery before editing." };
    }
    if (this.state.recovery === "pending" && !journal) {
      return { accepted: false, state: this.getState(), reason: "Pending workspace recovery changed before editing." };
    }

    const gate = decideWorkspaceMutationGate({
      activeOwnerId: input.activeOwnerId,
      operationOwnerId: ownerId,
      storageHealthy: input.storageHealthy,
      cloudAvailable: input.cloudAvailable,
      recoveryConflict: false,
      ledgerDirtyPending: Boolean(input.ledgerDirty),
      journal,
      latestBoundaryOperationId: this.state.latestOperationId,
    });
    const result = commitAndApplyGuardedMutation({
      state: this.state,
      activeOwnerId: input.activeOwnerId,
      operation: input.operation,
      operationId: input.operationId,
      createdAt: input.createdAt,
      baseRevision: input.baseRevision,
      ledgerDirty: input.ledgerDirty,
      pendingJournal: journal,
      gate,
      storage: input.storage,
      special: input.special,
      verifiedBackup: input.verifiedBackup,
    });
    if (result.accepted) this.state = result.state;
    return result.accepted ? { ...result, state: this.getState() } : { ...result, state: this.getState() };
  }

  /**
   * Applies only an opaque coordinator-issued, exact cloud acknowledgment.
   * It has no transport or storage side effects: local deletion has already
   * happened in the coordinator and a rejection leaves recovery artifacts intact.
   */
  applyCloudAcknowledgment(input: WorkspaceBoundaryCloudAcknowledgment): BoundaryResult {
    const { acknowledgment, journal } = input;
    const ownerId = this.state.ownerId;
    if (!ownerId || !this.state.snapshot || input.activeOwnerId !== ownerId || input.sessionOwnerId !== ownerId) {
      return rejected(this.state, "Workspace owner or authenticated session changed before cloud acknowledgment.");
    }
    if (!isGuardedWorkspaceOwner(ownerId) || !isTrustedJournalCloudAcknowledgment(acknowledgment)) {
      return rejected(this.state, "Cloud acknowledgment is not trusted for this guarded workspace.");
    }
    if (!isPendingWorkspaceJournal(journal) || !isRevisionedJournalFor(journal, ownerId) || journal.operationId !== acknowledgment.operationId
      || acknowledgment.ownerId !== ownerId || this.state.latestOperationId !== acknowledgment.operationId
      || this.state.recovery !== "pending" || !sameSnapshot(this.state.snapshot, acknowledgment.snapshot)
      || !sameSnapshot(journal.snapshot, acknowledgment.snapshot) || acknowledgment.revision < journal.baseRevision) {
      return rejected(this.state, "Cloud acknowledgment does not match the latest pending workspace operation.");
    }
    try {
      const recovery = readWorkspaceRecovery(ownerId, input.storage);
      if (recovery.source !== "local") {
        return rejected(this.state, "Pending workspace journal was not safely acknowledged locally.");
      }
      if (!sameSnapshot(recovery.snapshot, acknowledgment.snapshot)) {
        return rejected(this.state, "Local workspace changed before cloud acknowledgment could be applied.");
      }
    } catch {
      return rejected(this.state, "Workspace storage cannot be safely verified for cloud acknowledgment.");
    }
    const next = applyJournalCloudAcknowledgment(this.state, acknowledgment);
    if (next === this.state) return rejected(this.state, "Cloud acknowledgment was rejected by the guarded workspace reducer.");
    this.publish(next);
    return { accepted: true, state: this.getState() };
  }

  private publish(next: GuardedWorkspaceState) {
    if (next === this.state) return;
    this.state = next;
    this.revision += 1;
    for (const subscriber of this.subscribers) subscriber();
  }
}

/** Client hook wrapper. The controller remains usable in isolated tests without mounting React. */
export function useWorkspaceSnapshotBoundary() {
  const boundaryRef = useRef<WorkspaceSnapshotBoundary | null>(null);
  if (!boundaryRef.current) boundaryRef.current = new WorkspaceSnapshotBoundary();
  const [, redraw] = useReducer((version: number) => version + 1, 0);
  const run = useCallback(<T extends BoundaryResult | GuardedCommitResult>(action: () => T): T => {
    const result = action();
    if (result.accepted) redraw();
    return result;
  }, []);
  const boundary = boundaryRef.current;
  return {
    state: boundary.getState(),
    privilegedHydrate: (input: PrivilegedWorkspaceHydration) => run(() => boundary.privilegedHydrate(input)),
    privilegedHydrateReconciled: (input: ReconciledWorkspaceHydration) => run(() => boundary.privilegedHydrateReconciled(input)),
    privilegedReset: (activeOwnerId: string | null) => run(() => boundary.privilegedReset(activeOwnerId)),
    dispatchUserMutation: (input: WorkspaceBoundaryMutation) => run(() => boundary.dispatchUserMutation(input)),
    applyCloudAcknowledgment: (input: WorkspaceBoundaryCloudAcknowledgment) => run(() => boundary.applyCloudAcknowledgment(input)),
  };
}

function sameSnapshot(left: Snapshot, right: Snapshot) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRevisionedJournalFor(
  journal: PendingWorkspaceJournal,
  ownerId: string,
): journal is PendingWorkspaceJournal & { syncStrategy: "revisioned"; baseRevision: number } {
  return journal.ownerId === ownerId && journal.syncStrategy === "revisioned"
    && typeof journal.baseRevision === "number" && Number.isSafeInteger(journal.baseRevision) && journal.baseRevision >= 1;
}

function boundaryRecoveryFor(state: WorkspaceRecoveryState): BoundaryRecovery {
  if (state === "recovery-conflict") return "conflict";
  if (state === "journal-manual-recovery") return "manual";
  if (state === "journal-pending" || state === "ledger-pending" || state === "cloud-unavailable-local-pending") return "pending";
  return "clear";
}
