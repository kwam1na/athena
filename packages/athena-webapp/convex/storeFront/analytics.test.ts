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
    and: vi.fn((...values: boolean[]) => values.every(Boolean)),
    gte: vi.fn(() => true),
    lte: vi.fn(() => true),
    lt: vi.fn(() => true),
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
      chain.take = vi.fn(async () => take(`${table}:take`) ?? []);
      chain.first = vi.fn(async () => take(`${table}:first`) ?? null);
      chain.paginate = vi.fn(
        async () =>
          take(`${table}:paginate`) ?? {
            page: [],
            continueCursor: null,
            isDone: true,
          }
      );
      return chain;
    }),
    get: vi.fn(async (id: string) => recordMap.get(id) ?? null),
    insert: vi.fn(async (table: string, value: any) => {
      const id = `${table}_1`;
      recordMap.set(id, { _id: id, ...value });
      return id;
    }),
    patch: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };

  return { db, recordMap };
}

async function loadModule() {
  vi.resetModules();

  vi.doMock("../_generated/server", () => ({
    mutation: wrapDefinition,
    query: wrapDefinition,
  }));

  return import("./analytics");
}

describe("storeFront analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
  });

  it("handles create, update owner, basic reads, pagination, and clear branches", async () => {
    const mod = await loadModule();
    const { db, recordMap } = createDbHarness({
      queryQueues: {
        "analytics:collect": [
          [{ _id: "a_guest_1" }, { _id: "a_guest_2" }],
          [{ _id: "a_filter_1" }],
          [{ _id: "a_all_1" }],
        ],
        "analytics:take": [[{ _id: "a_take_1" }]],
        "analytics:paginate": [
          {
            page: [{ _id: "a_page_1" }],
            continueCursor: "next_cursor",
            isDone: false,
          },
        ],
      },
      records: {
        analytics_1: { _id: "analytics_1", action: "viewed_product" },
      },
    });

    const created = await h(mod.create)({ db } as never, {
      storeId: "store_1",
      storeFrontUserId: "user_1",
      origin: "web",
      action: "opened_storefront",
      data: {},
      device: "mobile",
      productId: undefined,
    });
    expect(created).toEqual(recordMap.get("analytics_1"));

    const updated = await h(mod.updateOwner)({ db } as never, {
      guestId: "guest_1",
      userId: "user_1",
    });
    expect(updated).toEqual({ updated: 2 });
    expect(db.patch).toHaveBeenCalledTimes(2);

    const withProductAndAction = await h(mod.getAll)({ db } as never, {
      storeId: "store_1",
      action: "viewed_product",
      productId: "product_1",
    });
    expect(withProductAndAction).toEqual([{ _id: "a_filter_1" }]);

    const withActionOnly = await h(mod.getAll)({ db } as never, {
      storeId: "store_1",
      action: "viewed_product",
    });
    expect(withActionOnly).toEqual([{ _id: "a_all_1" }]);

    const all = await h(mod.getAll)({ db } as never, {
      storeId: "store_1",
    });
    expect(all).toEqual([{ _id: "a_take_1" }]);

    const paginated = await h(mod.getAllPaginated)({ db } as never, {
      storeId: "store_1",
      cursor: null,
      action: "viewed_product",
    });
    expect(paginated).toEqual({
      items: [{ _id: "a_page_1" }],
      cursor: "next_cursor",
      isDone: false,
    });

    const byId = await h(mod.get)({ db } as never, {
      id: "analytics_1",
    });
    expect(byId).toEqual(
      expect.objectContaining({
        _id: "analytics_1",
        action: "opened_storefront",
      })
    );

    const byPromoCode = await h(mod.getByPromoCodeId)({ db } as never, {
      promoCodeId: "promo_1",
    });
    expect(byPromoCode).toEqual([]);

    const clearedByAction = await h(mod.clear)({ db } as never, {
      storeId: "store_1",
      storeFrontUserId: "user_1",
      action: "viewed_product",
    });
    expect(clearedByAction).toEqual({ deleted: 0 });

    const clearedAll = await h(mod.clear)({ db } as never, {
      storeId: "store_1",
      storeFrontUserId: "user_1",
    });
    expect(clearedAll).toEqual({ deleted: 0 });
  });

  it("computes product view counts and revenue analytics", async () => {
    const mod = await loadModule();
    const startOfDay = new Date("2026-03-15T00:00:00.000Z").getTime();
    const { db } = createDbHarness({
      queryQueues: {
        "analytics:collect": [
          [
            { _id: "a1", _creationTime: Date.now() },
            { _id: "a2", _creationTime: startOfDay - 10 },
          ],
        ],
        "onlineOrder:collect": [
          [
            { _id: "o1", amount: 1000, _creationTime: startOfDay + 1000 },
            { _id: "o2", amount: 3000, _creationTime: startOfDay + 2000 },
          ],
          [],
        ],
      },
    });

    const count = await h(mod.getProductViewCount)({ db } as never, {
      productId: "product_1",
    });
    expect(count).toEqual({ daily: 1, total: 2 });

    const revenue = await h(mod.getRevenueAnalytics)({ db } as never, {
      storeId: "store_1",
      startDate: startOfDay,
      endDate: startOfDay + 10_000,
    });
    expect(revenue).toEqual({
      totalRevenue: 4000,
      totalOrders: 2,
      averageOrderValue: 2000,
      revenueByDay: {
        "2026-03-15": 4000,
      },
    });

    const emptyRevenue = await h(mod.getRevenueAnalytics)({ db } as never, {
      storeId: "store_1",
    });
    expect(emptyRevenue).toEqual({
      totalRevenue: 0,
      totalOrders: 0,
      averageOrderValue: 0,
      revenueByDay: {},
    });
  });

  it("computes enhanced analytics and top products", async () => {
    const mod = await loadModule();
    const now = Date.now();
    const { db } = createDbHarness({
      queryQueues: {
        "analytics:take": [
          [
            {
              _id: "a1",
              storeFrontUserId: "user_1",
              action: "viewed_product",
              device: "mobile",
              _creationTime: now,
              data: { product: "product_1" },
            },
            {
              _id: "a2",
              storeFrontUserId: "user_2",
              action: "added_product_to_bag",
              device: "desktop",
              _creationTime: now,
              data: { product: "product_1" },
            },
            {
              _id: "a3",
              storeFrontUserId: "user_3",
              action: "initiated_checkout",
              device: "tablet",
              _creationTime: now,
              data: { product: "product_2" },
            },
            {
              _id: "a4",
              storeFrontUserId: "user_3",
              action: "finalized_checkout",
              device: "mobile",
              _creationTime: now,
              data: { product: "product_2" },
            },
          ],
          [],
          [
            { action: "viewed_product", data: { product: "product_1" } },
            { action: "view_product", data: { product: "product_1" } },
            { action: "viewed_product", data: { product: "product_2" } },
          ],
        ],
      },
    });

    const enhanced = await h(mod.getEnhancedAnalytics)({ db } as never, {
      storeId: "store_1",
      startDate: now - 1000,
      endDate: now + 1000,
    });
    expect(enhanced).toEqual(
      expect.objectContaining({
        overview: {
          uniqueVisitors: 3,
          totalViews: 4,
          productViews: 1,
          cartActions: 1,
          checkoutActions: 1,
          purchaseActions: 1,
        },
        conversions: {
          viewToCartRate: 100,
          cartToCheckoutRate: 100,
          checkoutToPurchaseRate: 100,
          overallConversionRate: 100,
        },
        deviceBreakdown: {
          mobile: 2,
          desktop: 1,
          unknown: 1,
        },
      })
    );

    const enhancedNoViews = await h(mod.getEnhancedAnalytics)({ db } as never, {
      storeId: "store_1",
    });
    expect(enhancedNoViews.conversions).toEqual({
      viewToCartRate: 0,
      cartToCheckoutRate: 0,
      checkoutToPurchaseRate: 0,
      overallConversionRate: 0,
    });

    const topProducts = await h(mod.getTopProducts)({ db } as never, {
      storeId: "store_1",
      limit: 1,
    });
    expect(topProducts).toEqual([{ productId: "product_1", views: 2 }]);
  });

  it("computes visitor insights and store activity timelines", async () => {
    const mod = await loadModule();
    const now = Date.now();
    const { db } = createDbHarness({
      queryQueues: {
        "analytics:take": [
          [
            {
              _id: "a1",
              storeFrontUserId: "user_1",
              _creationTime: now - 100,
              action: "viewed_product",
              storeId: "store_1",
              data: { product: "product_1", productSku: "SKU-1" },
            },
            {
              _id: "a2",
              storeFrontUserId: "guest_1",
              _creationTime: now - 50,
              action: "opened_storefront",
              storeId: "store_1",
              data: {},
            },
          ],
          [
            {
              _id: "a3",
              storeFrontUserId: "user_1",
              _creationTime: now - 200,
              action: "viewed_product",
              storeId: "store_1",
              data: { product: "product_1", productSku: "SKU-1" },
            },
          ],
          [
            {
              _id: "a4",
              storeFrontUserId: "user_1",
              _creationTime: now - 200,
              action: "viewed_product",
              storeId: "store_1",
              data: { product: "product_1", productSku: "SKU-1" },
            },
          ],
          [],
        ],
        "analytics:first": [{ _id: "prior_user_1" }, null],
        "productSku:collect": [
          [
            {
              _id: "sku_1",
              productId: "product_1",
              sku: "SKU-1",
              images: ["https://cdn.example.com/sku-1.png"],
              price: 5000,
            },
          ],
          [],
          [],
        ],
      },
      records: {
        user_1: { _id: "user_1", email: "ada@example.com" },
        guest_1: { _id: "guest_1", email: "guest@example.com" },
        product_1: {
          _id: "product_1",
          name: "Body Wave",
          currency: "USD",
        },
      },
    });

    const visitorInsights = await h(mod.getVisitorInsights)({ db } as never, {
      storeId: "store_1",
      startDate: now - 1000,
      endDate: now,
    });
    expect(visitorInsights).toEqual(
      expect.objectContaining({
        totalVisitors: 2,
        returningVisitors: 1,
        newVisitors: 1,
        visitorsByHour: expect.any(Object),
      })
    );

    const timeline24h = await h(mod.getStoreActivityTimeline)({ db } as never, {
      storeId: "store_1",
      limit: 5,
      timeRange: "24h",
    });
    expect(timeline24h[0]).toEqual(
      expect.objectContaining({
        userData: { email: "ada@example.com" },
        productInfo: {
          name: "Body Wave",
          images: ["https://cdn.example.com/sku-1.png"],
          price: 5000,
          currency: "USD",
        },
      })
    );

    const timeline7d = await h(mod.getStoreActivityTimeline)({ db } as never, {
      storeId: "store_1",
      limit: 5,
      timeRange: "7d",
    });
    expect(timeline7d).toHaveLength(1);

    const timeline30d = await h(mod.getStoreActivityTimeline)({ db } as never, {
      storeId: "store_1",
      timeRange: "30d",
    });
    expect(timeline30d).toEqual([]);

    const timelineAll = await h(mod.getStoreActivityTimeline)({ db } as never, {
      storeId: "store_1",
      timeRange: "all",
    });
    expect(timelineAll).toEqual([]);
  });

  it("handles store activity fallback branches for user and product lookups", async () => {
    const { getStoreActivityTimeline } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "analytics:take": [
          [
            {
              _id: "a_missing",
              storeFrontUserId: "ghost_1",
              _creationTime: Date.now(),
              action: "viewed_product",
              storeId: "store_1",
              data: { product: "product_1", productSku: "SKU-1" },
            },
            {
              _id: "a_missing_2",
              storeFrontUserId: "ghost_2",
              _creationTime: Date.now(),
              action: "opened_storefront",
              storeId: "store_1",
              data: {},
            },
          ],
        ],
        "productSku:collect": [[]],
      },
    });

    const callCountById: Record<string, number> = {};
    db.get.mockImplementation(async (id: string) => {
      callCountById[id] = (callCountById[id] || 0) + 1;

      if (id === "ghost_1") {
        if (callCountById[id] === 1) {
          throw new Error("missing storefront user");
        }
        return { _id: "ghost_1", email: "guest@example.com" };
      }

      if (id === "ghost_2") {
        throw new Error("missing user");
      }

      if (id === "product_1") {
        throw new Error("missing product");
      }

      return null;
    });

    const result = await h(getStoreActivityTimeline)({ db } as never, {
      storeId: "store_1",
      timeRange: "24h",
    });

    expect(result[0]).toEqual(
      expect.objectContaining({
        userData: { email: "guest@example.com" },
        productInfo: undefined,
      })
    );
    expect(result[1]).toEqual(
      expect.objectContaining({
        userData: {},
      })
    );
  });

  it("covers top-products date filters and consolidated zero-state branches", async () => {
    const mod = await loadModule();
    const now = Date.now();
    const { db } = createDbHarness({
      queryQueues: {
        "analytics:take": [
          [
            { action: "viewed_product", data: { product: "product_1" } },
            { action: "view_product", data: { product: "product_2" } },
          ],
          [],
          [],
        ],
        "onlineOrder:take": [[{ _creationTime: now }], []],
      },
    });

    const topProductsWithDate = await h(mod.getTopProducts)({ db } as never, {
      storeId: "store_1",
      startDate: now - 1000,
      endDate: now + 1000,
    });
    expect(topProductsWithDate).toEqual([
      { productId: "product_1", views: 1 },
      { productId: "product_2", views: 1 },
    ]);

    const visitorInsightsEmpty = await h(mod.getVisitorInsights)(
      { db } as never,
      {
        storeId: "store_1",
      }
    );
    expect(visitorInsightsEmpty).toEqual({
      totalVisitors: 0,
      returningVisitors: 0,
      newVisitors: 0,
      peakHour: null,
      visitorsByHour: {},
    });

    const consolidatedWithUndefinedAmount =
      await h(mod.getConsolidatedAnalytics)({ db } as never, {
        storeId: "store_1",
      });
    expect(consolidatedWithUndefinedAmount).toEqual(
      expect.objectContaining({
        conversions: {
          viewToCartRate: 0,
          cartToCheckoutRate: 0,
          checkoutToPurchaseRate: 0,
          overallConversionRate: 0,
        },
        revenue: {
          totalRevenue: 0,
          totalOrders: 1,
          averageOrderValue: 0,
          revenueByDay: {
            "2026-03-15": 0,
          },
        },
        visitors: expect.objectContaining({
          peakHour: null,
        }),
      })
    );

    const consolidatedNoOrders = await h(mod.getConsolidatedAnalytics)(
      { db } as never,
      {
        storeId: "store_1",
      }
    );
    expect(consolidatedNoOrders.revenue).toEqual({
      totalRevenue: 0,
      totalOrders: 0,
      averageOrderValue: 0,
      revenueByDay: {},
    });
  });

  it("computes consolidated analytics dashboard payload", async () => {
    const mod = await loadModule();
    const now = Date.now();
    const { db } = createDbHarness({
      queryQueues: {
        "analytics:take": [
          [
            {
              _id: "a1",
              storeFrontUserId: "user_1",
              action: "viewed_product",
              device: "mobile",
              _creationTime: now,
              data: { product: "product_1" },
            },
            {
              _id: "a2",
              storeFrontUserId: "user_2",
              action: "added_product_to_bag",
              device: "desktop",
              _creationTime: now,
              data: { product: "product_1" },
            },
            {
              _id: "a3",
              storeFrontUserId: "user_2",
              action: "initiated_checkout",
              device: "tablet",
              _creationTime: now,
              data: { product: "product_2" },
            },
            {
              _id: "a4",
              storeFrontUserId: "user_2",
              action: "checkout_finalized",
              device: "mobile",
              _creationTime: now,
              data: { product: "product_2" },
            },
          ],
        ],
        "onlineOrder:take": [
          [
            { _id: "o1", amount: 1000, _creationTime: now },
            { _id: "o2", amount: 2000, _creationTime: now },
          ],
        ],
      },
    });

    const consolidated = await h(mod.getConsolidatedAnalytics)(
      { db } as never,
      {
        storeId: "store_1",
        startDate: now - 1000,
        endDate: now + 1000,
      }
    );

    expect(consolidated).toEqual(
      expect.objectContaining({
        overview: {
          uniqueVisitors: 2,
          totalViews: 4,
          productViews: 1,
          cartActions: 1,
          checkoutActions: 1,
          purchaseActions: 1,
        },
        conversions: {
          viewToCartRate: 100,
          cartToCheckoutRate: 100,
          checkoutToPurchaseRate: 100,
          overallConversionRate: 100,
        },
        deviceBreakdown: {
          mobile: 2,
          desktop: 1,
          unknown: 1,
        },
        revenue: {
          totalRevenue: 3000,
          totalOrders: 2,
          averageOrderValue: 1500,
          revenueByDay: {
            "2026-03-15": 3000,
          },
        },
        visitors: expect.objectContaining({
          totalVisitors: 2,
          newVisitors: 2,
          returningVisitors: 0,
        }),
        topProducts: [{ productId: "product_1", views: 1 }],
      })
    );
  });
});
