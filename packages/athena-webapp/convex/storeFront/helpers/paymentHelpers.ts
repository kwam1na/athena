import { Id } from "../../_generated/dataModel";
import { getDiscountValue, getOrderAmount } from "../../inventory/utils";
import { toV2Config } from "../../inventory/storeConfigV2";
import { OrderItem } from "../../types/payment";
import { PAYMENT_CONSTANTS } from "../../constants/payment";

type CheckoutProductInput = {
  productId: Id<"product">;
  productSku: string;
  productSkuId: Id<"productSku">;
  quantity: number;
  price: number;
};

type ServerProductSku = {
  _id: Id<"productSku">;
  price: number;
  productId: Id<"product">;
  sku?: string;
};

type DeliveryOption = "within-accra" | "outside-accra" | "intl";

type RefundableOrder = {
  amount: number;
  deliveryFee?: number | null;
  paymentDue?: number;
  refunds?: Array<{ amount: number }>;
};

const DEFAULT_WITHIN_ACCRA_FEE = 3000;
const DEFAULT_OTHER_REGIONS_FEE = 7000;
const DEFAULT_INTERNATIONAL_FEE = 80000;

export function calculateItemsSubtotal(
  items: Array<{ price: number; quantity: number }>,
): number {
  return Math.round(
    items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  );
}

export function buildServerPricedCheckoutProducts(params: {
  products: CheckoutProductInput[];
  productSkus: ServerProductSku[];
}): {
  missingProductSkuIds: Id<"productSku">[];
  products: CheckoutProductInput[];
  subtotal: number;
} {
  const productSkuById = new Map(
    params.productSkus.map((sku) => [sku._id, sku]),
  );
  const missingProductSkuIds: Id<"productSku">[] = [];
  const products: CheckoutProductInput[] = [];

  for (const product of params.products) {
    const productSku = productSkuById.get(product.productSkuId);

    if (!productSku) {
      missingProductSkuIds.push(product.productSkuId);
      continue;
    }

    products.push({
      ...product,
      price: Math.round(productSku.price),
      productId: productSku.productId,
      productSku: productSku.sku ?? product.productSku,
    });
  }

  return {
    missingProductSkuIds,
    products,
    subtotal: calculateItemsSubtotal(products),
  };
}

function normalizeDeliveryOption(value: unknown): DeliveryOption | null {
  if (
    value === "within-accra" ||
    value === "outside-accra" ||
    value === "intl"
  ) {
    return value;
  }

  return null;
}

function deriveDeliveryOptionFromAddress(deliveryDetails: unknown): DeliveryOption | null {
  if (!deliveryDetails || typeof deliveryDetails !== "object") {
    return null;
  }

  const details = deliveryDetails as { country?: string; region?: string };

  if (details.country && details.country !== "GH") {
    return "intl";
  }

  if (details.country === "GH") {
    return details.region === "GA" ? "within-accra" : "outside-accra";
  }

  return null;
}

function isDeliveryFeeWaived(params: {
  deliveryOption: DeliveryOption;
  storeConfig: unknown;
  subtotal: number;
}): boolean {
  const waiveDeliveryFees = toV2Config(params.storeConfig).commerce
    .waiveDeliveryFees;

  if (waiveDeliveryFees === true) {
    return true;
  }

  if (!waiveDeliveryFees || typeof waiveDeliveryFees !== "object") {
    return false;
  }

  const minimumOrderAmount = waiveDeliveryFees.minimumOrderAmount;
  const meetsMinimum =
    !minimumOrderAmount ||
    minimumOrderAmount <= 0 ||
    params.subtotal >= minimumOrderAmount;

  if (!meetsMinimum) {
    return false;
  }

  if (waiveDeliveryFees.all) {
    return true;
  }

  if (params.deliveryOption === "within-accra") {
    return waiveDeliveryFees.withinAccra === true;
  }

  if (params.deliveryOption === "outside-accra") {
    return waiveDeliveryFees.otherRegions === true;
  }

  return waiveDeliveryFees.international === true;
}

