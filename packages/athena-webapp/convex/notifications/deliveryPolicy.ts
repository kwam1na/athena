// Pure delivery mechanics for the notifications rail: attempt budgets,
// backoff, provider-result classification, and dedupe-key recipes. Kept free
// of Convex imports so the policy is unit-testable in isolation.

export const MAX_DELIVERY_ATTEMPTS = 4;
export const DELIVERY_LEASE_MS = 5 * 60_000;
export const SWEEPER_INTENT_PICKUP_DELAY_MS = 60_000;

// "outcome_unknown" exists as a delivery status for operator triage but is
// never produced by classification: idempotency-keyed sends make ambiguous
// outcomes safe to retry instead.
export type DeliveryResultState =
  | "sent"
  | "retryable_failure"
  | "terminal_failure";

export function nextBackoffMs(attempt: number) {
  return Math.min(86_400_000, 60_000 * 2 ** Math.max(0, Math.min(10, attempt - 1)));
}

export function classifyDeliveryResult(
  result: { kind: "timeout" } | { kind: "http"; status: number },
): { state: DeliveryResultState; retry: boolean; code: string } {
  if (result.kind === "timeout") {
    // The provider call is idempotency-keyed by delivery id, so an ambiguous
    // outcome is safe to retry rather than parking for operator triage.
    return { state: "retryable_failure", retry: true, code: "provider_timeout" };
  }
  if (result.status >= 200 && result.status < 300) {
    return { state: "sent", retry: false, code: "sent" };
  }
  if (result.status === 408 || result.status === 429 || result.status >= 500) {
    return {
      state: "retryable_failure",
      retry: true,
      code: `provider_${result.status}`,
    };
  }
  return {
    state: "terminal_failure",
    retry: false,
    code: `provider_${result.status}`,
  };
}

export function normalizeRecipientEmail(email: string) {
  return email.trim().toLowerCase();
}

export function deliveryDedupeKey(args: {
  intentDedupeKey: string;
  channel: string;
  recipientEmail: string;
}) {
  return [
    args.intentDedupeKey,
    args.channel,
    normalizeRecipientEmail(args.recipientEmail),
  ].join(":");
}
