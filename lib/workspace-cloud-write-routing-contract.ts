import type { Snapshot } from "./data";
import { hasMatchingVerifiedBackupPrecondition, type VerifiedBackupPrecondition } from "./verified-workspace-backup";
import type { WorkspaceSourceSelection } from "./workspace-source-selection-policy";

export type CloudWriteClassification =
  | "legacy-only"
  | "guarded-journal-exact-acknowledgment"
  | "guarded-verified-backup-preflight"
  | "prohibited-in-guarded-mode";

export type WorkspaceCloudWritePath =
  | "legacy-local-workspace-write"
  | "legacy-ledger-dirty-mark"
  | "legacy-ledger-retry"
  | "legacy-generic-autosave"
  | "daily-backup"
  | "undo-save"
  | "pre-restore-backup"
  | "restore-save"
  | "reminder-save";

export type WorkspaceCloudWritePathContract = {
  path: WorkspaceCloudWritePath;
  /** Stable source fragment audited against app/workspace.tsx. */
  sourceAnchor: string;
  classification: CloudWriteClassification;
  guardedRequirement: string;
};

/**
 * Complete inventory of direct persistence/cloud paths in workspace.tsx.
 * This remains a dormant contract: it does not change the live legacy paths.
 */
export const WORKSPACE_CLOUD_WRITE_PATHS: readonly WorkspaceCloudWritePathContract[] = [
  { path: "legacy-local-workspace-write", sourceAnchor: "writeLocalWorkspace(storageUserId, snapshot)", classification: "legacy-only", guardedRequirement: "Guarded snapshots must use the journal-first coordinator, never the legacy local workspace write." },
  { path: "legacy-ledger-dirty-mark", sourceAnchor: "markLedgerDirty(storageUserId, snapshot)", classification: "legacy-only", guardedRequirement: "Guarded snapshots must not create legacy ledger-dirty records." },
  { path: "legacy-ledger-retry", sourceAnchor: "void saveCloud(snapshot, storageUserId).then(() =>", classification: "legacy-only", guardedRequirement: "Guarded snapshots must not retry through generic saveCloud." },
  { path: "legacy-generic-autosave", sourceAnchor: "void saveCloud(snapshot, storageUserId)\n        .then(async () =>", classification: "legacy-only", guardedRequirement: "Guarded snapshots must not enter the generic autosave effect." },
  { path: "daily-backup", sourceAnchor: "await saveWorkspaceBackup(snapshot, \"daily\", storageUserId)", classification: "guarded-journal-exact-acknowledgment", guardedRequirement: "A guarded daily backup may run only after the exact journal snapshot receives a trusted cloud acknowledgment." },
  { path: "undo-save", sourceAnchor: "await saveCloud(normalizedSnapshot(s), ownerId)", classification: "guarded-verified-backup-preflight", guardedRequirement: "Undo requires a matching verified pre-operation backup, then journal/exact-acknowledgment coordination." },
  { path: "pre-restore-backup", sourceAnchor: "await saveWorkspaceBackup(current, \"pre_restore\")", classification: "guarded-verified-backup-preflight", guardedRequirement: "Destructive restore/import preflight requires the verified backup RPC confirmation." },
  { path: "restore-save", sourceAnchor: "await saveCloud(normalizedSnapshot(data), ownerId)", classification: "guarded-journal-exact-acknowledgment", guardedRequirement: "A guarded restore/import replacement must use its journal operation, never generic saveCloud." },
  { path: "reminder-save", sourceAnchor: "await saveCloud({ jobs, owner, business, reminders: nextReminders, payments, notes, customerPhones }, activeUserIdRef.current || undefined)", classification: "guarded-journal-exact-acknowledgment", guardedRequirement: "Reminder save must use one journal operation and its exact acknowledgment." },
] as const;

export type CloudWriteRoutingInput = {
  selection: WorkspaceSourceSelection;
  expectedOwnerId: string | null;
  activeOwnerId: string | null;
  sessionOwnerId: string | null;
  recoveryWriteBlocked: boolean;
  operationId?: string;
  preMutationSnapshot?: Snapshot;
  verifiedBackup?: VerifiedBackupPrecondition;
};