export function resolveServerDeliveryFee(params: {
  deliveryDetails?: unknown;
  deliveryMethod?: string | null;
  deliveryOption?: string | null;
  storeConfig: unknown;
  subtotal: number;
}): number | null {
  if (params.deliveryMethod === "pickup") {
    return 0;
  }

  if (params.deliveryMethod !== "delivery") {
    return null;
  }

  const providedDeliveryOption = normalizeDeliveryOption(params.deliveryOption);
  const derivedDeliveryOption = deriveDeliveryOptionFromAddress(
    params.deliveryDetails,
  );

  if (!derivedDeliveryOption) {
    return null;
  }

  if (
    providedDeliveryOption &&
    providedDeliveryOption !== derivedDeliveryOption
  ) {
    return null;
  }

  const deliveryOption = derivedDeliveryOption;

  if (
    isDeliveryFeeWaived({
      deliveryOption,
      storeConfig: params.storeConfig,
      subtotal: params.subtotal,
    })
  ) {
    return 0;
  }

  const deliveryFees = toV2Config(params.storeConfig).commerce.deliveryFees;

  if (deliveryOption === "within-accra") {
    return deliveryFees.withinAccra ?? DEFAULT_WITHIN_ACCRA_FEE;
  }

  if (deliveryOption === "outside-accra") {
    return deliveryFees.otherRegions ?? DEFAULT_OTHER_REGIONS_FEE;
  }

  return deliveryFees.international ?? DEFAULT_INTERNATIONAL_FEE;
}

export function getRemainingRefundableBalance(order: RefundableOrder): number {
  const paidAmount = Math.round(
    order.paymentDue ?? order.amount + (order.deliveryFee ?? 0),
  );
  const refundedAmount = Math.round(
    order.refunds?.reduce((sum, refund) => sum + refund.amount, 0) ?? 0,
  );

  return Math.max(paidAmount - refundedAmount, 0);
}

export function resolveRefundAmount(params: {
  requestedAmount?: number;
  remainingRefundableBalance: number;
}): number {
  if (params.requestedAmount === undefined) {
    return params.remainingRefundableBalance;
  }

  if (!Number.isInteger(params.requestedAmount) || params.requestedAmount <= 0) {
    throw new Error("Refund amount must be a positive integer minor-unit amount.");
  }

  if (params.requestedAmount > params.remainingRefundableBalance) {
    throw new Error("Refund amount exceeds the remaining refundable balance.");
  }

  return params.requestedAmount;
}

/**
 * Generate a Payment on Delivery reference
 */
export function generatePODReference(
  checkoutSessionId: Id<"checkoutSession">
): string {
  return `POD-${Date.now()}-${checkoutSessionId}`;
}

/**
 * Extract order items from session or order data
 */
export function extractOrderItems(
  items: Array<{
    productSkuId: Id<"productSku">;
    quantity: number;
    price: number;
  }>
): OrderItem[] {
  return items.map((item) => ({
    productSkuId: item.productSkuId,
    quantity: item.quantity,
    price: item.price,
  }));
}

/**
 * Calculate the total order amount including discounts and fees
 */
export function calculateOrderAmount(params: {
  items: OrderItem[];
  discount: any;
  deliveryFee: number;
  subtotal: number;
}): number {
  return getOrderAmount({
    items: params.items,
    discount: params.discount
      ? { ...params.discount, totalDiscount: undefined }
      : params.discount,
    deliveryFee: params.deliveryFee,
    subtotal: params.subtotal,
  });
}

/**
 * Calculate reward points for an order
 * 1 point per GH₵10 spent (pesewas amount / 1000)
 */
export function calculateRewardPoints(amount: number): number {
  const pointsToAward = amount / PAYMENT_CONSTANTS.POINTS_DIVISOR;
  return Math.floor(pointsToAward);
}

/**
 * Validate that the payment amount matches the expected order amount
 */
export function validatePaymentAmount(params: {
  paystackAmount: number;
  orderAmount: number;
  paystackStatus: string;
}): boolean {
  return (
    params.paystackStatus === "success" &&
    params.paystackAmount === params.orderAmount
  );
}

/**
 * Get the discount value for an order
 */
export function getOrderDiscountValue(
  items: OrderItem[],
  discount: any
): number {
  return getDiscountValue(
    items,
    discount ? { ...discount, totalDiscount: undefined } : discount,
  );
}
