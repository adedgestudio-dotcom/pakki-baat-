import type { Snapshot } from "./data";
import { WorkspaceDailyBackupCoordinator } from "./workspace-daily-backup-coordinator";
import { workspaceBackupFileName, type BackupSettings } from "./customer-backup";
import { isSnapshot } from "./data";
import { saveWorkspaceBackup, setBackupSettings, waitForCloudSaveQueue } from "./cloud";

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

export async function runWorkspaceBackup(snapshot: Snapshot, settings: BackupSettings, ownerId: string, onProgress?: (done: number, total: number) => void): Promise<string> {
  if (!isSnapshot(snapshot)) throw new Error("Current workspace could not be backed up.");
  onProgress?.(0, 3);
  await waitForCloudSaveQueue(ownerId);
  onProgress?.(1, 3);
  const result = await saveWorkspaceBackup(snapshot, "manual", ownerId);
  onProgress?.(2, 3);
  await setBackupSettings(settings, ownerId, result.created_at);
  onProgress?.(3, 3);
  const name = workspaceBackupFileName(result.created_at, settings.tz);
  return `Backup done ✓ ${name}`;
}

export class ManualWorkspaceBackupRunner {
  private running = false;
  get isRunning() { return this.running; }
  async run(snapshot: Snapshot, settings: BackupSettings, ownerId: string, onProgress?: (done: number, total: number) => void): Promise<string | null> {
    if (this.running) return null;
    this.running = true;
    try { return await runWorkspaceBackup(snapshot, settings, ownerId, onProgress); }
    finally { this.running = false; }
  }
}


