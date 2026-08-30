import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { readPipelineControl } from "./pipelineControl";
import { enqueueReportWork } from "./pipelineWork";
import { CloseEvidenceReadError } from "./closeEvidence";
import { recordPipelineOutcomeWithCtx } from "./pipelineEvidence";
import { readStoreAllowlist } from "./pipelineAllowlist";
import {
  DayCapExceeded,
  foldAndReplaceDay,
  openPolicyForReason,
} from "./sweeper";

export const REPORT_DAY_LEASE_MS = 60_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 30 * 60_000;
const dayFailureCodeValidator = v.union(
  v.literal("capacity_exceeded"),
  v.literal("missing_evidence"),
  v.literal("invalid_evidence"),
  v.literal("unexpected_failure"),
);
type DayFailureCode =
  | "capacity_exceeded"
  | "missing_evidence"
  | "invalid_evidence"
  | "unexpected_failure";

const dayClaimFields = {
  storeId: v.id("store"),
  markId: v.id("reportDirtyDay"),
  operatingDate: v.string(),
  generation: v.number(),
  dispatchFence: v.number(),
  controlFence: v.number(),
};

export type ReportDayClaim = {
  storeId: Id<"store">;
  markId: Id<"reportDirtyDay">;
  operatingDate: string;
  generation: number;
  dispatchFence: number;
  controlFence: number;
};

export async function claimDayWorkWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
  now: number,
): Promise<ReportDayClaim | null> {
  if (!readStoreAllowlist().has(String(storeId))) return null;
  const control = await readPipelineControl(ctx, storeId);
  if (control?.mode !== "active") return null;
  const store = await ctx.db.get("store", storeId);
  if (!store || store.reportingReseedStartedAt !== undefined) return null;
  // Undefined eligibility on legacy marks sorts before numbers. Leasing the
  // selected row moves it out of the eligible prefix, including on a crash.
  const mark = await ctx.db
    .query("reportDirtyDay")
    .withIndex("by_storeId_eligibleAt", (q) =>
      q.eq("storeId", storeId).lte("eligibleAt", now),
    )
    .first();
  if (!mark) return null;
  const dispatchFence = (mark.dispatchFence ?? 0) + 1;
  await ctx.db.patch("reportDirtyDay", mark._id, {
    dispatchFence,
    eligibleAt: now + REPORT_DAY_LEASE_MS,
    claimedAt: now,
  });
  return {
    storeId,
    markId: mark._id,
    operatingDate: mark.operatingDate,
    generation: mark.generation ?? 0,
    dispatchFence,
    controlFence: control.fence,
  };
}

async function matchingMark(ctx: MutationCtx, claim: ReportDayClaim) {
  const mark = await ctx.db.get("reportDirtyDay", claim.markId);
  return mark &&
    mark.storeId === claim.storeId &&
    mark.operatingDate === claim.operatingDate &&
    (mark.generation ?? 0) === claim.generation &&
    mark.dispatchFence === claim.dispatchFence &&
    mark.claimedAt !== undefined
    ? mark
    : null;
}

