import type { Snapshot } from "./data";
import {
  WorkspaceJournalCoordinator,
  type JournalCloudAcknowledgment,
  type JournalCoordinatorResult,
  type WorkspaceJournalCoordinatorDependencies,
} from "./workspace-journal-coordinator";
import { isPendingWorkspaceJournal, type PendingWorkspaceJournal } from "./workspace-journal";
import type { WorkspaceSourceSelection } from "./workspace-source-selection-policy";
import type { ReconciliationResult } from "./workspace-reconciliation";

export type JournalLifecycleReason = "durable-journal" | "connectivity-restored" | "startup-pending" | "startup-acknowledged" | "retry";
export type JournalLifecycleSchedule = (task: () => Promise<void>, context: { ownerId: string; operationId: string; generation: number; reason: JournalLifecycleReason; retryAttempt: number }) => void;
export type JournalLifecycleDecision = { scheduled: true } | { scheduled: false; reason: string };

export type WorkspaceJournalLifecycleDriverDependencies = WorkspaceJournalCoordinatorDependencies & {
  sourceSelection: () => WorkspaceSourceSelection;
  schedule: JournalLifecycleSchedule;
  /** The acknowledgment object is coordinator-issued and must be forwarded unchanged. */
  onAcknowledged: (acknowledgment: JournalCloudAcknowledgment, context: JournalLifecycleAcknowledgmentContext) => void | Promise<void>;
  /** Optional and strictly post-acknowledgment. Failure must not undo an acknowledgment. */
  postAcknowledgmentBackup?: (acknowledgment: JournalCloudAcknowledgment) => Promise<unknown>;
};

export type JournalLifecycleAcknowledgmentContext = {
  ownerId: string;
  generation: number;
  journal: PendingWorkspaceJournal;
};

export type StartupJournalRecovery = {
  ownerId: string;
  confirmedRevision: number | null;
  reconciliation: ReconciliationResult;
};

type ActiveJournal = { ownerId: string; generation: number; journal: PendingWorkspaceJournal; retryAttempt: number; startupConfirmedRevision?: number };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const keyFor = (record: ActiveJournal) => `${record.ownerId}:${record.generation}:${record.journal.operationId}`;

/**
 * Non-React lifecycle owner for guarded journals. It owns exactly one stable
 * coordinator and has no timers, browser listeners, generic autosave, ledger,
 * destructive-workflow, or legacy saveCloud dependency.
 */
export class WorkspaceJournalLifecycleDriver {
  private readonly coordinator: WorkspaceJournalCoordinator;
  private generation = 0;
  private disposed = false;
  private latest: ActiveJournal | null = null;
  private scheduled = new Set<string>();

  constructor(private readonly deps: WorkspaceJournalLifecycleDriverDependencies) {
    this.coordinator = new WorkspaceJournalCoordinator(deps);
  }

  async onDurableJournal(journal: PendingWorkspaceJournal, snapshot: Snapshot): Promise<JournalLifecycleDecision> {
    const record = this.activate(journal, snapshot);
    if (!record) return { scheduled: false, reason: "Durable journal does not match the active guarded workspace." };
    return this.enqueue(record, "durable-journal");
  }

  async onConnectivityRestored(): Promise<JournalLifecycleDecision> {
    if (!this.latest) return { scheduled: false, reason: "No guarded journal is pending for retry." };
    return this.enqueue(this.latest, "connectivity-restored");
  }

  async onStartupRecovery(input: StartupJournalRecovery): Promise<JournalLifecycleDecision> {
    const { reconciliation } = input;
    if (reconciliation.state === "journal-pending") {
      const journal = this.deps.readCurrentJournal(input.ownerId);
      if (!journal || !reconciliation.displaySnapshot || !same(journal.snapshot, reconciliation.displaySnapshot)) {
        return { scheduled: false, reason: "Startup pending journal no longer matches the selected recovery snapshot." };
      }
      const record = this.activate(journal, reconciliation.displaySnapshot);
      return record ? this.enqueue(record, "startup-pending") : { scheduled: false, reason: "Startup journal is not eligible for guarded synchronization." };
    }
    if (reconciliation.state === "journal-acknowledged") {
      const journal = reconciliation.acknowledgmentCandidate;
      if (!journal || journal.baseRevision === null || !reconciliation.displaySnapshot || !Number.isSafeInteger(input.confirmedRevision) || input.confirmedRevision === null
        || input.confirmedRevision < journal.baseRevision) {
        return { scheduled: false, reason: "Startup cloud acknowledgment lacks an exact journal or confirmed revision." };
      }
      const record = this.activate(journal, reconciliation.displaySnapshot, input.confirmedRevision);
      return record ? this.enqueue(record, "startup-acknowledged") : { scheduled: false, reason: "Startup acknowledgment is not eligible for the active guarded workspace." };
    }
    return { scheduled: false, reason: `Startup recovery state ${reconciliation.state} is intentionally not auto-synchronized.` };
  }

