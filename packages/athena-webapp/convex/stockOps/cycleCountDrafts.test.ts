import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  discardCycleCountDraft,
  discardCycleCountDraftCommandWithCtx,
  ensureCycleCountDraft,
  ensureCycleCountDraftCommandWithCtx,
  getActiveCycleCountDraft,
  getActiveCycleCountDraftSummary,
  getActiveCycleCountDraftSummaryWithCtx,
  refreshCycleCountDraftLineBaseline,
  refreshCycleCountDraftLineBaselineCommandWithCtx,
  saveCycleCountDraftLine,
  saveCycleCountDraftLineCommandWithCtx,
  submitActiveCycleCountDrafts,
  submitCycleCountDraft,
  submitCycleCountDraftCommandWithCtx,
  submitActiveCycleCountDraftsCommandWithCtx,
} from "./cycleCountDrafts";

const mockedAuthServer = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));
const reportingMocks = vi.hoisted(() => ({
  applyInventoryEffectWithCtx: vi.fn(),
  resolveReportingOperatingPeriodWithCtx: vi.fn(),
}));
const sharedDemoMocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
  requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: mockedAuthServer.getAuthUserId,
}));
vi.mock("../reporting/inventory/effects", () => ({
  applyInventoryEffectWithCtx: reportingMocks.applyInventoryEffectWithCtx,
}));
vi.mock("../reporting/operatingPeriods", () => ({
  resolveReportingOperatingPeriodWithCtx:
    reportingMocks.resolveReportingOperatingPeriodWithCtx,
}));
vi.mock("../sharedDemo/actor", () => sharedDemoMocks);

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

beforeEach(() => {
  mockedAuthServer.getAuthUserId.mockReset();
  reportingMocks.applyInventoryEffectWithCtx.mockReset();
  reportingMocks.resolveReportingOperatingPeriodWithCtx.mockReset();
  sharedDemoMocks.getSharedDemoActorWithCtx.mockReset();
  sharedDemoMocks.requireSharedDemoStoreCapabilityIfApplicable.mockReset();
});

describe("cycle count public return validators", () => {
  it("accepts the operation-admitted shared command error contract", () => {
    const result = {
      error: { code: "validation_failed", message: "Count is invalid." },
      kind: "user_error" as const,
    };
    assertConformsToExportedReturns(ensureCycleCountDraft, result);
    assertConformsToExportedReturns(saveCycleCountDraftLine, result);
    assertConformsToExportedReturns(discardCycleCountDraft, result);
    assertConformsToExportedReturns(refreshCycleCountDraftLineBaseline, result);
    assertConformsToExportedReturns(submitCycleCountDraft, result);
    assertConformsToExportedReturns(submitActiveCycleCountDrafts, result);
  });
});

