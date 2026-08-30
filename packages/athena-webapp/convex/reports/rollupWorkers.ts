import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../_generated/server";
import {
  admitPipelineWork,
  pipelineWorkerClaimFields,
  pipelineWorkerOutcome,
  type PipelineWorkerClaim,
} from "./pipelineWorkers";
import {
  claimReportWorkWithCtx,
  completeReportWorkWithCtx,
  enqueueReportWork,
  failReportWorkWithCtx,
} from "./pipelineWork";
import { readPipelineControl } from "./pipelineControl";
import {
  applyRollupDayBatchWithCtx,
  configuredRollupEpochs,
} from "./rollupPipeline";
import { recordPipelineOutcomeWithCtx } from "./pipelineEvidence";
import { affectedPeriodKeys } from "./rollups";

const persistentInvariantErrors = new Set([
  "report_rollup_missing_epoch",
  "report_rollup_invalid_input",
  "report_rollup_missing_input",
  "report_rollup_input_ownership",
  "report_rollup_incomplete_chunk",
  "report_rollup_invalid_checkpoint",
  "report_rollup_unbalanced_delete",
  "report_rollup_numeric_overflow",
  "report_rollup_missing_output",
  "report_rollup_obligation_mismatch",
  "report_rollup_readiness_mismatch",
  "report_rollup_stale_obligation",
  "report_rollup_missing_readiness",
]);
type RollupFailureCode = "invalid_evidence" | "unexpected_failure";

/** One output chunk across at most two configured epochs, in one transaction. */
export async function applyRollupWithCtx(
  ctx: MutationCtx,
  claim: PipelineWorkerClaim,
  now: number,
) {
  const admitted = await admitPipelineWork(ctx, claim, now);
  if (admitted.status !== "ready") return admitted.status;
  if (admitted.row.kind !== "rollup") return "stale" as const;
  const control = await readPipelineControl(ctx, claim.storeId);
  if (!control) return "deferred" as const;
  const operatingDate = admitted.row.operatingDate;
  const current = await ctx.db
    .query("reportRollupInputCurrent")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", claim.storeId).eq("operatingDate", operatingDate),
    )
    .unique();
  for (const epoch of configuredRollupEpochs(control)) {
    const state = await ctx.db
      .query("reportRollupDayState")
      .withIndex("by_storeId_epoch_operatingDate", (q) =>
        q
          .eq("storeId", claim.storeId)
          .eq("epoch", epoch)
          .eq("operatingDate", operatingDate),
      )
      .unique();
    if (current && state?.inputId === current.inputId && state.phase === "done")
      continue;
    await applyRollupDayBatchWithCtx(
      ctx,
      { storeId: claim.storeId, epoch, operatingDate },
      now,
    );
    // A successful chunk advances the work generation and preserves its age.
    // Claiming the next eligible day fairly yields to other queued days. Both
    // cursor progress and durable continuation commit with this output chunk.
    await enqueueReportWork(
      ctx,
      { storeId: claim.storeId, kind: "rollup", operatingDate },
      now,
    );
    const next = await claimReportWorkWithCtx(
      ctx,
      { storeId: claim.storeId, kind: "rollup", limit: 1 },
      now,
    );
    for (const nextClaim of next.claims) {
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference<"action", PipelineWorkerClaim>(
          "reports/rollupWorkers:runRollup",
        ),
        { ...nextClaim, controlFence: control.fence },
      );
    }
    await recordPipelineOutcomeWithCtx(ctx, {
      storeId: claim.storeId,
      lane: "rollup",
      now,
      outcome: "applied",
    });
    return "applied" as const;
  }
  // Before an epoch exists the immutable input is retained; seeding a later
  // target will enqueue it again. No legacy aggregate is touched here.
  const result = await completeReportWorkWithCtx(ctx, claim, now);
  if (result === "applied")
    await recordPipelineOutcomeWithCtx(ctx, {
      storeId: claim.storeId,
      lane: "rollup",
      now,
      outcome: "applied",
    });
  return result;
}

export const applyRollup = internalMutation({
  args: pipelineWorkerClaimFields,
  returns: pipelineWorkerOutcome,
  handler: async (ctx, claim) => {
    try {
      return await applyRollupWithCtx(ctx, claim, Date.now());
    } catch (error) {
      if (
        error instanceof Error &&
        persistentInvariantErrors.has(error.message)
      )
        throw new ConvexError({ code: "invalid_evidence" });
      throw error;
    }
  },
});

/** Runs only after the output mutation rolled back; never commits partial data. */
export const recordRollupFailure = internalMutation({
  args: {
    ...pipelineWorkerClaimFields,
    code: v.union(
      v.literal("invalid_evidence"),
      v.literal("unexpected_failure"),
    ),
  },
  returns: v.union(v.literal("applied"), v.literal("stale")),
  handler: async (ctx, { code, ...claim }) => {
    const now = Date.now();
    const control = await readPipelineControl(ctx, claim.storeId);
    if (control?.fence !== claim.controlFence || claim.kind !== "rollup")
      return "stale";
    const work = await ctx.db.get("reportPipelineWork", claim.workId);
    if (!work || work.storeId !== claim.storeId || work.kind !== "rollup")
      return "stale";
    const result = await failReportWorkWithCtx(
      ctx,
      claim,
      { code, blocked: code === "invalid_evidence" },
      now,
    );
    if (result !== "applied") return result;
    if (code === "invalid_evidence")
      for (const epoch of configuredRollupEpochs(control)) {
        for (const periodKey of affectedPeriodKeys([work.operatingDate])) {
          const gate = await ctx.db
            .query("reportPeriodReadiness")
            .withIndex("by_storeId_epoch_periodKey", (q) =>
              q
                .eq("storeId", claim.storeId)
                .eq("epoch", epoch)
                .eq("periodKey", periodKey),
            )
            .unique();
          if (gate)
            await ctx.db.patch("reportPeriodReadiness", gate._id, {
              status: "blocked",
              updatedAt: now,
            });
          else {
            const obligations = await ctx.db
              .query("reportPeriodObligation")
              .withIndex("by_storeId_epoch_periodKey_operatingDate", (q) =>
                q
                  .eq("storeId", claim.storeId)
                  .eq("epoch", epoch)
                  .eq("periodKey", periodKey),
              )
              .take(32);
            await ctx.db.insert("reportPeriodReadiness", {
              storeId: claim.storeId,
              epoch,
              periodKey,
              status: "blocked",
              pendingDays: obligations.length,
              publicationRevision: 0,
              updatedAt: now,
            });
          }
        }
      }
    await recordPipelineOutcomeWithCtx(ctx, {
      storeId: claim.storeId,
      lane: "rollup",
      now,
      outcome: code === "invalid_evidence" ? "blocked" : "failed",
    });
    return result;
  },
});

export const runRollup = internalAction({
  args: pipelineWorkerClaimFields,
  returns: v.null(),
  handler: async (ctx, claim) => {
    try {
      await ctx.runMutation(
        makeFunctionReference<"mutation", PipelineWorkerClaim>(
          "reports/rollupWorkers:applyRollup",
        ),
        claim,
      );
    } catch (error) {
      const invalid =
        error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data !== null &&
        "code" in error.data &&
        error.data.code === "invalid_evidence";
      const code: RollupFailureCode = invalid
        ? "invalid_evidence"
        : "unexpected_failure";
      await ctx.runMutation(
        makeFunctionReference<
          "mutation",
          PipelineWorkerClaim & { code: RollupFailureCode }
        >("reports/rollupWorkers:recordRollupFailure"),
        { ...claim, code },
      );
    }
    return null;
  },
});
