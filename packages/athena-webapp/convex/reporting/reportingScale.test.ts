import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";

import { recognizeCommerceEvent } from "./facts";
import {
  applyInboundValuation,
  applyOutboundValuation,
  createEmptyValuationPosition,
  knownUnitCostBasis,
} from "./inventory/valuation";
import { buildCurrentInventoryProjection } from "./projections/currentInventory";
import { buildDailyProjection } from "./projections/daily";
import { buildSkuDayProjection, type SkuDayFact } from "./projections/skuDay";
import { listSkuDay, REPORTING_PUBLIC_PAGE_SIZE_MAX } from "./public";
import { adaptPosCompleted } from "./sourceAdapters/pos";
import { adaptServiceCompletion } from "./sourceAdapters/service";
import { adaptSettlement } from "./sourceAdapters/settlement";
import { adaptStorefrontStatus } from "./sourceAdapters/storefront";

const SCALE = {
  allocations: 6_640,
  inventoryMovements: 9_830,
  onlineOrderLines: 1_000,
  onlineOrders: 1_000,
  posLines: 16_180,
  posTransactions: 6_540,
  serviceCases: 1_000,
  skuEvents: 11_210,
  skus: 17_880,
} as const;

const OVERVIEW_P95_TARGET_MS = 2_000;
const SKU_AGGREGATE_P95_TARGET_MS = 3_000;

type CommerceFacts = ReturnType<typeof recognizeCommerceEvent>;

type ScaleRow = { _id: string; [key: string]: unknown };

