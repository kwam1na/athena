import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type {
  ReportDayStatus,
  ReportWeekMetrics,
} from "../../shared/reportsContract";
import { getDiscountValue } from "../inventory/utils";
import { resolveOperatingDate } from "./operatingDay";
// Readers, not mappers: `loadOnlineOrderLines` answers "where does this order
// keep its lines" (stored rows vs. the legacy inline copy) and
// `toDiscountItems` is a shape adapter. Neither decides a metric. Duplicating
// them would only let the verifier read a DIFFERENT set of lines than the one
// that exists, which is noise rather than independence.
import { loadOnlineOrderLines, toDiscountItems } from "./reseed";
import { resolveWeeklyPeriod } from "./weeklyPeriods";
import { localDateStartAt } from "../lib/storeScheduleTime";
import { listOpenSyncedSaleInventoryReviewGroupsWithCompleteness } from "../operations/operationalWorkItems";
import { projectLiveWeeklyInventoryAttention } from "./weeklyInventory";
import {
  computeWeeklyVariancePosture,
  resolveAcceptedWeekClosePosture,
} from "./weekly";

/**
 * Source-truth verifier — the second opinion on a folded day.
 *
 * This module recomputes a day's headline totals DIRECTLY from the domain
 * tables and diffs them against the materialized `reportDay`. Its whole value
 * is independence, so it is written under three self-imposed rules:
 *
 *  1. It does not import `factDeltas`, `foldDay`, or any fact MAPPER from
 *     `reseed.ts`. Shared metric code would make the two sides agree by
 *     construction, which is exactly the failure mode a verifier exists to
 *     catch. (It does share two pure readers with reseed — see the import
 *     comment above; those answer "where is the data", not "what is it worth".)
 *  2. It never reads `reportFact`. Facts are the thing under test; a verifier
 *     that consulted them would only be checking the fold, not the pipeline.
 *  3. Where it can, it reaches for a DIFFERENT column than the emitters do —
 *     transaction headers rather than line items, `serviceCase.totalAmount`
 *     rather than the billed lines, `posTransactionAdjustment.deltaTotal`
 *     rather than the adjustment lines. Agreement then means two independently
 *     maintained columns agree, not that one column was copied correctly.
 *
 * The single deliberate exception is `resolveOperatingDate`: which day an
 * instant belongs to is an authority, not an opinion. A verifier that re-derived
 * the timezone boundary would report a difference every time the store's
 * timezone history was interesting, which is noise, not signal.
 *
 * ---------------------------------------------------------------------------
 * KNOWN BLIND SPOTS (deliberate; documented so a clean run is not overread)
 * ---------------------------------------------------------------------------
 *  - `unitsReturned` has NO row-reachable source. Returned quantities are
 *    recorded by the command that performed the return, not as a queryable
 *    column with a business timestamp, so the expectation here is always 0. A
 *    nonzero folded value surfaces as a difference for human adjudication
 *    rather than being silently blessed.
 *  - POS line-level refunds (`posTransactionItem.isRefunded`) are not reachable
 *    from any store-scoped index, and no POS emitter records them. Both sides
 *    are therefore zero and the check is silent — a real gap, not a passing one.
 *  - Quarantined and foreign-currency facts are excluded by the fold but are
 *    invisible from the domain side. Read `flags` on the day alongside this
 *    result.
 *
 * ---------------------------------------------------------------------------
 * ESCALATION — void sign convention
 * ---------------------------------------------------------------------------
 * The POS emitter carries `void` amounts as POSITIVE magnitudes
 * (`recordPosVoidFacts` in convex/pos/application/commands/completeTransaction.ts).
 * `factDeltas` normalizes those with `-Math.abs(...)`, but `foldDay` treats
 * `void` as "signed as carried by the emitter" and ADDS them. The open-day
 * preview and the authoritative fold therefore disagree on the sign of a void.
 * This verifier takes the business reading — a void withdraws a sale — and so
 * will report a difference on any day containing a voided transaction until
 * slice A or slice B2 reconciles the convention. This is not a verifier bug.
 */

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/** Source documents examined per domain, per day. */
export const VERIFY_MAX_DOCS_PER_DOMAIN = 500;
/** Child rows read for one source document. */
export const VERIFY_MAX_LINES_PER_DOC = 500;
/** Day docs examined by the store summary. */
export const VERIFY_MAX_DAYS = 400;
export const VERIFY_MAX_SCHEDULES = 100;

/**
 * Slack around the UTC day, wide enough for any real timezone offset (±14h)
 * plus room to spare. Correctness does not depend on the width: every
 * candidate is confirmed with `resolveOperatingDate` before it counts. The
 * window only keeps the scan bounded.
 */
const OPERATING_DAY_SLACK_MS = 18 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far back to look for orders whose refunds might land on the target day.
 * A storefront refund is dated independently of the fulfilment that earned it,
 * and `onlineOrder` has no index on refund time.
 */
