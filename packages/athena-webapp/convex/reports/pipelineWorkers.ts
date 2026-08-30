import { makeFunctionReference, type FunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  type ActionCtx,
  type MutationCtx,
} from "../_generated/server";
import { reportPipelineWorkKindValidator } from "../schemas/reports/pipelineWork";
import {
  completeReportWorkWithCtx,
  enqueueReportWork,
  failReportWorkWithCtx,
  getClaimedReportWorkWithCtx,
  type ReportWorkClaim,
} from "./pipelineWork";
import { readPipelineControl } from "./pipelineControl";
import { readStoreAllowlist } from "./pipelineAllowlist";
import { rebuildStoreOverview } from "./overview";
import { materializeCloseEvidenceWithCtx, publishCloseLifecycleWithCtx } from "./closeEvidence";
import { recordPipelineOutcomeWithCtx } from "./pipelineEvidence";

export const pipelineWorkerClaimFields = {
  workId: v.id("reportPipelineWork"),
  storeId: v.id("store"),
  kind: reportPipelineWorkKindValidator,
  generation: v.number(),
  dispatchFence: v.number(),
  controlFence: v.number(),
};
export type PipelineWorkerClaim = ReportWorkClaim & { controlFence: number };
export const pipelineWorkerOutcome = v.union(
  v.literal("applied"),
  v.literal("stale"),
  v.literal("deferred"),
  v.literal("blocked"),
);

/** Shared admission only: the closed set of reports lanes owns its own work. */
export async function admitPipelineWork(
  ctx: MutationCtx,
  claim: PipelineWorkerClaim,
  now: number,
) {
  const row = await getClaimedReportWorkWithCtx(ctx, claim, now);
  if (!row) return { status: "stale" as const };
  const control = await readPipelineControl(ctx, claim.storeId);
  if (
    (control?.fence ?? 0) !== claim.controlFence ||
    control?.mode === "paused" ||
    (claim.kind !== "close-evidence" && claim.kind !== "rollup" && control?.mode !== "active") ||
    (claim.kind === "rollup" && !control) ||
    !readStoreAllowlist().has(String(claim.storeId))
  ) {
    return { status: "deferred" as const };
  }
  const store = await ctx.db.get("store", claim.storeId);
  if (!store || store.reportingReseedStartedAt !== undefined) {
    await failReportWorkWithCtx(
      ctx,
      claim,
      { code: "store_reseeding", blocked: true },
      now,
    );
    return { status: "blocked" as const };
  }
  return { status: "ready" as const, row };
}

/** Separate mutation after a thrown data mutation: never catch and commit partial output. */
export const recordWorkerFailure = internalMutation({
  args: pipelineWorkerClaimFields,
  returns: v.union(v.literal("applied"), v.literal("stale")),
  handler: async (ctx, claim) => {
    const control = await readPipelineControl(ctx, claim.storeId);
    if ((control?.fence ?? 0) !== claim.controlFence) return "stale";
    const now = Date.now();
    const result = await failReportWorkWithCtx(
      ctx,
      claim,
      { code: "unexpected_failure" },
      now,
    );
    if (result === "applied")
      await recordPipelineOutcomeWithCtx(ctx, {
        storeId: claim.storeId,
        lane: claim.kind,
        now,
        outcome: "failed",
      });
    return result;
  },
});

export async function runPipelineMutation(
  ctx: ActionCtx,
  claim: PipelineWorkerClaim,
  mutationRef: FunctionReference<"mutation", "public" | "internal", PipelineWorkerClaim>,
) {
  try {
    await ctx.runMutation(
      mutationRef,
      claim,
    );
  } catch {
    await ctx.runMutation(
      makeFunctionReference<"mutation", PipelineWorkerClaim>(
        "reports/pipelineWorkers:recordWorkerFailure",
      ),
      claim,
    );
  }
  return null;
}

