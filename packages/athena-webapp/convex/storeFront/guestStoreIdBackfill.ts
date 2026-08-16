import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";

/**
 * Give every resolvable legacy `guest` row the store it actually shopped.
 *
 * A guest is admitted at HTTP ingress by the bearer id in their `guest_id`
 * cookie, and the storefront adapter derives the store from the guest ROW. A
 * row with no `storeId` therefore cannot be clamped and is a terminal denial —
 * the shopper's bag simply stops working. `POST /guests` used to create rows
 * with no store at all, which is why the backlog exists;
 * `storeFront/guest:create` now requires `storeId`, so this is a one-time
 * drain rather than a recurring chase.
 *
 * ## What counts as evidence
 *
 * Only an AUTHORITATIVE related row: a `bag`, `checkoutSession`, or
 * `onlineOrder` that names this guest as its `storeFrontUserId`. Those rows are
 * written by the storefront itself with the store already resolved, so they are
 * a record of where the visitor shopped rather than a guess about it.
 *
 * Three refusals are deliberate:
 *
 * - **No related row → leave unset.** The guest stays denied. That is the
 *   correct outcome: we do not know which storefront they belong to, and a
 *   wrong store is worse than a denial — it would place a stranger inside a
 *   merchant's customer set.
 * - **Conflicting related rows → leave unset.** A guest id that appears under
 *   two stores is either shared or corrupted; picking a winner would be
 *   arbitrary. `conflictedCount` surfaces these for a human.
 * - **Never default to a store.** There is no "the" store, not even when the
 *   deployment has exactly one.
 *
 * Idempotent by construction: rows that already have a store are skipped, so a
 * re-run converges and a second run reports `resolvableCount: 0`.
 *
 * ## Operational note
 *
 * Run this BEFORE the next deploy of the storefront claim path, and drain it
 * with `verifyGuestStoreId` until `unresolvedCount` stops falling:
 *
 * ```
 * npx convex run --prod storeFront/guestStoreIdBackfill:backfillGuestStoreId \
 *   '{"dryRun": true, "autoContinue": true}'
 * npx convex run --prod storeFront/guestStoreIdBackfill:backfillGuestStoreId \
 *   '{"dryRun": false, "autoContinue": true}'
 * npx convex run --prod storeFront/guestStoreIdBackfill:verifyGuestStoreId '{}'
 * ```
 *
 * A residual `unresolvedCount` is expected and is not a failure: those are
 * guests who never created a bag, session, or order, and denying them costs
 * nothing because they have nothing to return to.
 */

type BatchArgs = {
  autoContinue?: boolean;
  changedSoFar?: number;
  conflictedSoFar?: number;
  cursor?: string | null;
  dryRun?: boolean;
  limit?: number;
  processedSoFar?: number;
  unresolvedSoFar?: number;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
/** One guest cannot plausibly have shopped more distinct stores than this. */
const MAX_RELATED_ROWS = 8;

function boundedLimit(limit?: number) {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(limit, MAX_LIMIT);
}

async function guestPage(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  args: Pick<BatchArgs, "cursor" | "limit">,
) {
  return await ctx.db.query("guest").paginate({
    cursor: args.cursor ?? null,
    numItems: boundedLimit(args.limit),
  });
}

/** The single predicate the backfill and the verifier both answer with. */
function needsStore(guest: Doc<"guest">): boolean {
  return !guest.storeId;
}

export type GuestStoreResolution =
  | { kind: "resolved"; storeId: Id<"store"> }
  | { kind: "conflicted"; storeIds: readonly Id<"store">[] }
  | { kind: "unresolved" };

/**
 * Derive a guest's store from authoritative related rows only.
 *
 * Each of the three tables is indexed by `storeFrontUserId`, so this is three
 * bounded index reads per candidate rather than a scan.
 */
export async function resolveGuestStoreId(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  guestId: Id<"guest">,
): Promise<GuestStoreResolution> {
  const [bags, sessions, orders] = await Promise.all([
    ctx.db
      .query("bag")
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", guestId),
      )
      .take(MAX_RELATED_ROWS),
    ctx.db
      .query("checkoutSession")
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", guestId),
      )
      .take(MAX_RELATED_ROWS),
    ctx.db
      .query("onlineOrder")
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", guestId),
      )
      .take(MAX_RELATED_ROWS),
  ]);

  const storeIds = new Set<string>();
  for (const row of [...bags, ...sessions, ...orders]) {
    if (row.storeId) storeIds.add(String(row.storeId));
  }

  if (storeIds.size === 0) return { kind: "unresolved" };
  if (storeIds.size > 1) {
    return {
      kind: "conflicted",
      storeIds: [...storeIds] as Id<"store">[],
    };
  }
  return { kind: "resolved", storeId: [...storeIds][0] as Id<"store"> };
}