/** One transaction: canonical fold, exact handoffs, then generation acknowledgement. */
export async function processDayWorkWithCtx(
  ctx: MutationCtx,
  claim: ReportDayClaim,
  now: number,
): Promise<"applied" | "stale" | "deferred"> {
  const mark = await matchingMark(ctx, claim);
  if (!mark || (mark.eligibleAt ?? 0) <= now) return "stale";
  const control = await readPipelineControl(ctx, claim.storeId);
  if (
    control?.mode !== "active" ||
    control.fence !== claim.controlFence ||
    !readStoreAllowlist().has(String(claim.storeId))
  )
    return "deferred";
  const store = await ctx.db.get("store", claim.storeId);
  if (!store || store.reportingReseedStartedAt !== undefined) return "deferred";
  try {
    await foldAndReplaceDay(ctx, claim.storeId, claim.operatingDate, now, {
      deferRollups: true,
      openPolicy: openPolicyForReason(mark.reason),
    });
  } catch (error) {
    if (error instanceof DayCapExceeded) {
      throw new ConvexError({ code: "capacity_exceeded" });
    }
    if (error instanceof CloseEvidenceReadError) {
      throw new ConvexError({
        code:
          error.code === "close_evidence_capacity"
            ? "capacity_exceeded"
            : error.code === "close_evidence_pending"
              ? "missing_evidence"
              : "invalid_evidence",
      });
    }
    throw error;
  }
  await enqueueReportWork(
    ctx,
    {
      storeId: claim.storeId,
      kind: "resolve-week-date",
      operatingDate: claim.operatingDate,
    },
    now,
  );
  await enqueueReportWork(
    ctx,
    { storeId: claim.storeId, kind: "current" },
    now,
  );
  await enqueueReportWork(
    ctx,
    { storeId: claim.storeId, kind: "overview" },
    now,
  );
  await ctx.db.delete("reportDirtyDay", mark._id);
  await recordPipelineOutcomeWithCtx(ctx, {
    storeId: claim.storeId,
    lane: "fold",
    now,
    outcome: "applied",
    oldestAgeMs: Math.max(0, now - (mark.firstMarkedAt ?? mark.markedAt)),
  });
  return "applied";
}

/** Runs outside the failed data transaction, never acknowledges the obligation. */
export async function failDayWorkWithCtx(
  ctx: MutationCtx,
  claim: ReportDayClaim,
  code: DayFailureCode,
  now: number,
): Promise<"applied" | "stale"> {
  const mark = await matchingMark(ctx, claim);
  if (!mark) return "stale";
  const control = await readPipelineControl(ctx, claim.storeId);
  if (control?.fence !== claim.controlFence) return "stale";
  const attempts = (mark.attempts ?? 0) + 1;
  await ctx.db.patch("reportDirtyDay", mark._id, {
    attempts,
    lastFailure: code,
    claimedAt: undefined,
    eligibleAt:
      now +
      Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 10)),
  });
  await recordPipelineOutcomeWithCtx(ctx, {
    storeId: claim.storeId,
    lane: "fold",
    now,
    outcome: code === "unexpected_failure" ? "failed" : "blocked",
    oldestAgeMs: Math.max(0, now - (mark.firstMarkedAt ?? mark.markedAt)),
  });
  return "applied";
}

export const foldOneDay = internalMutation({
  args: dayClaimFields,
  returns: v.union(
    v.literal("applied"),
    v.literal("stale"),
    v.literal("deferred"),
  ),
  handler: (ctx, args) => processDayWorkWithCtx(ctx, args, Date.now()),
});

export const recordDayFailure = internalMutation({
  args: { ...dayClaimFields, code: dayFailureCodeValidator },
  returns: v.union(v.literal("applied"), v.literal("stale")),
  handler: (ctx, { code, ...claim }) =>
    failDayWorkWithCtx(ctx, claim, code, Date.now()),
});

export const runDay = internalAction({
  args: dayClaimFields,
  returns: v.null(),
  handler: async (ctx, claim) => {
    try {
      await ctx.runMutation(
        makeFunctionReference<"mutation", ReportDayClaim>(
          "reports/pipelineDays:foldOneDay",
        ),
        claim,
      );
    } catch (error) {
      const rawCode =
        error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data !== null &&
        "code" in error.data
          ? error.data.code
          : null;
      const code: DayFailureCode =
        rawCode === "capacity_exceeded" ||
        rawCode === "missing_evidence" ||
        rawCode === "invalid_evidence"
          ? rawCode
          : "unexpected_failure";
      await ctx.runMutation(
        makeFunctionReference<
          "mutation",
          ReportDayClaim & { code: DayFailureCode }
        >("reports/pipelineDays:recordDayFailure"),
        { ...claim, code },
      );
    }
    return null;
  },
});
