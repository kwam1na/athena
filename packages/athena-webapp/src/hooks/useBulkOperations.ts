import { useState, useMemo, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { toPesewas, toDisplayAmount } from "~/convex/lib/currency";
import { PAYSTACK_PROCESSING_FEE } from "~/src/lib/constants";
import { toast } from "sonner";

// --- Types ---

export type BulkOperationType =
  | "multiply"
  | "divide"
  | "set"
  | "increase_percent"
  | "decrease_percent"
  | "increase_fixed"
  | "decrease_fixed";

export interface SkuRow {
  skuId: Id<"productSku">;
  productName: string;
  productCategory?: string;
  sku: string;
  colorName?: string;
  size?: string;
  length?: number;
  currentPricePesewas: number;
  currentNetPricePesewas: number;
  areProcessingFeesAbsorbed: boolean;
}

export interface PreviewRow extends SkuRow {
  newNetPricePesewas: number;
  newPricePesewas: number;
  hasWarning: boolean;
}

export const OPERATION_LABELS: Record<BulkOperationType, string> = {
  multiply: "Multiply by",
  divide: "Divide by",
  set: "Set to",
  increase_percent: "Increase by %",
  decrease_percent: "Decrease by %",
  increase_fixed: "Increase by fixed amount",
  decrease_fixed: "Decrease by fixed amount",
};

// --- Pure calculation functions (exported for testing) ---

/**
 * Apply a bulk operation to a display-amount price.
 * Input and output are in display units (e.g. GHS, not pesewas).
 * Returns the new display-amount, or null if the operation is invalid.
 */
export function applyOperation(
  operation: BulkOperationType,
  currentDisplayPrice: number,
  value: number
): number | null {
  switch (operation) {
    case "multiply":
      if (value <= 0) return null;
      return currentDisplayPrice * value;
    case "divide":
      if (value <= 0) return null;
      return currentDisplayPrice / value;
    case "set":
      return value;
    case "increase_percent":
      return currentDisplayPrice * (1 + value / 100);
    case "decrease_percent":
      return currentDisplayPrice * (1 - value / 100);
    case "increase_fixed":
      return currentDisplayPrice + value;
    case "decrease_fixed":
      return currentDisplayPrice - value;
    default:
      return null;
  }
}

/**
 * Calculate the final price (with processing fee) from a net price.
 * Both input and output are in display units.
 */
export function calculatePriceWithFee(
  netDisplayPrice: number,
  areProcessingFeesAbsorbed: boolean
): number {
  if (areProcessingFeesAbsorbed) {
    return netDisplayPrice;
  }
  const fee = (netDisplayPrice * PAYSTACK_PROCESSING_FEE) / 100;
  return Math.round(netDisplayPrice + fee);
}

/**
 * Compute preview rows from SKU data, an operation, and a value.
 */
export function computePreview(
  skus: SkuRow[],
  operation: BulkOperationType,
  value: number
): PreviewRow[] {
  return skus.map((sku) => {
    const currentNetDisplay = toDisplayAmount(sku.currentNetPricePesewas);
    const newNetDisplay = applyOperation(operation, currentNetDisplay, value);

    if (newNetDisplay === null) {
      return {
        ...sku,
        newNetPricePesewas: sku.currentNetPricePesewas,
        newPricePesewas: sku.currentPricePesewas,
        hasWarning: true,
      };
    }

    const newPriceDisplay = calculatePriceWithFee(
      newNetDisplay,
      sku.areProcessingFeesAbsorbed
    );

    const newNetPesewas = toPesewas(newNetDisplay);
    const newPricePesewas = toPesewas(newPriceDisplay);

    return {
      ...sku,
      newNetPricePesewas: newNetPesewas,
      newPricePesewas: newPricePesewas,
      hasWarning: newNetPesewas <= 0,
    };
  });
}

/**
 * Validate that the operation value is acceptable.
 */
export function validateOperationValue(
  operation: BulkOperationType,
  value: number
): string | null {
  if (isNaN(value)) return "Please enter a valid number";

  if (operation === "multiply" || operation === "divide") {
    if (value <= 0) return "Value must be greater than 0";
  }

  if (operation === "set" && value < 0) {
    return "Price cannot be negative";
  }

  return null;
}

// --- Hook ---

export function useBulkOperations() {
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [operation, setOperation] = useState<BulkOperationType>("multiply");
  const [operationValue, setOperationValue] = useState<string>("");
  const [excludedSkuIds, setExcludedSkuIds] = useState<Set<string>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  const [hasPreview, setHasPreview] = useState(false);

  const batchUpdateSkuPrices = useMutation(
    api.inventory.products.batchUpdateSkuPrices
  );

  const parsedValue = parseFloat(operationValue);
  const validationError = isNaN(parsedValue)
    ? operationValue.length > 0
      ? "Please enter a valid number"
      : null
    : validateOperationValue(operation, parsedValue);

  const previewRows = useMemo(() => {
    if (!hasPreview || isNaN(parsedValue) || validationError) return [];
    return computePreview(skus, operation, parsedValue);
  }, [skus, operation, parsedValue, hasPreview, validationError]);

  const selectedPreviewRows = useMemo(
    () => previewRows.filter((row) => !excludedSkuIds.has(row.skuId)),
    [previewRows, excludedSkuIds]
  );

  const validSelectedRows = useMemo(
    () => selectedPreviewRows.filter((row) => !row.hasWarning),
    [selectedPreviewRows]
  );

  const loadSkus = useCallback(
    (
      products: Array<{
        name: string;
        categoryName?: string;
        areProcessingFeesAbsorbed?: boolean;
        skus: Array<{
          _id: Id<"productSku">;
          sku?: string;
          colorName?: string;
          size?: string;
          length?: number;
          price: number;
          netPrice?: number;
        }>;
      }>
    ) => {
      const rows: SkuRow[] = products.flatMap((product) =>
        product.skus.map((sku) => ({
          skuId: sku._id,
          productName: product.name,
          productCategory: product.categoryName,
          sku: sku.sku || "",
          colorName: sku.colorName,
          size: sku.size,
          length: sku.length,
          currentPricePesewas: sku.price,
          currentNetPricePesewas: sku.netPrice ?? sku.price,
          areProcessingFeesAbsorbed: product.areProcessingFeesAbsorbed ?? true,
        }))
      );
      setSkus(rows);
      setExcludedSkuIds(new Set());
      setHasPreview(false);
    },
    []
  );

  const calculatePreview = useCallback(() => {
    setHasPreview(true);
  }, []);

  const toggleSkuExclusion = useCallback((skuId: string) => {
    setExcludedSkuIds((prev) => {
      const next = new Set(prev);
      if (next.has(skuId)) {
        next.delete(skuId);
      } else {
        next.add(skuId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setExcludedSkuIds(new Set());
  }, []);

  const deselectAll = useCallback(() => {
    setExcludedSkuIds(new Set(skus.map((s) => s.skuId)));
  }, [skus]);

  const applyChanges = useCallback(async () => {
    if (validSelectedRows.length === 0) return;

    setIsApplying(true);
    try {
      const updates = validSelectedRows.map((row) => ({
        id: row.skuId,
        price: row.newPricePesewas,
        netPrice: row.newNetPricePesewas,
      }));

      const result = await batchUpdateSkuPrices({ updates });

      if (result.success) {
        toast.success(
          `Updated ${result.updatedCount} SKU${result.updatedCount !== 1 ? "s" : ""} successfully`
        );
        // Reset state
        setSkus([]);
        setHasPreview(false);
        setOperationValue("");
        setExcludedSkuIds(new Set());
      } else {
        toast.error(
          `${result.updatedCount} updated, ${result.failedCount} failed`
        );
      }
    } catch (error) {
      toast.error("Failed to apply bulk update", {
        description: (error as Error).message,
      });
    } finally {
      setIsApplying(false);
    }
  }, [validSelectedRows, batchUpdateSkuPrices]);

  return {
    // State
    skus,
    operation,
    operationValue,
    excludedSkuIds,
    isApplying,
    hasPreview,
    previewRows,
    selectedPreviewRows,
    validSelectedRows,
    validationError,

    // Actions
    setOperation,
    setOperationValue,
    loadSkus,
    calculatePreview,
    toggleSkuExclusion,
    selectAll,
    deselectAll,
    applyChanges,
  };
}
