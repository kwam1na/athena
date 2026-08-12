import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  REPORTS_FOLD_VERSION,
  type NewReportFact,
  type ReportDayMetrics,
  type ReportSkuDayMetrics,
  accumulatePaymentMixFact,
  boundPaymentMixState,
  derivePaymentMix,
  derivePaymentPosture,
  emptyPaymentMixState,
  mergePaymentMixState,
  normalizeCurrencyCode,
} from "../../shared/reportsContract";
import {
  factFingerprint,
  matchesStoredFingerprint,
  REPORTS_FINGERPRINT_VERSION,
} from "./fingerprint";
import { resolveOperatingDate } from "./operatingDay";
import { markDirty } from "./marks";
import { internal } from "../_generated/api";

/**
 * Ingestion core for the rebuilt reports layer.
 *
 * Called by domain mutations (slice B2 emitters) inside their own transaction,
 * and by the reseed walker (slice F). Three invariants hold here:
 *
 *  1. **Identity is structural.** Uniqueness is the composite
 *     (storeId, sourceDomain, sourceId, lineId, factKind) on `by_identity`.
 *     Replay with an equal fingerprint is a no-op; a mismatch parks a
 *     `quarantine` marker on the *existing* row and dirties its day. Facts are
 *     never silently overwritten — a restatement arrives as a correction fact.
 *
 *  2. **The open day is a preview, not the truth.** Incremental patches here
 *     are intentionally simple and local (no `foldDay` import). The day is
 *     labeled `open`, and the close-time fold replaces every number it wrote.
 *     Imperfect incremental arithmetic is acceptable; a wrong *closed* day is
 *     not, which is why anything outside the current day is only dirtied.
 *
 *  3. **Ingestion never breaks the business.** The whole body is contained: any
 *     internal failure degrades to a `write_failure` dirty mark and a normal
 *     return, so a reporting bug can never roll back a sale. If the dirty mark
 *     itself cannot be written, it is enqueued as a durable scheduled mutation
 *     (`marks.markWriteFailureDays`) that lands right after commit. Only if
 *     that enqueue ALSO fails is the throw allowed to propagate — the domain
 *     transaction then aborts atomically, which is the correct outcome.
 */

type FactSignedDeltas = {
  day: Partial<Record<keyof ReportDayMetrics, number>>;
  sku: Partial<Record<keyof ReportSkuDayMetrics, number>>;
  /** Revenue with no cost basis; forces `grossProfitMinor` to null. */
  uncosted: boolean;
  /** Contributes to totals at all (close snapshots and stock facts do not). */
  contributes: boolean;
};

/**
 * How many recent day docs to scan for stale `open` days when a new operating
 * day is first created (once per store per day). Covers a store idle for up to
 * a week; anything older is caught by the next rollover or a manual reseed.
 */
const ROLLOVER_OPEN_DAY_SCAN = 7;

const ZERO_DAY_METRICS: ReportDayMetrics = {
  grossSalesMinor: 0,
  netSalesMinor: 0,
  refundsMinor: 0,
  unitsSold: 0,
  unitsReturned: 0,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 0,
  paymentsCollectedMinor: 0,
  paymentsRefundedMinor: 0,
  paymentAllocatedMinor: 0,
};

const ZERO_SKU_METRICS: ReportSkuDayMetrics = {
  unitsSold: 0,
  unitsReturned: 0,
  grossSalesMinor: 0,
  netSalesMinor: 0,
  refundsMinor: 0,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 0,
};

/**
 * Provisional per-fact contribution.
 *
 * Sign conventions (documented here because the open-day preview cannot import
 * the fold): emitters send magnitudes with the direction implied by `factKind`,
 * so reversals are normalized with `-Math.abs(...)` rather than trusting the
 * caller's sign. `correction` is the one kind whose sign is meaningful — a
 * correction *is* a signed delta.
 */
