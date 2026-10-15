import { LOCAL_WORKSPACE_ID, type WorkspaceSourceSelection } from "./workspace-source-selection-policy";

export type WorkspaceAutosaveRoutingInput = {
  selection: WorkspaceSourceSelection;
  ready: boolean;
  signedIn: boolean;
  activeOwnerId: string | null;
  storageOwnerId: string;
  subscriptionWritable: boolean;
  recoveryWriteBlocked: boolean;
  ledgerMode: boolean;
  cloudHydrated: boolean;
  online: boolean;
  autosavePaused: boolean;
};

export type WorkspaceAutosaveRoute = {
  legacyLocalWriteAllowed: boolean;
  genericLedgerDirtyAllowed: boolean;
  genericSaveCloudAllowed: boolean;
  requiresJournalCoordinator: boolean;
  reason: string;
};

/**
 * Pure routing contract for the future source seam. Guarded snapshots must
 * never enter legacy local/ledger/saveCloud paths; exact journal coordination
 * is their only future persistence route.
 */
export function decideWorkspaceAutosaveRoute(input: WorkspaceAutosaveRoutingInput): WorkspaceAutosaveRoute {
  if (input.selection.source === "guarded-signed-in") {
    return { legacyLocalWriteAllowed: false, genericLedgerDirtyAllowed: false, genericSaveCloudAllowed: false, requiresJournalCoordinator: true, reason: "Guarded workspace snapshots require journal-first exact acknowledgment." };
  }
  if (!input.ready) return blocked("Workspace is not ready for autosave.");
  if (input.recoveryWriteBlocked) return blocked("Workspace recovery blocks generic autosave.");
  if (input.selection.source === "legacy-local") {
    const localOwner = !input.signedIn && input.activeOwnerId === null && input.storageOwnerId === LOCAL_WORKSPACE_ID;
    return localOwner
      ? { legacyLocalWriteAllowed: true, genericLedgerDirtyAllowed: false, genericSaveCloudAllowed: false, requiresJournalCoordinator: false, reason: "Legacy signed-out workspace persists locally only." }
      : blocked("Legacy local workspace owner changed before autosave.");
  }
  const ownerMatches = input.signedIn && input.selection.ownerId !== null
    && input.activeOwnerId === input.selection.ownerId && input.storageOwnerId === input.selection.ownerId;
  if (!ownerMatches) return blocked("Signed-in workspace owner changed before autosave.");
  if (!input.subscriptionWritable) return blocked("Subscription policy blocks legacy workspace writes.");
  return {
    legacyLocalWriteAllowed: true,
    genericLedgerDirtyAllowed: input.ledgerMode,
    genericSaveCloudAllowed: input.cloudHydrated && input.online && !input.autosavePaused,
    requiresJournalCoordinator: false,
    reason: "Legacy signed-in autosave remains eligible under existing conditions.",
  };
}

/** Retry/timer callbacks must repeat owner checks before generic cloud save. */
export function canApplyGenericAutosaveCallback(route: WorkspaceAutosaveRoute, expectedOwnerId: string, activeOwnerId: string | null, cloudHydrated: boolean) {
  return route.genericSaveCloudAllowed && activeOwnerId === expectedOwnerId && cloudHydrated;
}

function blocked(reason: string): WorkspaceAutosaveRoute {
  return { legacyLocalWriteAllowed: false, genericLedgerDirtyAllowed: false, genericSaveCloudAllowed: false, requiresJournalCoordinator: false, reason };
}
