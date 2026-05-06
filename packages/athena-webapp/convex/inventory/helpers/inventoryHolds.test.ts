import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import {
  acquireInventoryHold,
  adjustInventoryHold,
  consumeInventoryHoldsForSession,
  releaseActiveInventoryHoldsForSession,
  releaseInventoryHold,
  releaseInventoryHoldsBatch,
  releaseLegacyExpenseQuantityPatchHolds,
} from "./inventoryHolds";

type HoldStatus = "active" | "released" | "consumed" | "expired";

type HoldRecord = {
  _id: string;
  storeId: string;
  productSkuId: string;
  sourceType: "posSession";
  sourceSessionId: string;
  status: HoldStatus;
  quantity: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  releasedAt?: number;
  consumedAt?: number;
  expiredAt?: number;
};

type SkuRecord = {
  _id: string;
  storeId: string;
  sku: string;
  quantityAvailable: number;
  inventoryCount: number;
};

function createDb(seed: { sku: SkuRecord; holds?: HoldRecord[] }) {
  const holds = [...(seed.holds ?? [])];
  const insertedHolds: HoldRecord[] = [];
  const productSkuPatches: Array<Record<string, unknown>> = [];

  const db = {
    get: vi.fn(async (tableNameOrId: string, maybeId?: string) => {
      const tableName = maybeId ? tableNameOrId : "productSku";
      const id = maybeId ?? tableNameOrId;
      if (tableName === "productSku" && id === seed.sku._id) {
        return seed.sku;
      }
      return null;
    }),
    insert: vi.fn(
      async (_tableName: string, input: Omit<HoldRecord, "_id">) => {
        const hold = {
          _id: `hold-${holds.length + 1}`,
          ...input,
        };
        holds.push(hold);
        insertedHolds.push(hold);
        return hold._id;
      },
    ),
    patch: vi.fn(
      async (
        tableNameOrId: string,
        idOrPatch: string | Record<string, unknown>,
        maybePatch?: Record<string, unknown>,
      ) => {
        const tableName = maybePatch ? tableNameOrId : "productSku";
        const id = maybePatch ? String(idOrPatch) : tableNameOrId;
        const patch = maybePatch ?? (idOrPatch as Record<string, unknown>);

        if (tableName === "productSku") {
          productSkuPatches.push(patch);
          Object.assign(seed.sku, patch);
          return;
        }

        const hold = holds.find((entry) => entry._id === id);
        if (hold) {
          Object.assign(hold, patch);
        }
      },
    ),
    query: vi.fn((tableName: string) => ({
      withIndex(
        _indexName: string,
        apply: (builder: {
          eq(field: string, value: unknown): unknown;
          gt(field: string, value: unknown): unknown;
        }) => void,
      ) {
        const filters: Record<string, unknown> = {};
        const builder = {
          eq(field: string, value: unknown) {
            filters[field] = value;
            return builder;
          },
          gt(field: string, value: unknown) {
            filters[`${field}:gt`] = value;
            return builder;
          },
        };
        apply(builder);

        const page =
          tableName === "inventoryHold"
            ? holds.filter((hold) => {
                if (filters.storeId && hold.storeId !== filters.storeId) {
                  return false;
                }
                if (
                  filters.productSkuId &&
                  hold.productSkuId !== filters.productSkuId
                ) {
                  return false;
                }
                if (
                  filters.sourceSessionId &&
                  hold.sourceSessionId !== filters.sourceSessionId
                ) {
                  return false;
                }
                if (filters.status && hold.status !== filters.status) {
                  return false;
                }
                if (
                  filters["expiresAt:gt"] &&
                  hold.expiresAt <= Number(filters["expiresAt:gt"])
                ) {
                  return false;
                }
                return true;
              })
            : [];

        return {
          collect: async () => page,
          first: async () => page[0] ?? null,
          take: async (limit: number) => page.slice(0, limit),
        };
      },
    })),
  };

  return { db, holds, insertedHolds, productSkuPatches };
}

