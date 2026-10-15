import type { WorkspaceJournalLifecycleDriverDependencies } from "./workspace-journal-lifecycle-driver";
import { WorkspaceJournalLifecycleDriver } from "./workspace-journal-lifecycle-driver";
import { WorkspaceLifecycleBoundaryAcknowledgmentHandoff } from "./workspace-lifecycle-boundary-handoff";
import { WorkspaceSnapshotCompatibilityController } from "./workspace-snapshot-controller";
import { type WorkspaceBoundaryMutation } from "./workspace-snapshot-boundary";
import { type GuardedCommitResult } from "./workspace-guarded-reducer";
import { type WorkspaceMutationOperation } from "./workspace-mutation-plan";

/** Phase 3A intentionally supports only ordinary, non-destructive operations. */
export type GuardedRuntimeSupportedOperation = Extract<
  WorkspaceMutationOperation,
  {
    kind:
      | "profile"
      | "phone"
      | "upsert-job"
      | "append-payment"
      | "upsert-reminder"
      | "append-note"
      | "append-note-if-missing"
      | "set-job-status"
      | "complete-reminder"
      | "snooze-reminder";
  }
>;

export type WorkspaceGuardedRuntimeDispatchInput = Omit<
  WorkspaceBoundaryMutation,
  "operation" | "special" | "verifiedBackup"
> & { operation: GuardedRuntimeSupportedOperation };

export type GuardedRuntimeDispatchResult =
  | (Extract<GuardedCommitResult, { accepted: true }> & {
      sync: { status: "scheduled" } | { status: "pending"; reason: string };
    })
  | Extract<GuardedCommitResult, { accepted: false }>;

export type WorkspaceGuardedRuntimeDependencies = Omit<
  WorkspaceJournalLifecycleDriverDependencies,
  "onAcknowledged"
> & {
  /**
   * Pending journals only prove identity until exact cloud acknowledgment. A
   * future live integration must supply durable completed-operation lookup.
   */
  hasCompletedOperation?: (
    ownerId: string,
    operationId: string
  ) => boolean | Promise<boolean>;
};

const supportedOperationKinds = new Set<GuardedRuntimeSupportedOperation["kind"]>([
  "profile",
  "phone",
  "upsert-job",
  "append-payment",
  "upsert-reminder",
  "append-note",
  "append-note-if-missing",
  "set-job-status",
  "complete-reminder",
  "snooze-reminder",
]);

export function isGuardedRuntimeSupportedOperation(
  operation: unknown
): operation is GuardedRuntimeSupportedOperation {
  return Boolean(
    operation &&
      typeof operation === "object" &&
      "kind" in operation &&
      typeof (operation as { kind?: unknown }).kind === "string" &&
      supportedOperationKinds.has(
        (operation as { kind: GuardedRuntimeSupportedOperation["kind"] }).kind
      )
  );
}

/**
 * One-owner container for a future guarded React runtime. It deliberately
 * performs no hydration, upload, or rendering by itself.
 */
export class WorkspaceGuardedRuntime {
  readonly controller = new WorkspaceSnapshotCompatibilityController();
  readonly handoff: WorkspaceLifecycleBoundaryAcknowledgmentHandoff;
  readonly lifecycle: WorkspaceJournalLifecycleDriver;
  private disposed = false;
  private ownerId: string | null = null;
  private pendingDispatch = false;
  private generation = 0;
  private readonly completedOperationIds = new Set<string>();

  constructor(private readonly deps: WorkspaceGuardedRuntimeDependencies) {
    this.handoff = new WorkspaceLifecycleBoundaryAcknowledgmentHandoff({
      boundary: this.controller,
      activeOwnerId: deps.activeOwnerId,
      sessionOwnerId: deps.activeOwnerId,
      sourceSelection: deps.sourceSelection,
    });
    this.lifecycle = new WorkspaceJournalLifecycleDriver({
      ...deps,
      onAcknowledged: async (acknowledgment, context) => {
        await this.handoff.asLifecycleAcknowledgmentHandler()(
          acknowledgment,
          context
        );
      },
    });
  }

