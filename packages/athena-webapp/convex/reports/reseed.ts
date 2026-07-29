import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalMutation } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { NewReportFact } from "../../shared/reportsContract";
import { normalizeCurrencyCode } from "../../shared/reportsContract";
import { reportingLineCostFromEffect } from "../inventoryLedger/commerceEffects";
import { getDiscountValue } from "../inventory/utils";
import { recordFacts } from "./ingest";
import { resolveOperatingDate } from "./operatingDay";

/**
 * Reseed — rebuild a store's entire reporting layer from domain sources.
 *
 * ONE path serves three jobs: prod bootstrap, dev reseed, disaster recovery.
 * Rebuilding is always "purge every derived doc, then re-walk the sources",
 * never "patch the difference" — a partial repair cannot be reasoned about,
 * a full rebuild can.
 *
 * Shape: a resumable phase machine driven by a cursor. Every invocation does
 * a bounded amount of work and either self-schedules with the next cursor or
 * finishes. That makes it safe on a 60-day store and on a 6-year one.
 *
 * IDEMPOTENCE. Re-running from scratch produces exactly the same fact set:
 * fact identity is structural (storeId, sourceDomain, sourceId, lineId,
 * factKind) and `recordFacts` treats an equal-fingerprint replay as a no-op.
 * Resuming mid-walk therefore cannot double-count, and a crashed reseed can
 * simply be restarted.
 *
 * FACT MAPPING IS A COPY, NOT A CALL. Each domain has a small local mapper
 * carrying a `KEEP IN SYNC WITH` pointer at its emitter. The emitters build
 * facts from *in-flight* command state (the values being written); reseed has
 * only the persisted row. The two cannot share one function without forcing
 * the live path through a re-read, so they are deliberately duplicated and
 * pinned by comment. Divergence shows up in `verify.ts`, which recomputes the
 * same days from the same tables through unrelated code.
 */

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/** Derived rows deleted per table, per invocation. */
export const RESEED_PURGE_BATCH = 200;
/** Source documents walked per invocation. */
export const RESEED_PAGE_SIZE = 100;
/** Child rows (line items) read for one source document. */
export const RESEED_MAX_LINES_PER_DOC = 500;

/**
 * Derived tables wiped before the walk. Order is irrelevant (the whole set is
 * gone before any fact is written) but stable, so a resumed purge is
 * deterministic.
 */
export const RESEED_PURGE_TABLES = [
  "reportFact",
  "reportSkuDay",
  "reportDay",
  "reportPeriodSkuRollup",
  "reportOverview",
  "reportRangeResult",
  // Last: the walk immediately starts re-marking days, and marks written by an
  // earlier phase of THIS reseed must not be wiped by a later purge batch.
  "reportDirtyDay",
] as const;

export type ReseedPurgeTable = (typeof RESEED_PURGE_TABLES)[number];

/**
 * Source walks, in order. POS is split by fact kind because each kind hangs
 * off a different index and a different business timestamp — voids are dated
 * to `voidedAt`, not to the sale's `completedAt`.
 */
export const RESEED_WALK_PHASES = [
  "pos_sale",
  "pos_void",
  "pos_correction",
  "storefront",
  "service",
  "daily_close",
  "payments",
  "receiving",
] as const;

export type ReseedWalkPhase = (typeof RESEED_WALK_PHASES)[number];
export type ReseedPhase = "purge" | ReseedWalkPhase | "done";

export type ReseedCursor = {
  phase: ReseedPhase;
  /** Index into RESEED_PURGE_TABLES; meaningful only while phase === "purge". */
  purgeTableIndex: number;
  /** Convex pagination cursor within the current walk phase. */
  pageCursor: string | null;
};

export type ReseedProgress = {
  cursor: ReseedCursor | null;
  phase: ReseedPhase;
  docsScanned: number;
  factsRecorded: number;
  rowsPurged: number;
  datesTouched: string[];
};

export const reseedCursorValidator = v.object({
  pageCursor: v.union(v.string(), v.null()),
  phase: v.string(),
  purgeTableIndex: v.number(),
});

const START_CURSOR: ReseedCursor = {
  pageCursor: null,
  phase: "purge",
  purgeTableIndex: 0,
};

/** Coerce a caller-supplied cursor. An unknown phase restarts, never crashes. */
export function normalizeReseedCursor(
  cursor: { pageCursor: string | null; phase: string; purgeTableIndex: number } | undefined,
): ReseedCursor {
  if (!cursor) return START_CURSOR;
  const known =
    cursor.phase === "purge" ||
    cursor.phase === "done" ||
    (RESEED_WALK_PHASES as readonly string[]).includes(cursor.phase);
  if (!known) return START_CURSOR;
  return {
    pageCursor: cursor.pageCursor,
    phase: cursor.phase as ReseedPhase,
    purgeTableIndex: Math.max(0, Math.floor(cursor.purgeTableIndex)),
  };
}

