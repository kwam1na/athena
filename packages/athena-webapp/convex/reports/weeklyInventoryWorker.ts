import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../_generated/server";
import { localDateStartAt } from "../lib/storeScheduleTime";
import { readCompactInventoryAttention } from "../operations/inventoryContributions";
import { recordPipelineOutcomeWithCtx } from "./pipelineEvidence";
import {
  completeReportWorkWithCtx,
  failReportWorkWithCtx,
} from "./pipelineWork";
import {
  admitPipelineWork,
  pipelineWorkerClaimFields,
  pipelineWorkerOutcome,
  runPipelineMutation,
  type PipelineWorkerClaim,
} from "./pipelineWorkers";
import {
  financialFrameKey,
  isInventoryFinancialFrameUnavailable,
} from "./weeklyInventoryProjection";
import { UNAVAILABLE_WEEKLY_INVENTORY_ATTENTION } from "./weeklyInventory";

export async function applyInventoryWithCtx(
  ctx: MutationCtx,
  claim: PipelineWorkerClaim,
  now: number,
) {
  const admitted = await admitPipelineWork(ctx, claim, now);
  if (admitted.status !== "ready") return admitted.status;
  if (admitted.row.kind !== "inventory") return "stale" as const;
  const current = await ctx.db
    .query("reportWeekCurrent")
    .withIndex("by_storeId", (q) => q.eq("storeId", claim.storeId))
    .unique();
  if (!current || current.storeId !== claim.storeId) {
    await failReportWorkWithCtx(
      ctx,
      claim,
      { code: "missing_evidence", blocked: true },
      now,
    );
    await recordPipelineOutcomeWithCtx(ctx, {
      storeId: claim.storeId,
      lane: "inventory",
      now,
      outcome: "blocked",
    });
    return "blocked" as const;
  }
  let attention = UNAVAILABLE_WEEKLY_INVENTORY_ATTENTION;
  if (
    current.availability !== "unavailable" &&
    !isInventoryFinancialFrameUnavailable(current)
  ) {
    const scheduleId = current.scheduleLineage.find(
      (day) => day.scheduleVersionId !== null,
    )?.scheduleVersionId;
    const schedule = scheduleId
      ? await ctx.db.get("storeSchedule", scheduleId)
      : null;
    if (schedule && schedule.storeId !== claim.storeId)
      throw new Error("inventory_frame_schedule_owner_mismatch");
    const frameStartAt = schedule?.timezone
      ? localDateStartAt(current.cycleStartDate, schedule.timezone)
      : null;
    if (frameStartAt !== null)
      attention = await readCompactInventoryAttention(
        ctx,
        claim.storeId,
        frameStartAt,
      );
  }
  const companion = await ctx.db
    .query("reportWeekInventory")
    .withIndex("by_storeId", (q) => q.eq("storeId", claim.storeId))
    .unique();
  const value = {
    storeId: claim.storeId,
    frameKey: financialFrameKey(current),
    materializedAt: now,
    attention,
  };
  if (companion)
    await ctx.db.replace("reportWeekInventory", companion._id, value);
  else await ctx.db.insert("reportWeekInventory", value);
  // Current-frame read, output and queue acknowledgement share one transaction.
  // A concurrent publication enqueues a new generation and retries this entire
  // mutation; old scheduled claims cannot publish or clear that new obligation.
  if (
    !isInventoryFinancialFrameUnavailable(current) &&
    attention.completeness !== "complete"
  ) {
    await failReportWorkWithCtx(
      ctx,
      claim,
      {
        code:
          attention.completeness === "incomplete"
            ? "capacity_exceeded"
            : "coverage_incomplete",
        blocked: true,
      },
      now,
    );
    await recordPipelineOutcomeWithCtx(ctx, {
      storeId: claim.storeId,
      lane: "inventory",
      now,
      outcome: "blocked",
    });
    return "blocked" as const;
  }
  const result = await completeReportWorkWithCtx(ctx, claim, now);
  if (result === "applied")
    await recordPipelineOutcomeWithCtx(ctx, {
      storeId: claim.storeId,
      lane: "inventory",
      now,
      outcome: "applied",
    });
  return result;
}

export const applyInventory = internalMutation({
  args: pipelineWorkerClaimFields,
  returns: pipelineWorkerOutcome,
  handler: (ctx, claim) => applyInventoryWithCtx(ctx, claim, Date.now()),
});

export const runInventory = internalAction({
  args: pipelineWorkerClaimFields,
  returns: v.null(),
  handler: (ctx, claim) =>
    runPipelineMutation(
      ctx,
      claim,
      makeFunctionReference<"mutation", PipelineWorkerClaim>(
        "reports/weeklyInventoryWorker:applyInventory",
      ),
    ),
});
