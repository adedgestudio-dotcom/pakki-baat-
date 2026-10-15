"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { type ReconciliationResult } from "./workspace-reconciliation";
import { type WorkspaceStorage } from "./workspace-journal";
import {
  WorkspaceSnapshotCompatibility,
  type WorkspaceSnapshotAcknowledgmentTarget,
  type SnapshotCompatibilityRead,
  type SnapshotCompatibilityResult,
} from "./workspace-snapshot-compatibility";
import { type GuardedCommitResult } from "./workspace-guarded-reducer";
import { type WorkspaceBoundaryMutation } from "./workspace-snapshot-boundary";

export type WorkspaceSnapshotControllerRead = Readonly<
  SnapshotCompatibilityRead & { revision: number }
>;
export type AsyncReconciledWorkspaceHydration = {
  ownerId: string;
  activeOwnerId: () => string | null;
  reconciliation: Promise<ReconciliationResult>;
  storage?: WorkspaceStorage;
};

function freezeCopy<T>(value: T): T {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (item: unknown): unknown => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return item;
    for (const child of Object.values(item as Record<string, unknown>))
      freeze(child);
    return Object.freeze(item);
  };
  return freeze(copy) as T;
}

function failed(
  state: WorkspaceSnapshotControllerRead,
  reason: string
): SnapshotCompatibilityResult {
  return { accepted: false, state, reason };
}

/**
 * Notification-owning wrapper for the pure compatibility adapter. It has no
 * cloud behavior and is intentionally unused by the live workspace component.
 */