function nextWalkPhase(phase: ReseedWalkPhase): ReseedPhase {
  const index = RESEED_WALK_PHASES.indexOf(phase);
  return RESEED_WALK_PHASES[index + 1] ?? "done";
}

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

/**
 * Delete up to one batch from one derived table.
 *
 * Every read is store-scoped through an index whose first field is `storeId`,
 * so purging one store never touches another's rows and never scans a table.
 */
async function purgeBatch(
  ctx: MutationCtx,
  storeId: Id<"store">,
  table: ReseedPurgeTable,
): Promise<number> {
  const rows = await (() => {
    switch (table) {
      case "reportFact":
        return ctx.db
          .query("reportFact")
          .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
          .take(RESEED_PURGE_BATCH);
      case "reportSkuDay":
        return ctx.db
          .query("reportSkuDay")
          .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
            q.eq("storeId", storeId),
          )
          .take(RESEED_PURGE_BATCH);
      case "reportDay":
        return ctx.db
          .query("reportDay")
          .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
          .take(RESEED_PURGE_BATCH);
      case "reportPeriodSkuRollup":
        return ctx.db
          .query("reportPeriodSkuRollup")
          .withIndex("by_storeId_periodKey_productSkuId", (q) =>
            q.eq("storeId", storeId),
          )
          .take(RESEED_PURGE_BATCH);
      case "reportOverview":
        return ctx.db
          .query("reportOverview")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .take(RESEED_PURGE_BATCH);
      case "reportRangeResult":
        return ctx.db
          .query("reportRangeResult")
          .withIndex("by_storeId_requestKey", (q) => q.eq("storeId", storeId))
          .take(RESEED_PURGE_BATCH);
      case "reportDirtyDay":
        return ctx.db
          .query("reportDirtyDay")
          .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
          .take(RESEED_PURGE_BATCH);
    }
  })();

  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Emitters upper-case and trim the store currency; reseed must match exactly. */
function normalizeCurrency(currency: string | undefined): string {
  return normalizeCurrencyCode(currency);
}

/**
 * Point-in-time cost basis for a sold line, read back from the inventory
 * effect the sale recorded. Emitters attach `unitCostMinor` only for a fully
 * known basis — a partial basis is reported as uncosted revenue rather than
 * guessed — and reseed reproduces that binary exactly.
 */
async function unitCostMinorForLine(
  ctx: MutationCtx,
  storeId: Id<"store">,
  sourceDomain: "pos" | "storefront",
  businessEventKey: string,
  quantity: number,
): Promise<number | undefined> {
  const effect = await ctx.db
    .query("reportingInventoryEffect")
    .withIndex("by_storeId_sourceDomain_businessEventKey", (q) =>
      q
        .eq("storeId", storeId)
        .eq("sourceDomain", sourceDomain)
        .eq("businessEventKey", businessEventKey),
    )
    .first();
  const cost = reportingLineCostFromEffect(effect, quantity);
  if (cost.costStatus !== "known" || quantity === 0) return undefined;
  return Math.round((cost.cogsKnownMinor ?? 0) / Math.abs(quantity));
}

/** Shape `getDiscountValue` (the storefront discount authority) expects. */
export function toDiscountItems(
  items: readonly { price: number; productSkuId?: Id<"productSku">; quantity: number }[],
): Array<{ price: number; productSkuId: string; quantity: number }> {
  return items.map((item) => ({
    price: item.price,
    productSkuId: String(item.productSkuId ?? ""),
    quantity: item.quantity,
  }));
}

/**
 * Proportional split of a total across weights, last bucket absorbing the
 * rounding remainder.
 *
 * KEEP IN SYNC WITH convex/storeFront/onlineOrder.ts (`allocateMinorAmounts`).
 * Copied rather than imported because that module is not exported surface and
 * pulling it in would drag the whole storefront command file into reseed.
 */
export function allocateMinorAmounts(
  total: number,
  weights: number[],
): number[] {
  const safeTotal = Math.max(0, Math.round(total));
  const totalWeight = weights.reduce(
    (sum, weight) => sum + Math.max(0, Math.round(weight)),
    0,
  );
  if (weights.length === 0) return [];
  if (totalWeight === 0) {
    return weights.map((_, index) => (index === 0 ? safeTotal : 0));
  }

  let remainingAmount = safeTotal;
  let remainingWeight = totalWeight;
  return weights.map((weight, index) => {
    const normalizedWeight = Math.max(0, Math.round(weight));
    const amount =
      index === weights.length - 1
        ? remainingAmount
        : Math.round((remainingAmount * normalizedWeight) / remainingWeight);
    remainingAmount -= amount;
    remainingWeight -= normalizedWeight;
    return amount;
  });
}

// ---------------------------------------------------------------------------
// Per-domain mappers
// ---------------------------------------------------------------------------

/**
 * KEEP IN SYNC WITH convex/pos/application/commands/completeTransaction.ts
 * (`recordCompletedPosSaleFacts`).
 *
 * One `sale` per line at the line's persisted total, plus a header-level "tax"
 * line so a POS day's net sales reconcile to `subtotal + tax`. The emitter
 * builds line ids from the freshly inserted `posTransactionItem` ids, which is
 * what `String(item._id)` reproduces here.
 */
