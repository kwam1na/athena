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
    }),
  };

  return { db, recordMap };
}

async function loadModule() {
  vi.resetModules();

  vi.doMock("../_generated/server", () => ({
    internalMutation: wrapDefinition,
    mutation: wrapDefinition,
    query: wrapDefinition,
  }));

  vi.doMock("../_generated/api", () => ({
    api: {
      storeFront: {
        rewards: {
          getPastEligibleOrders: "rewards.getPastEligibleOrders",
        },
      },
    },
  }));

  return import("./rewards");
}

describe("storeFront rewards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
  });

  it("returns user points, tiers, and point history", async () => {
    const mod = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "rewardPoints:first": [{ _id: "rp_1", points: 250 }],
        "rewardTiers:collect": [{ _id: "tier_1", name: "Silver" }],
        "rewardTransactions:collect": [{ _id: "rt_1", points: 50 }],
      },
    });

    const points = await h(mod.getUserPoints)({ db } as never, {
      storeFrontUserId: "user_1",
      storeId: "store_1",
    });
    expect(points).toBe(250);

    const tiers = await h(mod.getTiers)({ db } as never, {
      storeId: "store_1",
    });
    expect(tiers).toEqual({ _id: "tier_1", name: "Silver" });

    const history = await h(mod.getPointHistory)({ db } as never, {
      storeFrontUserId: "user_1",
    });
    expect(history).toEqual({ _id: "rt_1", points: 50 });
  });

  it("returns zero points when no reward points record exists", async () => {
    const { getUserPoints } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "rewardPoints:first": [null],
      },
    });

    const points = await h(getUserPoints)({ db } as never, {
      storeFrontUserId: "user_1",
      storeId: "store_1",
    });
    expect(points).toBe(0);
  });

  it("awards order points for users and handles error branches", async () => {
    const { awardOrderPoints } = await loadModule();

    const missingOrderHarness = createDbHarness();
    const missingOrderResult = await h(awardOrderPoints)(
      { db: missingOrderHarness.db } as never,
      {
        orderId: "order_missing",
        points: 25,
      }
    );
    expect(missingOrderResult).toEqual({
      success: false,
      error: "Order not found",
    });

    const guestOrderHarness = createDbHarness({
      records: {
        order_guest: {
          _id: "order_guest",
          storeFrontUserId: "guest_1",
          storeId: "store_1",
        },
      },
    });
    const guestOrderResult = await h(awardOrderPoints)(
      { db: guestOrderHarness.db } as never,
      {
        orderId: "order_guest",
        points: 25,
      }
    );
    expect(guestOrderResult).toEqual({
      success: false,
      error: "Guest orders don't earn points",
    });

    const missingUserHarness = createDbHarness({
      records: {
        order_user: {
          _id: "order_user",
          storeFrontUserId: "user_1",
          storeId: "store_1",
          orderNumber: "WIG-1",
        },
      },
      queryQueues: {
        "storeFrontUser:first": [null],
      },
    });
    const missingUserResult = await h(awardOrderPoints)(
      { db: missingUserHarness.db } as never,
      {
        orderId: "order_user",
        points: 25,
      }
    );
    expect(missingUserResult).toEqual({
      success: false,
      error: "Guest orders don't earn points",
    });

    const queryErrorHarness = createDbHarness({
      records: {
        order_user_2: {
          _id: "order_user_2",
          storeFrontUserId: "user_2",
          storeId: "store_1",
          orderNumber: "WIG-2",
        },
      },
    });
    queryErrorHarness.db.query.mockImplementationOnce((table: string) => {
      if (table !== "storeFrontUser") {
        return {
          withIndex: vi.fn(() => this),
          filter: vi.fn(() => this),
          first: vi.fn(async () => null),
        } as never;
      }
      return {
        filter: vi.fn(() => ({
          first: vi.fn(async () => {
            throw new Error("db error");
          }),
        })),
      };
    });
    const queryErrorResult = await h(awardOrderPoints)(
      { db: queryErrorHarness.db } as never,
      {
        orderId: "order_user_2",
        points: 25,
      }
    );
    expect(queryErrorResult).toEqual({
      success: false,
      error: "Guest orders don't earn points",
    });

    const awardHarness = createDbHarness({
      records: {
        order_ok: {
          _id: "order_ok",
          storeFrontUserId: "user_3",
          storeId: "store_1",
          orderNumber: "WIG-3",
        },
      },
      queryQueues: {
        "storeFrontUser:first": [{ _id: "user_3", email: "ada@example.com" }],
        "rewardPoints:first": [{ _id: "rp_existing", points: 100 }],
      },
    });

    const awardResult = await h(awardOrderPoints)(
      { db: awardHarness.db } as never,
      {
        orderId: "order_ok",
        points: 25,
      }
    );
    expect(awardResult).toEqual({ success: true });
    expect(awardHarness.db.insert).toHaveBeenCalledWith(
      "rewardTransactions",
      expect.objectContaining({
        storeFrontUserId: "user_3",
        points: 25,
        reason: "order_placed",
      })
    );
    expect(awardHarness.db.patch).toHaveBeenCalledWith("rp_existing", {
      points: 125,
      updatedAt: Date.now(),
    });

    const createPointsHarness = createDbHarness({
      records: {
        order_new_points: {
          _id: "order_new_points",
          storeFrontUserId: "user_4",
          storeId: "store_1",
          orderNumber: "WIG-4",
        },
      },
      queryQueues: {
        "storeFrontUser:first": [{ _id: "user_4", email: "new@example.com" }],
        "rewardPoints:first": [null],
      },
    });

    const createPointsResult = await h(awardOrderPoints)(
      { db: createPointsHarness.db } as never,
      {
        orderId: "order_new_points",
        points: 40,
      }
    );
    expect(createPointsResult).toEqual({ success: true });
    expect(createPointsHarness.db.insert).toHaveBeenCalledWith(
      "rewardPoints",
      expect.objectContaining({
        storeFrontUserId: "user_4",
        points: 40,
      })
    );
  });

  it("redeems points with validation and success cases", async () => {
    const { redeemPoints } = await loadModule();

    const noPointsHarness = createDbHarness({
      queryQueues: {
        "rewardPoints:first": [null],
      },
    });
    const noPoints = await h(redeemPoints)({ db: noPointsHarness.db } as never, {
      storeFrontUserId: "user_1",
      storeId: "store_1",
      rewardTierId: "tier_1",
    });
    expect(noPoints).toEqual({ success: false, error: "No points available" });

    const noTierHarness = createDbHarness({
      queryQueues: {
        "rewardPoints:first": [{ _id: "rp_1", points: 100 }],
      },
    });
    const noTier = await h(redeemPoints)({ db: noTierHarness.db } as never, {
      storeFrontUserId: "user_1",
      storeId: "store_1",
      rewardTierId: "tier_missing",
    });
    expect(noTier).toEqual({ success: false, error: "Reward tier not found" });

    const notEnoughHarness = createDbHarness({
      queryQueues: {
        "rewardPoints:first": [{ _id: "rp_2", points: 50 }],
      },
      records: {
        tier_2: {
          _id: "tier_2",
          pointsRequired: 100,
          discountType: "percentage",
          discountValue: 10,
          name: "Silver",
        },
      },
    });
    const notEnough = await h(redeemPoints)(
      { db: notEnoughHarness.db } as never,
      {
        storeFrontUserId: "user_1",
        storeId: "store_1",
        rewardTierId: "tier_2",
      }
    );
    expect(notEnough).toEqual({ success: false, error: "Not enough points" });

    const successHarness = createDbHarness({
      queryQueues: {
        "rewardPoints:first": [{ _id: "rp_3", points: 200 }],
      },
      records: {
        tier_3: {
          _id: "tier_3",
          pointsRequired: 75,
          discountType: "fixed",
          discountValue: 500,
          name: "Gold",
        },
      },
    });

    const success = await h(redeemPoints)({ db: successHarness.db } as never, {
      storeFrontUserId: "user_1",
      storeId: "store_1",
      rewardTierId: "tier_3",
    });
    expect(success).toEqual({
      success: true,
      pointsUsed: 75,
      discount: {
        type: "fixed",
        value: 500,
        name: "Gold",
      },
    });
    expect(successHarness.db.patch).toHaveBeenCalledWith("rp_3", {
      points: 125,
      updatedAt: Date.now(),
    });
  });

  it("creates reward tiers", async () => {
    const { createRewardTier } = await loadModule();
    const { db } = createDbHarness();

    const result = await h(createRewardTier)({ db } as never, {
      storeId: "store_1",
      name: "Platinum",
      pointsRequired: 500,
      discountType: "percentage",
      discountValue: 20,
      isActive: true,
    });

    expect(result).toBe("rewardTiers_1");
  });

  it("returns past eligible guest orders", async () => {
    const { getPastEligibleOrders } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "onlineOrder:collect": [
          [
            {
              _id: "order_1",
              _creationTime: 1000,
              amount: 1234,
              storeId: "store_1",
              status: "completed",
              orderNumber: "WIG-101",
              hasVerifiedPayment: true,
            },
            {
              _id: "order_2",
              _creationTime: 900,
              amount: 2000,
              storeId: "store_1",
              status: "completed",
              orderNumber: "WIG-102",
              hasVerifiedPayment: true,
            },
          ],
        ],
        "rewardTransactions:first": [{ _id: "txn_existing" }, null],
      },
    });

    const result = await h(getPastEligibleOrders)({ db } as never, {
      storeFrontUserId: "user_1",
      email: "guest@example.com",
    });

    expect(result).toEqual([
      {
        _id: "order_2",
        _creationTime: 900,
        amount: 2000,
        storeId: "store_1",
        status: "completed",
        orderNumber: "WIG-102",
        hasVerifiedPayment: true,
        potentialPoints: 200,
      },
    ]);
  });

  it("awards points for a past order with update/create balance branches", async () => {
    const { awardPointsForPastOrder } = await loadModule();

    const missingHarness = createDbHarness();
    const missing = await h(awardPointsForPastOrder)(
      { db: missingHarness.db } as never,
      { storeFrontUserId: "user_1", orderId: "missing" }
    );
    expect(missing).toEqual({ success: false, error: "Order not found" });

    const duplicateHarness = createDbHarness({
      records: {
        order_dup: {
          _id: "order_dup",
          amount: 1000,
          storeId: "store_1",
          orderNumber: "WIG-11",
        },
      },
      queryQueues: {
        "rewardTransactions:first": [{ _id: "txn_dup" }],
      },
    });
    const duplicate = await h(awardPointsForPastOrder)(
      { db: duplicateHarness.db } as never,
      { storeFrontUserId: "user_1", orderId: "order_dup" }
    );
    expect(duplicate).toEqual({
      success: false,
      error: "Points already awarded for this order",
    });

    const updateHarness = createDbHarness({
      records: {
        order_update: {
          _id: "order_update",
          amount: 1500,
          storeId: "store_1",
          orderNumber: "WIG-12",
        },
      },
      queryQueues: {
        "rewardTransactions:first": [null],
        "rewardPoints:first": [{ _id: "rp_5", points: 40 }],
      },
    });
    const updated = await h(awardPointsForPastOrder)(
      { db: updateHarness.db } as never,
      { storeFrontUserId: "user_1", orderId: "order_update" }
    );
    expect(updated).toEqual({ success: true, points: 150 });
    expect(updateHarness.db.patch).toHaveBeenCalledWith("rp_5", {
      points: 190,
      updatedAt: Date.now(),
    });

    const createHarness = createDbHarness({
      records: {
        order_create: {
          _id: "order_create",
          amount: 900,
          storeId: "store_2",
          orderNumber: "WIG-13",
        },
      },
      queryQueues: {
        "rewardTransactions:first": [null],
        "rewardPoints:first": [null],
      },
    });
    const created = await h(awardPointsForPastOrder)(
      { db: createHarness.db } as never,
      { storeFrontUserId: "user_1", orderId: "order_create" }
    );
    expect(created).toEqual({ success: true, points: 90 });
    expect(createHarness.db.insert).toHaveBeenCalledWith(
      "rewardPoints",
      expect.objectContaining({
        storeFrontUserId: "user_1",
        storeId: "store_2",
        points: 90,
      })
    );
  });

  it("returns order points from transactions or order-derived fallback", async () => {
    const { getOrderPoints } = await loadModule();

    const withTxnHarness = createDbHarness({
      queryQueues: {
        "rewardTransactions:first": [{ _id: "txn_1", points: 70 }],
      },
    });
    const withTxn = await h(getOrderPoints)(
      { db: withTxnHarness.db } as never,
      { orderId: "order_1" }
    );
    expect(withTxn).toEqual({
      points: 70,
      transaction: { _id: "txn_1", points: 70 },
    });

    const missingOrderHarness = createDbHarness({
      queryQueues: {
        "rewardTransactions:first": [null],
      },
    });
    const missingOrder = await h(getOrderPoints)(
      { db: missingOrderHarness.db } as never,
      { orderId: "missing_order" }
    );
    expect(missingOrder).toEqual({ points: 0 });

    const fallbackHarness = createDbHarness({
      queryQueues: {
        "rewardTransactions:first": [null, null],
      },
      records: {
        order_verified: { _id: "order_verified", amount: 1200, hasVerifiedPayment: true },
        order_unverified: {
          _id: "order_unverified",
          amount: 1200,
          hasVerifiedPayment: false,
        },
      },
    });

    const verified = await h(getOrderPoints)(
      { db: fallbackHarness.db } as never,
      { orderId: "order_verified" }
    );
    expect(verified).toEqual({ points: 120 });

    const unverified = await h(getOrderPoints)(
      { db: fallbackHarness.db } as never,
      { orderId: "order_unverified" }
    );
    expect(unverified).toEqual({ points: 0 });
  });

  it("awards points for guest orders and aggregates store balances", async () => {
    const { awardPointsForGuestOrders } = await loadModule();

    const missingGuestHarness = createDbHarness();
    const missingGuest = await h(awardPointsForGuestOrders)(
      { db: missingGuestHarness.db, runQuery: vi.fn() } as never,
      { storeFrontUserId: "user_1", guestId: "guest_missing" }
    );
    expect(missingGuest).toEqual({
      success: false,
      error: "Guest not found or has no email",
    });

    const noOrdersHarness = createDbHarness({
      records: {
        guest_1: { _id: "guest_1", email: "guest@example.com" },
      },
    });
    const noOrders = await h(awardPointsForGuestOrders)(
      {
        db: noOrdersHarness.db,
        runQuery: vi.fn().mockResolvedValue([]),
      } as never,
      { storeFrontUserId: "user_1", guestId: "guest_1" }
    );
    expect(noOrders).toEqual({
      success: false,
      error: "No eligible orders found for this guest",
    });

    const successHarness = createDbHarness({
      records: {
        guest_2: { _id: "guest_2", email: "guest@example.com" },
      },
      queryQueues: {
        "rewardTransactions:first": [
          { _id: "txn_existing", points: 10 },
          null,
          null,
        ],
        "rewardPoints:first": [{ _id: "rp_7", points: 100 }, null],
      },
    });

    const success = await h(awardPointsForGuestOrders)(
      {
        db: successHarness.db,
        runQuery: vi.fn().mockResolvedValue([
          {
            _id: "order_a",
            storeId: "store_1",
            orderNumber: "WIG-201",
            potentialPoints: 40,
          },
          {
            _id: "order_b",
            storeId: "store_2",
            orderNumber: "WIG-202",
            potentialPoints: 25,
          },
          {
            _id: "order_c",
            storeId: "store_1",
            orderNumber: "WIG-203",
            potentialPoints: 5,
          },
        ]),
      } as never,
      { storeFrontUserId: "user_1", guestId: "guest_2" }
    );

    expect(success).toEqual({
      success: true,
      pointsAwarded: 70,
      ordersProcessed: 3,
    });
    expect(successHarness.db.patch).toHaveBeenCalledWith("txn_existing", {
      points: 50,
    });
    expect(successHarness.db.patch).toHaveBeenCalledWith("rp_7", {
      points: 145,
      updatedAt: Date.now(),
    });
    expect(successHarness.db.insert).toHaveBeenCalledWith(
      "rewardPoints",
      expect.objectContaining({
        storeFrontUserId: "user_1",
        storeId: "store_2",
        points: 25,
      })
    );
  });
});
