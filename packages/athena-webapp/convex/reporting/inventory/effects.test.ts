import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { knownUnitCostBasis, uncostedBasis } from "./valuation";
import {
  applyInventoryEffectWithCtx,
  applySkuValuationCorrectionWithCtx,
  type ApplyInventoryEffectArgs,
} from "./effects";
import { deriveFactMetricContributions } from "../projections/factContributions";

type TableName =
  | "inventoryMovement"
  | "product"
  | "productSku"
  | "reportingProjectionActivation"
  | "reportingProjectionGeneration"
  | "reportingProjectionHealth"
  | "reportingMetricCoverage"
  | "reportingInventoryDeficitLedger"
  | "reportingInventoryDeficitLot"
  | "reportingInventoryDeficitResolutionWork"
  | "reportingInventoryEffect"
  | "reportingInventoryEffectSourceReference"
  | "reportingInventoryPosition"
  | "reportingInventoryPositionRevision"
  | "reportingFact"
  | "reportingFactSourceReference"
  | "reportingQuarantine"
  | "reportingReconciliationDiscrepancy"
  | "reportingSkuEvidence"
  | "reportingSkuValuationCorrection"
  | "skuActivityEvent";

type Tables = Record<TableName, Map<string, Record<string, any>>>;

function createEffectCtx(seed: Partial<Tables> = {}) {
  const tables: Tables = {
    inventoryMovement: new Map(),
    product: new Map(),
    productSku: new Map(),
    reportingProjectionActivation: new Map(),
    reportingProjectionGeneration: new Map(),
    reportingProjectionHealth: new Map(),
    reportingMetricCoverage: new Map(),
    reportingInventoryDeficitLedger: new Map(),
    reportingInventoryDeficitLot: new Map(),
    reportingInventoryDeficitResolutionWork: new Map(),
    reportingInventoryEffect: new Map(),
    reportingInventoryEffectSourceReference: new Map(),
    reportingInventoryPosition: new Map(),
    reportingInventoryPositionRevision: new Map(),
    reportingFact: new Map(),
    reportingFactSourceReference: new Map(),
    reportingQuarantine: new Map(),
    reportingReconciliationDiscrepancy: new Map(),
    reportingSkuEvidence: new Map(),
    reportingSkuValuationCorrection: new Map(),
    skuActivityEvent: new Map(),
    ...seed,
  };
  const counters = Object.fromEntries(
    Object.entries(tables).map(([table, rows]) => [table, rows.size]),
  ) as Record<TableName, number>;
  const queryLog: Array<{
    indexName: string;
    table: TableName;
    takeLimit?: number;
  }> = [];

  function filteredRecords(table: TableName, filters: Record<string, unknown>) {
    return Array.from(tables[table].values()).filter((record) =>
      Object.entries(filters).every(
        ([field, value]) => record[field] === value,
      ),
    );
  }

  const db = {
    get: async (table: TableName, id: string) => tables[table].get(id) ?? null,
    insert: async (table: TableName, value: Record<string, unknown>) => {
      counters[table] += 1;
      const id = `${table}-${counters[table]}`;
      tables[table].set(id, { _id: id, ...value });
      return id;
    },
    patch: async (
      table: TableName,
      id: string,
      patch: Record<string, unknown>,
    ) => {
      const current = tables[table].get(id);
      if (!current) throw new Error(`Missing ${table} ${id}`);
      tables[table].set(id, { ...current, ...patch });
    },
    query: (table: TableName) => ({
      withIndex(
        indexName: string,
        apply: (builder: {
          eq: (field: string, value: unknown) => unknown;
        }) => void,
      ) {
        const filters: Record<string, unknown> = {};
        const builder = {
          eq(field: string, value: unknown) {
            filters[field] = value;
            return builder;
          },
        };
        apply(builder);
        const page = filteredRecords(table, filters);
        const logEntry = { indexName, table };
        queryLog.push(logEntry);
        const queryResult = {
          collect: async () => page,
          first: async () => page[0] ?? null,
          order: () => queryResult,
          take: async (limit: number) => {
            Object.assign(logEntry, { takeLimit: limit });
            return page.slice(0, limit);
          },
        };
        return queryResult;
      },
    }),
  };

  const scheduler = { runAfter: vi.fn().mockResolvedValue(undefined) };
  return {
    ctx: { db, scheduler } as unknown as MutationCtx,
    queryLog,
    scheduler,
    tables,
  };
}

function authoritativeDeficitPosition(unresolvedDeficitQuantity: number) {
  return {
    _id: "position-1",
    costedQuantity: 0,
    knownCostPoolMinor: 0,
    lastEffectAt: 900,
    mode: "authoritative",
    onHandQuantity: 0,
    organizationId: "organization-1",
    productSkuId: "sku-1",
    sellableQuantity: 0,
    storeId: "store-1",
    uncostedQuantity: 0,
    unresolvedDeficitQuantity,
    updatedAt: 900,
    version: 7,
  };
}

function deficitLotSeed(count: number) {
  return new Map(
    Array.from({ length: count }, (_, index) => {
      const id = `deficit-${String(index).padStart(5, "0")}`;
      return [
        id,
        {
          _id: id,
          costLane: "merchandise_cogs",
          createdAt: index,
          occurredAt: index,
          organizationId: "organization-1",
          outboundEffectId: `outbound-${String(index).padStart(5, "0")}`,
          positionId: "position-1",
          productSkuId: "sku-1",
          remainingQuantity: 1,
          status: "open",
          storeId: "store-1",
          updatedAt: index,
        },
      ];
    }),
  );
}

function activeDeficitLedgerSeed() {
  return new Map([
    [
      "ledger-active",
      {
        _id: "ledger-active",
        activatedAt: 800,
        createdAt: 800,
        organizationId: "organization-1",
        positionId: "position-1",
        productSkuId: "sku-1",
        status: "active",
        storeId: "store-1",
      },
    ],
  ]);
}

function ledgeredDeficitLotSeed(count: number) {
  return new Map(
    Array.from(deficitLotSeed(count).entries()).map(([id, lot]) => [
      id,
      { ...lot, ledgerId: "ledger-active" },
    ]),
  );
}

function ledgeredDeficitPosition(unresolvedDeficitQuantity: number) {
  return {
    ...authoritativeDeficitPosition(unresolvedDeficitQuantity),
    deficitLedgerId: "ledger-active",
  };
}

function baseArgs(
  overrides: Partial<ApplyInventoryEffectArgs> = {},
): ApplyInventoryEffectArgs {
  return {
    activityType: "stock_sale",
    businessEventKey: "pos:sale-1:line-1",
    completeness: "complete",
    contentFingerprint: "fingerprint-1",
    effectType: "sale",
    movementType: "sale",
    occurrenceAt: 1_000,
    operatingDate: "2026-07-09",
    organizationId: "organization-1" as Id<"organization">,
    physicalQuantityDelta: -2,
    productId: "product-1" as Id<"product">,
    productSkuId: "sku-1" as Id<"productSku">,
    recordedAt: 1_100,
    scheduleVersionId: "schedule-1" as Id<"storeSchedule">,
    sellableQuantityDelta: -2,
    sourceDomain: "pos",
    sourceId: "sale-1",
    sourceLineId: "line-1",
    sourceType: "posTransaction",
    storeId: "store-1" as Id<"store">,
    valuation: {
      disposition: "merchandise_sale",
      kind: "outbound",
      quantity: 2,
    },
    ...overrides,
  };
}

function productSkuSeed(inventoryCount = 5, quantityAvailable = 4) {
  return new Map([
    [
      "sku-1",
      {
        _id: "sku-1",
        inventoryCount,
        productId: "product-1",
        quantityAvailable,
        storeId: "store-1",
      },
    ],
  ]);
}

