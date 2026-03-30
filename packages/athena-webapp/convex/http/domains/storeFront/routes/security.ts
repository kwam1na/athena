import { createHmac, timingSafeEqual } from "crypto";

type BagCheckoutItem = {
  productId: string;
  productSku: string;
  productSkuId: string;
  quantity: number;
  price: number;
};

type CanonicalCheckoutProduct = {
  productId: string;
  productSku: string;
  productSkuId: string;
  quantity: number;
  price: number;
};

type DuplicateChargeSuccessInput = {
  hasCompletedPayment: boolean;
  placedOrderId?: string;
  hasExistingOrder: boolean;
  incomingTransactionId?: string;
  existingTransactionId?: string;
};

export function hasValidPositiveQuantity(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function isAuthorizedResourceOwner(
  resourceOwnerId: string | null | undefined,
  requestUserId: string | null | undefined
): boolean {
  if (!resourceOwnerId || !requestUserId) {
    return false;
  }

  return resourceOwnerId === requestUserId;
}

export function buildCanonicalCheckoutProducts(items: BagCheckoutItem[]): {
  products: CanonicalCheckoutProduct[];
  amount: number;
} {
  const products = items.map((item) => ({
    productId: item.productId,
    productSku: item.productSku,
    productSkuId: item.productSkuId,
    quantity: item.quantity,
    price: item.price,
  }));

  const rawAmount = products.reduce(
    (total, item) => total + item.price * item.quantity,
    0
  );

  return {
    products,
    amount: Math.round(rawAmount * 100) / 100,
  };
}

export function isAmountTampered(
  expectedAmount: number,
  providedAmount: number | undefined | null
): boolean {
  if (providedAmount === undefined || providedAmount === null) {
    return false;
  }

  return Math.abs(expectedAmount - providedAmount) > 0.0001;
}

export function isDuplicateChargeSuccess(
  input: DuplicateChargeSuccessInput
): boolean {
  if (input.hasCompletedPayment || Boolean(input.placedOrderId)) {
    return true;
  }

  if (input.hasExistingOrder) {
    return true;
  }

  if (
    input.incomingTransactionId &&
    input.existingTransactionId &&
    input.incomingTransactionId === input.existingTransactionId
  ) {
    return true;
  }

  return false;
}

export function isValidPaystackSignature(
  payload: string,
  secret: string
): { computedSignature: string };
export function isValidPaystackSignature(
  payload: string,
  secret: string,
  signature: string
): boolean;
export function isValidPaystackSignature(
  payload: string,
  secret: string,
  signature?: string
): { computedSignature: string } | boolean {
  const computedSignature = createHmac("sha512", secret)
    .update(payload)
    .digest("hex");

  if (signature === undefined) {
    return { computedSignature };
  }

  if (computedSignature.length !== signature.length) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(computedSignature, "utf8"),
    Buffer.from(signature, "utf8")
  );
}
