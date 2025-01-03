import config from "@/config";
import { Bag, CheckoutSession } from "@athena/webapp-2";

const getBaseUrl = (
  organizationId: string,
  storeId: string,
  customerId: string
) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/users/${customerId}/checkout`;

export async function createCheckoutSession({
  customerId,
  organizationId,
  storeId,
  bagId,
  bagItems,
  bagSubtotal,
}: {
  customerId: string;
  bagId: string;
  organizationId: string;
  storeId: string;
  bagItems: {
    quantity: number;
    productSkuId: string;
    productSku: string;
    productId: string;
  }[];
  bagSubtotal: number;
}) {
  const response = await fetch(
    getBaseUrl(organizationId, storeId, customerId),
    {
      method: "POST",
      body: JSON.stringify({
        storeId,
        bagId,
        customerId,
        products: bagItems,
        amount: bagSubtotal,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error("Error initializing checkout session");
  }

  return res;
}

export async function getActiveCheckoutSession({
  customerId,
  organizationId,
  storeId,
}: {
  customerId: string;
  organizationId: string;
  storeId: string;
}): Promise<CheckoutSession> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, customerId)}/active`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error("Error loading active session.");
  }

  return res;
}

export async function getPendingCheckoutSessions({
  customerId,
  organizationId,
  storeId,
}: {
  customerId: string;
  organizationId: string;
  storeId: string;
}): Promise<Bag> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, customerId)}/pending`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading active session.");
  }

  return res;
}

export async function getCheckoutSession({
  customerId,
  organizationId,
  sessionId,
  storeId,
}: {
  sessionId: string;
  customerId: string;
  organizationId: string;
  storeId: string;
}): Promise<Bag> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, customerId)}/${sessionId}`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading session.");
  }

  return res;
}

export async function updateCheckoutSession({
  action,
  organizationId,
  storeId,
  customerId,
  sessionId,
  isFinalizingPayment,
  hasCompletedCheckoutSession,
  externalReference,
  customerEmail,
  amount,
  orderDetails,
}: {
  action: "finalize-payment" | "complete-checkout" | "place-order";
  organizationId: string;
  storeId: string;
  customerId: string;
  sessionId: string;
  isFinalizingPayment?: boolean;
  hasCompletedCheckoutSession?: boolean;
  externalReference?: string;
  customerEmail?: string;
  amount?: number;
  orderDetails?: any;
}) {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, customerId)}/${sessionId}`,
    {
      method: "POST",
      body: JSON.stringify({
        action,
        isFinalizingPayment,
        customerEmail,
        amount,
        externalReference,
        hasCompletedCheckoutSession,
        orderDetails,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error updating.");
  }

  return res;
}

export async function verifyCheckoutSessionPayment({
  customerId,
  organizationId,
  storeId,
  externalReference,
}: {
  customerId: string;
  organizationId: string;
  storeId: string;
  externalReference: string;
}): Promise<Bag> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, customerId)}/verify/${externalReference}`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading active session.");
  }

  return res;
}
