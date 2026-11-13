import type { Snapshot } from "./data";
import { WorkspaceDailyBackupCoordinator } from "./workspace-daily-backup-coordinator";
import { prepareCustomerBackups, type BackupSettings } from "./customer-backup";
import { saveCustomerBackups, setBackupSettings } from "./cloud";

export type DailyBackupLifecycleSchedule = { ownerId: string; snapshot: Snapshot; snapshotGeneration: number; canAttempt: () => boolean | Promise<boolean> };

/** Invalidates queued retries and resolved cloud-save continuations when workspace lifetime changes. */
export class WorkspaceDailyBackupLifecycle {
  private generation = 0;
  constructor(private readonly coordinator: WorkspaceDailyBackupCoordinator) {}
  schedule(input: DailyBackupLifecycleSchedule) {
    const lifecycleGeneration = this.generation;
    return this.coordinator.acknowledge({
      ownerId: input.ownerId, generation: input.snapshotGeneration, snapshot: input.snapshot,
      canAttempt: async () => lifecycleGeneration === this.generation && await input.canAttempt(),
    });
  }
  invalidate() { this.generation += 1; this.coordinator.cancel(); }
}

export async function runSelectedCustomerBackup(snapshot: Snapshot, settings: BackupSettings, ownerId: string): Promise<string> {
  const { items, skipped } = await prepareCustomerBackups(snapshot, settings.customers);
  const result = items.length ? await saveCustomerBackups(items, ownerId) : { backed_up: 0, unchanged: 0 };
  await setBackupSettings(settings, ownerId, new Date().toISOString());
  return `Backed up ${result.backed_up}, unchanged ${result.unchanged}, skipped ${skipped.length}${skipped.length ? ". " + skipped.map(name => `${name} skipped: data problem`).join(". ") : ""}`;
}


