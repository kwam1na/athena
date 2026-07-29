import {
  classifyDeliveryResult,
  type DeliveryResultState,
} from "./deliveryPolicy";

const MAILERSEND_API_URL = "https://api.mailersend.com/v1/email";
const SEND_TIMEOUT_MS = 15_000;

export type NotificationEmailRequest = {
  deliveryId: string;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  html: string;
};

export type NotificationEmailResult = {
  state: DeliveryResultState;
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
      return {
        state: "sent",
        code: "suppressed_non_prod",
        providerMessageId: "suppressed:non-prod",
      };
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
