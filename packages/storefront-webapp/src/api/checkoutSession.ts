import config from "@/config";
import { CheckoutSession, ProductSku } from "@athena/webapp";
import { postAnalytics } from "./analytics";

const getBaseUrl = () => `${config.apiGateway.URL}/checkout`;

export async function createCheckoutSession({
  bagId,
  bagItems,
  bagSubtotal,
}: {
  bagId: string;
  bagItems: {
    quantity: number;
    productSkuId: string;
    productSku: string;
    productId: string;
  }[];
  bagSubtotal: number;
}) {
  const response = await fetch(getBaseUrl(), {
    method: "POST",
    body: JSON.stringify({
      bagId,
      products: bagItems,
      amount: bagSubtotal,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error("Error initializing checkout session");
  }

  return res;
}

export async function getActiveCheckoutSession(): Promise<CheckoutSession | null> {
  const response = await fetch(`${getBaseUrl()}/active`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error("Error loading active session.");
  }

  return res;
}

export async function getPendingCheckoutSessions(): Promise<CheckoutSession[]> {
  const response = await fetch(`${getBaseUrl()}/pending`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading active session.");
  }

  return res;
}

export async function getCheckoutSession(
  sessionId: string
): Promise<CheckoutSession & { items: ProductSku[] }> {
  const response = await fetch(`${getBaseUrl()}/${sessionId}`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading session.");
  }

  return res;
}

export async function updateCheckoutSession({
  action,
  sessionId,
  isFinalizingPayment,
  hasCompletedCheckoutSession,
  externalReference,
  customerEmail,
  amount,
  orderDetails,
  placedOrderId,
}: {
  action:
    | "finalize-payment"
    | "complete-checkout"
    | "place-order"
    | "update-order"
    | "cancel-order";
  sessionId: string;
  isFinalizingPayment?: boolean;
  hasCompletedCheckoutSession?: boolean;
  externalReference?: string;
  customerEmail?: string;
  amount?: number;
  orderDetails?: any;
  placedOrderId?: string;
}) {
  const response = await fetch(`${getBaseUrl()}/${sessionId}`, {
    method: "POST",
    body: JSON.stringify({
      action,
      isFinalizingPayment,
      customerEmail,
      amount,
      externalReference,
      hasCompletedCheckoutSession,
      orderDetails,
      placedOrderId,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error updating checkout session.");
  }

  return res;
}

export async function verifyCheckoutSessionPayment({
  externalReference,
}: {
  externalReference: string;
}) {
  const response = await fetch(`${getBaseUrl()}/verify/${externalReference}`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading active session.");
  }

  return res;
}
