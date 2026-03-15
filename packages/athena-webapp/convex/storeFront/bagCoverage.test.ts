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
  let insertCounter = 0;

  const take = (key: string) => {
    const queue = queueMap.get(key) || [];
    const value = queue.length > 0 ? queue.shift() : undefined;
    queueMap.set(key, queue);
    return value;
  };

  const filterOps = {
    field: vi.fn((name: string) => name),
    eq: vi.fn(() => true),
    and: vi.fn((...values: boolean[]) => values.every(Boolean)),
  };
  const indexOps = {
    eq: vi.fn(() => indexOps),
  };

  const db = {
    query: vi.fn((table: string) => {
      const chain: any = {};
      chain.filter = vi.fn((callback?: (q: typeof filterOps) => unknown) => {
        if (callback) {
          callback(filterOps);
        }
        return chain;
      });
      chain.withIndex = vi.fn(
        (_name: string, callback?: (q: typeof indexOps) => unknown) => {
          if (callback) {
            callback(indexOps);
          }
          return chain;
        }
      );
      chain.order = vi.fn(() => chain);
      chain.collect = vi.fn(async () => take(`${table}:collect`) ?? []);
      chain.first = vi.fn(async () => take(`${table}:first`) ?? null);
      return chain;
    }),
    get: vi.fn(async (id: string) => recordMap.get(id) ?? null),
    insert: vi.fn(async (table: string, value: any) => {
      const id = `${table}_${++insertCounter}`;
      recordMap.set(id, { _id: id, ...value });
      return id;
    }),
    patch: vi.fn(async (id: string, patch: any) => {
      const current = recordMap.get(id) || { _id: id };
      recordMap.set(id, { ...current, ...patch });
      return recordMap.get(id);
    }),
    delete: vi.fn(async (id: string) => {
      recordMap.delete(id);
    }),
  };

  return { db, recordMap };
}

async function loadBagModules() {
  vi.resetModules();
  vi.doMock("../_generated/server", () => ({
    mutation: wrapDefinition,
    query: wrapDefinition,
  }));
  vi.doMock("../_generated/api", () => ({
    api: {
      storeFront: {
        bag: {
          getById: "bag.getById",
        },
      },
    },
  }));

  const bag = await import("./bag");
  const bagItem = await import("./bagItem");
  const savedBag = await import("./savedBag");
  const savedBagItem = await import("./savedBagItem");

  return { bag, bagItem, savedBag, savedBagItem };
}