const STOREFRONT_REFUND_LOOKBACK_MS = 90 * DAY_MS;

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/** The metrics this module claims to be able to re-derive from sources. */
export type VerifiedMetrics = {
  netSalesMinor: number;
  grossSalesMinor: number;
  refundsMinor: number;
  unitsSold: number;
  unitsReturned: number;
  paymentsCollectedMinor: number;
  paymentsRefundedMinor: number;
  paymentAllocatedMinor: number;
};

export const VERIFIED_METRIC_KEYS = [
  "netSalesMinor",
  "grossSalesMinor",
  "refundsMinor",
  "unitsSold",
  "unitsReturned",
  "paymentsCollectedMinor",
  "paymentsRefundedMinor",
  "paymentAllocatedMinor",
] as const satisfies readonly (keyof VerifiedMetrics)[];

export type VerifyPaymentPosture = {
  outcome: "complete" | "incomplete";
  reason:
    | "complete"
    | "source_cap_exceeded"
    | "legacy_void_missing_timestamp"
    | "voided_refund_unsupported"
    | "invalid_allocation";
  eligibleMinor: number;
  coveredMinor: number;
  omittedMinor: number;
  unsettledMinor: number | null;
  allocationCoverage: "complete" | "unknown";
  hasInvalidAllocation: boolean;
};

export type VerifyPaymentDifference = {
  field:
    | "paymentUnsettledMinor"
    | "paymentAllocationCoverage"
    | "paymentAllocationOmittedMinor"
    | "paymentHasInvalidAllocation";
  expected: number | string | boolean | null;
  actual: number | string | boolean | null;
};

export type VerifyDifference = {
  field: keyof VerifiedMetrics;
  expected: number;
  actual: number;
};

export type VerifyDayResult = {
  operatingDate: string;
  matches: boolean;
  differences: VerifyDifference[];
  factCount: number;
  dayStatus: ReportDayStatus | "missing";
  expected: VerifiedMetrics;
  paymentPosture: VerifyPaymentPosture;
  paymentDifferences: VerifyPaymentDifference[];
  /** A domain scan hit its bound; `expected` is a lower bound, not a total. */
  truncated: boolean;
};

export type VerifyStoreSummary = {
  daysChecked: number;
  daysMatching: number;
  mismatches: VerifyDayResult[];
  /** More than VERIFY_MAX_DAYS day docs exist; older days were not checked. */
  truncated: boolean;
};

export type VerifyCurrentWeekResult =
  | {
      outcome: "unavailable";
      reason:
        | "missing_projection"
        | "missing_schedule"
        | "missing_timezone"
        | "schedule_history_cap"
        | "no_scheduled_dates"
        | "missing_day_fold";
    }
  | {
      outcome: "incomplete";
      reason:
        | "payment_source_incomplete"
        | "source_cap_exceeded"
        | "invalid_payment_allocation";
      cycleStartDate: string;
      cycleEndDate: string;
      daysChecked: number;
    }
  | {
      outcome: "verified";
      cycleStartDate: string;
      cycleEndDate: string;
      daysChecked: number;
      matches: boolean;
      scheduleMatches: boolean;
      includedDifferences: VerifyDifference[];
      outsideScheduleDifferences: VerifyDifference[];
      includedPaymentDifferences: VerifyPaymentDifference[];
      outsideSchedulePaymentDifferences: VerifyPaymentDifference[];
      truncated: boolean;
      varianceMatches: boolean;
      closeMatches: boolean;
      amendmentMatches: boolean;
      inventoryMatches: boolean;
    };

function zeroMetrics(): VerifiedMetrics {
  return {
    grossSalesMinor: 0,
    netSalesMinor: 0,
    paymentsCollectedMinor: 0,
    paymentsRefundedMinor: 0,
    paymentAllocatedMinor: 0,
    refundsMinor: 0,
    unitsReturned: 0,
    unitsSold: 0,
  };
}

function addMetrics(
  total: VerifiedMetrics,
  contribution: VerifiedMetrics,
): void {
  for (const field of VERIFIED_METRIC_KEYS) total[field] += contribution[field];
}

// ---------------------------------------------------------------------------
// Day window
// ---------------------------------------------------------------------------

function candidateWindow(operatingDate: string): {
  startAt: number;
  endAt: number;
} {
  const midnightUtc = Date.parse(`${operatingDate}T00:00:00.000Z`);
  return {
    endAt: midnightUtc + DAY_MS + OPERATING_DAY_SLACK_MS,
    startAt: midnightUtc - OPERATING_DAY_SLACK_MS,
  };
}

// ---------------------------------------------------------------------------
// Independent recomputation
// ---------------------------------------------------------------------------

/**
 * Recompute a day's totals from domain tables.
 *
 * Each domain contributes through its own small block with its own arithmetic;
 * nothing is routed through a shared "apply a fact" helper, because a shared
 * helper is precisely what would make a mapping bug invisible.
 */
