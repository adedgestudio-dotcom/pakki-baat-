import type { Snapshot } from "./data";
import { guardedWorkspaceReducer, type GuardedWorkspaceState } from "./workspace-guarded-reducer";
import { isPendingWorkspaceJournal, type PendingWorkspaceJournal } from "./workspace-journal";

export type JournalOnlyTransportResult =
  | { status: "cloud-acknowledged"; acknowledgment: { ownerId: string; snapshot: Snapshot; revision: number | null } }
  | { status: "offline" | "ambiguous" | "pending" | "conflict" | "manual" | "account-changed"; reason: string };

/** The only transport shape the future guarded coordinator may call. */
export type JournalOnlyRevisionedTransport = (journal: PendingWorkspaceJournal, expectedOwnerId: string) => Promise<JournalOnlyTransportResult>;

export type JournalCloudAcknowledgment = {
  ownerId: string;
  operationId: string;
  snapshot: Snapshot;
  revision: number;
};
const trustedAcknowledgments = new WeakSet<object>();

function trustedAcknowledgment(journal: PendingWorkspaceJournal, revision: number): JournalCloudAcknowledgment {
  const acknowledgment = Object.freeze({ ownerId: journal.ownerId, operationId: journal.operationId, snapshot: journal.snapshot, revision });
  trustedAcknowledgments.add(acknowledgment);
  return acknowledgment;
}

/** Boundary callers reject structurally forged acknowledgment objects. */
export function isTrustedJournalCloudAcknowledgment(value: unknown): value is JournalCloudAcknowledgment {
  return Boolean(value && typeof value === "object" && trustedAcknowledgments.has(value));
}

export type JournalCoordinatorResult =
  | { status: "acknowledged"; acknowledgment: JournalCloudAcknowledgment }
  | { status: "offline" | "ambiguous" | "pending" | "conflict" | "manual" | "stale-owner" | "stale-operation" | "local-acknowledgment-failed"; reason: string };
type JournalCoordinatorFailure = Exclude<JournalCoordinatorResult, { status: "acknowledged" }>;

export type WorkspaceJournalCoordinatorDependencies = {
  activeOwnerId: () => Promise<string | null>;
  isOnline: () => boolean;
  readCurrentJournal: (ownerId: string) => PendingWorkspaceJournal | null;
  /** Must re-read storage and delete only the exact supplied journal. */
  acknowledgeExactLocalJournal: (ownerId: string, journal: PendingWorkspaceJournal, confirmedSnapshot: Snapshot) => void;
  transport: JournalOnlyRevisionedTransport;
};

export type JournalCoordinatorRequest = {
  ownerId: string;
  operationId: string;
  snapshot: Snapshot;
  journal: PendingWorkspaceJournal;
};

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const operationKey = (ownerId: string, operationId: string) => `${ownerId}:${operationId}`;

/**
 * Isolated guarded persistence coordinator. It never invokes generic
 * saveCloud, does not own React state, and leaves retry scheduling to its
 * future caller. Repeating upload() after offline/ambiguous outcomes is safe.
 */
export class WorkspaceJournalCoordinator {
  private readonly inFlight = new Map<string, { journal: PendingWorkspaceJournal; promise: Promise<JournalCoordinatorResult> }>();

  constructor(private readonly deps: WorkspaceJournalCoordinatorDependencies) {}

  upload(request: JournalCoordinatorRequest): Promise<JournalCoordinatorResult> {
    const preflight = validateRequest(request);
    if (preflight) return Promise.resolve(preflight);
    const key = operationKey(request.ownerId, request.operationId);
    const existing = this.inFlight.get(key);
    if (existing) {
      return same(existing.journal, request.journal)
        ? existing.promise
        : Promise.resolve({ status: "stale-operation", reason: "The same operation identity was reused with a different pending journal." });
    }
    const promise = this.run(request).finally(() => {
      if (this.inFlight.get(key)?.promise === promise) this.inFlight.delete(key);
    });
    this.inFlight.set(key, { journal: request.journal, promise });
    return promise;
  }

