import { describe, expect, it, vi } from "vitest";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  discardCycleCountDraftCommandWithCtx,
  ensureCycleCountDraftCommandWithCtx,
  saveCycleCountDraftLineCommandWithCtx,
  submitCycleCountDraftCommandWithCtx,
} from "./cycleCountDrafts";

const mockedAuthServer = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: mockedAuthServer.getAuthUserId,
}));

function createCycleCountDraftCtx() {
  const tables = {
    approvalRequest: new Map<string, Record<string, any>>(),
    athenaUser: new Map<string, Record<string, any>>([
      ["operator-1", { _id: "operator-1", email: "operator@example.com" }],
    ]),
    cycleCountDraft: new Map<string, Record<string, any>>(),
    cycleCountDraftLine: new Map<string, Record<string, any>>(),
    inventoryMovement: new Map<string, Record<string, any>>(),
    operationalEvent: new Map<string, Record<string, any>>(),
    operationalWorkItem: new Map<string, Record<string, any>>(),
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
          };
        }

        if (table === "organizationMember") {
          return {
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
                first: async () =>
                  Array.from(tables.organizationMember.values()).find((record) =>
                    filters.every(([field, value]) => record[field] === value),
                  ) ?? null,
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
    expect(tables.cycleCountDraft.get(String(ensured.data.draft._id))).toMatchObject({
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
    expect(tables.cycleCountDraft.get(String(ensured.data.draft._id))).toMatchObject({
      status: "submitted",
    });
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
