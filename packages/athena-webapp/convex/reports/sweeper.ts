import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  REPORTS_FOLD_VERSION,
  type CloseRef,
  type FoldFact,
} from "../../shared/reportsContract";
import { foldDay } from "./foldDay";
import { computeRange } from "./customRange";
import { rebuildStoreOverview } from "./overview";
import { rebuildRollupsForDates } from "./rollups";

/**
 * The sweeper — the ONE reporting cron (slice C).
 *
 * Liveness is declarative: work is a `reportDirtyDay` row, this is the only
 * consumer, and a crashed sweep leaves marks in place for the next tick. There
 * are no best-effort scheduling chains and no wedged states.
 *
 * At-least-once by construction: the mark is deleted BEFORE the fold. A crash
 * after the delete loses nothing (the fold is idempotent and the next fact
 * re-dirties the day); a crash before it simply re-runs the fold. Both are
 * safe; double-processing is not.
 *
 * Every read is bounded. Nothing here scans a table, and any work that does
 * not fit in a tick is left on the queue for the next one.
 */

/** Dirty marks folded per tick. */
export const SWEEP_DIRTY_BATCH = 10;
/**
 * Marks examined per tick. Larger than the fold batch because marks belonging
 * to non-allowlisted stores are skipped WITHOUT being deleted — without slack
 * they would permanently starve allowlisted work behind them.
 */
export const SWEEP_MARK_SCAN_LIMIT = 60;
/** Facts read for one day fold. Wigclub's busiest day is 93. */
export const MAX_FACTS_PER_DAY = 2000;
/** Existing sku-day rows reconciled for one day. */
export const MAX_SKU_DAY_ROWS_PER_DAY = 2000;
/** Candidate closes examined for one (store, day). */
export const MAX_CLOSES_PER_DAY = 8;
/** Day docs examined when locating the store's open day. */
export const OPEN_DAY_SCAN_LIMIT = 5;
/** Pending range requests computed per tick, per store. */
export const RANGE_BATCH_PER_STORE = 3;
/** Expired range results deleted per tick. */
export const RANGE_EXPIRY_BATCH = 20;

export const REPORTS_SWEEP_STORE_ALLOWLIST_ENV =
  "REPORTS_SWEEP_STORE_ALLOWLIST";

export type SweepResult = {
  marksExamined: number;
  daysFolded: number;
  foldFailures: number;
  skippedNotAllowed: number;
  storesTouched: number;
  rangesComputed: number;
  rangesExpired: number;
};

// ---------------------------------------------------------------------------
// Store allowlist
// ---------------------------------------------------------------------------

/**
 * Comma-separated store ids. Empty or unset allows NOTHING: the rollout gate
 * is fail-closed so a fresh deployment never folds a store nobody has decided
 * to switch over yet (wigclub dev first, per the plan).
 */
export function parseStoreAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

export function readStoreAllowlist(): Set<string> {
  return parseStoreAllowlist(process.env[REPORTS_SWEEP_STORE_ALLOWLIST_ENV]);
}

// ---------------------------------------------------------------------------
// Fold inputs
// ---------------------------------------------------------------------------

export function toFoldFact(fact: Doc<"reportFact">): FoldFact {
  return {
    factId: String(fact._id),
    sourceDomain: fact.sourceDomain,
    sourceId: fact.sourceId,
    lineId: fact.lineId,
    factKind: fact.factKind,
    occurredAt: fact.occurredAt,
    recordedAt: fact.recordedAt,
    currency: fact.currency,
    grossAmountMinor: fact.grossAmountMinor,
    netAmountMinor: fact.netAmountMinor,
    taxAmountMinor: fact.taxAmountMinor,
    discountAmountMinor: fact.discountAmountMinor,
    quantity: fact.quantity,
    ...(fact.productSkuId !== undefined
      ? { productSkuId: String(fact.productSkuId) }
      : {}),
    ...(fact.unitCostMinor !== undefined
      ? { unitCostMinor: fact.unitCostMinor }
      : {}),
    quarantined: fact.quarantine !== undefined,
  };
}

/**
 * Pick the accepted close for a (store, day), if one exists.
 *
 * `dailyClose` is the legacy operations table and it is not single-valued per
 * day: a day can be reopened and superseded, leaving several rows. "Accepted"
 * is therefore read as: `status === "completed"`, not `lifecycleStatus ===
 * "superseded"`, and — when several survive — the most recently completed one.
 * Anything else (no completed row, or only superseded rows) folds as "no
 * close", which yields a `provisional` day rather than a wrong reconciliation.
 *
 * Close net sales follow the legacy close emitter: `summary.adjustedSalesTotal`
 * when present, else `summary.salesTotal`, else 0.
 */