function createCycleCountDraftCtx() {
  reportingMocks.resolveReportingOperatingPeriodWithCtx.mockResolvedValue({
    kind: "missing_schedule",
  });
  reportingMocks.applyInventoryEffectWithCtx.mockImplementation(
    async (ctx: MutationCtx, args: Record<string, any>) => {
      await ctx.db.patch("productSku", args.productSkuId, {
        inventoryCount: args.compatibilityBalance.onHandQuantity,
        quantityAvailable: args.compatibilityBalance.sellableQuantity,
      });
      const movementId = await ctx.db.insert("inventoryMovement", {
        actorUserId: args.actorUserId,
        createdAt: args.recordedAt,
        movementType: args.movementType,
        organizationId: args.organizationId,
        productId: args.productId,
        productSkuId: args.productSkuId,
        quantityDelta: args.physicalQuantityDelta,
        reasonCode: args.reasonCode,
        sourceId: args.sourceId,
        sourceType: args.sourceType,
        storeId: args.storeId,
      });
      return {
        movement: await ctx.db.get("inventoryMovement", movementId),
      };
    },
  );
  const tables = {
    approvalRequest: new Map<string, Record<string, any>>(),
    athenaUser: new Map<string, Record<string, any>>([
      [
        "operator-1",
        {
          _id: "operator-1",
          email: "operator@example.com",
          normalizedEmail: "operator@example.com",
        },
      ],
    ]),
    cycleCountDraft: new Map<string, Record<string, any>>(),
    cycleCountDraftLine: new Map<string, Record<string, any>>(),
    inventoryMovement: new Map<string, Record<string, any>>(),
    inventoryImportProvisionalSku: new Map<string, Record<string, any>>(),
    operationalEvent: new Map<string, Record<string, any>>(),
    operationalWorkItem: new Map<string, Record<string, any>>(),
    posPendingCheckoutItem: new Map<string, Record<string, any>>(),
    organizationMember: new Map<string, Record<string, any>>([
      [
        "membership-1",
        {
          _id: "membership-1",
          organizationId: "org-1",
          role: "pos_only",
          userId: "operator-1",
        },
      ],
    ]),
    productSku: new Map<string, Record<string, any>>([
      [
        "sku-1",
        {
          _id: "sku-1",
          inventoryCount: 8,
          productId: "product-1",
          productName: "Closure wig",
          quantityAvailable: 6,
          sku: "CW-18",
          storeId: "store-1",
        },
      ],
    ]),
    skuActivityEvent: new Map<string, Record<string, any>>(),
    stockAdjustmentBatch: new Map<string, Record<string, any>>(),
    store: new Map<string, Record<string, any>>([
      ["store-1", { _id: "store-1", organizationId: "org-1" }],
    ]),
    users: new Map<string, Record<string, any>>([
      ["auth-user-1", { _id: "auth-user-1", email: "operator@example.com" }],
    ]),
  };
  const insertCounters = new Map<keyof typeof tables, number>();

  mockedAuthServer.getAuthUserId.mockResolvedValue("auth-user-1");

  function indexedQuery(table: keyof typeof tables) {
    return {
      withIndex(
        _index: string,
        applyIndex: (query: {
          eq: (field: string, value: unknown) => unknown;
        }) => unknown,
      ) {
        const filters: Array<[string, unknown]> = [];
        const query = {
          eq(field: string, value: unknown) {
            filters.push([field, value]);
            return query;
          },
        };

        applyIndex(query);

        const matches = () =>
          Array.from(tables[table].values()).filter((record) =>
            filters.every(([field, value]) => record[field] === value),
          );

        return {
          collect: async () => matches(),
          first: async () => matches()[0] ?? null,
          take: async (limit: number) => matches().slice(0, limit),
        };
      },
    };
  }

  const ctx = {
    auth: {},
    db: {
      async get(tableOrId: keyof typeof tables | string, id?: string) {
        if (id === undefined) {
          return tables.users.get(tableOrId as string) ?? null;
        }

        return tables[tableOrId as keyof typeof tables].get(id) ?? null;
      },
      async insert(table: keyof typeof tables, value: Record<string, unknown>) {
        const nextCount = (insertCounters.get(table) ?? 0) + 1;
        insertCounters.set(table, nextCount);
        const id = `${table}-${nextCount}`;
        tables[table].set(id, { _id: id, ...value });
        return id;
      },
      async patch(
        table: keyof typeof tables,
        id: string,
        value: Record<string, unknown>,
      ) {
        const existingRecord = tables[table].get(id);

        if (!existingRecord) {
          throw new Error(`Missing ${table} record: ${id}`);
        }

        tables[table].set(id, { ...existingRecord, ...value });
      },
      query(table: keyof typeof tables) {
        if (table === "athenaUser") {
          return {
            collect: async () => Array.from(tables.athenaUser.values()),
            withIndex(
              _index: string,
              applyIndex: (queryBuilder: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown,
            ) {
              const filters: Array<[string, unknown]> = [];
              const queryBuilder = {
                eq(field: string, value: unknown) {
                  filters.push([field, value]);
                  return queryBuilder;
                },
              };
              applyIndex(queryBuilder);
              return {
                first: async () =>
                  Array.from(tables.athenaUser.values()).find((record) =>
                    filters.every(([field, value]) => record[field] === value),
                  ) ?? null,
                take: async (limit: number) =>
                  Array.from(tables.athenaUser.values())
                    .filter((record) =>
                      filters.every(
                        ([field, value]) => record[field] === value,
                      ),
                    )
                    .slice(0, limit),
              };
            },
          };
        }

        if (table === "organizationMember") {
          const findMember = (filters: Array<[string, unknown]>) =>
            Array.from(tables.organizationMember.values()).find((record) =>
              filters.every(([field, value]) => record[field] === value),
            ) ?? null;

          return {
            withIndex(
              _index: string,
              applyIndex: (queryBuilder: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown,
            ) {
              const filters: Array<[string, unknown]> = [];
              const queryBuilder = {
                eq(field: string, value: unknown) {
                  filters.push([field, value]);
                  return queryBuilder;
                },
              };

              applyIndex(queryBuilder);

              return {
                first: async () => findMember(filters),
              };
            },
            filter(
              applyFilter: (queryBuilder: {
                and: (...conditions: unknown[]) => unknown;
                eq: (left: unknown, right: unknown) => unknown;
                field: (name: string) => string;
              }) => unknown,
            ) {
              const filters: Array<[string, unknown]> = [];
              const queryBuilder = {
                and: (...conditions: unknown[]) => conditions,
                eq(left: unknown, right: unknown) {
                  filters.push([left as string, right]);
                  return { left, right };
                },
                field(name: string) {
                  return name;
                },
              };

              applyFilter(queryBuilder);

              return {
                first: async () => findMember(filters),
              };
            },
          };
        }

        return indexedQuery(table);
      },
    },
  } as unknown as MutationCtx;

  return { ctx, tables };
}

describe("cycle count drafts", () => {
  it("reuses one open draft for a store, scope, and operator", async () => {
    const { ctx, tables } = createCycleCountDraftCtx();

    const first = await ensureCycleCountDraftCommandWithCtx(ctx, {
      scopeKey: "Hair",
      storeId: "store-1" as Id<"store">,
    });
    const second = await ensureCycleCountDraftCommandWithCtx(ctx, {
      scopeKey: "Hair",
      storeId: "store-1" as Id<"store">,
    });

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    expect(Array.from(tables.cycleCountDraft.values())).toHaveLength(1);
    expect(tables.operationalEvent.size).toBe(1);
  });

  it("saves line baselines and blocks stale draft submission", async () => {
    const { ctx, tables } = createCycleCountDraftCtx();
    const ensured = await ensureCycleCountDraftCommandWithCtx(ctx, {
      scopeKey: "Hair",
      storeId: "store-1" as Id<"store">,
    });

    expect(ensured.kind).toBe("ok");
    if (ensured.kind !== "ok") return;

    await saveCycleCountDraftLineCommandWithCtx(ctx, {
      countedQuantity: 5,
      draftId: ensured.data.draft._id,
      productSkuId: "sku-1" as Id<"productSku">,
    });
    await ctx.db.patch("productSku", "sku-1" as Id<"productSku">, {
      inventoryCount: 9,
      quantityAvailable: 7,
    });

    const submitted = await submitCycleCountDraftCommandWithCtx(ctx, {
      draftId: ensured.data.draft._id,
    });

    expect(submitted).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
      },
    });
    expect(tables.stockAdjustmentBatch.size).toBe(0);
    expect(Array.from(tables.cycleCountDraftLine.values())[0]).toMatchObject({
      baselineInventoryCount: 8,
      countedQuantity: 5,
      staleStatus: "stale",
    });
  });

  it("refreshes a stale draft line baseline to the current stock count", async () => {
    const { ctx, tables } = createCycleCountDraftCtx();
    const ensured = await ensureCycleCountDraftCommandWithCtx(ctx, {
      scopeKey: "Hair",
      storeId: "store-1" as Id<"store">,
    });

    expect(ensured.kind).toBe("ok");
    if (ensured.kind !== "ok") return;

    await saveCycleCountDraftLineCommandWithCtx(ctx, {
      countedQuantity: 5,
      draftId: ensured.data.draft._id,
      productSkuId: "sku-1" as Id<"productSku">,
    });
    await ctx.db.patch("productSku", "sku-1" as Id<"productSku">, {
      inventoryCount: 9,
      quantityAvailable: 7,
    });

    const refreshed = await refreshCycleCountDraftLineBaselineCommandWithCtx(
      ctx,
      {
        productSkuId: "sku-1" as Id<"productSku">,
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(refreshed.kind).toBe("ok");
    expect(Array.from(tables.cycleCountDraftLine.values())[0]).toMatchObject({
      baselineAvailableCount: 7,
      baselineInventoryCount: 9,
      countedQuantity: 9,
      isDirty: false,
      staleStatus: "current",
    });
    expect(
      tables.cycleCountDraft.get(String(ensured.data.draft._id)),
    ).toMatchObject({
      changedLineCount: 0,
      staleLineCount: 0,
    });
  });

  it("summarizes changed open drafts across scopes for the operator", async () => {
    const { ctx } = createCycleCountDraftCtx();
    const hairDraft = await ensureCycleCountDraftCommandWithCtx(ctx, {
      scopeKey: "Hair",
      storeId: "store-1" as Id<"store">,
    });
    const beveragesDraft = await ensureCycleCountDraftCommandWithCtx(ctx, {
      scopeKey: "Beverages",
      storeId: "store-1" as Id<"store">,
    });

    expect(hairDraft.kind).toBe("ok");
    expect(beveragesDraft.kind).toBe("ok");
    if (hairDraft.kind !== "ok" || beveragesDraft.kind !== "ok") return;

    await saveCycleCountDraftLineCommandWithCtx(ctx, {
      countedQuantity: 5,
      draftId: hairDraft.data.draft._id,
      productSkuId: "sku-1" as Id<"productSku">,
    });
    await saveCycleCountDraftLineCommandWithCtx(ctx, {
      countedQuantity: 6,
      draftId: beveragesDraft.data.draft._id,
      productSkuId: "sku-1" as Id<"productSku">,
    });

    const summary = await getActiveCycleCountDraftSummaryWithCtx(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(summary).toMatchObject({
      changedLineCount: 2,
      draftCount: 2,
      largestAbsoluteDelta: 3,
      netQuantityDelta: -5,
      scopeKeys: ["Beverages", "Hair"],
      scopeCount: 2,
      staleLineCount: 0,
    });
    expect(summary.lastSavedAt).toEqual(expect.any(Number));
  });

  it("clamps cycle-count summaries to the shared demo store", async () => {
    const { ctx } = createCycleCountDraftCtx();
    const denial = new Error("This action is unavailable in the demo.");
    sharedDemoMocks.requireSharedDemoStoreCapabilityIfApplicable.mockRejectedValueOnce(
      denial,
    );

    await expect(
      getActiveCycleCountDraftSummaryWithCtx(ctx, {
        storeId: "other-store" as Id<"store">,
      }),
    ).rejects.toThrow(denial.message);
    expect(
      sharedDemoMocks.requireSharedDemoStoreCapabilityIfApplicable,
    ).toHaveBeenCalledWith(ctx, "inventory.adjust", "other-store");
  });

  it("loads active cycle-count summaries through the demo read boundary", async () => {
    const { ctx } = createCycleCountDraftCtx();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: "operator-1",
      authUserId: "auth-user-1",
      kind: "shared_demo",
      organizationId: "org-1",
      storeId: "store-1",
    });

    await expect(
      getHandler(getActiveCycleCountDraftSummary)(ctx as never, {
        storeId: "store-1",
      }),
    ).resolves.toMatchObject({
      changedLineCount: 0,
      draftCount: 0,
    });

    expect(sharedDemoMocks.getSharedDemoActorWithCtx).toHaveBeenCalledWith(ctx);
    expect(
      sharedDemoMocks.requireSharedDemoStoreCapabilityIfApplicable,
    ).not.toHaveBeenCalled();
    expect(mockedAuthServer.getAuthUserId).not.toHaveBeenCalled();
  });

  it("denies active cycle-count reads outside the admitted demo store", async () => {
    const { ctx } = createCycleCountDraftCtx();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: "operator-1",
      authUserId: "auth-user-1",
      kind: "shared_demo",
      organizationId: "org-1",
      storeId: "store-1",
    });

    await expect(
      getHandler(getActiveCycleCountDraft)(ctx as never, {
        scopeKey: "Hair",
        storeId: "other-store",
      }),
    ).rejects.toThrow("shared_demo_action_denied");

    expect(
      sharedDemoMocks.requireSharedDemoStoreCapabilityIfApplicable,
    ).not.toHaveBeenCalled();
    expect(mockedAuthServer.getAuthUserId).not.toHaveBeenCalled();
  });

  it("submits changed drafts across scopes for the active store", async () => {
    const { ctx, tables } = createCycleCountDraftCtx();
    tables.productSku.set("sku-2", {
      _id: "sku-2",
      inventoryCount: 12,
      productId: "product-2",
      productName: "Body wave bundle",
      quantityAvailable: 12,
      sku: "BW-24",
      storeId: "store-1",
    });
    const hairDraft = await ensureCycleCountDraftCommandWithCtx(ctx, {
      scopeKey: "Hair",
      storeId: "store-1" as Id<"store">,
    });
    const beveragesDraft = await ensureCycleCountDraftCommandWithCtx(ctx, {
      scopeKey: "Beverages",
      storeId: "store-1" as Id<"store">,
    });

    expect(hairDraft.kind).toBe("ok");
    expect(beveragesDraft.kind).toBe("ok");
    if (hairDraft.kind !== "ok" || beveragesDraft.kind !== "ok") return;

    await saveCycleCountDraftLineCommandWithCtx(ctx, {
      countedQuantity: 5,
      draftId: hairDraft.data.draft._id,
      productSkuId: "sku-1" as Id<"productSku">,
    });
    await saveCycleCountDraftLineCommandWithCtx(ctx, {
      countedQuantity: 10,
      draftId: beveragesDraft.data.draft._id,
      productSkuId: "sku-2" as Id<"productSku">,
    });

    const submitted = await submitActiveCycleCountDraftsCommandWithCtx(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(submitted.kind).toBe("ok");
    expect(Array.from(tables.stockAdjustmentBatch.values())[0]).toMatchObject({
      adjustmentType: "cycle_count",
      lineItemCount: 2,
      status: "applied",
    });
    expect(
      tables.cycleCountDraft.get(String(hairDraft.data.draft._id)),
    ).toMatchObject({
      status: "submitted",
    });
    expect(
      tables.cycleCountDraft.get(String(beveragesDraft.data.draft._id)),
    ).toMatchObject({
      status: "submitted",
    });
  });

  it("rejects cross-store draft line saves", async () => {
    const { ctx, tables } = createCycleCountDraftCtx();
    tables.productSku.set("sku-other-store", {
      _id: "sku-other-store",
      inventoryCount: 4,
      productId: "product-2",
      quantityAvailable: 4,
      storeId: "store-2",
    });
    const ensured = await ensureCycleCountDraftCommandWithCtx(ctx, {
      scopeKey: "Hair",
      storeId: "store-1" as Id<"store">,
    });

    expect(ensured.kind).toBe("ok");
    if (ensured.kind !== "ok") return;

    const saved = await saveCycleCountDraftLineCommandWithCtx(ctx, {
      countedQuantity: 2,
      draftId: ensured.data.draft._id,
      productSkuId: "sku-other-store" as Id<"productSku">,
    });

    expect(saved).toMatchObject({
      kind: "user_error",
      error: { code: "not_found" },
    });
    expect(tables.cycleCountDraftLine.size).toBe(0);
  });

  it("discards drafts without touching inventory", async () => {
    const { ctx, tables } = createCycleCountDraftCtx();
    const ensured = await ensureCycleCountDraftCommandWithCtx(ctx, {
      scopeKey: "Hair",
      storeId: "store-1" as Id<"store">,
    });

    expect(ensured.kind).toBe("ok");
    if (ensured.kind !== "ok") return;

    await saveCycleCountDraftLineCommandWithCtx(ctx, {
      countedQuantity: 5,
      draftId: ensured.data.draft._id,
      productSkuId: "sku-1" as Id<"productSku">,
    });

    const discarded = await discardCycleCountDraftCommandWithCtx(ctx, {
      draftId: ensured.data.draft._id,
    });

    expect(discarded.kind).toBe("ok");
    expect(
      tables.cycleCountDraft.get(String(ensured.data.draft._id)),
    ).toMatchObject({
      status: "discarded",
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({ inventoryCount: 8 });
    expect(tables.stockAdjustmentBatch.size).toBe(0);
    expect(tables.inventoryMovement.size).toBe(0);
    expect(Array.from(tables.operationalEvent.values())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "cycle_count_draft_discarded" }),
      ]),
    );
  });

  it("submits current changed lines through stock adjustment batches", async () => {
    const { ctx, tables } = createCycleCountDraftCtx();
    const ensured = await ensureCycleCountDraftCommandWithCtx(ctx, {
      scopeKey: "Hair",
      storeId: "store-1" as Id<"store">,
    });

    expect(ensured.kind).toBe("ok");
    if (ensured.kind !== "ok") return;

    await saveCycleCountDraftLineCommandWithCtx(ctx, {
      countedQuantity: 5,
      draftId: ensured.data.draft._id,
      productSkuId: "sku-1" as Id<"productSku">,
    });

    const submitted = await submitCycleCountDraftCommandWithCtx(ctx, {
      draftId: ensured.data.draft._id,
    });

    expect(submitted.kind).toBe("ok");
    expect(Array.from(tables.stockAdjustmentBatch.values())[0]).toMatchObject({
      adjustmentType: "cycle_count",
      lineItemCount: 1,
      status: "applied",
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 5,
    });
    expect(reportingMocks.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        activityType: "stock_cycle_count",
        businessEventKey:
          "stock_adjustment_batch:stockAdjustmentBatch-1:sku:sku-1",
        movementType: "cycle_count",
        valuation: {
          disposition: "stock_correction",
          kind: "outbound",
          quantity: 3,
        },
      }),
    );
    expect(
      tables.cycleCountDraft.get(String(ensured.data.draft._id)),
    ).toMatchObject({
      status: "submitted",
    });
    expect(Array.from(tables.operationalEvent.values())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "cycle_count_draft_created",
          message: "operator@example.com started a cycle count for Hair.",
          metadata: expect.objectContaining({
            actorLabel: "operator@example.com",
            scopeKey: "Hair",
          }),
        }),
        expect.objectContaining({
          eventType: "cycle_count_draft_updated",
          message:
            "operator@example.com counted Closure wig (CW-18) as 5. Draft has 1 changed SKU.",
          metadata: expect.objectContaining({
            actorLabel: "operator@example.com",
            changedLineCount: 1,
            countedQuantity: 5,
            productSkuLabel: "Closure wig (CW-18)",
          }),
        }),
        expect.objectContaining({
          eventType: "cycle_count_draft_submitted",
          message:
            "operator@example.com submitted the Hair cycle count with 1 changed SKU.",
          metadata: expect.objectContaining({
            actorLabel: "operator@example.com",
            lineItemCount: 1,
            scopeKey: "Hair",
          }),
        }),
      ]),
    );
  });

  it("keeps submitted draft retries authorized and idempotent", async () => {
    const { ctx, tables } = createCycleCountDraftCtx();
    const ensured = await ensureCycleCountDraftCommandWithCtx(ctx, {
      scopeKey: "Hair",
      storeId: "store-1" as Id<"store">,
    });

    expect(ensured.kind).toBe("ok");
    if (ensured.kind !== "ok") return;

    await saveCycleCountDraftLineCommandWithCtx(ctx, {
      countedQuantity: 5,
      draftId: ensured.data.draft._id,
      productSkuId: "sku-1" as Id<"productSku">,
    });

    const firstSubmit = await submitCycleCountDraftCommandWithCtx(ctx, {
      draftId: ensured.data.draft._id,
    });
    const secondSubmit = await submitCycleCountDraftCommandWithCtx(ctx, {
      draftId: ensured.data.draft._id,
    });

    expect(firstSubmit.kind).toBe("ok");
    expect(secondSubmit.kind).toBe("ok");
    expect(tables.stockAdjustmentBatch.size).toBe(1);
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 5,
    });

    mockedAuthServer.getAuthUserId.mockResolvedValue(null);

    await expect(
      submitCycleCountDraftCommandWithCtx(ctx, {
        draftId: ensured.data.draft._id,
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: { code: "authentication_failed" },
    });
  });
});
