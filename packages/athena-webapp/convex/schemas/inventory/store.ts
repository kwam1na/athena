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
  /**
   * Internal migration evidence for the reporting-cycle anchor.
   *
   * A schedule version without `reportingCycleStartsOn` silently defaults to
   * Monday, which would publish a weekly frame the store never agreed to. Like
   * the cutoff evidence above, only the migration verifier writes this.
   */
  weeklyReportingCycleAnchorVerification: v.optional(
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
  /**
   * The instant weekly reporting activated for this store — stamped once when
   * the second of the two verifications above completes. Acceptance is derived
   * only for closes completed at/after it, so recovery reconciliation can
   * never manufacture retrospective accepted baselines for pre-feature weeks.
   * Absent on stores verified before this field shipped (legacy-permissive).
   */
  weeklyReportingAcceptanceFloor: v.optional(v.number()),
  /** Internal barrier while destructive reporting source reconstruction runs. */
  reportingReseedStartedAt: v.optional(v.number()),
  // Idempotency marker for the cedis->pesewas backfill
  // (migrations/backfillAmountsToPesewas.ts). Set in the same patch that
  // converts the money fields; its presence means "already minor units".
  pesewasMigratedAt: v.optional(v.number()),
});

export const storeAssetSchema = v.object({
  storeId: v.id("store"),
  url: v.string(),
});
