// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

function wrapDefinition<T extends { handler: (...args: any[]) => any }>(definition: T) {
  return Object.assign(
    (ctx: unknown, args: unknown) => definition.handler(ctx, args),
    definition
  );
}

async function loadModule(modulePath: string) {
  vi.resetModules();

  vi.doMock("../_generated/server", () => ({
    mutation: wrapDefinition,
    query: wrapDefinition,
    action: wrapDefinition,
    internalMutation: wrapDefinition,
  }));

  return import(modulePath);
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
          order: vi.fn(() => ({
            collect,
            first,
          })),
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

describe("inventory Convex modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns organizations for a user through organizationMember links", async () => {
    const { getAll, getByIdOrSlug } = await loadModule("./organizations");
    const { db } = createDbHarness({
      queryQueues: {
        "organizationMember:collect": [
          [
            { organizationId: "org_1" },
            { organizationId: "org_2" },
          ],
        ],
        "organization:first": [
          { _id: "org_1", slug: "wigclub" },
        ],
      },
      records: {
        org_1: { _id: "org_1", name: "Wigclub" },
        org_2: { _id: "org_2", name: "Athena Beauty" },
      },
    });

    await expect(
      getAll.handler({ db } as never, { userId: "user_1" })
    ).resolves.toEqual([
      { _id: "org_1", name: "Wigclub" },
      { _id: "org_2", name: "Athena Beauty" },
    ]);

    await expect(
      getByIdOrSlug.handler({ db } as never, { identifier: "wigclub" })
    ).resolves.toEqual({ _id: "org_1", slug: "wigclub" });
  });

  it("updates store config and looks stores up by slug within an organization", async () => {
    const { getByIdOrSlug, updateConfig } = await loadModule("./stores");
    const { db } = createDbHarness({
      queryQueues: {
        "store:first": [
          { _id: "store_1", slug: "accra-store", organizationId: "org_1" },
        ],
      },
      records: {
        store_1: { _id: "store_1", organizationId: "org_1" },
      },
    });

    await expect(
      getByIdOrSlug.handler({ db } as never, {
        identifier: "accra-store",
        organizationId: "org_1",
      })
    ).resolves.toEqual({
      _id: "store_1",
      slug: "accra-store",
      organizationId: "org_1",
    });

    await expect(
      updateConfig.handler({ db } as never, {
        id: "store_1",
        config: { contactInfo: { location: "Accra Mall" } },
      })
    ).resolves.toEqual({
      _id: "store_1",
      organizationId: "org_1",
      config: { contactInfo: { location: "Accra Mall" } },
    });
  });

  it("groups categories with their subcategories", async () => {
    const { getCategoriesWithSubcategories } = await loadModule("./categories");
    const { db } = createDbHarness({
      queryQueues: {
        "category:collect": [
          [
            { _id: "cat_1", name: "Wigs" },
            { _id: "cat_2", name: "Accessories" },
          ],
        ],
        "subcategory:collect": [
          [
            { _id: "sub_1", categoryId: "cat_1", name: "Lace Front" },
            { _id: "sub_2", categoryId: "cat_1", name: "Closure" },
          ],
        ],
      },
    });

    await expect(
      getCategoriesWithSubcategories.handler({ db } as never, {
        storeId: "store_1",
      })
    ).resolves.toEqual([
      {
        _id: "cat_1",
        name: "Wigs",
        subcategories: [
          { _id: "sub_1", categoryId: "cat_1", name: "Lace Front" },
          { _id: "sub_2", categoryId: "cat_1", name: "Closure" },
        ],
      },
      {
        _id: "cat_2",
        name: "Accessories",
        subcategories: [],
      },
    ]);
  });

  it("updates subcategory names by regenerating the slug", async () => {
    const { update } = await loadModule("./subcategories");
    const { db } = createDbHarness({
      records: {
        sub_1: { _id: "sub_1", name: "Old Name", slug: "old-name" },
      },
    });

    await expect(
      update.handler({ db } as never, {
        id: "sub_1",
        name: "Raw Hair Bundles",
      })
    ).resolves.toEqual({
      _id: "sub_1",
      name: "Raw Hair Bundles",
      slug: "raw-hair-bundles",
    });

    expect(db.patch).toHaveBeenCalledWith("sub_1", {
      name: "Raw Hair Bundles",
      slug: "raw-hair-bundles",
    });
  });

  it("builds product responses with filtered sorted skus and generated sku ids", async () => {
    const productsModule = await loadModule("./products");
    const { getAll, createSku, removeAllProductsForStore } = productsModule;

    const { db } = createDbHarness({
      queryQueues: {
        "product:collect": [
          [
            {
              _id: "product_1",
              name: "Body Wave",
              storeId: "store_1",
            },
            {
              _id: "product_2",
              name: "Bonnet",
              storeId: "store_1",
            },
          ],
        ],
        "productSku:collect": [
          [
            {
              _id: "sku_1",
              productId: "product_1",
              storeId: "store_1",
              price: 150,
              inventoryCount: 5,
              quantityAvailable: 4,
            },
            {
              _id: "sku_2",
              productId: "product_1",
              storeId: "store_1",
              price: 100,
              inventoryCount: 3,
              quantityAvailable: 2,
            },
            {
              _id: "sku_3",
              productId: "product_2",
              storeId: "store_1",
              price: 0,
              inventoryCount: 2,
              quantityAvailable: 2,
            },
          ],
        ],
        "product:first": [
          {
            _id: "ABCDEF123",
            storeId: "STORE1234",
          },
        ],
        "product:collect:cleanup": [
          [
            { _id: "product_1" },
            { _id: "product_2" },
          ],
        ],
        "productSku:collect:cleanup": [
          [
            { _id: "sku_1" },
            { _id: "sku_2" },
          ],
        ],
      },
      records: {
        productSku_1: { _id: "productSku_1", sku: "STOR-EF1-U_1" },
      },
    });

    const originalQuery = db.query;
    db.query = vi.fn((table: string) => {
      const base = originalQuery(table);
      const filter = vi.fn(() => ({
        collect: vi.fn(async () => {
          const queueKey =
            table === "product" && db.query.mock.calls.length > 2
              ? "product:collect:cleanup"
              : table === "productSku" && db.query.mock.calls.length > 2
                ? "productSku:collect:cleanup"
                : `${table}:collect`;
          const queue = (
            queueKey === "product:collect:cleanup"
              ? [
                  [
                    { _id: "product_1" },
                    { _id: "product_2" },
                  ],
                ]
              : queueKey === "productSku:collect:cleanup"
                ? [
                    [
                      { _id: "sku_1" },
                      { _id: "sku_2" },
                    ],
                  ]
                : []
          ) as any;
          return queue.length ? queue.shift() : await base.filter().collect();
        }),
        first: base.filter().first,
      }));
      return { ...base, filter };
    });

    const products = await getAll.handler({ db } as never, {
      storeId: "store_1",
    });

    expect(products).toEqual([
      {
        _id: "product_1",
        name: "Body Wave",
        storeId: "store_1",
        inventoryCount: 8,
        quantityAvailable: 6,
        skus: [
          expect.objectContaining({ _id: "sku_2", price: 100 }),
          expect.objectContaining({ _id: "sku_1", price: 150 }),
        ],
      },
    ]);

    const createdSku = await createSku.handler({ db } as never, {
      productId: "ABCDEF123",
      storeId: "store_1",
      images: [],
      price: 120,
      inventoryCount: 5,
      quantityAvailable: 5,
      attributes: {},
    });

    expect(db.insert).toHaveBeenCalledWith(
      "productSku",
      expect.objectContaining({
        sku: "TEMP_SKU",
      })
    );
    expect(db.patch).toHaveBeenCalledWith(
      "productSku_1",
      expect.objectContaining({
        sku: expect.stringMatching(/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9_]+$/),
      })
    );
    expect(createdSku).toEqual(
      expect.objectContaining({
        _id: "productSku_1",
      })
    );

    await removeAllProductsForStore.handler(
      {
        db: {
          ...db,
          query: vi.fn((table: string) => ({
            filter: vi.fn(() => ({
              collect: vi.fn(async () =>
                table === "product"
                  ? [{ _id: "product_1" }, { _id: "product_2" }]
                  : [{ _id: "sku_1" }, { _id: "sku_2" }]
              ),
            })),
          })),
        },
      } as never,
      { storeId: "store_1" }
    );
  });
});
