import type { Snapshot } from "./data";

export type DailyBackupStatus =
  | { state: "idle" }
  | { state: "saving"; ownerId: string; generation: number; attempt: number }
  | { state: "retrying"; ownerId: string; generation: number; attempt: number; retryInMs: number }
  | { state: "confirmed"; ownerId: string; generation: number }
  | { state: "failed"; ownerId: string; generation: number; attempts: number }
  | { state: "cancelled" };

export type DailyBackupAcknowledgment = { ownerId: string; generation: number; snapshot: Snapshot; canAttempt?: () => boolean | Promise<boolean> };
type Timer = ReturnType<typeof setTimeout>;
export type WorkspaceDailyBackupCoordinatorDependencies = {
  saveDailyBackup: (snapshot: Snapshot, ownerId: string) => Promise<void>;
  now?: () => Date; schedule?: (callback: () => void, delayMs: number) => Timer; cancelSchedule?: (timer: Timer) => void;
  onStatus?: (status: DailyBackupStatus) => void;
};
const retryDelaysMs = [5_000, 30_000, 120_000] as const;
const utcDay = (value: Date) => `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;

/** Client-only bounded retry coordinator for a legacy daily backup after a successful cloud save. */
export class WorkspaceDailyBackupCoordinator {
  private timer: Timer | null = null;
  private active: (DailyBackupAcknowledgment & { day: string; token: number; attempt: number }) | null = null;
  private completed = new Set<string>();
  private statusValue: DailyBackupStatus = { state: "idle" };
  private nextToken = 0;
  constructor(private readonly deps: WorkspaceDailyBackupCoordinatorDependencies) {}
  get status(): DailyBackupStatus { return this.statusValue; }
  acknowledge(acknowledgment: DailyBackupAcknowledgment) {
    const day = utcDay((this.deps.now || (() => new Date()))());
    const key = `${acknowledgment.ownerId}:${day}:${acknowledgment.generation}`;
    if (this.completed.has(key)) return Promise.resolve(this.statusValue);
    this.cancelPending(false);
    const active = { ...acknowledgment, day, token: ++this.nextToken, attempt: 0 };
    this.active = active;
    return this.attempt(active);
  }
  cancel() { this.cancelPending(true); }
  private setStatus(status: DailyBackupStatus) { this.statusValue = status; this.deps.onStatus?.(status); }
  private cancelPending(notify: boolean) {
    if (this.timer !== null) { (this.deps.cancelSchedule || clearTimeout)(this.timer); this.timer = null; }
    this.active = null;
    if (notify) this.setStatus({ state: "cancelled" });
  }
  private isCurrent(active: NonNullable<WorkspaceDailyBackupCoordinator["active"]>) { return this.active?.token === active.token; }
  private async attempt(active: NonNullable<WorkspaceDailyBackupCoordinator["active"]>) {
    if (!this.isCurrent(active)) return this.statusValue;
    const eligible = await active.canAttempt?.() ?? true;
    if (!this.isCurrent(active)) return this.statusValue;
    if (!eligible) { this.cancelPending(true); return this.statusValue; }
    this.setStatus({ state: "saving", ownerId: active.ownerId, generation: active.generation, attempt: active.attempt + 1 });
    try {
      await this.deps.saveDailyBackup(active.snapshot, active.ownerId);
      if (!this.isCurrent(active)) return this.statusValue;
      this.completed.add(`${active.ownerId}:${active.day}:${active.generation}`); this.active = null;
      this.setStatus({ state: "confirmed", ownerId: active.ownerId, generation: active.generation });
    } catch {
      if (!this.isCurrent(active)) return this.statusValue;
      const delay = retryDelaysMs[active.attempt];
      if (delay === undefined) { this.active = null; this.setStatus({ state: "failed", ownerId: active.ownerId, generation: active.generation, attempts: active.attempt + 1 }); return this.statusValue; }
      active.attempt += 1;
      this.setStatus({ state: "retrying", ownerId: active.ownerId, generation: active.generation, attempt: active.attempt, retryInMs: delay });
      this.timer = (this.deps.schedule || setTimeout)(() => { this.timer = null; void this.attempt(active); }, delay);
    }
    return this.statusValue;
  }
}


