import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const SKU_ATTRIBUTION_APPLIED_ADVANCE_LIMIT = 50;

export async function currentSkuAttributionCursorWithCtx(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
) {
  return await ctx.db
    .query("reportingSkuAttributionCursor")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .first();
}

export async function unresolvedSkuAttributionConflictAtOrBeforeWithCtx(
  ctx: Pick<QueryCtx, "db">,
  input: { storeId: Id<"store">; terminalSequence: number },
) {
  return await ctx.db
    .query("reportingSkuAttribution")
    .withIndex("by_storeId_status_materialSequence", (q) =>
      q
        .eq("storeId", input.storeId)
        .eq("status", "conflict")
        .lte("materialSequence", input.terminalSequence),
    )
    .first();
}

export async function allocateSkuAttributionSequenceWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
) {
  const cursor = await currentSkuAttributionCursorWithCtx(ctx, storeId);
  const sequence = cursor?.nextSequence ?? 1;
  const now = Date.now();
  if (cursor) {
    await ctx.db.patch("reportingSkuAttributionCursor", cursor._id, {
      latestMaterialSequence: sequence,
      nextSequence: sequence + 1,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("reportingSkuAttributionCursor", {
      latestMaterialSequence: sequence,
      nextSequence: sequence + 1,
      storeId,
      updatedAt: now,
    });
  }
  return sequence;
}

export async function markSkuAttributionAppliedWithCtx(
  ctx: MutationCtx,
  input: { sequence: number; storeId: Id<"store"> },
) {
  const cursor = await currentSkuAttributionCursorWithCtx(ctx, input.storeId);
  if (!cursor || input.sequence > cursor.latestMaterialSequence) {
    return {
      advancedTo: undefined,
      caughtUp: false,
      needsContinuation: false,
    };
  }
  const receipt = await ctx.db
    .query("reportingSkuAttributionAppliedSequence")
    .withIndex("by_storeId_sequence", (q) =>
      q.eq("storeId", input.storeId).eq("sequence", input.sequence),
    )
    .first();
  if (!receipt) {
    await ctx.db.insert("reportingSkuAttributionAppliedSequence", {
      completedAt: Date.now(),
      sequence: input.sequence,
      storeId: input.storeId,
    });
  }
  return await advanceSkuAttributionAppliedWithCtx(ctx, input.storeId);
}

export async function advanceSkuAttributionAppliedWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
) {
  const cursor = await currentSkuAttributionCursorWithCtx(ctx, storeId);
  if (!cursor) {
    return {
      advancedTo: undefined,
      caughtUp: false,
      needsContinuation: false,
    };
  }
  let applied = cursor.latestAppliedSequence ?? 0;
  let scanned = 0;
  while (
    applied < cursor.latestMaterialSequence &&
    scanned < SKU_ATTRIBUTION_APPLIED_ADVANCE_LIMIT
  ) {
    const next = applied + 1;
    const row = await ctx.db
      .query("reportingSkuAttributionAppliedSequence")
      .withIndex("by_storeId_sequence", (q) =>
        q.eq("storeId", storeId).eq("sequence", next),
      )
      .first();
    if (!row) break;
    applied = next;
    scanned += 1;
  }
  if (applied === (cursor.latestAppliedSequence ?? 0)) {
    return {
      advancedTo: undefined,
      caughtUp: applied === cursor.latestMaterialSequence,
      needsContinuation: false,
    };
  }
  await ctx.db.patch("reportingSkuAttributionCursor", cursor._id, {
    latestAppliedSequence: applied,
    updatedAt: Date.now(),
  });
  return {
    advancedTo: applied,
    caughtUp: applied === cursor.latestMaterialSequence,
    needsContinuation:
      applied < cursor.latestMaterialSequence &&
      scanned === SKU_ATTRIBUTION_APPLIED_ADVANCE_LIMIT,
  };
}
