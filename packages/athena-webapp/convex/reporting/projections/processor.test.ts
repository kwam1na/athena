import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  currencyForFactMetric,
  factContributionProjectionEligibility,
  mergeProjectionValue,
  recordOmittedProjectionEvidenceWithCtx,
} from "./processor";

describe("reporting incremental projection processor", () => {
  it("does not fan out one intraday scheduling chain per canonical fact", () => {
    const source = readFileSync(join(import.meta.dirname, "processor.ts"), "utf8");
    expect(source).not.toContain("scheduleStoreIntradayRefresh");
    expect(source).not.toContain("materializeStoreIntradayCheckpoint");
  });
  it("adds compatible currency values", () => {
    expect(
      mergeProjectionValue({
        currentCurrencyCode: "GHS",
        currentKnownValue: 1_200,
        incomingCurrencyCode: "GHS",
        incomingValue: 300,
      }),
    ).toEqual({ knownValue: 1_500 });
  });

  it("withholds an aggregate instead of summing unlike currencies", () => {
    expect(
      mergeProjectionValue({
        currentCurrencyCode: "GHS",
        currentKnownValue: 1_200,
        incomingCurrencyCode: "USD",
        incomingValue: 300,
      }),
    ).toEqual({
      completeness: "unavailable",
      knownValue: undefined,
      limitingReason: "mixed_currency",
    });
  });

  it("keeps a mixed-currency aggregate withheld on later facts", () => {
    expect(
      mergeProjectionValue({
        currentCurrencyCode: "GHS",
        currentKnownValue: undefined,
        currentLimitingReason: "mixed_currency",
        incomingCurrencyCode: "GHS",
        incomingValue: 300,
      }),
    ).toEqual({
      completeness: "unavailable",
      knownValue: undefined,
      limitingReason: "mixed_currency",
    });
  });

  it("selects revenue and valuation currencies independently by metric", () => {
    const fact = {
      currencyCode: "GHS",
      inventoryContributionKind: undefined,
      revenueCurrencyCode: "GHS",
      valuationCurrencyCode: "USD",
    };
    expect(currencyForFactMetric(fact, "net_sales")).toBe("GHS");
    expect(currencyForFactMetric(fact, "known_cogs")).toBe("USD");
    expect(currencyForFactMetric(fact, "units_sold")).toBeUndefined();
  });

  it("does not treat missing monetary currency as compatible with a known segment", () => {
    expect(
      mergeProjectionValue({
        currentCurrencyCode: "GHS",
        currentKnownValue: 1_200,
        incomingCurrencyCode: undefined,
        incomingValue: 300,
      }),
    ).toEqual({
      completeness: "unavailable",
      knownValue: undefined,
      limitingReason: "mixed_currency",
    });
  });

  it("withholds procurement value when its currency convention is unknown", () => {
    expect(
      factContributionProjectionEligibility({
        fact: {} as never,
        metric: "purchase_commitment_value",
        projectionKind: "store_day",
      }),
    ).toBe("missing_currency");
  });

  it("projects procurement value with a known currency convention", () => {
    expect(
      factContributionProjectionEligibility({
        fact: {
          currencyCode: "GHS",
          currencyMinorUnitScale: 2,
        } as never,
        metric: "purchase_commitment_value",
        projectionKind: "store_day",
      }),
    ).toBe("project");
  });

  it("projects quantity metrics without currency metadata", () => {
    expect(
      factContributionProjectionEligibility({
        fact: {} as never,
        metric: "purchase_commitment_units",
        projectionKind: "store_day",
      }),
    ).toBe("project");
  });

  it("requires SKU attribution only for SKU-day projections", () => {
    const fact = {
      currencyCode: "GHS",
      currencyMinorUnitScale: 2,
    } as never;
    expect(
      factContributionProjectionEligibility({
        fact,
        metric: "purchase_commitment_value",
        projectionKind: "sku_day",
      }),
    ).toBe("missing_sku");
    expect(
      factContributionProjectionEligibility({
        fact,
        metric: "purchase_commitment_value",
        projectionKind: "store_day",
      }),
    ).toBe("project");
  });

  it("reports withheld currency contributions as omitted coverage", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "reporting", "projections", "processor.ts"),
      "utf8",
    );
    expect(source).toContain(
      'filter(({ disposition }) => disposition === "missing_currency")',
    );
    expect(source).toContain("omittedContributions,");
  });

  it("records omission identity once per generation, fact, and metric", async () => {
    const evidence: Array<Record<string, unknown>> = [];
    const ctx = {
      db: {
        insert: async (_table: string, value: Record<string, unknown>) => {
          evidence.push({ _id: `evidence-${evidence.length + 1}`, ...value });
        },
        query: () => {
          const filters: Array<[string, unknown]> = [];
          const builder = {
            eq(field: string, value: unknown) {
              filters.push([field, value]);
              return builder;
            },
          };
          const chain = {
            take: async (limit: number) =>
              evidence
                .filter((row) =>
                  filters.every(([field, value]) => row[field] === value),
                )
                .slice(0, limit),
            withIndex: (
              _name: string,
              apply: (query: typeof builder) => unknown,
            ) => {
              apply(builder);
              return chain;
            },
          };
          return chain;
        },
      },
    } as never;
    const fact = {
      _creationTime: 1,
      _id: "fact-1",
      acceptedAt: 1,
      businessEventKey: "purchase_order:1",
      completeness: "partial",
      factType: "purchase_commitment",
      occurrenceAt: 1,
      operatingDate: "2026-07-01",
      organizationId: "org-1",
      recognitionAt: 1,
      scheduleVersionId: "schedule-1",
      sourceDomain: "procurement",
      status: "canonical",
      storeId: "store-1",
    } as never;
    const input = {
      fact,
      generationId: "generation-1",
      metric: "purchase_commitment_value",
      now: 2,
    };

    await expect(recordOmittedProjectionEvidenceWithCtx(ctx, input as never)).resolves.toBe(true);
    await expect(recordOmittedProjectionEvidenceWithCtx(ctx, input as never)).resolves.toBe(false);
    await expect(
      recordOmittedProjectionEvidenceWithCtx(ctx, {
        ...input,
        metric: "known_cogs",
      } as never),
    ).resolves.toBe(true);
    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({
      disposition: "omitted_missing_currency",
      factId: "fact-1",
      generationId: "generation-1",
      metric: "purchase_commitment_value",
    });
  });

  it("does not classify projection-scope exclusions as source omissions", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "reporting", "projections", "processor.ts"),
      "utf8",
    );
    expect(source).toContain(
      '.filter(({ disposition }) => disposition === "missing_currency")',
    );
    expect(source).not.toContain(
      '.filter(({ disposition }) => disposition === "missing_sku")',
    );
    expect(source).not.toContain(
      '.filter(({ disposition }) => disposition === "unsupported_metric")',
    );
  });

  it("uses exact lineage indexes instead of capped sibling scans", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "reporting", "projections", "processor.ts"),
      "utf8",
    );
    expect(source).toContain(
      '"by_gen_date_metric_schedule"',
    );
    expect(source).toContain(
      '"by_gen_date_metric_policy"',
    );
    expect(source).toContain(
      '"by_gen_sku_date_metric_schedule"',
    );
    expect(source).toContain(
      '"by_gen_sku_date_metric_policy"',
    );
    expect(source).not.toContain(".take(20)");
  });
});
