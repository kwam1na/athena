import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { readPipelineControl } from "./pipelineControl";

/** Child-first inventory of ONLY the additive reports-pipeline state. */
const readers = {
  reportPipelineRetention: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("reportPipelineRetention")
      .withIndex("by_storeId_lane", (q) => q.eq("storeId", storeId))
      .take(limit),
  reportPipelineWork: (ctx: MutationCtx, storeId: Id<"store">, limit: number) =>
    ctx.db
      .query("reportPipelineWork")
      .withIndex("by_storeId_workKey", (q) => q.eq("storeId", storeId))
      .take(limit),
  reportCloseEvidenceChunk: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("reportCloseEvidenceChunk")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .take(limit),
  reportRollupInputChunk: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("reportRollupInputChunk")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .take(limit),
  reportRangeSummarySku: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("reportRangeSummarySku")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .take(limit),
  operationalInventoryRepairMember: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("operationalInventoryRepairMember")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .take(limit),
  reportRollupCheckpoint: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("reportRollupCheckpoint")
      .withIndex("by_storeId_epoch_operatingDate_productSkuId", (q) =>
        q.eq("storeId", storeId),
      )
      .take(limit),
  reportRollupDayState: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("reportRollupDayState")
      .withIndex("by_storeId_epoch_operatingDate", (q) =>
        q.eq("storeId", storeId),
      )
      .take(limit),
  reportPeriodObligation: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("reportPeriodObligation")
      .withIndex("by_storeId_epoch_operatingDate", (q) =>
        q.eq("storeId", storeId),
      )
      .take(limit),
  reportPeriodReadiness: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("reportPeriodReadiness")
      .withIndex("by_storeId_epoch_periodKey", (q) => q.eq("storeId", storeId))
      .take(limit),
  reportEpochSkuRollup: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("reportEpochSkuRollup")
      .withIndex("by_storeId_epoch_periodKey_productSkuId", (q) =>
        q.eq("storeId", storeId),
      )
      .take(limit),
  reportRollupParity: (ctx: MutationCtx, storeId: Id<"store">, limit: number) =>
    ctx.db
      .query("reportRollupParity")
      .withIndex("by_storeId_epoch", (q) => q.eq("storeId", storeId))
      .take(limit),
  reportRollupInputCurrent: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("reportRollupInputCurrent")
      .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
      .take(limit),
  reportRollupInput: (ctx: MutationCtx, storeId: Id<"store">, limit: number) =>
    ctx.db
      .query("reportRollupInput")
      .withIndex("by_storeId_operatingDate_revision", (q) =>
        q.eq("storeId", storeId),
      )
      .take(limit),
  reportRollupEpoch: (ctx: MutationCtx, storeId: Id<"store">, limit: number) =>
    ctx.db
      .query("reportRollupEpoch")
      .withIndex("by_storeId_epoch", (q) => q.eq("storeId", storeId))
      .take(limit),
  reportCloseEvidence: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("reportCloseEvidence")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .take(limit),
  reportWeekInventory: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("reportWeekInventory")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .take(limit),
  reportWeeklyRecovery: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("reportWeeklyRecovery")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .take(limit),
  operationalInventoryContribution: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("operationalInventoryContribution")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .take(limit),
  operationalInventoryRepair: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("operationalInventoryRepair")
      .withIndex("by_storeId_status_sourceCreatedAt", (q) =>
        q.eq("storeId", storeId),
      )
      .take(limit),
  operationalInventoryCoverage: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("operationalInventoryCoverage")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .take(limit),
  reportPipelineMigration: (
    ctx: MutationCtx,
    storeId: Id<"store">,
    limit: number,
  ) =>
    ctx.db
      .query("reportPipelineMigration")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .take(limit),
};
export const REPORT_PIPELINE_PURGE_TABLES = Object.keys(readers) as Array<
  keyof typeof readers
>;

/** Reseed/demo/deletion share this fence and bounded deletion ordering. The
 * control survives until the owner explicitly resumes or removes the store. */
export async function purgePipelineBatchWithCtx(
  ctx: MutationCtx,
  args: { storeId: Id<"store">; limit?: number },
  now: number,
): Promise<{ deleted: number; hasMore: boolean }> {
  const limit = args.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("pipeline_purge_invalid_limit");
  const control = await readPipelineControl(ctx, args.storeId);
  if (!control) {
    await ctx.db.insert("reportPipelineControl", {
      storeId: args.storeId,
      mode: "paused",
      fence: 1,
      sourceWatermark: 0,
    });
  }
  if (
    control &&
    (control.mode !== "paused" ||
      (!control.hasActivated && Boolean(control.activeRollupEpoch)))
  ) {
    await ctx.db.patch("reportPipelineControl", control._id, {
      mode: "paused",
      fence: control.fence + (control.mode === "paused" ? 0 : 1),
      hasActivated: control.hasActivated || Boolean(control.activeRollupEpoch),
    });
  }
  let deleted = 0;
  for (const table of REPORT_PIPELINE_PURGE_TABLES) {
    const remaining = limit - deleted;
    if (remaining === 0) return { deleted, hasMore: true };
    const rows = await readers[table](ctx, args.storeId, remaining + 1);
    for (const row of rows.slice(0, remaining)) {
      if (row.storeId !== args.storeId)
        throw new Error("pipeline_purge_ownership_mismatch");
      await ctx.db.delete(table, row._id);
      deleted++;
    }
    if (rows.length > remaining) return { deleted, hasMore: true };
  }
  void now;
  return { deleted, hasMore: false };
}
