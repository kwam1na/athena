/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  WEEKLY_INVENTORY_OPEN_WORK_ITEM_LIMIT,
  WEEKLY_INVENTORY_OPEN_WORK_REPAIR_LIMIT,
} from "../operations/operationalWorkItems";
import {
  MAX_WEEKLY_FACTS,
  availableWeekCurrent,
  materializeAcceptedWeek,
  rebuildCurrentWeek,
} from "./weekly";
import {
  getAcceptedWeeklyDetail,
  getActiveWeeklyBriefing,
  listAcceptedWeeklyHistory,
} from "./queries";
import { repairCurrentWeeklyProjectionWithCtx } from "./weeklyRepair";
import { verifyCurrentWeekWithCtx } from "./verify";

const modules = import.meta.glob("../**/*.ts");
const NOW = Date.parse("2026-07-04T20:00:00.000Z");
const WEEKLY_SCALE_EVIDENCE = {
  facts: {
    observedMaximum: 93,
    representativeCount: 930,
  },
  openWorkMembers: {
    observedMaximum: null,
    localRepresentativeCount: 10,
  },
  historyWeeks: {
    observedMaximum: null,
    localRepresentativeCount: 10,
  },
} as const;
/**
 * Only the 93-fact maximum has a de-identified observed artifact (documented
 * beside `MAX_FACTS_PER_DAY` in `sweeper.ts`). Open Work and accepted-history
 * fixtures are deliberately named local representatives, never production
 * maxima. The plan's F-R86 wider-rollout gate remains blocked until those two
 * aggregate maxima are captured and their real 10x fixtures pass.
 */
const WEEKLY_SCALE_ROLLOUT_GATE = {
  missingObservedMaxima: ["openWorkMembers", "historyWeeks"],
  status: "blocked",
} as const;
const REPRESENTATIVE_FACTS = WEEKLY_SCALE_EVIDENCE.facts.representativeCount;
const REPRESENTATIVE_OPEN_WORK_MEMBERS =
  WEEKLY_SCALE_EVIDENCE.openWorkMembers.localRepresentativeCount;
const REPRESENTATIVE_HISTORY_WEEKS =
  WEEKLY_SCALE_EVIDENCE.historyWeeks.localRepresentativeCount;
const HISTORY_PAGE_SIZE = 4;
const PUBLIC_READ_P95_LIMIT_MS = 2_000;
const PUBLIC_READ_SAMPLE_COUNT = 20;
const INCLUDED_DATES = [
  "2026-06-29",
  "2026-06-30",
  "2026-07-01",
  "2026-07-02",
  "2026-07-03",
  "2026-07-04",
];
const REPRESENTATIVE_FACTS_PER_DAY =
  REPRESENTATIVE_FACTS / INCLUDED_DATES.length;

vi.mock("./access", () => ({
  requireReportsStoreAccess: vi.fn(),
}));
import { requireReportsStoreAccess } from "./access";

// The admission rail's identity port: convex-test has no auth provider, so an
// unstubbed identity would turn every read-budget measurement below into an
// anonymous denial. Admission itself is covered in `reportsAdmission.test.ts`.
vi.mock("../lib/athenaUserAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/athenaUserAuth")>()),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
}));
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";

vi.mock("../platform/capabilityCatalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform/capabilityCatalog")>()),
  isWeeklyReportingEnabledForStoreDoc: vi.fn(),
}));
import { isWeeklyReportingEnabledForStoreDoc } from "../platform/capabilityCatalog";

function handlerOf(fn: unknown): (...args: any[]) => Promise<any> {
  return (fn as unknown as { _handler: (...args: any[]) => Promise<any> })
    ._handler;
}

beforeEach(() => {
  vi.mocked(requireReportsStoreAccess).mockResolvedValue({} as never);
  vi.mocked(isWeeklyReportingEnabledForStoreDoc).mockReturnValue(true);
  vi.mocked(requireAuthenticatedAthenaUserWithCtx).mockResolvedValue({
    _id: "athena-user",
  } as never);
});

