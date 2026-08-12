/// <reference types="vite/client" />

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import type { DailyManagerReportProps } from "../emails/DailyManagerReport";
import type { ReportWeekCloseEvidence } from "../../shared/reportsContract";
import {
  buildAcceptedWeeklyManagerReportPayload,
  buildAcceptedWeeklyTopItems,
} from "./weeklyManagerReportEmail";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./operations/"),
    loader,
  ]),
);
const getPayload = makeFunctionReference<
  "query",
  { acceptedWeekId: Id<"reportWeekAccepted"> },
  DailyManagerReportProps | null
>("operations/weeklyManagerReportEmail:getAcceptedWeeklyManagerReportPayload");
const getCorrectedPayload = makeFunctionReference<
  "query",
  {
    acceptedWeekId: Id<"reportWeekAccepted">;
    candidateFingerprint: string;
  },
  DailyManagerReportProps | null
>("operations/weeklyManagerReportEmail:getCorrectedWeeklyManagerReportPayload");

const metrics = {
  grossProfitMinor: 0,
  grossSalesMinor: 0,
  netSalesMinor: 0,
  paymentAllocatedMinor: 0,
  paymentAllocationCoverage: "complete" as const,
  paymentAllocationOmittedMinor: 0,
  paymentHasInvalidAllocation: false,
  paymentUnsettledMinor: 0,
  paymentsCollectedMinor: 0,
  paymentsRefundedMinor: 0,
  refundsMinor: 0,
  uncostedRevenueMinor: 0,
  unitsReturned: 0,
  unitsSold: 20,
};

type EvidenceCoverage = {
  scheduledDayCount: number;
  status: "complete" | "partial" | "unavailable";
  usableDayCount: number;
};

function evidenceCoverage(
  status: EvidenceCoverage["status"],
  usableDayCount: number,
  scheduledDayCount = 6,
): EvidenceCoverage {
  return { scheduledDayCount, status, usableDayCount };
}

function makeCloseEvidence(overrides?: {
  cash?: { cashVarianceMinor: number; coverage: EvidenceCoverage };
  payments?: {
    coverage: EvidenceCoverage;
    coveredTenderValueMinor: number;
    rows: Array<{
      amountMinor: number;
      method: string;
      shareBasisPoints: number;
      tenderUseCount: number;
    }>;
  };
  expenses?: { coverage: EvidenceCoverage };
}) {
  return {
    cash: overrides?.cash ?? {
      cashVarianceMinor: 0,
      coverage: evidenceCoverage("complete", 6),
    },
    expenses: {
      byQuantity: [] as ReportWeekCloseEvidence["expenses"]["bySpend"],
      bySpend: [] as ReportWeekCloseEvidence["expenses"]["bySpend"],
      coverage: overrides?.expenses?.coverage ?? evidenceCoverage("complete", 6),
      coveredQuantity: 0,
      coveredSpendMinor: 0,
      quantityRemainder: null,
      spendRemainder: null,
    },
    payments:
      overrides?.payments ?? {
        coverage: evidenceCoverage("complete", 6),
        coveredTenderValueMinor: 1_000_000,
        rows: [
          {
            amountMinor: 1_000_000,
            method: "cash",
            shareBasisPoints: 10_000,
            tenderUseCount: 10,
          },
        ],
      },
    transactions: {
      coverage: evidenceCoverage("complete", 6),
      transactionCount: 78,
    },
  };
}

function lineageDay(localDate: string, dayClosed: boolean) {
  return {
    dayAvailable: true,
    dayClosed,
    dayStatus: "closed",
    included: true,
    localDate,
    scheduleVersionId: null,
  };
}

