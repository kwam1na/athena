// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

function wrapDefinition<T extends { handler: (...args: any[]) => any }>(definition: T) {
  return Object.assign(
    (ctx: unknown, args: unknown) => definition.handler(ctx, args),
    definition
  );
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
        onlineOrderUtilFns: {
          sendOrderUpdateEmail: "sendOrderUpdateEmail",
        },
      },
    },
  }));

  return import("./onlineOrder");
}

function createDbHarness({
  queryQueues = {},
  records = {},
}: {
  queryQueues?: Record<string, any[]>;
  records?: Record<string, any>;
}) {
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
    query: vi.fn((table: string) => ({
      filter: vi.fn(() => ({
        collect: vi.fn(async () => take(`${table}:collect`) || []),
        first: vi.fn(async () => take(`${table}:first`) || null),
        order: vi.fn(() => ({
          collect: vi.fn(async () => take(`${table}:collect`) || []),
          first: vi.fn(async () => take(`${table}:first`) || null),
        })),
      })),
      order: vi.fn(() => ({
        collect: vi.fn(async () => take(`${table}:collect`) || []),
        first: vi.fn(async () => take(`${table}:first`) || null),
      })),
      collect: vi.fn(async () => take(`${table}:collect`) || []),
      first: vi.fn(async () => take(`${table}:first`) || null),
    })),
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
    pickupLocation: null,
    paymentMethod: {
      last4: "4242",
    },
  };
}

describe("onlineOrder backend flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.2);
  });

  it("creates an order and migrates checkout session items into online order items", async () => {
    const { create } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "checkoutSessionItem:collect": [
          [
            {
              _id: "checkout_item_1",
              productId: "product_1",
              productSkuId: "sku_1",
              productSku: "SKU-1",
              quantity: 2,
              storeFrontUserId: "guest_1",
              price: 5500,
            },
          ],
        ],
      },
      records: {
        session_1: {
          _id: "session_1",
          storeFrontUserId: "guest_1",
          storeId: "store_1",
          externalReference: "ref_123",
          externalTransactionId: "txn_123",
          bagId: "bag_1",
          amount: 11000,
          hasVerifiedPayment: true,
        },
      },
    });

    const result = await create.handler({ db } as never, orderArgs());

    expect(db.insert).toHaveBeenNthCalledWith(
      1,
      "onlineOrder",
      expect.objectContaining({
        checkoutSessionId: "session_1",
        storeId: "store_1",
        bagId: "bag_1",
        amount: 11000,
        status: "open",
        orderNumber: "464002",
      })
    );
    expect(db.insert).toHaveBeenNthCalledWith(
      2,
      "onlineOrderItem",
      expect.objectContaining({
        orderId: "onlineOrder_1",
        productSkuId: "sku_1",
        quantity: 2,
      })
    );
    expect(result).toEqual({
      success: true,
      orderId: "onlineOrder_1",
    });
  });

  it("updates an order status, stamps transitions, and schedules notification emails", async () => {
    const { update } = await loadModule();
    const { db } = createDbHarness({
      records: {
        order_1: {
          _id: "order_1",
          transitions: [{ status: "open", date: 1 }],
        },
      },
    });
    const scheduler = {
      runAfter: vi.fn(),
    };

    const result = await update.handler({ db, scheduler } as never, {
      orderId: "order_1",
      update: {
        status: "ready-for-pickup",
      },
    });

    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      "sendOrderUpdateEmail",
      {
        orderId: "order_1",
        newStatus: "ready-for-pickup",
      }
    );
    expect(db.patch).toHaveBeenCalledWith(
      "order_1",
      expect.objectContaining({
        status: "ready-for-pickup",
        readyAt: Date.now(),
        transitions: [
          { status: "open", date: 1 },
          { status: "ready-for-pickup", date: Date.now() },
        ],
      })
    );
    expect(result).toEqual({ success: true, message: "Order updated" });
  });

  it("records refund metadata when updating by external reference", async () => {
    const { update } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "onlineOrder:first": [
          {
            _id: "order_1",
            refunds: [{ id: "old_refund", amount: 100, date: 1 }],
            transitions: [{ status: "open", date: 1 }],
          },
        ],
      },
    });

    const result = await update.handler({ db } as never, {
      externalReference: "ref_123",
      update: {
        status: "refunded",
        refund_id: "refund_2",
        refund_amount: 500,
      },
    });

    expect(db.patch).toHaveBeenCalledWith(
      "order_1",
      expect.objectContaining({
        status: "refunded",
        refunds: [
          { id: "old_refund", amount: 100, date: 1 },
          { id: "refund_2", amount: 500, date: Date.now() },
        ],
        transitions: [
          { status: "open", date: 1 },
          { status: "refunded", date: Date.now() },
        ],
      })
    );
    expect(result).toBe(true);
  });

  it("returns selected order items to stock and marks them refunded/restocked", async () => {
    const { returnItemsToStock } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "onlineOrder:first": [
          {
            _id: "order_1",
          },
        ],
      },
      records: {
        item_1: {
          _id: "item_1",
          productSkuId: "sku_1",
          quantity: 2,
          isReady: true,
        },
        sku_1: {
          _id: "sku_1",
          quantityAvailable: 3,
          inventoryCount: 7,
        },
      },
    });

    const result = await returnItemsToStock.handler({ db } as never, {
      externalTransactionId: "txn_123",
      onlineOrderItemIds: ["item_1"],
    });

    expect(db.patch).toHaveBeenCalledWith("item_1", {
      isRefunded: true,
      isRestocked: true,
    });
    expect(db.patch).toHaveBeenCalledWith("sku_1", {
      quantityAvailable: 5,
      inventoryCount: 9,
    });
    expect(result).toBe(true);
  });

  it("updates all order items when transferring ownership", async () => {
    const { updateOwner } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "onlineOrder:collect": [
          [
            { _id: "order_1" },
            { _id: "order_2" },
          ],
        ],
        "onlineOrderItem:collect": [
          [{ _id: "item_1" }],
          [{ _id: "item_2" }],
        ],
      },
    });

    const result = await updateOwner.handler({ db } as never, {
      currentOwner: "guest_1",
      newOwner: "user_1",
    });

    expect(db.patch).toHaveBeenCalledWith("order_1", {
      storeFrontUserId: "user_1",
    });
    expect(db.patch).toHaveBeenCalledWith("order_2", {
      storeFrontUserId: "user_1",
    });
    expect(db.patch).toHaveBeenCalledWith("item_1", {
      storeFrontUserId: "user_1",
    });
    expect(db.patch).toHaveBeenCalledWith("item_2", {
      storeFrontUserId: "user_1",
    });
    expect(result).toBe(true);
  });
});
