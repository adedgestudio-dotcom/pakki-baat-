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

export async function runAllCustomerBackups(snapshot: Snapshot, settings: BackupSettings, ownerId: string, onProgress?: (done: number, total: number) => void): Promise<string> {
  const customers = customerNames(snapshot).map(normalizeCustomerName);
  if (!customers.length) return "Add a customer first.";
  onProgress?.(0, customers.length);
  await setBackupCustomers(customers, ownerId);
  const { items, skipped } = await prepareCustomerBackups(snapshot, customers);
  const result = { backed_up: 0, unchanged: 0, rejected: 0 };
  for (let start = 0; start < items.length; start += 25) {
    const batch = await saveCustomerBackups(items.slice(start, start + 25), ownerId);
    result.backed_up += batch.backed_up;
    result.unchanged += batch.unchanged;
    result.rejected += batch.rejected;
    onProgress?.(Math.min(start + 25, items.length) + skipped.length, customers.length);
  }
  if (!items.length) onProgress?.(customers.length, customers.length);
  await setBackupSettings(settings, ownerId, new Date().toISOString());
  return `Backed up ${result.backed_up}, unchanged ${result.unchanged}, skipped ${skipped.length}${result.rejected ? `, rejected ${result.rejected}` : ""}${skipped.length ? ". " + skipped.map(name => `${name} skipped: data problem`).join(". ") : ""}`;
}

export function backupSuccessToast(result: string): string {
  const backedUp = Number(/Backed up (\d+)/.exec(result)?.[1] || 0);
  const unchanged = Number(/unchanged (\d+)/.exec(result)?.[1] || 0);
  return backedUp === 0 && unchanged > 0 && /skipped 0/.test(result) && !/rejected [1-9]/.test(result)
    ? "Everything is already backed up" : `Backup done ✓ ${backedUp} customers backed up`;
}


