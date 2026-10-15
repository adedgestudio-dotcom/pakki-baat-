import { isSnapshot, type Snapshot } from "./data";
import { decideSpecialWorkflow, type SpecialWorkflow, type SpecialWorkflowInput, type SpecialWorkflowState } from "./workspace-special-workflow";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[a-f0-9]{64}$/i;
const utf8 = (value: string) => new TextEncoder().encode(value);

export type VerifiedWorkspaceBackupConfirmation = {
  backupId: string; ownerId: string; kind: "daily" | "pre_restore"; payloadSha256: string; createdAt: string;
};

/**
 * Opaque in-memory proof produced only after the coordinator verified the
 * server confirmation. It is intentionally not serializable or restorable:
 * a destructive mutation must obtain a fresh preflight in this browser.
 */
export type VerifiedBackupPrecondition = {
  readonly ownerId: string;
  readonly operationId: string;
  readonly protectedSnapshot: Snapshot;
  readonly confirmation: VerifiedWorkspaceBackupConfirmation;
};
const verifiedPreconditions = new WeakSet<object>();

export class VerifiedWorkspaceBackupError extends Error {
  constructor(message: string, readonly code: "INVALID_SNAPSHOT" | "CANONICALIZATION_UNSUPPORTED" | "INVALID_CONFIRMATION" | "CONFIRMATION_MISMATCH" | "ACCOUNT_CHANGED" | "DUPLICATE_OPERATION" | "NETWORK_FAILURE") { super(message); }
}

