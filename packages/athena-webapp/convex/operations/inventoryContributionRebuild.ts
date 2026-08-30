import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  setInventoryCoverageWithCtx,
  syncInventoryContributionWithCtx,
  syncInventoryRepairWithCtx,
} from "./inventoryContributions";

type Progress = NonNullable<Doc<"operationalInventoryCoverage">["rebuild"]>;
const PHASES = ["work", "repair", "prune_work", "prune_repair"] as const;
const REPAIR_STATUSES = ["pending", "running", "paused", "completed"] as const;

export async function beginInventoryContributionRebuildWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
  now: number,
) {
  if (!(await ctx.db.get("store", storeId)))
    throw new Error("inventory_rebuild_store_missing");
  await setInventoryCoverageWithCtx(ctx, storeId, false, now);
  const coverage = (await ctx.db
    .query("operationalInventoryCoverage")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique())!;
  const generation = (coverage.rebuildGeneration ?? 0) + 1;
  if (!Number.isSafeInteger(generation))
    throw new Error("inventory_rebuild_generation_exhausted");
  await ctx.db.patch("operationalInventoryCoverage", coverage._id, {
    rebuildGeneration: generation,
    rebuild: { phase: "work", lane: 0, cursor: null },
  });
  return generation;
}

/** One full source document per transaction; cursor and projection commit together. */
export async function stepInventoryContributionRebuildWithCtx(
  ctx: MutationCtx,
  args: { storeId: Id<"store">; generation: number },
  now: number,
): Promise<{ status: "continued" | "complete" | "stale" }> {
  const coverage = await ctx.db
    .query("operationalInventoryCoverage")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .unique();
  if (
    !coverage ||
    coverage.rebuildGeneration !== args.generation ||
    !coverage.rebuild
  )
    return { status: "stale" };
  const progress = coverage.rebuild;
  let next: Progress | undefined;
  let done = false;
  let cursor = "";
  if (progress.phase === "work") {
    const page = await ctx.db
      .query("operationalWorkItem")
      .withIndex("by_storeId_type_status", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("type", "synced_sale_inventory_review")
          .eq("status", ["open", "in_progress"][progress.lane]),
      )
      .paginate({ cursor: progress.cursor, numItems: 1 });
    for (const item of page.page)
      await syncInventoryContributionWithCtx(
        ctx,
        item,
        { storeId: args.storeId, workItemId: item._id },
        now,
      );
    done = page.isDone;
    cursor = page.continueCursor;
  } else if (progress.phase === "repair") {
    const page = await ctx.db
      .query("oversizedOperationalWorkRepair")
      .withIndex("by_storeId_status", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", REPAIR_STATUSES[progress.lane]),
      )
      .paginate({ cursor: progress.cursor, numItems: 1 });
    for (const repair of page.page)
      await syncInventoryRepairWithCtx(
        ctx,
        repair,
        { storeId: args.storeId, repairId: repair._id },
        now,
      );
    done = page.isDone;
    cursor = page.continueCursor;
  } else if (progress.phase === "prune_work") {
    const page = await ctx.db
      .query("operationalInventoryContribution")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .paginate({ cursor: progress.cursor, numItems: 1 });
    for (const row of page.page)
      await syncInventoryContributionWithCtx(
        ctx,
        await ctx.db.get("operationalWorkItem", row.workItemId),
        { storeId: args.storeId, workItemId: row.workItemId },
        now,
      );
    done = page.isDone;
    cursor = page.continueCursor;
  } else {
    const page = await ctx.db
      .query("operationalInventoryRepair")
      .withIndex("by_storeId_status_sourceCreatedAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", REPAIR_STATUSES[progress.lane]),
      )
      .paginate({ cursor: progress.cursor, numItems: 1 });
    for (const row of page.page)
      await syncInventoryRepairWithCtx(
        ctx,
        await ctx.db.get("oversizedOperationalWorkRepair", row.repairId),
        { storeId: args.storeId, repairId: row.repairId },
        now,
      );
    done = page.isDone;
    cursor = page.continueCursor;
  }
  if (!done) next = { ...progress, cursor };
  else {
    const laneCount =
      progress.phase === "work"
        ? 2
        : progress.phase === "repair"
          ? 3
          : progress.phase === "prune_repair"
            ? 4
            : 1;
    if (progress.lane + 1 < laneCount)
      next = { ...progress, lane: progress.lane + 1, cursor: null };
    else {
      const phase = PHASES[PHASES.indexOf(progress.phase) + 1];
      if (phase) next = { phase, lane: 0, cursor: null };
    }
  }
  await ctx.db.patch("operationalInventoryCoverage", coverage._id, {
    rebuild: next,
    updatedAt: now,
  });
  if (!next) {
    await setInventoryCoverageWithCtx(ctx, args.storeId, true, now);
    return { status: "complete" };
  }
  return { status: "continued" };
}
