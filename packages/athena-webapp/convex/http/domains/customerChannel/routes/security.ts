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
  requestUserId: string | null | undefined,
): boolean {
  if (!resourceOwnerId || !requestUserId) {
    return false;
  }

  return resourceOwnerId === requestUserId;
}

export function buildCanonicalCheckoutProducts(items: BagCheckoutItem[]): {
  products: CanonicalCheckoutProduct[];
  amount: number; // in pesewas
} {
  const products = items.map((item) => ({
    productId: item.productId,
    productSku: item.productSku,
    productSkuId: item.productSkuId,
    quantity: item.quantity,
    price: item.price,
  }));

  const amount = products.reduce(
    (total, item) => total + item.price * item.quantity,
    0,
  );

  return {
    products,
    amount, // prices are already in pesewas
  };
}

export function isAmountTampered(
  expectedAmount: number,
  providedAmount: number | undefined | null,
): boolean {
  if (providedAmount === undefined || providedAmount === null) {
    return false;
  }

  return Math.abs(expectedAmount - providedAmount) > 0.0001;
}

export function isDuplicateChargeSuccess(
  input: DuplicateChargeSuccessInput,
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

/**
 * Constant-time comparison of two equal-length hex strings. Avoids leaking
 * information about how much of a forged signature matched via timing.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return mismatch === 0;
}

/**
 * Compute the Paystack webhook signature (HMAC-SHA512 of the raw request body,
 * hex-encoded). Uses Web Crypto so it runs in the Convex HTTP action runtime,
 * which does not expose `node:crypto`.
 */
export async function computePaystackSignature(
  payload: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );

  return Array.from(new Uint8Array(signatureBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify a Paystack `x-paystack-signature` header against the raw payload.
 */
export async function isValidPaystackSignature(
  payload: string,
  secret: string,
  signature: string
): Promise<boolean> {
  const computedSignature = await computePaystackSignature(payload, secret);
  return timingSafeEqualHex(computedSignature, signature.toLowerCase());
}