describe("POS inventory hold ledger", () => {
  it("acquires a hold row without patching productSku availability", async () => {
    const { db, insertedHolds, productSkuPatches } = createDb({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        sku: "SKU-1",
        quantityAvailable: 10,
        inventoryCount: 10,
      },
    });

    const result = await acquireInventoryHold(db as never, {
      storeId: "store-1" as Id<"store">,
      sessionId: "session-1" as Id<"posSession">,
      skuId: "sku-1" as Id<"productSku">,
      quantity: 4,
      expiresAt: 10_000,
      now: 1_000,
    });

    expect(result).toMatchObject({ success: true });
    expect(insertedHolds).toEqual([
      expect.objectContaining({
        productSkuId: "sku-1",
        sourceSessionId: "session-1",
        status: "active",
        quantity: 4,
        expiresAt: 10_000,
      }),
    ]);
    expect(productSkuPatches).toEqual([]);
  });

  it("adjusts same-session quantity without double-counting the existing hold", async () => {
    const { db, holds, productSkuPatches } = createDb({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        sku: "SKU-1",
        quantityAvailable: 6,
        inventoryCount: 6,
      },
      holds: [
        buildHold({
          _id: "hold-own",
          sourceSessionId: "session-1",
          quantity: 2,
        }),
        buildHold({
          _id: "hold-other",
          sourceSessionId: "session-2",
          quantity: 1,
        }),
      ],
    });

    const result = await adjustInventoryHold(db as never, {
      storeId: "store-1" as Id<"store">,
      sessionId: "session-1" as Id<"posSession">,
      skuId: "sku-1" as Id<"productSku">,
      oldQuantity: 2,
      newQuantity: 5,
      expiresAt: 10_000,
      now: 1_000,
    });

    expect(result).toMatchObject({ success: true });
    expect(holds.find((hold) => hold._id === "hold-own")).toEqual(
      expect.objectContaining({
        status: "active",
        quantity: 5,
        updatedAt: 1_000,
      }),
    );
    expect(productSkuPatches).toEqual([]);
  });

  it("releases active hold rows without restoring productSku availability", async () => {
    const { db, holds, productSkuPatches } = createDb({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        sku: "SKU-1",
        quantityAvailable: 10,
        inventoryCount: 10,
      },
      holds: [
        buildHold({
          _id: "hold-own",
          sourceSessionId: "session-1",
          quantity: 2,
        }),
      ],
    });

    const result = await releaseInventoryHold(db as never, {
      sessionId: "session-1" as Id<"posSession">,
      skuId: "sku-1" as Id<"productSku">,
      now: 1_000,
    });

    expect(result).toMatchObject({ success: true });
    expect(holds[0]).toEqual(
      expect.objectContaining({
        status: "released",
        releasedAt: 1_000,
      }),
    );
    expect(productSkuPatches).toEqual([]);
  });

  it("reduces only the requested quantity when releasing a partial hold", async () => {
    const { db, holds, productSkuPatches } = createDb({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        sku: "SKU-1",
        quantityAvailable: 10,
        inventoryCount: 10,
      },
      holds: [
        buildHold({
          _id: "hold-own",
          sourceSessionId: "session-1",
          quantity: 5,
        }),
      ],
    });

    const result = await releaseInventoryHold(db as never, {
      sessionId: "session-1" as Id<"posSession">,
      skuId: "sku-1" as Id<"productSku">,
      quantity: 2,
      now: 1_000,
    });

    expect(result).toMatchObject({ success: true });
    expect(holds[0]).toEqual(
      expect.objectContaining({
        status: "active",
        quantity: 3,
        updatedAt: 1_000,
      }),
    );
    expect(productSkuPatches).toEqual([]);
  });

  it("does not restore SKU availability when no ledger hold exists", async () => {
    const { db, productSkuPatches } = createDb({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        sku: "SKU-1",
        quantityAvailable: 10,
        inventoryCount: 10,
      },
    });

    const result = await releaseInventoryHold(db as never, {
      sessionId: "session-legacy" as Id<"posSession">,
      skuId: "sku-1" as Id<"productSku">,
      quantity: 2,
      now: 1_000,
    });

    expect(result).toMatchObject({ success: true });
    expect(productSkuPatches).toEqual([]);
  });

  it("expires matching ledger holds without restoring SKU availability", async () => {
    const { db, holds, productSkuPatches } = createDb({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        sku: "SKU-1",
        quantityAvailable: 10,
        inventoryCount: 10,
      },
      holds: [
        buildHold({
          _id: "hold-expired",
          sourceSessionId: "session-1",
          quantity: 2,
          expiresAt: 500,
        }),
      ],
    });

    const result = await releaseInventoryHold(db as never, {
      sessionId: "session-1" as Id<"posSession">,
      skuId: "sku-1" as Id<"productSku">,
      quantity: 2,
      now: 1_000,
    });

    expect(result).toMatchObject({ success: true });
    expect(holds[0]).toEqual(
      expect.objectContaining({
        status: "expired",
        expiredAt: 1_000,
      }),
    );
    expect(productSkuPatches).toEqual([]);
  });

  it("releases expired POS-session batch holds without restoring SKU availability", async () => {
    const { db, holds, productSkuPatches } = createDb({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        sku: "SKU-1",
        quantityAvailable: 10,
        inventoryCount: 10,
      },
      holds: [
        buildHold({
          _id: "hold-expired",
          sourceSessionId: "session-expired",
          quantity: 4,
          expiresAt: 500,
        }),
      ],
    });

    await releaseInventoryHoldsBatch(db as never, {
      sessionId: "session-expired" as Id<"posSession">,
      items: [{ skuId: "sku-1" as Id<"productSku">, quantity: 4 }],
      now: 1_000,
    });

    expect(holds[0]).toEqual(
      expect.objectContaining({
        status: "expired",
        expiredAt: 1_000,
      }),
    );
    expect(productSkuPatches).toEqual([]);
  });

  it("restores explicit legacy expense quantity-patch holds", async () => {
    const { db, productSkuPatches } = createDb({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        sku: "SKU-1",
        quantityAvailable: 6,
        inventoryCount: 10,
      },
    });

    await releaseLegacyExpenseQuantityPatchHolds(db as never, [
      { skuId: "sku-1" as Id<"productSku">, quantity: 2 },
    ]);

    expect(productSkuPatches).toEqual([{ quantityAvailable: 8 }]);
  });

  it("consumes matching completion holds and releases leftover session holds", async () => {
    const { db, holds } = createDb({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        sku: "SKU-1",
        quantityAvailable: 10,
        inventoryCount: 10,
      },
      holds: [
        buildHold({
          _id: "hold-sale",
          sourceSessionId: "session-1",
          productSkuId: "sku-1",
          quantity: 2,
        }),
        buildHold({
          _id: "hold-leftover",
          sourceSessionId: "session-1",
          productSkuId: "sku-2",
          quantity: 1,
        }),
      ],
    });

    const consumed = await consumeInventoryHoldsForSession(db as never, {
      sessionId: "session-1" as Id<"posSession">,
      items: [{ skuId: "sku-1" as Id<"productSku">, quantity: 2 }],
      now: 1_000,
    });

    expect(consumed.get("sku-1" as Id<"productSku">)).toBe(2);
    expect(holds).toEqual([
      expect.objectContaining({
        _id: "hold-sale",
        status: "consumed",
        consumedAt: 1_000,
      }),
      expect.objectContaining({
        _id: "hold-leftover",
        status: "released",
        releasedAt: 1_000,
      }),
    ]);
  });

  it("releases only active session holds once and reports released quantities", async () => {
    const { db, holds, productSkuPatches } = createDb({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        sku: "SKU-1",
        quantityAvailable: 10,
        inventoryCount: 10,
      },
      holds: [
        buildHold({
          _id: "hold-active-1",
          sourceSessionId: "session-1",
          productSkuId: "sku-1",
          quantity: 2,
        }),
        buildHold({
          _id: "hold-active-2",
          sourceSessionId: "session-1",
          productSkuId: "sku-2",
          quantity: 3,
        }),
        buildHold({
          _id: "hold-released",
          sourceSessionId: "session-1",
          productSkuId: "sku-1",
          status: "released",
          quantity: 5,
        }),
        buildHold({
          _id: "hold-consumed",
          sourceSessionId: "session-1",
          productSkuId: "sku-1",
          status: "consumed",
          quantity: 7,
        }),
        buildHold({
          _id: "hold-other-session",
          sourceSessionId: "session-2",
          productSkuId: "sku-1",
          quantity: 11,
        }),
      ],
    });

    const result = await releaseActiveInventoryHoldsForSession(db as never, {
      sessionId: "session-1" as Id<"posSession">,
      now: 1_000,
    });

    expect(result).toEqual({
      releasedHoldCount: 2,
      releasedQuantity: 5,
      releasedHolds: [
        {
          holdId: "hold-active-1",
          productSkuId: "sku-1",
          quantity: 2,
        },
        {
          holdId: "hold-active-2",
          productSkuId: "sku-2",
          quantity: 3,
        },
      ],
    });
    expect(holds.find((hold) => hold._id === "hold-active-1")).toEqual(
      expect.objectContaining({
        status: "released",
        releasedAt: 1_000,
      }),
    );
    expect(holds.find((hold) => hold._id === "hold-active-2")).toEqual(
      expect.objectContaining({
        status: "released",
        releasedAt: 1_000,
      }),
    );
    expect(holds.find((hold) => hold._id === "hold-released")).toEqual(
      expect.objectContaining({
        status: "released",
        updatedAt: 100,
      }),
    );
    expect(holds.find((hold) => hold._id === "hold-consumed")).toEqual(
      expect.objectContaining({
        status: "consumed",
        updatedAt: 100,
      }),
    );
    expect(holds.find((hold) => hold._id === "hold-other-session")).toEqual(
      expect.objectContaining({
        status: "active",
        updatedAt: 100,
      }),
    );
    expect(productSkuPatches).toEqual([]);

    const replay = await releaseActiveInventoryHoldsForSession(db as never, {
      sessionId: "session-1" as Id<"posSession">,
      now: 2_000,
    });

    expect(replay).toEqual({
      releasedHoldCount: 0,
      releasedQuantity: 0,
      releasedHolds: [],
    });
  });
});

function buildHold(overrides: Partial<HoldRecord>): HoldRecord {
  return {
    _id: "hold-1",
    storeId: "store-1",
    productSkuId: "sku-1",
    sourceType: "posSession",
    sourceSessionId: "session-1",
    status: "active",
    quantity: 1,
    expiresAt: 10_000,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}
