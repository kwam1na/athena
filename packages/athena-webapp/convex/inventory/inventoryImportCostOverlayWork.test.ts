import { describe, expect, it, vi } from "vitest";

import type { MutationCtx } from "../_generated/server";

const mockedEffects = vi.hoisted(() => ({
  applySkuValuationBasisCompensationWithCtx: vi.fn(),
  applySkuValuationCorrectionWithCtx: vi.fn(),
}));
const mockedSkuSearch = vi.hoisted(() => ({
  upsertProductSkuSearchProjection: vi.fn(),
}));

vi.mock("../reporting/inventory/effects", () => mockedEffects);
vi.mock("./skuSearch", () => mockedSkuSearch);

import {
  costOverlayConstructionIdentity,
  materializeCostOverlayRows,
} from "./inventoryImportCostOverlayConstruction";
import {
  abandonStaleCostOverlayConstruction,
  assertCostOverlayWorkFence,
  applyCostOverlayRowWithCtx,
  classifyCostOverlayUndoRowWithCtx,
  costOverlayPreparedImpact,
  frozenCostOverlayLineagesMatch,
  mergeLargestCostOverlayImpacts,
  nextCostOverlayTerminalStatus,
  rollCostOverlayManifestDigest,
  undoCostOverlayRowWithCtx,
} from "./inventoryImportCostOverlayWork";

describe("cost overlay impact samples", () => {
  it("keeps a bounded, magnitude-ordered SKU summary", () => {
    const impacts = [
      ["A", 10],
      ["B", -90],
      ["C", 40],
      ["D", 20],
      ["E", 30],
      ["F", 80],
    ].reduce(
      (current, [productName, deltaMinor]) =>
        mergeLargestCostOverlayImpacts(current, {
          afterMinor: Number(deltaMinor),
          beforeMinor: 0,
          deltaMinor: Number(deltaMinor),
          productName: String(productName),
        }),
      [] as ReturnType<typeof mergeLargestCostOverlayImpacts>,
    );

    expect(impacts.map((impact) => impact.productName)).toEqual([
      "B",
      "F",
      "C",
      "E",
      "D",
    ]);
  });
});

type TestRow = Record<string, unknown> & { _id: string };

