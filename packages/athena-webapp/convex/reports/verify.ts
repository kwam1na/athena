import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { ReportDayStatus } from "../../shared/reportsContract";
import { getDiscountValue } from "../inventory/utils";
import { resolveOperatingDate } from "./operatingDay";
// Readers, not mappers: `loadOnlineOrderLines` answers "where does this order
// keep its lines" (stored rows vs. the legacy inline copy) and
// `toDiscountItems` is a shape adapter. Neither decides a metric. Duplicating
// them would only let the verifier read a DIFFERENT set of lines than the one
// that exists, which is noise rather than independence.
import { loadOnlineOrderLines, toDiscountItems } from "./reseed";

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
};

export const VERIFIED_METRIC_KEYS = [
  "netSalesMinor",
  "grossSalesMinor",
  "refundsMinor",
  "unitsSold",
  "unitsReturned",
  "paymentsCollectedMinor",
] as const satisfies readonly (keyof VerifiedMetrics)[];

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

function zeroMetrics(): VerifiedMetrics {
  return {
    grossSalesMinor: 0,
    netSalesMinor: 0,
    paymentsCollectedMinor: 0,
    refundsMinor: 0,
    unitsReturned: 0,
    unitsSold: 0,
  };
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
): Promise<{ expected: VerifiedMetrics; truncated: boolean }> {
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
    .take(VERIFY_MAX_DOCS_PER_DOMAIN);
  if (completedTransactions.length === VERIFY_MAX_DOCS_PER_DOMAIN) {
    truncated = true;
  }

  for (const transaction of completedTransactions) {
    if (!(await onTargetDay(transaction.completedAt))) continue;
    const revenue = transaction.subtotal + transaction.tax;
    expected.grossSalesMinor += revenue;
    expected.netSalesMinor += revenue;

    const items = await ctx.db
      .query("posTransactionItem")
      .withIndex("by_transactionId", (q) =>
        q.eq("transactionId", transaction._id),
      )
      .take(VERIFY_MAX_LINES_PER_DOC);
    for (const item of items) expected.unitsSold += item.quantity;
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
    .take(VERIFY_MAX_DOCS_PER_DOMAIN);
  if (voidedTransactions.length === VERIFY_MAX_DOCS_PER_DOMAIN) {
    truncated = true;
  }

  for (const transaction of voidedTransactions) {
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
        .take(VERIFY_MAX_LINES_PER_DOC);
      for (const item of soldItems) expected.unitsSold += item.quantity;
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
      .take(VERIFY_MAX_LINES_PER_DOC);
    for (const item of items) expected.unitsSold -= item.quantity;
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
    .take(VERIFY_MAX_DOCS_PER_DOMAIN);
  if (adjustments.length === VERIFY_MAX_DOCS_PER_DOMAIN) truncated = true;

  for (const adjustment of adjustments) {
    const appliedAt = adjustment.appliedAt ?? adjustment.updatedAt;
    if (!(await onTargetDay(appliedAt))) continue;
    expected.grossSalesMinor += adjustment.deltaTotal;
    expected.netSalesMinor += adjustment.deltaTotal;

    const lines = await ctx.db
      .query("posTransactionAdjustmentLine")
      .withIndex("by_adjustmentId", (q) => q.eq("adjustmentId", adjustment._id))
      .take(VERIFY_MAX_LINES_PER_DOC);
    for (const line of lines) expected.unitsSold += line.quantityDelta;
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
      .take(VERIFY_MAX_DOCS_PER_DOMAIN);
    if (orders.length === VERIFY_MAX_DOCS_PER_DOMAIN) truncated = true;

    for (const order of orders) {
      const items = await loadOnlineOrderLines(ctx, order);
      if (items.length === 0) continue;

      const fulfilledAt =
        order.completedAt ?? order.updatedAt ?? order._creationTime;
      if (await onTargetDay(fulfilledAt)) {
        const deliveryFee = Math.max(0, Math.round(order.deliveryFee ?? 0));
        let merchandise = 0;
        for (const item of items) {
          merchandise += item.price * item.quantity;
          expected.unitsSold += item.quantity;
        }
        // `getDiscountValue` is domain authority for what an order's discount
        // means (percentage vs amount, whole-order vs selected SKUs).
        // Reinterpreting it here would invent a second discount policy.
        const discount = Math.max(
          0,
          Math.round(getDiscountValue(toDiscountItems(items), order.discount)),
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
    .take(VERIFY_MAX_DOCS_PER_DOMAIN);
  if (serviceCases.length === VERIFY_MAX_DOCS_PER_DOMAIN) truncated = true;

  for (const serviceCase of serviceCases) {
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
      .take(VERIFY_MAX_LINES_PER_DOC);
    if (lineItems.length === 0) {
      expected.unitsSold += 1;
    } else {
      for (const lineItem of lineItems) expected.unitsSold += lineItem.quantity;
    }
  }

  // --- Payments ------------------------------------------------------------
  // Collections only: inbound and not reversed. Outbound and voided rows are
  // refunds and belong to `paymentsRefundedMinor`, which this module does not
  // claim.
  const allocations = await ctx.db
    .query("paymentAllocation")
    .withIndex("by_storeId_recordedAt", (q) =>
      q.eq("storeId", storeId).gte("recordedAt", startAt).lte("recordedAt", endAt),
    )
    .take(VERIFY_MAX_DOCS_PER_DOMAIN);
  if (allocations.length === VERIFY_MAX_DOCS_PER_DOMAIN) truncated = true;

  for (const allocation of allocations) {
    if (allocation.status !== "recorded") continue;
    if (allocation.direction !== "in") continue;
    if (!(await onTargetDay(allocation.recordedAt))) continue;
    expected.paymentsCollectedMinor += Math.abs(allocation.amount);
  }

  return { expected, truncated };
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
      differences.push({ actual: actual[field], expected: expected[field], field });
    }
  }
  return differences;
}

function foldedMetrics(day: Doc<"reportDay"> | null): VerifiedMetrics {
  if (!day) return zeroMetrics();
  return {
    grossSalesMinor: day.grossSalesMinor,
    netSalesMinor: day.netSalesMinor,
    paymentsCollectedMinor: day.paymentsCollectedMinor,
    refundsMinor: day.refundsMinor,
    unitsReturned: day.unitsReturned,
    unitsSold: day.unitsSold,
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

  const { expected, truncated } = await computeExpectedDay(
    ctx,
    storeId,
    operatingDate,
  );
  const differences = diffMetrics(expected, foldedMetrics(day));

  return {
    dayStatus: day?.status ?? "missing",
    differences,
    expected,
    factCount: day?.factCount ?? 0,
    matches: differences.length === 0,
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
  const days = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
    .order("desc")
    .take(VERIFY_MAX_DAYS);

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
    truncated: days.length === VERIFY_MAX_DAYS,
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
