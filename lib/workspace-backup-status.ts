import type { DailyBackupStatus } from "./workspace-daily-backup-coordinator";

export type WorkspaceCloudSaveStatus =
  | { state: "idle" }
  | { state: "pending"; ownerId: string; generation: number }
  | { state: "saved"; ownerId: string; generation: number }
  | { state: "failed"; ownerId: string; generation: number }
  | { state: "offline"; ownerId: string; generation: number }
  | { state: "unavailable"; ownerId: string; generation: number };

export type BackupStatusPresentation = { label: string; detail?: string; tone: "neutral" | "success" | "warning" };
export type WorkspaceBackupStatusPresentation = { cloud: BackupStatusPresentation; recovery: BackupStatusPresentation };

function isCurrent(status: { ownerId: string; generation: number }, ownerId: string | null, generation: number) {
  return status.ownerId === ownerId && status.generation === generation;
}

/** Pure UI copy only. It neither starts nor retries backup work. */
export function presentWorkspaceBackupStatus({ cloud, recovery, ownerId, generation }: {
  cloud: WorkspaceCloudSaveStatus; recovery: DailyBackupStatus; ownerId: string | null; generation: number;
}): WorkspaceBackupStatusPresentation {
  const cloudCurrent = cloud.state !== "idle" && isCurrent(cloud, ownerId, generation);
  const recoveryCurrent = (recovery.state === "saving" || recovery.state === "retrying" || recovery.state === "confirmed" || recovery.state === "failed") && isCurrent(recovery, ownerId, generation);
  const cloudStatus: BackupStatusPresentation = !cloudCurrent ? { label: "Workspace save status will appear after your next saved change.", tone: "neutral" }
    : cloud.state === "pending" ? { label: "Workspace saving…", tone: "neutral" }
    : cloud.state === "saved" ? { label: "Workspace saved", tone: "success" }
    : cloud.state === "offline" ? { label: "Offline — changes stay on this device", tone: "neutral" }
    : cloud.state === "unavailable" ? { label: "Cloud saving unavailable", tone: "warning" }
    : { label: "Workspace not synced", tone: "warning" };
  const recoveryStatus: BackupStatusPresentation = !recoveryCurrent ? { label: "Recovery copy will start after your next saved change.", tone: "neutral" }
    : recovery.state === "saving" ? { label: "Creating today’s recovery copy…", tone: "neutral" }
    : recovery.state === "retrying" ? { label: "Preparing a recovery copy…", tone: "neutral" }
    : recovery.state === "confirmed" ? { label: "Today’s recovery copy is ready", tone: "success" }
    : { label: "Recovery copy needs attention", detail: "Your workspace was saved; this separate recovery copy was not confirmed.", tone: "warning" };
  return { cloud: cloudStatus, recovery: recoveryStatus };
}