function buildPayload(args: {
  accepted?: Record<string, unknown>;
  closeEvidence?: ReturnType<typeof makeCloseEvidence>;
  paymentMix?: unknown;
  scheduleLineage?: Array<ReturnType<typeof lineageDay>>;
}): DailyManagerReportProps {
  return buildAcceptedWeeklyManagerReportPayload({
    accepted: {
      acceptedAt: Date.parse("2026-08-08T20:47:00.000Z"),
      currency: "GHS",
      cycleEndDate: "2026-08-08",
      cycleStartDate: "2026-08-03",
      included: metrics,
      outsideSchedule: { ...metrics, unitsSold: 0 },
      ...args.accepted,
    } as never,
    closeEvidence: args.closeEvidence as never,
    paymentMix: args.paymentMix as never,
    scheduleLineage: (args.scheduleLineage ?? []) as never,
    store: { name: "Wigclub", slug: "wigclub" } as never,
    timezone: "UTC",
    topItems: [],
    topItemsUrl: "https://example.test/top-items",
  });
}

describe("accepted weekly manager report payment mix", () => {
  const factBackedMix = {
    status: "complete" as const,
    totalMinor: 300_000,
    rows: [
      {
        method: "cash" as const,
        amountMinor: 200_000,
        shareBasisPoints: 6_667,
        tenderUseCount: 2,
      },
      {
        method: "mobile_money" as const,
        amountMinor: 100_000,
        shareBasisPoints: 3_333,
        tenderUseCount: 1,
      },
    ],
  };

  it("prefers the baseline's fact-backed mix over frozen close evidence", () => {
    const payload = buildPayload({
      paymentMix: factBackedMix,
      closeEvidence: makeCloseEvidence(),
    });

    // The stored rows, in the contract's method order — the same order and
    // values Reports renders for this baseline.
    expect(payload.paymentTotals).toEqual([
      {
        amount: "GH₵2,000",
        method: "Cash",
        share: "66.67%",
        tenderUseCount: 2,
      },
      {
        amount: "GH₵1,000",
        method: "Mobile Money",
        share: "33.33%",
        tenderUseCount: 1,
      },
    ]);
    // Daily Close coverage wording belongs to close-backed evidence only.
    expect(payload.notes ?? "").not.toContain("scheduled days covered");
  });

  it("publishes no rows and says so when the mix is unavailable", () => {
    const payload = buildPayload({
      paymentMix: { status: "unavailable" },
      closeEvidence: makeCloseEvidence(),
    });

    expect(payload.paymentTotals).toEqual([]);
    expect(payload.notes ?? "").toContain(
      "Payment method details aren't available for this period.",
    );
  });

  it("keeps a known-empty mix distinct from an unavailable one", () => {
    const payload = buildPayload({
      paymentMix: { status: "complete", totalMinor: 0, rows: [] },
      closeEvidence: makeCloseEvidence(),
    });

    expect(payload.paymentTotals).toEqual([]);
    expect(payload.notes ?? "").not.toContain("aren't available");
    // The email names the known-empty state in the SAME words the Reports
    // panel uses, rather than falling silent and looking like a legacy row.
    expect(payload.notes ?? "").toContain(
      "No payments were received in this period.",
    );
  });

  it("keeps close-backed rows for a revision with no stored mix", () => {
    const payload = buildPayload({ closeEvidence: makeCloseEvidence() });
    expect(payload.paymentTotals?.length).toBeGreaterThan(0);
    expect(payload.paymentTotals?.[0]?.method).toBe("Cash");
  });
});

function countedCashSection(payload: DailyManagerReportProps) {
  return payload.reportSections?.find(
    (section) => section.title === "Counted cash variance",
  );
}