function createPublicScaleContext() {
  const skuRows = Array.from(
    { length: SCALE.skus * 2 },
    (_, index): ScaleRow => {
      const storeNumber = index < SCALE.skus ? 1 : 2;
      const skuIndex = index % SCALE.skus;
      return {
        _id: `sku-day-${storeNumber}-${skuIndex}`,
        generationId: `generation-${storeNumber}`,
        metric: "net_sales",
        operatingDate: "2026-07-09",
        productSkuId: `sku-${storeNumber}-${skuIndex}`,
        scheduleVersionId: `schedule-${storeNumber}`,
        storeId: `store-${storeNumber}`,
      };
    },
  );
  const tables: Record<string, ScaleRow[]> = {
    athenaUser: [
      {
        _id: "athena-user-1",
        email: "admin@example.com",
        normalizedEmail: "admin@example.com",
      },
    ],
    organizationMember: [
      {
        _id: "membership-1",
        organizationId: "org-1",
        role: "full_admin",
        userId: "athena-user-1",
      },
    ],
    reportingProjectionActivation: [
      {
        _id: "activation-1",
        activatedAt: 100,
        factContractVersion: 1,
        generationId: "generation-1",
        metricContractVersion: 1,
        organizationId: "org-1",
        projectionKind: "sku_day",
        projectionContractVersion: 1,
        storeId: "store-1",
      },
      {
        _id: "activation-2",
        activatedAt: 100,
        factContractVersion: 1,
        generationId: "generation-2",
        metricContractVersion: 1,
        organizationId: "org-2",
        projectionKind: "sku_day",
        projectionContractVersion: 1,
        storeId: "store-2",
      },
    ],
    reportingProjectionGeneration: [
      {
        _id: "generation-1",
        factContractVersion: 2,
        metricContractVersion: 1,
        organizationId: "org-1",
        projectionKind: "sku_day",
        projectionContractVersion: 2,
        sourceWatermark: 100,
        stableWatermark: 100,
        status: "active",
        storeId: "store-1",
      },
      {
        _id: "generation-2",
        factContractVersion: 2,
        metricContractVersion: 1,
        organizationId: "org-2",
        projectionKind: "sku_day",
        projectionContractVersion: 2,
        sourceWatermark: 100,
        stableWatermark: 100,
        status: "active",
        storeId: "store-2",
      },
    ],
    posLifecycleJournal: [],
    reportingReadBundleActivation: [
      { _id: "bundle-activation-1", activatedAt: 100, bundleId: "bundle-1", organizationId: "org-1", storeId: "store-1" },
      { _id: "bundle-activation-2", activatedAt: 100, bundleId: "bundle-2", organizationId: "org-2", storeId: "store-2" },
    ],
    reportingReadBundle: [
      { _id: "bundle-1", censusToken: "census-1", factContractVersion: 2, grantId: "grant-1", members: [{ generationId: "generation-1", projectionKind: "sku_day", workspaceEpochId: "epoch-1" }], metricContractVersion: 1, organizationId: "org-1", projectionContractVersion: 2, reconciliationId: "reconciliation-1", sourceCensusHash: "census-hash-1", sourceWatermark: 100, status: "active", storeId: "store-1" },
      { _id: "bundle-2", censusToken: "census-2", factContractVersion: 2, grantId: "grant-2", members: [{ generationId: "generation-2", projectionKind: "sku_day", workspaceEpochId: "epoch-2" }], metricContractVersion: 1, organizationId: "org-2", projectionContractVersion: 2, reconciliationId: "reconciliation-2", sourceCensusHash: "census-hash-2", sourceWatermark: 100, status: "active", storeId: "store-2" },
    ],
    reportingPosSourceReconciliation: [
      { _id: "reconciliation-1", censusToken: "census-1", completedAt: 100, factSnapshotWatermark: 100, grantId: "grant-1", organizationId: "org-1", runId: "source-run-1", sourceCensusHash: "census-hash-1", status: "verified", storeId: "store-1", unexplainedCount: 0 },
      { _id: "reconciliation-2", censusToken: "census-2", completedAt: 100, factSnapshotWatermark: 100, grantId: "grant-2", organizationId: "org-2", runId: "source-run-2", sourceCensusHash: "census-hash-2", status: "verified", storeId: "store-2", unexplainedCount: 0 },
    ],
    reportingRun: [
      { _id: "source-run-1", backfillAuthorizationGrantId: "grant-1", censusToken: "census-1", factSnapshotWatermark: 100, frozenWatermark: 100, organizationId: "org-1", runType: "backfill", sourceCensusHash: "census-hash-1", status: "completed", storeId: "store-1" },
      { _id: "source-run-2", backfillAuthorizationGrantId: "grant-2", censusToken: "census-2", factSnapshotWatermark: 100, frozenWatermark: 100, organizationId: "org-2", runType: "backfill", sourceCensusHash: "census-hash-2", status: "completed", storeId: "store-2" },
    ],
    reportingSkuDayProjection: skuRows,
    store: [
      { _id: "store-1", organizationId: "org-1" },
      { _id: "store-2", organizationId: "org-2" },
    ],
    users: [
      { _id: "auth-user-1", email: "admin@example.com" },
    ],
  };
  const reads = { maxPageSize: 0, pageCount: 0, returnedRows: 0 };
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "auth-user-1|session-1" }),
    },
    db: {
      get: async (table: string, id: string) =>
        tables[table]?.find((row) => row._id === id) ?? null,
      query: (table: string) => {
        const filters: Array<[string, unknown]> = [];
        const builder = {
          eq(field: string, value: unknown) {
            filters.push([field, value]);
            return builder;
          },
        };
        const matchingRows = () =>
          (tables[table] ?? []).filter((row) =>
            filters.every(([field, value]) => row[field] === value),
          );
        const chain = {
          collect: async () => matchingRows(),
          filter: (apply: Function) => {
            const q = { field: () => undefined, lte: () => true };
            apply(q);
            return chain;
          },
          first: async () => matchingRows()[0] ?? null,
          order: (_direction: "asc" | "desc") => chain,
          paginate: async (options: {
            cursor: string | null;
            numItems: number;
          }) => {
            reads.maxPageSize = Math.max(reads.maxPageSize, options.numItems);
            reads.pageCount += 1;
            const rows = matchingRows();
            const offset = options.cursor ? Number(options.cursor) : 0;
            const page = rows.slice(offset, offset + options.numItems);
            const next = offset + page.length;
            reads.returnedRows += page.length;
            return {
              continueCursor: String(next),
              isDone: next >= rows.length,
              page,
            };
          },
          take: async (limit: number) => matchingRows().slice(0, limit),
          withIndex: (_indexName: string, apply: (q: typeof builder) => unknown) => {
            apply(builder);
            return chain;
          },
        };
        return chain;
      },
    },
  };
  return { ctx, reads, skuRows };
}

