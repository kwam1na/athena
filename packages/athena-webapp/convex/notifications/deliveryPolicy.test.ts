import { describe, expect, it } from "vitest";

import {
  DELIVERY_LEASE_BASE_MS,
  DELIVERY_LEASE_MAX_MS,
  DELIVERY_LEASE_PER_RECIPIENT_MS,
  MAX_DELIVERY_ATTEMPTS,
  classifyDeliveryResult,
  computeDeliveryLeaseMs,
  deliveryDedupeKey,
  encodeKeyComponent,
  joinKeyComponents,
  nextBackoffMs,
  normalizeRecipientEmail,
} from "./deliveryPolicy";

describe("classifyDeliveryResult", () => {
  it("classifies 2xx as sent", () => {
    expect(classifyDeliveryResult({ kind: "http", status: 200 })).toEqual({
      state: "sent",
      retry: false,
      code: "sent",
    });
    expect(classifyDeliveryResult({ kind: "http", status: 202 }).state).toBe(
      "sent",
    );
  });

  it.each([408, 429, 500, 502, 503])(
    "classifies %i as retryable",
    (status) => {
      expect(classifyDeliveryResult({ kind: "http", status })).toEqual({
        state: "retryable_failure",
        retry: true,
        code: `provider_${status}`,
      });
    },
  );

  it.each([400, 401, 403, 404, 422])(
    "classifies %i as terminal",
    (status) => {
      expect(classifyDeliveryResult({ kind: "http", status })).toEqual({
        state: "terminal_failure",
        retry: false,
        code: `provider_${status}`,
      });
    },
  );

  it("classifies a timeout as retryable provider_timeout", () => {
    expect(classifyDeliveryResult({ kind: "timeout" })).toEqual({
      state: "retryable_failure",
      retry: true,
      code: "provider_timeout",
    });
  });
});

describe("nextBackoffMs", () => {
  it("floors the first attempt at 60s", () => {
    expect(nextBackoffMs(1)).toBe(60_000);
  });

  it("floors nonsensical attempt numbers at 60s", () => {
    expect(nextBackoffMs(0)).toBe(60_000);
    expect(nextBackoffMs(-3)).toBe(60_000);
  });

  it("doubles per attempt", () => {
    expect(nextBackoffMs(2)).toBe(120_000);
    expect(nextBackoffMs(3)).toBe(240_000);
    expect(nextBackoffMs(MAX_DELIVERY_ATTEMPTS)).toBe(480_000);
  });

  it("never exceeds the 24h cap and plateaus for large attempt counts", () => {
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      expect(nextBackoffMs(attempt)).toBeLessThanOrEqual(86_400_000);
    }
    // The exponent clamp is 32, far above where the 24h cap bites, so the cap
    // is the real ceiling: attempt 11 is still under it, attempt 12 onward is
    // pinned to it.
    expect(nextBackoffMs(11)).toBe(61_440_000);
    expect(nextBackoffMs(12)).toBe(86_400_000);
    expect(nextBackoffMs(50)).toBe(86_400_000);
    expect(nextBackoffMs(1_000)).toBe(86_400_000);
  });

  it("is monotonically non-decreasing", () => {
    for (let attempt = 1; attempt < 30; attempt += 1) {
      expect(nextBackoffMs(attempt + 1)).toBeGreaterThanOrEqual(
        nextBackoffMs(attempt),
      );
    }
  });
});

describe("computeDeliveryLeaseMs", () => {
  it("grows with the recipient count", () => {
    expect(computeDeliveryLeaseMs(0)).toBe(DELIVERY_LEASE_BASE_MS);
    expect(computeDeliveryLeaseMs(1)).toBe(
      DELIVERY_LEASE_BASE_MS + DELIVERY_LEASE_PER_RECIPIENT_MS,
    );
    expect(computeDeliveryLeaseMs(4)).toBe(
      DELIVERY_LEASE_BASE_MS + 4 * DELIVERY_LEASE_PER_RECIPIENT_MS,
    );
    expect(computeDeliveryLeaseMs(10)).toBeGreaterThan(
      computeDeliveryLeaseMs(3),
    );
  });

  it("is capped so one enormous audience cannot hold a lease indefinitely", () => {
    expect(computeDeliveryLeaseMs(10_000)).toBe(DELIVERY_LEASE_MAX_MS);
    expect(computeDeliveryLeaseMs(200)).toBe(DELIVERY_LEASE_MAX_MS);
  });

  it("floors a nonsensical recipient count at the base lease", () => {
    expect(computeDeliveryLeaseMs(-5)).toBe(DELIVERY_LEASE_BASE_MS);
  });
});

describe("recipient normalization and dedupe keys", () => {
  it("normalizes recipient emails by trimming and lowercasing", () => {
    expect(normalizeRecipientEmail("  Admin@Example.COM ")).toBe(
      "admin@example.com",
    );
    expect(normalizeRecipientEmail("admin@example.com")).toBe(
      "admin@example.com",
    );
  });

  it("builds delivery dedupe keys as intentKey:channel:normalizedEmail with encoded components", () => {
    expect(
      deliveryDedupeKey({
        intentDedupeKey: "pos.terminal_health:t1:100",
        channel: "email",
        recipientEmail: " Admin@Example.com ",
      }),
    ).toBe("pos.terminal_health%3At1%3A100:email:admin@example.com");
  });

  it("encodes the separator and the escape character in key components", () => {
    expect(encodeKeyComponent("a:b")).toBe("a%3Ab");
    expect(encodeKeyComponent("100%")).toBe("100%25");
    // "%" must be escaped before ":" so "%3A" cannot be forged from literal
    // text: a component that literally reads "%3A" encodes to "%253A".
    expect(encodeKeyComponent("%3A")).toBe("%253A");
    expect(joinKeyComponents(["a", "b:c"])).toBe("a:b%3Ac");
  });

  it("keeps the join injective for component tuples that would collide naively", () => {
    // Under a bare ":" join both of these flatten to the same string:
    //   "register.closeout_match:s1:evt:email:someone@x.com:email:admin@x.com"
    const spoofed = deliveryDedupeKey({
      intentDedupeKey: "register.closeout_match:s1:evt:email:someone@x.com",
      channel: "email",
      recipientEmail: "admin@x.com",
    });
    const genuine = deliveryDedupeKey({
      intentDedupeKey: "register.closeout_match:s1:evt",
      channel: "email",
      recipientEmail: "someone@x.com",
    });
    expect(spoofed).not.toBe(genuine);

    // Same shape at the joinKeyComponents level: a localEventId carrying the
    // separator cannot impersonate extra components.
    expect(
      joinKeyComponents(["register.closeout_match", "s1", "evt:email:x"]),
    ).not.toBe(
      joinKeyComponents(["register.closeout_match", "s1", "evt", "email", "x"]),
    );
  });

  it("produces identical keys for equivalent recipient spellings", () => {
    const base = {
      intentDedupeKey: "register.closeout_variance:ar1",
      channel: "email",
    };
    expect(
      deliveryDedupeKey({ ...base, recipientEmail: "A@B.COM" }),
    ).toBe(deliveryDedupeKey({ ...base, recipientEmail: " a@b.com " }));
  });
});