export class WorkspaceSnapshotCompatibilityController
  implements WorkspaceSnapshotAcknowledgmentTarget
{
  private readonly compatibility = new WorkspaceSnapshotCompatibility();
  private readonly listeners = new Set<() => void>();
  private active = true;
  private revision = 0;
  private published: WorkspaceSnapshotControllerRead = freezeCopy({
    ...this.compatibility.read(),
    revision: 0,
  });

  activate() {
    this.active = true;
  }

  dispose() {
    this.active = false;
    this.listeners.clear();
  }

  subscribe(listener: () => void) {
    if (!this.active) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot = (): WorkspaceSnapshotControllerRead => this.published;

  private publish() {
    if (!this.active) return;
    this.revision += 1;
    this.published = freezeCopy({
      ...this.compatibility.read(),
      revision: this.revision,
    });
    for (const listener of this.listeners) listener();
  }

  private apply(
    result: SnapshotCompatibilityResult
  ): SnapshotCompatibilityResult {
    if (result.accepted) this.publish();
    return result.accepted
      ? { accepted: true, state: this.published }
      : { accepted: false, state: this.published, reason: result.reason };
  }

  privilegedHydrate(
    input: Parameters<WorkspaceSnapshotCompatibility["privilegedHydrate"]>[0]
  ) {
    if (!this.active)
      return failed(
        this.published,
        "Workspace controller is no longer active."
      );
    return this.apply(this.compatibility.privilegedHydrate(input));
  }

  privilegedHydrateReconciled(
    input: Parameters<
      WorkspaceSnapshotCompatibility["privilegedHydrateReconciled"]
    >[0]
  ) {
    if (!this.active)
      return failed(
        this.published,
        "Workspace controller is no longer active."
      );
    return this.apply(this.compatibility.privilegedHydrateReconciled(input));
  }

  privilegedOwnerReset(activeOwnerId: string | null) {
    if (!this.active)
      return failed(
        this.published,
        "Workspace controller is no longer active."
      );
    return this.apply(this.compatibility.privilegedOwnerReset(activeOwnerId));
  }

  /** Narrow lifecycle capability; accepted acknowledgments publish exactly once. */
  applyCloudAcknowledgment(
    input: Parameters<
      WorkspaceSnapshotCompatibility["applyCloudAcknowledgment"]
    >[0]
  ) {
    if (!this.active)
      return failed(
        this.published,
        "Workspace controller is no longer active."
      );
    return this.apply(this.compatibility.applyCloudAcknowledgment(input));
  }

  /**
   * Dispatches a user mutation through the compatibility layer. Returns the
   * guarded commit result without lifecycle notification. Publishes exactly
   * once when accepted. Caller coordinates lifecycle notification.
   */
  dispatchUserMutation(input: WorkspaceBoundaryMutation): GuardedCommitResult {
    if (!this.active) {
      return {
        accepted: false,
        state: this.compatibility.read() as ReturnType<
          typeof this.compatibility.read
        > & {
          snapshot: import("./data").Snapshot;
          latestOperationId: string;
          journalStatus: "pending";
          latestRevision: number;
        },
        reason: "Workspace controller is no longer active.",
      };
    }
    const result = this.compatibility.dispatchUserMutation(input);
    if (result.accepted) this.publish();
    return result;
  }

  /**
   * Async startup callers must supply the current session accessor. The owner
   * is checked before and after await; an obsolete response is never applied.
   */
  async hydrateReconciledAsync(
    input: AsyncReconciledWorkspaceHydration
  ): Promise<SnapshotCompatibilityResult> {
    if (!this.active)
      return failed(
        this.published,
        "Workspace controller is no longer active."
      );
    if (input.activeOwnerId() !== input.ownerId)
      return failed(
        this.published,
        "Workspace owner changed before reconciliation hydration."
      );

    // Do not show the previous account while the next account's reconciliation is in flight.
    if (this.published.ownerId && this.published.ownerId !== input.ownerId) {
      const reset = this.compatibility.privilegedOwnerReset(null);
      if (!reset.accepted) return this.apply(reset);
      this.publish();
    }

    let reconciliation: ReconciliationResult;
    try {
      reconciliation = await input.reconciliation;
    } catch {
      return failed(
        this.published,
        "Workspace reconciliation could not be loaded."
      );
    }
    if (!this.active)
      return failed(
        this.published,
        "Workspace controller is no longer active."
      );
    if (input.activeOwnerId() !== input.ownerId)
      return failed(
        this.published,
        "Workspace owner changed before reconciliation hydration completed."
      );
    return this.privilegedHydrateReconciled({
      ownerId: input.ownerId,
      activeOwnerId: input.ownerId,
      reconciliation,
      storage: input.storage,
    });
  }
}

/** Unused hook entrypoint for the later guarded-mode component integration. */
export function useWorkspaceSnapshotCompatibilityController() {
  const controllerRef = useRef<WorkspaceSnapshotCompatibilityController | null>(
    null
  );
  if (!controllerRef.current)
    controllerRef.current = new WorkspaceSnapshotCompatibilityController();
  const controller = controllerRef.current;
  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);
  const state = useSyncExternalStore(
    controller.subscribe.bind(controller),
    controller.getSnapshot,
    controller.getSnapshot
  );
  return {
    state,
    privilegedHydrate: useCallback(
      (
        input: Parameters<
          WorkspaceSnapshotCompatibilityController["privilegedHydrate"]
        >[0]
      ) => controller.privilegedHydrate(input),
      [controller]
    ),
    privilegedHydrateReconciled: useCallback(
      (
        input: Parameters<
          WorkspaceSnapshotCompatibilityController["privilegedHydrateReconciled"]
        >[0]
      ) => controller.privilegedHydrateReconciled(input),
      [controller]
    ),
    privilegedOwnerReset: useCallback(
      (activeOwnerId: string | null) =>
        controller.privilegedOwnerReset(activeOwnerId),
      [controller]
    ),
    applyCloudAcknowledgment: useCallback(
      (
        input: Parameters<
          WorkspaceSnapshotCompatibilityController["applyCloudAcknowledgment"]
        >[0]
      ) => controller.applyCloudAcknowledgment(input),
      [controller]
    ),
    hydrateReconciledAsync: useCallback(
      (input: AsyncReconciledWorkspaceHydration) =>
        controller.hydrateReconciledAsync(input),
      [controller]
    ),
  };
}
