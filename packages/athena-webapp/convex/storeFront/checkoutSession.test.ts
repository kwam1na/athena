// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

function wrapDefinition<T extends { handler: (...args: any[]) => any }>(definition: T) {
  return Object.assign(
    (ctx: unknown, args: unknown) => definition.handler(ctx, args),
    definition
  );
}
function h(fn: any): (...args: any[]) => any {
  return fn.handler;
}


async function loadModule(paystackSecretKey = "secret") {
  vi.resetModules();

  vi.doMock("../_generated/server", () => ({
    action: wrapDefinition,
    internalMutation: wrapDefinition,
    mutation: wrapDefinition,
    query: wrapDefinition,
  }));

  vi.doMock("../_generated/api", () => ({
    api: {
      storeFront: {
        checkoutSession: {
          getById: "checkoutSession.getById",
        },
        onlineOrder: {
          create: "onlineOrder.create",
        },
        bag: {
          clearBag: "bag.clearBag",
        },
      },
    },
    internal: {
      storeFront: {
        checkoutSession: {
          updateCheckoutSession: "checkoutSession.updateCheckoutSession",
        },
      },
    },
  }));

  vi.doMock("../env", () => ({
    PAYSTACK_SECRET_KEY: paystackSecretKey,
  }));

  return import("./checkoutSession");
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
  let sessionInsertCount = 0;
  let itemInsertCount = 0;

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
      })),
      collect: vi.fn(async () => take(`${table}:collect`) || []),
      first: vi.fn(async () => take(`${table}:first`) || null),
    })),
    get: vi.fn(async (id: string) => recordMap.get(id) ?? null),
    insert: vi.fn(async (table: string, data: any) => {
      if (table === "checkoutSession") {
        sessionInsertCount += 1;
        const id = `session_${sessionInsertCount}`;
        recordMap.set(id, { _id: id, ...data });
        return id;
      }

      if (table === "checkoutSessionItem") {
        itemInsertCount += 1;
        const id = `checkoutSessionItem_${itemInsertCount}`;
        recordMap.set(id, { _id: id, ...data });
        return id;
      }

      const id = `${table}_${itemInsertCount++}`;
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

function baseOrderDetails() {
  return {
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
    deliveryInstructions: "Leave at door",
    deliveryFee: 10,
    pickupLocation: null,
  };
}

describe("checkoutSession backend flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("rejects checkout creation when requested quantities exceed availability", async () => {
    const { create } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "productSku:collect": [
          [
            {
              _id: "sku_1",
              quantityAvailable: 1,
              inventoryCount: 1,
            },
          ],
        ],
        "checkoutSession:first": [null],
      },
    });

    const result = await h(create)({ db } as never, {
      storeId: "store_1",
      storeFrontUserId: "guest_1",
      bagId: "bag_1",
      amount: 12500,
      products: [
        {
          productId: "product_1",
          productSku: "SKU-1",
          productSkuId: "sku_1",
          quantity: 2,
          price: 12500,
        },
      ],
    });

    expect(result).toEqual({
      success: false,
      message: "Some products are unavailable or insufficient in stock.",
      unavailableProducts: [
        {
          productSkuId: "sku_1",
          requested: 2,
          available: 1,
        },
      ],
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("creates a new checkout session, session items, and reserves inventory", async () => {
    const { create } = await loadModule();
    const { db, recordMap } = createDbHarness({
      queryQueues: {
        "productSku:collect": [
          [
            {
              _id: "sku_1",
              quantityAvailable: 5,
              inventoryCount: 10,
            },
          ],
        ],
        "checkoutSession:first": [null],
      },
      records: {
        sku_1: {
          _id: "sku_1",
          quantityAvailable: 5,
          inventoryCount: 10,
        },
      },
    });

    const result = await h(create)({ db } as never, {
      storeId: "store_1",
      storeFrontUserId: "guest_1",
      bagId: "bag_1",
      amount: 12500,
      products: [
        {
          productId: "product_1",
          productSku: "SKU-1",
          productSkuId: "sku_1",
          quantity: 2,
          price: 12500,
        },
      ],
    });

    expect(db.insert).toHaveBeenCalledWith(
      "checkoutSession",
      expect.objectContaining({
        amount: 12500,
        bagId: "bag_1",
        storeFrontUserId: "guest_1",
        storeId: "store_1",
        hasCompletedPayment: false,
      })
    );
    expect(db.insert).toHaveBeenCalledWith(
      "checkoutSessionItem",
      expect.objectContaining({
        sesionId: "session_1",
        productSkuId: "sku_1",
        quantity: 2,
      })
    );
    expect(db.patch).toHaveBeenCalledWith("sku_1", {
      quantityAvailable: 3,
    });
    expect(result).toEqual({
      success: true,
      session: expect.objectContaining({
        _id: "session_1",
        amount: 12500,
        items: [
          {
            productId: "product_1",
            productSku: "SKU-1",
            productSkuId: "sku_1",
            quantity: 2,
            price: 12500,
          },
        ],
      }),
    });
    expect(recordMap.get("session_1")).toEqual(
      expect.objectContaining({
        amount: 12500,
        bagId: "bag_1",
      })
    );
  });

  it("updates an existing active session and adjusts reserved inventory deltas", async () => {
    const { create } = await loadModule();
    const existingSession = {
      _id: "session_existing",
      bagId: "bag_1",
      storeFrontUserId: "guest_1",
      storeId: "store_1",
      amount: 10000,
      expiresAt: 1,
    };

    const { db } = createDbHarness({
      queryQueues: {
        "productSku:collect": [
          [
            {
              _id: "sku_1",
              quantityAvailable: 5,
              inventoryCount: 10,
            },
          ],
        ],
        "checkoutSession:first": [existingSession],
        "checkoutSessionItem:collect": [
          [
            {
              _id: "session_item_1",
              sesionId: "session_existing",
              productSkuId: "sku_1",
              quantity: 1,
            },
          ],
          [
            {
              _id: "session_item_1",
              sesionId: "session_existing",
              productSkuId: "sku_1",
              quantity: 1,
            },
          ],
          [
            {
              _id: "session_item_1",
              sesionId: "session_existing",
              productSkuId: "sku_1",
              quantity: 3,
            },
          ],
        ],
      },
      records: {
        sku_1: {
          _id: "sku_1",
          quantityAvailable: 5,
          inventoryCount: 10,
        },
      },
    });

    const result = await h(create)({ db } as never, {
      storeId: "store_1",
      storeFrontUserId: "guest_1",
      bagId: "bag_1",
      amount: 15000,
      products: [
        {
          productId: "product_1",
          productSku: "SKU-1",
          productSkuId: "sku_1",
          quantity: 3,
          price: 15000,
        },
      ],
    });

    expect(db.patch).toHaveBeenCalledWith(
      "session_existing",
      expect.objectContaining({ amount: 15000 })
    );
    expect(db.patch).toHaveBeenCalledWith("session_item_1", { quantity: 3 });
    expect(db.patch).toHaveBeenCalledWith("sku_1", { quantityAvailable: 3 });
    expect(result).toEqual({
      success: true,
      session: expect.objectContaining({
        _id: "session_existing",
        sessionItems: [
          expect.objectContaining({
            _id: "session_item_1",
            quantity: 3,
          }),
        ],
      }),
    });
  });

  it("releases inventory for expired sessions and deletes the hold records", async () => {
    const { releaseCheckoutItems } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "checkoutSession:collect": [
          [
            {
              _id: "session_expired",
              expiresAt: 1,
            },
          ],
        ],
        "checkoutSessionItem:collect": [
          [
            {
              _id: "item_1",
              sesionId: "session_expired",
              productSkuId: "sku_1",
              quantity: 2,
            },
            {
              _id: "item_2",
              sesionId: "session_expired",
              productSkuId: "sku_1",
              quantity: 1,
            },
          ],
        ],
      },
      records: {
        sku_1: {
          _id: "sku_1",
          quantityAvailable: 4,
        },
      },
    });

    await h(releaseCheckoutItems)({ db } as never, {});

    expect(db.patch).toHaveBeenCalledWith("sku_1", {
      quantityAvailable: 7,
    });
    expect(db.delete).toHaveBeenCalledWith("item_1");
    expect(db.delete).toHaveBeenCalledWith("item_2");
    expect(db.delete).toHaveBeenCalledWith("session_expired");
  });

  it("creates an online order from a paid session and clears the bag", async () => {
    const { updateCheckoutSession } = await loadModule();
    const { db } = createDbHarness({
      records: {
        session_1: {
          _id: "session_1",
          bagId: "bag_1",
          hasCompletedPayment: true,
          placedOrderId: undefined,
          paymentMethod: {
            last4: "4242",
          },
        },
      },
    });
    const ctx = {
      db,
      runMutation: vi
        .fn()
        .mockResolvedValueOnce({
          success: true,
          orderId: "order_1",
        })
        .mockResolvedValueOnce(undefined),
    };

    const result = await h(updateCheckoutSession)(ctx as never, {
      id: "session_1",
      hasCompletedPayment: true,
      orderDetails: baseOrderDetails(),
      paymentMethod: {
        last4: "4242",
      },
    });

    expect(db.patch).toHaveBeenNthCalledWith(
      1,
      "session_1",
      expect.objectContaining({
        hasCompletedPayment: true,
        paymentMethod: { last4: "4242" },
        billingDetails: expect.objectContaining({
          address: "123 Main St",
        }),
      })
    );
    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      1,
      "onlineOrder.create",
      expect.objectContaining({
        checkoutSessionId: "session_1",
        paymentMethod: { last4: "4242" },
      })
    );
    expect(db.patch).toHaveBeenNthCalledWith(2, "session_1", {
      placedOrderId: "order_1",
    });
    expect(ctx.runMutation).toHaveBeenNthCalledWith(2, "bag.clearBag", {
      id: "bag_1",
    });
    expect(result).toEqual({ success: true, orderId: "order_1" });
  });

  it("refunds and cancels an order when Paystack accepts the refund", async () => {
    const { cancelOrder } = await loadModule("secret");
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        _id: "session_1",
        externalTransactionId: "txn_123",
      }),
      runMutation: vi.fn(),
    };

    vi.mocked(fetch).mockResolvedValue({
      status: 200,
    } as Response);

    const result = await h(cancelOrder)(ctx as never, {
      id: "session_1",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.paystack.co/refund",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer secret" },
        body: JSON.stringify({ transaction: "txn_123" }),
      })
    );
    expect(ctx.runMutation).toHaveBeenCalledWith(
      "checkoutSession.updateCheckoutSession",
      {
        id: "session_1",
        isFinalizingPayment: false,
        isPaymentRefunded: true,
      }
    );
    expect(result).toEqual({
      success: true,
      message: "Order has been cancelled.",
    });
  });
});
