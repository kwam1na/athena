import { describe, expect, it } from "vitest";

import {
  coverageForFactContribution,
  coverageOnlyMetricsForFact,
  generationCoverageIsActivatable,
  metricCoverageIsActivatable,
  summarizeRequiredMetricCoverage,
} from "./coverage";

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
  it("separates trustworthy revenue and quantity from cost-only partiality", () => {
    for (const metric of ["gross_sales", "net_sales", "units_sold"] as const) {
      expect(
        coverageForFactContribution({
          completeness: "partial",
          limitingReason: "uncosted",
          metric,
        }),
      ).toEqual({ completeness: "complete", limitingReason: undefined });
    }
    for (const metric of [
      "known_cogs",
      "gross_profit",
      "uncosted_revenue",
    ] as const) {
      expect(
        coverageForFactContribution({
          completeness: "partial",
          limitingReason: "uncosted",
          metric,
        }),
      ).toEqual({ completeness: "partial", limitingReason: "uncosted" });
    }
  });

  it("allows only explicit current uncosted known-component coverage", () => {
    const uncosted = {
      ...current("pos"),
      completeness: "partial" as const,
      limitingReason: "uncosted" as const,
    };
    expect(
      metricCoverageIsActivatable({
        metric: "units_sold",
        observations: [uncosted, current("storefront")],
      }),
    ).toBe(true);
    expect(
      metricCoverageIsActivatable({
        metric: "net_sales",
        observations: [
          uncosted,
          current("storefront"),
          current("service"),
        ],
      }),
    ).toBe(false);
    for (const unsafe of [
      { limitingReason: "source_incomplete" as const },
      { omittedCount: 1 },
      { quarantinedCount: 1 },
      { failedCount: 1 },
      { truncated: true },
      { knownLagMs: 10 * 60_000 },
    ]) {
      expect(
        metricCoverageIsActivatable({
          metric: "units_sold",
          observations: [
            { ...uncosted, ...unsafe },
            current("storefront"),
          ],
        }),
      ).toBe(false);
    }
  });

  it("rejects unsafe reasons even when an observation claims completeness", () => {
    for (const limitingReason of ["mixed_currency", "source_incomplete"] as const) {
      expect(
        metricCoverageIsActivatable({
          metric: "units_sold",
          observations: [
            { ...current("pos"), limitingReason },
            current("storefront"),
          ],
        }),
      ).toBe(false);
    }
    expect(
      metricCoverageIsActivatable({
        metric: "units_sold",
        observations: [
          { ...current("pos"), completeness: "provisional" as const },
          current("storefront"),
        ],
      }),
    ).toBe(false);
  });

  it("records missing cost values as coverage-only partiality", () => {
    expect(
      coverageOnlyMetricsForFact({
        costStatus: "unknown",
        inventoryContributionKind: undefined,
        revenueKind: "merchandise",
      }),
    ).toEqual(["known_cogs", "gross_profit"]);
    expect(
      coverageOnlyMetricsForFact({
        costStatus: "unknown",
        inventoryContributionKind: "inventory_consumed",
        revenueKind: undefined,
      }),
    ).toEqual(["inventory_consumed_value"]);
  });

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

  it("makes omitted monetary evidence partial and blocks activation", () => {
    const omittedProcurement = {
      ...current("procurement"),
      completeness: "partial" as const,
      limitingReason: "source_incomplete" as const,
      omittedCount: 1,
      metric: "purchase_commitment_value",
    };

    expect(
      summarizeRequiredMetricCoverage({
        metric: "purchase_commitment_value",
        observations: [omittedProcurement],
      }),
    ).toMatchObject({
      completeness: "partial",
      limitingReason: "source_incomplete",
      omittedCount: 1,
    });
    expect(
      generationCoverageIsActivatable({
        coverage: [omittedProcurement],
        projectionKind: "store_day",
      }),
    ).toBe(false);
  });
});
