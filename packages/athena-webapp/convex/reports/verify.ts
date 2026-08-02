import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type {
  ReportDayStatus,
  ReportWeekMetrics,
} from "../../shared/reportsContract";
import { normalizeWeekMetrics } from "../../shared/reportsContract";
import { getDiscountValue } from "../inventory/utils";
import { resolveOperatingDate } from "./operatingDay";
// Readers, not mappers: `loadOnlineOrderLines` answers "where does this order
// keep its lines" (stored rows vs. the legacy inline copy) and
// `toDiscountItems` is a shape adapter. Neither decides a metric. Duplicating
// them would only let the verifier read a DIFFERENT set of lines than the one
// that exists, which is noise rather than independence.
import { loadOnlineOrderLines, toDiscountItems } from "./reseed";
import { localDateAt, localDateStartAt } from "../lib/storeScheduleTime";
// Identity constants, not projection logic: how a synced-sale review group is
// NAMED is a contract shared by everything that talks about the group. What the
// weekly report CONCLUDES about those groups is recomputed below.
import {
  canonicalSyncedSaleInventoryReviewSkuId,
  stableOperationalWorkItemSourceIdentity,
} from "../operations/logicalOperationalWork";

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
 *  4. The weekly lanes import NOTHING from `weekly.ts`, `weeklyPeriods.ts` or
 *     `weeklyInventory.ts`. Schedule membership, close lineage, Open Work
 *     recounting and close variance are all re-derived here from schedule
 *     versions, `dailyClose` and `operationalWorkItem` rows. Calling the same
 *     helpers the projection calls would only prove that a stored row still
 *     matches what the projection would write today — never that the
 *     projection's own reasoning is right.
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
/** Close versions inspected for one frame date, per weekly lane. */
export const VERIFY_MAX_CLOSE_VERSIONS = 8;
/** Open Work rows recounted per store by the weekly inventory lane. */
export const VERIFY_MAX_OPEN_WORK_ITEMS = 500;

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

/**
 * How far back an allocation may have been RECORDED and still contribute to the
 * target day.
 *
 * `paymentAllocation` is indexed on `recordedAt` only, but a row contributes to
 * the day at two instants: its original event at `recordedAt`, and — when it is
 * voided with a server timestamp — its reversal at `voidedAt`. A row voided
 * today may therefore have been recorded well before today. This lookback is
 * the same device the storefront refund scan already uses: it keeps the read
 * bounded to the VERIFIED PERIOD rather than to the store's lifetime, so a
 * store's five-hundredth allocation ever does not make every later day
 * permanently unverifiable.
 *
 * KNOWN BLIND SPOT (deliberate): a reversal of a row recorded more than this
 * far in the past is invisible to the verifier. That is bounded staleness, not
 * a silent partial total — the same trade the storefront lane documents.
 */
const PAYMENT_VOID_LOOKBACK_MS = 90 * DAY_MS;

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
        | "invalid_payment_allocation"
        /**
         * An oversized-group repair is actively re-keying Open Work. Group
         * identity is mid-flight, so an independent recount would compare two
         * different naming schemes and report a difference that is not one.
         */
        | "inventory_remediation_in_progress";
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
    .withIndex("by_storeId_recordedAt", (q) =>
      q
        .eq("storeId", storeId)
        .gte("recordedAt", startAt - PAYMENT_VOID_LOOKBACK_MS)
        .lte("recordedAt", endAt),
    )
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

/**
 * Exactly the four payment facts a projection persists, and therefore exactly
 * the four this module is able to contradict. Anything computed here that is
 * not in this shape would be a comparison that cannot fail.
 */
export type VerifyPaymentComparable = {
  unsettledMinor: number | null;
  allocationCoverage: "complete" | "unknown";
  omittedMinor: number;
  hasInvalidAllocation: boolean;
};