export function selectAcceptedClose(
  closes: readonly Doc<"dailyClose">[],
): Doc<"dailyClose"> | null {
  const accepted = closes.filter(
    (close) =>
      close.status === "completed" && close.lifecycleStatus !== "superseded",
  );
  if (accepted.length === 0) return null;

  return accepted.reduce((best, candidate) => {
    const bestAt = best.completedAt ?? best.updatedAt;
    const candidateAt = candidate.completedAt ?? candidate.updatedAt;
    return candidateAt > bestAt ? candidate : best;
  });
}

export function toCloseRef(close: Doc<"dailyClose">): CloseRef {
  const summary = close.summary as Record<string, unknown>;
  const adjusted = summary.adjustedSalesTotal;
  const sales = summary.salesTotal;
  const closeNetSalesMinor =
    typeof adjusted === "number"
      ? adjusted
      : typeof sales === "number"
        ? sales
        : 0;

  return {
    closeId: String(close._id),
    acceptedAt: close.completedAt ?? close.updatedAt,
    closeNetSalesMinor,
  };
}

async function loadAcceptedClose(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
): Promise<Doc<"dailyClose"> | null> {
  const closes = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .take(MAX_CLOSES_PER_DAY);

  return selectAcceptedClose(closes);
}

// ---------------------------------------------------------------------------
// Fold one day
// ---------------------------------------------------------------------------

/**
 * Replace every derived doc for one (store, operating day) from its facts.
 *
 * Wholesale replacement — not an adjustment — is what makes re-running the
 * sweeper over the same day a no-op, so at-least-once delivery of dirty marks
 * is sufficient.
 */
export async function foldAndReplaceDay(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
  now: number,
  opts?: {
    /**
     * Keep the day's status `open` when the fold would say `provisional`.
     * Used for `day_open`-reason folds: the store's current day is refolded
     * for accuracy but is still in progress — only a close (fold returns
     * `reconciled`/`amended`) or rollover moves it out of `open`.
     */
    preserveOpen?: boolean;
  },
): Promise<void> {
  const store = await ctx.db.get(storeId);
  const storeCurrency = store?.currency ?? "";

  const facts = await ctx.db
    .query("reportFact")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .take(MAX_FACTS_PER_DAY);

  const close = await loadAcceptedClose(ctx, storeId, operatingDate);
  const closeRef = close ? toCloseRef(close) : undefined;

  const result = foldDay(storeCurrency, facts.map(toFoldFact), closeRef);

  // --- reportDay: insert or full replace -----------------------------------
  const existingDay = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .unique();

  const dayDoc = {
    storeId,
    operatingDate,
    currency: storeCurrency,
    status:
      opts?.preserveOpen === true && result.day.status === "provisional"
        ? ("open" as const)
        : result.day.status,
    grossSalesMinor: result.day.grossSalesMinor,
    netSalesMinor: result.day.netSalesMinor,
    refundsMinor: result.day.refundsMinor,
    unitsSold: result.day.unitsSold,
    unitsReturned: result.day.unitsReturned,
    uncostedRevenueMinor: result.day.uncostedRevenueMinor,
    grossProfitMinor: result.day.grossProfitMinor,
    paymentsCollectedMinor: result.day.paymentsCollectedMinor,
    paymentsRefundedMinor: result.day.paymentsRefundedMinor,
    paymentAllocatedMinor: result.day.paymentAllocatedMinor,
    // `undefined` is an explicit erase on patch — a day that lost its close (or
    // its amendment) must not keep stale reconciliation fields.
    closeId: close ? close._id : undefined,
    closeAcceptedAt: closeRef?.acceptedAt,
    closeVarianceMinor: result.day.closeVarianceMinor,
    postCloseNetSalesDeltaMinor: result.day.postCloseNetSalesDeltaMinor,
    foldedAt: now,
    foldVersion: REPORTS_FOLD_VERSION,
    factCount: result.day.factCount,
    lastFactRecordedAt: result.day.lastFactRecordedAt,
    flags: result.day.flags,
  };

  if (existingDay) {
    await ctx.db.patch(existingDay._id, dayDoc);
  } else {
    await ctx.db.insert("reportDay", dayDoc);
  }

  // --- reportSkuDay: replace the day's rows ---------------------------------
  const existingSkuDays = await ctx.db
    .query("reportSkuDay")
    .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .take(MAX_SKU_DAY_ROWS_PER_DAY);

  const seen = new Set<string>();

  for (const row of existingSkuDays) {
    const key = String(row.productSkuId);
    const next = result.skuDays.get(key);

    if (!next) {
      // The SKU no longer has activity on this day (corrected/voided line).
      await ctx.db.delete(row._id);
      continue;
    }

    seen.add(key);
    await ctx.db.patch(row._id, { ...next, foldedAt: now });
  }

  for (const [skuId, metrics] of result.skuDays) {
    if (seen.has(skuId)) continue;
    await ctx.db.insert("reportSkuDay", {
      storeId,
      productSkuId: skuId as Id<"productSku">,
      operatingDate,
      ...metrics,
      foldedAt: now,
    });
  }

  // --- rollups: re-aggregate the day's calendar periods ---------------------
  await rebuildRollupsForDates(ctx, storeId, [operatingDate]);
}

