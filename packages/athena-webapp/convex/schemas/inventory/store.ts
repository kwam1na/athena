import { v } from "convex/values";

export const storeSchema = v.object({
  config: v.optional(v.record(v.string(), v.any())),
  name: v.string(),
  currency: v.string(),
  slug: v.string(),
  createdByUserId: v.id("athenaUser"),
  organizationId: v.id("organization"),
  /**
   * Internal migration evidence for the immutable weekly-report cutoff.
   * It deliberately lives outside operator-editable `config`: only the
   * migration verifier can make a store eligible for weekly acceptance.
   */
  weeklyObservedAtVerification: v.optional(
    v.object({
      status: v.union(
        v.literal("running"),
        v.literal("incomplete"),
        v.literal("complete"),
      ),
      missingCount: v.number(),
      startedAt: v.number(),
      completedAt: v.optional(v.number()),
    }),
  ),
  /** Internal barrier while destructive reporting source reconstruction runs. */
  reportingReseedStartedAt: v.optional(v.number()),
});

export const storeAssetSchema = v.object({
  storeId: v.id("store"),
  url: v.string(),
});
