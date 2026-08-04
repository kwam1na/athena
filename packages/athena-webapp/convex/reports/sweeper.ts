import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  REPORTS_FOLD_VERSION,
  type CloseRef,
  type FoldFact,
  normalizeCurrencyCode,
} from "../../shared/reportsContract";
import { foldDay } from "./foldDay";
import { computeRange } from "./customRange";
import {
  cleanupExpiredMovement,
  scheduleEligibleMovementWork,
} from "./skuMovementRange";
import { rebuildStoreOverview } from "./overview";
import { rebuildRollupsForDates } from "./rollups";
import {
  markWeekDirty,
  reconcileRecentAcceptedWeeksForStore,
  rebuildCurrentWeek,
  refreshAcceptedWeekForDate,
} from "./weekly";

/**
 * The sweeper — the ONE reporting cron (slice C).
 *
 * Liveness comes in two deliberate flavors:
 *
 * FOLDS are declarative: work is a `reportDirtyDay` row, this is the only
 * consumer, and a crashed sweep leaves marks in place for the next tick.
 * There are no best-effort scheduling chains and no wedged states in the
 * fold lane.
 *
 * The MOVEMENT lifecycle (reports/skuMovementRange.ts) owns its own queue:
 * admitted requests progress through promptly scheduled internal-action
 * continuations, and this cron is only their BACKSTOP — an unconditional,
 * globally indexed `movementEligibleAt` scan that re-SCHEDULES dropped
 * continuations (never aggregates inline, and never depends on a store
 * having dirty-day marks). Movement snapshot cleanup (child rows first,
 * then headers) rides the same unconditional section.
 *
 * At-least-once by construction: the mark is deleted BEFORE the fold. A crash
 * after the delete loses nothing (the fold is idempotent and the next fact
 * re-dirties the day); a crash before it simply re-runs the fold. Both are
 * safe; double-processing is not — movement batches carry phase/fence
 * expectations for the same reason.
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
/** Weekly singleton rebuilds per existing sweep; one marker per store. */
export const WEEKLY_DIRTY_BATCH = 10;

export const REPORTS_SWEEP_STORE_ALLOWLIST_ENV =
  "REPORTS_SWEEP_STORE_ALLOWLIST";

export type SweepResult = {
  marksExamined: number;
  daysFolded: number;
  foldFailures: number;
  /** Days refused because they exceed a fold read cap (see DayCapExceeded). */
  capExceeded: number;
  skippedNotAllowed: number;
  storesTouched: number;
  rangesComputed: number;
  rangesExpired: number;
  /** Backstop-scheduled movement workers (reports/skuMovementRange.ts). */
  movementWorkersScheduled: number;
  /** Expired movement child rows deleted (child-first cleanup). */
  movementChildrenExpired: number;
  /** Expired movement headers deleted after their children drained. */
  movementHeadersExpired: number;
  weeksRebuilt: number;
  weekFailures: number;
  weeksAccepted: number;
  weeksRefreshed: number;
};

/**
 * A day holds more rows than a fold read is allowed to take.
 *
 * `.take(n)` truncates silently, so folding past the cap would write a
 * confidently wrong total that is indistinguishable from a real one — the
 * exact failure this layer exists to remove. The day is refused instead: no
 * document is written, the mark is kept, and the sweep reports it separately
 * from a transient failure. Raising the cap makes the next sweep succeed.
 */