export function factDeltas(fact: NewReportFact): FactSignedDeltas {
  const gross = fact.grossAmountMinor;
  const net = fact.netAmountMinor;
  const quantity = fact.quantity;
  const costed = fact.unitCostMinor !== undefined;
  const cogs = costed ? (fact.unitCostMinor as number) * Math.abs(quantity) : 0;

  switch (fact.factKind) {
    case "sale": {
      return {
        contributes: true,
        uncosted: !costed,
        day: {
          grossSalesMinor: Math.abs(gross),
          netSalesMinor: net,
          unitsSold: quantity,
          uncostedRevenueMinor: costed ? 0 : net,
          grossProfitMinor: costed ? net - cogs : 0,
        },
        sku: {
          grossSalesMinor: Math.abs(gross),
          netSalesMinor: net,
          unitsSold: quantity,
          uncostedRevenueMinor: costed ? 0 : net,
          grossProfitMinor: costed ? net - cogs : 0,
        },
      };
    }
    case "refund":
    case "return": {
      const signedNet = -Math.abs(net);
      const returnedUnits = Math.abs(quantity);
      // `unitsSold` is gross units sold and is NOT reduced by returns —
      // `unitsReturned` carries them separately (matches foldDay, the
      // authority; net units are a consumer-side subtraction).
      return {
        contributes: true,
        uncosted: !costed && signedNet !== 0,
        day: {
          refundsMinor: Math.abs(net),
          netSalesMinor: signedNet,
          unitsReturned: returnedUnits,
          uncostedRevenueMinor: costed ? 0 : signedNet,
          grossProfitMinor: costed ? signedNet + cogs : 0,
        },
        sku: {
          refundsMinor: Math.abs(net),
          netSalesMinor: signedNet,
          unitsReturned: returnedUnits,
          uncostedRevenueMinor: costed ? 0 : signedNet,
          grossProfitMinor: costed ? signedNet + cogs : 0,
        },
      };
    }
    case "void": {
      // A void withdraws a previously recorded sale in full.
      return {
        contributes: true,
        uncosted: false,
        day: {
          grossSalesMinor: -Math.abs(gross),
          netSalesMinor: -Math.abs(net),
          unitsSold: -Math.abs(quantity),
          grossProfitMinor: costed ? -(Math.abs(net) - cogs) : 0,
        },
        sku: {
          grossSalesMinor: -Math.abs(gross),
          netSalesMinor: -Math.abs(net),
          unitsSold: -Math.abs(quantity),
          grossProfitMinor: costed ? -(Math.abs(net) - cogs) : 0,
        },
      };
    }
    case "correction": {
      // Signed delta: the emitter's sign is the meaning.
      return {
        contributes: true,
        uncosted: !costed && net !== 0,
        day: {
          grossSalesMinor: gross,
          netSalesMinor: net,
          unitsSold: quantity,
          uncostedRevenueMinor: costed ? 0 : net,
          grossProfitMinor: costed ? net - (fact.unitCostMinor as number) * quantity : 0,
        },
        sku: {
          grossSalesMinor: gross,
          netSalesMinor: net,
          unitsSold: quantity,
          uncostedRevenueMinor: costed ? 0 : net,
          grossProfitMinor: costed ? net - (fact.unitCostMinor as number) * quantity : 0,
        },
      };
    }
    case "payment": {
      const amount = Math.abs(net);
      const allocated =
        fact.paymentAllocationCoverage === "known" &&
        fact.paymentAllocationMinor !== undefined
          ? fact.paymentAllocationMinor
          : 0;
      return {
        contributes: true,
        uncosted: false,
        day: {
          paymentsCollectedMinor: amount,
          paymentAllocatedMinor: allocated,
        },
        sku: {},
      };
    }
    case "payment_refund": {
      const amount = Math.abs(net);
      const allocated =
        fact.paymentAllocationCoverage === "known" &&
        fact.paymentAllocationMinor !== undefined
          ? fact.paymentAllocationMinor
          : 0;
      return {
        contributes: true,
        uncosted: false,
        day: {
          paymentsRefundedMinor: amount,
          paymentAllocatedMinor: allocated,
        },
        sku: {},
      };
    }
    // Close snapshots carry no day metrics (the fold derives variance from
    // them). Stock movements feed cost/valuation surfaces, not sales totals.
    case "close_snapshot":
    case "inventory_issue":
    case "procurement_receipt":
      return { contributes: false, uncosted: false, day: {}, sku: {} };
  }
}

type FactRow = Doc<"reportFact">;