function byteCompare(left: string, right: string) {
  const a = utf8(left), b = utf8(right);
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** PostgreSQL jsonb::text uses length-then-byte sorted object keys and spaces after separators. */
export function canonicalJsonbText(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new VerifiedWorkspaceBackupError("Snapshot contains a non-finite number.", "CANONICALIZATION_UNSUPPORTED");
    const encoded = JSON.stringify(value);
    // PostgreSQL numeric normalizes exponent notation differently. The app's
    // exact digest protocol deliberately refuses values it cannot prove equal.
    if (/[eE]/.test(encoded)) throw new VerifiedWorkspaceBackupError("Snapshot contains a number whose PostgreSQL JSONB text cannot be proven locally.", "CANONICALIZATION_UNSUPPORTED");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonbText).join(", ")}]`;
  if (!value || typeof value !== "object") throw new VerifiedWorkspaceBackupError("Snapshot contains an unsupported JSON value.", "CANONICALIZATION_UNSUPPORTED");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort(byteCompare);
  return `{${keys.map((key) => `${JSON.stringify(key)}: ${canonicalJsonbText(record[key])}`).join(", ")}}`;
}

export async function canonicalWorkspaceSnapshotDigest(snapshot: Snapshot): Promise<string> {
  if (!isSnapshot(snapshot)) throw new VerifiedWorkspaceBackupError("Workspace backup requires a valid complete snapshot.", "INVALID_SNAPSHOT");
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new VerifiedWorkspaceBackupError("This browser cannot verify a workspace backup digest.", "CANONICALIZATION_UNSUPPORTED");
  const bytes = new Uint8Array(await subtle.digest("SHA-256", utf8(canonicalJsonbText(snapshot))));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function parseVerifiedWorkspaceBackupConfirmation(value: unknown): VerifiedWorkspaceBackupConfirmation {
  if (!value || typeof value !== "object") throw new VerifiedWorkspaceBackupError("Verified backup RPC returned no confirmation.", "INVALID_CONFIRMATION");
  const row = value as Record<string, unknown>;
  if (typeof row.backup_id !== "string" || !uuid.test(row.backup_id)
    || typeof row.owner_id !== "string" || !uuid.test(row.owner_id)
    || (row.backup_kind !== "daily" && row.backup_kind !== "pre_restore")
    || typeof row.payload_sha256 !== "string" || !digest.test(row.payload_sha256)
    || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) {
    throw new VerifiedWorkspaceBackupError("Verified backup RPC returned an invalid confirmation.", "INVALID_CONFIRMATION");
  }
  return { backupId: row.backup_id, ownerId: row.owner_id, kind: row.backup_kind, payloadSha256: row.payload_sha256.toLowerCase(), createdAt: row.created_at };
}

export async function verifyWorkspaceBackupConfirmation(snapshot: Snapshot, expectedOwnerId: string, expectedKind: "daily" | "pre_restore", value: unknown, snapshotDigest = canonicalWorkspaceSnapshotDigest) {
  const confirmation = parseVerifiedWorkspaceBackupConfirmation(value);
  if (confirmation.ownerId !== expectedOwnerId || confirmation.kind !== expectedKind) {
    throw new VerifiedWorkspaceBackupError("Verified backup confirmation belongs to a different account or kind.", "CONFIRMATION_MISMATCH");
  }
  if (confirmation.payloadSha256 !== (await snapshotDigest(snapshot)).toLowerCase()) {
    throw new VerifiedWorkspaceBackupError("Verified backup confirmation does not match this exact workspace snapshot.", "CONFIRMATION_MISMATCH");
  }
  return confirmation;
}

function createVerifiedBackupPrecondition(ownerId: string, operationId: string, snapshot: Snapshot, confirmation: VerifiedWorkspaceBackupConfirmation): VerifiedBackupPrecondition {
  const precondition: VerifiedBackupPrecondition = Object.freeze({
    ownerId,
    operationId,
    protectedSnapshot: Object.freeze(JSON.parse(JSON.stringify(snapshot))) as Snapshot,
    confirmation: Object.freeze({ ...confirmation }),
  });
  verifiedPreconditions.add(precondition);
  return precondition;
}

/** Runtime validation for the synchronous reducer; digest verification happened before this token was minted. */
export function hasMatchingVerifiedBackupPrecondition(value: unknown, ownerId: string, operationId: string, snapshot: Snapshot, kind: "pre_restore" = "pre_restore") {
  if (!value || typeof value !== "object" || !verifiedPreconditions.has(value)) return false;
  const precondition = value as VerifiedBackupPrecondition;
  return precondition.ownerId === ownerId
    && precondition.operationId === operationId
    && precondition.confirmation.ownerId === ownerId
    && precondition.confirmation.kind === kind
    && JSON.stringify(precondition.protectedSnapshot) === JSON.stringify(snapshot);
}

export type VerifiedBackupCoordinatorInput = {
  operationId: string; ownerId: string; snapshot: Snapshot; workflow: Extract<SpecialWorkflow, "undo" | "import-restore" | "pre-operation-backup">;
  special: Omit<SpecialWorkflowInput, "workflow" | "backupRequired" | "backupConfirmed" | "cloudAcknowledged">;
};
export type VerifiedBackupCoordinatorResult = { confirmed: true; state: SpecialWorkflowState; confirmation: VerifiedWorkspaceBackupConfirmation; precondition: VerifiedBackupPrecondition } | { confirmed: false; state: SpecialWorkflowState; reason: string };
export type VerifiedBackupCoordinatorDependencies = {
  activeOwnerId: () => Promise<string | null>;
  saveVerifiedBackup: (snapshot: Snapshot, kind: "pre_restore", ownerId: string) => Promise<VerifiedWorkspaceBackupConfirmation>;
  snapshotDigest?: (snapshot: Snapshot) => Promise<string>;
};

/** Isolated, fail-closed preflight. It never applies a destructive snapshot itself. */
export function createVerifiedBackupCoordinator(deps: VerifiedBackupCoordinatorDependencies) {
  const inFlight = new Set<string>();
  return {
    async protectBeforeDestructiveOperation(input: VerifiedBackupCoordinatorInput): Promise<VerifiedBackupCoordinatorResult> {
      if (inFlight.has(input.operationId)) return { confirmed: false, state: "failed", reason: "This destructive workspace operation is already awaiting backup confirmation." };
      inFlight.add(input.operationId);
      try {
        const before = await deps.activeOwnerId();
        const policy = decideSpecialWorkflow({ ...input.special, workflow: input.workflow, ownerMatches: before === input.ownerId && input.special.ownerMatches, backupRequired: true, backupConfirmed: false, cloudAcknowledged: false });
        if (!policy.mayRequestBackup) return { confirmed: false, state: policy.state, reason: policy.reason };
        const confirmation = await deps.saveVerifiedBackup(input.snapshot, "pre_restore", input.ownerId);
        const after = await deps.activeOwnerId();
        if (after !== input.ownerId) return { confirmed: false, state: "failed", reason: "Account changed before the safety backup could be confirmed." };
        const verified = await verifyWorkspaceBackupConfirmation(input.snapshot, input.ownerId, "pre_restore", {
          backup_id: confirmation.backupId, owner_id: confirmation.ownerId, backup_kind: confirmation.kind,
          payload_sha256: confirmation.payloadSha256, created_at: confirmation.createdAt,
        }, deps.snapshotDigest);
        return { confirmed: true, state: "cloud-confirmed", confirmation: verified, precondition: createVerifiedBackupPrecondition(input.ownerId, input.operationId, input.snapshot, verified) };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Safety backup confirmation failed.";
        return { confirmed: false, state: "failed", reason };
      } finally { inFlight.delete(input.operationId); }
    },
  };
}