async function posSaleFacts(
  ctx: MutationCtx,
  transaction: Doc<"posTransaction">,
  items: Doc<"posTransactionItem">[],
  serviceLines: Doc<"posTransactionServiceLine">[],
  currency: string,
): Promise<NewReportFact[]> {
  const occurredAt = transaction.completedAt;
  const facts: NewReportFact[] = [];

  for (const item of items) {
    const unitCostMinor = await unitCostMinorForLine(
      ctx,
      transaction.storeId,
      "pos",
      `pos:${transaction._id}:line:${item._id}:sale`,
      item.quantity,
    );
    facts.push({
      currency,
      discountAmountMinor: 0,
      factKind: "sale",
      grossAmountMinor: item.totalPrice,
      lineId: String(item._id),
      netAmountMinor: item.totalPrice,
      occurredAt,
      productSkuId: String(item.productSkuId),
      quantity: item.quantity,
      sourceDomain: "pos",
      sourceId: String(transaction._id),
      taxAmountMinor: 0,
      ...(unitCostMinor !== undefined ? { unitCostMinor } : {}),
    });
  }

  if (transaction.tax !== 0) {
    facts.push({
      currency,
      discountAmountMinor: 0,
      factKind: "sale",
      grossAmountMinor: transaction.tax,
      lineId: "tax",
      netAmountMinor: transaction.tax,
      occurredAt,
      quantity: 0,
      sourceDomain: "pos",
      sourceId: String(transaction._id),
      taxAmountMinor: transaction.tax,
    });
  }

  // Till-billed services (posTransactionServiceLine) carry revenue that is in
  // the transaction header but not in the item list — revenue only, no units.
  for (const line of serviceLines) {
    facts.push({
      currency,
      discountAmountMinor: 0,
      factKind: "sale",
      grossAmountMinor: line.totalPrice,
      lineId: String(line._id),
      netAmountMinor: line.totalPrice,
      occurredAt,
      quantity: 0,
      sourceDomain: "pos",
      sourceId: String(transaction._id),
      taxAmountMinor: 0,
    });
  }

  return facts;
}

/**
 * KEEP IN SYNC WITH convex/pos/application/commands/completeTransaction.ts
 * (`recordPosVoidFacts`).
 *
 * A voided transaction keeps its sale facts (the sale really happened, on its
 * own operating day) and gains `void` facts dated to `voidedAt`, so a sale
 * voided the next morning withdraws from the morning, not from the night.
 *
 * Void amounts and quantities are NEGATED: the fold trusts void signs as
 * carried, so a void withdraws the sale in full (matching the emitter).
 */
function posVoidFacts(
  transaction: Doc<"posTransaction">,
  items: Doc<"posTransactionItem">[],
  serviceLines: Doc<"posTransactionServiceLine">[],
  currency: string,
  unitCostByLineId: Map<string, number>,
): NewReportFact[] {
  const occurredAt = transaction.voidedAt ?? transaction.completedAt;
  const facts: NewReportFact[] = items.map((item) => {
    const unitCostMinor = unitCostByLineId.get(String(item._id));
    return {
      currency,
      discountAmountMinor: -(item.discount ?? 0),
      factKind: "void" as const,
      grossAmountMinor: -item.totalPrice,
      lineId: String(item._id),
      netAmountMinor: -item.totalPrice,
      occurredAt,
      productSkuId: String(item.productSkuId),
      quantity: -item.quantity,
      sourceDomain: "pos" as const,
      sourceId: String(transaction._id),
      taxAmountMinor: 0,
      ...(unitCostMinor !== undefined ? { unitCostMinor } : {}),
    };
  });

  if (transaction.tax !== 0) {
    facts.push({
      currency,
      discountAmountMinor: 0,
      factKind: "void",
      grossAmountMinor: -transaction.tax,
      lineId: "tax",
      netAmountMinor: -transaction.tax,
      occurredAt,
      quantity: 0,
      sourceDomain: "pos",
      sourceId: String(transaction._id),
      taxAmountMinor: -transaction.tax,
    });
  }

  // A void withdraws till-billed service revenue too (see posSaleFacts).
  for (const line of serviceLines) {
    facts.push({
      currency,
      discountAmountMinor: 0,
      factKind: "void",
      grossAmountMinor: -line.totalPrice,
      lineId: String(line._id),
      netAmountMinor: -line.totalPrice,
      occurredAt,
      quantity: 0,
      sourceDomain: "pos",
      sourceId: String(transaction._id),
      taxAmountMinor: 0,
    });
  }

  return facts;
}

/**
 * KEEP IN SYNC WITH convex/pos/application/commands/adjustTransactionItems.ts.
 *
 * Corrections are SIGNED deltas — the only fact kind whose sign carries
 * meaning — so the mapper subtracts rather than taking magnitudes.
 */