function percentile95(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  return (
    sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY
  );
}

function measureP95<T>(iterations: number, build: () => T) {
  build();
  const samples: number[] = [];
  let value!: T;
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    value = build();
    samples.push(performance.now() - startedAt);
  }
  return { p95Ms: percentile95(samples), value };
}

function buildCommerceFixture() {
  const facts: CommerceFacts = [];
  let globalLineIndex = 0;

  for (
    let transactionIndex = 0;
    transactionIndex < SCALE.posTransactions;
    transactionIndex += 1
  ) {
    const lineCount = transactionIndex < 3_100 ? 3 : 2;
    const lines = Array.from({ length: lineCount }, () => {
      const lineIndex = globalLineIndex;
      globalLineIndex += 1;
      return {
        cogsKnownMinor: 300,
        kind: "merchandise" as const,
        lineId: `pos-line-${lineIndex}`,
        netRevenueMinor: 500,
        quantity: 1,
        skuId: `sku-${lineIndex % SCALE.skus}`,
      };
    });
    facts.push(
      ...recognizeCommerceEvent(
        adaptPosCompleted({
          currency: "GHS",
          lines,
          occurredAt: 1_000 + transactionIndex,
          recordedAt: 2_000 + transactionIndex,
          storeId: "store-1",
          transactionId: `transaction-${transactionIndex}`,
        }),
      ),
    );
  }

  expect(globalLineIndex).toBe(SCALE.posLines);

  for (let orderIndex = 0; orderIndex < SCALE.onlineOrders; orderIndex += 1) {
    facts.push(
      ...recognizeCommerceEvent(
        adaptStorefrontStatus({
          currency: "GHS",
          lines: [
            {
              cogsKnownMinor: 450,
              kind: "merchandise",
              lineId: `online-line-${orderIndex}`,
              netRevenueMinor: 700,
              quantity: 1,
              skuId: `sku-${orderIndex % SCALE.skus}`,
            },
          ],
          occurredAt: 20_000 + orderIndex,
          orderId: `order-${orderIndex}`,
          previousStatus: "processing",
          recordedAt: 21_000 + orderIndex,
          status: "delivered",
          storeId: "store-1",
        }),
      ),
    );
  }

  for (
    let serviceIndex = 0;
    serviceIndex < SCALE.serviceCases;
    serviceIndex += 1
  ) {
    facts.push(
      ...recognizeCommerceEvent(
        adaptServiceCompletion({
          currency: "GHS",
          netRevenueMinor: 1_200,
          occurredAt: 30_000 + serviceIndex,
          recordedAt: 31_000 + serviceIndex,
          serviceCaseId: `service-${serviceIndex}`,
          storeId: "store-1",
        }),
      ),
    );
  }

  const settlements = Array.from({ length: SCALE.allocations }, (_, index) =>
    adaptSettlement({
      amountMinor: 500,
      businessEventKey: `allocation-${index}`,
      currency: "GHS",
      occurredAt: 40_000 + index,
      paymentAllocationId: `allocation-${index}`,
      recordedAt: 41_000 + index,
      status: "settled",
      storeId: "store-1",
    }),
  );

  return { facts, settlements };
}

function toDailyFacts(facts: CommerceFacts) {
  return facts.map((fact) => ({
    channel: fact.channel,
    cogsKnownMinor: fact.cogsKnownMinor,
    currency: fact.currency,
    eligibleMerchandiseRevenueMinor:
      fact.revenueKind === "merchandise" ? fact.netRevenueMinor : 0,
    factId: fact.factId,
    grossRevenueMinor: fact.netRevenueMinor,
    netRevenueMinor: fact.netRevenueMinor,
    quantity: fact.quantity,
    recognizedAt: fact.recognizedAt,
    returnedQuantity: fact.quantity < 0 ? Math.abs(fact.quantity) : 0,
  }));
}

