import { toDisplayAmount } from "~/convex/lib/currency";
import { parseDisplayAmountInput } from "~/src/lib/pos/displayAmounts";
import { PAYSTACK_PROCESSING_FEE } from "~/src/lib/constants";
import type { Id } from "~/convex/_generated/dataModel";
import type { ProductVariant } from "./ProductStock";
import type { CommandResult } from "~/shared/commandResult";

export type ProductVariantInputField =
  | "sku"
  | "barcode"
  | "stock"
  | "cost"
  | "netPrice"
  | "quantityAvailable";

export type StockInputUpdate = {
  stock?: number;
  quantityAvailable?: number;
};

export function parseVariantInputValue(
  field: ProductVariantInputField,
  rawValue: string,
): string | number | undefined {
  if (field === "sku" || field === "barcode") {
    return rawValue;
  }

  if (rawValue.trim().length === 0) {
    return undefined;
  }

  if (field === "cost" || field === "netPrice") {
    const parsedAmount = parseDisplayAmountInput(rawValue);
    return parsedAmount === undefined
      ? undefined
      : toDisplayAmount(parsedAmount);
  }

  return Number.parseFloat(rawValue);
}

export function resolveStockInputUpdate(
  stock: StockInputUpdate["stock"],
): StockInputUpdate {
  return {
    stock,
    quantityAvailable: stock,
  };
}

export type TrustedInventoryReviewClickAction =
  | "make_visible"
  | "refresh_review"
  | "finalize"
  | "none";

export function resolveTrustedInventoryReviewClickAction({
  requiresReviewRefresh,
  reviewState,
}: {
  requiresReviewRefresh?: boolean;
  reviewState: Pick<TrustedInventoryReviewState, "action">;
}): TrustedInventoryReviewClickAction {
  if (requiresReviewRefresh) {
    return "refresh_review";
  }

  if (reviewState.action === "make_visible") {
    return "make_visible";
  }

  if (reviewState.action === "finalize") {
    return "finalize";
  }

  return "none";
}

export function resolveTrustedInventoryCommandError(
  result: Exclude<CommandResult<unknown>, { kind: "ok" }>,
): { message: string; requiresReviewRefresh: boolean } {
  if (result.error.code === "authorization_failed") {
    return {
      message:
        "Inventory import permission is required to finalize trusted inventory.",
      requiresReviewRefresh: false,
    };
  }

  const message = result.error.message.toLowerCase();
  if (message.includes("reservation") || message.includes("hold")) {
    return {
      message: "Clear active reservations before finalizing this SKU.",
      requiresReviewRefresh: false,
    };
  }

  if (
    message.includes("sale evidence") ||
    message.includes("provisional sales") ||
    message.includes("stale") ||
    message.includes("fingerprint")
  ) {
    return {
      message:
        "Provisional sales changed. Refresh and review the counts again.",
      requiresReviewRefresh: true,
    };
  }

  if (result.error.code === "conflict") {
    return {
      message:
        "Trusted inventory was not finalized. Refresh the product and try again.",
      requiresReviewRefresh: false,
    };
  }

  return {
    message: result.error.message || "Trusted inventory was not finalized.",
    requiresReviewRefresh: false,
  };
}

export function resolveTrustedInventoryRefreshReviewState({
  conversionRequestIds,
  refreshNonce,
  variantId,
}: {
  conversionRequestIds: Record<string, string>;
  refreshNonce: number;
  variantId: string;
}): {
  conversionRequestIds: Record<string, string>;
  refreshNonce: number;
} {
  const nextConversionRequestIds = { ...conversionRequestIds };
  delete nextConversionRequestIds[variantId];

  return {
    conversionRequestIds: nextConversionRequestIds,
    refreshNonce: refreshNonce + 1,
  };
}

export function resolveTrustedInventoryFinalizationPricingPolicy({
  persistedAreProcessingFeesAbsorbed,
}: {
  persistedAreProcessingFeesAbsorbed?: boolean;
}) {
  return persistedAreProcessingFeesAbsorbed;
}

export type PendingCheckoutSkuLinkPriceState =
  | {
      canLink: true;
      status: "match";
      message: string;
    }
  | {
      canLink: false;
      status: "mismatch" | "unknown";
      message: string;
    };

export function resolvePendingCheckoutSkuLinkPriceState({
  pendingStoredPrice,
  trustedSkuStoredPrice,
}: {
  pendingStoredPrice: number | null | undefined;
  trustedSkuStoredPrice: number | null | undefined;
}): PendingCheckoutSkuLinkPriceState {
  if (
    typeof pendingStoredPrice !== "number" ||
    !Number.isFinite(pendingStoredPrice) ||
    typeof trustedSkuStoredPrice !== "number" ||
    !Number.isFinite(trustedSkuStoredPrice)
  ) {
    return {
      canLink: false,
      status: "unknown",
      message: "Price unavailable",
    };
  }

  if (pendingStoredPrice !== trustedSkuStoredPrice) {
    return {
      canLink: false,
      status: "mismatch",
      message: "Price differs from pending item",
    };
  }

  return {
    canLink: true,
    status: "match",
    message: "Price matches",
  };
}

