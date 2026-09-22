/* eslint-disable @convex-dev/no-collect-in-query -- The count query collects one store's bounded catalogue (~1.3k rows) to report coverage; it is hand-run, never on a request path. */
import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { upsertProductSkuSearchProjection } from "../inventory/skuSearch";

/**
 * Populate `assistantSearchText` and `assistantVisible` on the product SKU
 * search projection.
 *
 * Both fields are optional in the schema so the deploy lands before any row
 * carries them; this hand-run migration then rewrites the projection for every
 * SKU in a store. It paginates `productSku` rather than the projection table —
 * the repair mutation's precedent — so a SKU that never got a projection row
 * gains one here instead of staying invisible to the assistant forever.
 *
 * `advanceRevision: false` keeps the POS register catalog revision still: the
 * two new keys are outside the register's effective field set, so every POS
 * terminal would otherwise re-sync the whole catalogue for a change it cannot
 * even see.
 */
type BatchArgs = {
  cursor?: string | null;
  dryRun?: boolean;
  limit?: number;
  storeId: Id<"store">;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function boundedLimit(limit?: number) {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(limit, MAX_LIMIT);
}

export async function backfillProductSkuSearchAssistantFieldsWithCtx(
  ctx: MutationCtx,
  args: BatchArgs,
) {
  const dryRun = args.dryRun !== false;
  const page = await ctx.db
    .query("productSku")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .paginate({
      cursor: args.cursor ?? null,
      numItems: boundedLimit(args.limit),
    });

  let missingProjectionCount = 0;
  let pendingCount = 0;
  let sourceOrphanCount = 0;
  let unchangedCount = 0;
  let upsertedCount = 0;

  for (const sku of page.page) {
    if (dryRun) {
      // The same single indexed read the projection writer would do, so the
      // preview costs no more than the apply it previews.
      const [existing] = await ctx.db
        .query("productSkuSearch")
        .withIndex("by_productSkuId", (q) => q.eq("productSkuId", sku._id))
        .take(1);
      if (!existing) missingProjectionCount += 1;
      if (!existing || existing.assistantSearchText === undefined) {
        pendingCount += 1;
      }
      continue;
    }

    const outcome = await upsertProductSkuSearchProjection(ctx, sku._id, {
      advanceRevision: false,
    });
    if (outcome === "upserted") upsertedCount += 1;
    if (outcome === "unchanged") unchangedCount += 1;
    if (outcome === "source_orphan") sourceOrphanCount += 1;
  }

  return {
    continueCursor: page.continueCursor,
    dryRun,
    isDone: page.isDone,
    missingProjectionCount,
    pendingCount,
    processedCount: page.page.length,
    sourceOrphanCount,
    unchangedCount,
    upsertedCount,
  };
}

/**
 * Read-only coverage check: the store's projection rows carrying
 * `assistantSearchText` against its SKUs. `isComplete` is the one number to
 * read before minting a token — until it is true the assistant's search is
 * blind to part of the catalogue.
 */
export async function countProductSkuSearchAssistantFieldsWithCtx(
  ctx: QueryCtx,
  args: { storeId: Id<"store"> },
) {
  const [projections, skus] = await Promise.all([
    ctx.db
      .query("productSkuSearch")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect(),
    ctx.db
      .query("productSku")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect(),
  ]);
  const withAssistantSearchTextCount = projections.filter(
    (row) => row.assistantSearchText !== undefined,
  ).length;

  return {
    isComplete: withAssistantSearchTextCount === skus.length,
    productSkuCount: skus.length,
    projectionCount: projections.length,
    withAssistantSearchTextCount,
  };
}

export const backfillProductSkuSearchAssistantFields = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: backfillProductSkuSearchAssistantFieldsWithCtx,
});

export const countProductSkuSearchAssistantFields = internalQuery({
  args: {
    storeId: v.id("store"),
  },
  handler: countProductSkuSearchAssistantFieldsWithCtx,
});
