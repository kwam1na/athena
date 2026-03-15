// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

function wrapDefinition<T extends { handler: (...args: any[]) => any }>(
  definition: T
) {
  return Object.assign(
    (ctx: unknown, args: unknown) => definition.handler(ctx, args),
    definition
  );
}
function h(fn: any): (...args: any[]) => any {
  return fn.handler;
}


function createDbHarness({
  queryQueues = {},
  records = {},
}: {
  queryQueues?: Record<string, any[]>;
  records?: Record<string, any>;
} = {}) {
  const queueMap = new Map<string, any[]>(
    Object.entries(queryQueues).map(([key, value]) => [key, [...value]])
  );
  const recordMap = new Map<string, any>(Object.entries(records));

  const take = (key: string) => {
    const queue = queueMap.get(key) || [];
    const value = queue.length > 0 ? queue.shift() : undefined;
    queueMap.set(key, queue);
    return value;
  };

  const filterOps = {
    field: vi.fn((name: string) => name),
    eq: vi.fn(() => true),
    neq: vi.fn(() => true),
    and: vi.fn((...values: boolean[]) => values.every(Boolean)),
    lte: vi.fn(() => true),
  };
  const indexOps = {
    eq: vi.fn(() => indexOps),
  };

  const db = {
    query: vi.fn((table: string) => {
      const chain: any = {};
      chain.withIndex = vi.fn(
        (_name: string, callback?: (q: typeof indexOps) => unknown) => {
          if (callback) {
            callback(indexOps);
          }
          return chain;
        }
      );
      chain.filter = vi.fn((callback?: (q: typeof filterOps) => unknown) => {
        if (callback) {
          callback(filterOps);
        }
        return chain;
      });
      chain.order = vi.fn(() => chain);
      chain.collect = vi.fn(async () => take(`${table}:collect`) ?? []);
      chain.first = vi.fn(async () => take(`${table}:first`) ?? null);
      chain.take = vi.fn(async () => take(`${table}:take`) ?? []);
      return chain;
    }),
    get: vi.fn(async (id: string) => recordMap.get(id) ?? null),
    patch: vi.fn(async (id: string, patch: any) => {
      const current = recordMap.get(id) || { _id: id };
      recordMap.set(id, { ...current, ...patch });
    }),
  };

  return { db, recordMap };
}

async function loadModule() {
  vi.resetModules();

  vi.doMock("../_generated/server", () => ({
    mutation: wrapDefinition,
    query: wrapDefinition,
  }));

  vi.doMock("../_generated/api", () => ({
    api: {
      inventory: {
        products: {
          getById: "products.getById",
        },
      },
    },
  }));

  return import("./user");
}

