import { describe, expect, it } from "vitest";

import {
  REPORTS_FINGERPRINT_VERSION,
  type NewReportFact,
} from "../../shared/reportsContract";
import {
  factFingerprint,
  fingerprintPayload,
  LEGACY_REPORTS_FINGERPRINT_VERSION,
  matchesStoredFingerprint,
  stableStringHash,
} from "./fingerprint";

function fact(overrides: Partial<NewReportFact> = {}): NewReportFact {
  return {
    sourceDomain: "pos",
    sourceId: "txn_1",
    lineId: "line_1",
    factKind: "sale",
    occurredAt: 1_700_000_000_000,
    currency: "GHS",
    grossAmountMinor: 10_000,
    netAmountMinor: 9_000,
    taxAmountMinor: 500,
    discountAmountMinor: 1_000,
    quantity: 2,
    ...overrides,
  };
}

describe("factFingerprint", () => {
  it("is deterministic and version-prefixed", () => {
    const first = factFingerprint(fact());
    const second = factFingerprint(fact());
    expect(first).toBe(second);
    expect(first.startsWith(`v${REPORTS_FINGERPRINT_VERSION}:`)).toBe(true);
  });

  it("ignores identity fields — identity is structural, not hashed", () => {
    expect(factFingerprint(fact({ sourceId: "txn_2", lineId: "line_9" }))).toBe(
      factFingerprint(fact()),
    );
  });

  it("changes when any content field drifts", () => {
    const baseline = factFingerprint(fact());
    const drifted = [
      fact({ grossAmountMinor: 10_001 }),
      fact({ netAmountMinor: 8_999 }),
      fact({ taxAmountMinor: 0 }),
      fact({ discountAmountMinor: 0 }),
      fact({ quantity: 3 }),
      fact({ currency: "USD" }),
      fact({ occurredAt: 1_700_000_000_001 }),
      fact({ productSkuId: "sku_1" }),
      fact({ unitCostMinor: 4_000 }),
    ].map((candidate) => factFingerprint(candidate));
    for (const value of drifted) expect(value).not.toBe(baseline);
    expect(new Set(drifted).size).toBe(drifted.length);
  });

  it("distinguishes absent optionals from zero/empty values", () => {
    expect(factFingerprint(fact({ unitCostMinor: 0 }))).not.toBe(
      factFingerprint(fact()),
    );
  });

  it("serializes content in a fixed order", () => {
    expect(fingerprintPayload(fact({ productSkuId: "sku_1" }))).toEqual([
      REPORTS_FINGERPRINT_VERSION,
      "GHS",
      1_700_000_000_000,
      10_000,
      9_000,
      500,
      1_000,
      2,
      "sku_1",
      null,
      null,
      null,
    ]);
  });

  it("keeps legacy replays on their stored field set", () => {
    const legacy = factFingerprint(fact(), LEGACY_REPORTS_FINGERPRINT_VERSION);
    expect(
      factFingerprint(
        fact({ paymentAllocationCoverage: "known", paymentAllocationMinor: 9_000 }),
        LEGACY_REPORTS_FINGERPRINT_VERSION,
      ),
    ).toBe(legacy);
    expect(
      factFingerprint(fact({ paymentAllocationCoverage: "known", paymentAllocationMinor: 9_000 })),
    ).not.toBe(factFingerprint(fact()));
  });

  it("accepts a legacy row whose stored currency spelling was never normalised", () => {
    const stored = {
      currency: " ghs ",
      fingerprint: factFingerprint(fact({ currency: " ghs " })),
      fingerprintVersion: REPORTS_FINGERPRINT_VERSION,
    };
    // The replay arrives normalised (ingestion normalises before hashing).
    expect(matchesStoredFingerprint(fact({ currency: "GHS" }), stored)).toBe(true);
    // Only currency spelling is forgiven; real content drift is still drift.
    expect(
      matchesStoredFingerprint(fact({ currency: "GHS", quantity: 3 }), stored),
    ).toBe(false);
    expect(matchesStoredFingerprint(fact({ currency: "USD" }), stored)).toBe(false);
  });

  it("matches a normalised stored row and honours its stored version", () => {
    const normalized = fact();
    expect(
      matchesStoredFingerprint(normalized, {
        currency: "GHS",
        fingerprint: factFingerprint(normalized),
        fingerprintVersion: REPORTS_FINGERPRINT_VERSION,
      }),
    ).toBe(true);
    expect(
      matchesStoredFingerprint(
        { ...normalized, paymentAllocationCoverage: "known" },
        {
          currency: "GHS",
          fingerprint: factFingerprint(normalized, LEGACY_REPORTS_FINGERPRINT_VERSION),
          fingerprintVersion: LEGACY_REPORTS_FINGERPRINT_VERSION,
        },
      ),
    ).toBe(true);
  });

  it("hashes stably to unsigned 8-char hex", () => {
    const hash = stableStringHash("athena");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(stableStringHash("athena")).toBe(hash);
    expect(stableStringHash("athenb")).not.toBe(hash);
    expect(stableStringHash("")).toMatch(/^[0-9a-f]{8}$/);
  });
});
