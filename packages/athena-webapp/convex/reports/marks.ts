import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/** Upsert the (store, day) dirty mark. One row per day; last reason wins. */
export async function markDirty(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
  reason: Doc<"reportDirtyDay">["reason"],
  markedAt = Date.now(),
): Promise<void> {
  const existing = await ctx.db
    .query("reportDirtyDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .unique();
  if (existing) {
    await ctx.db.patch("reportDirtyDay", existing._id, {
      reason,
      markedAt,
      firstMarkedAt: existing.firstMarkedAt ?? existing.markedAt,
      generation: (existing.generation ?? 0) + 1,
      eligibleAt: markedAt,
      attempts: 0,
      claimedAt: undefined,
      lastFailure: undefined,
    });
    return;
  }
  await ctx.db.insert("reportDirtyDay", {
    storeId,
    operatingDate,
    reason,
    markedAt,
    firstMarkedAt: markedAt,
    generation: 1,
    eligibleAt: markedAt,
    attempts: 0,
  });
}

/**
 * Containment fallback for `recordFacts` (see the invariant block in
 * ingest.ts). When ingestion fails AND the inline `write_failure` dirty mark
 * also fails, the catch block enqueues this mutation instead of throwing:
 * the scheduler enqueue is a write to a different table than the one that
 * just failed, and a scheduled mutation is durable — once the domain
 * transaction commits, Convex retries it independently until it runs. The
 * days therefore still get their rebuild marks, just moments after commit
 * rather than inside it.
 *
 * Deliberately narrow: `write_failure` is the only reason this path may
 * write. Every other reason has a caller that can mark inline.
 */
export const markWriteFailureDays = internalMutation({
  args: {
    storeId: v.id("store"),
    dates: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    for (const date of args.dates) {
      await markDirty(ctx, args.storeId, date, "write_failure");
    }
  },
});