export async function backfillGuestStoreIdWithCtx(
  ctx: MutationCtx,
  args: BatchArgs,
) {
  // Dry run is the default: an operator has to say `dryRun: false` out loud
  // before this writes to production customer rows.
  const dryRun = args.dryRun !== false;
  const page = await guestPage(ctx, args);

  let changedCount = 0;
  let conflictedCount = 0;
  let unresolvedCount = 0;

  for (const guest of page.page) {
    if (!needsStore(guest)) continue;

    const resolution = await resolveGuestStoreId(ctx, guest._id);
    if (resolution.kind === "conflicted") {
      conflictedCount += 1;
      console.warn(
        `[guestStoreIdBackfill] Guest ${guest._id} names ${resolution.storeIds.length} stores; left unset.`,
      );
      continue;
    }
    if (resolution.kind === "unresolved") {
      unresolvedCount += 1;
      continue;
    }

    changedCount += 1;
    if (dryRun) continue;
    await ctx.db.patch("guest", guest._id, { storeId: resolution.storeId });
  }

  const totals = {
    changedCount: (args.changedSoFar ?? 0) + changedCount,
    conflictedCount: (args.conflictedSoFar ?? 0) + conflictedCount,
    processedCount: (args.processedSoFar ?? 0) + page.page.length,
    unresolvedCount: (args.unresolvedSoFar ?? 0) + unresolvedCount,
  };

  // Scheduled inside the transaction this batch committed, so the chain cannot
  // skip a page: either the writes and their successor both land, or neither
  // does and the operator resumes from the last cursor.
  if (args.autoContinue && !page.isDone) {
    await ctx.scheduler.runAfter(
      0,
      internal.storeFront.guestStoreIdBackfill.backfillGuestStoreId,
      {
        autoContinue: true,
        changedSoFar: totals.changedCount,
        conflictedSoFar: totals.conflictedCount,
        cursor: page.continueCursor,
        dryRun: args.dryRun,
        limit: args.limit,
        processedSoFar: totals.processedCount,
        unresolvedSoFar: totals.unresolvedCount,
      },
    );
  }

  return {
    changedCount,
    conflictedCount,
    continueCursor: page.continueCursor,
    dryRun,
    isDone: page.isDone,
    processedCount: page.page.length,
    unresolvedCount,
    // Cumulative across an `autoContinue` chain; equal to this batch when the
    // caller drives the cursor itself.
    totals,
  };
}

/**
 * Read-only drain check. Writes nothing, so it is safe against production at
 * any time; page through until `isDone` to get the whole picture.
 */
export async function verifyGuestStoreIdWithCtx(
  ctx: QueryCtx,
  args: Pick<BatchArgs, "cursor" | "limit">,
) {
  const page = await guestPage(ctx, args);
  const missing = page.page.filter(needsStore);

  let resolvableCount = 0;
  let conflictedCount = 0;
  for (const guest of missing) {
    const resolution = await resolveGuestStoreId(ctx, guest._id);
    if (resolution.kind === "resolved") resolvableCount += 1;
    if (resolution.kind === "conflicted") conflictedCount += 1;
  }

  return {
    conflictedCount,
    continueCursor: page.continueCursor,
    isDone: page.isDone,
    missingCount: missing.length,
    processedCount: page.page.length,
    resolvableCount,
    // What will still deny after the backfill drains: no evidence exists.
    unresolvedCount: missing.length - resolvableCount - conflictedCount,
  };
}

export const backfillGuestStoreId = internalMutation({
  args: {
    autoContinue: v.optional(v.boolean()),
    changedSoFar: v.optional(v.number()),
    conflictedSoFar: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    processedSoFar: v.optional(v.number()),
    unresolvedSoFar: v.optional(v.number()),
  },
  handler: backfillGuestStoreIdWithCtx,
});

export const verifyGuestStoreId = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: verifyGuestStoreIdWithCtx,
});
