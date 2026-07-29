import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { knownUnitCostBasis, uncostedBasis } from "./valuation";
import {
  applyInventoryEffectWithCtx,
  applySkuValuationBasisCompensationWithCtx,
  applySkuValuationCorrectionWithCtx,
  type ApplyInventoryEffectArgs,
} from "./effects";

type TableName =
  | "inventoryMovement"
  | "product"
  | "productSku"
  | "reportingInventoryDeficitLedger"
  | "reportingInventoryDeficitLot"
  | "reportingInventoryDeficitResolutionWork"
  | "reportingInventoryEffect"
  | "reportingInventoryEffectSourceReference"
  | "reportingInventoryPosition"
  | "reportingInventoryPositionRevision"
  | "reportingSkuValuationCorrection"
  | "skuActivityEvent";

type Tables = Record<TableName, Map<string, Record<string, any>>>;

function createEffectCtx(seed: Partial<Tables> = {}) {
  const tables: Tables = {
    inventoryMovement: new Map(),
    product: new Map(),
    productSku: new Map(),
    reportingInventoryDeficitLedger: new Map(),
    reportingInventoryDeficitLot: new Map(),
    reportingInventoryDeficitResolutionWork: new Map(),
    reportingInventoryEffect: new Map(),
    reportingInventoryEffectSourceReference: new Map(),
    reportingInventoryPosition: new Map(),
    reportingInventoryPositionRevision: new Map(),
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
    expect(Array.from(tables.skuActivityEvent.values())[0]).toMatchObject({
      workItemId: "work-item-1",
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
              mode: "compatibility_shadow",
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
      expect(expectedMetric).toMatch(/known_cogs|inventory_consumed_value/);
    },
  );

  it("materializes a sellable return as units returned and a known COGS reversal", async () => {
    const { ctx, tables } = createEffectCtx({
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
  });

  it("reverses returned service material in its inventory-consumed lane", async () => {
    const { ctx, tables } = createEffectCtx({
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
  });

  it("restocks an operational cancellation without creating a financial fact", async () => {
    const { ctx, tables } = createEffectCtx({
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

  it("sets a future SKU cost without assigning valuation currency to zero stock", async () => {
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
      productSku: productSkuSeed(0, 0),
    });

    await applySkuValuationCorrectionWithCtx(ctx, {
      actorUserId: "user-1" as Id<"athenaUser">,
      correctedInventoryCount: 0,
      correctedQuantityAvailable: 0,
      correctedUnitCostMinor: 5_000,
      currencyCode: "GHS",
      currencyMinorUnitScale: 2,
      occurrenceAt: 1_000,
      organizationId: "organization-1" as Id<"organization">,
      productSkuId: "sku-1" as Id<"productSku">,
      reason: "Legacy inventory import cost overlay",
      requestKey: "inventory-cost-overlay:run-1:row-1:apply",
      storeId: "store-1" as Id<"store">,
    });

    expect(tables.productSku.get("sku-1")).toMatchObject({ unitCost: 5_000 });
    const position = Array.from(
      tables.reportingInventoryPosition.values(),
    )[0];
    expect(position).toMatchObject({
      costedQuantity: 0,
      knownCostPoolMinor: 0,
      uncostedQuantity: 0,
      valuationStatus: "current",
    });
    expect(position.currencyCode).toBeUndefined();
    expect(position.currencyMinorUnitScale).toBeUndefined();
  });

  it("restores an exact mixed basis with missing SKU cost and preserves all counts", async () => {
    const { ctx, scheduler, tables } = createEffectCtx({
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
      productSku: new Map([
        [
          "sku-1",
          {
            ...productSkuSeed(3, 2).get("sku-1"),
            unitCost: 200,
          },
        ],
      ]),
      reportingInventoryPosition: new Map([
        [
          "position-1",
          {
            _id: "position-1",
            costedQuantity: 3,
            currencyCode: "GHS",
            currencyMinorUnitScale: 2,
            knownCostPoolMinor: 600,
            lastEffectAt: 900,
            mode: "authoritative",
            onHandQuantity: 3,
            organizationId: "organization-1",
            productSkuId: "sku-1",
            sellableQuantity: 2,
            storeId: "store-1",
            uncostedQuantity: 0,
            unresolvedDeficitQuantity: 0,
            updatedAt: 900,
            valuationStatus: "current",
            version: 8,
          },
        ],
      ]),
    });

    const args = {
      actorUserId: "user-1" as Id<"athenaUser">,
      currencyMinorUnitScale: 2,
      expectedCurrentBasis: {
        version: 8,
        costedQuantity: 3,
        currencyCode: "GHS",
        knownCostPoolMinor: 600,
        uncostedQuantity: 0,
      },
      expectedInventoryCount: 3,
      expectedQuantityAvailable: 2,
      expectedUnitCostMinor: 200,
      occurrenceAt: 2_000,
      organizationId: "organization-1" as Id<"organization">,
      productSkuId: "sku-1" as Id<"productSku">,
      reason: "Undo inventory import cost overlay",
      requestKey: "cost-overlay:undo:run-1:row-1",
      storeId: "store-1" as Id<"store">,
      targetBasis: {
        costedQuantity: 1,
        currencyCode: "GHS",
        knownCostPoolMinor: 101,
        uncostedQuantity: 2,
      },
      targetUnitCostMinor: null,
    };

    const result = await applySkuValuationBasisCompensationWithCtx(ctx, args);

    expect(result.replayed).toBe(false);
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 3,
      quantityAvailable: 2,
      unitCost: undefined,
    });
    expect(tables.reportingInventoryPosition.get("position-1")).toMatchObject({
      costedQuantity: 1,
      currencyCode: "GHS",
      knownCostPoolMinor: 101,
      onHandQuantity: 3,
      sellableQuantity: 2,
      uncostedQuantity: 2,
      version: 9,
    });
    expect(tables.inventoryMovement).toHaveLength(0);
    expect(tables.reportingInventoryEffect).toHaveLength(1);
    expect(tables.reportingInventoryPositionRevision).toHaveLength(1);
    expect(tables.reportingSkuValuationCorrection).toHaveLength(1);
    expect(tables.skuActivityEvent).toHaveLength(1);
    // Legacy projection scheduling was removed with the old reporting layer —
    // compensation no longer schedules any follow-up work.
    expect(scheduler.runAfter).toHaveBeenCalledTimes(0);
    expect(
      Array.from(tables.reportingInventoryEffect.values())[0],
    ).toMatchObject({
      costedQuantityDelta: -2,
      knownCostPoolDeltaMinor: -499,
      physicalQuantityDelta: 0,
      sellableQuantityDelta: 0,
      uncostedQuantityDelta: 2,
    });

    const replay = await applySkuValuationBasisCompensationWithCtx(ctx, {
      ...args,
      occurrenceAt: 3_000,
      reason: " Undo inventory import cost overlay ",
      requestKey: " cost-overlay:undo:run-1:row-1 ",
    });
    expect(replay.replayed).toBe(true);
    expect(tables.reportingInventoryEffect).toHaveLength(1);
    expect(tables.reportingSkuValuationCorrection).toHaveLength(1);
    // No projection scheduling in the rebuilt reporting layer (see above).
    expect(scheduler.runAfter).toHaveBeenCalledTimes(0);

    await expect(
      applySkuValuationBasisCompensationWithCtx(ctx, {
        ...args,
        targetBasis: { ...args.targetBasis, knownCostPoolMinor: 102 },
      }),
    ).rejects.toThrow(/conflicts with existing content/i);
  });

  it("preserves explicit zero SKU cost during exact-basis compensation", async () => {
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
      productSku: new Map([
        [
          "sku-1",
          {
            ...productSkuSeed(3, 2).get("sku-1"),
            unitCost: 200,
          },
        ],
      ]),
      reportingInventoryPosition: new Map([
        [
          "position-1",
          {
            _id: "position-1",
            costedQuantity: 3,
            currencyCode: "GHS",
            currencyMinorUnitScale: 2,
            knownCostPoolMinor: 600,
            lastEffectAt: 900,
            mode: "authoritative",
            onHandQuantity: 3,
            organizationId: "organization-1",
            productSkuId: "sku-1",
            sellableQuantity: 2,
            storeId: "store-1",
            uncostedQuantity: 0,
            unresolvedDeficitQuantity: 0,
            updatedAt: 900,
            valuationStatus: "current",
            version: 8,
          },
        ],
      ]),
    });

    await applySkuValuationBasisCompensationWithCtx(ctx, {
      actorUserId: "user-1" as Id<"athenaUser">,
      currencyMinorUnitScale: 2,
      expectedCurrentBasis: {
        version: 8,
        costedQuantity: 3,
        currencyCode: "GHS",
        knownCostPoolMinor: 600,
        uncostedQuantity: 0,
      },
      expectedInventoryCount: 3,
      expectedQuantityAvailable: 2,
      expectedUnitCostMinor: 200,
      occurrenceAt: 2_000,
      organizationId: "organization-1" as Id<"organization">,
      productSkuId: "sku-1" as Id<"productSku">,
      reason: "Undo inventory import cost overlay",
      requestKey: "cost-overlay:undo:run-1:row-zero",
      storeId: "store-1" as Id<"store">,
      targetBasis: {
        costedQuantity: 3,
        currencyCode: "GHS",
        knownCostPoolMinor: 0,
        uncostedQuantity: 0,
      },
      targetUnitCostMinor: 0,
    });

    expect(tables.productSku.get("sku-1")?.unitCost).toBe(0);
    expect(tables.reportingInventoryPosition.get("position-1")).toMatchObject({
      costedQuantity: 3,
      knownCostPoolMinor: 0,
      uncostedQuantity: 0,
    });
  });

  it("rejects stale compensation before writing any evidence", async () => {
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
      productSku: new Map([
        [
          "sku-1",
          {
            ...productSkuSeed(3, 2).get("sku-1"),
            unitCost: 200,
          },
        ],
      ]),
      reportingInventoryPosition: new Map([
        [
          "position-1",
          {
            _id: "position-1",
            costedQuantity: 3,
            currencyCode: "GHS",
            knownCostPoolMinor: 600,
            lastEffectAt: 900,
            mode: "authoritative",
            onHandQuantity: 3,
            organizationId: "organization-1",
            productSkuId: "sku-1",
            sellableQuantity: 2,
            storeId: "store-1",
            uncostedQuantity: 0,
            unresolvedDeficitQuantity: 0,
            updatedAt: 900,
            valuationStatus: "current",
            version: 8,
          },
        ],
      ]),
    });

    await expect(
      applySkuValuationBasisCompensationWithCtx(ctx, {
        actorUserId: "user-1" as Id<"athenaUser">,
        currencyMinorUnitScale: 2,
        expectedCurrentBasis: {
          version: 7,
          costedQuantity: 3,
          currencyCode: "GHS",
          knownCostPoolMinor: 600,
          uncostedQuantity: 0,
        },
        expectedInventoryCount: 3,
        expectedQuantityAvailable: 2,
        expectedUnitCostMinor: 200,
        occurrenceAt: 2_000,
        organizationId: "organization-1" as Id<"organization">,
        productSkuId: "sku-1" as Id<"productSku">,
        reason: "Undo inventory import cost overlay",
        requestKey: "cost-overlay:undo:run-1:stale-row",
        storeId: "store-1" as Id<"store">,
        targetBasis: {
          costedQuantity: 1,
          currencyCode: "GHS",
          knownCostPoolMinor: 101,
          uncostedQuantity: 2,
        },
        targetUnitCostMinor: null,
      }),
    ).rejects.toThrow(/stale/i);

    expect(tables.reportingInventoryEffect).toHaveLength(0);
    expect(tables.reportingSkuValuationCorrection).toHaveLength(0);
    expect(tables.skuActivityEvent).toHaveLength(0);
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
  });

  it("keeps an offline Monday sale unknown after a Tuesday receipt", async () => {
    const { ctx, tables } = createEffectCtx({
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

    const replay = await applyInventoryEffectWithCtx(ctx, args);
    expect(replay.disposition).toBe("existing");
    expect(tables.productSku.get("sku-1")?.inventoryCount).toBe(8);
  });

  it("keeps later effects unknown while occurrence-order rebuild is pending", async () => {
    const { ctx, tables } = createEffectCtx({
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
  });

  it("commits a cross-currency receipt while withholding pooled valuation", async () => {
    const { ctx, tables } = createEffectCtx({
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
  });

  it("allows a late receipt to resolve an existing deficit without corrupting on-hand", async () => {
    const { ctx, tables } = createEffectCtx({
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
      mode: "compatibility_shadow",
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
      join(process.cwd(), "convex", "inventoryLedger", "effects.ts"),
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
  });

  it("links known receipt cost to the historical sale that created a deficit", async () => {
    const { ctx, tables } = createEffectCtx({
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
