import type { JournalCloudAcknowledgment } from "./workspace-journal-coordinator";
import {
  restoreExactPendingWorkspaceJournal,
  type PendingWorkspaceJournal,
  type WorkspaceStorage,
} from "./workspace-journal";
import type { WorkspaceSnapshotAcknowledgmentTarget } from "./workspace-snapshot-compatibility";
import type { WorkspaceSourceSelection } from "./workspace-source-selection-policy";

export type LifecycleBoundaryAcknowledgmentContext = {
  ownerId: string;
  generation: number;
  journal: PendingWorkspaceJournal;
};

export type LifecycleBoundaryHandoffResult =
  | { status: "applied" }
  | { status: "duplicate"; reason: string }
  | { status: "recovery-required"; reason: string; journalRestored: boolean };

export type WorkspaceLifecycleBoundaryAcknowledgmentHandoffDependencies = {
  /** A controller/compatibility-owned boundary capability, never a second boundary instance. */
  boundary: WorkspaceSnapshotAcknowledgmentTarget;
  activeOwnerId: () => Promise<string | null>;
  sessionOwnerId: () => Promise<string | null>;
  sourceSelection: () => WorkspaceSourceSelection;
  storage?: WorkspaceStorage;
};

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const keyFor = (context: LifecycleBoundaryAcknowledgmentContext) => `${context.ownerId}:${context.generation}:${context.journal.operationId}`;

/**
 * Isolated bridge between the lifecycle driver and the guarded Snapshot
 * boundary. It performs no cloud work. A rejected boundary handoff restores
 * the exact journal safely, so the account remains in explicit recovery.
 */
export class WorkspaceLifecycleBoundaryAcknowledgmentHandoff {
  private generation = 0;
  private disposed = false;
  private readonly inFlight = new Map<string, Promise<LifecycleBoundaryHandoffResult>>();
  private readonly applied = new Set<string>();

  constructor(private readonly deps: WorkspaceLifecycleBoundaryAcknowledgmentHandoffDependencies) {}

  /** Pass this directly as the lifecycle driver's onAcknowledged callback. */
  asLifecycleAcknowledgmentHandler() {
    return (acknowledgment: JournalCloudAcknowledgment, context: LifecycleBoundaryAcknowledgmentContext) => this.apply(acknowledgment, context);
  }

  apply(
    acknowledgment: JournalCloudAcknowledgment,
    context: LifecycleBoundaryAcknowledgmentContext,
  ): Promise<LifecycleBoundaryHandoffResult> {
    const key = keyFor(context);
    if (this.applied.has(key)) return Promise.resolve({ status: "duplicate", reason: "This exact cloud acknowledgment was already applied." });
    const running = this.inFlight.get(key);
    if (running) return running;
    const task = this.run(acknowledgment, context).finally(() => {
      if (this.inFlight.get(key) === task) this.inFlight.delete(key);
    });
    this.inFlight.set(key, task);
    return task;
  }

  onOwnerChanged() {
    this.generation += 1;
    this.inFlight.clear();
  }

  dispose() {
    this.disposed = true;
    this.generation += 1;
    this.inFlight.clear();
  }

  private async run(
    acknowledgment: JournalCloudAcknowledgment,
    context: LifecycleBoundaryAcknowledgmentContext,
  ): Promise<LifecycleBoundaryHandoffResult> {
    const invalid = await this.invalidReason(acknowledgment, context);
    if (invalid) return this.recover(context, invalid);

    const activeOwnerId = await this.deps.activeOwnerId();
    const sessionOwnerId = await this.deps.sessionOwnerId();
    if (await this.invalidReason(acknowledgment, context)) {
      return this.recover(context, "Owner, session, source selection, or lifecycle generation changed during acknowledgment handoff.");
    }
    const result = this.deps.boundary.applyCloudAcknowledgment({
      activeOwnerId,
      sessionOwnerId,
      journal: context.journal,
      // Preserve coordinator-issued opaque object identity; never reconstruct it.
      acknowledgment,
      storage: this.deps.storage,
    });
    if (result.accepted) {
      this.applied.add(keyFor(context));
      return { status: "applied" };
    }
    return this.recover(context, result.reason);
  }

  private async invalidReason(
    acknowledgment: JournalCloudAcknowledgment,
    context: LifecycleBoundaryAcknowledgmentContext,
  ): Promise<string | null> {
    if (this.disposed || context.generation !== this.generation) return "Lifecycle handoff is stale or disposed.";
    if (acknowledgment.ownerId !== context.ownerId || acknowledgment.operationId !== context.journal.operationId
      || !same(acknowledgment.snapshot, context.journal.snapshot)) return "Cloud acknowledgment does not match its durable journal context.";
    const selection = this.deps.sourceSelection();
    if (selection.source !== "guarded-signed-in" || selection.ownerId !== context.ownerId) {
      return "Acknowledgment does not belong to the current guarded account.";
    }
    const [activeOwnerId, sessionOwnerId] = await Promise.all([this.deps.activeOwnerId(), this.deps.sessionOwnerId()]);
    if (activeOwnerId !== context.ownerId || sessionOwnerId !== context.ownerId) {
      return "Authenticated account changed before acknowledgment handoff.";
    }
    return null;
  }

  private recover(context: LifecycleBoundaryAcknowledgmentContext, reason: string): LifecycleBoundaryHandoffResult {
    try {
      restoreExactPendingWorkspaceJournal(context.journal, this.deps.storage);
      return { status: "recovery-required", reason, journalRestored: true };
    } catch {
      return { status: "recovery-required", reason: `${reason} The exact journal could not be restored locally; recovery requires immediate user action.`, journalRestored: false };
    }
  }
}
