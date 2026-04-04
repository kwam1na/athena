import config from "@/config";
import type { CheckoutOrderSubmission } from "@/components/checkout/schemas/webOrderSchema";
import { CheckoutSession, ProductSku } from "@athena/webapp";

const getBaseUrl = () => `${config.apiGateway.URL}/checkout`;

type CheckoutApiResponse = Record<string, unknown>;

type CreateCheckoutSessionInput = {
  bagId: string;
  bagItems?: unknown;
  bagSubtotal?: number;
};

type FinalizePaymentInput = {
  action: "finalize-payment" | "create-pod-order";
  sessionId: string;
  isFinalizingPayment?: boolean;
  customerEmail: string;
  orderDetails: CheckoutOrderSubmission;
};

type CompleteCheckoutInput = {
  action: "complete-checkout";
  sessionId: string;
  hasCompletedCheckoutSession?: boolean;
  orderDetails?: CheckoutOrderSubmission;
};

type PlaceOrderInput = {
  action: "place-order";
  sessionId: string;
  hasCompletedCheckoutSession?: boolean;
};

type UpdateOrderInput = {
  action: "update-order";
  sessionId: string;
  placedOrderId: string;
  hasCompletedCheckoutSession?: boolean;
};

type CancelOrderInput = {
  action: "cancel-order";
  sessionId: string;
  hasCompletedCheckoutSession?: boolean;
};

export type CheckoutSessionUpdateInput =
  | FinalizePaymentInput
  | CompleteCheckoutInput
  | PlaceOrderInput
  | UpdateOrderInput
  | CancelOrderInput;

type CheckoutAction = CheckoutSessionUpdateInput["action"];

type CheckoutSessionErrorOptions = {
  status: number;
  code?: string;
  payload?: CheckoutApiResponse | null;
};

export class CheckoutSessionError extends Error {
  status: number;
  code?: string;
  payload?: CheckoutApiResponse | null;

  constructor(message: string, options: CheckoutSessionErrorOptions) {
    super(message);
    this.name = "CheckoutSessionError";
    this.status = options.status;
    this.code = options.code;
    this.payload = options.payload;
  }
}

const isRecord = (value: unknown): value is CheckoutApiResponse =>
  typeof value === "object" && value !== null;

const parseJson = async (
  response: Response,
): Promise<CheckoutApiResponse | null> => {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const getCheckoutErrorMessageFromPayload = (
  payload: CheckoutApiResponse | null,
  fallbackMessage: string,
) => {
  const error = payload?.error;
  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  const message = payload?.message;
  if (typeof message === "string" && message.length > 0) {
    return message;
  }

  return fallbackMessage;
};

const parseCheckoutResponse = async <T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> => {
  const payload = await parseJson(response);

  if (!response.ok) {
    throw new CheckoutSessionError(
      getCheckoutErrorMessageFromPayload(payload, fallbackMessage),
      {
        status: response.status,
        code: typeof payload?.code === "string" ? payload.code : undefined,
        payload,
      },
    );
  }

  return (payload ?? {}) as T;
};

const defaultCheckoutActionMessage = (action: CheckoutAction) => {
  if (action === "create-pod-order") {
    return "We couldn't place your pay-on-delivery order. Please try again.";
  }

  if (action === "complete-checkout") {
    return "We couldn't finish loading your completed order. Please try again.";
  }

  return "We couldn't finalize your payment. Please try again.";
};

export const getCheckoutActionErrorMessage = (
  error: unknown,
  action: CheckoutAction,
) => {
  const fallbackMessage = defaultCheckoutActionMessage(action);

  if (!(error instanceof CheckoutSessionError)) {
    return fallbackMessage;
  }

  if (error.code === "SESSION_ALREADY_FINALIZED") {
    return "This checkout session has already been completed. Please refresh the page or return to your shopping bag to start a new checkout.";
  }

  if (error.status === 403) {
    return "This checkout session is no longer available for your account. Refresh the page or return to your shopping bag to start again.";
  }

  if (error.status === 400) {
    return "We couldn't validate your checkout details. Please review your information and try again.";
  }

  if (error.status === 422) {
    if (
      error.message === "Amount mismatch detected" ||
      error.message.includes("quantity must be positive") ||
      error.message.includes("checkoutable items")
    ) {
      return "Your bag changed while checkout was open. Refresh your shopping bag and try again.";
    }

    return error.message || fallbackMessage;
  }

  return error.message || fallbackMessage;
};

export async function createCheckoutSession({
  bagId,
}: CreateCheckoutSessionInput) {
  const response = await fetch(getBaseUrl(), {
    method: "POST",
    body: JSON.stringify({
      bagId,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  return await parseCheckoutResponse<CheckoutApiResponse>(
    response,
    "Error initializing checkout session",
  );
}

export async function getActiveCheckoutSession(): Promise<CheckoutSession | null> {
  const response = await fetch(`${getBaseUrl()}/active`, {
    credentials: "include",
  });

  return await parseCheckoutResponse<CheckoutSession | null>(
    response,
    "Error loading active session.",
  );
}

export async function getPendingCheckoutSessions(): Promise<CheckoutSession[]> {
  const response = await fetch(`${getBaseUrl()}/pending`, {
    credentials: "include",
  });

  return await parseCheckoutResponse<CheckoutSession[]>(
    response,
    "Error loading active session.",
  );
}

export async function getCheckoutSession(
  sessionId: string,
): Promise<CheckoutSession & { items: ProductSku[] }> {
  const response = await fetch(`${getBaseUrl()}/${sessionId}`, {
    credentials: "include",
  });

  return await parseCheckoutResponse<CheckoutSession & { items: ProductSku[] }>(
    response,
    "Error loading session.",
  );
}

export async function updateCheckoutSession(
  input: CheckoutSessionUpdateInput,
): Promise<CheckoutApiResponse> {
  const response = await fetch(`${getBaseUrl()}/${input.sessionId}`, {
    method: "POST",
    body: JSON.stringify({
      action: input.action,
      isFinalizingPayment:
        "isFinalizingPayment" in input ? input.isFinalizingPayment : undefined,
      customerEmail: "customerEmail" in input ? input.customerEmail : undefined,
      hasCompletedCheckoutSession:
        "hasCompletedCheckoutSession" in input
          ? input.hasCompletedCheckoutSession
          : undefined,
      orderDetails:
        "orderDetails" in input && input.orderDetails
          ? {
              ...input.orderDetails,
              billingDetails: null,
            }
          : undefined,
      placedOrderId: "placedOrderId" in input ? input.placedOrderId : undefined,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  return await parseCheckoutResponse<CheckoutApiResponse>(
    response,
    "Error updating checkout session.",
  );
}

export async function verifyCheckoutSessionPayment({
  externalReference,
}: {
  externalReference: string;
}) {
  const response = await fetch(`${getBaseUrl()}/verify/${externalReference}`, {
    credentials: "include",
  });

  return await parseCheckoutResponse<CheckoutApiResponse>(
    response,
    "Error loading active session.",
  );
}