function posCorrectionFacts(
  adjustment: Doc<"posTransactionAdjustment">,
  lines: Doc<"posTransactionAdjustmentLine">[],
  currency: string,
): NewReportFact[] {
  const occurredAt = adjustment.appliedAt ?? adjustment.updatedAt;
  const facts: NewReportFact[] = lines.map((line) => {
    const deltaMinor = line.correctedTotal - line.originalTotal;
    return {
      currency,
      discountAmountMinor: 0,
      factKind: "correction" as const,
      grossAmountMinor: deltaMinor,
      lineId: String(line._id),
      netAmountMinor: deltaMinor,
      occurredAt,
      productSkuId: String(line.productSkuId),
      quantity: line.quantityDelta,
      sourceDomain: "pos" as const,
      sourceId: String(adjustment.transactionId),
      taxAmountMinor: 0,
    };
  });

  const taxDelta = adjustment.correctedTax - adjustment.originalTax;
  if (taxDelta !== 0) {
    facts.push({
      currency,
      discountAmountMinor: 0,
      factKind: "correction",
      grossAmountMinor: taxDelta,
      lineId: "tax",
      netAmountMinor: taxDelta,
      occurredAt,
      quantity: 0,
      sourceDomain: "pos",
      sourceId: String(adjustment.transactionId),
      taxAmountMinor: taxDelta,
    });
  }

  return facts;
}

/** Fulfilled online-order statuses, as stored (hyphenated). */
export const FULFILLED_ONLINE_ORDER_STATUSES = [
  "delivered",
  "picked-up",
] as const;

/** The line shape both reseed and the verifier read an order through. */
export type OnlineOrderLine = {
  lineKey: string;
  price: number;
  productSkuId?: Id<"productSku">;
  quantity: number;
};

/**
 * An order's lines, preferring the `onlineOrderItem` rows and falling back to
 * the inline `order.items` copy.
 *
 * The fallback is not hypothetical: older orders were written before items
 * were split into their own table, and a reseed that ignored them would
 * silently drop real historical revenue. Inline items have no document id, so
 * their line keys are positional — stable for a given order, and distinct from
 * the id-shaped keys the live emitter produces.
 */
export async function loadOnlineOrderLines(
  ctx: MutationCtx | QueryCtx,
  order: Doc<"onlineOrder">,
): Promise<OnlineOrderLine[]> {
  const stored = await ctx.db
    .query("onlineOrderItem")
    .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
    .take(RESEED_MAX_LINES_PER_DOC);

  if (stored.length > 0) {
    return stored.map((item) => ({
      lineKey: String(item._id),
      price: item.price,
      productSkuId: item.productSkuId,
      quantity: item.quantity,
    }));
  }

  return (order.items ?? []).map((item, index) => ({
    lineKey: `inline:${index}`,
    price: item.price,
    productSkuId: item.productSkuId,
    quantity: item.quantity,
  }));
}

/**
 * KEEP IN SYNC WITH convex/storeFront/onlineOrder.ts
 * (`buildStorefrontFulfillmentSaleFacts`, `buildStorefrontRefundFacts`).
 *
 * Sales: order discount is allocated across merchandise lines by gross weight;
 * the delivery fee rides as its own zero-COGS line.
 *
 * Refunds: reconstructed from the persisted `order.refunds[]` ledger, one
 * money-only `refund` per (refund event × line). LIMITATION — the live path
 * distinguishes a money-only gateway refund (`refund`, no units) from goods
 * physically coming back (`return`, with units), but that distinction lives in
 * the command that performed it and is NOT recoverable from the order row.
 * Reseed therefore emits `refund` for everything, which preserves
 * `refundsMinor` and `netSalesMinor` and understates `unitsReturned`. The
 * verifier reports that gap rather than hiding it.
 */