async function seedStore(ctx: MutationCtx, slug: string) {
  const userId = await ctx.db.insert("athenaUser", { email: `${slug}@test` });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: slug,
    slug,
  });
  const storeId = await ctx.db.insert("store", {
    createdByUserId: userId,
    currency: "GHS",
    name: slug,
    organizationId,
    slug,
    weeklyObservedAtVerification: {
      status: "complete",
      missingCount: 0,
      startedAt: NOW,
      completedAt: NOW,
    },
    weeklyReportingCycleAnchorVerification: {
      status: "complete",
      missingCount: 0,
      startedAt: NOW,
      completedAt: NOW,
    },
  });
  await ctx.db.insert("storeSchedule", {
    organizationId,
    storeId,
    timezone: "UTC",
    weeklyWindows: [],
    weeklyClosedDays: [0],
    dateExceptions: [],
    reportingCycleStartsOn: 1,
    effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
    status: "active",
    source: "admin",
    createdAt: NOW,
    updatedAt: NOW,
  });
  return storeId;
}

async function seedAcceptedFactScaleFixture(args: {
  factCount: number;
  slug: string;
  t: ReturnType<typeof convexTest>;
}) {
  return args.t.run(async (ctx) => {
    const storeId = await seedStore(ctx, args.slug);
    const store = await ctx.db.get("store", storeId);
    if (!store) throw new Error("missing scale fixture store");
    const closeId = await ctx.db.insert("dailyClose", {
      storeId,
      organizationId: store.organizationId,
      operatingDate: "2026-07-04",
      status: "completed",
      lifecycleStatus: "active",
      isCurrent: true,
      readiness: {
        status: "ready",
        blockerCount: 0,
        reviewCount: 0,
        carryForwardCount: 0,
        readyCount: 0,
      },
      summary: {},
      sourceSubjects: [],
      carryForwardWorkItemIds: [],
      reportSnapshot: {
        snapshotContractVersion: 2,
        closeMetadata: {
          operatingDate: "2026-07-04",
          storeId,
          organizationId: store.organizationId,
          startAt: NOW - 1,
          endAt: NOW,
          completedAt: NOW,
          carryForwardWorkItemIds: [],
        },
        readiness: {
          status: "ready",
          blockerCount: 0,
          reviewCount: 0,
          carryForwardCount: 0,
          readyCount: 0,
        },
        summary: {},
        reviewedItems: [],
        carryForwardItems: [],
        carryForwardGroups: [],
        frozenSyncedSaleInventoryReviewGroups: [],
        readyItems: [],
        openWorkMembership: {
          completeness: "complete",
          observedLogicalCount: 0,
        },
        sourceSubjects: [],
      },
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: NOW,
    });
    await ctx.db.insert("reportDay", {
      storeId,
      operatingDate: "2026-07-04",
      currency: "GHS",
      status: "reconciled",
      grossSalesMinor: 0,
      netSalesMinor: 0,
      refundsMinor: 0,
      unitsSold: 0,
      unitsReturned: 0,
      uncostedRevenueMinor: 0,
      grossProfitMinor: 0,
      paymentsCollectedMinor: 0,
      paymentsRefundedMinor: 0,
      paymentAllocatedMinor: 0,
      paymentPosture: {
        allocatedMinor: 0,
        allocationCoverage: "complete",
        allocationOmittedMinor: 0,
        collectedMinor: 0,
        hasInvalidAllocation: false,
        refundedMinor: 0,
        unsettledMinor: 0,
      },
      flags: {
        hasUncostedRevenue: false,
        mixedCurrency: false,
        quarantinedFactCount: 0,
      },
      closeId,
      closeAcceptedAt: NOW,
      foldedAt: NOW + 1,
      foldVersion: 1,
      factCount: args.factCount,
      lastFactRecordedAt: NOW,
    });
    for (let index = 0; index < args.factCount; index += 1) {
      await ctx.db.insert("reportFact", {
        storeId,
        sourceDomain: "pos",
        sourceId: `${args.slug}-sale-${index}`,
        lineId: `line-${index}`,
        factKind: "sale",
        fingerprint: `${args.slug}-fp-${index}`,
        fingerprintVersion: 2,
        occurredAt: NOW,
        recordedAt: NOW,
        observedAt: NOW,
        operatingDate: INCLUDED_DATES[index % INCLUDED_DATES.length]!,
        currency: "GHS",
        grossAmountMinor: 100,
        netAmountMinor: 100,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
        quantity: 1,
      });
    }
    return { closeId, storeId };
  });
}