function toFactDoc(
  storeId: Id<"store">,
  fact: NewReportFact,
  operatingDate: string,
  recordedAt: number,
  observedAt: number,
) {
  return {
    storeId,
    sourceDomain: fact.sourceDomain,
    sourceId: fact.sourceId,
    lineId: fact.lineId,
    factKind: fact.factKind,
    fingerprint: factFingerprint(fact),
    fingerprintVersion: REPORTS_FINGERPRINT_VERSION,
    occurredAt: fact.occurredAt,
    recordedAt,
    // This is deliberately not part of NewReportFact. Acceptance cutoffs are
    // knowledge-time boundaries, so callers and reseed cannot backdate them.
    observedAt,
    operatingDate,
    // Already normalised at the ingestion boundary (see `recordFacts`), so the
    // stored code and its fingerprint never carry a source's raw spelling.
    currency: fact.currency,
    grossAmountMinor: fact.grossAmountMinor,
    netAmountMinor: fact.netAmountMinor,
    taxAmountMinor: fact.taxAmountMinor,
    discountAmountMinor: fact.discountAmountMinor,
    quantity: fact.quantity,
    productSkuId: fact.productSkuId as Id<"productSku"> | undefined,
    unitCostMinor: fact.unitCostMinor,
    paymentAllocationMinor: fact.paymentAllocationMinor,
    paymentAllocationCoverage: fact.paymentAllocationCoverage,
    paymentMethod: fact.paymentMethod,
    paymentMethodFrom: fact.paymentMethodFrom,
    paymentParticipationId: fact.paymentParticipationId,
    paymentMixMinor: fact.paymentMixMinor,
  };
}

async function findExistingFact(
  ctx: MutationCtx,
  storeId: Id<"store">,
  fact: NewReportFact,
): Promise<FactRow | null> {
  return await ctx.db
    .query("reportFact")
    .withIndex("by_identity", (q) =>
      q
        .eq("storeId", storeId)
        .eq("sourceDomain", fact.sourceDomain)
        .eq("sourceId", fact.sourceId)
        .eq("lineId", fact.lineId)
        .eq("factKind", fact.factKind),
    )
    .unique();
}

/**
 * POS transactions in this batch that ALREADY had facts on record.
 *
 * Counting transactions incrementally needs this: a later batch touching a
 * transaction already counted must not count it twice, and a void must only
 * decrement a transaction that was counted in the first place. Queried BEFORE
 * any insert, so the answer describes the day as it was.
 *
 * One indexed lookup per distinct transaction — normally exactly one, since a
 * batch is one completed sale.
 */
async function findRecordedPosTransactions(
  ctx: MutationCtx,
  storeId: Id<"store">,
  facts: readonly NewReportFact[],
): Promise<Set<string>> {
  const sourceIds = new Set(
    facts
      .filter((fact) => fact.sourceDomain === "pos")
      .map((fact) => fact.sourceId),
  );
  const recorded = new Set<string>();
  for (const sourceId of sourceIds) {
    const existing = await ctx.db
      .query("reportFact")
      .withIndex("by_identity", (q) =>
        q
          .eq("storeId", storeId)
          .eq("sourceDomain", "pos")
          .eq("sourceId", sourceId),
      )
      .first();
    if (existing) recorded.add(sourceId);
  }
  return recorded;
}

/**
 * How many completed POS transactions this batch adds to the open day.
 *
 * Distinct transactions cannot be summed the way money is — the same
 * transaction emits facts more than once over its life — so the delta is
 * computed against what was already on record:
 *
 *   - a transaction selling for the first time, not voided in the same batch,
 *     adds one;
 *   - a void for a transaction counted earlier removes one;
 *   - a sale and its void in one batch nets zero, never counted at all;
 *   - further facts on a transaction already counted change nothing.
 *
 * `sourceId` IS the transaction id on a pos-domain fact. Payment facts are
 * unusable here: one per ALLOCATION, so split tender would double count.
 */