async function storefrontFacts(
  ctx: MutationCtx,
  order: Doc<"onlineOrder">,
  items: OnlineOrderLine[],
  currency: string,
): Promise<NewReportFact[]> {
  const occurredAt = order.completedAt ?? order.updatedAt ?? order._creationTime;
  const deliveryFee = Math.max(0, Math.round(order.deliveryFee ?? 0));
  const discountAmount = Math.max(
    0,
    Math.round(getDiscountValue(toDiscountItems(items), order.discount)),
  );

  const merchandiseGross = items.map((item) => item.price * item.quantity);
  const discounts = allocateMinorAmounts(discountAmount, merchandiseGross);

  const facts: NewReportFact[] = [];
  for (const [index, item] of items.entries()) {
    const unitCostMinor = await unitCostMinorForLine(
      ctx,
      order.storeId,
      "storefront",
      `storefront:${order._id}:line:${item.lineKey}:fulfillment`,
      item.quantity,
    );
    facts.push({
      currency,
      discountAmountMinor: discounts[index],
      factKind: "sale",
      grossAmountMinor: merchandiseGross[index],
      lineId: item.lineKey,
      netAmountMinor: merchandiseGross[index] - discounts[index],
      occurredAt,
      quantity: item.quantity,
      sourceDomain: "storefront",
      sourceId: String(order._id),
      taxAmountMinor: 0,
      ...(item.productSkuId ? { productSkuId: String(item.productSkuId) } : {}),
      ...(unitCostMinor !== undefined ? { unitCostMinor } : {}),
    });
  }

  if (deliveryFee > 0) {
    facts.push({
      currency,
      discountAmountMinor: 0,
      factKind: "sale",
      grossAmountMinor: deliveryFee,
      lineId: "delivery",
      netAmountMinor: deliveryFee,
      occurredAt,
      quantity: 0,
      sourceDomain: "storefront",
      sourceId: String(order._id),
      taxAmountMinor: 0,
      // Delivery has no COGS by definition, not an unknown one.
      unitCostMinor: 0,
    });
  }

  for (const refund of order.refunds ?? []) {
    const components: Array<{
      key: string;
      productSkuId?: Id<"productSku">;
      weight: number;
    }> = items.map((item) => ({
      key: item.lineKey,
      productSkuId: item.productSkuId,
      weight: item.price * item.quantity,
    }));
    if (order.didRefundDeliveryFee && deliveryFee > 0) {
      components.push({ key: "delivery", weight: deliveryFee });
    }
    if (components.length === 0) {
      components.push({ key: "refund", weight: refund.amount });
    }
    const allocations = allocateMinorAmounts(
      refund.amount,
      components.map((component) => component.weight),
    );
    components.forEach((component, index) => {
      facts.push({
        currency,
        discountAmountMinor: 0,
        factKind: "refund",
        grossAmountMinor: allocations[index],
        lineId: `${refund.id}:${component.key}`,
        netAmountMinor: allocations[index],
        occurredAt: refund.date,
        quantity: 0,
        sourceDomain: "storefront",
        sourceId: String(order._id),
        taxAmountMinor: 0,
        ...(component.productSkuId
          ? { productSkuId: String(component.productSkuId) }
          : {}),
      });
    });
  }

  return facts;
}

/**
 * KEEP IN SYNC WITH convex/serviceOps/serviceCases.ts
 * (`updateServiceCaseStatus`, the `status === "completed"` branch).
 *
 * A case billed through the till already counted as a POS sale, so it emits
 * nothing — POS is the revenue authority for those. Otherwise one `sale` per
 * billed line, or a single synthetic "service" line at the quoted amount when
 * the case was never itemised.
 */
function serviceFacts(
  serviceCase: Doc<"serviceCase">,
  lineItems: Doc<"serviceCaseLineItem">[],
  currency: string,
): NewReportFact[] {
  const occurredAt = serviceCase.completedAt ?? serviceCase.updatedAt;

  if (lineItems.length > 0) {
    return lineItems.map((lineItem) => ({
      currency,
      discountAmountMinor: 0,
      factKind: "sale" as const,
      grossAmountMinor: lineItem.amount,
      lineId: String(lineItem._id),
      netAmountMinor: lineItem.amount,
      occurredAt,
      quantity: lineItem.quantity,
      sourceDomain: "service" as const,
      sourceId: String(serviceCase._id),
      taxAmountMinor: 0,
    }));
  }

  const totalAmount = serviceCase.quotedAmount ?? 0;
  return [
    {
      currency,
      discountAmountMinor: 0,
      factKind: "sale",
      grossAmountMinor: totalAmount,
      lineId: "service",
      netAmountMinor: totalAmount,
      occurredAt,
      quantity: 1,
      sourceDomain: "service",
      sourceId: String(serviceCase._id),
      taxAmountMinor: 0,
    },
  ];
}

/**
 * KEEP IN SYNC WITH convex/operations/dailyClose.ts
 * (`recordDailyCloseCompletedReportFacts`).
 *
 * "Accepted" is a derived predicate, not a stored status: `dailyClose` has
 * only open/completed and a separate lifecycle, and a reopened day leaves
 * superseded rows behind. The predicate here is the same one the sweeper folds
 * with (see `selectAcceptedClose`).
 */
export function isAcceptedClose(close: Doc<"dailyClose">): boolean {
  return close.status === "completed" && close.lifecycleStatus !== "superseded";
}

function closeSnapshotFact(
  close: Doc<"dailyClose">,
  currency: string,
): NewReportFact {
  const salesTotal =
    typeof close.summary.salesTotal === "number" ? close.summary.salesTotal : 0;
  const acceptedNetSalesMinor =
    typeof close.summary.adjustedSalesTotal === "number"
      ? close.summary.adjustedSalesTotal
      : salesTotal;

  return {
    currency,
    discountAmountMinor: 0,
    factKind: "close_snapshot",
    grossAmountMinor: 0,
    lineId: "",
    netAmountMinor: acceptedNetSalesMinor,
    occurredAt: close.completedAt ?? close.updatedAt,
    quantity: 0,
    sourceDomain: "daily_close",
    sourceId: String(close._id),
    taxAmountMinor: 0,
  };
}