describe("storeFront user", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supports basic read/update handlers", async () => {
    const mod = await loadModule();
    const { db, recordMap } = createDbHarness({
      queryQueues: {
        "storeFrontUser:collect": [[{ _id: "user_1", email: "ada@example.com" }]],
      },
      records: {
        user_1: { _id: "user_1", email: "ada@example.com" },
      },
    });

    const all = await h(mod.getAll)({ db } as never, {});
    expect(all).toEqual([{ _id: "user_1", email: "ada@example.com" }]);

    const byId = await h(mod.getById)({ db } as never, { id: "user_1" });
    expect(byId).toEqual({ _id: "user_1", email: "ada@example.com" });

    const updated = await h(mod.update)({ db } as never, {
      id: "user_1",
      email: "new@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      phoneNumber: "5555551234",
      billingAddress: { city: "Accra" },
      shippingAddress: { city: "Tema" },
    });

    expect(db.patch).toHaveBeenCalledWith("user_1", {
      email: "new@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      phoneNumber: "5555551234",
      billingAddress: { city: "Accra" },
      shippingAddress: { city: "Tema" },
    });
    expect(updated).toEqual(recordMap.get("user_1"));

    const byIdentifier = await h(mod.getByIdentifier)(
      { db } as never,
      { id: "user_1" }
    );
    expect(byIdentifier).toEqual(recordMap.get("user_1"));
  });

  it("returns null when getById or getByIdentifier throws", async () => {
    const mod = await loadModule();
    const { db } = createDbHarness();
    db.get.mockRejectedValueOnce(new Error("bad id"));
    db.get.mockRejectedValueOnce(new Error("bad identifier"));

    const byId = await h(mod.getById)({ db } as never, { id: "bad" });
    const byIdentifier = await h(mod.getByIdentifier)(
      { db } as never,
      { id: "bad" }
    );

    expect(byId).toBeNull();
    expect(byIdentifier).toBeNull();
  });

  it("finds linked accounts or returns empty when email is missing", async () => {
    const mod = await loadModule();

    const emptyHarness = createDbHarness({
      records: {
        user_1: { _id: "user_1" },
      },
    });

    const emptyResult = await h(mod.findLinkedAccounts)(
      { db: emptyHarness.db } as never,
      { userId: "user_1" }
    );
    expect(emptyResult).toEqual({ storeFrontUsers: [], guestUsers: [] });

    const linkedHarness = createDbHarness({
      records: {
        user_2: { _id: "user_2", email: "ada@example.com" },
      },
      queryQueues: {
        "storeFrontUser:collect": [[{ _id: "user_3", email: "ada@example.com" }]],
        "guest:collect": [[{ _id: "guest_1", email: "ada@example.com" }]],
      },
    });

    const linkedResult = await h(mod.findLinkedAccounts)(
      { db: linkedHarness.db } as never,
      { userId: "user_2" }
    );

    expect(linkedResult).toEqual({
      storeFrontUsers: [{ _id: "user_3", email: "ada@example.com" }],
      guestUsers: [{ _id: "guest_1", email: "ada@example.com" }],
    });
  });

  it("enriches user activity and handles unknown ids", async () => {
    const { getAllUserActivity } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "analytics:collect": [
          [
            { _id: "a1", storeFrontUserId: "user_1", action: "open" },
            { _id: "a2", storeFrontUserId: "guest_1", action: "view" },
            { _id: "a3", storeFrontUserId: "unknown_1", action: "click" },
          ],
        ],
      },
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.get
      .mockResolvedValueOnce({ _id: "user_1", email: "ada@example.com" })
      .mockRejectedValueOnce(new Error("not storefront user"))
      .mockResolvedValueOnce({ _id: "guest_1", email: "guest@example.com" })
      .mockRejectedValueOnce(new Error("not storefront user"))
      .mockRejectedValueOnce(new Error("not guest either"));

    const result = await h(getAllUserActivity)({ db } as never, {
      id: "user_1",
    });

    expect(result).toEqual([
      expect.objectContaining({
        _id: "a1",
        userData: { email: "ada@example.com" },
      }),
      expect.objectContaining({
        _id: "a2",
        userData: { email: "guest@example.com" },
      }),
      expect.objectContaining({
        _id: "a3",
        userData: {},
      }),
    ]);
    expect(errorSpy).toHaveBeenCalledWith(
      "User ID not found in any table:",
      "unknown_1"
    );
  });

  it("gets last viewed product from recent views while skipping bagged skus", async () => {
    const { getLastViewedProduct } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "analytics:take": [
          [
            {
              _id: "a1",
              data: { product: "product_1", productSku: "SKU-BAGGED" },
              storeId: "store_1",
            },
            {
              _id: "a2",
              data: { product: "product_2", productSku: "SKU-OK" },
              storeId: "store_1",
            },
          ],
        ],
        "bagItem:collect": [
          [
            {
              _id: "bag_item_1",
              productSku: "SKU-BAGGED",
              storeFrontUserId: "user_1",
            },
          ],
        ],
      },
    });

    const ctx = {
      db,
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          skus: [
            {
              sku: "SKU-OK",
              quantityAvailable: 3,
              productCategory: "Hair",
              price: 6000,
            },
          ],
        }),
    };

    const result = await h(getLastViewedProduct)(ctx as never, {
      id: "user_1",
      category: "Hair",
      minAgeHours: 1,
    });

    expect(result).toEqual({
      sku: "SKU-OK",
      quantityAvailable: 3,
      productCategory: "Hair",
      price: 6000,
    });
  });

  it("returns null when no recent viewed products are available", async () => {
    const { getLastViewedProduct } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "analytics:take": [
          [
            {
              _id: "a3",
              data: { product: "product_1", productSku: "SKU-NONE" },
              storeId: "store_1",
            },
          ],
        ],
        "bagItem:collect": [[]],
      },
    });

    const ctx = {
      db,
      runQuery: vi.fn().mockResolvedValue({ skus: [] }),
    };

    const result = await h(getLastViewedProduct)(ctx as never, {
      id: "user_1",
    });

    expect(result).toBeNull();
  });

  it("falls back to all-time viewed products when recent views are empty", async () => {
    const { getLastViewedProduct } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "analytics:take": [
          [],
          [
            {
              _id: "a4",
              data: { product: "product_3", productSku: "SKU-ALLTIME" },
              storeId: "store_2",
            },
          ],
        ],
        "bagItem:collect": [[]],
      },
    });

    const ctx = {
      db,
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          skus: [
            {
              sku: "SKU-ALLTIME",
              quantityAvailable: 1,
              productCategory: "Hair",
            },
          ],
        }),
    };

    const result = await h(getLastViewedProduct)(ctx as never, {
      id: "user_1",
      category: "Hair",
    });

    expect(result).toEqual(
      expect.objectContaining({
        sku: "SKU-ALLTIME",
      })
    );
  });

  it("returns null when all-time viewed products are unavailable", async () => {
    const { getLastViewedProduct } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "analytics:take": [
          [],
          [
            {
              _id: "a5",
              data: { product: "product_4", productSku: "SKU-MISSING" },
              storeId: "store_1",
            },
          ],
        ],
        "bagItem:collect": [[]],
      },
    });

    const result = await getLastViewedProduct.handler(
      { db, runQuery: vi.fn().mockResolvedValue({ skus: [] }) } as never,
      {
        id: "user_1",
      }
    );

    expect(result).toBeNull();
  });

  it("returns multiple unique last viewed products and backfills from all-time history", async () => {
    const { getLastViewedProducts } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "analytics:take": [
          [
            {
              data: { product: "product_1", productSku: "SKU-1" },
              storeId: "store_1",
            },
            {
              data: { product: "product_1", productSku: "SKU-1" },
              storeId: "store_1",
            },
            {
              data: { product: "product_2", productSku: "SKU-2" },
              storeId: "store_1",
            },
          ],
          [
            {
              data: { product: "product_2", productSku: "SKU-2" },
              storeId: "store_1",
            },
            {
              data: { product: "product_3", productSku: "SKU-3" },
              storeId: "store_1",
            },
          ],
        ],
      },
    });

    const productsBySku: Record<string, any> = {
      "SKU-1": {
        sku: "SKU-1",
        quantityAvailable: 4,
        productCategory: "Hair",
      },
      "SKU-2": {
        sku: "SKU-2",
        quantityAvailable: 2,
        productCategory: "Hair",
      },
      "SKU-3": {
        sku: "SKU-3",
        quantityAvailable: 1,
        productCategory: "Hair",
      },
    };

    const ctx = {
      db,
      runQuery: vi.fn().mockImplementation(async (_route: string, args: any) => {
        const sku = args.id === "product_1" ? "SKU-1" : args.id === "product_2" ? "SKU-2" : "SKU-3";
        return { skus: [productsBySku[sku]] };
      }),
    };

    const result = await h(getLastViewedProducts)(ctx as never, {
      id: "user_1",
      category: "Hair",
      limit: 3,
    });

    expect(result).toEqual([
      productsBySku["SKU-1"],
      productsBySku["SKU-2"],
      productsBySku["SKU-3"],
    ]);
  });

  it("returns empty product list when no viewed products are available", async () => {
    const { getLastViewedProducts } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "analytics:take": [[], []],
      },
    });

    const result = await h(getLastViewedProducts)(
      { db, runQuery: vi.fn().mockResolvedValue({ skus: [] }) } as never,
      {
        id: "user_1",
        limit: 2,
      }
    );

    expect(result).toEqual([]);
  });

  it("breaks early in recent-view loop when limit is reached", async () => {
    const { getLastViewedProducts } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "analytics:take": [
          [
            {
              data: { product: "product_1", productSku: "SKU-1" },
              storeId: "store_1",
            },
            {
              data: { product: "product_2", productSku: "SKU-2" },
              storeId: "store_1",
            },
          ],
        ],
      },
    });

    const result = await getLastViewedProducts.handler(
      {
        db,
        runQuery: vi.fn().mockResolvedValue({
          skus: [{ sku: "SKU-1", quantityAvailable: 1, productCategory: "Hair" }],
        }),
      } as never,
      {
        id: "user_1",
        limit: 1,
        category: "Hair",
      }
    );

    expect(result).toHaveLength(1);
  });

  it("breaks early in all-time loop when limit is reached", async () => {
    const { getLastViewedProducts } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "analytics:take": [
          [],
          [
            {
              data: { product: "product_3", productSku: "SKU-3" },
              storeId: "store_1",
            },
            {
              data: { product: "product_4", productSku: "SKU-4" },
              storeId: "store_1",
            },
          ],
        ],
      },
    });

    const result = await getLastViewedProducts.handler(
      {
        db,
        runQuery: vi.fn().mockResolvedValue({
          skus: [{ sku: "SKU-3", quantityAvailable: 1, productCategory: "Hair" }],
        }),
      } as never,
      {
        id: "user_1",
        limit: 1,
        category: "Hair",
      }
    );

    expect(result).toHaveLength(1);
  });

  it("gets online order by id and most recent activity", async () => {
    const mod = await loadModule();
    const { db } = createDbHarness({
      records: {
        order_1: { _id: "order_1", amount: 10000 },
      },
      queryQueues: {
        "analytics:first": [{ _id: "analytic_latest", action: "checkout" }],
      },
    });

    const order = await h(mod.getOnlineOrderById)({ db } as never, {
      id: "order_1",
    });
    expect(order).toEqual({ _id: "order_1", amount: 10000 });

    const recent = await h(mod.getMostRecentActivity)({ db } as never, {
      id: "user_1",
    });
    expect(recent).toEqual({ _id: "analytic_latest", action: "checkout" });
  });
});