type ProjectionReadCounts = Record<string, number>;

function countProjectionReads(ctx: MutationCtx): {
  ctx: MutationCtx;
  reads: ProjectionReadCounts;
} {
  const reads: ProjectionReadCounts = {};
  const count = (table: string, documents: number) => {
    reads[table] = (reads[table] ?? 0) + documents;
  };
  const wrapQuery = (table: string, query: any): any =>
    new Proxy(query, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        return (...args: any[]) => {
          const result = value.apply(target, args);
          if (
            property === "withIndex" ||
            property === "order" ||
            property === "filter"
          ) {
            return wrapQuery(table, result);
          }
          if (property === "paginate") {
            return Promise.resolve(result).then((page) => {
              count(table, page.page.length + (page.isDone ? 0 : 1));
              return page;
            });
          }
          if (property === "take" || property === "collect") {
            return Promise.resolve(result).then((rows) => {
              count(table, rows.length);
              return rows;
            });
          }
          if (property === "first" || property === "unique") {
            return Promise.resolve(result).then((row) => {
              count(table, row ? 1 : 0);
              return row;
            });
          }
          return result;
        };
      },
    });

  return {
    ctx: {
      ...ctx,
      db: {
        ...ctx.db,
        get: async (table: string, id: string) => {
          const row = await ctx.db.get(table as never, id as never);
          count(table, row ? 1 : 0);
          return row;
        },
        query: (table: string) =>
          wrapQuery(table, ctx.db.query(table as never)),
      },
    } as unknown as MutationCtx,
    reads,
  };
}

