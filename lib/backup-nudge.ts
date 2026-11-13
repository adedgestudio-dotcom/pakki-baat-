export type BackupNudgeState = {
  firstSeen?: number;
  dismissedAt?: number;
  dismissCount?: number;
  completed?: boolean;
};

export type NudgeStorage = Pick<Storage, "getItem" | "setItem">;
const DAY = 86_400_000;
const key = (accountId: string) => `pakki-baat-backup-nudge:${accountId}`;

export function readBackupNudge(storage: NudgeStorage, accountId: string): BackupNudgeState | null {
  try {
    const raw = storage.getItem(key(accountId));
    const value = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== "object") return {};
    return value;
  } catch {
    return null;
  }
}

export function rememberFirstUse(storage: NudgeStorage, accountId: string, now = Date.now()): BackupNudgeState | null {
  const state = readBackupNudge(storage, accountId);
  if (!state) return null;
  if (Number.isFinite(state.firstSeen)) return state;
  const next = { ...state, firstSeen: now };
  try {
    storage.setItem(key(accountId), JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

export function recordBackupNudge(storage: NudgeStorage, accountId: string, action: "snooze" | "setup", now = Date.now()): void {
  const state = readBackupNudge(storage, accountId);
  if (!state) return;
  const next = action === "setup"
    ? { ...state, completed: true }
    : { ...state, dismissedAt: now, dismissCount: (Number.isFinite(state.dismissCount) ? state.dismissCount! : 0) + 1 };
  try { storage.setItem(key(accountId), JSON.stringify(next)); } catch {}
}

export function backupNudgeDue(input: {
  ready: boolean; signedIn: boolean; activeSubscription: boolean; ledgerMode: boolean;
  cloudConflict: boolean; online: boolean; listScreen: boolean; blockedByUi: boolean;
  frequency: string; lastRunAt: string | null; hasBackups: boolean;
  entryCount: number; state: BackupNudgeState | null; now: number;
}): boolean {
  const { state } = input;
  return input.ready && input.signedIn && input.activeSubscription && input.ledgerMode &&
    !input.cloudConflict && input.online && input.listScreen && !input.blockedByUi &&
    input.frequency === "off" && input.lastRunAt === null && !input.hasBackups &&
    !state?.completed && (state?.dismissCount || 0) < 3 &&
    (!Number.isFinite(state?.dismissedAt) || input.now - state!.dismissedAt! >= 2 * DAY) &&
    (input.entryCount >= 3 || (Number.isFinite(state?.firstSeen) && input.now - state!.firstSeen! >= DAY));
}
