import type { Snapshot } from "./data";
import { WorkspaceDailyBackupCoordinator } from "./workspace-daily-backup-coordinator";
import { workspaceBackupFileName, type BackupSettings } from "./customer-backup";
import { isSnapshot } from "./data";
import { saveWorkspaceBackup, setBackupSettings } from "./cloud";

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

export async function runWorkspaceBackup(snapshot: Snapshot, settings: BackupSettings, ownerId: string, kind: "manual" | "scheduled", onProgress?: (done: number, total: number) => void): Promise<string> {
  if (!isSnapshot(snapshot)) throw new Error("Current workspace could not be backed up.");
  onProgress?.(0, 2);
  const result = await saveWorkspaceBackup(snapshot, kind, ownerId);
  onProgress?.(1, 2);
  await setBackupSettings(settings, ownerId, new Date().toISOString());
  onProgress?.(2, 2);
  const name = workspaceBackupFileName(result.created_at, settings.tz);
  return `Backup done ✓ ${name}`;
}