export async function computeExpectedDay(
  ctx: QueryCtx,
  storeId: Id<"store">,
  operatingDate: string,
): Promise<{
  expected: VerifiedMetrics;
  paymentPosture: VerifyPaymentPosture;
  truncated: boolean;
}> {
  const expected = zeroMetrics();
  const { endAt, startAt } = candidateWindow(operatingDate);
  let truncated = false;

  const onTargetDay = async (instant: number): Promise<boolean> =>
    (await resolveOperatingDate(ctx, storeId, instant)) === operatingDate;

  // --- POS sales -----------------------------------------------------------
  // Basis: the transaction HEADER (`subtotal` + `tax`). The emitters build
  // their facts from line totals, so agreement here means header and lines
  // agree — a stronger statement than re-adding the same column twice.
  const completedTransactions = await ctx.db
    .query("posTransaction")
    .withIndex("by_storeId_status_completedAt", (q) =>
      q
        .eq("storeId", storeId)
        .eq("status", "completed")
        .gte("completedAt", startAt)
        .lte("completedAt", endAt),
    )
    .take(VERIFY_MAX_DOCS_PER_DOMAIN + 1);
  if (completedTransactions.length > VERIFY_MAX_DOCS_PER_DOMAIN) {
    truncated = true;
  }

  for (const transaction of completedTransactions.slice(
    0,
    VERIFY_MAX_DOCS_PER_DOMAIN,
  )) {
    if (!(await onTargetDay(transaction.completedAt))) continue;
    const revenue = transaction.subtotal + transaction.tax;
    expected.grossSalesMinor += revenue;
    expected.netSalesMinor += revenue;

    const items = await ctx.db
      .query("posTransactionItem")
      .withIndex("by_transactionId", (q) =>
        q.eq("transactionId", transaction._id),
      )
      .take(VERIFY_MAX_LINES_PER_DOC + 1);
    if (items.length > VERIFY_MAX_LINES_PER_DOC) truncated = true;
    for (const item of items.slice(0, VERIFY_MAX_LINES_PER_DOC))
      expected.unitsSold += item.quantity;
  }

  // --- POS voids -----------------------------------------------------------
  // A void withdraws a sale, so it subtracts. See the escalation note above:
  // the fold currently adds. `voidedAt` — not `completedAt` — decides the day,
  // because that is when the withdrawal was authorised.
  const voidedTransactions = await ctx.db
    .query("posTransaction")
    .withIndex("by_storeId_status_completedAt", (q) =>
      q.eq("storeId", storeId).eq("status", "void"),
    )
    .take(VERIFY_MAX_DOCS_PER_DOMAIN + 1);
  if (voidedTransactions.length > VERIFY_MAX_DOCS_PER_DOMAIN) {
    truncated = true;
  }

  for (const transaction of voidedTransactions.slice(
    0,
    VERIFY_MAX_DOCS_PER_DOMAIN,
  )) {
    const voidedAt = transaction.voidedAt ?? transaction.completedAt;

    // The underlying sale still counts on the day it was rung up.
    if (await onTargetDay(transaction.completedAt)) {
      const revenue = transaction.subtotal + transaction.tax;
      expected.grossSalesMinor += revenue;
      expected.netSalesMinor += revenue;
      const soldItems = await ctx.db
        .query("posTransactionItem")
        .withIndex("by_transactionId", (q) =>
          q.eq("transactionId", transaction._id),
        )
        .take(VERIFY_MAX_LINES_PER_DOC + 1);
      if (soldItems.length > VERIFY_MAX_LINES_PER_DOC) truncated = true;
      for (const item of soldItems.slice(0, VERIFY_MAX_LINES_PER_DOC))
        expected.unitsSold += item.quantity;
    }

    if (!(await onTargetDay(voidedAt))) continue;
    const revenue = transaction.subtotal + transaction.tax;
    expected.grossSalesMinor -= revenue;
    expected.netSalesMinor -= revenue;
    const items = await ctx.db
      .query("posTransactionItem")
      .withIndex("by_transactionId", (q) =>
        q.eq("transactionId", transaction._id),
      )
      .take(VERIFY_MAX_LINES_PER_DOC + 1);
    if (items.length > VERIFY_MAX_LINES_PER_DOC) truncated = true;
    for (const item of items.slice(0, VERIFY_MAX_LINES_PER_DOC))
      expected.unitsSold -= item.quantity;
  }

  // --- POS corrections -----------------------------------------------------
  // Basis: `deltaTotal`, the adjustment's own summary column, rather than the
  // per-line corrected/original totals the emitter differences.
  const adjustments = await ctx.db
    .query("posTransactionAdjustment")
    .withIndex("by_storeId_status_appliedAt", (q) =>
      q
        .eq("storeId", storeId)
        .eq("status", "applied")
        .gte("appliedAt", startAt)
        .lte("appliedAt", endAt),
    )
    .take(VERIFY_MAX_DOCS_PER_DOMAIN + 1);
  if (adjustments.length > VERIFY_MAX_DOCS_PER_DOMAIN) truncated = true;

  for (const adjustment of adjustments.slice(0, VERIFY_MAX_DOCS_PER_DOMAIN)) {
    const appliedAt = adjustment.appliedAt ?? adjustment.updatedAt;
    if (!(await onTargetDay(appliedAt))) continue;
    expected.grossSalesMinor += adjustment.deltaTotal;
    expected.netSalesMinor += adjustment.deltaTotal;

    const lines = await ctx.db
      .query("posTransactionAdjustmentLine")
      .withIndex("by_adjustmentId", (q) => q.eq("adjustmentId", adjustment._id))
      .take(VERIFY_MAX_LINES_PER_DOC + 1);
    if (lines.length > VERIFY_MAX_LINES_PER_DOC) truncated = true;
    for (const line of lines.slice(0, VERIFY_MAX_LINES_PER_DOC))
      expected.unitsSold += line.quantityDelta;
  }

  // --- Storefront ----------------------------------------------------------
  // One scan per fulfilled status, reaching back far enough to catch orders
  // whose refunds land on the target day.
  for (const status of ["delivered", "picked-up"]) {
    const orders = await ctx.db
      .query("onlineOrder")
      .withIndex("by_storeId_status_completedAt", (q) =>
        q
          .eq("storeId", storeId)
          .eq("status", status)
          .gte("completedAt", startAt - STOREFRONT_REFUND_LOOKBACK_MS)
          .lte("completedAt", endAt),
      )
      .take(VERIFY_MAX_DOCS_PER_DOMAIN + 1);
    if (orders.length > VERIFY_MAX_DOCS_PER_DOMAIN) truncated = true;

    for (const order of orders.slice(0, VERIFY_MAX_DOCS_PER_DOMAIN)) {
      const items = await loadOnlineOrderLines(ctx, order);
      if (items.capExceeded) truncated = true;
      if (items.lines.length === 0) continue;

      const fulfilledAt =
        order.completedAt ?? order.updatedAt ?? order._creationTime;
      if (await onTargetDay(fulfilledAt)) {
        const deliveryFee = Math.max(0, Math.round(order.deliveryFee ?? 0));
        let merchandise = 0;
        for (const item of items.lines) {
          merchandise += item.price * item.quantity;
          expected.unitsSold += item.quantity;
        }
        // `getDiscountValue` is domain authority for what an order's discount
        // means (percentage vs amount, whole-order vs selected SKUs).
        // Reinterpreting it here would invent a second discount policy.
        const discount = Math.max(
          0,
          Math.round(
            getDiscountValue(toDiscountItems(items.lines), order.discount),
          ),
        );
        expected.grossSalesMinor += merchandise + deliveryFee;
        expected.netSalesMinor += merchandise + deliveryFee - discount;
      }

      for (const refund of order.refunds ?? []) {
        if (!(await onTargetDay(refund.date))) continue;
        const amount = Math.max(0, Math.round(refund.amount));
        expected.refundsMinor += amount;
        expected.netSalesMinor -= amount;
      }
    }
  }

  // --- Service -------------------------------------------------------------
  // Basis: `serviceCase.totalAmount`, the case's own maintained total, rather
  // than re-adding the billed lines the emitter walks.
  const serviceCases = await ctx.db
    .query("serviceCase")
    .withIndex("by_storeId_status_completedAt", (q) =>
      q
        .eq("storeId", storeId)
        .eq("status", "completed")
        .gte("completedAt", startAt)
        .lte("completedAt", endAt),
    )
    .take(VERIFY_MAX_DOCS_PER_DOMAIN + 1);
  if (serviceCases.length > VERIFY_MAX_DOCS_PER_DOMAIN) truncated = true;

  for (const serviceCase of serviceCases.slice(0, VERIFY_MAX_DOCS_PER_DOMAIN)) {
    const completedAt = serviceCase.completedAt ?? serviceCase.updatedAt;
    if (!(await onTargetDay(completedAt))) continue;

    // Billed through the till? Then POS already counted it above.
    const posServiceLine = await ctx.db
      .query("posTransactionServiceLine")
      .withIndex("by_serviceCaseId", (q) =>
        q.eq("serviceCaseId", serviceCase._id),
      )
      .first();
    if (posServiceLine) continue;

    expected.grossSalesMinor += serviceCase.totalAmount;
    expected.netSalesMinor += serviceCase.totalAmount;

    const lineItems = await ctx.db
      .query("serviceCaseLineItem")
      .withIndex("by_serviceCaseId", (q) =>
        q.eq("serviceCaseId", serviceCase._id),
      )
      .take(VERIFY_MAX_LINES_PER_DOC + 1);
    if (lineItems.length > VERIFY_MAX_LINES_PER_DOC) truncated = true;
    if (lineItems.length === 0) {
      expected.unitsSold += 1;
    } else {
      for (const lineItem of lineItems.slice(0, VERIFY_MAX_LINES_PER_DOC))
        expected.unitsSold += lineItem.quantity;
    }
  }

  // --- Payments ------------------------------------------------------------
  // This is deliberately source-direct arithmetic over paymentAllocation. It
  // does not consult report facts or the fold's posture helper. A voided row
  // preserves its original event at recordedAt and contributes a separate
  // reversal only at the server-stamped voidedAt.
  const allocations = await ctx.db
    .query("paymentAllocation")
    .withIndex("by_storeId_recordedAt", (q) => q.eq("storeId", storeId))
    .take(VERIFY_MAX_DOCS_PER_DOMAIN + 1);
  const paymentCapExceeded = allocations.length > VERIFY_MAX_DOCS_PER_DOMAIN;
  if (paymentCapExceeded) truncated = true;

  let paymentIncompleteReason: VerifyPaymentPosture["reason"] | null =
    paymentCapExceeded ? "source_cap_exceeded" : null;
  let paymentOmittedMinor = 0;

  for (const allocation of allocations.slice(0, VERIFY_MAX_DOCS_PER_DOMAIN)) {
    const amountMinor = Math.abs(allocation.amount);
    const originalIsOnTargetDay = await onTargetDay(allocation.recordedAt);

    if (allocation.direction === "in") {
      if (originalIsOnTargetDay) {
        expected.paymentsCollectedMinor += amountMinor;
        if (
          allocation.status === "recorded" ||
          allocation.voidedAt !== undefined
        ) {
          expected.paymentAllocatedMinor += amountMinor;
        } else {
          paymentOmittedMinor += amountMinor;
        }
      }
    } else if (originalIsOnTargetDay) {
      expected.paymentsRefundedMinor += amountMinor;
      expected.paymentAllocatedMinor -= amountMinor;
    }

    if (allocation.status !== "voided") continue;
    if (allocation.direction === "out") {
      paymentIncompleteReason ??= "voided_refund_unsupported";
      paymentOmittedMinor += amountMinor;
      continue;
    }
    if (allocation.voidedAt === undefined) {
      paymentIncompleteReason ??= "legacy_void_missing_timestamp";
      // The reversal could belong to any period, so no date is invented.
      if (!originalIsOnTargetDay) paymentOmittedMinor += amountMinor;
      continue;
    }
    if (await onTargetDay(allocation.voidedAt)) {
      expected.paymentsRefundedMinor += amountMinor;
      expected.paymentAllocatedMinor -= amountMinor;
    }
  }

  const eligibleMinor = Math.max(
    0,
    expected.paymentsCollectedMinor - expected.paymentsRefundedMinor,
  );
  const coveredMinor = Math.min(
    eligibleMinor,
    Math.max(0, expected.paymentAllocatedMinor),
  );
  const hasInvalidAllocation =
    expected.paymentAllocatedMinor < 0 ||
    expected.paymentAllocatedMinor > eligibleMinor;
  if (hasInvalidAllocation) paymentIncompleteReason ??= "invalid_allocation";
  const paymentComplete = paymentIncompleteReason === null;
  const paymentPosture: VerifyPaymentPosture = {
    outcome: paymentComplete ? "complete" : "incomplete",
    reason: paymentIncompleteReason ?? "complete",
    eligibleMinor,
    coveredMinor,
    omittedMinor: paymentOmittedMinor,
    unsettledMinor: paymentComplete
      ? Math.max(0, eligibleMinor - coveredMinor)
      : null,
    allocationCoverage: paymentComplete ? "complete" : "unknown",
    hasInvalidAllocation,
  };

  return { expected, paymentPosture, truncated };
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

/** Pure: the fields on which the recomputation and the fold disagree. */
export function diffMetrics(
  expected: VerifiedMetrics,
  actual: VerifiedMetrics,
): VerifyDifference[] {
  const differences: VerifyDifference[] = [];
  for (const field of VERIFIED_METRIC_KEYS) {
    if (expected[field] !== actual[field]) {
      differences.push({
        actual: actual[field],
        expected: expected[field],
        field,
      });
    }
  }
  return differences;
}

function diffPaymentPosture(
  expected: VerifyPaymentPosture,
  actual: {
    paymentUnsettledMinor: number | null;
    paymentAllocationCoverage: "complete" | "unknown";
    paymentAllocationOmittedMinor: number;
    paymentHasInvalidAllocation: boolean;
  } | null,
): VerifyPaymentDifference[] {
  const normalized = actual ?? {
    paymentUnsettledMinor: null,
    paymentAllocationCoverage: "unknown" as const,
    paymentAllocationOmittedMinor: 0,
    paymentHasInvalidAllocation: false,
  };
  const comparisons: Array<{
    field: VerifyPaymentDifference["field"];
    expected: VerifyPaymentDifference["expected"];
    actual: VerifyPaymentDifference["actual"];
  }> = [
    {
      field: "paymentUnsettledMinor",
      expected: expected.unsettledMinor,
      actual: normalized.paymentUnsettledMinor,
    },
    {
      field: "paymentAllocationCoverage",
      expected: expected.allocationCoverage,
      actual: normalized.paymentAllocationCoverage,
    },
    {
      field: "paymentAllocationOmittedMinor",
      expected: expected.omittedMinor,
      actual: normalized.paymentAllocationOmittedMinor,
    },
    {
      field: "paymentHasInvalidAllocation",
      expected: expected.hasInvalidAllocation,
      actual: normalized.paymentHasInvalidAllocation,
    },
  ];
  return comparisons.filter(
    (comparison) => comparison.actual !== comparison.expected,
  );
}

function foldedMetrics(day: Doc<"reportDay"> | null): VerifiedMetrics {
  if (!day) return zeroMetrics();
  return {
    grossSalesMinor: day.grossSalesMinor,
    netSalesMinor: day.netSalesMinor,
    paymentsCollectedMinor: day.paymentsCollectedMinor,
    paymentsRefundedMinor: day.paymentsRefundedMinor,
    paymentAllocatedMinor: day.paymentAllocatedMinor,
    refundsMinor: day.refundsMinor,
    unitsReturned: day.unitsReturned,
    unitsSold: day.unitsSold,
  };
}

function weeklyVerifiedMetrics(
  metrics: ReportWeekMetrics,
): VerifiedMetrics {
  return {
    grossSalesMinor: metrics.grossSalesMinor,
    netSalesMinor: metrics.netSalesMinor,
    paymentsCollectedMinor: metrics.paymentsCollectedMinor,
    paymentsRefundedMinor: metrics.paymentsRefundedMinor,
    paymentAllocatedMinor: metrics.paymentAllocatedMinor,
    refundsMinor: metrics.refundsMinor,
    unitsReturned: metrics.unitsReturned,
    unitsSold: metrics.unitsSold,
  };
}

export async function verifyDayWithCtx(
  ctx: QueryCtx,
  storeId: Id<"store">,
  operatingDate: string,
): Promise<VerifyDayResult> {
  const day = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .unique();

  const { expected, paymentPosture, truncated } = await computeExpectedDay(
    ctx,
    storeId,
    operatingDate,
  );
  const differences = diffMetrics(expected, foldedMetrics(day));
  const paymentDifferences = diffPaymentPosture(
    paymentPosture,
    day?.paymentPosture
      ? {
          paymentUnsettledMinor: day.paymentPosture.unsettledMinor,
          paymentAllocationCoverage: day.paymentPosture.allocationCoverage,
          paymentAllocationOmittedMinor:
            day.paymentPosture.allocationOmittedMinor,
          paymentHasInvalidAllocation: day.paymentPosture.hasInvalidAllocation,
        }
      : null,
  );

  return {
    dayStatus: day?.status ?? "missing",
    differences,
    expected,
    paymentDifferences,
    paymentPosture,
    factCount: day?.factCount ?? 0,
    matches:
      !truncated &&
      differences.length === 0 &&
      paymentDifferences.length === 0 &&
      paymentPosture.outcome === "complete",
    operatingDate,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Public (internal) surface
// ---------------------------------------------------------------------------

/**
 * Diff one folded day against the domain tables it was derived from.
 *
 * A day with no `reportDay` doc verifies against zeros, so a missing day that
 * should have had sales reports as a difference rather than as "nothing here".
 */
export const verifyDayAgainstSources = internalQuery({
  args: {
    operatingDate: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args): Promise<VerifyDayResult> =>
    verifyDayWithCtx(ctx, args.storeId, args.operatingDate),
});

export async function verifyStoreSummaryWithCtx(
  ctx: QueryCtx,
  storeId: Id<"store">,
): Promise<VerifyStoreSummary> {
  const dayProbe = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
    .order("desc")
    .take(VERIFY_MAX_DAYS + 1);
  const truncated = dayProbe.length > VERIFY_MAX_DAYS;
  const days = dayProbe.slice(0, VERIFY_MAX_DAYS);

  const mismatches: VerifyDayResult[] = [];
  let daysMatching = 0;

  for (const day of days) {
    const result = await verifyDayWithCtx(ctx, storeId, day.operatingDate);
    if (result.matches) daysMatching += 1;
    else mismatches.push(result);
  }

  return {
    daysChecked: days.length,
    daysMatching,
    mismatches,
    truncated,
  };
}

/**
 * Recompute the current weekly headline fields directly from source domains.
 *
 * This intentionally does not read facts or call either weekly fold helper.
 * The schedule resolver remains shared authority for period membership, while
 * the financial arithmetic is independently accumulated day by day here.
 */
export async function verifyCurrentWeekWithCtx(
  ctx: QueryCtx,
  storeId: Id<"store">,
): Promise<VerifyCurrentWeekResult> {
  const current = await ctx.db
    .query("reportWeekCurrent")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
  if (!current) return { outcome: "unavailable", reason: "missing_projection" };
  if (current.availability === "unavailable") {
    return { outcome: "unavailable", reason: current.unavailableReason };
  }

  const scheduleProbe = await ctx.db
    .query("storeSchedule")
    .withIndex("by_storeId_status_effectiveFrom", (q) =>
      q.eq("storeId", storeId),
    )
    .take(VERIFY_MAX_SCHEDULES + 1);
  if (scheduleProbe.length > VERIFY_MAX_SCHEDULES) {
    return {
      cycleEndDate: current.cycleEndDate,
      cycleStartDate: current.cycleStartDate,
      daysChecked: 0,
      outcome: "incomplete",
      reason: "source_cap_exceeded",
    };
  }
  const schedules = scheduleProbe.filter(
    (schedule) => schedule.status !== "candidate",
  );
  const activeSchedule = schedules
    .filter(
      (schedule) =>
        schedule.effectiveFrom <= current.materializedAt &&
        (schedule.effectiveTo === undefined ||
          current.materializedAt < schedule.effectiveTo),
    )
    .sort((left, right) => right.effectiveFrom - left.effectiveFrom)[0];
  if (!activeSchedule)
    return { outcome: "unavailable", reason: "missing_schedule" };

  const period = resolveWeeklyPeriod({
    referenceAt: current.materializedAt,
    schedules,
    timezone: activeSchedule.timezone || null,
  });
  if (period.kind !== "resolved")
    return { outcome: "unavailable", reason: "missing_schedule" };

  const included = zeroMetrics();
  const outsideSchedule = zeroMetrics();
  let includedPaymentUnsettledMinor = 0;
  let outsideSchedulePaymentUnsettledMinor = 0;
  for (const date of period.dates) {
    const result = await computeExpectedDay(ctx, storeId, date.localDate);
    if (result.truncated) {
      return {
        cycleEndDate: current.cycleEndDate,
        cycleStartDate: current.cycleStartDate,
        daysChecked: period.dates.length,
        outcome: "incomplete",
        reason: "source_cap_exceeded",
      };
    }
    addMetrics(date.included ? included : outsideSchedule, result.expected);
    if (result.paymentPosture.outcome === "incomplete") {
      return {
        cycleEndDate: current.cycleEndDate,
        cycleStartDate: current.cycleStartDate,
        daysChecked: period.dates.length,
        outcome: "incomplete",
        reason:
          result.paymentPosture.reason === "source_cap_exceeded"
            ? "source_cap_exceeded"
            : result.paymentPosture.reason === "invalid_allocation"
              ? "invalid_payment_allocation"
              : "payment_source_incomplete",
      };
    }
    if (date.included) {
      includedPaymentUnsettledMinor +=
        result.paymentPosture.unsettledMinor ?? 0;
    } else {
      outsideSchedulePaymentUnsettledMinor +=
        result.paymentPosture.unsettledMinor ?? 0;
    }
  }

  const projectedIncluded = weeklyVerifiedMetrics(current.included);
  const projectedOutside = weeklyVerifiedMetrics(current.outsideSchedule);
  const includedDifferences = diffMetrics(included, projectedIncluded);
  const outsideScheduleDifferences = diffMetrics(
    outsideSchedule,
    projectedOutside,
  );
  const includedPaymentDifferences = diffPaymentPosture(
    {
      outcome: "complete",
      reason: "complete",
      eligibleMinor: Math.max(
        0,
        included.paymentsCollectedMinor - included.paymentsRefundedMinor,
      ),
      coveredMinor: Math.max(0, included.paymentAllocatedMinor),
      omittedMinor: 0,
      unsettledMinor: includedPaymentUnsettledMinor,
      allocationCoverage: "complete",
      hasInvalidAllocation: false,
    },
    {
      paymentUnsettledMinor: current.included.paymentUnsettledMinor,
      paymentAllocationCoverage: current.included.paymentAllocationCoverage,
      paymentAllocationOmittedMinor: 0,
      paymentHasInvalidAllocation: false,
    },
  );
  const outsideSchedulePaymentDifferences = diffPaymentPosture(
    {
      outcome: "complete",
      reason: "complete",
      eligibleMinor: Math.max(
        0,
        outsideSchedule.paymentsCollectedMinor -
          outsideSchedule.paymentsRefundedMinor,
      ),
      coveredMinor: Math.max(0, outsideSchedule.paymentAllocatedMinor),
      omittedMinor: 0,
      unsettledMinor: outsideSchedulePaymentUnsettledMinor,
      allocationCoverage: "complete",
      hasInvalidAllocation: false,
    },
    {
      paymentUnsettledMinor: current.outsideSchedule.paymentUnsettledMinor,
      paymentAllocationCoverage:
        current.outsideSchedule.paymentAllocationCoverage,
      paymentAllocationOmittedMinor: 0,
      paymentHasInvalidAllocation: false,
    },
  );
  const scheduleMatches =
    current.cycleStartDate === period.startDate &&
    current.cycleEndDate === period.endDate &&
    current.scheduleLineage.length === period.dates.length &&
    period.dates.every((date, index) => {
      const projected = current.scheduleLineage[index];
      return (
        projected?.localDate === date.localDate &&
        projected.included === date.included &&
        String(projected.scheduleVersionId) === String(date.scheduleVersionId)
      );
    });

  const dayProbe = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q
        .eq("storeId", storeId)
        .gte("operatingDate", period.startDate)
        .lte("operatingDate", period.endDate),
    )
    .take(period.dates.length + 1);
  if (dayProbe.length > period.dates.length) {
    return {
      cycleEndDate: current.cycleEndDate,
      cycleStartDate: current.cycleStartDate,
      daysChecked: period.dates.length,
      outcome: "incomplete",
      reason: "source_cap_exceeded",
    };
  }
  const expectedVariance = computeWeeklyVariancePosture(period, dayProbe);
  const varianceMatches =
    JSON.stringify(current.variancePosture) ===
    JSON.stringify(expectedVariance);

  const frameScheduleVersionId = period.dates[0]?.scheduleVersionId;
  const frameSchedule = schedules.find(
    (schedule) => String(schedule._id) === String(frameScheduleVersionId),
  );
  const frameStartAt = frameSchedule?.timezone
    ? localDateStartAt(period.startDate, frameSchedule.timezone)
    : null;
  if (frameStartAt === null) {
    return { outcome: "unavailable", reason: "missing_schedule" };
  }
  const logicalWork =
    await listOpenSyncedSaleInventoryReviewGroupsWithCompleteness(ctx, storeId);
  if (logicalWork.overflow) {
    return {
      cycleEndDate: current.cycleEndDate,
      cycleStartDate: current.cycleStartDate,
      daysChecked: period.dates.length,
      outcome: "incomplete",
      reason: "source_cap_exceeded",
    };
  }
  const expectedInventory = projectLiveWeeklyInventoryAttention({
    frameStartAt,
    logicalWork,
  });
  const inventoryMatches =
    JSON.stringify(current.inventoryAttention) ===
    JSON.stringify(expectedInventory);

  const accepted = current.acceptedBaselineId
    ? await ctx.db.get("reportWeekAccepted", current.acceptedBaselineId)
    : null;
  const expectedClosePosture = accepted
    ? await resolveAcceptedWeekClosePosture(
        ctx,
        accepted,
        period.finalScheduledDate,
      )
    : undefined;
  if (accepted && !expectedClosePosture) {
    return {
      cycleEndDate: current.cycleEndDate,
      cycleStartDate: current.cycleStartDate,
      daysChecked: period.dates.length,
      outcome: "incomplete",
      reason: "source_cap_exceeded",
    };
  }
  const closeMatches = accepted
    ? current.closePosture?.acceptedCloseId ===
        expectedClosePosture?.acceptedCloseId &&
      current.closePosture?.currentCloseId ===
        expectedClosePosture?.currentCloseId &&
      current.closePosture?.changedAt === expectedClosePosture?.changedAt &&
      current.closePosture?.status === expectedClosePosture?.status
    : current.acceptedBaselineId === undefined &&
      current.closePosture === undefined;
  const acceptedIncludedDifferences = accepted
    ? diffMetrics(included, weeklyVerifiedMetrics(accepted.included))
    : [];
  const acceptedOutsideDifferences = accepted
    ? diffMetrics(
        outsideSchedule,
        weeklyVerifiedMetrics(accepted.outsideSchedule),
      )
    : [];
  const expectedCurrentCloseId = expectedClosePosture?.currentCloseId;
  const expectsAmendment = Boolean(
    accepted &&
    (acceptedIncludedDifferences.length > 0 ||
      acceptedOutsideDifferences.length > 0 ||
      (expectedCurrentCloseId !== undefined &&
        expectedCurrentCloseId !== accepted.closeId)),
  );
  const amendmentMatches = !accepted
    ? current.acceptedBaselineId === undefined &&
      current.amendment === undefined
    : !expectsAmendment
      ? current.amendment === undefined
      : current.amendment !== undefined &&
        diffMetrics(included, weeklyVerifiedMetrics(current.amendment.included))
          .length === 0 &&
        diffMetrics(
          outsideSchedule,
          weeklyVerifiedMetrics(current.amendment.outsideSchedule),
        ).length === 0 &&
        current.amendment.includedNetSalesDeltaMinor ===
          included.netSalesMinor - accepted.included.netSalesMinor &&
        current.amendment.outsideScheduleNetSalesDeltaMinor ===
          outsideSchedule.netSalesMinor -
            accepted.outsideSchedule.netSalesMinor &&
        String(current.amendment.sourceCloseId) ===
          String(expectedCurrentCloseId) &&
        current.amendment.sourceCloseAcceptedAt ===
          (expectedCurrentCloseId
            ? expectedClosePosture?.changedAt
            : undefined);

  return {
    amendmentMatches,
    closeMatches,
    cycleEndDate: current.cycleEndDate,
    cycleStartDate: current.cycleStartDate,
    daysChecked: period.dates.length,
    includedDifferences,
    includedPaymentDifferences,
    inventoryMatches,
    matches:
      scheduleMatches &&
      varianceMatches &&
      closeMatches &&
      amendmentMatches &&
      inventoryMatches &&
      includedDifferences.length === 0 &&
      outsideScheduleDifferences.length === 0 &&
      includedPaymentDifferences.length === 0 &&
      outsideSchedulePaymentDifferences.length === 0,
    outcome: "verified",
    outsideScheduleDifferences,
    outsideSchedulePaymentDifferences,
    scheduleMatches,
    truncated: false,
    varianceMatches,
  };
}

/**
 * Verify every day the store has folded, newest first.
 *
 * This is the cutover evidence: run it after a reseed, adjudicate every
 * mismatch against raw domain rows, and record the adjudications.
 */
export const verifyStoreSummary = internalQuery({
  args: { storeId: v.id("store") },
  handler: async (ctx, args): Promise<VerifyStoreSummary> =>
    verifyStoreSummaryWithCtx(ctx, args.storeId),
});

/** Minimal, aggregate-only diagnostics: no source IDs or customer data. */
export const verifyCurrentWeekAgainstSources = internalQuery({
  args: { storeId: v.id("store") },
  handler: async (ctx, args): Promise<VerifyCurrentWeekResult> =>
    verifyCurrentWeekWithCtx(ctx, args.storeId),
});
