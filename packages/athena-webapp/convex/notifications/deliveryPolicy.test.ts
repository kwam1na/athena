import { describe, expect, it } from "vitest";

import {
  MAX_DELIVERY_ATTEMPTS,
  classifyDeliveryResult,
  deliveryDedupeKey,
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
    expect(nextBackoffMs(11)).toBe(nextBackoffMs(50));
    expect(nextBackoffMs(50)).toBe(nextBackoffMs(1_000));
  });

  it("is monotonically non-decreasing", () => {
    for (let attempt = 1; attempt < 30; attempt += 1) {
      expect(nextBackoffMs(attempt + 1)).toBeGreaterThanOrEqual(
        nextBackoffMs(attempt),
      );
    }
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

  it("builds delivery dedupe keys as intentKey:channel:normalizedEmail", () => {
    expect(
      deliveryDedupeKey({
        intentDedupeKey: "pos.terminal_health:t1:100",
        channel: "email",
        recipientEmail: " Admin@Example.com ",
      }),
    ).toBe("pos.terminal_health:t1:100:email:admin@example.com");
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