export const applyOverview = internalMutation({
  args: pipelineWorkerClaimFields,
  returns: pipelineWorkerOutcome,
  handler: async (ctx, claim) => {
    const now = Date.now();
    const admitted = await admitPipelineWork(ctx, claim, now);
    if (admitted.status !== "ready") return admitted.status;
    if (admitted.row.kind !== "overview") return "stale";
    await rebuildStoreOverview(ctx, claim.storeId, now);
    const result = await completeReportWorkWithCtx(ctx, claim, now);
    if (result === "applied")
      await recordPipelineOutcomeWithCtx(ctx, {
        storeId: claim.storeId,
        lane: claim.kind,
        now,
        outcome: "applied",
      });
    return result;
  },
});

export const runOverview = internalAction({
  args: pipelineWorkerClaimFields,
  returns: v.null(),
  handler: (ctx, claim) =>
    runPipelineMutation(ctx, claim, makeFunctionReference<"mutation", PipelineWorkerClaim>("reports/pipelineWorkers:applyOverview")),
});

export const applyCloseEvidence = internalMutation({
  args: pipelineWorkerClaimFields,
  returns: pipelineWorkerOutcome,
  handler: async (ctx, claim) => {
    const now = Date.now();
    const admitted = await admitPipelineWork(ctx, claim, now);
    if (admitted.status !== "ready") return admitted.status;
    if (admitted.row.kind !== "close-evidence") return "stale";
    const closeId = admitted.row.closeId;
    const header = await ctx.db
      .query("reportCloseEvidence")
      .withIndex("by_closeId", (q) => q.eq("closeId", closeId))
      .unique();
    if (!header) {
      // Explicit isolated repair is the only missing-coverage path allowed
      // to hydrate source. Publish scalar ownership/lifecycle first; its new
      // queue generation owns normalization on the next independent attempt.
      const source=await ctx.db.get("dailyClose",closeId);
      if (source?.storeId === claim.storeId) {
        await publishCloseLifecycleWithCtx(ctx,source,now);
        await recordPipelineOutcomeWithCtx(ctx,{storeId:claim.storeId,lane:claim.kind,now,outcome:"applied"});
        return "applied";
      }
    }
    if (!header || header.storeId !== claim.storeId) {
      await failReportWorkWithCtx(
        ctx,
        claim,
        { code: "missing_evidence", blocked: true },
        now,
      );
      await recordPipelineOutcomeWithCtx(ctx, {
        storeId: claim.storeId,
        lane: claim.kind,
        now,
        outcome: "blocked",
      });
      return "blocked";
    }
    const result = await materializeCloseEvidenceWithCtx(ctx, {
      storeId: claim.storeId,
      closeId,
      expectedGeneration: header.expectedGeneration,
    });
    if (result.status === "blocked") {
      await failReportWorkWithCtx(
        ctx,
        claim,
        {
          code:
            result.reason === "capacity_exceeded"
              ? "capacity_exceeded"
              : "invalid_evidence",
          blocked: true,
        },
        now,
      );
      await recordPipelineOutcomeWithCtx(ctx, {
        storeId: claim.storeId,
        lane: claim.kind,
        now,
        outcome: "blocked",
      });
      return "blocked";
    }
    if (result.status === "stale") {
      await failReportWorkWithCtx(
        ctx,
        claim,
        { code: "stale_source", blocked: true },
        now,
      );
      await recordPipelineOutcomeWithCtx(ctx, {
        storeId: claim.storeId,
        lane: claim.kind,
        now,
        outcome: "blocked",
      });
      return "blocked";
    }
    await enqueueReportWork(ctx, {
      storeId: claim.storeId, kind: "resolve-week-date", operatingDate: header.operatingDate,
    }, now);
    await enqueueReportWork(ctx, { storeId: claim.storeId, kind: "current" }, now);
    const completion = await completeReportWorkWithCtx(ctx, claim, now);
    if (completion === "applied")
      await recordPipelineOutcomeWithCtx(ctx, {
        storeId: claim.storeId,
        lane: claim.kind,
        now,
        outcome: "applied",
      });
    return completion;
  },
});

export const runCloseEvidence = internalAction({
  args: pipelineWorkerClaimFields,
  returns: v.null(),
  handler: (ctx, claim) =>
    runPipelineMutation(
      ctx,
      claim,
      makeFunctionReference<"mutation", PipelineWorkerClaim>("reports/pipelineWorkers:applyCloseEvidence"),
    ),
});
