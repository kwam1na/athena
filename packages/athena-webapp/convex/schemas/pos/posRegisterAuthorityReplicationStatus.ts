import { v } from "convex/values";

export const posRegisterAuthorityReplicationOutcomeValidator = v.union(
  v.literal("applied"),
  v.literal("already_current"),
  v.literal("stale_ignored"),
  v.literal("persistence_failed"),
  v.literal("repair_required"),
  v.literal("shadow_observed"),
);

export const posRegisterAuthorityReplicationRolloutModeValidator = v.union(
  v.literal("shadow"),
  v.literal("canary"),
  v.literal("broad"),
);

export const posRegisterAuthorityReplicationRolloutCohortValidator = v.union(
  v.literal("shadow"),
  v.literal("canary"),
  v.literal("broad"),
);

export const posRegisterAuthorityReplicationStatusSchema = v.object({
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  localRegisterSessionId: v.string(),
  cloudRegisterSessionId: v.optional(v.string()),
  mappingAuthorityRevision: v.number(),
  lifecycleRevision: v.number(),
  outcome: posRegisterAuthorityReplicationOutcomeValidator,
  rolloutMode: posRegisterAuthorityReplicationRolloutModeValidator,
  rolloutCohort: posRegisterAuthorityReplicationRolloutCohortValidator,
  appVersion: v.optional(v.string()),
  buildSha: v.optional(v.string()),
  receivedAt: v.number(),
});
