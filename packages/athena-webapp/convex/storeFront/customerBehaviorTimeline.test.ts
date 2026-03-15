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


function createDbHarness(queryQueues: Record<string, any[]> = {}) {
  const queueMap = new Map<string, any[]>(
    Object.entries(queryQueues).map(([key, value]) => [key, [...value]])
  );

  const take = (key: string) => {
    const queue = queueMap.get(key) || [];
    const value = queue.length > 0 ? queue.shift() : undefined;
    queueMap.set(key, queue);
    return value;
  };

  const filterOps = {
    field: vi.fn((name: string) => name),
    eq: vi.fn(() => true),
    gte: vi.fn(() => true),
    lte: vi.fn(() => true),
    and: vi.fn((...values: boolean[]) => values.every(Boolean)),
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
      chain.order = vi.fn(() => chain);
      chain.take = vi.fn(async () => take(`${table}:take`) ?? []);
      chain.collect = vi.fn(async () => take(`${table}:collect`) ?? []);
      return chain;
    }),
    get: vi.fn(async (_id: string): Promise<any> => null),
  };

  return { db };
}

async function loadModule() {
  vi.resetModules();

  vi.doMock("../_generated/server", () => ({
    query: wrapDefinition,
  }));

  return import("./customerBehaviorTimeline");
}