function batchTransactionDelta(
  applied: readonly { fact: NewReportFact }[],
  alreadyRecorded: ReadonlySet<string>,
  storeCurrency: string,
): number {
  const sold = new Set<string>();
  const voided = new Set<string>();
  for (const { fact } of applied) {
    if (fact.sourceDomain !== "pos") continue;
    // Foreign-currency facts are excluded from every other metric on this day
    // and from the fold's own count. Counting them here would make the live
    // number jump the moment the fold replaced it.
    if (normalizeCurrencyCode(fact.currency) !== storeCurrency) continue;
    if (fact.factKind === "sale") sold.add(fact.sourceId);
    if (fact.factKind === "void") voided.add(fact.sourceId);
  }

  let delta = 0;
  for (const sourceId of sold) {
    if (!alreadyRecorded.has(sourceId) && !voided.has(sourceId)) delta += 1;
  }
  for (const sourceId of voided) {
    if (alreadyRecorded.has(sourceId)) delta -= 1;
  }
  return delta;
}

function addMetric(
  current: number | null,
  delta: number | null | undefined,
): number {
  return (current ?? 0) + (delta ?? 0);
}

async function applyToOpenDay(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
  storeCurrency: string,
  applied: { fact: NewReportFact; recordedAt: number }[],
  alreadyRecordedTransactions: ReadonlySet<string>,
): Promise<void> {
  if (applied.length === 0) return;

  const transactionDelta = batchTransactionDelta(
    applied,
    alreadyRecordedTransactions,
    storeCurrency,
  );

  const existing = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .unique();

  const base = existing ?? {
    ...ZERO_DAY_METRICS,
    storeId,
    operatingDate,
    currency: storeCurrency,
    status: "open" as const,
    foldVersion: REPORTS_FOLD_VERSION,
    factCount: 0,
    lastFactRecordedAt: 0,
    flags: {
      mixedCurrency: false,
      hasUncostedRevenue: false,
      quarantinedFactCount: 0,
    },
  };

  const next: ReportDayMetrics = {
    grossSalesMinor: base.grossSalesMinor,
    netSalesMinor: base.netSalesMinor,
    refundsMinor: base.refundsMinor,
    unitsSold: base.unitsSold,
    unitsReturned: base.unitsReturned,
    uncostedRevenueMinor: base.uncostedRevenueMinor,
    grossProfitMinor: base.grossProfitMinor,
    paymentsCollectedMinor: base.paymentsCollectedMinor,
    paymentsRefundedMinor: base.paymentsRefundedMinor,
    paymentAllocatedMinor: base.paymentAllocatedMinor,
  };
  const flags = { ...base.flags };
  let factCount = base.factCount;
  let lastFactRecordedAt = base.lastFactRecordedAt;
  /** Payment value this batch could not attribute — mirrors the fold's rule. */
  let batchAllocationOmittedMinor = 0;
  /** This batch's mix contribution, merged into the day's stored state below. */
  const batchMixState = emptyPaymentMixState();

  // SKU deltas are accumulated in memory so a batch touching one SKU several
  // times costs one read + one write, not one per fact.
  const skuDeltas = new Map<
    string,
    { metrics: ReportSkuDayMetrics; uncosted: boolean }
  >();

  for (const { fact, recordedAt } of applied) {
    factCount += 1;
    lastFactRecordedAt = Math.max(lastFactRecordedAt, recordedAt);

    const countable = normalizeCurrencyCode(fact.currency) === base.currency;
    // Runs for excluded facts too, for the same reason the fold does it there:
    // payment evidence this day had to drop is what makes the mix unavailable.
    // Newly inserted facts are never quarantined, so currency is the only
    // exclusion the incremental path can see.
    accumulatePaymentMixFact(batchMixState, fact, countable);
    if (!countable) {
      // Foreign-currency facts are counted but never mixed into totals.
      flags.mixedCurrency = true;
      continue;
    }

    // Accumulated after the foreign-currency `continue` above and over newly
    // inserted (never quarantined) facts only — the same exclusions the fold
    // applies, so incremental and folded omissions agree.
    if (
      (fact.factKind === "payment" || fact.factKind === "payment_refund") &&
      (fact.paymentAllocationCoverage !== "known" ||
        fact.paymentAllocationMinor === undefined)
    ) {
      batchAllocationOmittedMinor += Math.abs(fact.netAmountMinor);
    }

    const deltas = factDeltas(fact);
    if (!deltas.contributes) continue;

    next.grossSalesMinor += deltas.day.grossSalesMinor ?? 0;
    next.netSalesMinor += deltas.day.netSalesMinor ?? 0;
    next.refundsMinor += deltas.day.refundsMinor ?? 0;
    next.unitsSold += deltas.day.unitsSold ?? 0;
    next.unitsReturned += deltas.day.unitsReturned ?? 0;
    next.uncostedRevenueMinor += deltas.day.uncostedRevenueMinor ?? 0;
    next.paymentsCollectedMinor += deltas.day.paymentsCollectedMinor ?? 0;
    next.paymentsRefundedMinor += deltas.day.paymentsRefundedMinor ?? 0;
    next.paymentAllocatedMinor += deltas.day.paymentAllocatedMinor ?? 0;

    if (deltas.uncosted) {
      flags.hasUncostedRevenue = true;
      next.grossProfitMinor = null;
    } else if (next.grossProfitMinor !== null) {
      next.grossProfitMinor = addMetric(
        next.grossProfitMinor,
        deltas.day.grossProfitMinor,
      );
    }

    if (fact.productSkuId && Object.keys(deltas.sku).length > 0) {
      const entry = skuDeltas.get(fact.productSkuId) ?? {
        metrics: { ...ZERO_SKU_METRICS },
        uncosted: false,
      };
      entry.metrics.unitsSold += deltas.sku.unitsSold ?? 0;
      entry.metrics.unitsReturned += deltas.sku.unitsReturned ?? 0;
      entry.metrics.grossSalesMinor += deltas.sku.grossSalesMinor ?? 0;
      entry.metrics.netSalesMinor += deltas.sku.netSalesMinor ?? 0;
      entry.metrics.refundsMinor += deltas.sku.refundsMinor ?? 0;
      entry.metrics.uncostedRevenueMinor += deltas.sku.uncostedRevenueMinor ?? 0;
      if (deltas.uncosted) {
        entry.uncosted = true;
      } else if (entry.metrics.grossProfitMinor !== null) {
        entry.metrics.grossProfitMinor = addMetric(
          entry.metrics.grossProfitMinor,
          deltas.sku.grossProfitMinor,
        );
      }
      skuDeltas.set(fact.productSkuId, entry);
    }
  }

  // Omissions accumulate: whatever the day already disclosed, plus this batch.
  // A day doc written before payment posture existed carries no coverage
  // evidence at all, so its whole payment volume counts as unknown.
  const priorAllocationOmittedMinor =
    existing?.paymentPosture?.allocationOmittedMinor ??
    (existing
      ? Math.abs(base.paymentsCollectedMinor) +
        Math.abs(base.paymentsRefundedMinor)
      : 0);

  // SKU rows are upserted BEFORE the day doc so the day's `skuDayRowCount`
  // can include this batch's inserts in the same write — the count and the
  // rows must come out of one mutation or the mix probe reads drift (U8).
  let insertedSkuRowCount = 0;
  for (const [productSkuId, entry] of skuDeltas) {
    const skuId = productSkuId as Id<"productSku">;
    const existingSku = await ctx.db
      .query("reportSkuDay")
      .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
        q
          .eq("storeId", storeId)
          .eq("operatingDate", operatingDate)
          .eq("productSkuId", skuId),
      )
      .unique();

    const previous = existingSku ?? ZERO_SKU_METRICS;
    const grossProfitMinor =
      entry.uncosted || previous.grossProfitMinor === null
        ? null
        : addMetric(previous.grossProfitMinor, entry.metrics.grossProfitMinor);

    const merged: ReportSkuDayMetrics = {
      unitsSold: previous.unitsSold + entry.metrics.unitsSold,
      unitsReturned: previous.unitsReturned + entry.metrics.unitsReturned,
      grossSalesMinor: previous.grossSalesMinor + entry.metrics.grossSalesMinor,
      netSalesMinor: previous.netSalesMinor + entry.metrics.netSalesMinor,
      refundsMinor: previous.refundsMinor + entry.metrics.refundsMinor,
      uncostedRevenueMinor:
        previous.uncostedRevenueMinor + entry.metrics.uncostedRevenueMinor,
      grossProfitMinor,
    };

    if (existingSku) {
      await ctx.db.patch("reportSkuDay", existingSku._id, merged);
    } else {
      await ctx.db.insert("reportSkuDay", {
        storeId,
        productSkuId: skuId,
        operatingDate,
        ...merged,
      });
      insertedSkuRowCount += 1;
    }
  }

  /**
   * The day's published SKU-row size, kept exact between folds (U8):
   *
   *   - new day: this batch's inserts are its only rows, so the count is
   *     exactly `insertedSkuRowCount`;
   *   - existing day with a count: the base plus this batch's inserts —
   *     patches touched existing rows and deletes never happen here (only the
   *     fold removes rows);
   *   - existing day without a count (pre-U8): stays absent. The base is
   *     unknown, so any number written here would be a guess presented as a
   *     measurement; `undefined` on patch erases nothing that exists, and the
   *     backfill refold supplies the real value.
   */
  const skuDayRowCount = existing
    ? existing.skuDayRowCount === undefined
      ? undefined
      : existing.skuDayRowCount + insertedSkuRowCount
    : insertedSkuRowCount;

  /**
   * Completed transactions on the open day, kept exact between folds.
   *
   * Same rule `skuDayRowCount` states above: an existing day that carries no
   * count stays absent, because the base is unknown and any number written
   * here would be a guess presented as a measurement. A day opened after this
   * field landed starts from zero and accumulates honestly.
   */
  const transactionCount = existing
    ? existing.transactionCount === undefined
      ? undefined
      : Math.max(0, existing.transactionCount + transactionDelta)
    : Math.max(0, transactionDelta);

  /**
   * The day's mix evidence, carried forward.
   *
   * A day that already carries state merges this batch into it. A day written
   * before the mix landed carries none: if it has any payment volume at all,
   * that volume is unattributable by definition — no state means no method
   * evidence — so the merged state starts broken rather than pretending this
   * batch is the whole day. `foldVersionRepair` is what fixes such a day.
   */
  const priorMixState =
    existing?.paymentMixState ??
    (existing &&
    (base.paymentsCollectedMinor !== 0 || base.paymentsRefundedMinor !== 0)
      ? { ...emptyPaymentMixState(), evidenceBroken: true }
      : emptyPaymentMixState());
  const paymentMixState = boundPaymentMixState(
    mergePaymentMixState(priorMixState, batchMixState),
  );

  const dayPatch = {
    ...next,
    currency: base.currency,
    status: existing?.status ?? ("open" as const),
    foldVersion: base.foldVersion,
    factCount,
    skuDayRowCount,
    transactionCount,
    lastFactRecordedAt,
    flags,
    paymentMixState,
    paymentMix: derivePaymentMix(paymentMixState, next.paymentsCollectedMinor),
    paymentPosture: derivePaymentPosture({
      collectedMinor: next.paymentsCollectedMinor,
      refundedMinor: next.paymentsRefundedMinor,
      allocatedMinor: next.paymentAllocatedMinor,
      allocationOmittedMinor:
        priorAllocationOmittedMinor + batchAllocationOmittedMinor,
    }),
  };

  if (existing) {
    await ctx.db.patch("reportDay", existing._id, dayPatch);
  } else {
    await ctx.db.insert("reportDay", {
      storeId,
      operatingDate,
      ...dayPatch,
    });

    // Rollover: opening a new day is the moment any *older* still-open day
    // stops being current. Dirty it so the sweeper folds it to `provisional`
    // (day_open folds preserve `open`; late_fact folds do not) — without this,
    // a day that never gets a close would stay `open` forever.
    const recentDays = await ctx.db
      .query("reportDay")
      .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
      .order("desc")
      .take(ROLLOVER_OPEN_DAY_SCAN);
    for (const day of recentDays) {
      if (day.operatingDate < operatingDate && day.status === "open") {
        await markDirty(ctx, storeId, day.operatingDate, "late_fact");
      }
    }
  }
}

