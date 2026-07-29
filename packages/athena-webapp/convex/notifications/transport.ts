import {
  classifyDeliveryResult,
  type DeliveryResultState,
} from "./deliveryPolicy";

const MAILERSEND_API_URL = "https://api.mailersend.com/v1/email";
// Exported so the batch/lease invariant can be asserted in tests: one
// dispatch's serial batch (MAX_DELIVERIES_PER_DISPATCH x this timeout) must
// fit inside DELIVERY_LEASE_MAX_MS, or the sweeper can reclaim a live
// dispatch's lease.
export const SEND_TIMEOUT_MS = 15_000;

export type NotificationEmailRequest = {
  deliveryId: string;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  html: string;
};

export type NotificationEmailResult = {
  // "suppressed" is reported when policy — not the provider — decided not to
  // send. It must never be conflated with "sent": a delivery row claiming
  // success for mail that was never transmitted is indistinguishable from a
  // real send during an incident.
  state: DeliveryResultState | "suppressed";
  code: string;
  providerMessageId?: string;
};

// The rail's single email transport. Owns the environment policy: prod sends
// to the real recipient; non-prod redirects to NOTIFICATIONS_DEV_RECIPIENT
// when set and otherwise reports sent-suppressed without touching the
// provider — so every environment exercises the full pipeline. The provider
// call is idempotency-keyed by delivery id, which is what makes ambiguous
// outcomes safe to retry.
export async function sendNotificationEmail(
  request: NotificationEmailRequest,
): Promise<NotificationEmailResult> {
  let recipientEmail = request.recipientEmail;
  let recipientName = request.recipientName ?? "";

  if (process.env.STAGE !== "prod") {
    const devRecipient = process.env.NOTIFICATIONS_DEV_RECIPIENT;
    if (!devRecipient) {
      return { state: "suppressed", code: "suppressed_non_prod" };
    }
    recipientEmail = devRecipient;
    recipientName = "Athena notifications (dev)";
  }

  const apiKey = process.env.MAILERSEND_API_KEY;
  if (!apiKey) {
    return { state: "terminal_failure", code: "missing_configuration" };
  }

  try {
    const response = await fetch(MAILERSEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Idempotency-Key": request.deliveryId,
      },
      body: JSON.stringify({
        from: { email: "noreply@wigclub.store", name: "Athena" },
        to: [{ email: recipientEmail, name: recipientName }],
        subject: request.subject,
        html: request.html,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const classification = classifyDeliveryResult({
      kind: "http",
      status: response.status,
    });
    return {
      state: classification.state,
      code: classification.code,
      providerMessageId: response.headers.get("x-message-id") ?? undefined,
    };
  } catch {
    const classification = classifyDeliveryResult({ kind: "timeout" });
    return { state: classification.state, code: classification.code };
  }
}