// ---------------------------------------------------------------------------
// Dirty marks
// ---------------------------------------------------------------------------

/** Upsert a dirty mark (one row per store-day, newest reason wins). */
export async function markDayDirty(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
  reason: Doc<"reportDirtyDay">["reason"],
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("reportDirtyDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, { reason, markedAt: now });
    return;
  }

  await ctx.db.insert("reportDirtyDay", {
    storeId,
    operatingDate,
    reason,
    markedAt: now,
  });
}

/**
 * The store's current operating date, read off the day docs: the day whose
 * reportDay is still `open`. Deliberately not resolved from the store's
 * timezone — operating-day resolution belongs to ingestion, and duplicating it
 * here would create a second authority that can disagree with the facts.
 */
export async function findOpenOperatingDate(
  ctx: MutationCtx,
  storeId: Id<"store">,
): Promise<string | null> {
  const recent = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
    .order("desc")
    .take(OPEN_DAY_SCAN_LIMIT);

  return recent.find((day) => day.status === "open")?.operatingDate ?? null;
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

async function computePendingRanges(
  ctx: MutationCtx,
  storeId: Id<"store">,
): Promise<number> {
  const pending = await ctx.db
    .query("reportRangeResult")
    .withIndex("by_storeId_requestKey", (q) => q.eq("storeId", storeId))
    .filter((q) => q.eq(q.field("status"), "pending"))
    .take(RANGE_BATCH_PER_STORE);

  let computed = 0;

  for (const request of pending) {
    try {
      await computeRange(ctx, request);
      computed += 1;
    } catch (error) {
      // A range is a convenience read; one that cannot be computed is recorded
      // as failed rather than left pending forever (which would re-run it on
      // every tick). The requester sees the reason.
      await ctx.db.patch(request._id, {
        status: "failed",
        failureReason: error instanceof Error ? error.message : String(error),
        computedAt: Date.now(),
      });
    }
  }

  return computed;
}

async function expireRangeResults(
  ctx: MutationCtx,
  now: number,
): Promise<number> {
  const expired = await ctx.db
    .query("reportRangeResult")
    .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
    .take(RANGE_EXPIRY_BATCH);

  for (const row of expired) await ctx.db.delete(row._id);
  return expired.length;
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

export async function sweepWithCtx(ctx: MutationCtx): Promise<SweepResult> {
  const now = Date.now();
  const allowlist = readStoreAllowlist();

  const marks = await ctx.db
    .query("reportDirtyDay")
    .withIndex("by_markedAt")
    .order("asc")
    .take(SWEEP_MARK_SCAN_LIMIT);

  const result: SweepResult = {
    marksExamined: marks.length,
    daysFolded: 0,
    foldFailures: 0,
    skippedNotAllowed: 0,
    storesTouched: 0,
    rangesComputed: 0,
    rangesExpired: 0,
  };

  const touchedStores = new Map<string, Id<"store">>();

  for (const mark of marks) {
    if (result.daysFolded + result.foldFailures >= SWEEP_DIRTY_BATCH) break;

    const storeKey = String(mark.storeId);

    if (!allowlist.has(storeKey)) {
      // Left in place, untouched: a store outside the rollout keeps its queue
      // so that enabling it later folds its backlog rather than losing it.
      result.skippedNotAllowed += 1;
      continue;
    }

    // Delete first — see the at-least-once note at the top of this module.
    await ctx.db.delete(mark._id);
    touchedStores.set(storeKey, mark.storeId);

    try {
      // `day_open` folds keep the day `open` (unless a close reconciles it).
      // The sweeper does NOT re-mark the open day itself: ingestion upserts a
      // fresh `day_open` mark with every current-day fact, so a quiet day
      // stops being refolded instead of looping one fold per tick forever.
      await foldAndReplaceDay(ctx, mark.storeId, mark.operatingDate, now, {
        preserveOpen: mark.reason === "day_open",
      });
      result.daysFolded += 1;
    } catch {
      // Containment: a day that could not be folded goes back on the queue
      // under its own reason so the failure is visible and self-healing.
      result.foldFailures += 1;
      await markDayDirty(
        ctx,
        mark.storeId,
        mark.operatingDate,
        "write_failure",
        now,
      );
    }
  }

  for (const storeId of touchedStores.values()) {
    await rebuildStoreOverview(ctx, storeId, now);
    result.rangesComputed += await computePendingRanges(ctx, storeId);
  }

  result.storesTouched = touchedStores.size;
  result.rangesExpired = await expireRangeResults(ctx, now);

  return result;
}

/** The cron entry point. Registered once, every 5 minutes, in convex/crons.ts. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx): Promise<SweepResult> => sweepWithCtx(ctx),
});