function createWorkContext() {
  mockedEffects.applySkuValuationCorrectionWithCtx.mockReset();
  mockedEffects.applySkuValuationBasisCompensationWithCtx.mockReset();
  mockedSkuSearch.upsertProductSkuSearchProjection.mockReset();
  const lineageQueryIndexes: string[] = [];
  let lineagePaginateCount = 0;
  const tables: Record<string, Map<string, TestRow>> = {
    inventoryImportCostOverlayRow: new Map(),
    inventoryImportCostOverlayRun: new Map(),
    inventoryImportProvisionalSku: new Map(),
    posRegisterCatalogRevision: new Map(),
    productSku: new Map(),
    productSkuSearch: new Map(),
    reportingInventoryPosition: new Map(),
  };
  const db = {
    async get(table: string, id: string) {
      return tables[table]?.get(id) ?? null;
    },
    async patch(table: string, id: string, patch: Record<string, unknown>) {
      tables[table].set(id, {
        ...tables[table].get(id)!,
        ...patch,
      });
    },
    query(table: string) {
      const eqs: Record<string, unknown> = {};
      const api = {
        withIndex(
          name: string,
          callback: (q: {
            eq(field: string, value: unknown): unknown;
          }) => unknown,
        ) {
          if (table === "inventoryImportProvisionalSku") {
            lineageQueryIndexes.push(name);
          }
          const q = {
            eq(field: string, value: unknown) {
              eqs[field] = value;
              return q;
            },
          };
          callback(q);
          return api;
        },
        async take(limit: number) {
          return Array.from(tables[table].values())
            .filter((row) =>
              Object.entries(eqs).every(
                ([field, value]) => row[field] === value,
              ),
            )
            .slice(0, limit);
        },
        async collect() {
          return api.take(Number.MAX_SAFE_INTEGER);
        },
        async paginate({
          cursor,
          numItems,
        }: {
          cursor: string | null;
          numItems: number;
        }) {
          if (table === "inventoryImportProvisionalSku") {
            lineagePaginateCount += 1;
          }
          const all = await api.take(Number.MAX_SAFE_INTEGER);
          const start = cursor === null ? 0 : Number(cursor);
          const page = all.slice(start, start + numItems);
          const next = start + page.length;
          return {
            continueCursor: String(next),
            isDone: next >= all.length,
            page,
          };
        },
        async unique() {
          const rows = await api.take(2);
          if (rows.length > 1) throw new Error("not unique");
          return rows[0] ?? null;
        },
      };
      return api;
    },
  };

  const run = {
    _id: "run-1",
    storeId: "store-1",
    organizationId: "org-1",
    reviewVersionId: "review-1",
    createdByUserId: "user-1",
    applyConfirmedByUserId: "apply-user",
    undoRequestedByUserId: "undo-user",
    currencyCode: "GHS",
    currencyMinorUnitScale: 2,
    sourceDigest: "source-digest",
    appliedRowCount: 0,
    applyCursor: 0,
    applyExceptionCount: 0,
    undoneRowCount: 0,
    undoCursor: 0,
    undoExceptionCount: 0,
  };
  const row = {
    _id: "row-1",
    rowOrdinal: 0,
    productSkuId: "sku-1",
    provisionalSkuId: "provisional-1",
    normalizedCostMinor: 425,
    currentUnitCostMinor: undefined,
    preInventoryCount: 3,
    preQuantityAvailable: 2,
    preCostedQuantity: 0,
    preUncostedQuantity: 3,
    preKnownCostPoolMinor: 0,
    preCurrencyCode: undefined,
    preCurrencyMinorUnitScale: undefined,
    prePositionVersion: 1,
    preProvisionalUpdatedAt: 101,
    frozenLineages: [
      {
        provisionalSkuId: "provisional-1",
        productSkuId: "sku-1",
        status: "active",
        updatedAt: 101,
      },
      {
        provisionalSkuId: "provisional-2",
        productSkuId: "sku-1",
        status: "active",
        updatedAt: 102,
      },
    ],
    frozenLineageDigest: "frozen",
  };
  tables.inventoryImportCostOverlayRun.set(run._id, run);
  tables.inventoryImportCostOverlayRow.set(row._id, row);
  tables.productSku.set("sku-1", {
    _id: "sku-1",
    storeId: "store-1",
    inventoryCount: 3,
    quantityAvailable: 2,
    unitCost: undefined,
  });
  tables.productSkuSearch.set("search-1", {
    _id: "search-1",
    productSkuId: "sku-1",
    storeId: "store-1",
    unitCost: undefined,
  });
  tables.posRegisterCatalogRevision.set("revision-1", {
    _id: "revision-1",
    revision: 7,
    storeId: "store-1",
  });
  tables.reportingInventoryPosition.set("position-1", {
    _id: "position-1",
    storeId: "store-1",
    productSkuId: "sku-1",
    costedQuantity: 0,
    uncostedQuantity: 3,
    unresolvedDeficitQuantity: 0,
    knownCostPoolMinor: 0,
    currencyCode: undefined,
    currencyMinorUnitScale: undefined,
    version: 1,
  });
  for (const [id, updatedAt] of [
    ["provisional-1", 101],
    ["provisional-2", 102],
  ] as const) {
    tables.inventoryImportProvisionalSku.set(id, {
      _id: id,
      storeId: "store-1",
      reviewVersionId: "review-1",
      productSkuId: "sku-1",
      status: "active",
      updatedAt,
    });
  }

  const ctx = { db } as unknown as MutationCtx;
  mockedEffects.applySkuValuationCorrectionWithCtx.mockImplementation(
    async () => {
      await db.patch("productSku", "sku-1", { unitCost: 425 });
      await db.patch("reportingInventoryPosition", "position-1", {
        costedQuantity: 3,
        uncostedQuantity: 0,
        knownCostPoolMinor: 1275,
        currencyCode: "GHS",
        currencyMinorUnitScale: 2,
        version: 2,
      });
      return {
        correctionId: "correction-apply",
        inventoryEffectId: "effect-apply",
      };
    },
  );
  mockedEffects.applySkuValuationBasisCompensationWithCtx.mockImplementation(
    async () => {
      await db.patch("productSku", "sku-1", { unitCost: undefined });
      await db.patch("reportingInventoryPosition", "position-1", {
        costedQuantity: 0,
        uncostedQuantity: 3,
        knownCostPoolMinor: 0,
        currencyCode: undefined,
        currencyMinorUnitScale: undefined,
        version: 3,
      });
      return {
        correctionId: "correction-undo",
        inventoryEffectId: "effect-undo",
      };
    },
  );
  mockedSkuSearch.upsertProductSkuSearchProjection.mockImplementation(
    async (projectionCtx: MutationCtx, productSkuId: string) => {
      const sku = await projectionCtx.db.get(
        "productSku",
        productSkuId as never,
      );
      await projectionCtx.db.patch("productSkuSearch", "search-1" as never, {
        unitCost: sku?.unitCost,
      });
      return "upserted";
    },
  );
  return {
    ctx,
    db,
    lineageQueryIndexes,
    get lineagePaginateCount() {
      return lineagePaginateCount;
    },
    row,
    run,
    tables,
  };
}

