import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { internalMutation, MutationCtx } from "../_generated/server";
import { scheduledRunLedgerOutcomeValidator } from "../schemas/automation";

export const SCHEDULED_CRON_INTERVAL_MINUTES = {
  "release-checkout-items": 10,
  "clear-abandoned-sessions": 30,
  "complete-checkout-sessions": 30,
  "release-pos-session-items": 10,
  "auto-verify-payments": 10,
  // Must match the PROD cadence registered in `crons.ts` (hourly at :47).
  // `resolveScheduledWindow` floors `now` by this interval, so a disagreement
  // would split one tick's evidence across windows or collapse two ticks into
  // one run key.
  "report-verification-sweep": 60,
  // Reports workers commit independently; evidence partitions by lane so one
  // worker cannot overwrite another worker's counts in the same cron window.
  "reports-pipeline-fold": 5,
  "reports-pipeline-close-evidence": 5,
  "reports-pipeline-resolve-week-date": 5,
  "reports-pipeline-current": 5,
  "reports-pipeline-accept": 5,
  "reports-pipeline-refresh": 5,
  "reports-pipeline-rollup": 5,
  "reports-pipeline-overview": 5,
  "reports-pipeline-inventory": 5,
  "reports-pipeline-legacy": 5,
  "reports-pipeline-maintenance": 5,
} as const;

export type ScheduledCronFamily = keyof typeof SCHEDULED_CRON_INTERVAL_MINUTES;

export type ScheduledRunLedgerOutcome =
  | "applied"
  | "no_candidates"
  | "partial_failure"
  | "failed"
  | "support_only";

export type ScheduledRunEvidenceInput = {
  cronFamily: ScheduledCronFamily;
  now?: number;
  scope: "store" | "system";
  visibility?: "store" | "support";
  storeId?: Id<"store">;
  organizationId?: Id<"organization">;
  outcome: ScheduledRunLedgerOutcome;
  candidateCount: number;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount?: number;
  sourceSubjectType: string;
  sampleSubjectIds?: string[];
  snapshotCounts?: Record<string, number>;
  notes?: string;
  error?: {
    code: string;
    message: string;
  };
};

export function resolveScheduledWindow(input: {
  cronFamily: ScheduledCronFamily;
  now: number;
}) {
  const intervalMs =
    SCHEDULED_CRON_INTERVAL_MINUTES[input.cronFamily] * 60 * 1000;
  const scheduledWindowStartAt = Math.floor(input.now / intervalMs) * intervalMs;

  return {
    scheduledWindowStartAt,
    scheduledWindowEndAt: scheduledWindowStartAt + intervalMs,
  };
}

export function buildScheduledRunKey(input: {
  cronFamily: ScheduledCronFamily;
  scheduledWindowStartAt: number;
  scope: "store" | "system";
  storeId?: string;
}) {
  const partition =
    input.scope === "store" ? `store:${input.storeId}` : "system";

  return [
    "scheduled-run",
    input.cronFamily,
    input.scheduledWindowStartAt,
    partition,
  ].join(":");
}

export function deriveScheduledRunOutcome(input: {
  candidateCount: number;
  succeededCount: number;
  failedCount: number;
}) {
  if (input.candidateCount === 0) return "no_candidates" as const;
  if (input.failedCount > 0 && input.succeededCount > 0) {
    return "partial_failure" as const;
  }
  if (input.failedCount > 0) return "failed" as const;
  return "applied" as const;
}

export async function recordScheduledRunEvidenceWithCtx(
  ctx: MutationCtx,
  input: ScheduledRunEvidenceInput,
) {
  const now = input.now ?? Date.now();
  const window = resolveScheduledWindow({
    cronFamily: input.cronFamily,
    now,
  });
  const runKey = buildScheduledRunKey({
    cronFamily: input.cronFamily,
    scheduledWindowStartAt: window.scheduledWindowStartAt,
    scope: input.scope,
    storeId: input.storeId,
  });
  const sampleSubjectIds = (input.sampleSubjectIds ?? []).slice(0, 25);
  const record = {
    runKey,
    cronFamily: input.cronFamily,
    ...window,
    scope: input.scope,
    visibility:
      input.visibility ?? (input.scope === "store" ? "store" : "support"),
    storeId: input.storeId,
    organizationId: input.organizationId,
    actorType: "system" as const,
    outcome: input.outcome,
    candidateCount: input.candidateCount,
    processedCount: input.processedCount,
    succeededCount: input.succeededCount,
    failedCount: input.failedCount,
    skippedCount: input.skippedCount ?? 0,
    sourceSubjectType: input.sourceSubjectType,
    sampleSubjectIds,
    snapshotCounts: input.snapshotCounts ?? {},
    notes: input.notes,
    error: input.error,
    updatedAt: now,
    completedAt: now,
  };

  const existing = await ctx.db
    .query("scheduledRunLedger")
    .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
    .first();

  if (existing) {
    await ctx.db.patch("scheduledRunLedger", existing._id, record);
    return existing._id;
  }

  return await ctx.db.insert("scheduledRunLedger", {
    ...record,
    createdAt: now,
  });
}

export async function bestEffortRecordScheduledRunEvidence(
  ctx: MutationCtx,
  input: ScheduledRunEvidenceInput,
) {
  try {
    return await recordScheduledRunEvidenceWithCtx(ctx, input);
  } catch (error) {
    console.error("[SCHEDULED-RUN] Failed to record run evidence", {
      cronFamily: input.cronFamily,
      scope: input.scope,
      storeId: input.storeId,
      error,
    });
    return null;
  }
}

const scheduledRunEvidenceArgs = {
  cronFamily: v.union(
    v.literal("release-checkout-items"),
    v.literal("clear-abandoned-sessions"),
    v.literal("complete-checkout-sessions"),
    v.literal("release-pos-session-items"),
    v.literal("auto-verify-payments"),
    v.literal("report-verification-sweep"),
    v.literal("reports-pipeline-fold"),
    v.literal("reports-pipeline-close-evidence"),
    v.literal("reports-pipeline-resolve-week-date"),
    v.literal("reports-pipeline-current"),
    v.literal("reports-pipeline-accept"),
    v.literal("reports-pipeline-refresh"),
    v.literal("reports-pipeline-rollup"),
    v.literal("reports-pipeline-overview"),
    v.literal("reports-pipeline-inventory"),
    v.literal("reports-pipeline-legacy"),
    v.literal("reports-pipeline-maintenance"),
  ),
  now: v.optional(v.number()),
  scope: v.union(v.literal("store"), v.literal("system")),
  visibility: v.optional(v.union(v.literal("store"), v.literal("support"))),
  storeId: v.optional(v.id("store")),
  organizationId: v.optional(v.id("organization")),
  outcome: scheduledRunLedgerOutcomeValidator,
  candidateCount: v.number(),
  processedCount: v.number(),
  succeededCount: v.number(),
  failedCount: v.number(),
  skippedCount: v.optional(v.number()),
  sourceSubjectType: v.string(),
  sampleSubjectIds: v.optional(v.array(v.string())),
  snapshotCounts: v.optional(v.record(v.string(), v.number())),
  notes: v.optional(v.string()),
  error: v.optional(
    v.object({
      code: v.string(),
      message: v.string(),
    }),
  ),
};

export const recordScheduledRunEvidence = internalMutation({
  args: scheduledRunEvidenceArgs,
  handler: async (ctx, args) => {
    return await recordScheduledRunEvidenceWithCtx(ctx, args);
  },
});
