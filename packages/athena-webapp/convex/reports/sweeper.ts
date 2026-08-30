import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  REPORTS_FOLD_VERSION,
  type CloseRef,
  type FoldFact,
  normalizeCurrencyCode,
} from "../../shared/reportsContract";
import { foldDay } from "./foldDay";
import { markDirty } from "./marks";
import { loadAcceptedCompactCloseWithCtx } from "./closeEvidence";
import { readPipelineControl } from "./pipelineControl";
import { readStoreAllowlist } from "./pipelineAllowlist";
export { readStoreAllowlist, parseStoreAllowlist, REPORTS_SWEEP_STORE_ALLOWLIST_ENV } from "./pipelineAllowlist";
import { captureRollupInputWithCtx } from "./rollupPipeline";
import { dispatchReportPipeline } from "./pipelineDispatchRoot";
import { transactionCountFromCloseSummary } from "./transactionCounts";
import { cleanupSummaryRangeWithCtx } from "./pipelineRange";
import { MOVEMENT_RANGE_SNAPSHOT_KIND } from "./skuMovementRange";
import { MIX_RANGE_SNAPSHOT_KIND } from "./skuMixRange";
import {
  cleanupExpiredRangeSnapshots,
  scheduleEligibleRangeSnapshotWork,
  type AnyRangeSnapshotKindConfig,
} from "./rangeSnapshotLifecycle";
import { rebuildStoreOverview } from "./overview";
import { rebuildRollupsForDates } from "./rollups";
import {
  markWeekDirty,
  reconcileRecentAcceptedWeeksForStore,
  rebuildCurrentWeek,
  refreshAcceptedWeekForDate,
} from "./weekly";