export type ProductPageProvisionalSkuBinding =
  | {
      state: "none";
      message?: string;
    }
  | {
      state: "ambiguous";
      message?: string;
      activeRowCount?: number;
    }
  | {
      state: "unauthorized";
      message?: string;
    }
  | {
      state: "unique";
      activeRowCount: 1;
      row: {
        _id: Id<"inventoryImportProvisionalSku"> | Id<"posPendingCheckoutItem">;
        importKey: string;
        finalizedAt?: number;
        importedQuantity: number;
        lastSoldAt?: number;
        linkedTarget?: {
          isArchived?: boolean;
          price?: number;
          productId: Id<"product">;
          productName: string;
          quantityAvailable?: number;
          sku?: string;
          skuId: Id<"productSku">;
        };
        provisionalSoldQuantity: number;
        rowNumber: number;
        saleCount: number;
        status?:
          | "active"
          | "finalized"
          | "rejected"
          | "closed"
          | "pending_review"
          | "flagged"
          | "linked_to_catalog";
      };
      saleEvidenceFingerprint: string;
      trustedSkuFingerprint: string;
    };

export type TrustedInventoryReviewAction =
  | "make_visible"
  | "finalize"
  | "refresh"
  | "none";

export type TrustedInventoryReviewState = {
  action: TrustedInventoryReviewAction;
  ctaLabel: string;
  disabled: boolean;
  message: string;
  status: "blocked" | "pending" | "ready" | "success";
};

export type TrustedInventoryReviewStateInput = {
  binding?: ProductPageProvisionalSkuBinding;
  finalized?: boolean;
  isFinalizing?: boolean;
  isRefreshing?: boolean;
  reservationType?: "checkout" | "pos" | null;
  variant: Pick<
    ProductVariant,
    | "cost"
    | "existsInDB"
    | "id"
    | "isVisible"
    | "posVisible"
    | "netPrice"
    | "price"
    | "quantityAvailable"
    | "stock"
  >;
};

export type TrustedInventoryFinalizationPayload = {
  storeId: Id<"store">;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  provisionalSkuId:
    | Id<"inventoryImportProvisionalSku">
    | Id<"posPendingCheckoutItem">;
  conversionRequestId: string;
  saleEvidenceFingerprint: string;
  trustedSkuFingerprint: string;
  reviewedInventoryCount: number;
  reviewedQuantityAvailable: number;
  reviewedPrice: number;
  reviewedNetPrice?: number;
  reviewedUnitCost?: number;
  reviewedIsVisible: boolean;
  reviewedPosVisible: boolean;
  sourceSurface: "product_edit";
};

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= 0
  );
}

export function getTrustedInventoryReviewValidationMessage(
  variant: TrustedInventoryReviewStateInput["variant"],
): string | null {
  if (!isNonNegativeInteger(variant.stock)) {
    return "Stock must be a whole number.";
  }

  if (!isNonNegativeInteger(variant.quantityAvailable)) {
    return "Quantity available must be a whole number.";
  }

  if (variant.quantityAvailable > variant.stock) {
    return "Quantity available cannot exceed stock.";
  }

  const displayPrice = variant.netPrice ?? variant.price;
  if (typeof displayPrice !== "number" || displayPrice <= 0) {
    return "Price is required before finalizing trusted inventory.";
  }

  if (variant.cost !== undefined && variant.cost < 0) {
    return "Cost cannot be negative.";
  }

  return null;
}