/**
 * Record domain facts. FROZEN public API — emitters and the reseed walker call
 * this and nothing else in the module. Never throws into the caller EXCEPT
 * when containment is fully exhausted: the dirty mark cannot be written inline
 * AND cannot be enqueued as a scheduled mutation. That throw is deliberate —
 * it aborts the domain transaction atomically rather than committing a sale
 * whose reporting evidence silently vanished (invariant 3 above).
 */
export async function recordFacts(
  ctx: MutationCtx,
  storeId: Id<"store">,
  facts: NewReportFact[],
): Promise<{ outcome: "recorded" | "contained_failure" }> {
  const touchedDates = new Set<string>();
  let currentOperatingDate: string | undefined;

  try {
    if (facts.length === 0) return { outcome: "recorded" };

    const now = Date.now();
    currentOperatingDate = await resolveOperatingDate(ctx, storeId, now);
    touchedDates.add(currentOperatingDate);

    const store = await ctx.db.get("store", storeId);
    if (!store) throw new Error(`recordFacts: unknown store ${storeId}`);

    const appliedToCurrentDay: { fact: NewReportFact; recordedAt: number }[] =
      [];
    const lateDates = new Set<string>();
    // Before any insert: afterwards this batch's own rows would look like
    // history and every new transaction would read as already counted.
    const alreadyRecordedTransactions = await findRecordedPosTransactions(
      ctx,
      storeId,
      facts,
    );

    for (const incoming of facts) {
      // Currency is normalised ONCE, here, so the stored code, the fingerprint
      // and every downstream comparison see the same spelling. A source that
      // emits " ghs " today and "GHS" on replay must not read as drift.
      const fact: NewReportFact = {
        ...incoming,
        currency: normalizeCurrencyCode(incoming.currency),
      };
      const operatingDate = await resolveOperatingDate(
        ctx,
        storeId,
        fact.occurredAt,
      );
      touchedDates.add(operatingDate);

      const existing = await findExistingFact(ctx, storeId, fact);

      if (existing) {
        if (matchesStoredFingerprint(fact, existing)) continue; // replay — no-op
        // Content drift on a recorded fact. Park it, never overwrite; the fold
        // excludes quarantined facts and the day is rebuilt from what remains.
        if (!existing.quarantine) {
          await ctx.db.patch("reportFact", existing._id, {
            quarantine: { reason: "content_conflict", detectedAt: Date.now() },
          });
        }
        touchedDates.add(existing.operatingDate);
        if (existing.operatingDate !== currentOperatingDate) {
          lateDates.add(existing.operatingDate);
        }
        continue;
      }

      // `recordedAt` is arrival time, stamped here — except during reseed,
      // which passes business time so re-derived historical facts don't
      // postdate their close (see NewReportFact.recordedAt in the contract).
      const recordedAt = fact.recordedAt ?? Date.now();
      await ctx.db.insert(
        "reportFact",
        toFactDoc(storeId, fact, operatingDate, recordedAt, now),
      );

      if (operatingDate === currentOperatingDate) {
        appliedToCurrentDay.push({ fact, recordedAt });
      } else {
        lateDates.add(operatingDate);
      }
    }

    await applyToOpenDay(
      ctx,
      storeId,
      currentOperatingDate,
      normalizeCurrencyCode(store.currency),
      appliedToCurrentDay,
      alreadyRecordedTransactions,
    );

    for (const date of lateDates) {
      await markDirty(ctx, storeId, date, "late_fact");
    }

    // Standing mark for the open day: the sweeper refolds it every pass so the
    // provisional incremental numbers converge on the fold's answer.
    await markDirty(ctx, storeId, currentOperatingDate, "day_open");
    return { outcome: "recorded" };
  } catch {
    // Containment. A reporting failure must never abort the domain mutation;
    // it degrades to "this day needs a rebuild".
    const dates =
      touchedDates.size > 0
        ? [...touchedDates]
        : [currentOperatingDate ?? new Date(Date.now()).toISOString().slice(0, 10)];
    try {
      for (const date of dates) {
        await markDirty(ctx, storeId, date, "write_failure");
      }
    } catch {
      // Even the dirty mark failed. Enqueue it as a scheduled mutation — a
      // write to a different table than the one that just refused, and
      // durable once the domain transaction commits, so the marks still land
      // moments later instead of inside it. Only if the enqueue itself also
      // fails does the throw propagate — an atomic abort beats a silent data
      // hole, and by then two independent write paths have refused.
      await ctx.scheduler.runAfter(0, internal.reports.marks.markWriteFailureDays, {
        storeId,
        dates,
      });
    }
    return { outcome: "contained_failure" };
  }
}