function diffPaymentPosture(
  expected: VerifyPaymentComparable,
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

// ---------------------------------------------------------------------------
// Independent weekly lanes
//
// Everything below re-derives, from source rows, something the weekly
// projection also derives. None of it calls the projection's own helpers.
// ---------------------------------------------------------------------------

type VerifiedFrameDate = {
  localDate: string;
  included: boolean;
  scheduleVersionId: string | null;
};

type VerifiedFrame = {
  startDate: string;
  endDate: string;
  dates: VerifiedFrameDate[];
  includedDates: string[];
  finalScheduledDate: string | null;
};

function isoWeekday(localDate: string): number {
  return new Date(`${localDate}T12:00:00.000Z`).getUTCDay();
}

/** Noon-anchored so a date shift can never cross a DST edge. */
function shiftLocalDate(localDate: string, days: number): string {
  return new Date(Date.parse(`${localDate}T12:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** The newest non-candidate version whose effective window covers the date. */
function scheduleGoverning(
  schedules: readonly Doc<"storeSchedule">[],
  localDate: string,
  timezone: string,
): Doc<"storeSchedule"> | null {
  const at = localDateStartAt(localDate, timezone);
  if (at === null) return null;
  let governing: Doc<"storeSchedule"> | null = null;
  for (const schedule of schedules) {
    if (schedule.effectiveFrom > at) continue;
    if (schedule.effectiveTo !== undefined && at >= schedule.effectiveTo) {
      continue;
    }
    if (!governing || schedule.effectiveFrom > governing.effectiveFrom) {
      governing = schedule;
    }
  }
  return governing;
}

/**
 * Membership, re-derived: a dated exception overrides the weekly closed-day
 * pattern, and nothing else participates. Operating-hour windows deliberately
 * do not decide whether a date is reported.
 */
function scheduleIncludesDate(
  schedule: Doc<"storeSchedule">,
  localDate: string,
): boolean {
  for (const exception of schedule.dateExceptions) {
    if (exception.localDate === localDate) return exception.closed !== true;
  }
  return !schedule.weeklyClosedDays.includes(isoWeekday(localDate));
}

/**
 * The seven-date reporting frame, resolved WITHOUT `resolveWeeklyPeriod`.
 *
 * Same inputs, separately written arithmetic: find the reference date's
 * governing version, walk back to its reporting anchor weekday, then ask each
 * of the seven dates' own governing version whether it is scheduled.
 */
function resolveVerifiedFrame(args: {
  referenceAt: number;
  schedules: readonly Doc<"storeSchedule">[];
  timezone: string;
}): VerifiedFrame | null {
  const referenceDate = localDateAt(args.referenceAt, args.timezone);
  const referenceSchedule = scheduleGoverning(
    args.schedules,
    referenceDate,
    args.timezone,
  );
  if (!referenceSchedule) return null;

  const anchor = referenceSchedule.reportingCycleStartsOn ?? 1;
  const startDate = shiftLocalDate(
    referenceDate,
    -((isoWeekday(referenceDate) - anchor + 7) % 7),
  );
  const dates: VerifiedFrameDate[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const localDate = shiftLocalDate(startDate, offset);
    const schedule = scheduleGoverning(args.schedules, localDate, args.timezone);
    if (!schedule) return null;
    dates.push({
      localDate,
      included: scheduleIncludesDate(schedule, localDate),
      scheduleVersionId: String(schedule._id),
    });
  }

  const includedDates = dates
    .filter((date) => date.included)
    .map((date) => date.localDate);
  return {
    startDate,
    endDate: shiftLocalDate(startDate, 6),
    dates,
    includedDates,
    finalScheduledDate: includedDates.at(-1) ?? null,
  };
}

type VerifiedClosePosture = {
  acceptedCloseId: Id<"dailyClose">;
  currentCloseId?: Id<"dailyClose">;
  changedAt: number;
  status: "accepted" | "reopened_awaiting_successor" | "successor_accepted";
};

/**
 * Close lineage for one accepted frame, read straight off `dailyClose`.
 *
 * `null` means the final date carries more close versions than this lane will
 * read; the caller reports incomplete rather than a lineage it cannot see.
 */
async function verifyAcceptedClosePosture(
  ctx: QueryCtx,
  accepted: Pick<
    Doc<"reportWeekAccepted">,
    "acceptedAt" | "closeId" | "storeId"
  >,
  finalScheduledDate: string | null,
): Promise<VerifiedClosePosture | null> {
  const original = await ctx.db.get("dailyClose", accepted.closeId);
  if (!original || !finalScheduledDate) {
    return {
      acceptedCloseId: accepted.closeId,
      changedAt: accepted.acceptedAt,
      status: "accepted",
    };
  }
  const versions = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", accepted.storeId).eq("operatingDate", finalScheduledDate),
    )
    .take(VERIFY_MAX_CLOSE_VERSIONS + 1);
  if (versions.length > VERIFY_MAX_CLOSE_VERSIONS) return null;

  const liveAt = (close: Doc<"dailyClose">) =>
    close.completedAt ?? close.updatedAt;
  let successor: Doc<"dailyClose"> | null = null;
  let reopenSuccessorPending = false;
  for (const close of versions) {
    if (
      close.reopenedFromDailyCloseId === accepted.closeId &&
      close.status === "open"
    ) {
      reopenSuccessorPending = true;
    }
    if (close._id === accepted.closeId) continue;
    if (close.status !== "completed") continue;
    if (close.lifecycleStatus === "superseded") continue;
    if (!successor || liveAt(close) > liveAt(successor)) successor = close;
  }

  if (successor) {
    return {
      acceptedCloseId: accepted.closeId,
      currentCloseId: successor._id,
      changedAt: liveAt(successor),
      status: "successor_accepted",
    };
  }
  if (
    original.lifecycleStatus === "reopened" ||
    original.lifecycleStatus === "superseded" ||
    reopenSuccessorPending
  ) {
    return {
      acceptedCloseId: accepted.closeId,
      changedAt: original.reopenedAt ?? original.updatedAt,
      status: "reopened_awaiting_successor",
    };
  }
  return {
    acceptedCloseId: accepted.closeId,
    currentCloseId: accepted.closeId,
    changedAt: accepted.acceptedAt,
    status: "accepted",
  };
}

type VerifiedInventoryGroup = {
  key: string;
  classification: "carried_forward" | "new_this_week";
  evidenceLimited: boolean;
  hasNewActivity: boolean;
  memberCount: number;
  productSkuId: string | null;
};

type VerifiedInventoryRecount =
  | { outcome: "remediation_in_progress" }
  | {
      outcome: "ok";
      groups: VerifiedInventoryGroup[];
      overflow: boolean;
    };

/**
 * Recount the open synced-sale inventory review groups from work-item rows.
 *
 * The group KEY comes from the shared identity contract — a group's name is
 * not an opinion — but the grouping, the member counts and the
 * carried-forward/new classification are all re-derived here.
 */
async function recountOpenInventoryReviewGroups(
  ctx: QueryCtx,
  storeId: Id<"store">,
  frameStartAt: number,
): Promise<VerifiedInventoryRecount> {
  for (const status of ["pending", "running", "paused"] as const) {
    const repair = await ctx.db
      .query("oversizedOperationalWorkRepair")
      .withIndex("by_storeId_status", (q) =>
        q.eq("storeId", storeId).eq("status", status),
      )
      .take(1);
    if (repair.length > 0) return { outcome: "remediation_in_progress" };
  }

  const items: Doc<"operationalWorkItem">[] = [];
  let remaining = VERIFY_MAX_OPEN_WORK_ITEMS;
  let overflow = false;
  for (const status of ["open", "in_progress"] as const) {
    const lane = await ctx.db
      .query("operationalWorkItem")
      .withIndex("by_storeId_type_status", (q) =>
        q
          .eq("storeId", storeId)
          .eq("type", "synced_sale_inventory_review")
          .eq("status", status),
      )
      .take(remaining + 1);
    overflow ||= lane.length > remaining;
    const accepted = lane.slice(0, remaining);
    items.push(...accepted);
    remaining -= accepted.length;
  }

  const byKey = new Map<
    string,
    { createdAts: number[]; productSkuId: string | null }
  >();
  for (const item of items) {
    const productSkuId = canonicalSyncedSaleInventoryReviewSkuId(item);
    const key = productSkuId
      ? `synced_sale_inventory_review:${item.storeId}:${productSkuId}`
      : stableOperationalWorkItemSourceIdentity(item);
    const entry = byKey.get(key);
    if (entry) entry.createdAts.push(item.createdAt ?? 0);
    else {
      byKey.set(key, {
        createdAts: [item.createdAt ?? 0],
        productSkuId: productSkuId ? String(productSkuId) : null,
      });
    }
  }

  return {
    outcome: "ok",
    overflow,
    groups: [...byKey.entries()].map(([key, entry]) => ({
      key,
      classification: entry.createdAts.some(
        (createdAt) => createdAt < frameStartAt,
      )
        ? ("carried_forward" as const)
        : ("new_this_week" as const),
      evidenceLimited: overflow || entry.productSkuId === null,
      hasNewActivity: entry.createdAts.some(
        (createdAt) => createdAt >= frameStartAt,
      ),
      memberCount: entry.createdAts.length,
      productSkuId: entry.productSkuId,
    })),
  };
}

/** Order is presentation; identity and counts are truth. */
function inventoryAttentionAgrees(
  stored: NonNullable<
    Extract<Doc<"reportWeekCurrent">, { included: unknown }>["inventoryAttention"]
  > | undefined,
  recount: Extract<VerifiedInventoryRecount, { outcome: "ok" }>,
): boolean {
  if (!stored) return false;
  const expectedCompleteness = recount.overflow ? "incomplete" : "complete";
  if (stored.completeness !== expectedCompleteness) return false;
  if (stored.overflow !== recount.overflow) return false;
  if (stored.observedCount !== recount.groups.length) return false;
  if (stored.groups.length !== recount.groups.length) return false;
  if (
    stored.carriedForwardCount !==
    recount.groups.filter((group) => group.classification === "carried_forward")
      .length
  ) {
    return false;
  }
  if (
    stored.newCount !==
    recount.groups.filter((group) => group.classification === "new_this_week")
      .length
  ) {
    return false;
  }
  const storedByKey = new Map(stored.groups.map((group) => [group.key, group]));
  return recount.groups.every((group) => {
    const projected = storedByKey.get(group.key);
    return (
      projected !== undefined &&
      projected.classification === group.classification &&
      projected.evidenceLimited === group.evidenceLimited &&
      projected.hasNewActivity === group.hasNewActivity &&
      projected.memberCount === group.memberCount &&
      (projected.productSkuId === null
        ? group.productSkuId === null
        : String(projected.productSkuId) === group.productSkuId)
    );
  });
}

type VerifiedVariancePosture = {
  closeVarianceMinor: number;
  coverage: "complete" | "partial" | "unavailable";
  coveredIncludedDayCount: number;
  includedDayCount: number;
  scheduledVarianceMinor: number;
  outsideScheduleVarianceMinor: number;
  outsideScheduleCoveredDayCount: number;
};

/**
 * Close variance, recomputed from the close's OWN accepted sales column and
 * this module's independently derived net sales for the same date.
 *
 * Which close a date was reconciled against is read from the day row's
 * `closeId` — an identity, not an amount — so the value under test
 * (`netSales - acceptedSales`) is never sourced from the projection that
 * published it.
 *
 * Every frame date is walked, not only the scheduled ones: closes exist on
 * non-operational dates, and a lane that skipped them could only ever mirror
 * the omission it exists to catch. Worst case is one `dailyClose` read per
 * frame date — seven, up from the scheduled-date count.
 */
async function recomputeVerifiedVariance(args: {
  ctx: QueryCtx;
  days: readonly Doc<"reportDay">[];
  expectedNetByDate: ReadonlyMap<string, number>;
  frame: VerifiedFrame;
}): Promise<VerifiedVariancePosture> {
  const dayByDate = new Map(
    args.days.map((day) => [day.operatingDate, day] as const),
  );
  let scheduledVarianceMinor = 0;
  let outsideScheduleVarianceMinor = 0;
  let coveredIncludedDayCount = 0;
  let outsideScheduleCoveredDayCount = 0;

  for (const date of args.frame.dates) {
    const closeId = dayByDate.get(date.localDate)?.closeId;
    if (!closeId) continue;
    const close = await args.ctx.db.get("dailyClose", closeId);
    if (!close) continue;
    const salesTotal =
      typeof close.summary.salesTotal === "number" ? close.summary.salesTotal : 0;
    const acceptedNetSalesMinor =
      typeof close.summary.adjustedSalesTotal === "number"
        ? close.summary.adjustedSalesTotal
        : salesTotal;
    const variance =
      (args.expectedNetByDate.get(date.localDate) ?? 0) - acceptedNetSalesMinor;
    if (date.included) {
      scheduledVarianceMinor += variance;
      coveredIncludedDayCount += 1;
    } else {
      outsideScheduleVarianceMinor += variance;
      outsideScheduleCoveredDayCount += 1;
    }
  }

  return {
    closeVarianceMinor: scheduledVarianceMinor + outsideScheduleVarianceMinor,
    // Coverage measures scheduled expectation only; an outside-schedule date
    // without a close is not a gap, so it never enters this ratio.
    coverage:
      coveredIncludedDayCount === 0
        ? "unavailable"
        : coveredIncludedDayCount === args.frame.includedDates.length
          ? "complete"
          : "partial",
    coveredIncludedDayCount,
    includedDayCount: args.frame.includedDates.length,
    scheduledVarianceMinor,
    outsideScheduleVarianceMinor,
    outsideScheduleCoveredDayCount,
  };
}

/** The four persisted payment facts, accumulated across a frame's days. */
function accumulatePayment(
  total: VerifyPaymentComparable,
  posture: VerifyPaymentPosture,
): VerifyPaymentComparable {
  return {
    unsettledMinor:
      total.unsettledMinor === null || posture.unsettledMinor === null
        ? null
        : total.unsettledMinor + posture.unsettledMinor,
    allocationCoverage:
      total.allocationCoverage === "unknown" ||
      posture.allocationCoverage === "unknown"
        ? "unknown"
        : "complete",
    omittedMinor: total.omittedMinor + posture.omittedMinor,
    hasInvalidAllocation:
      total.hasInvalidAllocation || posture.hasInvalidAllocation,
  };
}

function zeroPaymentComparable(): VerifyPaymentComparable {
  return {
    unsettledMinor: 0,
    allocationCoverage: "complete",
    omittedMinor: 0,
    hasInvalidAllocation: false,
  };
}

/** Read the persisted weekly payment lane through the rollout normalizer. */
function storedWeeklyPayment(metrics: ReportWeekMetrics) {
  const normalized = normalizeWeekMetrics(metrics);
  return {
    paymentUnsettledMinor: normalized.paymentUnsettledMinor,
    paymentAllocationCoverage: normalized.paymentAllocationCoverage,
    paymentAllocationOmittedMinor: normalized.paymentAllocationOmittedMinor,
    paymentHasInvalidAllocation: normalized.paymentHasInvalidAllocation,
  };
}

/**
 * Recompute the current weekly headline fields directly from source domains.
 *
 * This reads no facts and calls no weekly fold helper. Schedule membership,
 * close lineage, Open Work attention and close variance are re-derived from
 * source rows by the lanes above; the financial arithmetic is accumulated day
 * by day from `computeExpectedDay`.
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

  if (!activeSchedule.timezone) {
    return { outcome: "unavailable", reason: "missing_timezone" };
  }
  const period = resolveVerifiedFrame({
    referenceAt: current.materializedAt,
    schedules,
    timezone: activeSchedule.timezone,
  });
  if (!period) return { outcome: "unavailable", reason: "missing_schedule" };

  const included = zeroMetrics();
  const outsideSchedule = zeroMetrics();
  let includedPayment = zeroPaymentComparable();
  let outsideSchedulePayment = zeroPaymentComparable();
  const expectedNetByDate = new Map<string, number>();
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
    expectedNetByDate.set(date.localDate, result.expected.netSalesMinor);
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
      includedPayment = accumulatePayment(
        includedPayment,
        result.paymentPosture,
      );
    } else {
      outsideSchedulePayment = accumulatePayment(
        outsideSchedulePayment,
        result.paymentPosture,
      );
    }
  }

  const projectedIncluded = weeklyVerifiedMetrics(current.included);
  const projectedOutside = weeklyVerifiedMetrics(current.outsideSchedule);
  const includedDifferences = diffMetrics(included, projectedIncluded);
  const outsideScheduleDifferences = diffMetrics(
    outsideSchedule,
    projectedOutside,
  );
  // Both sides are live: the expectation is accumulated from the day postures
  // recomputed above, and the actual side is what the weekly projection
  // persisted. Every one of the four comparisons can fail.
  const includedPaymentDifferences = diffPaymentPosture(
    includedPayment,
    storedWeeklyPayment(current.included),
  );
  const outsideSchedulePaymentDifferences = diffPaymentPosture(
    outsideSchedulePayment,
    storedWeeklyPayment(current.outsideSchedule),
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
  const expectedVariance = await recomputeVerifiedVariance({
    ctx,
    days: dayProbe,
    expectedNetByDate,
    frame: period,
  });
  // The split fields are compared only when the stored row carries them: a row
  // written before the split landed has no lane values to disagree with, and
  // its scheduled-only total is still caught by the total comparison above it.
  const storedVarianceSplit =
    current.variancePosture?.scheduledVarianceMinor !== undefined &&
    current.variancePosture.outsideScheduleVarianceMinor !== undefined &&
    current.variancePosture.outsideScheduleCoveredDayCount !== undefined;
  const varianceMatches =
    current.variancePosture !== undefined &&
    current.variancePosture.closeVarianceMinor ===
      expectedVariance.closeVarianceMinor &&
    current.variancePosture.coverage === expectedVariance.coverage &&
    current.variancePosture.coveredIncludedDayCount ===
      expectedVariance.coveredIncludedDayCount &&
    current.variancePosture.includedDayCount ===
      expectedVariance.includedDayCount &&
    (!storedVarianceSplit ||
      (current.variancePosture.scheduledVarianceMinor ===
        expectedVariance.scheduledVarianceMinor &&
        current.variancePosture.outsideScheduleVarianceMinor ===
          expectedVariance.outsideScheduleVarianceMinor &&
        current.variancePosture.outsideScheduleCoveredDayCount ===
          expectedVariance.outsideScheduleCoveredDayCount));

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
  const recount = await recountOpenInventoryReviewGroups(
    ctx,
    storeId,
    frameStartAt,
  );
  if (recount.outcome === "remediation_in_progress") {
    return {
      cycleEndDate: current.cycleEndDate,
      cycleStartDate: current.cycleStartDate,
      daysChecked: period.dates.length,
      outcome: "incomplete",
      reason: "inventory_remediation_in_progress",
    };
  }
  if (recount.overflow) {
    return {
      cycleEndDate: current.cycleEndDate,
      cycleStartDate: current.cycleStartDate,
      daysChecked: period.dates.length,
      outcome: "incomplete",
      reason: "source_cap_exceeded",
    };
  }
  const inventoryMatches = inventoryAttentionAgrees(
    current.inventoryAttention,
    recount,
  );

  const accepted = current.acceptedBaselineId
    ? await ctx.db.get("reportWeekAccepted", current.acceptedBaselineId)
    : null;
  const expectedClosePosture = accepted
    ? await verifyAcceptedClosePosture(ctx, accepted, period.finalScheduledDate)
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