describe("accepted weekly manager report payload", () => {
  it("keeps full-coverage closed-day copy when a 6-day lineage is fully closed", () => {
    const payload = buildPayload({
      scheduleLineage: [
        lineageDay("2026-08-03", true),
        lineageDay("2026-08-04", true),
        lineageDay("2026-08-05", true),
        lineageDay("2026-08-06", true),
        lineageDay("2026-08-07", true),
        lineageDay("2026-08-08", true),
      ],
    });

    expect(payload.presentation?.emptyAttentionCopy).toContain(
      "All scheduled days closed.",
    );
    expect(payload.statusSummary).toContain("All scheduled days are closed");
    expect(payload.presentation?.emptyAttentionCopy).not.toContain(
      "6 of 6 scheduled days",
    );
    expect(payload.statusSummary).not.toContain("6 of 6 scheduled days");
  });

  it("discloses partial closed-day counts when the lineage is not fully closed", () => {
    const payload = buildPayload({
      scheduleLineage: [
        lineageDay("2026-08-03", true),
        lineageDay("2026-08-04", false),
        lineageDay("2026-08-05", true),
      ],
    });

    expect(payload.presentation?.emptyAttentionCopy).toContain(
      "2 of 3 scheduled days closed.",
    );
    expect(payload.statusSummary).toContain(
      "2 of 3 scheduled days are closed",
    );
  });

  it("nets mixed daily cash variances into one disclosed weekly total", () => {
    // Two covered days at +6500 and -1000 net to +5500 in the aggregator.
    const over = buildPayload({
      closeEvidence: makeCloseEvidence({
        cash: {
          cashVarianceMinor: 6_500 - 1_000,
          coverage: evidenceCoverage("partial", 5),
        },
      }),
    });
    expect(countedCashSection(over)).toEqual({
      message: "Counted cash was GH₵55 over.",
      meta: "Based on 5 of 6 scheduled days",
      title: "Counted cash variance",
    });

    const short = buildPayload({
      closeEvidence: makeCloseEvidence({
        cash: {
          cashVarianceMinor: 1_000 - 6_500,
          coverage: evidenceCoverage("complete", 6),
        },
      }),
    });
    expect(countedCashSection(short)).toEqual({
      message: "Counted cash was GH₵55 short.",
      meta: undefined,
      title: "Counted cash variance",
    });
  });

  it("renders sales-fold close variance and counted cash variance independently", () => {
    const payload = buildPayload({
      accepted: {
        variancePosture: {
          closeVarianceMinor: -4_200,
          coverage: "complete",
          coveredIncludedDayCount: 6,
          includedDayCount: 6,
        },
      },
      closeEvidence: makeCloseEvidence({
        cash: {
          cashVarianceMinor: 32_000,
          coverage: evidenceCoverage("complete", 6),
        },
      }),
    });

    expect(payload.reportSections).toContainEqual({
      message: "Net close variance was GH₵42 short.",
      title: "Close variance",
    });
    expect(payload.reportSections).toContainEqual({
      message: "Counted cash was GH₵320 over.",
      title: "Counted cash variance",
    });
    const titles = payload.reportSections?.map((section) => section.title);
    expect(titles).toContain("Close variance");
    expect(titles).toContain("Counted cash variance");
  });

  it("normalizes frozen expense product names and pluralizes a single unit", () => {
    const product = {
      productName: "EBIN TINT SPRAY BIG",
      productSku: "KK38-HH5-J6D",
      productSkuId: "sku-1",
      quantity: 1,
      spendMinor: 18_500,
    };
    const evidence = makeCloseEvidence();
    const payload = buildPayload({
      closeEvidence: {
        ...evidence,
        expenses: {
          ...evidence.expenses,
          byQuantity: [product],
          bySpend: [{ ...product, productName: "Packaging net 20pcs " }],
          coveredQuantity: 1,
          coveredSpendMinor: 18_500,
        },
      },
    });

    const [bySpend, byQuantity] = payload.rankedSections ?? [];
    // Frozen evidence keeps the source spelling; only the display is tidied.
    expect(bySpend?.rows[0]?.label).toBe("Packaging Net 20pcs");
    expect(byQuantity?.rows[0]?.label).toBe("Ebin Tint Spray Big");
    expect(byQuantity?.rows[0]?.primary).toBe("1 unit");
    expect(bySpend?.rows[0]?.secondary).toBe("1 unit");
  });

  it("never lets the sales-fold card claim cash matched while counted cash differs", () => {
    const payload = buildPayload({
      accepted: {
        variancePosture: {
          closeVarianceMinor: 0,
          coverage: "complete",
          coveredIncludedDayCount: 6,
          includedDayCount: 6,
        },
      },
      closeEvidence: makeCloseEvidence({
        cash: {
          cashVarianceMinor: 32_000,
          coverage: evidenceCoverage("complete", 6),
        },
      }),
    });

    const closeVariance = payload.reportSections?.find(
      (section) => section.title === "Close variance",
    );
    // The sales lane reconciles recorded sales, not the drawer. If it says
    // "cash matched" it contradicts the counted-cash card standing next to it.
    expect(closeVariance?.message).toBe(
      "Recorded sales matched the closes across the week.",
    );
    expect(closeVariance?.message).not.toMatch(/cash/i);
    expect(payload.reportSections).toContainEqual({
      message: "Counted cash was GH₵320 over.",
      title: "Counted cash variance",
    });
  });

  it("scopes zero-variance copy to coverage and adopts the Reports unavailable copy", () => {
    const complete = buildPayload({
      closeEvidence: makeCloseEvidence({
        cash: { cashVarianceMinor: 0, coverage: evidenceCoverage("complete", 6) },
      }),
    });
    expect(countedCashSection(complete)).toEqual({
      message: "Counted cash matched across the week.",
      meta: undefined,
      title: "Counted cash variance",
    });

    const partial = buildPayload({
      closeEvidence: makeCloseEvidence({
        cash: { cashVarianceMinor: 0, coverage: evidenceCoverage("partial", 4) },
      }),
    });
    expect(countedCashSection(partial)).toEqual({
      message: "Counted cash matched across covered days.",
      meta: "Based on 4 of 6 scheduled days",
      title: "Counted cash variance",
    });

    const unavailable = buildPayload({
      closeEvidence: makeCloseEvidence({
        cash: {
          cashVarianceMinor: 0,
          coverage: evidenceCoverage("unavailable", 0),
        },
      }),
    });
    expect(countedCashSection(unavailable)).toEqual({
      message:
        "Not available — no completed Daily Closes contain this information.",
      title: "Counted cash variance",
    });
    expect(countedCashSection(unavailable)?.meta).toBeUndefined();
  });

  it("renders the unavailable card for legacy rows instead of omitting it", () => {
    const payload = buildPayload({
      accepted: {
        cashVariancePosture: {
          cashVarianceMinor: 0,
          coverage: "unavailable",
          coveredIncludedDayCount: 0,
          includedDayCount: 6,
        },
      },
    });

    expect(countedCashSection(payload)).toEqual({
      message:
        "Not available — no completed Daily Closes contain this information.",
      title: "Counted cash variance",
    });
    expect(countedCashSection(payload)?.meta).toBeUndefined();
  });

  it("qualifies partial payment coverage and discloses share rounding only when shares drift", () => {
    const partialRounded = buildPayload({
      closeEvidence: makeCloseEvidence({
        expenses: { coverage: evidenceCoverage("partial", 4) },
        payments: {
          coverage: evidenceCoverage("partial", 4),
          coveredTenderValueMinor: 900_000,
          rows: [
            {
              amountMinor: 300_000,
              method: "cash",
              shareBasisPoints: 3_333,
              tenderUseCount: 3,
            },
            {
              amountMinor: 300_000,
              method: "card",
              shareBasisPoints: 3_333,
              tenderUseCount: 2,
            },
            {
              amountMinor: 300_000,
              method: "mobile_money",
              shareBasisPoints: 3_333,
              tenderUseCount: 1,
            },
          ],
        },
      }),
    });
    expect(partialRounded.notes).toContain(
      "Payment mix reflects 4 of 6 scheduled days covered.",
    );
    expect(partialRounded.notes).toContain(
      "Shares may not total 100% due to rounding.",
    );
    expect(
      partialRounded.rankedSections?.map((section) => section.coverage),
    ).toEqual([
      "Based on 4 of 6 scheduled days",
      "Based on 4 of 6 scheduled days",
    ]);

    const completeExact = buildPayload({
      closeEvidence: makeCloseEvidence(),
    });
    expect(completeExact.notes).toBeUndefined();
  });
});