describe("inventory import cost overlay work", () => {
  it("revalidates undo preview disposition against current SKU and valuation state", async () => {
    const fixture = createWorkContext();
    await applyCostOverlayRowWithCtx(
      fixture.ctx,
      fixture.run as never,
      fixture.row as never,
    );
    expect(
      await classifyCostOverlayUndoRowWithCtx(
        fixture.ctx,
        fixture.run as never,
        fixture.tables.inventoryImportCostOverlayRow.get("row-1") as never,
      ),
    ).toEqual({ kind: "compensable" });

    await fixture.db.patch("productSku", "sku-1", { quantityAvailable: 1 });
    expect(
      await classifyCostOverlayUndoRowWithCtx(
        fixture.ctx,
        fixture.run as never,
        fixture.tables.inventoryImportCostOverlayRow.get("row-1") as never,
      ),
    ).toEqual({ kind: "stale", reason: "stale_before_undo" });

    await fixture.db.patch("productSku", "sku-1", { quantityAvailable: 2 });
    await undoCostOverlayRowWithCtx(
      fixture.ctx,
      fixture.run as never,
      fixture.tables.inventoryImportCostOverlayRow.get("row-1") as never,
    );
    expect(
      await classifyCostOverlayUndoRowWithCtx(
        fixture.ctx,
        fixture.run as never,
        fixture.tables.inventoryImportCostOverlayRow.get("row-1") as never,
      ),
    ).toEqual({ kind: "restored" });
  });

  it("fences queued apply and undo work by both direction and epoch", () => {
    expect(() =>
      assertCostOverlayWorkFence({
        actualEpoch: 4,
        actualStatus: "applying",
        direction: "apply",
        expectedEpoch: 4,
      }),
    ).not.toThrow();
    expect(() =>
      assertCostOverlayWorkFence({
        actualEpoch: 5,
        actualStatus: "undoing",
        direction: "apply",
        expectedEpoch: 4,
      }),
    ).toThrow("Cost overlay work checkpoint is stale.");
  });

  it("keeps manifest resumption deterministic", () => {
    const first = rollCostOverlayManifestDigest("", "row-1");
    const resumed = rollCostOverlayManifestDigest(first, "row-2");
    expect(resumed).toBe(
      rollCostOverlayManifestDigest(
        rollCostOverlayManifestDigest("", "row-1"),
        "row-2",
      ),
    );
    expect(resumed).not.toBe(first);
  });

  it("durably records construction-prefix drift before abandoning resumption", async () => {
    const run = {
      _id: "run-prefix",
      constructionCursor: 50,
      epoch: 3,
      status: "draft",
    };
    const patch = vi.fn(async (_table, _id, value) =>
      Object.assign(run, value),
    );
    const handler = (
      abandonStaleCostOverlayConstruction as unknown as {
        _handler: (
          ctx: unknown,
          args: unknown,
        ) => Promise<{ disposition: string }>;
      }
    )._handler;
    await expect(
      handler(
        {
          db: {
            get: vi.fn(async () => run),
            patch,
          },
        },
        { expectedCursor: 50, expectedEpoch: 3, runId: "run-prefix" },
      ),
    ).resolves.toEqual({ disposition: "abandoned" });
    expect(patch).toHaveBeenCalledWith(
      "inventoryImportCostOverlayRun",
      "run-prefix",
      expect.objectContaining({
        constructionFailureReason: "construction_prefix_changed",
        status: "abandoned",
      }),
    );
  });

  it("durably records a bounded-construction scope failure", async () => {
    const run = {
      _id: "run-too-large",
      constructionCursor: 0,
      epoch: 3,
      status: "draft",
    };
    const patch = vi.fn(async (_table, _id, value) =>
      Object.assign(run, value),
    );
    const handler = (
      abandonStaleCostOverlayConstruction as unknown as {
        _handler: (
          ctx: unknown,
          args: unknown,
        ) => Promise<{ disposition: string }>;
      }
    )._handler;

    await handler(
      {
        db: {
          get: vi.fn(async () => run),
          patch,
        },
      },
      {
        expectedCursor: 0,
        expectedEpoch: 3,
        failureReason: "construction_scope_too_large",
        runId: "run-too-large",
      },
    );

    expect(patch).toHaveBeenCalledWith(
      "inventoryImportCostOverlayRun",
      "run-too-large",
      expect.objectContaining({
        constructionFailureReason: "construction_scope_too_large",
        status: "abandoned",
      }),
    );
  });

  it("reports exception-bearing terminal states without hiding progress", () => {
    expect(
      nextCostOverlayTerminalStatus({
        direction: "apply",
        exceptionCount: 0,
      }),
    ).toBe("applied");
    expect(
      nextCostOverlayTerminalStatus({
        direction: "undo",
        exceptionCount: 1,
      }),
    ).toBe("undone_with_exceptions");
  });

  it("coalesces identical SKU costs and freezes provisional freshness", () => {
    const rows = materializeCostOverlayRows({
      anchors: [
        {
          provisionalSkuId: "provisional-a" as never,
          productSkuId: "sku-a" as never,
          rowKey: "2:A::Wig",
          rowNumber: 2,
          status: "active",
          provisionalUpdatedAt: 101,
          sku: {
            barcode: "111",
            inventoryCount: 3,
            productName: "Body Wave",
            quantityAvailable: 2,
            sku: "A",
          },
        },
        {
          provisionalSkuId: "provisional-b" as never,
          productSkuId: "sku-a" as never,
          rowKey: "3:A::Wig",
          rowNumber: 3,
          status: "active",
          provisionalUpdatedAt: 102,
          sku: {
            inventoryCount: 3,
            quantityAvailable: 2,
          },
        },
      ],
      content: "sku,Legacy Cost\nA,4.25\nA,4.25\n",
      fileName: "legacy.csv",
      selectedColumn: {
        kind: "csv",
        label: "Legacy Cost",
        ordinal: 1,
      },
      currencyMinorUnitScale: 2,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      normalizedCostMinor: 425,
      preProvisionalUpdatedAt: 101,
      decision: "selected_missing_cost",
      eligibility: "eligible",
      productName: "Body Wave",
      sku: "A",
      barcode: "111",
      frozenLineages: [
        expect.objectContaining({
          provisionalSkuId: "provisional-a",
          updatedAt: 101,
        }),
        expect.objectContaining({
          provisionalSkuId: "provisional-b",
          updatedAt: 102,
        }),
      ],
    });
  });

  it("blocks conflicting duplicate source costs for one SKU", () => {
    const rows = materializeCostOverlayRows({
      anchors: [
        {
          provisionalSkuId: "provisional-a" as never,
          productSkuId: "sku-a" as never,
          rowKey: "2:A::Wig",
          rowNumber: 2,
          status: "active",
          provisionalUpdatedAt: 101,
          sku: { inventoryCount: 1, quantityAvailable: 1, unitCost: 200 },
        },
        {
          provisionalSkuId: "provisional-b" as never,
          productSkuId: "sku-a" as never,
          rowKey: "3:A::Wig",
          rowNumber: 3,
          status: "finalized",
          provisionalUpdatedAt: 102,
          sku: { inventoryCount: 1, quantityAvailable: 1, unitCost: 200 },
        },
      ],
      content: "sku,Legacy Cost\nA,4.25\nA,5.00\n",
      selectedColumn: {
        kind: "csv",
        label: "Legacy Cost",
        ordinal: 1,
      },
      currencyMinorUnitScale: 2,
    });

    expect(rows[0]).toMatchObject({
      decision: "ineligible",
      eligibility: "ineligible",
      eligibilityReason: "conflicting_source_costs",
    });
  });

  it("freezes closed and rejected membership and makes prefix identity sensitive to inserted or reassigned anchors", () => {
    const baseAnchors = [
      {
        provisionalSkuId: "provisional-a" as never,
        productSkuId: "sku-a" as never,
        rowKey: "2:A::Wig",
        rowNumber: 2,
        status: "active" as const,
        provisionalUpdatedAt: 101,
        sku: { inventoryCount: 1, quantityAvailable: 1 },
      },
      {
        provisionalSkuId: "provisional-closed" as never,
        productSkuId: "sku-a" as never,
        rowKey: "3:A::Wig",
        rowNumber: 3,
        status: "closed" as const,
        provisionalUpdatedAt: 102,
      },
      {
        provisionalSkuId: "provisional-rejected" as never,
        productSkuId: "sku-a" as never,
        rowKey: "4:A::Wig",
        rowNumber: 4,
        status: "rejected" as const,
        provisionalUpdatedAt: 103,
      },
    ];
    const base = materializeCostOverlayRows({
      anchors: baseAnchors,
      content: "sku,Legacy Cost\nA,4.25\nA,4.25\nA,4.25\n",
      selectedColumn: { kind: "csv", label: "Legacy Cost", ordinal: 1 },
      currencyMinorUnitScale: 2,
    });
    expect(base[0].frozenLineages.map((lineage) => lineage.status)).toEqual([
      "active",
      "closed",
      "rejected",
    ]);

    const reassigned = materializeCostOverlayRows({
      anchors: [
        {
          provisionalSkuId: "inserted" as never,
          productSkuId: "sku-0" as never,
          rowKey: "5:Z::Wig",
          rowNumber: 5,
          status: "active",
          provisionalUpdatedAt: 104,
          sku: { inventoryCount: 1, quantityAvailable: 1 },
        },
        ...baseAnchors.map((anchor) =>
          anchor.provisionalSkuId === ("provisional-closed" as never)
            ? { ...anchor, productSkuId: "sku-b" as never }
            : anchor,
        ),
      ],
      content: "sku,Legacy Cost\nA,4.25\nA,4.25\nA,4.25\nZ,4.25\n",
      selectedColumn: { kind: "csv", label: "Legacy Cost", ordinal: 1 },
      currencyMinorUnitScale: 2,
    });
    expect(costOverlayConstructionIdentity(reassigned[0])).not.toBe(
      costOverlayConstructionIdentity(base[0]),
    );
  });

  it("makes a SKU with more than 100 frozen lineages explicitly ineligible", () => {
    const rows = materializeCostOverlayRows({
      anchors: Array.from({ length: 101 }, (_, index) => ({
        provisionalSkuId: `provisional-${index}` as never,
        productSkuId: "sku-a" as never,
        rowKey: `${index + 2}:A::Wig`,
        rowNumber: index + 2,
        status: "active" as const,
        provisionalUpdatedAt: 100 + index,
        sku: { inventoryCount: 1, quantityAvailable: 1 },
      })),
      content: [
        "sku,Legacy Cost",
        ...Array.from({ length: 101 }, () => "A,4.25"),
      ].join("\n"),
      selectedColumn: { kind: "csv", label: "Legacy Cost", ordinal: 1 },
      currencyMinorUnitScale: 2,
    });
    expect(rows[0]).toMatchObject({
      decision: "ineligible",
      eligibility: "ineligible",
      eligibilityReason: "lineage_limit_exceeded",
    });
    expect(rows[0].frozenLineages).toHaveLength(100);
  });

  it("uses the exact pre-cost pool and post basis for mixed-basis impact", () => {
    expect(
      costOverlayPreparedImpact({
        normalizedCostMinor: 500,
        preInventoryCount: 4,
        preKnownCostPoolMinor: 750,
      } as never),
    ).toEqual({ beforeMinor: 750, afterMinor: 2000 });
  });

  it("makes unsafe cost multiplication ineligible before valuation work", () => {
    const rows = materializeCostOverlayRows({
      anchors: [
        {
          provisionalSkuId: "provisional-a" as never,
          productSkuId: "sku-a" as never,
          rowKey: "2:A::Wig",
          rowNumber: 2,
          status: "active",
          provisionalUpdatedAt: 101,
          sku: {
            inventoryCount: Number.MAX_SAFE_INTEGER,
            quantityAvailable: 1,
          },
        },
      ],
      content: "sku,Legacy Cost\nA,2.00\n",
      selectedColumn: { kind: "csv", label: "Legacy Cost", ordinal: 1 },
      currencyMinorUnitScale: 2,
    });
    expect(rows[0]).toMatchObject({
      decision: "ineligible",
      eligibilityReason: "safe_integer_overflow",
    });
  });

  it("applies valuation and provenance to every active lineage, then exactly compensates undo", async () => {
    const fixture = createWorkContext();
    await applyCostOverlayRowWithCtx(
      fixture.ctx,
      fixture.run as never,
      fixture.row as never,
    );

    expect(
      mockedEffects.applySkuValuationCorrectionWithCtx,
    ).toHaveBeenCalledWith(
      fixture.ctx,
      expect.objectContaining({ actorUserId: "apply-user" }),
    );
    for (const lineageId of ["provisional-1", "provisional-2"]) {
      expect(
        fixture.tables.inventoryImportProvisionalSku.get(lineageId),
      ).toMatchObject({
        costOverlayRunId: "run-1",
        costOverlayRowId: "row-1",
        costOverlayUnitCost: 425,
      });
    }
    expect(
      fixture.tables.inventoryImportCostOverlayRow.get("row-1"),
    ).toMatchObject({
      applyCorrectionId: "correction-apply",
      postKnownCostPoolMinor: 1275,
      postPositionVersion: 2,
      workStatus: "applied",
    });
    expect(
      fixture.tables.inventoryImportCostOverlayRun.get("run-1"),
    ).toMatchObject({
      appliedRowCount: 1,
      applyCursor: 1,
    });
    expect(fixture.tables.productSkuSearch.get("search-1")).toMatchObject({
      unitCost: 425,
    });
    expect(mockedSkuSearch.upsertProductSkuSearchProjection).toHaveBeenNthCalledWith(
      1,
      fixture.ctx,
      "sku-1",
    );
    expect(
      fixture.tables.posRegisterCatalogRevision.get("revision-1"),
    ).toMatchObject({ revision: 7 });

    await undoCostOverlayRowWithCtx(
      fixture.ctx,
      fixture.tables.inventoryImportCostOverlayRun.get("run-1") as never,
      fixture.tables.inventoryImportCostOverlayRow.get("row-1") as never,
    );

    expect(
      mockedEffects.applySkuValuationBasisCompensationWithCtx,
    ).toHaveBeenCalledWith(
      fixture.ctx,
      expect.objectContaining({
        actorUserId: "undo-user",
        expectedCurrentBasis: expect.objectContaining({
          knownCostPoolMinor: 1275,
          version: 2,
        }),
        targetBasis: {
          costedQuantity: 0,
          currencyCode: null,
          knownCostPoolMinor: 0,
          uncostedQuantity: 3,
        },
      }),
    );
    expect(
      fixture.tables.inventoryImportCostOverlayRow.get("row-1"),
    ).toMatchObject({
      undoCorrectionId: "correction-undo",
      workStatus: "undone",
    });
    expect(fixture.tables.productSkuSearch.get("search-1")).toMatchObject({
      unitCost: undefined,
    });
    expect(mockedSkuSearch.upsertProductSkuSearchProjection).toHaveBeenNthCalledWith(
      2,
      fixture.ctx,
      "sku-1",
    );
    expect(
      fixture.tables.posRegisterCatalogRevision.get("revision-1"),
    ).toMatchObject({ revision: 7 });
    for (const lineageId of ["provisional-1", "provisional-2"]) {
      expect(
        fixture.tables.inventoryImportProvisionalSku.get(lineageId),
      ).toMatchObject({
        costOverlayUnitCost: undefined,
        costOverlayUndoneAt: expect.any(Number),
      });
    }
  });

  it("verifies closed lineage freshness without patching closed lineage provenance", async () => {
    const fixture = createWorkContext();
    fixture.tables.inventoryImportProvisionalSku.set("provisional-closed", {
      _id: "provisional-closed",
      storeId: "store-1",
      reviewVersionId: "review-1",
      productSkuId: "sku-1",
      status: "closed",
      updatedAt: 99,
    });
    fixture.row.frozenLineages = [
      ...fixture.row.frozenLineages,
      {
        provisionalSkuId: "provisional-closed",
        productSkuId: "sku-1",
        status: "closed",
        updatedAt: 99,
      },
    ].sort((left, right) =>
      String(left.provisionalSkuId).localeCompare(
        String(right.provisionalSkuId),
      ),
    );

    await applyCostOverlayRowWithCtx(
      fixture.ctx,
      fixture.run as never,
      fixture.row as never,
    );
    expect(
      fixture.tables.inventoryImportProvisionalSku.get("provisional-closed"),
    ).not.toHaveProperty("costOverlayRunId");

    await undoCostOverlayRowWithCtx(
      fixture.ctx,
      fixture.tables.inventoryImportCostOverlayRun.get("run-1") as never,
      fixture.tables.inventoryImportCostOverlayRow.get("row-1") as never,
    );
    expect(
      fixture.tables.inventoryImportCostOverlayRow.get("row-1"),
    ).toMatchObject({ workStatus: "undone" });
  });

  it("turns stale apply and undo rows into durable exceptions", async () => {
    const staleApply = createWorkContext();
    await staleApply.db.patch("productSku", "sku-1", { inventoryCount: 4 });
    await applyCostOverlayRowWithCtx(
      staleApply.ctx,
      staleApply.run as never,
      staleApply.row as never,
    );
    expect(
      mockedEffects.applySkuValuationCorrectionWithCtx,
    ).not.toHaveBeenCalled();
    expect(
      staleApply.tables.inventoryImportCostOverlayRow.get("row-1"),
    ).toMatchObject({
      applyExceptionReason: "stale_before_apply",
      workStatus: "apply_exception",
    });

    const staleUndo = createWorkContext();
    await applyCostOverlayRowWithCtx(
      staleUndo.ctx,
      staleUndo.run as never,
      staleUndo.row as never,
    );
    await staleUndo.db.patch("productSku", "sku-1", { unitCost: 500 });
    await undoCostOverlayRowWithCtx(
      staleUndo.ctx,
      staleUndo.tables.inventoryImportCostOverlayRun.get("run-1") as never,
      staleUndo.tables.inventoryImportCostOverlayRow.get("row-1") as never,
    );
    expect(
      staleUndo.tables.inventoryImportCostOverlayRow.get("row-1"),
    ).toMatchObject({
      undoExceptionReason: "stale_before_undo",
      workStatus: "undo_exception",
    });
  });

  it("durably rejects valuation positions whose quantities do not match inventory on apply and undo", async () => {
    const invalidApply = createWorkContext();
    await invalidApply.db.patch("reportingInventoryPosition", "position-1", {
      uncostedQuantity: 2,
    });
    invalidApply.row.preUncostedQuantity = 2;
    await applyCostOverlayRowWithCtx(
      invalidApply.ctx,
      invalidApply.run as never,
      invalidApply.row as never,
    );
    expect(
      mockedEffects.applySkuValuationCorrectionWithCtx,
    ).not.toHaveBeenCalled();
    expect(
      invalidApply.tables.inventoryImportCostOverlayRow.get("row-1"),
    ).toMatchObject({
      applyExceptionReason: "valuation_quantity_mismatch",
      workStatus: "apply_exception",
    });

    const invalidUndo = createWorkContext();
    await applyCostOverlayRowWithCtx(
      invalidUndo.ctx,
      invalidUndo.run as never,
      invalidUndo.row as never,
    );
    const appliedRow =
      invalidUndo.tables.inventoryImportCostOverlayRow.get("row-1")!;
    await invalidUndo.db.patch("reportingInventoryPosition", "position-1", {
      costedQuantity: 2,
    });
    appliedRow.postCostedQuantity = 2;
    mockedEffects.applySkuValuationBasisCompensationWithCtx.mockClear();
    await undoCostOverlayRowWithCtx(
      invalidUndo.ctx,
      invalidUndo.tables.inventoryImportCostOverlayRun.get("run-1") as never,
      appliedRow as never,
    );
    expect(
      mockedEffects.applySkuValuationBasisCompensationWithCtx,
    ).not.toHaveBeenCalled();
    expect(
      invalidUndo.tables.inventoryImportCostOverlayRow.get("row-1"),
    ).toMatchObject({
      undoExceptionReason: "valuation_quantity_mismatch",
      workStatus: "undo_exception",
    });
  });

  it("uses the review-scoped compound lineage index with bounded reads", async () => {
    const fixture = createWorkContext();

    await applyCostOverlayRowWithCtx(
      fixture.ctx,
      fixture.run as never,
      fixture.row as never,
    );

    expect(fixture.lineageQueryIndexes).toEqual(
      Array.from(
        { length: 4 },
        () => "by_storeId_reviewVersionId_productSkuId_status",
      ),
    );
    expect(fixture.lineagePaginateCount).toBe(0);
  });

  it("rejects apply when any nonrepresentative lineage changes or a new lineage appears", async () => {
    const changed = createWorkContext();
    await changed.db.patch("inventoryImportProvisionalSku", "provisional-2", {
      status: "closed",
      updatedAt: 110,
    });
    await applyCostOverlayRowWithCtx(
      changed.ctx,
      changed.run as never,
      changed.row as never,
    );
    expect(
      changed.tables.inventoryImportCostOverlayRow.get("row-1"),
    ).toMatchObject({
      applyExceptionReason: "stale_before_apply",
    });

    const inserted = createWorkContext();
    inserted.tables.inventoryImportProvisionalSku.set("provisional-new", {
      _id: "provisional-new",
      storeId: "store-1",
      reviewVersionId: "review-1",
      productSkuId: "sku-1",
      status: "rejected",
      updatedAt: 105,
    });
    await applyCostOverlayRowWithCtx(
      inserted.ctx,
      inserted.run as never,
      inserted.row as never,
    );
    expect(
      inserted.tables.inventoryImportCostOverlayRow.get("row-1"),
    ).toMatchObject({
      applyExceptionReason: "stale_before_apply",
    });
  });

  it("makes undo stale after any lineage update or finalization", async () => {
    const fixture = createWorkContext();
    await applyCostOverlayRowWithCtx(
      fixture.ctx,
      fixture.run as never,
      fixture.row as never,
    );
    await fixture.db.patch("inventoryImportProvisionalSku", "provisional-2", {
      finalizedAt: Date.now(),
      status: "finalized",
      updatedAt: Date.now() + 1,
    });
    await undoCostOverlayRowWithCtx(
      fixture.ctx,
      fixture.tables.inventoryImportCostOverlayRun.get("run-1") as never,
      fixture.tables.inventoryImportCostOverlayRow.get("row-1") as never,
    );
    expect(
      fixture.tables.inventoryImportCostOverlayRow.get("row-1"),
    ).toMatchObject({
      undoExceptionReason: "stale_before_undo",
    });
  });

  it("advances expected valuation domain failures but propagates unexpected errors", async () => {
    const expected = createWorkContext();
    mockedEffects.applySkuValuationCorrectionWithCtx.mockRejectedValueOnce(
      new Error("Known cost pool must remain a safe integer."),
    );
    await applyCostOverlayRowWithCtx(
      expected.ctx,
      expected.run as never,
      expected.row as never,
    );
    expect(
      expected.tables.inventoryImportCostOverlayRow.get("row-1"),
    ).toMatchObject({
      applyExceptionReason: "valuation_domain_error",
      workStatus: "apply_exception",
    });
    expect(
      expected.tables.inventoryImportCostOverlayRun.get("run-1"),
    ).toMatchObject({ applyCursor: 1, applyExceptionCount: 1 });

    const unexpected = createWorkContext();
    mockedEffects.applySkuValuationCorrectionWithCtx.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(
      applyCostOverlayRowWithCtx(
        unexpected.ctx,
        unexpected.run as never,
        unexpected.row as never,
      ),
    ).rejects.toThrow("database unavailable");
  });

  it("compares the complete frozen lineage set, including lifecycle freshness", () => {
    const frozen = [
      {
        provisionalSkuId: "p-1" as never,
        productSkuId: "sku-1" as never,
        status: "active" as const,
        updatedAt: 1,
      },
      {
        provisionalSkuId: "p-2" as never,
        productSkuId: "sku-1" as never,
        status: "closed" as const,
        updatedAt: 2,
      },
    ];
    expect(frozenCostOverlayLineagesMatch(frozen, frozen)).toBe(true);
    expect(
      frozenCostOverlayLineagesMatch(frozen, [
        frozen[0],
        { ...frozen[1], status: "finalized", updatedAt: 3 },
      ]),
    ).toBe(false);
  });
});