  /**
   * Commits an allowed user operation locally before publishing it, then asks
   * the journal lifecycle to schedule the exact durable journal. It never
   * invokes generic autosave or saveCloud.
   */
  async dispatch(
    input: WorkspaceGuardedRuntimeDispatchInput
  ): Promise<GuardedRuntimeDispatchResult> {
    if (this.disposed) return this.reject("Workspace runtime is disposed.");
    if (this.pendingDispatch)
      return this.reject("Cannot dispatch concurrent workspace mutations.");
    if (!isGuardedRuntimeSupportedOperation(input.operation))
      return this.reject(
        "This workspace operation is not supported by the guarded runtime."
      );

    const dispatchGeneration = this.generation;
    const expectedOwnerId = this.ownerId;
    if (!expectedOwnerId || input.activeOwnerId !== expectedOwnerId)
      return this.reject("Workspace owner changed before saving.");
    if (!this.deps.hasCompletedOperation)
      return this.reject(
        "Durable operation-ID deduplication is unavailable; guarded dispatch is fail-closed."
      );

    this.pendingDispatch = true;
    try {
      if (!(await this.isCurrentDispatch(expectedOwnerId, dispatchGeneration)))
        return this.reject(
          "Workspace owner, session, source, or runtime generation changed before saving."
        );

      if (
        this.completedOperationIds.has(input.operationId) ||
        (await this.deps.hasCompletedOperation(
          expectedOwnerId,
          input.operationId
        ))
      ) {
        return this.reject("This workspace operation was already committed.");
      }

      // The operation lookup may be asynchronous. Re-check the same runtime
      // generation and authenticated session immediately before the synchronous
      // durable commit/publish boundary.
      if (!(await this.isCurrentDispatch(expectedOwnerId, dispatchGeneration)))
        return this.reject(
          "Workspace owner, session, source, or runtime generation changed before durable saving."
        );

      // Boundary ordering is gate -> plan -> durable journal -> reducer publish.
      const result = this.controller.dispatchUserMutation(input);
      if (!result.accepted) return result;

      this.completedOperationIds.add(input.operationId);
      try {
        const scheduled = await this.lifecycle.onDurableJournal(
          result.journal,
          result.state.snapshot!
        );
        if (!scheduled.scheduled) {
          return {
            ...result,
            sync: { status: "pending", reason: scheduled.reason },
          };
        }
      } catch (error) {
        return {
          ...result,
          sync: {
            status: "pending",
            reason:
              error && typeof error === "object" && "message" in error
                ? String((error as { message: unknown }).message)
                : "Could not schedule guarded workspace synchronization.",
          },
        };
      }

      return { ...result, sync: { status: "scheduled" } };
    } finally {
      this.pendingDispatch = false;
    }
  }

  /** Invalidates asynchronous work before another account can use this runtime. */
  onOwnerChanged(ownerId: string | null) {
    if (this.disposed || this.ownerId === ownerId) return;
    this.ownerId = ownerId;
    this.generation += 1;
    this.lifecycle.onOwnerChanged(ownerId);
    this.handoff.onOwnerChanged();
    // This privileged reset only clears in-memory display; it never deletes journals.
    this.controller.privilegedOwnerReset(null);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.lifecycle.dispose();
    this.handoff.dispose();
    this.controller.dispose();
  }

  private async isCurrentDispatch(ownerId: string, generation: number) {
    if (
      this.disposed ||
      this.generation !== generation ||
      this.ownerId !== ownerId
    ) {
      return false;
    }
    const selection = this.deps.sourceSelection();
    if (
      selection.source !== "guarded-signed-in" ||
      selection.ownerId !== ownerId
    ) {
      return false;
    }
    return (await this.deps.activeOwnerId()) === ownerId;
  }

  private reject(reason: string): Extract<GuardedCommitResult, { accepted: false }> {
    const state = this.controller.getSnapshot();
    return {
      accepted: false,
      state: {
        ownerId: state.ownerId,
        snapshot: null,
        latestOperationId: null,
        recovery: state.recovery,
        journalStatus: state.journalStatus,
        recoveryReason: state.recoveryReason,
      },
      reason,
    };
  }
}