describe("customerBehaviorTimeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
  });

  it("returns enriched timeline data with user and product info", async () => {
    const { getCustomerBehaviorTimeline } = await loadModule();
    const { db } = createDbHarness({
      "analytics:take": [
        [
          {
            _id: "analytic_1",
            _creationTime: 1000,
            storeFrontUserId: "user_1",
            storeId: "store_1",
            action: "viewed_product",
            data: { product: "product_1", productSku: "SKU-1" },
          },
          {
            _id: "analytic_2",
            _creationTime: 900,
            storeFrontUserId: "user_1",
            storeId: "store_1",
            action: "opened_page",
            data: {},
          },
        ],
      ],
      "productSku:collect": [
        [
          {
            _id: "sku_1",
            productId: "product_1",
            sku: "SKU-1",
            price: 5500,
            images: ["https://cdn.example.com/sku-1.png"],
          },
        ],
      ],
    });

    db.get.mockImplementation(async (id: string) => {
      if (id === "user_1") {
        return { _id: "user_1", email: "ada@example.com" };
      }
      if (id === "product_1") {
        return {
          _id: "product_1",
          name: "Body Wave",
          currency: "USD",
        };
      }
      return null;
    });

    const result = await h(getCustomerBehaviorTimeline)({ db } as never, {
      userId: "user_1",
      limit: 5,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({
        userData: { email: "ada@example.com" },
        productInfo: {
          name: "Body Wave",
          images: ["https://cdn.example.com/sku-1.png"],
          price: 5500,
          currency: "USD",
        },
      })
    );
    expect(result[1]).toEqual(
      expect.objectContaining({
        userData: { email: "ada@example.com" },
        productInfo: undefined,
      })
    );
  });

  it("falls back to guest user lookup when storefront user lookup throws", async () => {
    const { getCustomerBehaviorTimeline } = await loadModule();
    const { db } = createDbHarness({
      "analytics:take": [[{ _id: "analytic_3", data: {}, action: "ping" }]],
      "productSku:collect": [[]],
    });

    db.get
      .mockRejectedValueOnce(new Error("not a storefront user"))
      .mockResolvedValueOnce({ _id: "guest_1", email: "guest@example.com" });

    const result = await h(getCustomerBehaviorTimeline)({ db } as never, {
      userId: "guest_1",
      timeRange: "24h",
    });

    expect(result[0].userData).toEqual({ email: "guest@example.com" });
  });

  it("supports 7d timeline filtering", async () => {
    const { getCustomerBehaviorTimeline } = await loadModule();
    const { db } = createDbHarness({
      "analytics:take": [[{ _id: "analytic_7d", action: "ping", data: {} }]],
      "productSku:collect": [[]],
    });

    db.get.mockResolvedValue({ _id: "user_1", email: "ada@example.com" });

    const result = await getCustomerBehaviorTimeline.handler({ db } as never, {
      userId: "user_1",
      timeRange: "7d",
    });

    expect(result).toHaveLength(1);
  });

  it("handles unknown users and product fetch failures", async () => {
    const { getCustomerBehaviorTimeline } = await loadModule();
    const { db } = createDbHarness({
      "analytics:take": [
        [
          {
            _id: "analytic_4",
            _creationTime: 500,
            storeFrontUserId: "ghost_1",
            storeId: "store_1",
            action: "viewed_product",
            data: { product: "missing_product", productSku: "SKU-X" },
          },
        ],
      ],
      "productSku:collect": [[{ productId: "another_product", sku: "SKU-Y" }]],
    });

    db.get
      .mockRejectedValueOnce(new Error("missing storefront user"))
      .mockRejectedValueOnce(new Error("missing guest"))
      .mockRejectedValueOnce(new Error("missing product"));

    const result = await h(getCustomerBehaviorTimeline)({ db } as never, {
      userId: "ghost_1",
      timeRange: "all",
    });

    expect(result[0]).toEqual(
      expect.objectContaining({
        userData: {},
        productInfo: undefined,
      })
    );
  });

  it("computes customer behavior summary metrics", async () => {
    const { getCustomerBehaviorSummary } = await loadModule();
    const { db } = createDbHarness({
      "analytics:take": [
        [
          {
            _id: "analytic_5",
            _creationTime: 2000,
            action: "viewed_product",
            device: "mobile",
            data: { product: "product_1" },
          },
          {
            _id: "analytic_6",
            _creationTime: 1500,
            action: "viewed_product",
            device: "desktop",
            data: { product: "product_2" },
          },
          {
            _id: "analytic_7",
            _creationTime: 1000,
            action: "added_product_to_bag",
            device: "tablet",
            data: { product: "product_2" },
          },
        ],
      ],
    });

    const result = await h(getCustomerBehaviorSummary)({ db } as never, {
      userId: "user_1",
      timeRange: "7d",
    });

    expect(result).toEqual({
      totalActions: 3,
      uniqueProducts: 2,
      mostCommonAction: "viewed_product",
      deviceBreakdown: {
        mobile: 1,
        desktop: 1,
      },
      lastActiveTime: 2000,
    });
  });

  it("returns empty summary defaults when no analytics exist", async () => {
    const { getCustomerBehaviorSummary } = await loadModule();
    const { db } = createDbHarness({
      "analytics:take": [[]],
    });

    const result = await h(getCustomerBehaviorSummary)({ db } as never, {
      userId: "user_1",
      timeRange: "all",
    });

    expect(result).toEqual({
      totalActions: 0,
      uniqueProducts: 0,
      mostCommonAction: undefined,
      deviceBreakdown: {
        mobile: 0,
        desktop: 0,
      },
      lastActiveTime: undefined,
    });
  });

  it("supports additional summary time ranges", async () => {
    const { getCustomerBehaviorSummary } = await loadModule();
    const firstHarness = createDbHarness({
      "analytics:take": [[{ _creationTime: 1, action: "viewed_product", data: {} }]],
    });
    const secondHarness = createDbHarness({
      "analytics:take": [[{ _creationTime: 2, action: "opened_storefront", data: {} }]],
    });

    const result24h = await getCustomerBehaviorSummary.handler(
      { db: firstHarness.db } as never,
      {
        userId: "user_1",
        timeRange: "24h",
      }
    );
    expect(result24h.totalActions).toBe(1);

    const result30d = await getCustomerBehaviorSummary.handler(
      { db: secondHarness.db } as never,
      {
        userId: "user_1",
      }
    );
    expect(result30d.totalActions).toBe(1);
  });
});
