import type {
  CloseRef,
  DayFoldResult,
  FoldDayFn,
  FoldFact,
  ReportDayFlags,
  ReportDayMetrics,
  SkuDayFoldResult,
} from "../../shared/reportsContract";
import {
  derivePaymentPosture,
  normalizeCurrencyCode,
} from "../../shared/reportsContract";

/**
 * The deterministic day fold — the correctness authority for reporting.
 *
 * PURE by construction: no Convex imports, no `Date.now`, no randomness, no
 * mutation of the input array. The same `(storeCurrency, facts, close)` always
 * folds to a deep-equal result regardless of the order facts arrive in.
 *
 * Design: docs/solutions/architecture/athena-reporting-read-optimized-redesign-2026-07-28.md
 * Contract: shared/reportsContract.ts (FROZEN — this module conforms to it).
 *
 * Sign convention: facts carry SIGNED amounts as emitted by the source domain.
 * The fold trusts those signs for reversal kinds (`void`/`correction`) and
 * normalises magnitude-only kinds (`refund`/`return`) with `Math.abs`, so a
 * source that emits a refund as +500 and one that emits it as -500 fold
 * identically. It never re-derives an amount from other fields.
 */

/** Kinds that carry sellable revenue and can attribute to a SKU. */
const REVENUE_KINDS = new Set([
  "sale",
  "refund",
  "return",
  "void",
  "correction",
]);

/** Kinds that participate in cost-basis / gross-profit accounting. */
const COSTED_KINDS = new Set(["sale", "return", "void", "correction"]);

type MutableMetrics = ReportDayMetrics & { grossProfitMinor: number };

function zeroDayMetrics(): MutableMetrics {
  return {
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
}

type SkuAccumulator = {
  unitsSold: number;
  unitsReturned: number;
  grossSalesMinor: number;
  netSalesMinor: number;
  refundsMinor: number;
  uncostedRevenueMinor: number;
  grossProfitMinor: number;
  hasUncostedRevenue: boolean;
};

function zeroSkuAccumulator(): SkuAccumulator {
  return {
    unitsSold: 0,
    unitsReturned: 0,
    grossSalesMinor: 0,
    netSalesMinor: 0,
    refundsMinor: 0,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 0,
    hasUncostedRevenue: false,
  };
}

/**
 * Total order over facts. `(occurredAt, sourceId, lineId, factKind)` is the
 * contract-specified key; `factId` is appended as a final tiebreak so that two
 * facts identical on the first four keys still fold in a stable order.
 */
function compareFacts(a: FoldFact, b: FoldFact): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt - b.occurredAt;
  if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId ? -1 : 1;
  if (a.lineId !== b.lineId) return a.lineId < b.lineId ? -1 : 1;
  if (a.factKind !== b.factKind) return a.factKind < b.factKind ? -1 : 1;
  if (a.factId !== b.factId) return a.factId < b.factId ? -1 : 1;
  return 0;
}

/**
 * Signed revenue/quantity contribution of a revenue-bearing fact, normalised
 * to "positive means it added sales".
 */
function revenueContribution(fact: FoldFact): { net: number; quantity: number } {
  switch (fact.factKind) {
    case "sale":
    // `void`/`correction` carry the reversal already signed by the emitter.
    case "void":
    case "correction":
      return { net: fact.netAmountMinor, quantity: fact.quantity };
    case "refund":
    case "return":
      return {
        net: -Math.abs(fact.netAmountMinor),
        quantity: -Math.abs(fact.quantity),
      };
    default:
      return { net: 0, quantity: 0 };
  }
}