describe("accepted weekly manager report top items", () => {
  it("renders the display identity frozen on a new accepted leader", async () => {
    const result = await buildAcceptedWeeklyTopItems(
      {} as never,
      {
        cycleEndDate: "2026-08-08",
        cycleStartDate: "2026-08-03",
        storeId: "store-1",
      } as never,
      { slug: "wigclub" } as never,
      [
        {
          productName: "Accepted Silk Press",
          productSku: "SP-18-FROZEN",
          productSkuId: "sku-1",
          unitsSold: 8,
        },
      ],
    );

    expect(result.topItems).toEqual([
      { detail: "SP-18-FROZEN", name: "Accepted Silk Press", unitsSold: 8 },
    ]);
  });

  it("omits legacy leaders instead of hydrating mutable catalog identity", async () => {
    const t = convexTest(schema, modules);
    const acceptedWeekId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", {
        email: "owner@example.com",
        normalizedEmail: "owner@example.com",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "Accra",
        slug: "accra",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: userId,
        currency: "GHS",
        name: "Wigclub",
        organizationId,
        slug: "wigclub",
      });
      const closeId = await ctx.db.insert("dailyClose", {
        carryForwardWorkItemIds: [],
        completedAt: 1,
        createdAt: 1,
        isCurrent: true,
        operatingDate: "2026-08-08",
        organizationId,
        readiness: {
          blockerCount: 0,
          carryForwardCount: 0,
          readyCount: 1,
          reviewCount: 0,
          status: "ready",
        },
        sourceSubjects: [],
        status: "completed",
        storeId,
        summary: {},
        updatedAt: 1,
      });

      const categoryId = await ctx.db.insert("category", {
        name: "Wigs",
        slug: "wigs",
        storeId,
      });
      const subcategoryId = await ctx.db.insert("subcategory", {
        categoryId,
        name: "Featured",
        slug: "featured",
        storeId,
      });
      const skuLeaders: Array<{
        productSkuId: Id<"productSku">;
        unitsSold: number;
      }> = [];
      let lateProductSkuId: Id<"productSku"> | null = null;

      for (const [index, item] of [
        { name: "Silk Press", sku: "SP-18", units: [3, 5] },
        { name: "Body Wave", sku: "BW-20", units: [2, 4] },
        { name: "Lace Closure", sku: "LC-14", units: [1, 3] },
        { name: "Deep Wave", sku: "DW-22", units: [1, 1] },
      ].entries()) {
        const productId = await ctx.db.insert("product", {
          availability: "live",
          categoryId,
          createdByUserId: userId,
          currency: "GHS",
          inventoryCount: 10,
          name: item.name,
          organizationId,
          slug: item.sku.toLowerCase(),
          storeId,
          subcategoryId,
        });
        const productSkuId = await ctx.db.insert("productSku", {
          images: [],
          inventoryCount: 10,
          price: 100,
          productId,
          quantityAvailable: 10,
          sku: item.sku,
          storeId,
        });
        skuLeaders.push({
          productSkuId,
          unitsSold: item.units.reduce((total, units) => total + units, 0),
        });
        if (index === 3) lateProductSkuId = productSkuId;
        for (const [dayIndex, unitsSold] of item.units.entries()) {
          await ctx.db.insert("reportSkuDay", {
            grossProfitMinor: 0,
            grossSalesMinor: 0,
            netSalesMinor: 0,
            operatingDate: dayIndex === 0 ? "2026-08-03" : "2026-08-08",
            productSkuId,
            refundsMinor: 0,
            storeId,
            uncostedRevenueMinor: 0,
            unitsReturned: 0,
            unitsSold,
          });
        }
      }

      const closeEvidence = {
        cash: {
          cashVarianceMinor: 32_000,
          coverage: { scheduledDayCount: 6, status: "complete" as const, usableDayCount: 6 },
        },
        payments: {
          coveredTenderValueMinor: 1_658_000,
          coverage: { scheduledDayCount: 6, status: "complete" as const, usableDayCount: 6 },
          rows: [
            { amountMinor: 1_098_000, method: "cash", shareBasisPoints: 6_625, tenderUseCount: 63 },
          ],
        },
        expenses: {
          byQuantity: [{ productName: "Silk Press", productSku: "SP-18", productSkuId: skuLeaders[0]!.productSkuId, quantity: 8, spendMinor: 45_000 }],
          bySpend: [{ productName: "Silk Press", productSku: "SP-18", productSkuId: skuLeaders[0]!.productSkuId, quantity: 8, spendMinor: 45_000 }],
          coveredQuantity: 10,
          coveredSpendMinor: 50_000,
          coverage: { scheduledDayCount: 6, status: "complete" as const, usableDayCount: 6 },
          quantityRemainder: { productCount: 2, quantity: 2, spendMinor: 5_000 },
          spendRemainder: { productCount: 2, quantity: 2, spendMinor: 5_000 },
        },
        transactions: {
          coverage: {
            scheduledDayCount: 6,
            status: "complete" as const,
            usableDayCount: 6,
          },
          transactionCount: 78,
        },
      };
      const acceptedWeekId = await ctx.db.insert("reportWeekAccepted", {
        acceptedAt: Date.parse("2026-08-08T20:47:00.000Z"),
        baselineFingerprint: "baseline",
        closeId,
        completeness: { complete: true, reason: "complete" },
        currency: "GHS",
        cutoffObservedAt: Date.parse("2026-08-08T20:47:00.000Z"),
        cycleEndDate: "2026-08-08",
        cycleStartDate: "2026-08-03",
        closeEvidence,
        correction: {
          appliedAt: Date.parse("2026-08-09T12:00:00.000Z"),
          candidateFingerprint: "candidate-v1",
          closeEvidence: {
            ...closeEvidence,
            cash: {
              ...closeEvidence.cash,
              cashVarianceMinor: -12_000,
              coverage: {
                scheduledDayCount: 6,
                status: "partial",
                usableDayCount: 4,
              },
            },
          },
          contractVersion: 1,
          scheduleLineage: [],
          sourceManifestFingerprint: "source-v1",
        },
        included: metrics,
        metricVersion: 1,
        outsideSchedule: { ...metrics, unitsSold: 0 },
        // Both lanes stored: the email's totals combine the lanes, so its
        // payment rows must combine the SAME lanes to reconcile.
        paymentMix: {
          status: "complete" as const,
          totalMinor: 0,
          rows: [
            {
              method: "cash" as const,
              amountMinor: 0,
              shareBasisPoints: 0,
              tenderUseCount: 4,
            },
          ],
        },
        outsideSchedulePaymentMix: {
          status: "complete" as const,
          totalMinor: 0,
          rows: [
            {
              method: "mobile_money" as const,
              amountMinor: 0,
              shareBasisPoints: 0,
              tenderUseCount: 2,
            },
          ],
        },
        priorPeriod: {
          cycleEndDate: "2026-08-02",
          cycleStartDate: "2026-07-27",
          comparabilityReason: "comparable",
          currentScheduledPositionCount: 0,
          equivalentScheduledPositions: true,
          outsideScheduleValues: { ...metrics, unitsSold: 0 },
          priorScheduledPositionCount: 0,
          values: { ...metrics, netSalesMinor: 500 },
        },
        scheduleLineage: [],
        storeId,
        topSkuLeaders: skuLeaders.slice(0, 3),
      });
      if (!lateProductSkuId) throw new Error("missing late SKU fixture");
      await ctx.db.insert("reportSkuDay", {
        grossProfitMinor: 0,
        grossSalesMinor: 0,
        netSalesMinor: 0,
        operatingDate: "2026-08-08",
        productSkuId: lateProductSkuId,
        refundsMinor: 0,
        storeId,
        uncostedRevenueMinor: 0,
        unitsReturned: 0,
        unitsSold: 100,
      });
      return acceptedWeekId;
    });

    const payload = await t.query(getPayload, { acceptedWeekId });

    expect(payload?.topItems).toEqual([]);
    expect(payload?.topItemsUrl).toContain(
      "/wigclub/store/wigclub/reports/weekly?reportId=week%3A2026-08-03&units=true",
    );

    expect(payload).toMatchObject({
      completedBy: "Athena",
      operatingDate: "Aug 3–8, 2026",
      presentation: {
        emptyAttentionCopy:
          "Net sales finished GH₵5 lower than the prior week. 0 of 0 scheduled days closed. Payments were fully accounted for.",
        timestampDate: "Aug 8",
        timestampLabel: "Accepted",
      },
      status: "applied",
      storeName: "Wigclub",
    });
    // The stored fact-backed mix wins over frozen close evidence, and the
    // caller combines BOTH lanes — the same frame the email's totals cover.
    expect(payload?.paymentTotals).toEqual([
      { amount: "GH₵0", method: "Cash", share: "0.00%", tenderUseCount: 4 },
      {
        amount: "GH₵0",
        method: "Mobile Money",
        share: "0.00%",
        tenderUseCount: 2,
      },
    ]);
    expect(payload?.summaryMetrics).toContainEqual({
      detail: "Completed POS transactions",
      label: "Transactions",
      value: "78",
    });
    expect(payload?.rankedSections?.map((section) => section.title)).toEqual([
      "Top expense products by spend",
      "Top expense products by quantity",
    ]);
    expect(payload?.rankedSections?.map((section) => section.coverage)).toEqual([
      undefined,
      undefined,
    ]);
    expect(payload?.reportSections).toContainEqual({
      message: "Counted cash was GH₵320 over.",
      title: "Counted cash variance",
    });

    const corrected = await t.query(getCorrectedPayload, {
      acceptedWeekId,
      candidateFingerprint: "candidate-v1",
    });
    expect(corrected).toMatchObject({
      presentation: {
        previewText: expect.stringContaining("corrected weekly report preview · Not sent"),
        timestampLabel: "Corrected",
      },
      statusLabel: "Report corrected",
    });
    expect(corrected?.reportSections).toContainEqual({
      message: "Counted cash was GH₵120 short.",
      meta: "Based on 4 of 6 scheduled days",
      title: "Counted cash variance",
    });
    expect(
      await t.query(getCorrectedPayload, {
        acceptedWeekId,
        candidateFingerprint: "wrong-candidate",
      }),
    ).toBeNull();

    // The correction may restore the top-sales identity the legacy baseline
    // never froze. Only the corrected preview reads it; the automatic accepted
    // payload stays baseline-only and keeps omitting the section.
    await t.run(async (ctx) => {
      const accepted = await ctx.db.get("reportWeekAccepted", acceptedWeekId);
      await ctx.db.patch("reportWeekAccepted", acceptedWeekId, {
        correction: {
          ...accepted!.correction!,
          topSkuLeaders: accepted!.topSkuLeaders!.map((leader, index) => ({
            productName: ["Silk Press", "Body Wave", "Lace Closure"][index]!,
            productSku: ["SP-18", "BW-20", "LC-14"][index]!,
            productSkuId: leader.productSkuId,
            unitsSold: leader.unitsSold,
          })),
        },
      });
    });
    expect(
      (
        await t.query(getCorrectedPayload, {
          acceptedWeekId,
          candidateFingerprint: "candidate-v1",
        })
      )?.topItems,
    ).toEqual([
      { detail: "SP-18", name: "Silk Press", unitsSold: 8 },
      { detail: "BW-20", name: "Body Wave", unitsSold: 6 },
      { detail: "LC-14", name: "Lace Closure", unitsSold: 4 },
    ]);
    expect((await t.query(getPayload, { acceptedWeekId }))?.topItems).toEqual([]);
  });
});