/**
 * KEEP IN SYNC WITH convex/operations/paymentAllocations.ts
 * (`ensurePaymentAllocationReportingWithCtx`).
 *
 * A voided allocation is a reversal and an outbound allocation is a refund;
 * both land as `payment_refund`. Amounts are magnitudes — the fact kind, not
 * the sign, carries direction.
 */
function paymentFact(
  allocation: Doc<"paymentAllocation">,
  storeCurrency: string,
): NewReportFact {
  const isReversal = allocation.status === "voided";
  const isRefund = allocation.direction === "out" && !isReversal;
  const amountMinor = Math.abs(allocation.amount);

  return {
    currency: normalizeCurrency(allocation.currency ?? storeCurrency),
    discountAmountMinor: 0,
    factKind: isReversal || isRefund ? "payment_refund" : "payment",
    grossAmountMinor: amountMinor,
    lineId: "",
    netAmountMinor: amountMinor,
    occurredAt: allocation.recordedAt,
    quantity: 0,
    sourceDomain: "payments",
    sourceId: String(allocation._id),
    taxAmountMinor: 0,
  };
}

/**
 * KEEP IN SYNC WITH convex/stockOps/receiving.ts.
 *
 * `unitCostMinor` reflects a truly confirmed received cost only; when the
 * receipt has not been costed the planned PO cost stands in for the amount but
 * NOT for the cost basis, so the receipt is never mistaken for costed.
 */