/**
 * The one reports cron only dispatches independent lanes (pipelineDispatch).
 * This module retains the canonical one-day fold and isolated legacy-store
 * compatibility sweep. Activated stores use pipelineDays: fold, immutable
 * input capture and exact handoffs commit before dirty acknowledgement.
 * Thrown data work rolls back; independent failure mutations preserve retry
 * evidence. Lease expiry is the durable backstop for dropped dispatch.
 *
 * Summary ranges own their cursor-batched queue; movement/mix retain their
 * existing lifecycle. Maintenance dispatch/child-first expiry runs even for
 * quiet stores. No transaction-count cap is a guarantee about read bytes:
 * pipelineReadCostOptimized tests the full pipeline's payload tradeoffs.
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
/** Expired range results deleted per tick. */
export const RANGE_EXPIRY_BATCH = 20;
/** Weekly singleton rebuilds per existing sweep; one marker per store. */
export const WEEKLY_DIRTY_BATCH = 10;

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
    // Absent stays absent: a stored fact with no method evidence must reach
    // the fold as unattributable, not as a mix field spelled `undefined`.
    ...(fact.paymentMethod !== undefined
      ? { paymentMethod: fact.paymentMethod }
      : {}),
    ...(fact.paymentMethodFrom !== undefined
      ? { paymentMethodFrom: fact.paymentMethodFrom }
      : {}),
    ...(fact.paymentParticipationId !== undefined
      ? { paymentParticipationId: fact.paymentParticipationId }
      : {}),
    ...(fact.paymentMixMinor !== undefined
      ? { paymentMixMinor: fact.paymentMixMinor }
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
 * "superseded"` or `"reopened"`, and — when several survive — the most recently
 * completed one.
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
      close.status === "completed" &&
      close.lifecycleStatus !== "superseded" &&
      close.lifecycleStatus !== "reopened",
  );
  if (accepted.length === 0) return null;

  return accepted.reduce((best, candidate) => {
    const bestAt = best.completedAt ?? best.updatedAt;
    const candidateAt = candidate.completedAt ?? candidate.updatedAt;
    return candidateAt > bestAt ? candidate : best;
  });
}

export function toCloseRef(close: Pick<Doc<"dailyClose">, "_id" | "summary" | "completedAt" | "updatedAt">): CloseRef {
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
    // Free: the summary is already in hand for the net-sales figure above.
    transactionCount: transactionCountFromCloseSummary(summary),
  };
}

async function loadAcceptedClose(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
): Promise<Pick<Doc<"dailyClose">, "_id" | "summary" | "completedAt" | "updatedAt"> | null> {
  if ((await readPipelineControl(ctx, storeId))?.mode === "active") {
    return loadAcceptedCompactCloseWithCtx(ctx, storeId, operatingDate);
  }
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
 * Map a dirty-day reason to the authority its fold carries over `open`.
 * Exhaustive on purpose: a new reason must state its lifecycle intent rather
 * than inherit "the fold decides", which silently closes a day in progress.
 */
export function openPolicyForReason(
  reason: Doc<"reportDirtyDay">["reason"],
): "current-day" | "preserve-existing" | undefined {
  switch (reason) {
    // Ingestion asserts this is the store's day in progress.
    case "day_open":
      return "current-day";
    // Maintenance and retries: recompute, change nothing about lifecycle.
    case "fold_version_bump":
    case "reseed":
    case "write_failure":
    case "fact_cap_exceeded":
      return "preserve-existing";
    // Lifecycle-bearing: rollover demotes a past open day, a close reconciles.
    case "late_fact":
    case "close_accepted":
      return undefined;
  }
}

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
     * What this fold is allowed to say about the day's `open` status. The fold
     * itself never returns `open` — it only knows `provisional`, `reconciled`
     * and `amended` — so `open` survives a refold only by policy here.
     *
     * - `"current-day"`: the mark asserts this IS the store's day in progress
     *   (`day_open`), so a `provisional` fold becomes `open` unconditionally.
     *   That also re-opens a day some earlier lifecycle-free refold demoted.
     * - `"preserve-existing"`: the mark carries no lifecycle meaning — a
     *   version repair, a reseed, a retry of a fold that failed to write. It
     *   recomputes metrics and must leave the lifecycle exactly as it found
     *   it, so an `open` day stays `open` and nothing else is opened.
     *
     * Omitted for lifecycle-bearing marks (`late_fact`, `close_accepted`),
     * where the fold's own answer is the authority: rollover demotes a
     * still-open past day to `provisional`, and a close reconciles.
     */
    openPolicy?: "current-day" | "preserve-existing";
    /**
     * Leave the day's calendar rollups to the caller.
     *
     * Rollup re-aggregation is per PERIOD, not per day: rebuilding `m:2026-07`
     * reads that whole month of `reportSkuDay` rows regardless of which day
     * changed. Folding a batch of days one-by-one therefore re-reads the same
     * month once per day — the batch's dominant read cost, and quadratic in
     * `SWEEP_DIRTY_BATCH` for a run of same-month days. The sweep sets this and
     * rebuilds once over the batch's whole folded-date set instead, where
     * `affectedPeriodKeys` collapses those repeats into one key.
     *
     * Only an optimization: the periods rebuilt are identical either way, so a
     * caller folding a single day (or one that wants the day self-contained)
     * leaves this unset and keeps the inline rebuild.
     */
    deferRollups?: boolean;
    compactCloseEvidence?: boolean;
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

  const close = opts?.compactCloseEvidence
    ? await loadAcceptedCompactCloseWithCtx(ctx, storeId, operatingDate)
    : await loadAcceptedClose(ctx, storeId, operatingDate);
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
      result.day.status === "provisional" &&
      (opts?.openPolicy === "current-day" ||
        (opts?.openPolicy === "preserve-existing" &&
          existingDay?.status === "open"))
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
    transactionCount: result.day.transactionCount,
    foldedAt: now,
    foldVersion: REPORTS_FOLD_VERSION,
    certifiedFoldRevision,
    factCount: result.day.factCount,
    // The fold's SKU map IS the day's row set: every entry is patched or
    // inserted below, and every existing row absent from it is deleted. So
    // this size equals the post-fold `reportSkuDay` count exactly, written in
    // the same mutation that writes those rows — it cannot disagree with them.
    skuDayRowCount: result.skuDays.size,
    lastFactRecordedAt: result.day.lastFactRecordedAt,
    flags: result.day.flags,
    paymentPosture: result.day.paymentPosture,
    // Both, together: the published conclusion and the bounded evidence the
    // incremental path adds to. Omitting either here is the exact failure
    // `REPORTS_FOLD_VERSION` 5 was created to repair.
    paymentMix: result.day.paymentMix,
    paymentMixState: result.day.paymentMixState,
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

  await captureRollupInputWithCtx(ctx, {
    storeId, operatingDate, revision: certifiedFoldRevision, skuDays: result.skuDays,
  }, now);

  // --- rollups: re-aggregate the day's calendar periods ---------------------
  if (opts?.deferRollups !== true) {
    await rebuildRollupsForDates(ctx, storeId, [operatingDate]);
  }
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
  await markDirty(ctx, storeId, operatingDate, reason, now);
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


async function expireRangeResults(
  ctx: MutationCtx,
  now: number,
): Promise<number> {
  let deleted = 0;
  for (const kind of [undefined, "custom_summary"] as const) {
    const expired = await ctx.db.query("reportRangeResult")
      .withIndex("by_kind_summaryCleanupBlocked_expiresAt", q => q.eq("kind", kind).eq("summaryCleanupBlocked", undefined).lt("expiresAt", now))
      .take(1);
    for (const row of expired) {
      deleted += Number(await cleanupSummaryRangeWithCtx(ctx, row._id, now));
    }
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/**
 * Every kinded range-snapshot lifecycle the sweeper backs up and cleans.
 * U4's `sku_mix` config joins this list. Deliberately a function, not a
 * module-level const: this module and the kind modules import each other, so
 * a top-level read of a kind config would race module initialization order.
 */
function rangeSnapshotKindConfigs(): readonly AnyRangeSnapshotKindConfig[] {
  return [MOVEMENT_RANGE_SNAPSHOT_KIND, MIX_RANGE_SNAPSHOT_KIND];
}

export async function sweepWithCtx(
  ctx: MutationCtx,
  options?: { storeId: Id<"store">; skipMaintenance: boolean },
): Promise<SweepResult> {
  const now = Date.now();
  const allowlist = readStoreAllowlist();

  const marks = options
    ? await ctx.db.query("reportDirtyDay")
      .withIndex("by_storeId_markedAt", (q) => q.eq("storeId", options.storeId))
      .order("asc").take(SWEEP_MARK_SCAN_LIMIT)
    : await ctx.db.query("reportDirtyDay")
      .withIndex("by_markedAt").order("asc").take(SWEEP_MARK_SCAN_LIMIT);

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
      //
      // Maintenance reasons recompute metrics with no lifecycle authority, so
      // they must not silently close the day in progress. They used to: the
      // fold only ever answers `provisional`, so a version repair over a quiet
      // store's current day demoted it out of `open` and the Overview lost
      // "In progress" — the Daily Operations link and the newest-first
      // transactions order both hang off that status.
      await foldAndReplaceDay(ctx, mark.storeId, mark.operatingDate, now, {
        openPolicy: openPolicyForReason(mark.reason),
        deferRollups: true,
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
    // Rollups for the WHOLE batch at once (see `deferRollups`): the folds above
    // deliberately skipped them so a run of same-month days re-aggregates that
    // month once instead of once per day.
    //
    // Driven by foldedDatesByStore, not by the marks: a day that threw wrote
    // nothing, and rebuilding its periods here would fold the unchanged rows
    // back over a rollup the failed day never touched. Failures already went
    // back on the queue, so their periods rebuild when the fold succeeds.
    await rebuildRollupsForDates(ctx, storeId, [
      ...(foldedDatesByStore.get(String(storeId)) ?? []),
    ]);
    await rebuildStoreOverview(ctx, storeId, now);
    // A day fold is the sole normal signal for current weekly truth. The
    // singleton is still built from reportDay only, not from source domains.
    // The folded dates ride on the marker rather than on this tick's memory:
    // a store whose marker falls outside the weekly page below would otherwise
    // lose its exact historical amendment handoff to page-boundary timing.
    await markWeekDirty(ctx, storeId, "day_folded", now, {
      foldedDates: [...(foldedDatesByStore.get(String(storeId)) ?? [])],
    });
  }

  const dirtyWeeks = options
    ? await ctx.db.query("reportDirtyWeek")
      .withIndex("by_storeId", (q) => q.eq("storeId", options.storeId)).take(1)
    : await ctx.db.query("reportDirtyWeek")
      .withIndex("by_markedAt").order("asc").take(WEEKLY_DIRTY_BATCH);
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
  if (options?.skipMaintenance) return result;
  return { ...result, ...await maintainReportsWithCtx(ctx, now) };
}

/** Maintenance commits independently of every fold/projection/store. */
export async function maintainReportsWithCtx(ctx: MutationCtx, now: number) {
  const result = {
    rangesExpired: 0, movementWorkersScheduled: 0,
    movementChildrenExpired: 0, movementHeadersExpired: 0,
  };
  result.rangesExpired = await expireRangeResults(ctx, now);

  // Kinded snapshot lane — UNCONDITIONAL, never coupled to touchedStores:
  // the backstop rescues dropped continuations for any store and any
  // registered kind, and expired snapshots drain child-first. Scheduling and
  // deletion only; snapshot aggregation always happens in each kind's own
  // fenced worker batches. (Result field names keep their historical
  // `movement` prefix; they count all registered kinds.)
  const kinds = rangeSnapshotKindConfigs();
  result.movementWorkersScheduled = await scheduleEligibleRangeSnapshotWork(
    ctx,
    now,
    kinds,
  );
  const snapshotCleanup = await cleanupExpiredRangeSnapshots(ctx, now, kinds);
  result.movementChildrenExpired = snapshotCleanup.childrenDeleted;
  result.movementHeadersExpired = snapshotCleanup.headersDeleted;

  return result;
}

/** The cron entry point. Registered once, every 5 minutes, in convex/crons.ts. */
export const sweep = internalMutation({
  args: {},
  returns: v.object({ lanesScheduled: v.number() }),
  handler: async (ctx) => dispatchReportPipeline(ctx),
});
