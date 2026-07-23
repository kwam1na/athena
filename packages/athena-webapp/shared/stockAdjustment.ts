export const STOCK_ADJUSTMENT_APPROVAL_THRESHOLD = 5;

export const MANUAL_STOCK_ADJUSTMENT_REASON_CODES = [
  "correction",
  "damage",
  "shrinkage",
  "vendor_return",
] as const;

export const CYCLE_COUNT_REASON_CODE = "cycle_count_reconciliation" as const;

type StockAdjustmentType = "manual" | "cycle_count";

export function calculateCycleCountQuantityDelta(args: {
  countedQuantity: number;
  systemQuantity: number;
}) {
  if (args.countedQuantity < 0) {
    throw new Error("Cycle-count quantities cannot be negative.");
  }

  return args.countedQuantity - args.systemQuantity;
}

export function assertStockAdjustmentReasonCode(
  adjustmentType: StockAdjustmentType,
  reasonCode: string,
) {
  if (
    adjustmentType === "manual" &&
    !MANUAL_STOCK_ADJUSTMENT_REASON_CODES.includes(
      reasonCode as (typeof MANUAL_STOCK_ADJUSTMENT_REASON_CODES)[number],
    )
  ) {
    throw new Error(
      "Manual stock adjustments require a supported reason code.",
    );
  }

  if (
    adjustmentType === "cycle_count" &&
    reasonCode !== CYCLE_COUNT_REASON_CODE
  ) {
    throw new Error(
      "Cycle counts must reconcile with the cycle-count reason code.",
    );
  }
}

export function resolveStockAdjustmentQuantityDelta(args: {
  adjustmentType: StockAdjustmentType;
  countedQuantity?: number;
  quantityDelta?: number;
  systemQuantity: number;
}): number {
  if (args.adjustmentType === "cycle_count") {
    if (
      args.countedQuantity === undefined ||
      !Number.isInteger(args.countedQuantity)
    ) {
      throw new Error(
        "Cycle counts require an integer counted quantity for every selected SKU.",
      );
    }

    return calculateCycleCountQuantityDelta({
      countedQuantity: args.countedQuantity,
      systemQuantity: args.systemQuantity,
    });
  }

  if (
    args.quantityDelta === undefined ||
    !Number.isInteger(args.quantityDelta)
  ) {
    throw new Error(
      "Manual stock adjustments require a whole-unit delta for every selected SKU.",
    );
  }

  return args.quantityDelta;
}

export function summarizeStockAdjustmentLineItems(
  lineItems: Array<{ quantityDelta: number }>,
) {
  return lineItems.reduce(
    (summary, lineItem) => ({
      largestAbsoluteDelta: Math.max(
        summary.largestAbsoluteDelta,
        Math.abs(lineItem.quantityDelta),
      ),
      lineItemCount: summary.lineItemCount + 1,
      netQuantityDelta: summary.netQuantityDelta + lineItem.quantityDelta,
    }),
    {
      largestAbsoluteDelta: 0,
      lineItemCount: 0,
      netQuantityDelta: 0,
    },
  );
}

export function hasHighStockAdjustmentVariance(args: {
  largestAbsoluteDelta: number;
}) {
  return args.largestAbsoluteDelta >= STOCK_ADJUSTMENT_APPROVAL_THRESHOLD;
}

/**
 * Manager approval for stock adjustments is intentionally disabled: every
 * batch — manual or cycle count, whatever the variance — posts straight to
 * inventory. High variance is still measured and surfaced via
 * `hasHighStockAdjustmentVariance` and reported on the batch, but it no longer
 * gates the write.
 *
 * This deliberately takes no arguments so no caller can be misled into thinking
 * adjustment type or variance size influences the outcome. To reinstate gating,
 * restore the inputs here and at the call site in
 * `convex/stockOps/adjustments.ts`.
 */
export function requiresStockAdjustmentApproval() {
  return false;
}