function percentile95(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

async function measurePublicProjectionRead(args: {
  args: Record<string, unknown>;
  fn: unknown;
  t: ReturnType<typeof convexTest>;
}) {
  const durations: number[] = [];
  let firstReads: ProjectionReadCounts | undefined;
  let firstResult: unknown;
  for (let index = 0; index < PUBLIC_READ_SAMPLE_COUNT; index += 1) {
    const sample = await args.t.run(async (ctx) => {
      const instrumented = countProjectionReads(ctx);
      const startedAt = performance.now();
      const result = await handlerOf(args.fn)(instrumented.ctx, args.args);
      return {
        durationMs: performance.now() - startedAt,
        reads: instrumented.reads,
        result,
      };
    });
    durations.push(sample.durationMs);
    firstReads ??= sample.reads;
    firstResult ??= sample.result;
  }
  return {
    p95Ms: percentile95(durations),
    reads: firstReads ?? {},
    result: firstResult,
  };
}

describe("weekly accepted scale proof", () => {
  it("keeps the exact shared fact cap complete and the first overflow unpublished", async () => {
    const t = convexTest(schema, modules);
    const empty = await seedAcceptedFactScaleFixture({
      factCount: 0,
      slug: "weekly-fact-empty",
      t,
    });
    const atCap = await seedAcceptedFactScaleFixture({
      factCount: MAX_WEEKLY_FACTS,
      slug: "weekly-fact-cap",
      t,
    });
    const beyondCap = await seedAcceptedFactScaleFixture({
      factCount: MAX_WEEKLY_FACTS + 1,
      slug: "weekly-fact-overflow",
      t,
    });

    await t.run(async (ctx) => {
      expect(
        await materializeAcceptedWeek({
          acceptedAt: NOW,
          closeId: empty.closeId,
          ctx,
          cutoffObservedAt: NOW,
          storeId: empty.storeId,
        }),
      ).toBe("created");
      expect(
        await materializeAcceptedWeek({
          acceptedAt: NOW,
          closeId: atCap.closeId,
          ctx,
          cutoffObservedAt: NOW,
          storeId: atCap.storeId,
        }),
      ).toBe("created");
      expect(
        await materializeAcceptedWeek({
          acceptedAt: NOW,
          closeId: beyondCap.closeId,
          ctx,
          cutoffObservedAt: NOW,
          storeId: beyondCap.storeId,
        }),
      ).toBe("incomplete");
      expect(
        await ctx.db
          .query("reportWeekAccepted")
          .withIndex("by_storeId_cycleStartDate", (q) =>
            q
              .eq("storeId", beyondCap.storeId)
              .eq("cycleStartDate", "2026-06-29"),
          )
          .unique(),
      ).toBeNull();
      expect(
        await ctx.db
          .query("reportWeekAccepted")
          .withIndex("by_storeId_cycleStartDate", (q) =>
            q.eq("storeId", empty.storeId).eq("cycleStartDate", "2026-06-29"),
          )
          .unique(),
      ).toMatchObject({ included: { netSalesMinor: 0 } });
    });
  });

  it("proves the known fact 10x and representative bounded lanes while keeping wider rollout blocked", async () => {
    expect(REPRESENTATIVE_FACTS).toBe(
      WEEKLY_SCALE_EVIDENCE.facts.observedMaximum * 10,
    );
    expect(WEEKLY_SCALE_EVIDENCE.openWorkMembers.observedMaximum).toBeNull();
    expect(WEEKLY_SCALE_EVIDENCE.historyWeeks.observedMaximum).toBeNull();
    expect(WEEKLY_SCALE_ROLLOUT_GATE).toEqual({
      missingObservedMaxima: ["openWorkMembers", "historyWeeks"],
      status: "blocked",
    });
    expect(REPRESENTATIVE_FACTS).toBeLessThan(MAX_WEEKLY_FACTS);
    expect(REPRESENTATIVE_OPEN_WORK_MEMBERS).toBeLessThanOrEqual(
      WEEKLY_INVENTORY_OPEN_WORK_ITEM_LIMIT,
    );
    const t = convexTest(schema, modules);
    let firstHistoryCursor: string | null = null;
    let firstHistoryIds: string[] = [];
    const { closeId, storeId } = await t.run(async (ctx) => {
      const primaryStoreId = await seedStore(ctx, "weekly-scale-primary");
      const otherStoreId = await seedStore(ctx, "weekly-scale-other");

      for (let index = 0; index < REPRESENTATIVE_FACTS; index += 1) {
        const operatingDate = INCLUDED_DATES[index % INCLUDED_DATES.length]!;
        const occurredAt = Date.parse(`${operatingDate}T12:00:00.000Z`);
        await ctx.db.insert("reportFact", {
          storeId: primaryStoreId,
          sourceDomain: "pos",
          sourceId: `sale-${index}`,
          lineId: `line-${index}`,
          factKind: "sale",
          fingerprint: `fp-${index}`,
          fingerprintVersion: 2,
          occurredAt,
          recordedAt: NOW,
          observedAt: NOW,
          operatingDate,
          currency: "GHS",
          grossAmountMinor: 100,
          netAmountMinor: 100,
          taxAmountMinor: 0,
          discountAmountMinor: 0,
          quantity: 1,
        });
        await ctx.db.insert("posTransaction", {
          completedAt: occurredAt,
          payments: [{ amount: 100, method: "cash", timestamp: occurredAt }],
          status: "completed",
          storeId: primaryStoreId,
          subtotal: 100,
          tax: 0,
          total: 100,
          totalPaid: 100,
          transactionNumber: `scale-${index}`,
        });
      }
      await ctx.db.insert("reportFact", {
        storeId: otherStoreId,
        sourceDomain: "pos",
        sourceId: "foreign-sale",
        lineId: "foreign-line",
        factKind: "sale",
        fingerprint: "foreign-fp",
        fingerprintVersion: 2,
        occurredAt: NOW,
        recordedAt: NOW,
        observedAt: NOW,
        operatingDate: INCLUDED_DATES[0]!,
        currency: "GHS",
        grossAmountMinor: 999_999,
        netAmountMinor: 999_999,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
        quantity: 999,
      });
      const primaryStore = await ctx.db.get("store", primaryStoreId);
      if (!primaryStore) throw new Error("missing scale fixture store");
      const closeId = await ctx.db.insert("dailyClose", {
        storeId: primaryStoreId,
        organizationId: primaryStore.organizationId,
        operatingDate: "2026-07-04",
        status: "completed",
        lifecycleStatus: "active",
        isCurrent: true,
        readiness: {
          status: "ready",
          blockerCount: 0,
          reviewCount: 0,
          carryForwardCount: 0,
          readyCount: 0,
        },
        // The close accepted exactly what the day's sources add up to, so the
        // independently recomputed variance lane expects zero.
        summary: { salesTotal: REPRESENTATIVE_FACTS_PER_DAY * 100 },
        sourceSubjects: [],
        carryForwardWorkItemIds: [],
        reportSnapshot: {
          snapshotContractVersion: 2,
          closeMetadata: {
            operatingDate: "2026-07-04",
            storeId: primaryStoreId,
            organizationId: primaryStore.organizationId,
            startAt: NOW - 1,
            endAt: NOW,
            completedAt: NOW,
            carryForwardWorkItemIds: [],
          },
          readiness: {
            status: "ready",
            blockerCount: 0,
            reviewCount: 0,
            carryForwardCount: 0,
            readyCount: 0,
          },
          summary: {},
          reviewedItems: [],
          carryForwardItems: [],
          carryForwardGroups: [],
          frozenSyncedSaleInventoryReviewGroups: [],
          readyItems: [],
          openWorkMembership: {
            completeness: "complete",
            observedLogicalCount: 0,
          },
          sourceSubjects: [],
        },
        createdAt: NOW,
        updatedAt: NOW,
        completedAt: NOW,
      });
      for (const operatingDate of [...INCLUDED_DATES, "2026-07-05"]) {
        const factCount =
          operatingDate === "2026-07-05" ? 0 : REPRESENTATIVE_FACTS_PER_DAY;
        await ctx.db.insert("reportDay", {
          storeId: primaryStoreId,
          operatingDate,
          currency: "GHS",
          status: operatingDate === "2026-07-04" ? "reconciled" : "open",
          grossSalesMinor: factCount * 100,
          netSalesMinor: factCount * 100,
          refundsMinor: 0,
          unitsSold: 0,
          unitsReturned: 0,
          uncostedRevenueMinor: factCount * 100,
          grossProfitMinor: factCount === 0 ? 0 : null,
          paymentsCollectedMinor: 0,
          paymentsRefundedMinor: 0,
          paymentAllocatedMinor: 0,
          paymentPosture: {
            allocatedMinor: 0,
            allocationCoverage: "complete",
            allocationOmittedMinor: 0,
            collectedMinor: 0,
            hasInvalidAllocation: false,
            refundedMinor: 0,
            unsettledMinor: 0,
          },
          flags: {
            hasUncostedRevenue: factCount > 0,
            mixedCurrency: false,
            quarantinedFactCount: 0,
          },
          ...(operatingDate === "2026-07-04"
            ? {
                closeId,
                closeAcceptedAt: NOW,
                closeVarianceMinor: 0,
                foldedAt: NOW + 1,
              }
            : {}),
          foldVersion: 1,
          factCount,
          lastFactRecordedAt: NOW,
        });
      }
      return { closeId, storeId: primaryStoreId };
    });

    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("storeSchedule")
          .withIndex("by_storeId_status_effectiveFrom", (q) =>
            q.eq("storeId", storeId),
          )
          .take(102),
      ).toHaveLength(1);
      const outcome = await materializeAcceptedWeek({
        acceptedAt: NOW,
        closeId,
        ctx,
        cutoffObservedAt: NOW,
        storeId,
      });
      expect(outcome).toBe("created");
      const accepted = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();
      expect(accepted?.included).toMatchObject({
        grossSalesMinor: REPRESENTATIVE_FACTS * 100,
        netSalesMinor: REPRESENTATIVE_FACTS * 100,
        unitsSold: REPRESENTATIVE_FACTS,
      });
      expect(accepted?.outsideSchedule.netSalesMinor).toBe(0);

      for (
        let index = 0;
        index < REPRESENTATIVE_OPEN_WORK_MEMBERS;
        index += 1
      ) {
        await ctx.db.insert("operationalWorkItem", {
          approvalState: "not_required",
          createdAt: NOW,
          metadata: { localTransactionId: `sale-${index}` },
          organizationId: (await ctx.db.get("store", storeId))!.organizationId,
          priority: "normal",
          productSkuId:
            "000000000000000000000001001productSku" as Id<"productSku">,
          status: "open",
          storeId,
          title: "Review inventory",
          type: "synced_sale_inventory_review",
        });
      }
      expect(await rebuildCurrentWeek(ctx, storeId, NOW)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(current?.inventoryAttention).toMatchObject({
        completeness: "complete",
        newCount: 1,
        observedCount: 1,
        overflow: false,
        groups: [expect.objectContaining({ memberCount: 10 })],
      });

      const factsBeforeRepair = await ctx.db
        .query("reportFact")
        .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
        .take(REPRESENTATIVE_FACTS + 1);
      expect(
        await repairCurrentWeeklyProjectionWithCtx(ctx, { now: NOW, storeId }),
      ).toEqual({ outcome: "rebuilt" });
      const factsAfterRepair = await ctx.db
        .query("reportFact")
        .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
        .take(REPRESENTATIVE_FACTS + 1);
      // Fact IDs, fingerprints and knowledge time all survive a repair: an
      // acceptance cutoff is only as immutable as the columns it reads.
      const ledgerIdentity = (facts: typeof factsAfterRepair) =>
        facts.map((fact) => ({
          _id: fact._id,
          fingerprint: fact.fingerprint,
          fingerprintVersion: fact.fingerprintVersion,
          observedAt: fact.observedAt,
        }));
      expect(ledgerIdentity(factsAfterRepair)).toEqual(
        ledgerIdentity(factsBeforeRepair),
      );
      expect(
        factsAfterRepair.every(
          (fact) => fact.observedAt !== undefined && fact.fingerprint.length > 0,
        ),
      ).toBe(true);
      if (!accepted) throw new Error("missing accepted scale fixture");
      expect(
        await ctx.db
          .query("reportWeekAccepted")
          .withIndex("by_storeId_cycleStartDate", (q) =>
            q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
          )
          .unique(),
      ).toMatchObject({ _id: accepted._id });

      expect(await verifyCurrentWeekWithCtx(ctx, storeId)).toMatchObject({
        amendmentMatches: true,
        closeMatches: true,
        daysChecked: 7,
        includedDifferences: [],
        inventoryMatches: true,
        matches: true,
        outcome: "verified",
        outsideScheduleDifferences: [],
        scheduleMatches: true,
        truncated: false,
        varianceMatches: true,
      });

      const { _creationTime, _id, ...acceptedFields } = accepted;
      for (let index = 0; index < REPRESENTATIVE_HISTORY_WEEKS; index += 1) {
        await ctx.db.insert("reportWeekAccepted", {
          ...acceptedFields,
          acceptedAt: NOW - index - 1,
          baselineFingerprint: `history-${index}`,
          cycleEndDate: `2026-05-${String(index + 2).padStart(2, "0")}`,
          cycleStartDate: `2026-05-${String(index + 1).padStart(2, "0")}`,
        });
      }
      const firstHistoryPage = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_acceptedAt", (q) => q.eq("storeId", storeId))
        .order("desc")
        .paginate({ cursor: null, numItems: HISTORY_PAGE_SIZE });
      firstHistoryCursor = firstHistoryPage.continueCursor;
      firstHistoryIds = firstHistoryPage.page.map((week) => String(week._id));
      expect(firstHistoryPage.page).toHaveLength(HISTORY_PAGE_SIZE);
      expect(
        firstHistoryPage.page.every((week) => week.storeId === storeId),
      ).toBe(true);
    });

    const secondHistoryPage = await t.run(async (ctx) =>
      ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_acceptedAt", (q) => q.eq("storeId", storeId))
        .order("desc")
        .paginate({
          cursor: firstHistoryCursor,
          numItems: HISTORY_PAGE_SIZE,
        }),
    );
    expect(secondHistoryPage.page).toHaveLength(HISTORY_PAGE_SIZE);
    expect(
      new Set([
        ...firstHistoryIds,
        ...secondHistoryPage.page.map((week) => String(week._id)),
      ]).size,
    ).toBe(HISTORY_PAGE_SIZE * 2);
    expect(
      secondHistoryPage.page.every((week) => week.storeId === storeId),
    ).toBe(true);

    const active = await measurePublicProjectionRead({
      args: { storeId },
      fn: getActiveWeeklyBriefing,
      t,
    });
    const history = await measurePublicProjectionRead({
      args: {
        storeId,
        paginationOpts: { cursor: null, numItems: HISTORY_PAGE_SIZE },
      },
      fn: listAcceptedWeeklyHistory,
      t,
    });
    const detail = await measurePublicProjectionRead({
      args: { reportId: "week:2026-06-29", storeId },
      fn: getAcceptedWeeklyDetail,
      t,
    });

    expect(active.result).toMatchObject({ status: "available" });
    expect(history.result).toMatchObject({
      isDone: false,
      page: [
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      ],
    });
    expect(detail.result).toMatchObject({ cycleStartDate: "2026-06-29" });
    // The active briefing projects inventory attention LIVE rather than from
    // the materialized document, so it now also resolves the frame's schedule
    // and reads the open synced-sale review lanes. Expressed through the
    // representative constant, not a literal: this is a budget, and the lane
    // is capped at WEEKLY_INVENTORY_OPEN_WORK_ITEM_LIMIT rather than growing
    // with the store's queue (asserted above and bounded below).
    expect(active.reads).toEqual({
      operationalWorkItem: REPRESENTATIVE_OPEN_WORK_MEMBERS,
      oversizedOperationalWorkRepair: 0,
      reportWeekAccepted: 1,
      reportWeekCurrent: 1,
      storeSchedule: 1,
    });
    expect(active.reads.operationalWorkItem).toBeLessThanOrEqual(
      WEEKLY_INVENTORY_OPEN_WORK_ITEM_LIMIT + 1,
    );
    expect(active.reads.oversizedOperationalWorkRepair).toBeLessThanOrEqual(
      WEEKLY_INVENTORY_OPEN_WORK_REPAIR_LIMIT + 1,
    );
    expect(history.reads).toEqual({
      reportWeekAccepted: HISTORY_PAGE_SIZE + 1,
    });
    expect(detail.reads).toEqual({ reportWeekAccepted: 1 });
    expect(active.p95Ms).toBeLessThanOrEqual(PUBLIC_READ_P95_LIMIT_MS);
    expect(history.p95Ms).toBeLessThanOrEqual(PUBLIC_READ_P95_LIMIT_MS);
    expect(detail.p95Ms).toBeLessThanOrEqual(PUBLIC_READ_P95_LIMIT_MS);
  });
});