export type CloudWriteRoutingDecision = {
  allowed: boolean;
  classification: CloudWriteClassification;
  mayUseLegacyLocalWrite: boolean;
  mayUseGenericLedgerDirty: boolean;
  mayUseGenericSaveCloud: boolean;
  requiresExactJournalAcknowledgment: boolean;
  requiresVerifiedBackupPreflight: boolean;
  reason: string;
};

/**
 * Pure future-cutover gate. A guarded path first proves the selected owner and
 * active session, then requires either an operation identity for exact journal
 * coordination or an opaque verified-backup proof for destructive work.
 */
export function decideWorkspaceCloudWriteRoute(path: WorkspaceCloudWritePath, input: CloudWriteRoutingInput): CloudWriteRoutingDecision {
  const contract = WORKSPACE_CLOUD_WRITE_PATHS.find((candidate) => candidate.path === path);
  if (!contract) return blocked("prohibited-in-guarded-mode", "Unknown workspace cloud-write path is fail-closed.");

  if (input.selection.source !== "guarded-signed-in") {
    return legacyDecision(contract, input.selection);
  }
  if (!ownersAndSessionMatch(input)) {
    return blocked(contract.classification, "Guarded workspace owner or authenticated session changed before persistence.");
  }
  if (input.recoveryWriteBlocked) {
    return blocked(contract.classification, "Guarded workspace recovery blocks persistence until reconciliation is resolved.");
  }
  if (contract.classification === "legacy-only" || contract.classification === "prohibited-in-guarded-mode") {
    return blocked(contract.classification, contract.guardedRequirement);
  }
  if (contract.classification === "guarded-journal-exact-acknowledgment") {
    return input.operationId
      ? guardedDecision(contract.classification, false, "Guarded persistence must be performed only by the journal exact-acknowledgment coordinator.")
      : blocked(contract.classification, "A guarded journal operation identity is required before persistence.");
  }
  const hasProof = Boolean(input.operationId && input.preMutationSnapshot
    && hasMatchingVerifiedBackupPrecondition(input.verifiedBackup, input.expectedOwnerId!, input.operationId, input.preMutationSnapshot));
  return hasProof
    ? guardedDecision(contract.classification, true, "Verified backup proof is valid; the destructive change still requires journal exact acknowledgment.")
    : blocked(contract.classification, "A matching verified backup proof for the exact pre-mutation snapshot is required.");
}

function ownersAndSessionMatch(input: CloudWriteRoutingInput) {
  return Boolean(input.expectedOwnerId && input.selection.ownerId === input.expectedOwnerId
    && input.activeOwnerId === input.expectedOwnerId && input.sessionOwnerId === input.expectedOwnerId);
}

function legacyDecision(contract: WorkspaceCloudWritePathContract, selection: WorkspaceSourceSelection): CloudWriteRoutingDecision {
  if (selection.source === "legacy-local" && contract.path !== "legacy-local-workspace-write") {
    return blocked(contract.classification, "Signed-out local workspaces cannot use signed-in cloud, backup, or ledger paths.");
  }
  return {
    allowed: true,
    classification: contract.classification,
    mayUseLegacyLocalWrite: contract.path === "legacy-local-workspace-write",
    mayUseGenericLedgerDirty: contract.path === "legacy-ledger-dirty-mark",
    mayUseGenericSaveCloud: ["legacy-ledger-retry", "legacy-generic-autosave", "undo-save", "restore-save", "reminder-save"].includes(contract.path),
    requiresExactJournalAcknowledgment: false,
    requiresVerifiedBackupPreflight: false,
    reason: "Legacy source retains its existing persistence behavior.",
  };
}

function guardedDecision(classification: CloudWriteClassification, requiresVerifiedBackupPreflight: boolean, reason: string): CloudWriteRoutingDecision {
  return { allowed: true, classification, mayUseLegacyLocalWrite: false, mayUseGenericLedgerDirty: false, mayUseGenericSaveCloud: false, requiresExactJournalAcknowledgment: true, requiresVerifiedBackupPreflight, reason };
}

function blocked(classification: CloudWriteClassification, reason: string): CloudWriteRoutingDecision {
  return { allowed: false, classification, mayUseLegacyLocalWrite: false, mayUseGenericLedgerDirty: false, mayUseGenericSaveCloud: false, requiresExactJournalAcknowledgment: false, requiresVerifiedBackupPreflight: false, reason };
}
