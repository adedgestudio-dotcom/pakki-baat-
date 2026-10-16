import type { Snapshot } from "./data";
import { WorkspaceDailyBackupCoordinator } from "./workspace-daily-backup-coordinator";

export type DailyBackupLifecycleSchedule = {
  ownerId: string;
  snapshot: Snapshot;
  snapshotGeneration: number;
  /** Validates disposal, active owner/session, recovery state, and snapshot freshness. */
  canAttempt: () => boolean | Promise<boolean>;
};

/**
 * Invalidates both queued retry timers and already-resolved cloud-save
 * continuations. The component owns the live eligibility callback because it
 * alone knows its session, recovery, and snapshot state.
 */
export class WorkspaceDailyBackupLifecycle {
  private generation = 0;

  constructor(private readonly coordinator: WorkspaceDailyBackupCoordinator) {}

  schedule(input: DailyBackupLifecycleSchedule) {
    const lifecycleGeneration = this.generation;
    return this.coordinator.acknowledge({
      ownerId: input.ownerId,
      generation: input.snapshotGeneration,
      snapshot: input.snapshot,
      canAttempt: async () => lifecycleGeneration === this.generation && await input.canAttempt(),
    });
  }

  invalidate() {
    this.generation += 1;
    this.coordinator.cancel();
  }
}
