// Pure delivery mechanics for the notifications rail: attempt budgets,
// backoff, provider-result classification, and dedupe-key recipes. Kept free
// of Convex imports so the policy is unit-testable in isolation.

// Attempts must stay low enough that the total retry span sits inside the
// email provider's idempotency-key retention window — the key is what makes a
// re-send after an ambiguous outcome safe. At 4 attempts the span is
// 1m + 2m + 4m, comfortably inside MailerSend's window. Raising this without
// re-checking that window silently forfeits the no-double-send guarantee.
export const MAX_DELIVERY_ATTEMPTS = 4;

// A dispatch sends to its whole leased batch serially, so the lease has to
// cover every recipient's send, not just one. Base + per-recipient allowance
// keeps a slow provider from letting the sweeper reclaim leases mid-flight
// (which would re-send to recipients that already succeeded).
export const DELIVERY_LEASE_BASE_MS = 2 * 60_000;
export const DELIVERY_LEASE_PER_RECIPIENT_MS = 30_000;
// Must exceed the worst-case serial batch: one send timeout per recipient for
// a full audience. Below that ceiling the sweeper can reclaim a lease from a
// live dispatch and inflate attemptCount for mail that was actually sent.
export const DELIVERY_LEASE_MAX_MS = 55 * 60_000;
export const SWEEPER_INTENT_PICKUP_DELAY_MS = 60_000;

// Abandonment is wall-clock based, not pickup-count based: the sweep cadence
// differs per environment (5 min in prod, 60 elsewhere), so a pickup count
// would mean a different grace period in each. Six hours is comfortably longer
// than a detect-and-roll-back cycle for a bad deploy, which is the realistic
// way a batch of intents becomes temporarily unreservable.
export const INTENT_ABANDON_AFTER_MS = 6 * 60 * 60_000;

export function computeDeliveryLeaseMs(recipientCount: number) {
  return Math.min(
    DELIVERY_LEASE_MAX_MS,
    DELIVERY_LEASE_BASE_MS +
      Math.max(0, recipientCount) * DELIVERY_LEASE_PER_RECIPIENT_MS,
  );
}

// "outcome_unknown" exists as a delivery status for operator triage but is
// never produced by classification: idempotency-keyed sends make ambiguous
// outcomes safe to retry instead.
export type DeliveryResultState =
  | "sent"
  | "retryable_failure"
  | "terminal_failure";

const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 86_400_000;

// 60s doubling per attempt, capped at 24h. The exponent is bounded only to
// keep the arithmetic finite for absurd inputs; the 24h cap is the real
// ceiling and is reachable. At MAX_DELIVERY_ATTEMPTS the only values used are
// 1m, 2m, and 4m.
export function nextBackoffMs(attempt: number) {
  const exponent = Math.max(0, Math.min(32, attempt - 1));
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** exponent);
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

// Key components can carry client-supplied text (POS localEventId, for one),
// so a bare ":" join is ambiguous: two different component tuples could
// concatenate to the same string and silently collapse two notifications into
// one. Percent-encoding the separator makes the join injective.
export function encodeKeyComponent(component: string) {
  return component.replace(/%/g, "%25").replace(/:/g, "%3A");
}

export function joinKeyComponents(components: string[]) {
  return components.map(encodeKeyComponent).join(":");
}

export function deliveryDedupeKey(args: {
  intentDedupeKey: string;
  channel: string;
  recipientEmail: string;
}) {
  return joinKeyComponents([
    args.intentDedupeKey,
    args.channel,
    normalizeRecipientEmail(args.recipientEmail),
  ]);
}
