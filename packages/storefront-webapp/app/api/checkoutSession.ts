import config from "@/config";
import { Bag, CheckoutSession } from "@athena/webapp";

const getBaseUrl = (
  organizationId: string,
  storeId: string,
  storeFrontUserId: string
) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/users/${storeFrontUserId}/checkout`;

export async function createCheckoutSession({
  storeFrontUserId,
  organizationId,
  storeId,
  bagId,
  bagItems,
  bagSubtotal,
}: {
  storeFrontUserId: string;
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
    getBaseUrl(organizationId, storeId, storeFrontUserId),
    {
      method: "POST",
      body: JSON.stringify({
        storeId,
        bagId,
        storeFrontUserId,
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
  storeFrontUserId,
  organizationId,
  storeId,
}: {
  storeFrontUserId: string;
  organizationId: string;
  storeId: string;
}): Promise<CheckoutSession> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, storeFrontUserId)}/active`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error("Error loading active session.");
  }

  return res;
}

export async function getPendingCheckoutSessions({
  storeFrontUserId,
  organizationId,
  storeId,
}: {
  storeFrontUserId: string;
  organizationId: string;
  storeId: string;
}): Promise<Bag> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, storeFrontUserId)}/pending`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading active session.");
  }

  return res;
}

export async function getCheckoutSession({
  storeFrontUserId,
  organizationId,
  sessionId,
  storeId,
}: {
  sessionId: string;
  storeFrontUserId: string;
  organizationId: string;
  storeId: string;
}) {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, storeFrontUserId)}/${sessionId}`
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
  storeFrontUserId,
  sessionId,
  isFinalizingPayment,
  hasCompletedCheckoutSession,
  externalReference,
  customerEmail,
  amount,
  orderDetails,
}: {
  action:
    | "finalize-payment"
    | "complete-checkout"
    | "place-order"
    | "cancel-order";
  organizationId: string;
  storeId: string;
  storeFrontUserId: string;
  sessionId: string;
  isFinalizingPayment?: boolean;
  hasCompletedCheckoutSession?: boolean;
  externalReference?: string;
  customerEmail?: string;
  amount?: number;
  orderDetails?: any;
}) {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, storeFrontUserId)}/${sessionId}`,
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
  storeFrontUserId,
  organizationId,
  storeId,
  externalReference,
}: {
  storeFrontUserId: string;
  organizationId: string;
  storeId: string;
  externalReference: string;
}): Promise<Bag> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, storeFrontUserId)}/verify/${externalReference}`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading active session.");
  }

  return res;
}