export const foldDay: FoldDayFn = (
  storeCurrency: string,
  facts: readonly FoldFact[],
  close?: CloseRef,
): DayFoldResult => {
  const ordered = [...facts].sort(compareFacts);

  const day = zeroDayMetrics();
  const flags: ReportDayFlags = {
    mixedCurrency: false,
    hasUncostedRevenue: false,
    quarantinedFactCount: 0,
  };
  const skuAccumulators = new Map<string, SkuAccumulator>();

  let lastFactRecordedAt = 0;
  let postCloseNetSalesDeltaMinor = 0;
  let sawPostCloseFact = false;
  let paymentAllocationOmittedMinor = 0;

  for (const fact of ordered) {
    if (fact.recordedAt > lastFactRecordedAt) {
      lastFactRecordedAt = fact.recordedAt;
    }

    // Observations about the input hold whether or not the fact is countable.
    if (fact.quarantined) flags.quarantinedFactCount += 1;
    const factCurrency = normalizeCurrencyCode(fact.currency);
    if (factCurrency !== storeCurrency) flags.mixedCurrency = true;

    const isPostClose = close !== undefined && fact.recordedAt > close.acceptedAt;
    if (isPostClose) sawPostCloseFact = true;

    // Excluded from every metric: quarantined facts and foreign-currency facts
    // (no FX rate lives in the fold; converting here would invent numbers).
    if (fact.quarantined) continue;
    if (factCurrency !== storeCurrency) continue;

    const sku =
      fact.productSkuId !== undefined && REVENUE_KINDS.has(fact.factKind)
        ? (skuAccumulators.get(fact.productSkuId) ??
          (() => {
            const fresh = zeroSkuAccumulator();
            skuAccumulators.set(fact.productSkuId!, fresh);
            return fresh;
          })())
        : undefined;

    switch (fact.factKind) {
      case "sale": {
        day.grossSalesMinor += fact.grossAmountMinor;
        day.netSalesMinor += fact.netAmountMinor;
        day.unitsSold += fact.quantity;
        if (sku) {
          sku.grossSalesMinor += fact.grossAmountMinor;
          sku.netSalesMinor += fact.netAmountMinor;
          sku.unitsSold += fact.quantity;
        }
        break;
      }
      case "refund": {
        const refunded = Math.abs(fact.netAmountMinor);
        day.refundsMinor += refunded;
        day.netSalesMinor -= refunded;
        if (sku) {
          sku.refundsMinor += refunded;
          sku.netSalesMinor -= refunded;
        }
        break;
      }
      case "return": {
        const refunded = Math.abs(fact.netAmountMinor);
        const returned = Math.abs(fact.quantity);
        day.refundsMinor += refunded;
        day.netSalesMinor -= refunded;
        day.unitsReturned += returned;
        if (sku) {
          sku.refundsMinor += refunded;
          sku.netSalesMinor -= refunded;
          sku.unitsReturned += returned;
        }
        break;
      }
      case "void":
      case "correction": {
        // Signed as carried — the emitter decided what is being negated.
        day.grossSalesMinor += fact.grossAmountMinor;
        day.netSalesMinor += fact.netAmountMinor;
        day.unitsSold += fact.quantity;
        if (sku) {
          sku.grossSalesMinor += fact.grossAmountMinor;
          sku.netSalesMinor += fact.netAmountMinor;
          sku.unitsSold += fact.quantity;
        }
        break;
      }
      case "payment": {
        const amount = Math.abs(fact.netAmountMinor);
        day.paymentsCollectedMinor += amount;
        if (
          fact.paymentAllocationCoverage === "known" &&
          fact.paymentAllocationMinor !== undefined
        ) {
          day.paymentAllocatedMinor += fact.paymentAllocationMinor;
        } else {
          paymentAllocationOmittedMinor += amount;
        }
        break;
      }
      case "payment_refund": {
        const amount = Math.abs(fact.netAmountMinor);
        day.paymentsRefundedMinor += amount;
        if (
          fact.paymentAllocationCoverage === "known" &&
          fact.paymentAllocationMinor !== undefined
        ) {
          day.paymentAllocatedMinor += fact.paymentAllocationMinor;
        } else {
          paymentAllocationOmittedMinor += amount;
        }
        break;
      }
      case "close_snapshot":
      case "inventory_issue":
      case "procurement_receipt":
        // No revenue metrics. The close is consumed via the `close` argument;
        // inventory/procurement movement carries no sales contribution (cost
        // basis rides on the sale fact's `unitCostMinor`).
        break;
    }

    if (isPostClose) {
      // Net-sales contribution of this fact alone, for the amendment delta.
      switch (fact.factKind) {
        case "sale":
        case "void":
        case "correction":
          postCloseNetSalesDeltaMinor += fact.netAmountMinor;
          break;
        case "refund":
        case "return":
          postCloseNetSalesDeltaMinor -= Math.abs(fact.netAmountMinor);
          break;
        default:
          break;
      }
    }

    if (!COSTED_KINDS.has(fact.factKind)) continue;

    const { net, quantity } = revenueContribution(fact);
    if (fact.unitCostMinor !== undefined) {
      const profit = net - fact.unitCostMinor * quantity;
      day.grossProfitMinor += profit;
      if (sku) sku.grossProfitMinor += profit;
    } else if (net !== 0) {
      day.uncostedRevenueMinor += net;
      flags.hasUncostedRevenue = true;
      if (sku) {
        sku.uncostedRevenueMinor += net;
        sku.hasUncostedRevenue = true;
      }
    }
  }

  const skuDays = new Map<string, SkuDayFoldResult>();
  for (const [productSkuId, acc] of skuAccumulators) {
    skuDays.set(productSkuId, {
      unitsSold: acc.unitsSold,
      unitsReturned: acc.unitsReturned,
      grossSalesMinor: acc.grossSalesMinor,
      netSalesMinor: acc.netSalesMinor,
      refundsMinor: acc.refundsMinor,
      uncostedRevenueMinor: acc.uncostedRevenueMinor,
      grossProfitMinor: acc.hasUncostedRevenue ? null : acc.grossProfitMinor,
    });
  }

  const metrics: ReportDayMetrics = {
    ...day,
    grossProfitMinor: flags.hasUncostedRevenue ? null : day.grossProfitMinor,
  };
  const paymentPosture = derivePaymentPosture({
    collectedMinor: metrics.paymentsCollectedMinor,
    refundedMinor: metrics.paymentsRefundedMinor,
    allocatedMinor: metrics.paymentAllocatedMinor,
    allocationOmittedMinor: paymentAllocationOmittedMinor,
  });

  if (close === undefined) {
    return {
      day: {
        ...metrics,
        status: "provisional",
        flags,
        factCount: facts.length,
        lastFactRecordedAt,
        paymentPosture,
      },
      skuDays,
    };
  }

  const closeVarianceMinor = metrics.netSalesMinor - close.closeNetSalesMinor;
  return {
    day: {
      ...metrics,
      status: sawPostCloseFact ? "amended" : "reconciled",
      flags,
      factCount: facts.length,
      lastFactRecordedAt,
      closeVarianceMinor,
      ...(sawPostCloseFact ? { postCloseNetSalesDeltaMinor } : {}),
      paymentPosture,
    },
    skuDays,
  };
};