export class DayCapExceeded extends Error {
  constructor(
    readonly operatingDate: string,
    readonly cap: number,
    readonly what: "facts" | "skuDays",
  ) {
    super(
      `Operating day ${operatingDate} exceeds the ${what} fold cap of ${cap}; ` +
        "refusing to fold a truncated day.",
    );
    this.name = "DayCapExceeded";
  }
}

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
    ...(fact.paymentAllocationMinor !== undefined
      ? { paymentAllocationMinor: fact.paymentAllocationMinor }
      : {}),
    ...(fact.paymentAllocationCoverage !== undefined
      ? { paymentAllocationCoverage: fact.paymentAllocationCoverage }
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
  const store = await ctx.db.get("store", storeId);
  const storeCurrency = normalizeCurrencyCode(store?.currency);

  // One past the cap, so a full page is distinguishable from a truncated one.
  const facts = await ctx.db
    .query("reportFact")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .take(MAX_FACTS_PER_DAY + 1);

  if (facts.length > MAX_FACTS_PER_DAY) {
    throw new DayCapExceeded(operatingDate, MAX_FACTS_PER_DAY, "facts");
  }

  // Read up front, and cap-check before anything is written: the sweep catches
  // fold errors, and a caught error does NOT roll back writes already made in
  // the same mutation. Throwing half-way through would commit a day document
  // whose per-SKU rows were never reconciled.
  const existingSkuDays = await ctx.db
    .query("reportSkuDay")
    .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .take(MAX_SKU_DAY_ROWS_PER_DAY + 1);

  // Past the cap, rows for SKUs that lost activity would never be deleted, so
  // the day would keep stale per-SKU numbers. Refuse rather than half-reconcile.
  if (existingSkuDays.length > MAX_SKU_DAY_ROWS_PER_DAY) {
    throw new DayCapExceeded(
      operatingDate,
      MAX_SKU_DAY_ROWS_PER_DAY,
      "skuDays",
    );
  }

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

  // Certified fold revision: a per-day monotonic counter, advanced on EVERY
  // fold of the day. Deliberately not the fold timestamp — a counter cannot
  // collide across fast successive folds, and it is deterministic within this
  // mutation. The same value is stamped on the day and on every SKU row
  // written below, so `movementSourceRowMatchesRevision` can prove a SKU row
  // belongs to exactly the day generation a movement snapshot admitted via
  // `admissibleMovementDayRevision`. Rows written before certification existed
  // carry no revision and are inadmissible until refolded.
  const certifiedFoldRevision = (existingDay?.certifiedFoldRevision ?? 0) + 1;

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
    certifiedFoldRevision,
    factCount: result.day.factCount,
    lastFactRecordedAt: result.day.lastFactRecordedAt,
    flags: result.day.flags,
    paymentPosture: result.day.paymentPosture,
  };

  if (existingDay) {
    await ctx.db.patch("reportDay", existingDay._id, dayDoc);
  } else {
    await ctx.db.insert("reportDay", dayDoc);
  }

  // --- reportSkuDay: replace the day's rows ---------------------------------

  const seen = new Set<string>();

  for (const row of existingSkuDays) {
    const key = String(row.productSkuId);
    const next = result.skuDays.get(key);

    if (!next) {
      // The SKU no longer has activity on this day (corrected/voided line).
      await ctx.db.delete("reportSkuDay", row._id);
      continue;
    }

    seen.add(key);
    await ctx.db.patch("reportSkuDay", row._id, {
      ...next,
      foldedAt: now,
      certifiedFoldRevision,
    });
  }

  for (const [skuId, metrics] of result.skuDays) {
    if (seen.has(skuId)) continue;
    await ctx.db.insert("reportSkuDay", {
      storeId,
      productSkuId: skuId as Id<"productSku">,
      operatingDate,
      ...metrics,
      foldedAt: now,
      certifiedFoldRevision,
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
    await ctx.db.patch("reportDirtyDay", existing._id, {
      reason,
      markedAt: now,
    });
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
    // Movement rows share the header table and are ALSO "pending" while
    // their worker runs; their lifecycle is owned entirely by
    // reports/skuMovementRange.ts, never by the summary compute path.
    if (request.kind === "sku_movement") continue;
    try {
      await computeRange(ctx, request);
      computed += 1;
    } catch (error) {
      // A range is a convenience read; one that cannot be computed is recorded
      // as failed rather than left pending forever (which would re-run it on
      // every tick). The requester sees the reason.
      await ctx.db.patch("reportRangeResult", request._id, {
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

  let deleted = 0;
  for (const row of expired) {
    // Movement headers own child rows and must drain child-first through
    // cleanupExpiredMovement; deleting them here would skip that ordering.
    if (row.kind === "sku_movement") continue;
    await ctx.db.delete("reportRangeResult", row._id);
    deleted += 1;
  }
  return deleted;
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
    capExceeded: 0,
    skippedNotAllowed: 0,
    storesTouched: 0,
    rangesComputed: 0,
    rangesExpired: 0,
    movementWorkersScheduled: 0,
    movementChildrenExpired: 0,
    movementHeadersExpired: 0,
    weeksRebuilt: 0,
    weekFailures: 0,
    weeksAccepted: 0,
    weeksRefreshed: 0,
  };

  const touchedStores = new Map<string, Id<"store">>();
  const foldedDatesByStore = new Map<string, Set<string>>();

  for (const mark of marks) {
    if (
      result.daysFolded + result.foldFailures + result.capExceeded >=
      SWEEP_DIRTY_BATCH
    ) {
      break;
    }

    const storeKey = String(mark.storeId);

    if (!allowlist.has(storeKey)) {
      // Left in place, untouched: a store outside the rollout keeps its queue
      // so that enabling it later folds its backlog rather than losing it.
      result.skippedNotAllowed += 1;
      continue;
    }

    // Delete first — see the at-least-once note at the top of this module.
    await ctx.db.delete("reportDirtyDay", mark._id);
    touchedStores.set(storeKey, mark.storeId);

    try {
      // `day_open` folds keep the day `open` (unless a close reconciles it).
      // The sweeper does NOT re-mark the open day itself: ingestion upserts a
      // fresh `day_open` mark with every current-day fact, so a quiet day
      // stops being refolded instead of looping one fold per tick forever.
      await foldAndReplaceDay(ctx, mark.storeId, mark.operatingDate, now, {
        preserveOpen: mark.reason === "day_open",
      });
      const foldedDates = foldedDatesByStore.get(storeKey) ?? new Set<string>();
      foldedDates.add(mark.operatingDate);
      foldedDatesByStore.set(storeKey, foldedDates);
      result.daysFolded += 1;
    } catch (error) {
      // Containment: a day that could not be folded goes back on the queue
      // under its own reason so the failure is visible and self-healing.
      //
      // An over-cap day is counted apart from a transient failure: nothing was
      // written, and retrying will keep refusing until the cap is raised or the
      // day's volume changes. It stays on the queue so the refusal is visible
      // and so a raised cap heals it on the next sweep, but conflating it with
      // a write failure would hide a structural limit behind a flaky-looking
      // counter.
      if (error instanceof DayCapExceeded) {
        result.capExceeded += 1;
      } else {
        result.foldFailures += 1;
      }
      await markDayDirty(
        ctx,
        mark.storeId,
        mark.operatingDate,
        error instanceof DayCapExceeded ? "fact_cap_exceeded" : "write_failure",
        now,
      );
    }
  }

  for (const storeId of touchedStores.values()) {
    await rebuildStoreOverview(ctx, storeId, now);
    result.rangesComputed += await computePendingRanges(ctx, storeId);
    // A day fold is the sole normal signal for current weekly truth. The
    // singleton is still built from reportDay only, not from source domains.
    // The folded dates ride on the marker rather than on this tick's memory:
    // a store whose marker falls outside the weekly page below would otherwise
    // lose its exact historical amendment handoff to page-boundary timing.
    await markWeekDirty(ctx, storeId, "day_folded", now, {
      foldedDates: [...(foldedDatesByStore.get(String(storeId)) ?? [])],
    });
  }

  const dirtyWeeks = await ctx.db
    .query("reportDirtyWeek")
    .withIndex("by_markedAt")
    .order("asc")
    .take(WEEKLY_DIRTY_BATCH);
  for (const mark of dirtyWeeks) {
    if (!allowlist.has(String(mark.storeId))) continue;
    const store = await ctx.db.get("store", mark.storeId);
    if (!store || store.reportingReseedStartedAt !== undefined) continue;
    // Drained with the mark: the dates and the acceptance intent are durable
    // work, so a failed tick puts both back rather than losing the handoff.
    const foldedDates = mark.foldedDates ?? [];
    const intent = mark.intent;
    await ctx.db.delete("reportDirtyWeek", mark._id);
    try {
      const status = await rebuildCurrentWeek(ctx, mark.storeId, now);
      if (status === "rebuilt") result.weeksRebuilt += 1;
      result.weeksAccepted += await reconcileRecentAcceptedWeeksForStore(
        ctx,
        mark.storeId,
        now,
      );
      for (const operatingDate of foldedDates) {
        result.weeksRefreshed += await refreshAcceptedWeekForDate(
          ctx,
          mark.storeId,
          operatingDate,
          now,
        );
      }
    } catch {
      result.weekFailures += 1;
      await markWeekDirty(ctx, mark.storeId, "write_failure", now, {
        foldedDates,
        ...(intent ? { intent } : {}),
      });
    }
  }

  result.storesTouched = touchedStores.size;
  result.rangesExpired = await expireRangeResults(ctx, now);

  // Movement lane — UNCONDITIONAL, never coupled to touchedStores: the
  // backstop rescues dropped continuations for any store, and expired
  // snapshots drain child-first. Scheduling and deletion only; movement
  // aggregation always happens in its own fenced worker batches.
  result.movementWorkersScheduled = await scheduleEligibleMovementWork(
    ctx,
    now,
  );
  const movementCleanup = await cleanupExpiredMovement(ctx, now);
  result.movementChildrenExpired = movementCleanup.childrenDeleted;
  result.movementHeadersExpired = movementCleanup.headersDeleted;

  return result;
}

/** The cron entry point. Registered once, every 5 minutes, in convex/crons.ts. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx): Promise<SweepResult> => sweepWithCtx(ctx),
});
