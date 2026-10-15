/** Off by default. This contract is not read by the current application. */
export const GUARDED_REDUCER_STAGING_FLAG_DEFAULT = false;
export function decideGuardedReducerCutover(input: { requested: boolean; environment: "staging" | "production" | "development"; migratedUserMutationCount: number; auditedUserMutationCount: number; specialWorkflowsReady: boolean }) {
  const complete = input.migratedUserMutationCount === input.auditedUserMutationCount && input.auditedUserMutationCount > 0;
  const enabled = input.requested && input.environment === "staging" && complete && input.specialWorkflowsReady;
  return { enabled, reason: enabled ? "All audited user mutations are guarded in staging." : "Guarded reducer requires staging, explicit request, complete migration, and ready special workflows." };
}