describe("storeFront bag and saved bag coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
  });

  it("covers additional bag handlers and branches", async () => {
    const { bag } = await loadBagModules();
    const { db, recordMap } = createDbHarness({
      queryQueues: {
        "bag:collect": [
          [{ _id: "bag_1" }],
          [
            { _id: "bag_2", storeFrontUserId: "user_1", updatedAt: 10 },
            { _id: "bag_3", storeFrontUserId: "user_2", updatedAt: 20 },
            { _id: "bag_4", storeFrontUserId: "user_1", updatedAt: 30 },
          ],
          [
            { _id: "bag_10", storeFrontUserId: "user_1", updatedAt: 5 },
            { _id: "bag_11", storeFrontUserId: "user_1", updatedAt: 25 },
          ],
        ],
        "bag:first": [
          {
            _id: "bag_user_1",
            storeFrontUserId: "user_1",
          },
          null,
          null,
          {
            _id: "bag_guest_1",
            storeFrontUserId: "guest_1",
            updatedAt: 100,
          },
          null,
        ],
        "bagItem:collect": [
          [
            {
              _id: "bag_item_1",
              bagId: "bag_user_1",
              productId: "product_1",
              productSkuId: "sku_1",
              quantity: 1,
            },
          ],
          [
            {
              _id: "bag_item_1",
              bagId: "bag_user_1",
              productId: "product_1",
              productSkuId: "sku_1",
              quantity: 1,
            },
            {
              _id: "bag_item_2",
              bagId: "bag_other_1",
              productId: "product_1",
              productSkuId: "sku_1",
              quantity: 2,
            },
            {
              _id: "bag_item_3",
              bagId: "bag_other_2",
              productId: "product_1",
              productSkuId: "sku_1",
              quantity: 3,
            },
            {
              _id: "bag_item_4",
              bagId: "bag_other_2",
              productId: "product_1",
              productSkuId: "sku_1",
              quantity: 1,
            },
          ],
          [{ _id: "bag_item_del_1" }, { _id: "bag_item_del_2" }],
          [{ _id: "bag_item_clear_1" }],
          [
            {
              _id: "bag2_item_1",
              bagId: "bag_2",
              productId: "product_1",
              productSkuId: "sku_1",
              quantity: 1,
            },
          ],
          [],
          [
            {
              _id: "bag4_item_1",
              bagId: "bag_4",
              productId: "product_2",
              productSkuId: "sku_2",
              quantity: 2,
            },
          ],
          [
            {
              _id: "bag10_item_1",
              bagId: "bag_10",
              productId: "product_1",
              productSkuId: "sku_1",
              quantity: 1,
            },
          ],
          [
            {
              _id: "bag11_item_1",
              bagId: "bag_11",
              productId: "product_2",
              productSkuId: "sku_2",
              quantity: 2,
            },
          ],
        ],
      },
      records: {
        bag_404: null,
        bag_guest_1: {
          _id: "bag_guest_1",
          storeFrontUserId: "guest_1",
        },
        sku_1: {
          _id: "sku_1",
          price: 5000,
          length: 20,
          color: "color_1",
          images: ["https://cdn.example.com/sku-1.png"],
        },
        sku_2: {
          _id: "sku_2",
          price: 0,
          length: 18,
          images: [],
        },
        color_1: { _id: "color_1", name: "Natural Black" },
        product_1: {
          _id: "product_1",
          name: "Body Wave",
          categoryId: "category_1",
          slug: "body-wave",
        },
        product_2: {
          _id: "product_2",
          name: "Closure",
          categoryId: "category_2",
          slug: "closure",
        },
        category_1: { _id: "category_1", name: "Hair" },
        category_2: { _id: "category_2", name: "Accessories" },
      },
    });

    const all = await h(bag.getAll)({ db } as never, {});
    expect(all).toEqual([{ _id: "bag_1" }]);

    const missingById = await h(bag.getById)({ db } as never, {
      id: "bag_404",
    });
    expect(missingById).toBeNull();

    const byUser = await h(bag.getByUserId)({ db } as never, {
      storeFrontUserId: "user_1",
    });
    expect(byUser).toEqual(
      expect.objectContaining({
        _id: "bag_user_1",
        items: [
          expect.objectContaining({
            productName: "Body Wave",
            colorName: "Natural Black",
            otherBagsWithSku: 2,
          }),
        ],
      })
    );

    const missingByUser = await h(bag.getByUserId)({ db } as never, {
      storeFrontUserId: "missing",
    });
    expect(missingByUser).toBeNull();

    const deleted = await h(bag.deleteBag)({ db } as never, { id: "bag_1" });
    expect(deleted).toEqual({ message: "Bag and its items deleted" });
    expect(db.delete).toHaveBeenCalledWith("bag_item_del_1");
    expect(db.delete).toHaveBeenCalledWith("bag_item_del_2");

    const cleared = await h(bag.clearBag)({ db } as never, { id: "bag_2" });
    expect(cleared).toEqual({ message: "Items in bag cleared" });
    expect(db.delete).toHaveBeenCalledWith("bag_item_clear_1");

    const missingOwnerHarness = createDbHarness({
      queryQueues: {
        "bag:first": [null, null],
      },
    });
    const missingOwnerUpdate = await h(bag.updateOwner)(
      { db: missingOwnerHarness.db } as never,
      {
        currentOwner: "guest_none",
        newOwner: "user_1",
      }
    );
    expect(missingOwnerUpdate).toBeNull();

    const reassignHarness = createDbHarness({
      queryQueues: {
        "bag:first": [
          {
            _id: "bag_guest_1",
            storeFrontUserId: "guest_1",
          },
          null,
        ],
      },
      records: {
        bag_guest_1: {
          _id: "bag_guest_1",
          storeFrontUserId: "guest_1",
        },
      },
    });
    const reassigned = await h(bag.updateOwner)(
      { db: reassignHarness.db } as never,
      {
        currentOwner: "guest_1",
        newOwner: "user_1",
      }
    );
    expect(reassignHarness.db.patch).toHaveBeenCalledWith("bag_guest_1", {
      storeFrontUserId: "user_1",
      updatedAt: Date.now(),
    });
    expect(reassigned).toEqual({
      _id: "bag_guest_1",
      storeFrontUserId: "user_1",
      updatedAt: Date.now(),
    });

    const paginated = await h(bag.getPaginatedBags)({ db } as never, {
      storeId: "store_1",
      pagination: { pageIndex: 0, pageSize: 5 },
      sorting: [{ id: "updatedAt", desc: false }],
      filters: [{ id: "storeFrontUserId", value: "user_1" }],
    });
    expect(paginated).toEqual(
      expect.objectContaining({
        totalCount: 1,
        pageCount: 1,
      })
    );
    expect(paginated.items[0]).toEqual(
      expect.objectContaining({
        _id: "bag_2",
        total: 5000,
      })
    );

    const paginatedDefaultSort = await h(bag.getPaginatedBags)(
      { db } as never,
      {
        storeId: "store_1",
        pagination: { pageIndex: 0, pageSize: 5 },
      }
    );
    expect(paginatedDefaultSort.totalCount).toBe(1);

    const sortHarness = createDbHarness({
      queryQueues: {
        "bag:collect": [
          [
            { _id: "bag_s1", storeFrontUserId: "user_b", updatedAt: 30 },
            { _id: "bag_s2", storeFrontUserId: "user_a", updatedAt: 10 },
          ],
          [
            { _id: "bag_s1", storeFrontUserId: "user_b", updatedAt: 30 },
            { _id: "bag_s2", storeFrontUserId: "user_a", updatedAt: 10 },
          ],
          [
            { _id: "bag_s1", storeFrontUserId: "user_b", updatedAt: 30 },
            { _id: "bag_s2", storeFrontUserId: "user_a", updatedAt: 10 },
          ],
          [
            { _id: "bag_s1", storeFrontUserId: "user_b", updatedAt: 30 },
            { _id: "bag_s2", storeFrontUserId: "user_a", updatedAt: 10 },
          ],
        ],
        "bagItem:collect": [
          [{ _id: "i1", bagId: "bag_s1", productId: "product_1", productSkuId: "sku_1", quantity: 1 }],
          [{ _id: "i2", bagId: "bag_s2", productId: "product_1", productSkuId: "sku_1", quantity: 1 }],
          [{ _id: "i1", bagId: "bag_s1", productId: "product_1", productSkuId: "sku_1", quantity: 1 }],
          [{ _id: "i2", bagId: "bag_s2", productId: "product_1", productSkuId: "sku_1", quantity: 1 }],
          [{ _id: "i1", bagId: "bag_s1", productId: "product_1", productSkuId: "sku_1", quantity: 1 }],
          [{ _id: "i2", bagId: "bag_s2", productId: "product_1", productSkuId: "sku_1", quantity: 1 }],
          [{ _id: "i1", bagId: "bag_s1", productId: "product_1", productSkuId: "sku_1", quantity: 1 }],
          [{ _id: "i2", bagId: "bag_s2", productId: "product_1", productSkuId: "sku_1", quantity: 1 }],
        ],
      },
      records: {
        sku_1: { _id: "sku_1", price: 4000, images: [] },
        product_1: { _id: "product_1", name: "Body Wave", slug: "body-wave" },
      },
    });

    await h(bag.getPaginatedBags)({ db: sortHarness.db } as never, {
      storeId: "store_1",
      pagination: { pageIndex: 0, pageSize: 10 },
      sorting: [{ id: "updatedAt", desc: true }],
    });

    await h(bag.getPaginatedBags)({ db: sortHarness.db } as never, {
      storeId: "store_1",
      pagination: { pageIndex: 0, pageSize: 10 },
      sorting: [{ id: "storeFrontUserId", desc: true }],
    });

    await h(bag.getPaginatedBags)({ db: sortHarness.db } as never, {
      storeId: "store_1",
      pagination: { pageIndex: 0, pageSize: 10 },
      sorting: [{ id: "storeFrontUserId", desc: false }],
    });

    await h(bag.getPaginatedBags)({ db: sortHarness.db } as never, {
      storeId: "store_1",
      pagination: { pageIndex: 0, pageSize: 10 },
      sorting: [{ id: "items", desc: false }],
    });
  });

  it("covers bagItem mutation/query branches", async () => {
    const { bagItem } = await loadBagModules();
    const { db } = createDbHarness({
      queryQueues: {
        "bagItem:first": [null],
        "bag:collect": [[{ _id: "bag_1" }, { _id: "bag_2" }]],
      },
    });

    const insertedId = await h(bagItem.addItemToBag)({ db } as never, {
      bagId: "bag_1",
      productId: "product_1",
      productSkuId: "sku_1",
      productSku: "SKU-1",
      storeFrontUserId: "user_1",
      quantity: 2,
    });
    expect(insertedId).toBe("bagItem_1");

    await h(bagItem.updateItemInBag)({ db } as never, {
      itemId: "bagItem_1",
      quantity: 5,
    });
    expect(db.patch).toHaveBeenCalledWith("bagItem_1", { quantity: 5 });

    const deleted = await h(bagItem.deleteItemFromBag)({ db } as never, {
      itemId: "bagItem_1",
    });
    expect(deleted).toEqual({ message: "Item deleted from bag" });

    const itemsForStore = await h(bagItem.getBagItemsForStore)(
      {
        db,
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({ _id: "bag_1", items: [{ _id: "x" }] })
          .mockResolvedValueOnce({ _id: "bag_2", items: [] }),
      } as never,
      {
        storeId: "store_1",
        cursor: null,
      }
    );
    expect(itemsForStore).toEqual([{ _id: "bag_1", items: [{ _id: "x" }] }]);
  });

  it("covers additional savedBag/savedBagItem branches", async () => {
    const { savedBag, savedBagItem } = await loadBagModules();
    const { db, recordMap } = createDbHarness({
      queryQueues: {
        "savedBag:collect": [[{ _id: "savedBag_1" }]],
        "savedBag:first": [
          {
            _id: "savedBag_user_1",
            storeFrontUserId: "user_1",
          },
          null,
          null,
          {
            _id: "savedBag_guest_1",
            storeFrontUserId: "guest_1",
            updatedAt: 100,
          },
          null,
        ],
        "savedBagItem:collect": [
          [
            {
              _id: "saved_item_1",
              savedBagId: "savedBag_user_1",
              productId: "product_1",
              productSkuId: "sku_1",
              quantity: 1,
            },
          ],
          [{ _id: "saved_item_del_1" }],
        ],
        "savedBagItem:first": [null],
      },
      records: {
        savedBag_404: null,
        savedBag_guest_1: {
          _id: "savedBag_guest_1",
          storeFrontUserId: "guest_1",
        },
        sku_1: {
          _id: "sku_1",
          price: 5000,
          length: 20,
          color: "color_1",
          images: ["https://cdn.example.com/sku-1.png"],
        },
        color_1: { _id: "color_1", name: "Natural Black" },
        product_1: {
          _id: "product_1",
          name: "Body Wave",
          categoryId: "category_1",
          slug: "body-wave",
        },
        category_1: { _id: "category_1", name: "Hair" },
      },
    });

    const allSaved = await h(savedBag.getAll)({ db } as never, {});
    expect(allSaved).toEqual([{ _id: "savedBag_1" }]);

    const missingSavedById = await h(savedBag.getById)({ db } as never, {
      id: "savedBag_404",
    });
    expect(missingSavedById).toBeNull();

    const savedByUser = await h(savedBag.getByUserId)({ db } as never, {
      storeFrontUserId: "user_1",
    });
    expect(savedByUser).toEqual(
      expect.objectContaining({
        _id: "savedBag_user_1",
        items: [expect.objectContaining({ productName: "Body Wave" })],
      })
    );

    const missingSavedByUser = await h(savedBag.getByUserId)(
      { db } as never,
      {
        storeFrontUserId: "missing",
      }
    );
    expect(missingSavedByUser).toBeNull();

    const deletedSaved = await h(savedBag.deleteSavedBag)(
      { db } as never,
      { id: "savedBag_1" }
    );
    expect(deletedSaved).toEqual({ message: "Bag and its items deleted" });
    expect(db.delete).toHaveBeenCalledWith("saved_item_del_1");

    const missingSavedOwnerHarness = createDbHarness({
      queryQueues: {
        "savedBag:first": [null, null],
      },
    });
    const missingUpdateOwner = await h(savedBag.updateOwner)(
      { db: missingSavedOwnerHarness.db } as never,
      {
        currentOwner: "guest_none",
        newOwner: "user_1",
      }
    );
    expect(missingUpdateOwner).toBeNull();

    const savedReassignHarness = createDbHarness({
      queryQueues: {
        "savedBag:first": [
          {
            _id: "savedBag_guest_1",
            storeFrontUserId: "guest_1",
          },
          null,
        ],
      },
      records: {
        savedBag_guest_1: {
          _id: "savedBag_guest_1",
          storeFrontUserId: "guest_1",
        },
      },
    });
    const reassigned = await h(savedBag.updateOwner)(
      { db: savedReassignHarness.db } as never,
      {
        currentOwner: "guest_1",
        newOwner: "user_1",
      }
    );
    expect(savedReassignHarness.db.patch).toHaveBeenCalledWith(
      "savedBag_guest_1",
      {
      storeFrontUserId: "user_1",
      updatedAt: Date.now(),
      }
    );
    expect(reassigned).toEqual({
      _id: "savedBag_guest_1",
      storeFrontUserId: "user_1",
      updatedAt: Date.now(),
    });

    const mergeWithoutExistingHarness = createDbHarness({
      queryQueues: {
        "savedBag:first": [
          { _id: "saved_guest", storeFrontUserId: "guest_1" },
          { _id: "saved_user", storeFrontUserId: "user_1" },
        ],
        "savedBagItem:collect": [
          [
            {
              _id: "saved_item_guest",
              savedBagId: "saved_guest",
              productId: "product_1",
              productSkuId: "sku_1",
              quantity: 1,
            },
          ],
          [],
        ],
      },
      records: {
        saved_user: { _id: "saved_user", storeFrontUserId: "user_1" },
      },
    });
    await h(savedBag.updateOwner)(
      { db: mergeWithoutExistingHarness.db } as never,
      {
        currentOwner: "guest_1",
        newOwner: "user_1",
      }
    );
    expect(mergeWithoutExistingHarness.db.patch).toHaveBeenCalledWith(
      "saved_item_guest",
      {
        savedBagId: "saved_user",
        storeFrontUserId: "user_1",
      }
    );

    const insertedId = await h(savedBagItem.addItemToBag)({ db } as never, {
      savedBagId: "savedBag_1",
      productId: "product_1",
      productSkuId: "sku_1",
      productSku: "SKU-1",
      storeFrontUserId: "user_1",
      quantity: 1,
    });
    expect(insertedId).toBe("savedBagItem_1");

    await h(savedBagItem.updateItemInBag)({ db } as never, {
      itemId: "savedBagItem_1",
      quantity: 3,
    });
    expect(db.patch).toHaveBeenCalledWith("savedBagItem_1", { quantity: 3 });

    const deletedItem = await h(savedBagItem.deleteItemFromSavedBag)(
      { db } as never,
      { itemId: "savedBagItem_1" }
    );
    expect(deletedItem).toEqual({ message: "Item deleted from saved bag" });
  });
});
