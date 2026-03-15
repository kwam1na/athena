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

  const q = {
    field: vi.fn((name: string) => name),
    eq: vi.fn(() => true),
    and: vi.fn((...values: boolean[]) => values.every(Boolean)),
    or: vi.fn((...values: boolean[]) => values.some(Boolean)),
    gte: vi.fn(() => true),
  };

  const db = {
    query: vi.fn((table: string) => {
      const chain: any = {};
      chain.filter = vi.fn((callback?: (ops: typeof q) => unknown) => {
        if (callback) {
          callback(q);
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
      const id = `${table}_${++insertCount}`;
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
    mutation: wrapDefinition,
    query: wrapDefinition,
    internalMutation: wrapDefinition,
  }));

  vi.doMock("../_generated/api", () => ({
    api: {
      storeFront: {
        bag: {
          clearBag: "bag.clearBag",
        },
        onlineOrder: {
          returnAllItemsToStock: "onlineOrder.returnAllItemsToStock",
        },
        onlineOrderUtilFns: {
          sendOrderUpdateEmail: "sendOrderUpdateEmail",
        },
      },
    },
  }));

  return import("./onlineOrder");
}

function orderArgs() {
  return {
    checkoutSessionId: "session_1",
    billingDetails: {
      country: "US",
      address: "123 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
      billingAddressSameAsDelivery: true,
    },
    customerDetails: {
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      phoneNumber: "5555551234",
    },
    deliveryDetails: {
      country: "US",
      address: "123 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    },
    deliveryMethod: "delivery",
    deliveryOption: "standard",
    deliveryInstructions: "Leave it at the door",
    deliveryFee: 10,
    discount: null as any,
    pickupLocation: null as any,
    paymentMethod: {
      last4: "4242",
    },
  };
}

describe("onlineOrder coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.2);
  });

  it("covers create invalid-session and promo/discount branches", async () => {
    const { create } = await loadModule();

    const invalid = await create.handler(
      { db: createDbHarness().db } as never,
      orderArgs()
    );
    expect(invalid).toEqual({ success: false, error: "Invalid session" });

    const { db } = createDbHarness({
      queryQueues: {
        "checkoutSessionItem:collect": [
          [
            {
              _id: "item_1",
              productId: "product_1",
              quantity: 2,
              productSku: "SKU-1",
              productSkuId: "sku_1",
              storeFrontUserId: "guest_1",
              price: 5500,
            },
            {
              _id: "item_2",
              productId: "product_2",
              quantity: 1,
              productSku: "SKU-2",
              productSkuId: "sku_2",
              storeFrontUserId: "guest_1",
              price: 4500,
            },
          ],
        ],
        "promoCodeItem:first": [
          { _id: "promo_code_item_1", quantityClaimed: 1 },
          null,
        ],
        "offer:first": [{ _id: "offer_1" }],
      },
      records: {
        session_1: {
          _id: "session_1",
          storeFrontUserId: "guest_1",
          storeId: "store_1",
          externalReference: "ref_1",
          externalTransactionId: "txn_1",
          bagId: "bag_1",
          amount: 10000,
          hasVerifiedPayment: true,
        },
      },
    });

    const created = await create.handler({ db } as never, {
      ...orderArgs(),
      discount: { id: "promo_1", isMultipleUses: false },
    });

    expect(db.patch).toHaveBeenCalledWith("promo_code_item_1", {
      quantityClaimed: 3,
    });
    expect(db.insert).toHaveBeenCalledWith("redeemedPromoCode", {
      promoCodeId: "promo_1",
      storeFrontUserId: "guest_1",
    });
    expect(db.patch).toHaveBeenCalledWith("offer_1", {
      isRedeemed: true,
      status: "redeemed",
    });
    expect(created).toEqual({ success: true, orderId: "onlineOrder_1" });
  });

  it("covers createFromSession invalid and success paths", async () => {
    const { createFromSession } = await loadModule();

    const invalid = await createFromSession.handler(
      { db: createDbHarness().db, runMutation: vi.fn() } as never,
      {
        checkoutSessionId: "missing",
        externalTransactionId: "txn_missing",
      }
    );
    expect(invalid).toEqual({ success: false, error: "Invalid session" });

    const { db } = createDbHarness({
      queryQueues: {
        "checkoutSessionItem:collect": [
          [
            {
              _id: "item_1",
              productId: "product_1",
              quantity: 2,
              productSku: "SKU-1",
              productSkuId: "sku_1",
              storeFrontUserId: "guest_2",
              price: 5500,
            },
          ],
        ],
        "promoCodeItem:first": [{ _id: "promo_item_1", quantityClaimed: 0 }],
        "offer:first": [{ _id: "offer_2" }],
      },
      records: {
        session_2: {
          _id: "session_2",
          storeFrontUserId: "guest_2",
          storeId: "store_1",
          externalReference: "ref_2",
          bagId: "bag_2",
          amount: 5500,
          billingDetails: orderArgs().billingDetails,
          customerDetails: orderArgs().customerDetails,
          deliveryDetails: orderArgs().deliveryDetails,
          deliveryInstructions: "Ring bell",
          deliveryMethod: "pickup",
          deliveryOption: null,
          deliveryFee: null,
          discount: { id: "promo_2", isMultipleUses: false },
          pickupLocation: "main-store",
          hasVerifiedPayment: true,
        },
      },
    });
    const runMutation = vi.fn();

    const result = await createFromSession.handler(
      { db, runMutation } as never,
      {
        checkoutSessionId: "session_2",
        externalTransactionId: "txn_2",
        paymentMethod: { last4: "1234" },
      }
    );

    expect(db.patch).toHaveBeenCalledWith("session_2", {
      placedOrderId: "onlineOrder_1",
    });
    expect(runMutation).toHaveBeenCalledWith("bag.clearBag", {
      id: "bag_2",
    });
    expect(result).toEqual({ success: true, orderId: "onlineOrder_1" });
  });

  it("covers getAll and get enrichment flows", async () => {
    const mod = await loadModule();

    const getAllHarness = createDbHarness({
      queryQueues: {
        "onlineOrder:collect": [
          [{ _id: "order_1", storeFrontUserId: "guest_1", amount: 10000 }],
        ],
        "onlineOrderItem:collect": [
          [
            {
              _id: "order_item_1",
              orderId: "order_1",
              productId: "product_1",
              productSkuId: "sku_1",
            },
          ],
        ],
      },
      records: {
        product_1: { _id: "product_1", name: "Body Wave" },
        sku_1: { _id: "sku_1", images: ["https://img.example/sku.png"] },
      },
    });

    const allOrders = await mod.getAll.handler({ db: getAllHarness.db } as never, {
      storeFrontUserId: "guest_1",
    });
    expect(allOrders[0].items[0]).toEqual(
      expect.objectContaining({
        productName: "Body Wave",
        productImage: "https://img.example/sku.png",
      })
    );

    const missingOrder = await mod.get.handler(
      {
        db: createDbHarness({
          queryQueues: { "onlineOrder:first": [null] },
        }).db,
      } as never,
      { identifier: "order_missing" }
    );
    expect(missingOrder).toBeNull();

    const getHarness = createDbHarness({
      queryQueues: {
        "onlineOrder:first": [
          {
            _id: "order_2",
            orderNumber: "WIG-1002",
            amount: 9000,
          },
        ],
        "onlineOrderItem:collect": [
          [
            {
              _id: "order_item_2",
              orderId: "order_2",
              productId: "product_2",
              productSkuId: "sku_2",
            },
            {
              _id: "order_item_3",
              orderId: "order_2",
              productId: "product_3",
              productSkuId: "sku_3",
            },
          ],
        ],
      },
      records: {
        product_2: { _id: "product_2", name: "Closure", categoryId: "cat_1" },
        product_3: { _id: "product_3", name: "Frontal", categoryId: "cat_1" },
        sku_2: {
          _id: "sku_2",
          images: ["https://img.example/sku-2.png"],
          length: 18,
          color: "color_1",
          quantityAvailable: 1,
          inventoryCount: 2,
        },
        sku_3: {
          _id: "sku_3",
          images: ["https://img.example/sku-3.png"],
          length: 20,
          color: "color_1",
          quantityAvailable: 5,
          inventoryCount: 1,
        },
        color_1: { _id: "color_1", name: "Natural Black" },
        cat_1: { _id: "cat_1", name: "Hair" },
      },
    });

    const order = await mod.get.handler({ db: getHarness.db } as never, {
      identifier: "order_2",
    });
    expect(order).toEqual(
      expect.objectContaining({
        _id: "order_2",
        items: expect.arrayContaining([
          expect.objectContaining({
            productName: "Closure",
            productCategory: "Hair",
            colorName: "Natural Black",
            currentQuantityAvailable: 1,
            currentInventoryCount: 2,
            isOutOfStock: false,
            isLowStock: true,
          }),
        ]),
      })
    );
  });

  it("covers order query helper handlers", async () => {
    const mod = await loadModule();

    const byExternal = await mod.getByExternalReference.handler(
      {
        db: createDbHarness({
          queryQueues: { "onlineOrder:first": [{ _id: "order_ext" }] },
        }).db,
      } as never,
      { externalReference: "ref_1" }
    );
    expect(byExternal).toEqual({ _id: "order_ext" });

    const bySession = await mod.getByCheckoutSessionId.handler(
      {
        db: createDbHarness({
          queryQueues: { "onlineOrder:first": [{ _id: "order_session" }] },
        }).db,
      } as never,
      { checkoutSessionId: "session_1" }
    );
    expect(bySession).toEqual({ _id: "order_session" });

    const getAllByStore = createDbHarness({
      queryQueues: {
        "onlineOrder:collect": [[{ _id: "order_3", storeId: "store_1" }]],
        "onlineOrderItem:collect": [[{ _id: "item_3", orderId: "order_3" }]],
      },
    });
    const ordersForStore = await mod.getAllOnlineOrders.handler(
      { db: getAllByStore.db } as never,
      { storeId: "store_1" }
    );
    expect(ordersForStore).toEqual([
      expect.objectContaining({
        _id: "order_3",
        items: [{ _id: "item_3", orderId: "order_3" }],
      }),
    ]);

    const byStoreFrontUser = await mod.getAllOnlineOrdersByStoreFrontUserId.handler(
      {
        db: createDbHarness({
          queryQueues: {
            "onlineOrder:collect": [[{ _id: "order_4", storeFrontUserId: "guest_1" }]],
          },
        }).db,
      } as never,
      { storeFrontUserId: "guest_1" }
    );
    expect(byStoreFrontUser).toEqual([{ _id: "order_4", storeFrontUserId: "guest_1" }]);

    const newestOrder = await mod.newOrder.handler(
      {
        db: createDbHarness({
          queryQueues: { "onlineOrder:first": [{ _id: "order_latest" }] },
        }).db,
      } as never,
      { storeId: "store_1" }
    );
    expect(newestOrder).toEqual({ _id: "order_latest" });

    const orderItems = await mod.getOrderItems.handler(
      {
        db: createDbHarness({
          queryQueues: {
            "onlineOrderItem:collect": [[{ _id: "item_latest", orderId: "order_latest" }]],
          },
        }).db,
      } as never,
      { orderId: "order_latest" }
    );
    expect(orderItems).toEqual([{ _id: "item_latest", orderId: "order_latest" }]);
  });

  it("covers update mutation branches for orderId and externalReference", async () => {
    const { update } = await loadModule();

    const notFound = await update.handler(
      {
        db: createDbHarness().db,
        runMutation: vi.fn(),
        scheduler: { runAfter: vi.fn() },
      } as never,
      {
        orderId: "missing_order",
        update: { status: "cancelled" },
      }
    );
    expect(notFound).toEqual({ success: false, message: "Order not found" });

    const orderHarness = createDbHarness({
      records: {
        order_1: {
          _id: "order_1",
          paymentCollected: false,
          transitions: [{ status: "open", date: 1 }],
        },
      },
    });
    const scheduler = { runAfter: vi.fn() };
    const runMutation = vi.fn();

    const cancelled = await update.handler(
      {
        db: orderHarness.db,
        runMutation,
        scheduler,
      } as never,
      {
        orderId: "order_1",
        update: { status: "cancelled" },
      }
    );
    expect(runMutation).toHaveBeenCalledWith("onlineOrder.returnAllItemsToStock", {
      orderId: "order_1",
    });
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      "sendOrderUpdateEmail",
      expect.objectContaining({ orderId: "order_1", newStatus: "cancelled" })
    );
    expect(cancelled).toEqual({ success: true, message: "Order updated" });

    const completedHarness = createDbHarness({
      records: {
        order_2: {
          _id: "order_2",
          paymentCollected: false,
          transitions: [],
        },
      },
    });
    const completed = await update.handler(
      {
        db: completedHarness.db,
        runMutation: vi.fn(),
        scheduler: { runAfter: vi.fn() },
      } as never,
      {
        orderId: "order_2",
        update: {
          status: "delivered",
          paymentCollected: true,
        },
        signedInAthenaUser: { id: "athena_1", email: "ops@example.com" },
      }
    );
    expect(completedHarness.db.patch).toHaveBeenCalledWith(
      "order_2",
      expect.objectContaining({
        status: "delivered",
        paymentCollected: true,
        completedAt: Date.now(),
        transitions: expect.arrayContaining([
          expect.objectContaining({ status: "delivered" }),
          expect.objectContaining({ status: "payment_collected" }),
        ]),
      })
    );
    expect(completed).toEqual({ success: true, message: "Order updated" });

    const noExternalOrder = await update.handler(
      {
        db: createDbHarness({
          queryQueues: { "onlineOrder:first": [null] },
        }).db,
        runMutation: vi.fn(),
        scheduler: { runAfter: vi.fn() },
      } as never,
      {
        externalReference: "missing_ref",
        update: { status: "cancelled" },
      }
    );
    expect(noExternalOrder).toBe(false);

    const externalWithStatusHarness = createDbHarness({
      queryQueues: {
        "onlineOrder:first": [
          {
            _id: "order_ext_1",
            refunds: [{ id: "old", amount: 100, date: 1 }],
            transitions: [{ status: "open", date: 1 }],
          },
        ],
      },
    });
    const externalRunMutation = vi.fn();
    const externalWithStatus = await update.handler(
      {
        db: externalWithStatusHarness.db,
        runMutation: externalRunMutation,
        scheduler: { runAfter: vi.fn() },
      } as never,
      {
        externalReference: "ref_1",
        update: {
          status: "cancelled",
          refund_id: "refund_1",
          refund_amount: 800,
        },
      }
    );
    expect(externalRunMutation).toHaveBeenCalledWith(
      "onlineOrder.returnAllItemsToStock",
      { orderId: "order_ext_1" }
    );
    expect(externalWithStatus).toBe(true);

    const externalWithoutStatusHarness = createDbHarness({
      queryQueues: {
        "onlineOrder:first": [
          {
            _id: "order_ext_2",
            refunds: [{ id: "existing_refund", amount: 200, date: 2 }],
          },
        ],
      },
    });
    const externalWithoutStatus = await update.handler(
      {
        db: externalWithoutStatusHarness.db,
        runMutation: vi.fn(),
        scheduler: { runAfter: vi.fn() },
      } as never,
      {
        externalReference: "ref_2",
        update: {
          externalTransactionId: "txn_2",
        },
      }
    );
    expect(externalWithoutStatusHarness.db.patch).toHaveBeenCalledWith(
      "order_ext_2",
      expect.objectContaining({
        externalTransactionId: "txn_2",
        refunds: [{ id: "existing_refund", amount: 200, date: 2 }],
      })
    );
    expect(externalWithoutStatus).toBe(true);
  });

  it("covers return-to-stock and item update mutations", async () => {
    const { returnItemsToStock, updateOrderItems, returnAllItemsToStock } =
      await loadModule();

    const noOrder = await returnItemsToStock.handler(
      {
        db: createDbHarness({
          queryQueues: { "onlineOrder:first": [null] },
        }).db,
      } as never,
      {
        externalTransactionId: "txn_missing",
      }
    );
    expect(noOrder).toBe(false);

    const selectedItemsHarness = createDbHarness({
      queryQueues: {
        "onlineOrder:first": [{ _id: "order_10" }],
      },
      records: {
        item_1: {
          _id: "item_1",
          productSkuId: "sku_1",
          quantity: 2,
          isReady: false,
        },
        sku_1: {
          _id: "sku_1",
          quantityAvailable: 5,
          inventoryCount: 9,
        },
      },
    });
    const selectedItems = await returnItemsToStock.handler(
      { db: selectedItemsHarness.db } as never,
      {
        externalTransactionId: "txn_1",
        onlineOrderItemIds: ["item_1"],
      }
    );
    expect(selectedItemsHarness.db.patch).toHaveBeenCalledWith("sku_1", {
      quantityAvailable: 7,
      inventoryCount: 9,
    });
    expect(selectedItems).toBe(true);

    const allItemsHarness = createDbHarness({
      queryQueues: {
        "onlineOrder:first": [{ _id: "order_11" }],
        "onlineOrderItem:collect": [
          [
            {
              _id: "item_2",
              orderId: "order_11",
              productSkuId: "sku_2",
              quantity: 1,
              isReady: true,
            },
            {
              _id: "item_3",
              orderId: "order_11",
              productSkuId: "sku_3",
              quantity: 2,
              isReady: false,
            },
          ],
        ],
      },
      records: {
        sku_2: { _id: "sku_2", quantityAvailable: 3, inventoryCount: 4 },
        sku_3: { _id: "sku_3", quantityAvailable: 6, inventoryCount: 8 },
      },
    });
    const allItems = await returnItemsToStock.handler(
      { db: allItemsHarness.db } as never,
      {
        externalTransactionId: "txn_2",
      }
    );
    expect(allItemsHarness.db.patch).toHaveBeenCalledWith("sku_2", {
      quantityAvailable: 4,
      inventoryCount: 5,
    });
    expect(allItemsHarness.db.patch).toHaveBeenCalledWith("sku_3", {
      quantityAvailable: 8,
      inventoryCount: 8,
    });
    expect(allItems).toBe(true);

    const updatedItems = await updateOrderItems.handler(
      { db: createDbHarness().db } as never,
      {
        orderItemIds: ["item_4", "item_5"],
        updates: { isReady: true },
      }
    );
    expect(updatedItems).toBe(true);

    const restockHarness = createDbHarness({
      queryQueues: {
        "onlineOrderItem:collect": [
          [
            {
              _id: "item_6",
              orderId: "order_12",
              productSkuId: "sku_6",
              quantity: 1,
              isReady: false,
              isRestocked: true,
            },
            {
              _id: "item_7",
              orderId: "order_12",
              productSkuId: "sku_7",
              quantity: 3,
              isReady: true,
              isRestocked: false,
            },
            {
              _id: "item_8",
              orderId: "order_12",
              productSkuId: "sku_8",
              quantity: 2,
              isReady: false,
              isRestocked: false,
            },
          ],
        ],
      },
      records: {
        sku_7: { _id: "sku_7", quantityAvailable: 2, inventoryCount: 5 },
        sku_8: { _id: "sku_8", quantityAvailable: 4, inventoryCount: 6 },
      },
    });

    const restocked = await returnAllItemsToStock.handler(
      { db: restockHarness.db } as never,
      { orderId: "order_12" }
    );
    expect(restockHarness.db.patch).toHaveBeenCalledWith("item_7", {
      isRefunded: true,
      isRestocked: true,
    });
    expect(restockHarness.db.patch).toHaveBeenCalledWith("sku_7", {
      quantityAvailable: 5,
      inventoryCount: 8,
    });
    expect(restockHarness.db.patch).toHaveBeenCalledWith("sku_8", {
      quantityAvailable: 6,
      inventoryCount: 6,
    });
    expect(restocked).toBe(true);
  });

  it("covers duplicate detection and order metrics for all time ranges", async () => {
    const { isDuplicateOrder, getOrderMetrics } = await loadModule();

    const missingDuplicateCheck = await isDuplicateOrder.handler(
      { db: createDbHarness().db } as never,
      { id: "missing_order" }
    );
    expect(missingDuplicateCheck).toBe(false);

    const duplicateHarness = createDbHarness({
      records: {
        order_dup: { _id: "order_dup", externalReference: "ext_dup" },
      },
      queryQueues: {
        "onlineOrder:collect": [[{ _id: "order_dup" }, { _id: "order_dup_2" }]],
      },
    });
    const duplicateCheck = await isDuplicateOrder.handler(
      { db: duplicateHarness.db } as never,
      { id: "order_dup" }
    );
    expect(duplicateCheck).toBe(true);

    const runMetrics = async (timeRange: "day" | "week" | "month" | "all") => {
      const metricsHarness = createDbHarness({
        queryQueues: {
          "onlineOrder:collect": [
            [
              {
                _id: `order_${timeRange}_1`,
                storeId: "store_1",
                status: "open",
                amount: 10000,
                discount: null,
                deliveryFee: 5,
              },
              {
                _id: `order_${timeRange}_2`,
                storeId: "store_1",
                status: "cancelled",
                amount: 20000,
                discount: null,
                deliveryFee: 0,
              },
            ],
          ],
          "onlineOrderItem:collect": [
            [
              {
                _id: `item_${timeRange}_1`,
                orderId: `order_${timeRange}_1`,
                productSkuId: "sku_metric",
                quantity: 1,
                price: 10000,
              },
            ],
          ],
        },
      });

      return getOrderMetrics.handler({ db: metricsHarness.db } as never, {
        storeId: "store_1",
        timeRange,
      });
    };

    await expect(runMetrics("day")).resolves.toEqual({
      totalOrders: 1,
      grossSales: 10000,
      totalDiscounts: 0,
      netRevenue: 10500,
    });
    await expect(runMetrics("week")).resolves.toEqual({
      totalOrders: 1,
      grossSales: 10000,
      totalDiscounts: 0,
      netRevenue: 10500,
    });
    await expect(runMetrics("month")).resolves.toEqual({
      totalOrders: 1,
      grossSales: 10000,
      totalDiscounts: 0,
      netRevenue: 10500,
    });
    await expect(runMetrics("all")).resolves.toEqual({
      totalOrders: 1,
      grossSales: 10000,
      totalDiscounts: 0,
      netRevenue: 10500,
    });
  });
});