function authoritativeProjectionSeed(): Partial<Tables> {
  return {
    reportingProjectionActivation: new Map([
      [
        "activation-1",
        {
          _id: "activation-1",
          activatedAt: 1_000,
          generationId: "generation-1",
          projectionKind: "current_inventory",
          storeId: "store-1",
        },
      ],
    ]),
    reportingProjectionGeneration: new Map([
      [
        "generation-1",
        {
          _id: "generation-1",
          organizationId: "organization-1",
          projectionKind: "current_inventory",
          status: "active",
          storeId: "store-1",
        },
      ],
    ]),
  };
}

describe("atomic inventory effects", () => {
  it("applies a compatibility-shadow sale with one movement and SKU activity row", async () => {
    const { ctx, scheduler, tables } = createEffectCtx({
      productSku: productSkuSeed(),
    });

    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        workItemId: "work-item-1" as Id<"operationalWorkItem">,
      }),
    );

    expect(result.disposition).toBe("inserted");
    expect(result.mode).toBe("compatibility_shadow");
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 3,
      quantityAvailable: 2,
    });
    expect(result.position).toMatchObject({
      costedQuantity: 0,
      knownCostPoolMinor: 0,
      mode: "compatibility_shadow",
      onHandQuantity: 3,
      sellableQuantity: 2,
      uncostedQuantity: 3,
      unresolvedDeficitQuantity: 0,
    });
    expect(result.effect).toMatchObject({
      businessEventKey: "pos:sale-1:line-1",
      costedQuantityDelta: 0,
      physicalQuantityDelta: -2,
      sellableQuantityDelta: -2,
      uncostedQuantityDelta: -2,
    });
    expect(result.movement).toMatchObject({
      afterOnHandQuantity: 3,
      afterSellableQuantity: 2,
      beforeOnHandQuantity: 5,
      beforeSellableQuantity: 4,
      businessEventKey: "pos:sale-1:line-1",
      occurrenceAt: 1_000,
      quantityDelta: -2,
      recordedAt: 1_100,
      sellableQuantityDelta: -2,
      workItemId: "work-item-1",
    });
    expect(tables.inventoryMovement).toHaveLength(1);
    expect(tables.skuActivityEvent).toHaveLength(1);
    expect(tables.reportingFact).toHaveLength(0);
    expect(Array.from(tables.skuActivityEvent.values())[0]).toMatchObject({
      workItemId: "work-item-1",
    });
    expect(scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      effectId: result.effect._id,
    });
  });

  it.each([
    ["exchange_replacement", "exchange_replacement_cogs", "known_cogs"],
    ["service_consumption", "inventory_consumed", "inventory_consumed_value"],
    ["inventory_expense", "inventory_consumed", "inventory_consumed_value"],
  ] as const)(
    "materializes %s known cost once for store and SKU projections",
    async (disposition, contributionKind, expectedMetric) => {
      const { ctx, tables } = createEffectCtx({
        ...authoritativeProjectionSeed(),
        productSku: productSkuSeed(4, 4),
        reportingInventoryPosition: new Map([
          [
            "position-1",
            {
              _id: "position-1",
              costedQuantity: 4,
              currencyCode: "GHS",
              currencyMinorUnitScale: 2,
              knownCostPoolMinor: 400,
              lastEffectAt: 900,
              mode: "authoritative",
              onHandQuantity: 4,
              organizationId: "organization-1",
              productSkuId: "sku-1",
              sellableQuantity: 4,
              storeId: "store-1",
              uncostedQuantity: 0,
              unresolvedDeficitQuantity: 0,
              updatedAt: 900,
              valuationStatus: "current",
              version: 2,
            },
          ],
        ]),
      });

      const result = await applyInventoryEffectWithCtx(
        ctx,
        baseArgs({
          businessEventKey: `inventory:${disposition}:line-1`,
          contentFingerprint: `inventory-${disposition}`,
          physicalQuantityDelta: -1,
          sellableQuantityDelta: -1,
          sourceDomain:
            disposition === "exchange_replacement" ? "storefront" : "inventory",
          valuation: { disposition, kind: "outbound", quantity: 1 },
        }),
      );

      expect(result.effect).toMatchObject({
        costLane:
          disposition === "exchange_replacement"
            ? "exchange_merchandise_cogs"
            : "inventory_consumed",
        outboundBasisMinor: 100,
      });
      expect(Array.from(tables.reportingFact.values())).toEqual([
        expect.objectContaining({
          cogsKnownMinor: 100,
          inventoryContributionKind: contributionKind,
          inventoryEffectId: result.effect._id,
          valuationCurrencyCode: "GHS",
        }),
      ]);
      expect(expectedMetric).toMatch(/known_cogs|inventory_consumed_value/);
    },
  );

  it("materializes a sellable return as units returned and a known COGS reversal", async () => {
    const { ctx, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(3, 3),
      reportingInventoryPosition: new Map([
        [
          "position-1",
          {
            _id: "position-1",
            costedQuantity: 3,
            currencyCode: "GHS",
            currencyMinorUnitScale: 2,
            knownCostPoolMinor: 300,
            lastEffectAt: 900,
            mode: "authoritative",
            onHandQuantity: 3,
            organizationId: "organization-1",
            productSkuId: "sku-1",
            sellableQuantity: 3,
            storeId: "store-1",
            uncostedQuantity: 0,
            unresolvedDeficitQuantity: 0,
            updatedAt: 900,
            valuationStatus: "current",
            version: 2,
          },
        ],
      ]),
    });

    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        businessEventKey: "pos:return-1:line-1",
        contentFingerprint: "pos-return-1",
        effectType: "return",
        physicalQuantityDelta: 1,
        sellableQuantityDelta: 1,
        valuation: {
          disposition: "sellable",
          financialContribution: "reverse_original_lane",
          kind: "return",
          originalBasis: {
            allocatedKnownCost: 100,
            basisVersion: 2,
            costedQuantity: 1,
            currency: "GHS",
            knownCostPoolBefore: 300,
            roundedWeightedAverageUnitCost: 100,
            uncostedQuantity: 0,
            unresolvedDeficitQuantity: 0,
          },
          originalCostLane: "merchandise_cogs",
          quantity: 1,
        },
      }),
    );

    expect(result.effect).toMatchObject({ cogsReversalKnownMinor: 100 });
    expect(Array.from(tables.reportingFact.values())).toEqual([
      expect.objectContaining({
        cogsKnownMinor: -100,
        factType: "return",
        inventoryContributionKind: "sellable_return_cogs_reversal",
        quantity: -1,
      }),
    ]);
  });

  it("reverses returned service material in its inventory-consumed lane", async () => {
    const { ctx, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(3, 3),
      reportingInventoryPosition: new Map([
        [
          "position-1",
          {
            _id: "position-1",
            costedQuantity: 3,
            currencyCode: "GHS",
            currencyMinorUnitScale: 2,
            knownCostPoolMinor: 300,
            lastEffectAt: 900,
            mode: "authoritative",
            onHandQuantity: 3,
            organizationId: "organization-1",
            productSkuId: "sku-1",
            sellableQuantity: 3,
            storeId: "store-1",
            uncostedQuantity: 0,
            unresolvedDeficitQuantity: 0,
            updatedAt: 900,
            valuationStatus: "current",
            version: 2,
          },
        ],
      ]),
    });

    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        businessEventKey: "service:return-material:line-1",
        contentFingerprint: "service-return-material",
        effectType: "return",
        physicalQuantityDelta: 1,
        sellableQuantityDelta: 1,
        sourceDomain: "service",
        valuation: {
          disposition: "sellable",
          financialContribution: "reverse_original_lane",
          kind: "return",
          originalBasis: {
            allocatedKnownCost: 100,
            basisVersion: 2,
            costedQuantity: 1,
            currency: "GHS",
            knownCostPoolBefore: 300,
            roundedWeightedAverageUnitCost: 100,
            uncostedQuantity: 0,
            unresolvedDeficitQuantity: 0,
          },
          originalCostLane: "inventory_consumed",
          quantity: 1,
        },
      }),
    );

    expect(result.effect.costLane).toBe("inventory_consumed");
    expect(Array.from(tables.reportingFact.values())).toEqual([
      expect.objectContaining({
        cogsKnownMinor: -100,
        factType: "inventory_issue",
        inventoryContributionKind: "inventory_consumed_reversal",
        quantity: -1,
      }),
    ]);
    expect(
      Array.from(tables.reportingSkuEvidence.values()).find(
        (row) => row.businessEventKey === "service:return-material:line-1",
      ),
    ).toMatchObject({
      cogsKnownMinor: undefined,
      knownGrossProfitMinor: undefined,
    });
  });

  it("restocks an operational cancellation without creating a financial fact", async () => {
    const { ctx, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(3, 3),
    });
    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        businessEventKey: "storefront:cancel-restock:line-1",
        contentFingerprint: "cancel-restock",
        effectType: "return",
        physicalQuantityDelta: 1,
        sellableQuantityDelta: 1,
        sourceDomain: "storefront",
        valuation: {
          disposition: "sellable",
          financialContribution: "none",
          kind: "return",
          originalBasis: {
            allocatedKnownCost: 100,
            basisVersion: 1,
            costedQuantity: 1,
            currency: "GHS",
            knownCostPoolBefore: 100,
            roundedWeightedAverageUnitCost: 100,
            uncostedQuantity: 0,
            unresolvedDeficitQuantity: 0,
          },
          originalCostLane: "merchandise_cogs",
          quantity: 1,
        },
      }),
    );
    expect(result.effect).not.toHaveProperty("cogsReversalKnownMinor");
    expect(tables.reportingFact).toHaveLength(0);
  });

  it("persists a full-admin product-editor valuation correction through the effect ledger", async () => {
    const { ctx, tables } = createEffectCtx({
      product: new Map([
        [
          "product-1",
          {
            _id: "product-1",
            organizationId: "organization-1",
            storeId: "store-1",
          },
        ],
      ]),
      productSku: productSkuSeed(3, 2),
    });

    const result = await applySkuValuationCorrectionWithCtx(ctx, {
      actorUserId: "user-1" as Id<"athenaUser">,
      correctedInventoryCount: 3,
      correctedQuantityAvailable: 2,
      correctedUnitCostMinor: 150,
      currencyCode: "GHS",
      currencyMinorUnitScale: 2,
      occurrenceAt: 1_000,
      operatingDate: "2026-07-09",
      organizationId: "organization-1" as Id<"organization">,
      productSkuId: "sku-1" as Id<"productSku">,
      reason: "Confirmed opening valuation",
      requestKey: "product-editor:sku-1:request-1",
      scheduleVersionId: "schedule-1" as Id<"storeSchedule">,
      storeId: "store-1" as Id<"store">,
    });

    expect(result.flags).toEqual({
      missingUnitCost: false,
      reportingPeriodMissing: false,
      valuationRebuildRequired: false,
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({ unitCost: 150 });
    expect(
      Array.from(tables.reportingInventoryPosition.values())[0],
    ).toMatchObject({
      costedQuantity: 3,
      currencyCode: "GHS",
      knownCostPoolMinor: 450,
      uncostedQuantity: 0,
      valuationStatus: "current",
    });
    expect(tables.reportingSkuValuationCorrection).toHaveLength(1);
    expect(tables.reportingInventoryEffect).toHaveLength(2);
    expect(
      Array.from(tables.reportingInventoryPosition.values())[0]?.updatedAt,
    ).not.toBe(1_000);

    const replay = await applySkuValuationCorrectionWithCtx(ctx, {
      actorUserId: "user-1" as Id<"athenaUser">,
      correctedInventoryCount: 3,
      correctedQuantityAvailable: 2,
      correctedUnitCostMinor: 150,
      currencyCode: "ghs",
      currencyMinorUnitScale: 2,
      occurrenceAt: 2_000,
      organizationId: "organization-1" as Id<"organization">,
      productSkuId: "sku-1" as Id<"productSku">,
      reason: " Confirmed opening valuation ",
      requestKey: " product-editor:sku-1:request-1 ",
      storeId: "store-1" as Id<"store">,
    });
    expect(replay.replayed).toBe(true);
    await expect(
      applySkuValuationCorrectionWithCtx(ctx, {
        actorUserId: "user-1" as Id<"athenaUser">,
        correctedInventoryCount: 4,
        correctedQuantityAvailable: 2,
        correctedUnitCostMinor: 150,
        currencyCode: "GHS",
        currencyMinorUnitScale: 2,
        occurrenceAt: 2_000,
        organizationId: "organization-1" as Id<"organization">,
        productSkuId: "sku-1" as Id<"productSku">,
        reason: "Confirmed opening valuation",
        requestKey: "product-editor:sku-1:request-1",
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow(/conflicts with existing content/i);
  });

  it("returns the original effect on identical replay without applying stock twice", async () => {
    const { ctx, scheduler, tables } = createEffectCtx({
      productSku: productSkuSeed(),
    });
    const args = baseArgs();

    const first = await applyInventoryEffectWithCtx(ctx, args);
    const second = await applyInventoryEffectWithCtx(ctx, args);

    expect(second.disposition).toBe("existing");
    expect(second.effect._id).toBe(first.effect._id);
    expect(tables.productSku.get("sku-1")?.inventoryCount).toBe(3);
    expect(tables.reportingInventoryEffect).toHaveLength(1);
    expect(tables.inventoryMovement).toHaveLength(1);
    expect(tables.skuActivityEvent).toHaveLength(1);
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
  });

  it("keeps an offline Monday sale unknown after a Tuesday receipt", async () => {
    const { ctx, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(10, 10),
      reportingInventoryPosition: new Map([
        [
          "position-1",
          {
            _id: "position-1",
            costedQuantity: 10,
            currencyCode: "GHS",
            knownCostPoolMinor: 1_000,
            lastEffectAt: 2_000,
            mode: "authoritative",
            onHandQuantity: 10,
            organizationId: "organization-1",
            productSkuId: "sku-1",
            sellableQuantity: 10,
            storeId: "store-1",
            uncostedQuantity: 0,
            unresolvedDeficitQuantity: 0,
            updatedAt: 2_000,
            valuationStatus: "current",
            version: 2,
          },
        ],
      ]),
    });
    const args = baseArgs({
      businessEventKey: "offline:monday-sale:line-1",
      contentFingerprint: "offline-monday-sale",
      occurrenceAt: 1_000,
      physicalQuantityDelta: -2,
      sellableQuantityDelta: -2,
      sourceId: "offline-monday-sale",
    });

    const result = await applyInventoryEffectWithCtx(ctx, args);

    expect(result.position).toMatchObject({
      costedQuantity: 0,
      knownCostPoolMinor: 0,
      lastEffectAt: 2_000,
      onHandQuantity: 8,
      sellableQuantity: 8,
      uncostedQuantity: 8,
      valuationPendingFrom: 1_000,
      valuationStatus: "rebuild_required",
    });
    expect(result.effect).toMatchObject({
      completeness: "partial",
      occurrenceAt: 1_000,
      valuationStatus: "rebuild_required",
    });
    expect(result.effect).not.toHaveProperty("outboundBasisMinor");
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 8,
      quantityAvailable: 8,
    });
    expect(Array.from(tables.reportingQuarantine.values())).toEqual([
      expect.objectContaining({
        inventoryEffectId: result.effect._id,
        safeCode: "late_inventory_occurrence",
        status: "open",
      }),
    ]);
    expect(
      Array.from(tables.reportingReconciliationDiscrepancy.values()),
    ).toEqual([
      expect.objectContaining({
        actualMinorOrQuantity: 1_000,
        expectedMinorOrQuantity: 2_000,
        invariant: "inventory_effect_occurrence_order",
        status: "open",
      }),
    ]);

    const replay = await applyInventoryEffectWithCtx(ctx, args);
    expect(replay.disposition).toBe("existing");
    expect(tables.productSku.get("sku-1")?.inventoryCount).toBe(8);
    expect(tables.reportingQuarantine).toHaveLength(1);
    expect(tables.reportingReconciliationDiscrepancy).toHaveLength(1);
  });

  it("keeps later effects unknown while occurrence-order rebuild is pending", async () => {
    const { ctx, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(8, 8),
      reportingInventoryPosition: new Map([
        [
          "position-1",
          {
            _id: "position-1",
            costedQuantity: 0,
            knownCostPoolMinor: 0,
            lastEffectAt: 2_000,
            mode: "authoritative",
            onHandQuantity: 8,
            organizationId: "organization-1",
            productSkuId: "sku-1",
            sellableQuantity: 8,
            storeId: "store-1",
            uncostedQuantity: 8,
            unresolvedDeficitQuantity: 0,
            updatedAt: 2_000,
            valuationPendingFrom: 1_000,
            valuationStatus: "rebuild_required",
            version: 3,
          },
        ],
      ]),
    });

    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        businessEventKey: "pos:wednesday-sale:line-1",
        contentFingerprint: "wednesday-sale",
        occurrenceAt: 3_000,
        physicalQuantityDelta: -1,
        sellableQuantityDelta: -1,
        sourceId: "wednesday-sale",
        valuation: {
          disposition: "merchandise_sale",
          kind: "outbound",
          quantity: 1,
        },
      }),
    );

    expect(result.position).toMatchObject({
      knownCostPoolMinor: 0,
      lastEffectAt: 3_000,
      uncostedQuantity: 7,
      valuationPendingFrom: 1_000,
      valuationStatus: "rebuild_required",
    });
    expect(result.effect).toMatchObject({
      completeness: "partial",
      valuationStatus: "rebuild_required",
    });
    expect(result.effect).not.toHaveProperty("outboundBasisMinor");
  });

  it("accepts a late oversell with rebuild-required valuation and deficit evidence", async () => {
    const { ctx, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(1, 1),
      reportingInventoryPosition: new Map([
        [
          "position-1",
          {
            _id: "position-1",
            costedQuantity: 0,
            knownCostPoolMinor: 0,
            lastEffectAt: 2_000,
            mode: "authoritative",
            onHandQuantity: 1,
            organizationId: "organization-1",
            productSkuId: "sku-1",
            sellableQuantity: 1,
            storeId: "store-1",
            uncostedQuantity: 1,
            unresolvedDeficitQuantity: 0,
            updatedAt: 2_000,
            valuationStatus: "current",
            version: 2,
          },
        ],
      ]),
    });

    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        businessEventKey: "offline:late-oversell:line-1",
        contentFingerprint: "late-oversell",
        occurrenceAt: 1_000,
        physicalQuantityDelta: -2,
        sellableQuantityDelta: -2,
        sourceId: "late-oversell",
      }),
    );

    expect(result.position).toMatchObject({
      onHandQuantity: 0,
      unresolvedDeficitQuantity: 1,
      valuationStatus: "rebuild_required",
    });
    expect(Array.from(tables.reportingInventoryDeficitLot.values())).toEqual([
      expect.objectContaining({
        remainingQuantity: 1,
        status: "open",
      }),
    ]);
  });

  it("durably quarantines a conflicting identity without applying stock twice", async () => {
    const { ctx, tables } = createEffectCtx({ productSku: productSkuSeed() });
    await applyInventoryEffectWithCtx(ctx, baseArgs());

    const conflict = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({ contentFingerprint: "different-fingerprint" }),
    );
    expect(conflict.disposition).toBe("conflict");
    expect(tables.productSku.get("sku-1")?.inventoryCount).toBe(3);
    expect(tables.reportingInventoryEffect).toHaveLength(1);
    expect(Array.from(tables.reportingQuarantine.values())).toEqual([
      expect.objectContaining({
        safeCode: "inventory_effect_duplicate_conflict",
        status: "open",
      }),
    ]);
  });

  it("commits a cross-currency receipt while withholding pooled valuation", async () => {
    const { ctx, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(2, 2),
      reportingInventoryPosition: new Map([
        [
          "position-1",
          {
            _id: "position-1",
            costedQuantity: 2,
            currencyCode: "GHS",
            currencyMinorUnitScale: 2,
            knownCostPoolMinor: 200,
            lastEffectAt: 900,
            mode: "authoritative",
            onHandQuantity: 2,
            organizationId: "organization-1",
            productSkuId: "sku-1",
            sellableQuantity: 2,
            storeId: "store-1",
            uncostedQuantity: 0,
            unresolvedDeficitQuantity: 0,
            updatedAt: 900,
            valuationStatus: "current",
            version: 2,
          },
        ],
      ]),
    });

    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        businessEventKey: "purchase:receipt-usd:line-1",
        contentFingerprint: "receipt-usd",
        effectType: "receipt",
        physicalQuantityDelta: 2,
        sellableQuantityDelta: 2,
        sourceDomain: "procurement",
        valuation: {
          costBasis: knownUnitCostBasis({
            currency: "USD",
            quantity: 2,
            unitCost: 50,
          }),
          kind: "inbound",
          quantity: 2,
        },
      }),
    );

    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 4,
      quantityAvailable: 4,
    });
    expect(result.position).toMatchObject({
      costedQuantity: 2,
      currencyCode: "GHS",
      knownCostPoolMinor: 200,
      onHandQuantity: 4,
      uncostedQuantity: 2,
      valuationStatus: "rebuild_required",
    });
    expect(result.effect).toMatchObject({
      currencyCode: "USD",
      valuationStatus: "rebuild_required",
    });
    expect(tables.reportingFact).toHaveLength(0);
    expect(Array.from(tables.reportingQuarantine.values())).toContainEqual(
      expect.objectContaining({ safeCode: "valuation_currency_conflict" }),
    );
  });

  it("allows a late receipt to resolve an existing deficit without corrupting on-hand", async () => {
    const { ctx, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(0, 0),
      reportingInventoryDeficitLot: deficitLotSeed(1),
      reportingInventoryPosition: new Map([
        ["position-1", authoritativeDeficitPosition(1)],
      ]),
    });
    const receipt = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        businessEventKey: "purchase:late-receipt:line-1",
        contentFingerprint: "late-receipt",
        effectType: "receipt",
        occurrenceAt: 800,
        physicalQuantityDelta: 1,
        sellableQuantityDelta: 1,
        sourceDomain: "procurement",
        valuation: {
          costBasis: knownUnitCostBasis({
            currency: "GHS",
            quantity: 1,
            unitCost: 100,
          }),
          kind: "inbound",
          quantity: 1,
        },
      }),
    );
    expect(receipt.position).toMatchObject({
      onHandQuantity: 0,
      unresolvedDeficitQuantity: 0,
      valuationStatus: "rebuild_required",
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 0,
      quantityAvailable: 0,
    });
    const laterSale = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        businessEventKey: "pos:later-sale:line-1",
        contentFingerprint: "later-sale",
        occurrenceAt: 1_100,
        physicalQuantityDelta: -1,
        sellableQuantityDelta: -1,
        valuation: {
          disposition: "merchandise_sale",
          kind: "outbound",
          quantity: 1,
        },
      }),
    );
    expect(laterSale.position.unresolvedDeficitQuantity).toBe(1);
  });

  it("uses an authoritative position for known COGS and preserves oversell deficit", async () => {
    const { ctx, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(1, 1),
      reportingInventoryPosition: new Map([
        [
          "position-1",
          {
            _id: "position-1",
            costedQuantity: 1,
            currencyCode: "GHS",
            currencyMinorUnitScale: 2,
            knownCostPoolMinor: 100,
            lastEffectAt: 900,
            mode: "authoritative",
            onHandQuantity: 1,
            organizationId: "organization-1",
            productSkuId: "sku-1",
            sellableQuantity: 1,
            storeId: "store-1",
            uncostedQuantity: 0,
            unresolvedDeficitQuantity: 0,
            updatedAt: 900,
            version: 7,
          },
        ],
      ]),
    });

    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        physicalQuantityDelta: -3,
        sellableQuantityDelta: -3,
        valuation: {
          disposition: "merchandise_sale",
          kind: "outbound",
          quantity: 3,
        },
      }),
    );

    expect(result.position).toMatchObject({
      costedQuantity: 0,
      knownCostPoolMinor: 0,
      mode: "authoritative",
      onHandQuantity: 0,
      unresolvedDeficitQuantity: 2,
      version: 8,
    });
    expect(result.effect).toMatchObject({
      knownCostPoolDeltaMinor: -100,
      outboundBasisMinor: 100,
      physicalQuantityDelta: -3,
      unresolvedDeficitDelta: 2,
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 0,
      quantityAvailable: 0,
    });
    expect(result.movement?.quantityDelta).toBe(-3);
    expect(Array.from(tables.reportingInventoryDeficitLot.values())).toEqual([
      expect.objectContaining({
        costLane: "merchandise_cogs",
        outboundEffectId: result.effect._id,
        positionId: result.position._id,
        remainingQuantity: 2,
        status: "open",
      }),
    ]);
  });

  it("does not read a long deficit history while recording another outbound sale", async () => {
    const { ctx, queryLog, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(0, 0),
      reportingInventoryDeficitLedger: activeDeficitLedgerSeed(),
      reportingInventoryDeficitLot: ledgeredDeficitLotSeed(2_000),
      reportingInventoryPosition: new Map([
        ["position-1", ledgeredDeficitPosition(2_000)],
      ]),
    });

    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        physicalQuantityDelta: -1,
        sellableQuantityDelta: -1,
        valuation: {
          disposition: "merchandise_sale",
          kind: "outbound",
          quantity: 1,
        },
      }),
    );

    expect(result.position.unresolvedDeficitQuantity).toBe(2_001);
    expect(tables.reportingInventoryDeficitLot).toHaveLength(2_001);
    expect(
      queryLog.filter(
        (entry) => entry.table === "reportingInventoryDeficitLot",
      ),
    ).toEqual([]);
  });

  it("resolves only the FIFO lots proportional to inbound quantity across a long history", async () => {
    const receiptArgs = baseArgs({
      activityType: "stock_receipt",
      businessEventKey: "receipt:long-history",
      contentFingerprint: "receipt-long-history-fingerprint",
      effectType: "receipt",
      movementType: "receipt",
      physicalQuantityDelta: 3,
      sellableQuantityDelta: 3,
      sourceDomain: "procurement",
      sourceId: "receipt-long-history",
      sourceType: "purchaseOrderReceipt",
      valuation: {
        costBasis: knownUnitCostBasis({
          currency: "GHS",
          quantity: 3,
          unitCost: 100,
        }),
        kind: "inbound",
        quantity: 3,
      },
    });
    const { ctx, queryLog, scheduler, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(0, 0),
      reportingInventoryDeficitLedger: activeDeficitLedgerSeed(),
      reportingInventoryDeficitLot: ledgeredDeficitLotSeed(2_000),
      reportingInventoryPosition: new Map([
        ["position-1", ledgeredDeficitPosition(2_000)],
      ]),
    });
    scheduler.runAfter.mockRejectedValue(new Error("scheduler unavailable"));

    const result = await applyInventoryEffectWithCtx(ctx, receiptArgs);

    expect(result.position).toMatchObject({
      knownCostPoolMinor: 0,
      onHandQuantity: 0,
      unresolvedDeficitQuantity: 1_997,
    });
    expect(result.adjustmentEffects).toHaveLength(3);
    expect(
      queryLog.filter(
        (entry) => entry.table === "reportingInventoryDeficitLot",
      ),
    ).toEqual([
      {
        indexName: "by_ledgerId_status_occurredAt_outboundEffectId",
        table: "reportingInventoryDeficitLot",
        takeLimit: 3,
      },
    ]);
    expect(
      Array.from(tables.reportingInventoryDeficitLot.values()).filter(
        (lot) => lot.status === "resolved",
      ),
    ).toHaveLength(3);
    expect(
      Array.from(tables.reportingInventoryDeficitLot.values())
        .filter((lot) => lot.status === "open")
        .reduce((sum, lot) => sum + lot.remainingQuantity, 0),
    ).toBe(result.position.unresolvedDeficitQuantity);

    const replay = await applyInventoryEffectWithCtx(ctx, receiptArgs);
    expect(replay.disposition).toBe("existing");
    expect(
      queryLog.filter(
        (entry) => entry.table === "reportingInventoryDeficitLot",
      ),
    ).toHaveLength(1);
  });

  it("commits a large receipt and defers deficit resolution after a fixed FIFO prefix", async () => {
    const { ctx, queryLog, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(0, 0),
      reportingInventoryDeficitLedger: activeDeficitLedgerSeed(),
      reportingInventoryDeficitLot: ledgeredDeficitLotSeed(2_000),
      reportingInventoryPosition: new Map([
        ["position-1", ledgeredDeficitPosition(2_000)],
      ]),
    });

    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        activityType: "stock_receipt",
        businessEventKey: "receipt:deferred-long-history",
        contentFingerprint: "receipt-deferred-long-history-fingerprint",
        effectType: "receipt",
        movementType: "receipt",
        physicalQuantityDelta: 25,
        sellableQuantityDelta: 25,
        sourceDomain: "procurement",
        sourceId: "receipt-deferred-long-history",
        sourceType: "purchaseOrderReceipt",
        valuation: {
          costBasis: knownUnitCostBasis({
            currency: "GHS",
            quantity: 25,
            unitCost: 100,
          }),
          kind: "inbound",
          quantity: 25,
        },
      }),
    );

    expect(result.effect.valuationStatus).toBe("rebuild_required");
    expect(result.position.unresolvedDeficitQuantity).toBe(1_975);
    expect(result.adjustmentEffects).toHaveLength(0);
    expect(
      queryLog.find((entry) => entry.table === "reportingInventoryDeficitLot"),
    ).toMatchObject({ takeLimit: 20 });
    expect(
      Array.from(tables.reportingInventoryDeficitResolutionWork.values()),
    ).toEqual([
      expect.objectContaining({
        inboundEffectId: result.effect._id,
        remainingQuantity: 25,
        status: "pending",
        totalReceiptCostMinor: 2_500,
      }),
    ]);
    expect(
      Array.from(tables.reportingInventoryDeficitLot.values()).filter(
        (lot) => lot.status === "resolved",
      ),
    ).toHaveLength(0);
  });

  it("partially resolves the oldest lot without reading the remaining FIFO tail", async () => {
    const lots = deficitLotSeed(2);
    lots.get("deficit-00000")!.remainingQuantity = 10;
    lots.get("deficit-00001")!.remainingQuantity = 10;
    const { ctx, queryLog, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(0, 0),
      reportingInventoryDeficitLot: lots,
      reportingInventoryPosition: new Map([
        ["position-1", authoritativeDeficitPosition(20)],
      ]),
    });

    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        activityType: "stock_receipt",
        businessEventKey: "receipt:partial-oldest",
        effectType: "receipt",
        movementType: "receipt",
        physicalQuantityDelta: 3,
        sellableQuantityDelta: 3,
        sourceDomain: "procurement",
        sourceId: "receipt-partial-oldest",
        sourceType: "purchaseOrderReceipt",
        valuation: {
          costBasis: knownUnitCostBasis({
            currency: "GHS",
            quantity: 3,
            unitCost: 100,
          }),
          kind: "inbound",
          quantity: 3,
        },
      }),
    );

    expect(result.position.unresolvedDeficitQuantity).toBe(17);
    expect(result.adjustmentEffects).toHaveLength(1);
    expect(
      tables.reportingInventoryDeficitLot.get("deficit-00000"),
    ).toMatchObject({
      remainingQuantity: 7,
      status: "open",
    });
    expect(
      tables.reportingInventoryDeficitLot.get("deficit-00001"),
    ).toMatchObject({
      remainingQuantity: 10,
      status: "open",
    });
    expect(
      Array.from(tables.reportingInventoryDeficitLot.values())
        .filter((lot) => lot.status === "open")
        .reduce((sum, lot) => sum + lot.remainingQuantity, 0),
    ).toBe(result.position.unresolvedDeficitQuantity);
    expect(
      queryLog.find((entry) => entry.table === "reportingInventoryDeficitLot"),
    ).toMatchObject({ takeLimit: 3 });
  });

  it("fails exact inbound reconciliation when the bounded FIFO prefix is missing linkage", async () => {
    const lots = deficitLotSeed(1);
    lots.get("deficit-00000")!.remainingQuantity = 2;
    const { ctx, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(0, 0),
      reportingInventoryDeficitLot: lots,
      reportingInventoryPosition: new Map([
        ["position-1", authoritativeDeficitPosition(5)],
      ]),
    });

    await expect(
      applyInventoryEffectWithCtx(
        ctx,
        baseArgs({
          activityType: "stock_receipt",
          businessEventKey: "receipt:missing-deficit-link",
          effectType: "receipt",
          movementType: "receipt",
          physicalQuantityDelta: 3,
          sellableQuantityDelta: 3,
          sourceDomain: "procurement",
          sourceId: "receipt-missing-deficit-link",
          sourceType: "purchaseOrderReceipt",
          valuation: {
            costBasis: uncostedBasis(),
            kind: "inbound",
            quantity: 3,
          },
        }),
      ),
    ).rejects.toThrow(/bounded FIFO prefix/i);
    expect(tables.reportingInventoryEffect).toHaveLength(0);
  });

  it("never uses an unbounded deficit-lot collection at runtime", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "reporting", "inventory", "effects.ts"),
      "utf8",
    );
    expect(source).not.toContain(".collect()");
    expect(source).toContain("synchronousLotLimit = 20");
    expect(source).toContain(".take(takeLimit)");
    expect(source).toContain("enqueueDeficitResolutionWorkWithCtx");
  });

  it("keeps a prematurely seeded position in compatibility shadow before activation", async () => {
    const { ctx } = createEffectCtx({
      productSku: productSkuSeed(1, 1),
      reportingInventoryPosition: new Map([
        [
          "position-1",
          {
            ...authoritativeDeficitPosition(0),
            costedQuantity: 1,
            currencyCode: "GHS",
            knownCostPoolMinor: 100,
            onHandQuantity: 1,
            sellableQuantity: 1,
          },
        ],
      ]),
    });

    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        physicalQuantityDelta: -1,
        sellableQuantityDelta: -1,
        valuation: {
          disposition: "merchandise_sale",
          kind: "outbound",
          quantity: 1,
        },
      }),
    );

    expect(result.mode).toBe("compatibility_shadow");
    expect(result.position.mode).toBe("compatibility_shadow");
    expect(result.effect.completeness).toBe("provisional");
  });

  it("records availability-only evidence without creating a physical movement", async () => {
    const { ctx, tables } = createEffectCtx({ productSku: productSkuSeed() });

    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        activityStatus: "active",
        activityType: "reservation_acquired",
        businessEventKey: "checkout:hold-1",
        effectType: "adjustment",
        movementType: "reservation",
        physicalQuantityDelta: 0,
        sellableQuantityDelta: -1,
        sourceDomain: "storefront",
        sourceId: "checkout-1",
        sourceType: "checkoutSession",
        valuation: { kind: "availability_only" },
        workItemId: "work-item-1" as Id<"operationalWorkItem">,
      }),
    );

    expect(result.movement).toBeNull();
    expect(tables.inventoryMovement).toHaveLength(0);
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 5,
      quantityAvailable: 3,
    });
    expect(result.effect).toMatchObject({
      physicalQuantityDelta: 0,
      sellableQuantityDelta: -1,
    });
    expect(tables.skuActivityEvent).toHaveLength(1);
    expect(Array.from(tables.skuActivityEvent.values())[0]).toMatchObject({
      workItemId: "work-item-1",
    });
  });

  it("applies known inbound cost to authoritative inventory", async () => {
    const { ctx, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(2, 2),
      reportingInventoryPosition: new Map([
        [
          "position-1",
          {
            _id: "position-1",
            costedQuantity: 2,
            currencyCode: "GHS",
            currencyMinorUnitScale: 2,
            knownCostPoolMinor: 200,
            lastEffectAt: 900,
            mode: "authoritative",
            onHandQuantity: 2,
            organizationId: "organization-1",
            productSkuId: "sku-1",
            sellableQuantity: 2,
            storeId: "store-1",
            uncostedQuantity: 0,
            unresolvedDeficitQuantity: 0,
            updatedAt: 900,
            version: 2,
          },
        ],
      ]),
    });

    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        activityType: "stock_receipt",
        businessEventKey: "receipt:1:line-1",
        effectType: "receipt",
        movementType: "receipt",
        physicalQuantityDelta: 2,
        sellableQuantityDelta: 2,
        sourceDomain: "procurement",
        sourceId: "receipt-1",
        sourceType: "purchaseOrderReceipt",
        valuation: {
          costBasis: knownUnitCostBasis({
            currency: "GHS",
            quantity: 2,
            unitCost: 200,
          }),
          kind: "inbound",
          quantity: 2,
        },
      }),
    );

    expect(result.position).toMatchObject({
      costedQuantity: 4,
      knownCostPoolMinor: 600,
      onHandQuantity: 4,
      version: 3,
    });
    expect(result.effect).toMatchObject({
      costedQuantityDelta: 2,
      knownCostPoolDeltaMinor: 400,
    });

    const zeroCostReceipt = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        activityType: "stock_receipt",
        businessEventKey: "receipt:2:line-1",
        contentFingerprint: "receipt-zero-cost",
        effectType: "receipt",
        movementType: "receipt",
        occurrenceAt: 1_200,
        physicalQuantityDelta: 1,
        sellableQuantityDelta: 1,
        sourceDomain: "procurement",
        sourceId: "receipt-2",
        sourceType: "purchaseOrderReceipt",
        valuation: {
          costBasis: knownUnitCostBasis({
            currency: "GHS",
            quantity: 1,
            unitCost: 0,
          }),
          kind: "inbound",
          quantity: 1,
        },
      }),
    );
    expect(zeroCostReceipt.effect).toMatchObject({
      costedQuantityDelta: 1,
      knownCostPoolDeltaMinor: 0,
    });
    expect(Array.from(tables.reportingSkuEvidence.values())).toContainEqual(
      expect.objectContaining({
        businessEventKey: "receipt:2:line-1",
        costStatus: "known",
      }),
    );
  });

  it("links known receipt cost to the historical sale that created a deficit", async () => {
    const { ctx, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(1, 1),
      reportingInventoryPosition: new Map([
        [
          "position-1",
          {
            _id: "position-1",
            costedQuantity: 1,
            currencyCode: "GHS",
            knownCostPoolMinor: 100,
            lastEffectAt: 700,
            mode: "authoritative",
            onHandQuantity: 1,
            organizationId: "organization-1",
            productSkuId: "sku-1",
            sellableQuantity: 1,
            storeId: "store-1",
            uncostedQuantity: 0,
            unresolvedDeficitQuantity: 0,
            updatedAt: 700,
            version: 3,
          },
        ],
      ]),
    });

    const sale = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        businessEventKey: "pos:sale-before-cost:line-1",
        contentFingerprint: "sale-before-cost-fingerprint",
        occurrenceAt: 800,
        physicalQuantityDelta: -3,
        recordedAt: 900,
        sellableQuantityDelta: -3,
        sourceId: "sale-before-cost",
        valuation: {
          disposition: "merchandise_sale",
          kind: "outbound",
          quantity: 3,
        },
      }),
    );
    tables.reportingFact.set("fact-sale-1", {
      _id: "fact-sale-1",
      amountMinor: 3_000,
      businessEventKey: "pos:sale-before-cost:line-1:fact",
      costStatus: "unknown",
      factType: "sale",
      inventoryEffectId: sale.effect._id,
      quantity: 3,
      revenueCurrencyCode: "GHS",
      sourceDomain: "pos",
      status: "canonical",
    });
    const receiptArgs = baseArgs({
      activityType: "stock_receipt",
      businessEventKey: "receipt:1:line-1",
      contentFingerprint: "receipt-fingerprint",
      effectType: "receipt",
      movementType: "receipt",
      occurrenceAt: 1_000,
      physicalQuantityDelta: 3,
      recordedAt: 1_100,
      sellableQuantityDelta: 3,
      sourceDomain: "procurement",
      sourceId: "receipt-1",
      sourceType: "purchaseOrderReceipt",
      valuation: {
        costBasis: knownUnitCostBasis({
          currency: "GHS",
          quantity: 3,
          unitCost: 100,
        }),
        kind: "inbound",
        quantity: 3,
      },
    });
    const result = await applyInventoryEffectWithCtx(ctx, receiptArgs);

    expect(result.position).toMatchObject({
      costedQuantity: 1,
      knownCostPoolMinor: 100,
      onHandQuantity: 1,
      sellableQuantity: 1,
      unresolvedDeficitQuantity: 0,
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 1,
      quantityAvailable: 1,
    });
    expect(result.effect).toMatchObject({
      knownCostPoolDeltaMinor: 100,
      unresolvedDeficitDelta: -2,
    });
    expect(result.adjustmentEffects).toEqual([
      expect.objectContaining({
        businessEventKey: `receipt:1:line-1:deficit:${sale.effect._id}`,
        effectType: "deficit_resolution",
        outboundBasisMinor: 200,
        physicalQuantityDelta: 0,
      }),
    ]);
    expect(
      Array.from(tables.reportingInventoryEffectSourceReference.values()),
    ).toContainEqual(
      expect.objectContaining({
        relation: "historical_merchandise_cogs",
        sourceId: sale.effect._id,
        sourceType: "reportingInventoryBusinessEvent",
      }),
    );
    expect(Array.from(tables.reportingInventoryDeficitLot.values())).toEqual([
      expect.objectContaining({
        outboundEffectId: sale.effect._id,
        remainingQuantity: 0,
        status: "resolved",
      }),
    ]);
    expect(Array.from(tables.reportingFact.values())).toContainEqual(
      expect.objectContaining({
        adjustmentKind: "deficit_cogs_revaluation",
        cogsKnownMinor: 200,
        coveredRevenueMinor: 2_000,
        factType: "post_close_adjustment",
        inventoryEffectId: result.adjustmentEffects[0]?._id,
        operatingDate: "2026-07-09",
      }),
    );

    const replay = await applyInventoryEffectWithCtx(ctx, receiptArgs);
    expect(replay.disposition).toBe("existing");
    expect(tables.reportingInventoryDeficitLot).toHaveLength(1);
    expect(tables.reportingInventoryEffect).toHaveLength(3);
  });

  it("rejects store-mismatched SKUs before writing evidence", async () => {
    const { ctx, tables } = createEffectCtx({
      productSku: new Map([
        [
          "sku-1",
          {
            _id: "sku-1",
            inventoryCount: 5,
            productId: "product-1",
            quantityAvailable: 5,
            storeId: "other-store",
          },
        ],
      ]),
    });

    await expect(applyInventoryEffectWithCtx(ctx, baseArgs())).rejects.toThrow(
      /store/i,
    );
    expect(tables.reportingInventoryEffect).toHaveLength(0);
    expect(tables.inventoryMovement).toHaveLength(0);
  });

  it("resolves deficit quantity without fabricating COGS for unknown inbound cost", async () => {
    const { ctx, tables } = createEffectCtx({
      productSku: productSkuSeed(0, 0),
      reportingInventoryPosition: new Map([
        ["position-1", authoritativeDeficitPosition(0)],
      ]),
    });
    await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        businessEventKey: "sale:unknown-deficit",
        physicalQuantityDelta: -2,
        sellableQuantityDelta: -2,
        valuation: {
          disposition: "merchandise_sale",
          kind: "outbound",
          quantity: 2,
        },
      }),
    );
    const receipt = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        businessEventKey: "receipt:unknown-deficit",
        effectType: "receipt",
        movementType: "receipt",
        occurrenceAt: 1_200,
        physicalQuantityDelta: 2,
        sellableQuantityDelta: 2,
        sourceDomain: "procurement",
        valuation: {
          costBasis: uncostedBasis(),
          kind: "inbound",
          quantity: 2,
        },
      }),
    );

    expect(receipt.adjustmentEffects).toEqual([]);
    expect(receipt.position.unresolvedDeficitQuantity).toBe(0);
    expect(
      Array.from(tables.reportingFact.values()).filter(
        (fact) => fact.factType === "post_close_adjustment",
      ),
    ).toEqual([]);
  });

  it("converges covered revenue exactly across three synchronous receipts", async () => {
    const { ctx, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(0, 0),
      reportingInventoryPosition: new Map([
        ["position-1", authoritativeDeficitPosition(0)],
      ]),
    });
    const sale = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        businessEventKey: "sale:three-unit-deficit",
        contentFingerprint: "sale-three-unit-deficit",
        physicalQuantityDelta: -3,
        sellableQuantityDelta: -3,
        valuation: {
          disposition: "merchandise_sale",
          kind: "outbound",
          quantity: 3,
        },
      }),
    );
    tables.reportingFact.set("fact-sale-three-unit-deficit", {
      _id: "fact-sale-three-unit-deficit",
      amountMinor: 100,
      businessEventKey: "sale:three-unit-deficit:fact",
      cogsKnownQuantity: 0,
      costStatus: "unknown",
      coveredRevenueMinor: 0,
      currencyCode: "GHS",
      factType: "sale",
      inventoryEffectId: sale.effect._id,
      quantity: 3,
      revenueCurrencyCode: "GHS",
      revenueKind: "merchandise",
      sourceDomain: "pos",
      status: "canonical",
      valuationCurrencyCode: "GHS",
    });

    for (const index of [1, 2, 3]) {
      await applyInventoryEffectWithCtx(
        ctx,
        baseArgs({
          activityType: "stock_receipt",
          businessEventKey: `receipt:three-unit-deficit:${index}`,
          contentFingerprint: `receipt-three-unit-deficit-${index}`,
          effectType: "receipt",
          movementType: "receipt",
          occurrenceAt: 1_000 + index,
          physicalQuantityDelta: 1,
          recordedAt: 1_100 + index,
          sellableQuantityDelta: 1,
          sourceDomain: "procurement",
          sourceId: `receipt-three-unit-deficit-${index}`,
          sourceType: "purchaseOrderReceipt",
          valuation: {
            costBasis: knownUnitCostBasis({
              currency: "GHS",
              quantity: 1,
              unitCost: 100,
            }),
            kind: "inbound",
            quantity: 1,
          },
        }),
      );
    }

    const revaluations = Array.from(tables.reportingFact.values()).filter(
      (fact) => fact.adjustmentKind === "deficit_cogs_revaluation",
    );
    expect(revaluations.map((fact) => fact.coveredRevenueMinor)).toEqual([
      33, 34, 33,
    ]);
    const contributions = [
      tables.reportingFact.get("fact-sale-three-unit-deficit")!,
      ...revaluations,
    ].flatMap((fact) => deriveFactMetricContributions(fact as never));
    const total = (metric: string) =>
      contributions
        .filter((row) => row.metric === metric)
        .reduce((sum, row) => sum + row.value, 0);
    expect(total("net_sales")).toBe(100);
    expect(total("known_cogs")).toBe(300);
    expect(total("gross_profit")).toBe(-200);
    expect(total("uncosted_revenue")).toBe(0);
    expect(total("units_sold")).toBe(3);
  });

  it("does not re-cover a prior unit after replay withholding", async () => {
    const { ctx, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(0, 0),
      reportingInventoryPosition: new Map([
        ["position-1", authoritativeDeficitPosition(0)],
      ]),
    });
    const sale = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        businessEventKey: "sale:withheld-deficit",
        contentFingerprint: "sale-withheld-deficit",
        physicalQuantityDelta: -2,
        sellableQuantityDelta: -2,
        valuation: {
          disposition: "merchandise_sale",
          kind: "outbound",
          quantity: 2,
        },
      }),
    );
    tables.reportingFact.set("fact-sale-withheld-deficit", {
      _id: "fact-sale-withheld-deficit",
      amountMinor: 200,
      businessEventKey: "sale:withheld-deficit:fact",
      cogsKnownQuantity: 0,
      costStatus: "unknown",
      coveredRevenueMinor: 0,
      currencyCode: "GHS",
      factType: "sale",
      inventoryEffectId: sale.effect._id,
      organizationId: "organization-1",
      productSkuId: "sku-1",
      quantity: 2,
      revenueCurrencyCode: "GHS",
      revenueKind: "merchandise",
      sourceDomain: "pos",
      status: "canonical",
      storeId: "store-1",
      valuationCurrencyCode: "GHS",
    });
    const receipt = (index: number) =>
      applyInventoryEffectWithCtx(
        ctx,
        baseArgs({
          activityType: "stock_receipt",
          businessEventKey: `receipt:withheld-deficit:${index}`,
          contentFingerprint: `receipt-withheld-deficit-${index}`,
          effectType: "receipt",
          movementType: "receipt",
          occurrenceAt: 1_000 + index,
          physicalQuantityDelta: 1,
          recordedAt: 1_100 + index,
          sellableQuantityDelta: 1,
          sourceDomain: "procurement",
          sourceId: `receipt-withheld-deficit-${index}`,
          sourceType: "purchaseOrderReceipt",
          valuation: {
            costBasis: knownUnitCostBasis({
              currency: "GHS",
              quantity: 1,
              unitCost: 100,
            }),
            kind: "inbound",
            quantity: 1,
          },
        }),
      );

    const firstReceipt = await receipt(1);
    const firstResolution = firstReceipt.adjustmentEffects[0]!;
    tables.reportingFact.set("fact-withheld-resolution", {
      _id: "fact-withheld-resolution",
      adjustmentKind: "deficit_cogs_revaluation",
      amountMinor: 0,
      businessEventKey: `occurrence-replay-withhold:replay-1:resolution:${firstResolution._id}`,
      cogsKnownMinor: -100,
      costStatus: "known",
      coveredRevenueMinor: -100,
      currencyCode: "GHS",
      factType: "post_close_adjustment",
      inventoryEffectId: firstResolution._id,
      organizationId: "organization-1",
      productSkuId: "sku-1",
      quantity: 0,
      revenueCurrencyCode: "GHS",
      sourceDomain: "inventory",
      status: "canonical",
      storeId: "store-1",
      valuationCurrencyCode: "GHS",
    });
    await receipt(2);

    const facts = Array.from(tables.reportingFact.values());
    const allocatedCoverage = facts
      .filter(
        (fact) =>
          fact.adjustmentKind === "deficit_cogs_revaluation" &&
          !fact.businessEventKey.startsWith("occurrence-replay"),
      )
      .map((fact) => fact.coveredRevenueMinor);
    expect(allocatedCoverage).toEqual([100, 100]);
    const contributions = facts.flatMap((fact) =>
      deriveFactMetricContributions(fact as never),
    );
    const total = (metric: string) =>
      contributions
        .filter((row) => row.metric === metric)
        .reduce((sum, row) => sum + row.value, 0);
    expect(total("known_cogs")).toBe(100);
    expect(total("gross_profit")).toBe(0);
    expect(total("uncosted_revenue")).toBe(100);
    expect(total("units_sold")).toBe(2);
  });

  it("keeps inventory-consumed deficit revaluation value-only", async () => {
    const { ctx, tables } = createEffectCtx({
      ...authoritativeProjectionSeed(),
      productSku: productSkuSeed(0, 0),
      reportingInventoryPosition: new Map([
        ["position-1", authoritativeDeficitPosition(0)],
      ]),
    });
    await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        businessEventKey: "service:consumed-before-cost",
        contentFingerprint: "service-consumed-before-cost",
        physicalQuantityDelta: -2,
        sellableQuantityDelta: -2,
        sourceDomain: "service",
        valuation: {
          disposition: "service_consumption",
          kind: "outbound",
          quantity: 2,
        },
      }),
    );
    await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        activityType: "stock_receipt",
        businessEventKey: "receipt:consumed-before-cost",
        contentFingerprint: "receipt-consumed-before-cost",
        effectType: "receipt",
        movementType: "receipt",
        occurrenceAt: 1_200,
        physicalQuantityDelta: 2,
        recordedAt: 1_300,
        sellableQuantityDelta: 2,
        sourceDomain: "procurement",
        valuation: {
          costBasis: knownUnitCostBasis({
            currency: "GHS",
            quantity: 2,
            unitCost: 100,
          }),
          kind: "inbound",
          quantity: 2,
        },
      }),
    );

    const consumedFacts = Array.from(tables.reportingFact.values()).filter(
      (fact) => fact.inventoryContributionKind === "inventory_consumed",
    );
    expect(consumedFacts).toEqual([
      expect.objectContaining({ quantity: 2 }),
      expect.objectContaining({ cogsKnownMinor: 200, quantity: 0 }),
    ]);
    expect(consumedFacts[0]?.cogsKnownMinor).toBeUndefined();
    const contributions = consumedFacts.flatMap((fact) =>
      deriveFactMetricContributions(fact as never),
    );
    expect(
      contributions
        .filter((row) => row.metric === "inventory_consumed_units")
        .reduce((sum, row) => sum + row.value, 0),
    ).toBe(2);
    expect(
      contributions
        .filter((row) => row.metric === "inventory_consumed_value")
        .reduce((sum, row) => sum + row.value, 0),
    ).toBe(200);
  });

  it("keeps unknown inbound cost explicit in authoritative inventory", async () => {
    const { ctx, tables } = createEffectCtx({
      productSku: productSkuSeed(0, 0),
    });
    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        businessEventKey: "receipt:unknown",
        effectType: "receipt",
        movementType: "receipt",
        physicalQuantityDelta: 1,
        sellableQuantityDelta: 1,
        valuation: {
          costBasis: uncostedBasis(),
          kind: "inbound",
          quantity: 1,
        },
      }),
    );

    expect(result.position).toMatchObject({
      costedQuantity: 0,
      knownCostPoolMinor: 0,
      uncostedQuantity: 1,
    });
    expect(result.effect).not.toHaveProperty("currencyCode");
    expect(Array.from(tables.reportingSkuEvidence.values())).toContainEqual(
      expect.objectContaining({
        businessEventKey: "receipt:unknown",
        costStatus: "unknown",
      }),
    );
  });

  it("records partial evidence when Store Schedule attribution is unavailable", async () => {
    const { ctx } = createEffectCtx({ productSku: productSkuSeed() });

    const result = await applyInventoryEffectWithCtx(
      ctx,
      baseArgs({
        operatingDate: undefined,
        scheduleVersionId: undefined,
      }),
    );

    expect(result.effect).toMatchObject({ completeness: "partial" });
    expect(result.effect).not.toHaveProperty("operatingDate");
    expect(result.effect).not.toHaveProperty("scheduleVersionId");
  });
});
