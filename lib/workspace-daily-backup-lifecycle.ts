import type { Snapshot } from "./data";
import { WorkspaceDailyBackupCoordinator } from "./workspace-daily-backup-coordinator";
import { customerNames, prepareCustomerBackups, type BackupSettings } from "./customer-backup";
import { normalizeCustomerName } from "./customer-name";
import { saveCustomerBackups, setBackupCustomers, setBackupSettings } from "./cloud";

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

export async function runAllCustomerBackups(snapshot: Snapshot, settings: BackupSettings, ownerId: string): Promise<string> {
  const customers = customerNames(snapshot).map(normalizeCustomerName);
  if (!customers.length) return "Add a customer first.";
  await setBackupCustomers(customers, ownerId);
  const { items, skipped } = await prepareCustomerBackups(snapshot, customers);
  const result = items.length ? await saveCustomerBackups(items, ownerId) : { backed_up: 0, unchanged: 0, rejected: 0 };
  await setBackupSettings(settings, ownerId, new Date().toISOString());
  return `Backed up ${result.backed_up}, unchanged ${result.unchanged}, skipped ${skipped.length}${result.rejected ? `, rejected ${result.rejected}` : ""}${skipped.length ? ". " + skipped.map(name => `${name} skipped: data problem`).join(". ") : ""}`;
}