  private async run(request: JournalCoordinatorRequest): Promise<JournalCoordinatorResult> {
    if (!this.deps.isOnline()) return { status: "offline", reason: "The device is offline; the durable journal remains pending." };
    if ((await this.deps.activeOwnerId()) !== request.ownerId) {
      return { status: "stale-owner", reason: "The active authenticated account changed before journal upload." };
    }
    if (!matchesCurrent(this.deps.readCurrentJournal(request.ownerId), request.journal)) {
      return { status: "stale-operation", reason: "The pending journal changed before cloud upload." };
    }

    const transport = await this.deps.transport(request.journal, request.ownerId);
    if (transport.status !== "cloud-acknowledged") return mapTransportOutcome(transport);
    if ((await this.deps.activeOwnerId()) !== request.ownerId) {
      return { status: "stale-owner", reason: "The active authenticated account changed after cloud upload." };
    }
    const acknowledgment = transport.acknowledgment;
    if (acknowledgment.ownerId !== request.ownerId || !same(acknowledgment.snapshot, request.journal.snapshot)
      || !Number.isSafeInteger(acknowledgment.revision) || acknowledgment.revision === null || acknowledgment.revision < request.journal.baseRevision!) {
      return { status: "ambiguous", reason: "Cloud response did not exactly acknowledge this pending journal." };
    }
    if (!matchesCurrent(this.deps.readCurrentJournal(request.ownerId), request.journal)) {
      return { status: "stale-operation", reason: "A newer pending journal replaced this operation before local acknowledgment." };
    }
    try {
      this.deps.acknowledgeExactLocalJournal(request.ownerId, request.journal, acknowledgment.snapshot);
    } catch (error) {
      return { status: "local-acknowledgment-failed", reason: error instanceof Error ? error.message : "The exact cloud result could not be acknowledged locally." };
    }
    const remaining = this.deps.readCurrentJournal(request.ownerId);
    if (remaining && same(remaining, request.journal)) {
      return { status: "local-acknowledgment-failed", reason: "The pending journal remained after local acknowledgment." };
    }
    if (remaining) return { status: "stale-operation", reason: "A newer journal exists; this acknowledgment was not applied to it." };
    return { status: "acknowledged", acknowledgment: trustedAcknowledgment(request.journal, acknowledgment.revision) };
  }

  /** Used only after exact startup cloud-match/local acknowledgment confirmation. */
  acknowledgmentForExactLocalConfirmation(journal: PendingWorkspaceJournal, revision: number): JournalCloudAcknowledgment | null {
    if (!isPendingWorkspaceJournal(journal) || journal.syncStrategy !== "revisioned" || journal.baseRevision === null
      || !Number.isSafeInteger(revision) || revision < journal.baseRevision) return null;
    return trustedAcknowledgment(journal, revision);
  }
}

function validateRequest(request: JournalCoordinatorRequest): JournalCoordinatorFailure | null {
  if (!isPendingWorkspaceJournal(request.journal)) return { status: "conflict", reason: "Pending workspace journal is invalid." };
  if (request.journal.ownerId !== request.ownerId || request.journal.operationId !== request.operationId || !same(request.journal.snapshot, request.snapshot)) {
    return { status: "conflict", reason: "Journal owner, operation identity, or snapshot does not match the requested upload." };
  }
  if (request.journal.syncStrategy !== "revisioned" || request.journal.baseRevision === null) {
    return { status: "manual", reason: "Manual or null-revision journals must not be auto-uploaded." };
  }
  return null;
}

function matchesCurrent(current: PendingWorkspaceJournal | null, expected: PendingWorkspaceJournal) {
  return Boolean(current && same(current, expected));
}

function mapTransportOutcome(result: Exclude<JournalOnlyTransportResult, { status: "cloud-acknowledged" }>): JournalCoordinatorResult {
  if (result.status === "account-changed") return { status: "stale-owner", reason: result.reason };
  if (result.status === "offline") return { status: "offline", reason: result.reason };
  if (result.status === "ambiguous") return { status: "ambiguous", reason: result.reason };
  if (result.status === "conflict") return { status: "conflict", reason: result.reason };
  if (result.status === "manual") return { status: "manual", reason: result.reason };
  return { status: "pending", reason: result.reason };
}

/** Pure reducer handoff; React integration must dispatch it only after acknowledged. */
export function applyJournalCloudAcknowledgment(state: GuardedWorkspaceState, acknowledgment: JournalCloudAcknowledgment) {
  return guardedWorkspaceReducer(state, {
    type: "apply-cloud-acknowledgment",
    ownerId: acknowledgment.ownerId,
    operationId: acknowledgment.operationId,
    snapshot: acknowledgment.snapshot,
    revision: acknowledgment.revision,
  });
}

export type GuardedWorkflowOrder = "normal" | "reminder" | "destructive" | "daily-backup";
export type GuardedWorkflowStep = "verified-backup-preflight" | "journal-durable" | "cloud-exact-acknowledged" | "post-ack-daily-backup";

/** Future injected side effect: it can run only with an exact cloud acknowledgment. */
export type PostAcknowledgmentDailyBackup = (acknowledgment: JournalCloudAcknowledgment) => Promise<{ completed: boolean; reason?: string }>;
/** Future injected preflight: it must return an opaque verified-backup proof before destructive journal creation. */
export type VerifiedBackupDestructivePreflight<Proof> = (input: { ownerId: string; operationId: string; preMutationSnapshot: Snapshot }) => Promise<{ confirmed: true; proof: Proof } | { confirmed: false; reason: string }>;

/** Pure ordering contract: no backup call or destructive mutation happens here. */
export function guardedWorkflowSteps(workflow: GuardedWorkflowOrder): readonly GuardedWorkflowStep[] {
  if (workflow === "destructive") return ["verified-backup-preflight", "journal-durable", "cloud-exact-acknowledged"];
  if (workflow === "daily-backup") return ["cloud-exact-acknowledged", "post-ack-daily-backup"];
  return ["journal-durable", "cloud-exact-acknowledged"];
}