async function receivingFacts(
  ctx: MutationCtx,
  batch: Doc<"receivingBatch">,
  storeCurrency: string,
): Promise<NewReportFact[]> {
  const purchaseOrder = await ctx.db.get(batch.purchaseOrderId);
  const facts: NewReportFact[] = [];

  for (const lineItem of batch.lineItems) {
    const poLine = await ctx.db.get(lineItem.purchaseOrderLineItemId);
    const plannedUnitCost = poLine?.unitCost ?? 0;
    const receivedUnitCostMinor = lineItem.confirmedUnitCost;
    const receivedNetAmountMinor =
      (receivedUnitCostMinor ?? plannedUnitCost) * lineItem.receivedQuantity;

    facts.push({
      currency: normalizeCurrency(
        lineItem.confirmedCurrency ?? purchaseOrder?.currency ?? storeCurrency,
      ),
      discountAmountMinor: 0,
      factKind: "procurement_receipt",
      grossAmountMinor: receivedNetAmountMinor,
      lineId: String(lineItem.purchaseOrderLineItemId),
      netAmountMinor: receivedNetAmountMinor,
      occurredAt: batch.receivedAt,
      productSkuId: String(lineItem.productSkuId),
      quantity: lineItem.receivedQuantity,
      sourceDomain: "inventory",
      sourceId: String(batch._id),
      taxAmountMinor: 0,
      ...(receivedUnitCostMinor !== undefined
        ? { unitCostMinor: receivedUnitCostMinor }
        : {}),
    });
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

type WalkOutcome = {
  facts: NewReportFact[];
  docsScanned: number;
  isDone: boolean;
  continueCursor: string;
};

async function walkPhase(
  ctx: MutationCtx,
  storeId: Id<"store">,
  storeCurrency: string,
  phase: ReseedWalkPhase,
  pageCursor: string | null,
): Promise<WalkOutcome> {
  const currency = normalizeCurrency(storeCurrency);
  const facts: NewReportFact[] = [];

  switch (phase) {
    case "pos_sale":
    case "pos_void": {
      const status = phase === "pos_sale" ? "completed" : "void";
      const page = await ctx.db
        .query("posTransaction")
        .withIndex("by_storeId_status_completedAt", (q) =>
          q.eq("storeId", storeId).eq("status", status),
        )
        .paginate({ cursor: pageCursor, numItems: RESEED_PAGE_SIZE });

      for (const transaction of page.page) {
        const items = await ctx.db
          .query("posTransactionItem")
          .withIndex("by_transactionId", (q) =>
            q.eq("transactionId", transaction._id),
          )
          .take(RESEED_MAX_LINES_PER_DOC);

        // A voided transaction still made its sale — both fact sets are
        // emitted here so the sale lands on its own day and the withdrawal
        // lands on the day it was authorised.
        const serviceLines = await ctx.db
          .query("posTransactionServiceLine")
          .withIndex("by_transactionId", (q) =>
            q.eq("transactionId", transaction._id),
          )
          .take(RESEED_MAX_LINES_PER_DOC);
        const saleFacts = await posSaleFacts(
          ctx,
          transaction,
          items,
          serviceLines,
          currency,
        );
        facts.push(...saleFacts);

        if (phase === "pos_void") {
          const unitCostByLineId = new Map<string, number>();
          for (const fact of saleFacts) {
            if (fact.unitCostMinor !== undefined) {
              unitCostByLineId.set(fact.lineId, fact.unitCostMinor);
            }
          }
          facts.push(
            ...posVoidFacts(
              transaction,
              items,
              serviceLines,
              currency,
              unitCostByLineId,
            ),
          );
        }
      }

      return {
        continueCursor: page.continueCursor,
        docsScanned: page.page.length,
        facts,
        isDone: page.isDone,
      };
    }

    case "pos_correction": {
      const page = await ctx.db
        .query("posTransactionAdjustment")
        .withIndex("by_storeId_status_appliedAt", (q) =>
          q.eq("storeId", storeId).eq("status", "applied"),
        )
        .paginate({ cursor: pageCursor, numItems: RESEED_PAGE_SIZE });

      for (const adjustment of page.page) {
        const lines = await ctx.db
          .query("posTransactionAdjustmentLine")
          .withIndex("by_adjustmentId", (q) =>
            q.eq("adjustmentId", adjustment._id),
          )
          .take(RESEED_MAX_LINES_PER_DOC);
        facts.push(
          ...posCorrectionFacts(
            adjustment,
            lines,
            normalizeCurrency(adjustment.currency ?? storeCurrency),
          ),
        );
      }

      return {
        continueCursor: page.continueCursor,
        docsScanned: page.page.length,
        facts,
        isDone: page.isDone,
      };
    }

    case "storefront": {
      // One index scan per fulfilled status would need two phases; instead the
      // walk is over `by_storeId` and non-fulfilled orders are skipped. The
      // page is still bounded, which is the property that matters.
      const page = await ctx.db
        .query("onlineOrder")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .paginate({ cursor: pageCursor, numItems: RESEED_PAGE_SIZE });

      for (const order of page.page) {
        if (
          !(FULFILLED_ONLINE_ORDER_STATUSES as readonly string[]).includes(
            order.status,
          )
        ) {
          continue;
        }
        const items = await loadOnlineOrderLines(ctx, order);
        if (items.length === 0) continue;
        facts.push(...(await storefrontFacts(ctx, order, items, currency)));
      }

      return {
        continueCursor: page.continueCursor,
        docsScanned: page.page.length,
        facts,
        isDone: page.isDone,
      };
    }

    case "service": {
      const page = await ctx.db
        .query("serviceCase")
        .withIndex("by_storeId_status_completedAt", (q) =>
          q.eq("storeId", storeId).eq("status", "completed"),
        )
        .paginate({ cursor: pageCursor, numItems: RESEED_PAGE_SIZE });

      for (const serviceCase of page.page) {
        const posServiceLine = await ctx.db
          .query("posTransactionServiceLine")
          .withIndex("by_serviceCaseId", (q) =>
            q.eq("serviceCaseId", serviceCase._id),
          )
          .first();
        if (posServiceLine) continue;

        const lineItems = await ctx.db
          .query("serviceCaseLineItem")
          .withIndex("by_serviceCaseId", (q) =>
            q.eq("serviceCaseId", serviceCase._id),
          )
          .take(RESEED_MAX_LINES_PER_DOC);
        facts.push(...serviceFacts(serviceCase, lineItems, currency));
      }

      return {
        continueCursor: page.continueCursor,
        docsScanned: page.page.length,
        facts,
        isDone: page.isDone,
      };
    }

    case "daily_close": {
      const page = await ctx.db
        .query("dailyClose")
        .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
        .paginate({ cursor: pageCursor, numItems: RESEED_PAGE_SIZE });

      for (const close of page.page) {
        if (!isAcceptedClose(close)) continue;
        facts.push(closeSnapshotFact(close, currency));
      }

      return {
        continueCursor: page.continueCursor,
        docsScanned: page.page.length,
        facts,
        isDone: page.isDone,
      };
    }

    case "payments": {
      const page = await ctx.db
        .query("paymentAllocation")
        .withIndex("by_storeId_recordedAt", (q) => q.eq("storeId", storeId))
        .paginate({ cursor: pageCursor, numItems: RESEED_PAGE_SIZE });

      for (const allocation of page.page) {
        facts.push(paymentFact(allocation, storeCurrency));
      }

      return {
        continueCursor: page.continueCursor,
        docsScanned: page.page.length,
        facts,
        isDone: page.isDone,
      };
    }

    case "receiving": {
      const page = await ctx.db
        .query("receivingBatch")
        .withIndex("by_storeId_receivedAt", (q) => q.eq("storeId", storeId))
        .paginate({ cursor: pageCursor, numItems: RESEED_PAGE_SIZE });

      for (const batch of page.page) {
        facts.push(...(await receivingFacts(ctx, batch, storeCurrency)));
      }

      return {
        continueCursor: page.continueCursor,
        docsScanned: page.page.length,
        facts,
        isDone: page.isDone,
      };
    }
  }
}

/** Upsert the reseed dirty mark for one day. */
async function markReseedDirty(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
): Promise<void> {
  const existing = await ctx.db
    .query("reportDirtyDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .first();
  const markedAt = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, { markedAt, reason: "reseed" });
    return;
  }
  await ctx.db.insert("reportDirtyDay", {
    markedAt,
    operatingDate,
    reason: "reseed",
    storeId,
  });
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

/**
 * One bounded unit of reseed work. Returns the cursor for the next step, or
 * `null` when the store is fully reseeded.
 *
 * Exported so tests (and an operator at a REPL) can drive the machine
 * synchronously without depending on the scheduler.
 */
export async function reseedStep(
  ctx: MutationCtx,
  storeId: Id<"store">,
  cursor: ReseedCursor,
): Promise<ReseedProgress> {
  const store = await ctx.db.get(storeId);
  if (!store) throw new Error(`reseedStoreReporting: unknown store ${storeId}`);

  if (cursor.phase === "done") {
    return {
      cursor: null,
      datesTouched: [],
      docsScanned: 0,
      factsRecorded: 0,
      phase: "done",
      rowsPurged: 0,
    };
  }

  if (cursor.phase === "purge") {
    const table = RESEED_PURGE_TABLES[cursor.purgeTableIndex];
    if (table === undefined) {
      return {
        cursor: { pageCursor: null, phase: "pos_sale", purgeTableIndex: 0 },
        datesTouched: [],
        docsScanned: 0,
        factsRecorded: 0,
        phase: "purge",
        rowsPurged: 0,
      };
    }

    const rowsPurged = await purgeBatch(ctx, storeId, table);
    // A full batch means there is probably more of this table left; a short
    // one means it is drained and the next table can start.
    const purgeTableIndex =
      rowsPurged === RESEED_PURGE_BATCH
        ? cursor.purgeTableIndex
        : cursor.purgeTableIndex + 1;
    const exhausted = purgeTableIndex >= RESEED_PURGE_TABLES.length;

    return {
      cursor: {
        pageCursor: null,
        phase: exhausted ? "pos_sale" : "purge",
        purgeTableIndex: exhausted ? 0 : purgeTableIndex,
      },
      datesTouched: [],
      docsScanned: 0,
      factsRecorded: 0,
      phase: "purge",
      rowsPurged,
    };
  }

  const outcome = await walkPhase(
    ctx,
    storeId,
    store.currency,
    cursor.phase,
    cursor.pageCursor,
  );

  // `recordFacts` already dirties every day a fact landed on other than the
  // current one. The explicit reseed marks below are belt-and-braces: they
  // cover the current day (which `recordFacts` marks `day_open`, a reason the
  // sweeper honours but which says nothing about a rebuild) and they survive
  // the containment path, where a failed batch degrades to `write_failure`.
  // Stamp business time as `recordedAt`: a re-derived historical fact must not
  // postdate its day's close, or every reseeded day would fold as `amended`
  // (see NewReportFact.recordedAt in the contract).
  await recordFacts(
    ctx,
    storeId,
    outcome.facts.map((fact) => ({
      ...fact,
      recordedAt: fact.recordedAt ?? fact.occurredAt,
    })),
  );

  const datesTouched = new Set<string>();
  for (const fact of outcome.facts) {
    datesTouched.add(await resolveOperatingDate(ctx, storeId, fact.occurredAt));
  }
  for (const operatingDate of datesTouched) {
    await markReseedDirty(ctx, storeId, operatingDate);
  }

  return {
    cursor: {
      pageCursor: outcome.isDone ? null : outcome.continueCursor,
      phase: outcome.isDone ? nextWalkPhase(cursor.phase) : cursor.phase,
      purgeTableIndex: 0,
    },
    datesTouched: [...datesTouched],
    docsScanned: outcome.docsScanned,
    factsRecorded: outcome.facts.length,
    phase: cursor.phase,
    rowsPurged: 0,
  };
}

/**
 * Self-reference for the continuation chain.
 *
 * Built by path rather than read off `internal.reports.reseed` because
 * `convex/_generated/api.d.ts` is regenerated at deploy time and currently
 * predates this module (the same staleness makes `internal.reports.sweeper` in
 * convex/crons.ts fail to typecheck). The path string is what the runtime uses
 * either way; once codegen has run this can become `internal.reports.reseed.
 * reseedStoreReporting` with no behaviour change.
 */
const RESEED_SELF_REF = makeFunctionReference<
  "mutation",
  { cursor?: ReseedCursor; storeId: Id<"store"> }
>("reports/reseed:reseedStoreReporting");

/**
 * Rebuild `storeId`'s reporting layer from domain sources.
 *
 * Call with no cursor to start: the first invocation begins the purge, and the
 * mutation self-schedules until the walk completes. Internal-only — this
 * deletes every derived reporting row for a store and is an operator action,
 * not a product feature.
 */
export const reseedStoreReporting = internalMutation({
  args: {
    cursor: v.optional(reseedCursorValidator),
    storeId: v.id("store"),
  },
  handler: async (ctx, args): Promise<ReseedProgress> => {
    const cursor = normalizeReseedCursor(args.cursor);
    const progress = await reseedStep(ctx, args.storeId, cursor);

    if (progress.cursor !== null) {
      await ctx.scheduler.runAfter(0, RESEED_SELF_REF, {
        cursor: progress.cursor,
        storeId: args.storeId,
      });
    }

    return progress;
  },
});
