import type { WorkspaceBackup } from "./cloud";
import type { DatedRecoveryHistoryState } from "./workspace-backup-status";

type OwnerSession = { user: { id: string } } | null;
export type RetentionState = "loaded" | "schema-unavailable" | "unavailable";
export type LoadedBackupHistoryState = "checking" | "loaded" | "unavailable";
export type BackupHistoryLoadResult =
  | { state: "cancelled" }
  | { state: "unavailable"; retention: 15 | 30 | null; retentionState: RetentionState }
  | { state: "loaded"; backups: WorkspaceBackup[]; retention: 15 | 30 | null; retentionState: RetentionState };

function retentionFailureState(error: unknown): RetentionState {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  return code === "PGRST205" || code === "42P01"
    ? "schema-unavailable"
    : "unavailable";
}

/** Reads dated backup history independently from the optional retention preference. */
export async function loadWorkspaceBackupHistory(input: {
  ownerId: string;
  currentSession: () => Promise<OwnerSession>;
  loadBackups: (ownerId: string) => Promise<WorkspaceBackup[]>;
  loadRetention: () => Promise<15 | 30 | null>;
}): Promise<BackupHistoryLoadResult> {
  const before = await input.currentSession();
  if (!before || before.user.id !== input.ownerId) return { state: "cancelled" };
  const [history, retention] = await Promise.allSettled([input.loadBackups(input.ownerId), input.loadRetention()]);
  const after = await input.currentSession();
  if (!after || after.user.id !== input.ownerId) return { state: "cancelled" };
  const retentionState: RetentionState = retention.status === "fulfilled" ? "loaded" : retentionFailureState(retention.reason);
  const retentionValue = retention.status === "fulfilled" ? retention.value : null;
  if (history.status !== "fulfilled" || !Array.isArray(history.value)) return { state: "unavailable", retention: retentionValue, retentionState };
  return { state: "loaded", backups: history.value, retention: retentionValue, retentionState };
}

/** The same rows rendered in Backup History are the only rows that can confirm readiness. */
export function datedRecoveryHistoryState(input: {
  backups: WorkspaceBackup[];
  historyState: LoadedBackupHistoryState;
  utcDay: string;
  matchesCurrentSnapshot: (payload: unknown) => boolean;
}): DatedRecoveryHistoryState {
  if (input.historyState === "unavailable") return "unavailable";
  if (input.historyState !== "loaded") return "checking";
  return input.backups.some(backup => backup.backup_kind === "daily" && backup.backup_day === input.utcDay && input.matchesCurrentSnapshot(backup.payload)) ? "matching" : "missing";
}


