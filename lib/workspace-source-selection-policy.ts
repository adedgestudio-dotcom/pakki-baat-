import { decideGuardedReducerCutover } from "./workspace-guarded-cutover";

export const LOCAL_WORKSPACE_ID = "local";

export type WorkspaceSource = "legacy-local" | "legacy-signed-in" | "guarded-signed-in";
export type WorkspaceSourceSelection = {
  source: WorkspaceSource;
  ownerId: string | null;
  guardedReachable: boolean;
  genericSaveCloudAllowed: boolean;
  reason: string;
};

export type WorkspaceSourceSelectionInput = {
  signedIn: boolean;
  ownerId: string | null;
  requestedGuarded: boolean;
  environment: "staging" | "production" | "development";
  migratedUserMutationCount: number;
  auditedUserMutationCount: number;
  remainingDirectUserMutationCount: number;
  specialWorkflowsReady: boolean;
};

/**
 * Pure safety gate for a future source-selection seam. It is not imported by
 * workspace.tsx. Generic saveCloud is categorically unavailable to guarded
 * state; only a later journal-specific coordinator can save that source.
 */
export function decideWorkspaceSource(input: WorkspaceSourceSelectionInput): WorkspaceSourceSelection {
  if (!input.signedIn || !input.ownerId || input.ownerId === LOCAL_WORKSPACE_ID) {
    return { source: "legacy-local", ownerId: null, guardedReachable: false, genericSaveCloudAllowed: false, reason: "Signed-out and local workspaces always remain on legacy local state." };
  }
  const cutover = decideGuardedReducerCutover({
    requested: input.requestedGuarded,
    environment: input.environment,
    migratedUserMutationCount: input.migratedUserMutationCount,
    auditedUserMutationCount: input.auditedUserMutationCount,
    specialWorkflowsReady: input.specialWorkflowsReady,
  });
  if (!cutover.enabled || input.remainingDirectUserMutationCount !== 0) {
    return { source: "legacy-signed-in", ownerId: input.ownerId, guardedReachable: false, genericSaveCloudAllowed: true, reason: input.remainingDirectUserMutationCount !== 0 ? "Guarded mode is blocked while direct persisted user setters remain." : cutover.reason };
  }
  return { source: "guarded-signed-in", ownerId: input.ownerId, guardedReachable: true, genericSaveCloudAllowed: false, reason: "Guarded state may use only journal-specific cloud coordination." };
}

/** A stale async response may apply only to the still-selected signed-in owner and source. */
export function canApplySourceAsyncResult(selection: WorkspaceSourceSelection, expectedOwnerId: string, activeOwnerId: string | null) {
  return selection.ownerId === expectedOwnerId && activeOwnerId === expectedOwnerId && selection.source !== "legacy-local";
}

/** Account changes clear only display state; they never authorize storage deletion. */
export function shouldClearWorkspaceDisplay(previous: WorkspaceSourceSelection, next: WorkspaceSourceSelection) {
  return previous.ownerId !== next.ownerId && previous.ownerId !== null;
}
