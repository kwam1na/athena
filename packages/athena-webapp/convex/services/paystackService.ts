import { PAYMENT_CONSTANTS } from "../constants/payment";
import {
  PaystackInitializeResponse,
  PaystackVerificationResponse,
  PaystackRefundResponse,
} from "../types/payment";

/**
 * Get Paystack authorization headers
 */
function getPaystackHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
}

/**
 * Initialize a Paystack transaction
 */
export async function initializeTransaction(params: {
  email: string;
  amount: number;
  callbackUrl: string;
  metadata: any;
}): Promise<PaystackInitializeResponse> {
  // Log Paystack API request
  console.log(
    `[CHECKOUT-PAYSTACK-API] Calling Paystack initialize endpoint | Session: ${params.metadata?.checkout_session_id} | Email: ${params.email} | Amount: ${params.amount}`
  );

  const response = await fetch(PAYMENT_CONSTANTS.PAYSTACK_API.INITIALIZE, {
    method: "POST",
    headers: getPaystackHeaders(),
    body: JSON.stringify({
      email: params.email,
      amount: params.amount.toString(),
      callback_url: params.callbackUrl,
      metadata: params.metadata,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    console.error(
      `[CHECKOUT-FAILURE] Paystack API error | Session: ${params.metadata?.checkout_session_id} | Status: ${response.status} | Error:`,
      error
    );
    throw new Error("Failed to create payment transaction");
  }

  const result = await response.json();

  // Log successful API response
  console.log(
    `[CHECKOUT-PAYSTACK-API] Paystack API success | Session: ${params.metadata?.checkout_session_id} | Reference: ${result.data?.reference} | Has Auth URL: ${!!result.data?.authorization_url}`
  );

  return result;
}

/**
 * Verify a Paystack transaction
 */
export async function verifyTransaction(
  reference: string
): Promise<PaystackVerificationResponse> {
  const response = await fetch(
    `${PAYMENT_CONSTANTS.PAYSTACK_API.VERIFY}/${reference}`,
    {
      headers: getPaystackHeaders(),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    console.error("Failed to verify Paystack transaction", error);
    throw new Error("Failed to verify payment transaction");
  }

  return await response.json();
}

/**
 * Initiate a refund for a Paystack transaction
 */
export async function initiateRefund(params: {
  transactionReference: string;
  amount?: number;
}): Promise<PaystackRefundResponse> {
  const response = await fetch(PAYMENT_CONSTANTS.PAYSTACK_API.REFUND, {
    method: "POST",
    headers: getPaystackHeaders(),
    body: JSON.stringify({
      transaction: params.transactionReference,
      amount: params.amount,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error("Failed to initiate Paystack refund", result);
    throw new Error(result.message || "Failed to refund payment");
  }

  return result;
}