function buildSkuFactMap(facts: CommerceFacts) {
  const bySku = new Map<string, SkuDayFact[]>();
  let added = 0;
  for (const fact of facts) {
    if (!fact.skuId || added >= SCALE.skuEvents) continue;
    const skuFacts = bySku.get(fact.skuId) ?? [];
    skuFacts.push({
      canonicalSkuId: fact.skuId,
      cogsKnownMinor: fact.cogsKnownMinor,
      factId: fact.factId,
      netRevenueMinor: fact.netRevenueMinor,
      originalSkuReference: fact.skuId,
      quantity: fact.quantity,
      returnedQuantity: 0,
    });
    bySku.set(fact.skuId, skuFacts);
    added += 1;
  }
  expect(added).toBe(SCALE.skuEvents);
  return bySku;
}

describe("reporting production-derived 10x scale", () => {
  it("keeps classification membership identity exact across the full SKU scale", () => {
    const memberships = new Map<string, number>();
    for (let index = 0; index < SCALE.skus; index += 1) {
      for (const classification of ["fast_mover", "low_cover", "high_revenue_low_margin"]) {
        const key = ["epoch-1", "wtd", classification, `sku-${index}`].join("|");
        memberships.set(key, (memberships.get(key) ?? 0) + 1);
      }
    }
    expect(memberships.size).toBe(SCALE.skus * 3);
    expect(memberships.get("epoch-1|wtd|low_cover|sku-17879")).toBe(1);
  });
  it("recognizes every declared commerce lane without treating allocations as revenue", () => {
    const { facts, settlements } = buildCommerceFixture();

    expect(facts).toHaveLength(
      SCALE.posLines + SCALE.onlineOrderLines + SCALE.serviceCases,
    );
    expect(facts.filter((fact) => fact.channel === "pos")).toHaveLength(
      SCALE.posLines,
    );
    expect(facts.filter((fact) => fact.channel === "storefront")).toHaveLength(
      SCALE.onlineOrderLines,
    );
    expect(
      facts.filter(
        (fact) => fact.channel === "service" && fact.revenueKind === "service",
      ),
    ).toHaveLength(SCALE.serviceCases);
    expect(new Set(facts.map((fact) => fact.factId))).toHaveLength(
      facts.length,
    );
    expect(settlements).toHaveLength(SCALE.allocations);
    expect(
      settlements.reduce(
        (total, settlement) => total + settlement.revenueMinor,
        0,
      ),
    ).toBe(0);
    expect(
      new Set(settlements.map((settlement) => settlement.businessEventKey)),
    ).toHaveLength(SCALE.allocations);
  });

  it("keeps pure overview and SKU projection p95 within the read budgets with bounded output", () => {
    const { facts } = buildCommerceFixture();
    const dailyFacts = toDailyFacts(facts);
    const skuFacts = buildSkuFactMap(facts);

    const overview = measureP95(7, () =>
      buildDailyProjection({
        factVersion: 1,
        facts: dailyFacts,
        generationId: "generation-scale",
        metricVersion: 1,
        operatingDate: "2026-07-09",
        scheduleVersionId: "schedule-1",
        sourceWatermark: 50_000,
        storeId: "store-1",
      }),
    );

    const skuAggregates = measureP95(7, () => {
      const skuDays = [];
      const currentInventory = [];
      for (let skuIndex = 0; skuIndex < SCALE.skus; skuIndex += 1) {
        const skuId = `sku-${skuIndex}`;
        skuDays.push(
          buildSkuDayProjection({
            activeDays: 30,
            facts: skuFacts.get(skuId) ?? [],
            generationId: "generation-scale",
            onHandQuantity: 10,
            operatingDate: "2026-07-09",
            skuId,
            storeId: "store-1",
          }),
        );
        currentInventory.push(
          buildCurrentInventoryProjection({
            costedQuantity: 10,
            currency: "GHS",
            knownCostPoolMinor: 3_000,
            onHandQuantity: 10,
            sellableQuantity: 9,
            skuId,
            storeId: "store-1",
            uncostedQuantity: 0,
            unresolvedDeficitQuantity: 0,
          }),
        );
      }
      return { currentInventory, skuDays };
    });

    expect(overview.p95Ms).toBeLessThan(OVERVIEW_P95_TARGET_MS);
    expect(overview.value).toMatchObject({
      currency: "GHS",
      factCount: facts.length,
      status: "complete",
    });
    expect(overview.value.currencySegments).toHaveLength(1);

    expect(skuAggregates.p95Ms).toBeLessThan(SKU_AGGREGATE_P95_TARGET_MS);
    expect(skuAggregates.value.skuDays).toHaveLength(SCALE.skus);
    expect(skuAggregates.value.currentInventory).toHaveLength(SCALE.skus);
    expect(
      skuAggregates.value.skuDays.reduce(
        (total, projection) => total + projection.evidenceFactIds.length,
        0,
      ),
    ).toBe(SCALE.skuEvents);
    expect(
      Math.max(
        ...skuAggregates.value.skuDays.map(
          (projection) => projection.evidenceFactIds.length,
        ),
      ),
    ).toBe(1);
  }, 30_000);

  it("reconciles the declared movement volume through moving-average valuation", () => {
    let position = createEmptyValuationPosition();
    let deficitLots: Parameters<
      typeof applyInboundValuation
    >[1]["deficitLots"] = [];

    for (
      let movementIndex = 0;
      movementIndex < SCALE.inventoryMovements;
      movementIndex += 1
    ) {
      if (movementIndex % 2 === 0) {
        const result = applyInboundValuation(position, {
          costBasis: knownUnitCostBasis({
            currency: "GHS",
            quantity: 2,
            unitCost: 100,
          }),
          deficitLots,
          inboundEffectId: `receipt-${movementIndex}`,
          quantity: 2,
        });
        position = result.position;
        deficitLots = result.remainingDeficitLots;
      } else {
        const result = applyOutboundValuation(position, {
          disposition: "merchandise_sale",
          occurredAt: movementIndex,
          outboundEffectId: `sale-${movementIndex}`,
          quantity: 1,
        });
        position = result.position;
        if (result.createdDeficitLot)
          deficitLots.push(result.createdDeficitLot);
      }
    }

    expect(position).toEqual({
      basisVersion: SCALE.inventoryMovements,
      costedQuantity: SCALE.inventoryMovements / 2,
      currency: "GHS",
      knownCostPool: (SCALE.inventoryMovements / 2) * 100,
      uncostedQuantity: 0,
      unresolvedDeficitQuantity: 0,
    });
    expect(deficitLots).toEqual([]);
  });

  it("keeps actual Convex public reads bounded and store-isolated across the 10x SKU set", async () => {
    const { ctx, reads, skuRows } = createPublicScaleContext();
    const handler = (listSkuDay as unknown as { _handler: Function })._handler;
    const seen = new Set<string>();
    let cursor: string | null = null;
    let done = false;

    while (!done) {
      const page: {
        continueCursor: string;
        isDone: boolean;
        page: ScaleRow[];
      } = await handler(ctx, {
        operatingDate: "2026-07-09",
        paginationOpts: { cursor, numItems: SCALE.skus * 10 },
        storeId: "store-1",
      });
      expect(page.page.length).toBeLessThanOrEqual(
        REPORTING_PUBLIC_PAGE_SIZE_MAX,
      );
      expect(page.page.every((row) => row.storeId === "store-1")).toBe(true);
      for (const row of page.page) seen.add(row._id);
      cursor = page.continueCursor;
      done = page.isDone;
    }

    expect(seen.size).toBe(SCALE.skus);
    expect(reads).toEqual({
      maxPageSize: REPORTING_PUBLIC_PAGE_SIZE_MAX,
      pageCount: Math.ceil(SCALE.skus / REPORTING_PUBLIC_PAGE_SIZE_MAX),
      returnedRows: SCALE.skus,
    });

    skuRows.push({
      _id: "corrupt-cross-store-row",
      generationId: "generation-1",
      metric: "net_sales",
      operatingDate: "2026-07-09",
      productSkuId: "sku-2-corrupt",
      storeId: "store-2",
    });
    await expect(
      handler(ctx, {
        operatingDate: "2026-07-09",
        paginationOpts: { cursor: String(SCALE.skus), numItems: 1 },
        storeId: "store-1",
      }),
    ).rejects.toThrow("Reporting SKU detail is unavailable.");
  }, 30_000);
});
