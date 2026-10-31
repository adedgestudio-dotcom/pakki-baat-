import type { DailyBackupStatus } from "./workspace-daily-backup-coordinator";
export type WorkspaceCloudSaveStatus =
  | { state: "idle" } | { state: "pending"; ownerId: string; generation: number } | { state: "saved"; ownerId: string; generation: number }
  | { state: "failed"; ownerId: string; generation: number } | { state: "offline"; ownerId: string; generation: number } | { state: "unavailable"; ownerId: string; generation: number };
export type BackupStatusPresentation = { label: string; detail?: string; tone: "neutral" | "success" | "warning" };
export type WorkspaceBackupStatusPresentation = { cloud: BackupStatusPresentation; recovery: BackupStatusPresentation };
export type DatedRecoveryHistoryState = "checking" | "matching" | "missing" | "unavailable";
const isCurrent = (status: { ownerId: string; generation: number }, ownerId: string | null, generation: number) => status.ownerId === ownerId && status.generation === generation;
/** An online event is not a successful save, but it invalidates an old offline display. */
export function clearStaleOfflineCloudSaveStatus(status: WorkspaceCloudSaveStatus, isOnline: boolean): WorkspaceCloudSaveStatus {
  return isOnline && status.state === "offline" ? { state: "idle" } : status;
}
/** Pure UI copy only. It neither starts nor retries backup work. */
export function presentWorkspaceBackupStatus({ cloud, recovery, ownerId, generation, datedRecoveryHistory }: { cloud: WorkspaceCloudSaveStatus; recovery: DailyBackupStatus; ownerId: string | null; generation: number; datedRecoveryHistory: DatedRecoveryHistoryState }): WorkspaceBackupStatusPresentation {
  const cloudCurrent = cloud.state !== "idle" && isCurrent(cloud, ownerId, generation);
  const recoveryCurrent = (recovery.state === "saving" || recovery.state === "retrying" || recovery.state === "confirmed" || recovery.state === "failed") && isCurrent(recovery, ownerId, generation);
  const cloudStatus: BackupStatusPresentation = !cloudCurrent ? { label: "Workspace save status will appear after your next saved change.", tone: "neutral" }
    : cloud.state === "pending" ? { label: "Workspace saving…", tone: "neutral" } : cloud.state === "saved" ? { label: "Workspace saved", tone: "success" }
    : cloud.state === "offline" ? { label: "Offline — changes stay on this device", tone: "neutral" } : cloud.state === "unavailable" ? { label: "Cloud saving unavailable", tone: "warning" } : { label: "Workspace not synced", tone: "warning" };
  const coordinatorRecoveryStatus: BackupStatusPresentation = !recoveryCurrent ? { label: "Recovery copy will start after your next saved change.", tone: "neutral" }
    : recovery.state === "saving" ? { label: "Creating today’s recovery copy…", tone: "neutral" } : recovery.state === "retrying" ? { label: "Preparing a recovery copy…", tone: "neutral" }
    : recovery.state === "confirmed" ? { label: "Today’s recovery copy is ready", tone: "success" } : { label: "Recovery copy needs attention", detail: "Your workspace was saved; this separate recovery copy was not confirmed.", tone: "warning" };
  const recoveryStatus: BackupStatusPresentation = !recoveryCurrent ? datedRecoveryHistory === "matching" ? { label: "A matching dated recovery copy is listed below.", tone: "success" } : coordinatorRecoveryStatus
    : recovery.state === "confirmed" && datedRecoveryHistory === "matching" ? { label: "Today's recovery copy is ready", tone: "success" }
    : recovery.state === "confirmed" && datedRecoveryHistory === "checking" ? { label: "Checking today's dated recovery copy...", tone: "neutral" }
    : recovery.state === "confirmed" && datedRecoveryHistory === "unavailable" ? { label: "Recovery copy status is unavailable", detail: "The backup was acknowledged, but dated backup history could not be checked.", tone: "warning" }
    : recovery.state === "confirmed" ? { label: "Recovery copy is not yet confirmed in dated history", detail: "Your workspace was saved, but this separate dated recovery copy is not listed yet.", tone: "warning" }
    : coordinatorRecoveryStatus;
  return { cloud: cloudStatus, recovery: recoveryStatus };
}


