import type { Snapshot } from "./data";
import { WorkspaceDailyBackupLifecycle } from "./workspace-daily-backup-lifecycle";
type SessionOwner = { user: { id: string } } | null;

export type DailyBackupPostSaveInput = {
  lifecycle: WorkspaceDailyBackupLifecycle; snapshot: Snapshot; ownerId: string; snapshotGeneration: number;
  isDisposed: () => boolean; activeOwnerId: () => string | null; isAutosavePaused: () => boolean;
  isRecoveryBlocked: () => boolean; currentSnapshotGeneration: () => number; currentSession: () => Promise<SessionOwner>;
};

/** Sole post-save continuation; backup failure remains independent from successful saveCloud completion. */
export async function scheduleDailyBackupAfterCloudSave(input: DailyBackupPostSaveInput) {
  const eligible = async () => {
    if (input.isDisposed() || input.activeOwnerId() !== input.ownerId || input.isAutosavePaused() || input.isRecoveryBlocked() || input.currentSnapshotGeneration() !== input.snapshotGeneration) return false;
    const session = await input.currentSession().catch(() => null);
    return !input.isDisposed() && input.activeOwnerId() === input.ownerId && session?.user.id === input.ownerId
      && !input.isAutosavePaused() && !input.isRecoveryBlocked() && input.currentSnapshotGeneration() === input.snapshotGeneration;
  };
  if (!(await eligible())) return false;
  await input.lifecycle.schedule({ ownerId: input.ownerId, snapshot: input.snapshot, snapshotGeneration: input.snapshotGeneration, canAttempt: eligible });
  return true;
}


