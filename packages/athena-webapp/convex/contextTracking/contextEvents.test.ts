import { describe, expect, it } from "vitest";

import {
  buildContextEventSemanticEnvelopeHash,
  isContextEventWriteQuotaExceeded,
  selectContextEventAppendQuotaDecision,
} from "./contextEvents";

describe("context event append safeguards", () => {
  it("rejects writes once the abuse partition reaches the window quota", () => {
    expect(isContextEventWriteQuotaExceeded(119)).toBe(false);
    expect(isContextEventWriteQuotaExceeded(120)).toBe(true);
    expect(isContextEventWriteQuotaExceeded(121)).toBe(true);
  });

  it("selects append quota behavior for partitioned and unpartitioned writes", () => {
    expect(
      selectContextEventAppendQuotaDecision({
        abusePartitionKey: undefined,
        recentEventCount: 10_000,
      }),
    ).toBe("skip_quota_check");
    expect(
      selectContextEventAppendQuotaDecision({
        abusePartitionKey: "store_1:anonymous",
        recentEventCount: 119,
      }),
    ).toBe("allow_write");
    expect(
      selectContextEventAppendQuotaDecision({
        abusePartitionKey: "store_1:anonymous",
        recentEventCount: 120,
      }),
    ).toBe("reject_quota_exceeded");
  });

  it("keeps retry duplicate hashes stable when only occurredAt changes", () => {
    const base = {
      storeId: "store_1",
      surface: "storefront",
      eventId: "storefront.route_viewed",
      schemaVersion: 1,
      idempotencyKey: "route:session:/shop",
      payload: { route: "/shop" },
    };

    expect(
      buildContextEventSemanticEnvelopeHash({
        ...base,
        occurredAt: 1_700_000_000_000,
      }),
    ).toBe(
      buildContextEventSemanticEnvelopeHash({
        ...base,
        occurredAt: 1_700_000_100_000,
      }),
    );
  });

  it("keeps retry duplicate hashes stable when environment metadata changes", () => {
    const base = {
      storeId: "store_1",
      surface: "storefront",
      eventId: "storefront.route_viewed",
      schemaVersion: 1,
      idempotencyKey: "route:session:/shop",
      occurredAt: 1_700_000_000_000,
      payload: { route: "/shop" },
    };

    expect(
      buildContextEventSemanticEnvelopeHash({
        ...base,
        environment: { deviceClass: "mobile" },
      }),
    ).toBe(
      buildContextEventSemanticEnvelopeHash({
        ...base,
        environment: { deviceClass: "desktop" },
      }),
    );
    expect(
      buildContextEventSemanticEnvelopeHash({
        ...base,
        environment: { deviceClass: "mobile" },
      }),
    ).toBe(buildContextEventSemanticEnvelopeHash(base));
  });
});
