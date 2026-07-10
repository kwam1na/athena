import { describe, expect, it } from "vitest";

import { summarizeRequiredMetricCoverage } from "./coverage";

const current = (sourceDomain: string) => ({
  completeness: "complete" as const,
  failedCount: 0,
  knownLagMs: 0,
  limitingReason: null,
  omittedCount: 0,
  quarantinedCount: 0,
  sourceDomain,
  truncated: false,
});

describe("reporting metric coverage", () => {
  it("keeps POS current while a stale storefront makes unified sales stale", () => {
    const coverage = summarizeRequiredMetricCoverage({
      metric: "net_sales",
      observations: [
        current("pos"),
        { ...current("storefront"), knownLagMs: 10 * 60_000 },
        current("service"),
      ],
    });

    expect(coverage).toMatchObject({
      completeness: "stale",
      limitingReason: "projection_stale",
    });
    expect(coverage.sources).toContainEqual(
      expect.objectContaining({
        completeness: "complete",
        sourceDomain: "pos",
      }),
    );
    expect(
      summarizeRequiredMetricCoverage({
        metric: "payment_allocated",
        observations: [current("payments")],
      }).completeness,
    ).toBe("complete");
  });

  it("makes quarantine visible without invalidating unrelated sources", () => {
    const coverage = summarizeRequiredMetricCoverage({
      metric: "net_sales",
      observations: [
        current("pos"),
        { ...current("storefront"), quarantinedCount: 2 },
        current("service"),
      ],
    });

    expect(coverage).toMatchObject({
      completeness: "partial",
      limitingReason: "source_incomplete",
      quarantinedCount: 2,
    });
    expect(coverage.sources[0]).toMatchObject({
      completeness: "complete",
      sourceDomain: "pos",
    });
  });
});
