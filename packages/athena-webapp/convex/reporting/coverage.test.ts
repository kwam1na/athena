/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../schema";
import { unavailableCurrentInventoryCoverageIsActivatable } from "./activation";
import {
  coverageForFactContribution,
  coverageOnlyMetricsForFact,
  generationCoverageIsActivatable,
  materializedGenerationCoverageCompleteness,
  materializeGenerationCoverageWithCtx,
  metricCoverageIsActivatable,
  summarizeRequiredMetricCoverage,
} from "./coverage";

const modules = import.meta.glob("../**/*.ts");

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
  it("preserves explicit source unavailability in generated coverage", () => {
    expect(
      materializedGenerationCoverageCompleteness({
        defaultCompleteness: "unavailable",
        hasLimitation: true,
      }),
    ).toBe("unavailable");
    expect(
      materializedGenerationCoverageCompleteness({
        defaultCompleteness: "complete",
        hasLimitation: true,
      }),
    ).toBe("partial");
  });

  it("writes an unavailable certificate accepted by the activation gate", async () => {
    const t = convexTest(schema, modules);
    const coverage = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", {
        email: "inventory-certificate@example.test",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "Inventory Certificate",
        slug: "inventory-certificate",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: userId,
        currency: "GHS",
        name: "Inventory Certificate",
        organizationId,
        slug: "inventory-certificate",
      });
      const runId = await ctx.db.insert("reportingRun", {
        actorKind: "automation",
        automationIdentity: "inventory-certificate-test",
        createdAt: 1,
        domain: "reporting",
        factContractVersion: 2,
        failedCount: 0,
        frozenWatermark: 100,
        metricContractVersion: 1,
        operation: "current_inventory_rebuild_building",
        organizationId,
        processedCount: 0,
        projectionContractVersion: 2,
        runType: "rebuild",
        status: "running",
        storeId,
      });
      const generationId = await ctx.db.insert(
        "reportingProjectionGeneration",
        {
          completeness: "provisional",
          createdAt: 1,
          factContractVersion: 2,
          metricContractVersion: 1,
          organizationId,
          projectionContractVersion: 2,
          projectionKind: "current_inventory",
          runId,
          sourceWatermark: 100,
          status: "building",
          storeId,
        },
      );
      const generation = await ctx.db.get(
        "reportingProjectionGeneration",
        generationId,
      );
      if (!generation) throw new Error("generation fixture missing");
      await materializeGenerationCoverageWithCtx(ctx, {
        defaultCompleteness: "unavailable",
        generation,
        globalLimitingReason: "source_incomplete",
        periodEnd: 100,
        periodStart: 1,
        processingWatermark: 100,
      });
      return await ctx.db
        .query("reportingMetricCoverage")
        .withIndex("by_generationId_metric_sourceDomain", (q) =>
          q.eq("generationId", generationId),
        )
        .take(4);
    });

    expect(coverage).toHaveLength(3);
    expect(
      unavailableCurrentInventoryCoverageIsActivatable({
        candidate: {
          completeness: "unavailable",
          limitingReason: "source_incomplete",
          projectionKind: "current_inventory",
        },
        coverage,
        discrepancyCount: 0,
        hasProjectionRows: false,
      }),
    ).toBe(true);
  });

  it("can gate the sealed POS migration independently from deferred source domains", () => {
    expect(
      generationCoverageIsActivatable({
        coverage: [
          { ...current("pos"), metric: "net_sales" },
          { ...current("pos"), metric: "units_sold" },
        ],
        metrics: ["net_sales", "units_sold"],
        projectionKind: "store_day",
        requiredSourceDomains: ["pos"],
      }),
    ).toBe(true);
    expect(
      generationCoverageIsActivatable({
        coverage: [
          { ...current("pos"), metric: "net_sales", omittedCount: 1 },
          { ...current("pos"), metric: "units_sold" },
        ],
        metrics: ["net_sales", "units_sold"],
        projectionKind: "store_day",
        requiredSourceDomains: ["pos"],
      }),
    ).toBe(false);
  });

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
