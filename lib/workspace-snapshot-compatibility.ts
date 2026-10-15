import { type Snapshot } from "./data";
import {
  WorkspaceSnapshotBoundary,
  type WorkspaceBoundaryCloudAcknowledgment,
  type WorkspaceBoundaryMutation,
  type PrivilegedWorkspaceHydration,
  type ReconciledWorkspaceHydration,
} from "./workspace-snapshot-boundary";
import { type GuardedCommitResult } from "./workspace-guarded-reducer";

/** Narrow capability consumed by lifecycle acknowledgment handoff only. */
export type WorkspaceSnapshotAcknowledgmentTarget = {
  applyCloudAcknowledgment(
    input: WorkspaceBoundaryCloudAcknowledgment
  ): { accepted: true } | { accepted: false; reason: string };
};

export type PersistedWorkspaceFields = {
  jobs: Snapshot["jobs"];
  payments: NonNullable<Snapshot["payments"]>;
  reminders: NonNullable<Snapshot["reminders"]>;
  notes: NonNullable<Snapshot["notes"]>;
  customerPhones: NonNullable<Snapshot["customerPhones"]>;
  owner: Snapshot["owner"];
  business: Snapshot["business"];
};

export type SnapshotCompatibilityRead = {
  ownerId: string | null;
  fields: PersistedWorkspaceFields | null;
  recovery: "clear" | "conflict" | "manual" | "pending";
  journalStatus: string | null;
  recoveryReason: string | null;
};

export type SnapshotCompatibilityResult =
  | { accepted: true; state: SnapshotCompatibilityRead }
  | { accepted: false; state: SnapshotCompatibilityRead; reason: string };

function fieldsFromSnapshot(snapshot: Snapshot): PersistedWorkspaceFields {
  // Each read is a fresh JSON copy. A legacy consumer cannot mutate boundary state.
  const copy = JSON.parse(JSON.stringify(snapshot)) as Snapshot;
  return {
    jobs: copy.jobs,
    payments: copy.payments || [],
    reminders: copy.reminders || [],
    notes: copy.notes || [],
    customerPhones: copy.customerPhones || {},
    owner: copy.owner,
    business: copy.business,
  };
}

/**
 * Pure compatibility façade for the future one-Snapshot cutover. It does not
 * mount React, dispatch user operations, write cloud state, or replace the
 * current workspace.tsx fields.
 */
export class WorkspaceSnapshotCompatibility {
  private readonly boundary = new WorkspaceSnapshotBoundary();

  read(): SnapshotCompatibilityRead {
    const state = this.boundary.getState();
    return {
      ownerId: state.ownerId,
      fields: state.snapshot ? fieldsFromSnapshot(state.snapshot) : null,
      recovery: state.recovery,
      journalStatus: state.journalStatus,
      recoveryReason: state.recoveryReason,
    };
  }

  /** Cloud hydration is never allowed to replace a non-clear recovery state for the same account. */
  privilegedHydrate(
    input: PrivilegedWorkspaceHydration
  ): SnapshotCompatibilityResult {
    const current = this.boundary.getState();
    if (current.ownerId === input.ownerId && current.recovery !== "clear") {
      return {
        accepted: false,
        state: this.read(),
        reason:
          "Pending workspace recovery must be resolved before cloud hydration can replace it.",
      };
    }
    if (current.ownerId && current.ownerId !== input.ownerId) {
      // An account switch discards only in-memory display state. Account-scoped
      // journals remain in storage and are never read through the new owner.
      const reset = this.boundary.privilegedReset(null);
      if (!reset.accepted)
        return { accepted: false, state: this.read(), reason: reset.reason };
    }
    const result = this.boundary.privilegedHydrate(input);
    return result.accepted
      ? { accepted: true, state: this.read() }
      : { accepted: false, state: this.read(), reason: result.reason };
  }

  /** Reconciled startup state carries its recovery reason and cannot be silently downgraded. */
  privilegedHydrateReconciled(
    input: ReconciledWorkspaceHydration
  ): SnapshotCompatibilityResult {
    const current = this.boundary.getState();
    if (current.ownerId === input.ownerId && current.recovery !== "clear") {
      return {
        accepted: false,
        state: this.read(),
        reason:
          "Pending workspace recovery must be resolved before applying a new cloud reconciliation.",
      };
    }
    if (current.ownerId && current.ownerId !== input.ownerId) {
      const reset = this.boundary.privilegedReset(null);
      if (!reset.accepted)
        return { accepted: false, state: this.read(), reason: reset.reason };
    }
    const result = this.boundary.privilegedHydrateReconciled(input);
    return result.accepted
      ? { accepted: true, state: this.read() }
      : { accepted: false, state: this.read(), reason: result.reason };
  }

  /** Only logout/session-clear may reset a displayed account; it never removes storage artifacts. */
  privilegedOwnerReset(
    activeOwnerId: string | null
  ): SnapshotCompatibilityResult {
    const result = this.boundary.privilegedReset(activeOwnerId);
    return result.accepted
      ? { accepted: true, state: this.read() }
      : { accepted: false, state: this.read(), reason: result.reason };
  }

  /**
   * Applies a trusted lifecycle acknowledgment to this compatibility runtime's
   * sole boundary. It intentionally exposes no boundary state or mutation API.
   */
  applyCloudAcknowledgment(
    input: WorkspaceBoundaryCloudAcknowledgment
  ): SnapshotCompatibilityResult {
    const result = this.boundary.applyCloudAcknowledgment(input);
    return result.accepted
      ? { accepted: true, state: this.read() }
      : { accepted: false, state: this.read(), reason: result.reason };
  }

  /**
   * Dispatches a user mutation through the sole boundary. Returns the guarded
   * commit result including journal for lifecycle notification. Does NOT call
   * lifecycle driver — that coordination happens in the runtime layer.
   */
  dispatchUserMutation(input: WorkspaceBoundaryMutation): GuardedCommitResult {
    return this.boundary.dispatchUserMutation(input);
  }
}
