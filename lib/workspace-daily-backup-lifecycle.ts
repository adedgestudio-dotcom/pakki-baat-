import type { Snapshot } from "./data";
import { WorkspaceDailyBackupCoordinator } from "./workspace-daily-backup-coordinator";
import { hashWorkspaceSnapshot, workspaceBackupDateTime, workspaceBackupFileName, type BackupSettings } from "./customer-backup";
import { isSnapshot } from "./data";
import { loadLatestWorkspaceBackup, saveWorkspaceBackup, setBackupSettings } from "./cloud";

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
  onProgress?.(0, 4);
  const hash = await hashWorkspaceSnapshot(snapshot);
  onProgress?.(1, 4);
  const latest = await loadLatestWorkspaceBackup(ownerId);
  onProgress?.(2, 4);
  let result: { created: boolean; created_at: string };
  if (latest && isSnapshot(latest.payload) && hash === await hashWorkspaceSnapshot(latest.payload)) {
    result = { created: false, created_at: latest.created_at };
  } else {
    result = await saveWorkspaceBackup(snapshot, kind, ownerId);
  }
  onProgress?.(3, 4);
  await setBackupSettings(settings, ownerId, new Date().toISOString());
  onProgress?.(4, 4);
  const name = workspaceBackupFileName(result.created_at, settings.tz);
  return result.created ? `Backup done ✓ ${name}` : `No changes since ${workspaceBackupDateTime(result.created_at, settings.tz)}.`;
}