export function resolveTrustedInventoryReviewState({
  binding,
  finalized,
  isFinalizing,
  isRefreshing,
  reservationType,
  variant,
}: TrustedInventoryReviewStateInput): TrustedInventoryReviewState {
  if (finalized) {
    return {
      action: "none",
      ctaLabel: "Trusted inventory finalized",
      disabled: true,
      message: "Trusted inventory finalized.",
      status: "success",
    };
  }

  if (isFinalizing) {
    return {
      action: "none",
      ctaLabel: "Finalizing...",
      disabled: true,
      message: "Finalizing this SKU as trusted inventory.",
      status: "pending",
    };
  }

  if (isRefreshing) {
    return {
      action: "none",
      ctaLabel: "Finalize trusted inventory",
      disabled: true,
      message: "Refreshing product inventory state.",
      status: "blocked",
    };
  }

  if (
    binding?.state === "unique" &&
    binding.row.status === "linked_to_catalog"
  ) {
    return {
      action: "none",
      ctaLabel: "Linked to SKU",
      disabled: true,
      message: "Pending checkout item is linked to a SKU.",
      status: "success",
    };
  }

  if (variant.posVisible === false) {
    return {
      action: "make_visible",
      ctaLabel: "Make SKU available in POS",
      disabled: false,
      message:
        "Make this SKU available in POS before reviewing trusted inventory.",
      status: "blocked",
    };
  }

  if (reservationType === "checkout") {
    return {
      action: "none",
      ctaLabel: "Finalize trusted inventory",
      disabled: true,
      message: "Clear active checkout reservations before finalizing this SKU.",
      status: "blocked",
    };
  }

  if (reservationType === "pos") {
    return {
      action: "none",
      ctaLabel: "Finalize trusted inventory",
      disabled: true,
      message: "Clear active POS holds before finalizing this SKU.",
      status: "blocked",
    };
  }

  if (!variant.existsInDB) {
    return {
      action: "none",
      ctaLabel: "Finalize trusted inventory",
      disabled: true,
      message: "Save this SKU before finalizing trusted inventory.",
      status: "blocked",
    };
  }

  if (!binding) {
    return {
      action: "none",
      ctaLabel: "Finalize trusted inventory",
      disabled: true,
      message: "Loading the linked import row.",
      status: "blocked",
    };
  }

  if (binding.state === "none") {
    return {
      action: "none",
      ctaLabel: "Review import source",
      disabled: true,
      message: "No active provisional import row is linked to this SKU.",
      status: "blocked",
    };
  }

  if (binding.state === "ambiguous") {
    return {
      action: "none",
      ctaLabel: "Review import source",
      disabled: true,
      message:
        "Multiple active provisional rows are linked to this SKU. Resolve the import rows before finalizing.",
      status: "blocked",
    };
  }

  if (binding.state === "unauthorized") {
    return {
      action: "none",
      ctaLabel: "Finalize trusted inventory",
      disabled: true,
      message:
        binding.message ??
        "Inventory import permission is required to finalize trusted inventory.",
      status: "blocked",
    };
  }

  const validationMessage = getTrustedInventoryReviewValidationMessage(variant);
  if (validationMessage) {
    return {
      action: "none",
      ctaLabel: "Finalize trusted inventory",
      disabled: true,
      message: validationMessage,
      status: "blocked",
    };
  }

  return {
    action: "finalize",
    ctaLabel: "Finalize trusted inventory",
    disabled: false,
    message: "Review stock, quantity, price, and cost before finalizing.",
    status: "ready",
  };
}

export function parseVariantDisplayMoney(value?: number): number {
  if (value === undefined) {
    return 0;
  }

  return parseDisplayAmountInput(String(value)) ?? 0;
}

export function buildTrustedInventoryMoneyPayload(
  variant: Pick<ProductVariant, "cost" | "netPrice">,
  areProcessingFeesAbsorbed?: boolean,
): { netPrice: number; price: number; unitCost: number } {
  const netPrice = parseVariantDisplayMoney(variant.netPrice);
  const netPriceDisplay = toDisplayAmount(netPrice);
  const processingFee = (netPriceDisplay * PAYSTACK_PROCESSING_FEE) / 100;

  const priceDisplay = areProcessingFeesAbsorbed
    ? netPriceDisplay
    : Math.round(netPriceDisplay + processingFee);

  return {
    netPrice,
    price: parseDisplayAmountInput(String(priceDisplay)) ?? 0,
    unitCost: parseVariantDisplayMoney(variant.cost),
  };
}

export function buildTrustedInventoryFinalizationPayload({
  areProcessingFeesAbsorbed,
  binding,
  conversionRequestId,
  productId,
  storeId,
  variant,
}: {
  areProcessingFeesAbsorbed?: boolean;
  binding: Extract<ProductPageProvisionalSkuBinding, { state: "unique" }>;
  conversionRequestId: string;
  productId: Id<"product">;
  storeId: Id<"store">;
  variant: ProductVariant;
}): TrustedInventoryFinalizationPayload {
  const validationMessage = getTrustedInventoryReviewValidationMessage(variant);
  if (validationMessage) {
    throw new Error(validationMessage);
  }

  const moneyPayload = buildTrustedInventoryMoneyPayload(
    variant,
    areProcessingFeesAbsorbed,
  );

  return {
    storeId,
    productId,
    productSkuId: variant.id as Id<"productSku">,
    provisionalSkuId: binding.row._id,
    conversionRequestId,
    saleEvidenceFingerprint: binding.saleEvidenceFingerprint,
    trustedSkuFingerprint: binding.trustedSkuFingerprint,
    reviewedInventoryCount: variant.stock!,
    reviewedQuantityAvailable: variant.quantityAvailable!,
    reviewedPrice: moneyPayload.price,
    reviewedNetPrice: moneyPayload.netPrice,
    reviewedUnitCost: moneyPayload.unitCost,
    reviewedIsVisible: variant.isVisible !== false,
    reviewedPosVisible: variant.posVisible !== false,
    sourceSurface: "product_edit",
  };
}
