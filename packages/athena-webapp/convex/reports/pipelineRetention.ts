import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { retentionLane } from "../schemas/reports/pipelineRetention";
import { readPipelineControl } from "./pipelineControl";
import { readStoreAllowlist } from "./pipelineAllowlist";
import { cleanupCloseEvidenceGenerationsWithCtx } from "./closeEvidence";
import { cleanupObsoleteRollupInputBatchWithCtx } from "./rollupMaintenance";
import { recordPipelineOutcomeWithCtx } from "./pipelineEvidence";

type Claim = {
  storeId: Id<"store">;
  workId: Id<"reportPipelineRetention">;
  lane: "close" | "rollup";
  fence: number;
  controlFence: number;
};
const fields = {
  storeId: v.id("store"),
  workId: v.id("reportPipelineRetention"),
  lane: retentionLane,
  fence: v.number(),
  controlFence: v.number(),
};
const INTERVAL = 15 * 60_000;

/** Independent queues ensure a malformed close child cannot stop input cleanup. */
export async function dispatchRetentionWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
  now: number,
) {
  if (!readStoreAllowlist().has(String(storeId))) return 0;
  const control = await readPipelineControl(ctx, storeId);
  const store = await ctx.db.get("store", storeId);
  if (
    !control ||
    control.mode === "paused" ||
    !store ||
    store.reportingReseedStartedAt !== undefined
  )
    return 0;
  let scheduled = 0;
  for (const lane of ["close", "rollup"] as const) {
    const row = await ctx.db
      .query("reportPipelineRetention")
      .withIndex("by_storeId_lane", (q) =>
        q.eq("storeId", storeId).eq("lane", lane),
      )
      .unique();
    if (row && row.eligibleAt > now) continue;
    const fence = (row?.fence ?? 0) + 1;
    const update = {
      storeId,
      lane,
      cursor: row?.cursor ?? null,
      eligibleAt: now + 60_000,
      fence,
      claimed: true,
    };
    const workId = row
      ? row._id
      : await ctx.db.insert("reportPipelineRetention", update);
    if (row) await ctx.db.patch("reportPipelineRetention", workId, update);
    await ctx.scheduler.runAfter(
      0,
      makeFunctionReference<"action", Claim>(
        "reports/pipelineRetention:runRetention",
      ),
      {
        storeId,
        workId,
        lane,
        fence,
        controlFence: control.fence,
      },
    );
    scheduled++;
  }
  return scheduled;
}

async function closePage(
  ctx: MutationCtx,
  storeId: Id<"store">,
  cursor: string | null,
) {
  const page = await ctx.db
    .query("reportCloseEvidence")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .paginate({ cursor, numItems: 1 });
  for (const header of page.page) {
    const result = await cleanupCloseEvidenceGenerationsWithCtx(
      ctx,
      storeId,
      header._id,
    );
    if (result.blocked)
      await recordPipelineOutcomeWithCtx(ctx, {
        storeId,
        lane: "maintenance",
        now: Date.now(),
        outcome: "blocked",
      });
    if (result.hasMore) return cursor;
  }
  return page.isDone ? null : page.continueCursor;
}

export const applyRetention = internalMutation({
  args: fields,
  returns: v.null(),
  handler: async (ctx, claim) => {
    const row = await ctx.db.get("reportPipelineRetention", claim.workId);
    if (
      !row ||
      row.storeId !== claim.storeId ||
      row.lane !== claim.lane ||
      row.fence !== claim.fence ||
      !row.claimed ||
      row.eligibleAt <= Date.now()
    )
      return null;
    const control = await readPipelineControl(ctx, claim.storeId);
    const store = await ctx.db.get("store", claim.storeId);
    if (
      control?.fence !== claim.controlFence ||
      control.mode === "paused" ||
      !store ||
      store.reportingReseedStartedAt !== undefined ||
      !readStoreAllowlist().has(String(claim.storeId))
    )
      return null;
    const now = Date.now();
    const cursor =
      claim.lane === "close"
        ? await closePage(ctx, claim.storeId, row.cursor)
        : (
            await cleanupObsoleteRollupInputBatchWithCtx(
              ctx,
              { storeId: claim.storeId, cursor: row.cursor },
              now,
            )
          ).cursor;
    await ctx.db.patch("reportPipelineRetention", row._id, {
      cursor,
      claimed: false,
      eligibleAt: now + INTERVAL,
      lastFailureAt: undefined,
    });
    return null;
  },
});
export const recordRetentionFailure = internalMutation({
  args: fields,
  returns: v.null(),
  handler: async (ctx, claim) => {
    const row = await ctx.db.get("reportPipelineRetention", claim.workId);
    const control = await readPipelineControl(ctx, claim.storeId);
    if (
      !row ||
      row.storeId !== claim.storeId ||
      row.lane !== claim.lane ||
      row.fence !== claim.fence ||
      !row.claimed ||
      control?.fence !== claim.controlFence
    )
      return null;
    const now = Date.now();
    await ctx.db.patch("reportPipelineRetention", row._id, {
      claimed: false,
      eligibleAt: now + INTERVAL,
      lastFailureAt: now,
    });
    await recordPipelineOutcomeWithCtx(ctx, {
      storeId: claim.storeId,
      lane: "maintenance",
      now,
      outcome: "failed",
    });
    return null;
  },
});
export const runRetention = internalAction({
  args: fields,
  returns: v.null(),
  handler: async (ctx, claim) => {
    try {
      await ctx.runMutation(
        makeFunctionReference<"mutation", Claim>(
          "reports/pipelineRetention:applyRetention",
        ),
        claim,
      );
    } catch {
      await ctx.runMutation(
        makeFunctionReference<"mutation", Claim>(
          "reports/pipelineRetention:recordRetentionFailure",
        ),
        claim,
      );
    }
    return null;
  },
});