  onOwnerChanged(ownerId: string | null) {
    this.generation += 1;
    this.latest = null;
    this.scheduled.clear();
    // This intentionally never deletes the previous owner's journal.
    void ownerId;
  }

  dispose() {
    this.disposed = true;
    this.generation += 1;
    this.latest = null;
    this.scheduled.clear();
  }

  private activate(journal: PendingWorkspaceJournal, snapshot: Snapshot, startupConfirmedRevision?: number): ActiveJournal | null {
    if (!isPendingWorkspaceJournal(journal) || !same(journal.snapshot, snapshot) || journal.syncStrategy !== "revisioned" || journal.baseRevision === null) return null;
    const selection = this.deps.sourceSelection();
    if (this.disposed || selection.source !== "guarded-signed-in" || selection.ownerId !== journal.ownerId) return null;
    const existing = this.latest;
    if (existing && existing.ownerId === journal.ownerId && same(existing.journal, journal)) return existing;
    const record = { ownerId: journal.ownerId, generation: this.generation, journal, retryAttempt: 0, startupConfirmedRevision };
    this.latest = record;
    return record;
  }

  private async enqueue(record: ActiveJournal, reason: JournalLifecycleReason): Promise<JournalLifecycleDecision> {
    if (!(await this.isCurrent(record))) return { scheduled: false, reason: "Owner, authenticated session, guarded source, or lifecycle generation changed before scheduling." };
    const key = keyFor(record);
    if (this.scheduled.has(key)) return { scheduled: false, reason: "This exact journal operation is already scheduled." };
    this.scheduled.add(key);
    this.deps.schedule(async () => {
      this.scheduled.delete(key);
      await this.run(record, reason);
    }, { ownerId: record.ownerId, operationId: record.journal.operationId, generation: record.generation, reason, retryAttempt: record.retryAttempt });
    return { scheduled: true };
  }

  private async run(record: ActiveJournal, reason: JournalLifecycleReason) {
    if (!(await this.isCurrent(record))) return;
    if (reason === "startup-acknowledged") {
      await this.applyStartupAcknowledgment(record);
      return;
    }
    const result = await this.coordinator.upload({ ownerId: record.ownerId, operationId: record.journal.operationId, snapshot: record.journal.snapshot, journal: record.journal });
    if (result.status === "acknowledged") {
      await this.deliverAcknowledgment(record, result.acknowledgment);
      return;
    }
    if ((result.status === "offline" || result.status === "ambiguous") && await this.isCurrent(record)) {
      const retry = { ...record, retryAttempt: record.retryAttempt + 1 };
      this.latest = retry;
      await this.enqueue(retry, "retry");
    }
  }

  private async applyStartupAcknowledgment(record: ActiveJournal) {
    if (!(await this.isCurrent(record))) return;
    const revision = record.startupConfirmedRevision ?? record.journal.baseRevision;
    if (revision === null) return;
    try {
      this.deps.acknowledgeExactLocalJournal(record.ownerId, record.journal, record.journal.snapshot);
    } catch {
      return;
    }
    if (!(await this.isCurrent(record, false))) return;
    const acknowledgment = this.coordinator.acknowledgmentForExactLocalConfirmation(record.journal, revision);
    if (acknowledgment) await this.deliverAcknowledgment(record, acknowledgment);
  }

  private async deliverAcknowledgment(record: ActiveJournal, acknowledgment: JournalCloudAcknowledgment) {
    if (!(await this.isCurrent(record, false)) || acknowledgment.ownerId !== record.ownerId || acknowledgment.operationId !== record.journal.operationId || !same(acknowledgment.snapshot, record.journal.snapshot)) return;
    await this.deps.onAcknowledged(acknowledgment, {
      ownerId: record.ownerId,
      generation: record.generation,
      journal: record.journal,
    });
    // A best-effort post-ack backup must never alter acknowledged status.
    try { await this.deps.postAcknowledgmentBackup?.(acknowledgment); } catch {}
  }

  private async isCurrent(record: ActiveJournal, requireStoredJournal = true) {
    if (this.disposed || this.generation !== record.generation || this.latest?.generation !== record.generation || !same(this.latest?.journal, record.journal)) return false;
    const selection = this.deps.sourceSelection();
    if (selection.source !== "guarded-signed-in" || selection.ownerId !== record.ownerId) return false;
    return (await this.deps.activeOwnerId()) === record.ownerId && (!requireStoredJournal || same(this.deps.readCurrentJournal(record.ownerId), record.journal));
  }
}
