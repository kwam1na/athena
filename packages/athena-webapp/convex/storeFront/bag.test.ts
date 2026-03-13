// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

function wrapDefinition<T extends { handler: (...args: any[]) => any }>(definition: T) {
  return Object.assign(
    (ctx: unknown, args: unknown) => definition.handler(ctx, args),
    definition
  );
}

async function loadBagModule() {
  vi.resetModules();
  vi.doMock("../_generated/server", () => ({
    mutation: wrapDefinition,
    query: wrapDefinition,
  }));
  vi.doMock("../_generated/api", () => ({
    api: {},
  }));
  return import("./bag");
}

async function loadBagItemModule() {
  vi.resetModules();
  vi.doMock("../_generated/server", () => ({
    mutation: wrapDefinition,
    query: wrapDefinition,
  }));
  return import("./bagItem");
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
  let insertCount = 0;

  const take = (key: string) => {
    const queue = queueMap.get(key) || [];
    const value = queue.length > 0 ? queue.shift() : undefined;
    queueMap.set(key, queue);
    return value;
  };

  const db = {
    query: vi.fn((table: string) => {
      const collect = vi.fn(async () => take(`${table}:collect`) || []);
      const first = vi.fn(async () => take(`${table}:first`) || null);
      return {
        filter: vi.fn(() => ({
          collect,
          first,
        })),
        withIndex: vi.fn(() => ({
          collect,
          first,
        })),
        collect,
        first,
      };
    }),
    get: vi.fn(async (id: string) => recordMap.get(id) ?? null),
    insert: vi.fn(async (table: string, data: any) => {
      insertCount += 1;
      const id = `${table}_${insertCount}`;
      recordMap.set(id, { _id: id, ...data });
      return id;
    }),
    patch: vi.fn(async (id: string, patch: any) => {
      const current = recordMap.get(id) || { _id: id };
      recordMap.set(id, { ...current, ...patch });
    }),
    delete: vi.fn(async (id: string) => {
      recordMap.delete(id);
    }),
  };

  return { db, recordMap };
}

describe("bag backend flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));
  });

  it("creates a bag with an empty items collection", async () => {
    const { create } = await loadBagModule();
    const { db } = createDbHarness();

    const result = await create.handler({ db } as never, {
      storeId: "store_1",
      storeFrontUserId: "guest_1",
    });

    expect(db.insert).toHaveBeenCalledWith("bag", {
      storeId: "store_1",
      storeFrontUserId: "guest_1",
      updatedAt: Date.now(),
      items: [],
    });
    expect(result).toEqual({
      _id: "bag_1",
      storeId: "store_1",
      storeFrontUserId: "guest_1",
      updatedAt: Date.now(),
      items: [],
    });
  });

  it("enriches bag items with product, sku, color, and category details", async () => {
    const { getById } = await loadBagModule();
    const { db } = createDbHarness({
      queryQueues: {
        "bagItem:collect": [
          [
            {
              _id: "bag_item_1",
              bagId: "bag_1",
              productId: "product_1",
              productSkuId: "sku_1",
            },
          ],
        ],
      },
      records: {
        bag_1: { _id: "bag_1", storeFrontUserId: "guest_1" },
        product_1: {
          _id: "product_1",
          name: "Body Wave",
          categoryId: "category_1",
          slug: "body-wave",
        },
        sku_1: {
          _id: "sku_1",
          price: 5500,
          length: 24,
          color: "color_1",
          images: ["https://cdn.example.com/body-wave.png"],
        },
        color_1: { _id: "color_1", name: "Natural Black" },
        category_1: { _id: "category_1", name: "Hair" },
      },
    });

    const result = await getById.handler({ db } as never, { id: "bag_1" });

    expect(result).toEqual({
      _id: "bag_1",
      storeFrontUserId: "guest_1",
      items: [
        expect.objectContaining({
          _id: "bag_item_1",
          productName: "Body Wave",
          productCategory: "Hair",
          colorName: "Natural Black",
          productImage: "https://cdn.example.com/body-wave.png",
          productSlug: "body-wave",
        }),
      ],
    });
  });

  it("merges guest bag items into an existing owner bag", async () => {
    const { updateOwner } = await loadBagModule();
    const { db } = createDbHarness({
      queryQueues: {
        "bag:first": [
          { _id: "guest_bag", storeFrontUserId: "guest_1" },
          { _id: "owner_bag", storeFrontUserId: "user_1" },
        ],
        "bagItem:collect": [
          [
            {
              _id: "guest_item_1",
              bagId: "guest_bag",
              productId: "product_1",
              productSkuId: "sku_1",
              quantity: 2,
            },
            {
              _id: "guest_item_2",
              bagId: "guest_bag",
              productId: "product_2",
              productSkuId: "sku_2",
              quantity: 1,
            },
          ],
          [
            {
              _id: "owner_item_1",
              bagId: "owner_bag",
              productId: "product_1",
              productSkuId: "sku_1",
              quantity: 3,
            },
          ],
        ],
      },
      records: {
        owner_bag: { _id: "owner_bag", storeFrontUserId: "user_1" },
      },
    });

    const result = await updateOwner.handler({ db } as never, {
      currentOwner: "guest_1",
      newOwner: "user_1",
    });

    expect(db.patch).toHaveBeenCalledWith("owner_item_1", {
      quantity: 5,
      bagId: "owner_bag",
      storeFrontUserId: "user_1",
    });
    expect(db.delete).toHaveBeenCalledWith("guest_item_1");
    expect(db.patch).toHaveBeenCalledWith("guest_item_2", {
      bagId: "owner_bag",
      storeFrontUserId: "user_1",
    });
    expect(db.delete).toHaveBeenCalledWith("guest_bag");
    expect(result).toEqual({
      _id: "owner_bag",
      storeFrontUserId: "user_1",
    });
  });

  it("increments quantity when the same bag item already exists", async () => {
    const { addItemToBag } = await loadBagItemModule();
    const { db } = createDbHarness({
      queryQueues: {
        "bagItem:first": [
          {
            _id: "bag_item_1",
            quantity: 2,
          },
        ],
      },
    });

    await addItemToBag.handler({ db } as never, {
      bagId: "bag_1",
      productId: "product_1",
      productSkuId: "sku_1",
      productSku: "SKU-1",
      storeFrontUserId: "guest_1",
      quantity: 3,
    });

    expect(db.patch).toHaveBeenCalledWith("bag_1", {
      updatedAt: Date.now(),
    });
    expect(db.patch).toHaveBeenCalledWith("bag_item_1", {
      quantity: 5,
      updatedAt: Date.now(),
    });
    expect(db.insert).not.toHaveBeenCalled();
  });
});
