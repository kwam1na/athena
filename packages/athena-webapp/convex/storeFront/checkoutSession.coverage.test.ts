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
    neq: vi.fn(() => true),
    and: vi.fn((...values: boolean[]) => values.every(Boolean)),
    or: vi.fn((...values: boolean[]) => values.some(Boolean)),
    not: vi.fn(() => true),
    lt: vi.fn(() => true),
    lte: vi.fn(() => true),
    gt: vi.fn(() => true),
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
    delete: vi.fn(async (id: string) => {
      recordMap.delete(id);
    }),
  };

  return { db, recordMap };
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

describe("checkoutSession coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
    vi.stubGlobal("fetch", vi.fn());
  });

  it("handles unavailable sku records and complex existing-session item changes", async () => {
    const { create } = await loadModule();

    const unavailableHarness = createDbHarness({
      queryQueues: {
        "productSku:collect": [[]],
        "checkoutSession:first": [null],
      },
    });
    const unavailable = await h(create)(
      { db: unavailableHarness.db } as never,
      {
        storeId: "store_1",
        storeFrontUserId: "guest_1",
        bagId: "bag_1",
        amount: 10000,
        products: [
          {
            productId: "product_1",
            productSku: "SKU-MISSING",
            productSkuId: "sku_missing",
            quantity: 1,
            price: 10000,
          },
        ],
      }
    );
    expect(unavailable).toEqual({
      success: false,
      message: "Some products are unavailable or insufficient in stock.",
      unavailableProducts: [
        {
          productSkuId: "sku_missing",
          requested: 1,
          available: 0,
        },
      ],
    });

    const existingHarness = createDbHarness({
      queryQueues: {
        "productSku:collect": [
          [
            { _id: "sku_1", quantityAvailable: 10, inventoryCount: 20 },
            { _id: "sku_3", quantityAvailable: 4, inventoryCount: 20 },
          ],
        ],
        "checkoutSession:first": [
          {
            _id: "session_existing",
            bagId: "bag_1",
            storeFrontUserId: "guest_1",
            storeId: "store_1",
            amount: 10000,
            expiresAt: 1,
          },
        ],
        "checkoutSessionItem:collect": [
          [
            {
              _id: "item_1",
              sesionId: "session_existing",
              productSkuId: "sku_1",
              quantity: 2,
            },
            {
              _id: "item_2",
              sesionId: "session_existing",
              productSkuId: "sku_2",
              quantity: 1,
            },
          ],
          [
            {
              _id: "item_1",
              sesionId: "session_existing",
              productSkuId: "sku_1",
              quantity: 2,
            },
            {
              _id: "item_2",
              sesionId: "session_existing",
              productSkuId: "sku_2",
              quantity: 1,
            },
          ],
          [
            {
              _id: "item_1",
              sesionId: "session_existing",
              productSkuId: "sku_1",
              quantity: 3,
            },
            {
              _id: "checkoutSessionItem_1",
              sesionId: "session_existing",
              productSkuId: "sku_3",
              quantity: 1,
            },
          ],
        ],
      },
      records: {
        sku_1: { _id: "sku_1", quantityAvailable: 10 },
        sku_2: { _id: "sku_2", quantityAvailable: 5 },
        sku_3: { _id: "sku_3", quantityAvailable: 4 },
      },
    });

    const updated = await h(create)({ db: existingHarness.db } as never, {
      storeId: "store_1",
      storeFrontUserId: "guest_1",
      bagId: "bag_1",
      amount: 20000,
      products: [
        {
          productId: "product_1",
          productSku: "SKU-1",
          productSkuId: "sku_1",
          quantity: 3,
          price: 12000,
        },
        {
          productId: "product_3",
          productSku: "SKU-3",
          productSkuId: "sku_3",
          quantity: 1,
          price: 8000,
        },
      ],
    });

    expect(existingHarness.db.patch).toHaveBeenCalledWith("item_1", { quantity: 3 });
    expect(existingHarness.db.delete).toHaveBeenCalledWith("item_2");
    expect(existingHarness.db.insert).toHaveBeenCalledWith(
      "checkoutSessionItem",
      expect.objectContaining({
        productSkuId: "sku_3",
      })
    );
    expect(existingHarness.db.patch).toHaveBeenCalledWith("sku_1", {
      quantityAvailable: 9,
    });
    expect(existingHarness.db.patch).toHaveBeenCalledWith("sku_2", {
      quantityAvailable: 6,
    });
    expect(existingHarness.db.patch).toHaveBeenCalledWith("sku_3", {
      quantityAvailable: 3,
    });
    expect(updated).toEqual({
      success: true,
      session: expect.objectContaining({
        _id: "session_existing",
      }),
    });
  });

  it("covers release and active-session no-result branches", async () => {
    const mod = await loadModule();

    const noExpiredHarness = createDbHarness({
      queryQueues: {
        "checkoutSession:collect": [[]],
      },
    });
    await h(mod.releaseCheckoutItems)({ db: noExpiredHarness.db } as never, {});

    const missingSkuHarness = createDbHarness({
      queryQueues: {
        "checkoutSession:collect": [[{ _id: "session_expired", expiresAt: 1 }]],
        "checkoutSessionItem:collect": [
          [{ _id: "item_1", sesionId: "session_expired", productSkuId: "sku_missing", quantity: 2 }],
        ],
      },
    });
    await h(mod.releaseCheckoutItems)({ db: missingSkuHarness.db } as never, {});
    expect(missingSkuHarness.db.delete).toHaveBeenCalledWith("item_1");
    expect(missingSkuHarness.db.delete).toHaveBeenCalledWith("session_expired");

    const noActive = await h(mod.getActiveCheckoutSession)(
      { db: createDbHarness({ queryQueues: { "checkoutSession:first": [null] } }).db } as never,
      { storeFrontUserId: "guest_1" }
    );
    expect(noActive).toEqual({ message: "No active session found." });
  });

  it("covers cancelOrder invalid, failed refund, and missing paystack-key paths", async () => {
    const { cancelOrder } = await loadModule();
    const invalid = await h(cancelOrder)(
      {
        runQuery: vi.fn().mockResolvedValue(null),
        runMutation: vi.fn(),
      } as never,
      { id: "session_1" }
    );
    expect(invalid).toEqual({ success: false, message: "Invalid session." });

    vi.mocked(fetch).mockResolvedValue({
      status: 500,
    } as Response);
    const failedRefund = await h(cancelOrder)(
      {
        runQuery: vi.fn().mockResolvedValue({
          _id: "session_1",
          externalTransactionId: "txn_1",
        }),
        runMutation: vi.fn(),
      } as never,
      { id: "session_1" }
    );
    expect(failedRefund).toEqual({
      success: false,
      message: "Failed to cancel order.",
    });

    const { cancelOrder: cancelNoKey } = await loadModule("");
    await expect(
      h(cancelNoKey)(
        {
          runQuery: vi.fn().mockResolvedValue({
            _id: "session_1",
            externalTransactionId: "txn_1",
          }),
          runMutation: vi.fn(),
        } as never,
        { id: "session_1" }
      )
    ).rejects.toThrow("PAYSTACK_SECRET_KEY is not configured.");
  });

  it("covers updateCheckoutSession place-order, no-op, and error paths", async () => {
    const { updateCheckoutSession } = await loadModule();

    const missingSessionHarness = createDbHarness();
    missingSessionHarness.db.patch.mockImplementationOnce(async () => {});
    missingSessionHarness.db.get.mockResolvedValueOnce(null);
    const missingSession = await h(updateCheckoutSession)(
      {
        db: missingSessionHarness.db,
        runMutation: vi.fn(),
      } as never,
      {
        id: "session_missing",
      }
    );
    expect(missingSession).toEqual({
      success: false,
      message: "Invalid session.",
    });

    const duplicateHarness = createDbHarness({
      records: {
        session_dup: {
          _id: "session_dup",
          placedOrderId: "order_existing",
          hasCompletedPayment: true,
        },
      },
    });
    const duplicate = await h(updateCheckoutSession)(
      {
        db: duplicateHarness.db,
        runMutation: vi.fn(),
      } as never,
      {
        id: "session_dup",
        action: "place-order",
      }
    );
    expect(duplicate).toEqual({
      success: false,
      orderId: "order_existing",
      message: "Order has already been placed for this session.",
    });

    const failedCreateHarness = createDbHarness({
      records: {
        session_new: {
          _id: "session_new",
          bagId: "bag_1",
          placedOrderId: undefined,
          hasCompletedPayment: false,
        },
      },
    });
    const failedCreate = await h(updateCheckoutSession)(
      {
        db: failedCreateHarness.db,
        runMutation: vi.fn().mockResolvedValue({ success: false, error: "oops" }),
      } as never,
      {
        id: "session_new",
        action: "place-order",
        externalReference: "ref_1",
        externalTransactionId: "txn_1",
        amount: 12345,
      }
    );
    expect(failedCreate).toEqual({
      success: false,
      message: "Failed to create online order.",
    });

    const duplicateAfterPaymentHarness = createDbHarness({
      records: {
        session_paid_dup: {
          _id: "session_paid_dup",
          bagId: "bag_1",
          placedOrderId: "order_existing_paid",
          hasCompletedPayment: true,
        },
      },
    });
    const duplicateAfterPayment = await h(updateCheckoutSession)(
      {
        db: duplicateAfterPaymentHarness.db,
        runMutation: vi.fn(),
      } as never,
      {
        id: "session_paid_dup",
        orderDetails: baseOrderDetails(),
      }
    );
    expect(duplicateAfterPayment).toEqual({
      success: false,
      orderId: "order_existing_paid",
      message: "Order has already been placed for this session.",
    });

    const noOrderCreationHarness = createDbHarness({
      records: {
        session_noop: {
          _id: "session_noop",
          bagId: "bag_1",
          placedOrderId: undefined,
          hasCompletedPayment: false,
        },
      },
    });
    const noOrderCreation = await h(updateCheckoutSession)(
      {
        db: noOrderCreationHarness.db,
        runMutation: vi.fn(),
      } as never,
      {
        id: "session_noop",
        orderDetails: baseOrderDetails(),
        paymentMethod: { last4: "4242" },
        isFinalizingPayment: false,
      }
    );
    expect(noOrderCreation).toEqual({ success: true, orderId: undefined });

    const errorHarness = createDbHarness({
      records: {
        session_error: { _id: "session_error" },
      },
    });
    errorHarness.db.patch.mockRejectedValueOnce(new Error("patch failed"));
    const errored = await h(updateCheckoutSession)(
      {
        db: errorHarness.db,
        runMutation: vi.fn(),
      } as never,
      {
        id: "session_error",
      }
    );
    expect(errored).toEqual({ success: false });
  });

  it("covers checkout-session queries and by-id enrichment branches", async () => {
    const mod = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "checkoutSession:first": [{ _id: "session_1" }],
        "checkoutSession:collect": [[{ _id: "session_pending_1" }]],
        "checkoutSessionItem:collect": [
          [
            {
              _id: "session_item_1",
              sesionId: "session_with_items",
              productId: "product_1",
              productSkuId: "sku_1",
            },
          ],
        ],
      },
      records: {
        session_404: null,
        session_with_items: {
          _id: "session_with_items",
          storeFrontUserId: "user_1",
        },
        product_1: {
          _id: "product_1",
          name: "Body Wave",
          categoryId: "category_1",
        },
        sku_1: {
          _id: "sku_1",
          length: 24,
          price: 5500,
          color: "color_1",
          images: ["https://cdn.example.com/sku-1.png"],
        },
        color_1: { _id: "color_1", name: "Natural Black" },
        category_1: { _id: "category_1", name: "Hair" },
      },
    });

    const checkout = await h(mod.getCheckoutSession)({ db } as never, {
      storeFrontUserId: "user_1",
      externalReference: "ref_1",
      sessionId: "session_1",
    });
    expect(checkout).toEqual({ _id: "session_1" });

    const pending = await h(mod.getPendingCheckoutSessions)({ db } as never, {
      storeFrontUserId: "user_1",
    });
    expect(pending).toEqual([{ _id: "session_pending_1" }]);

    const missingById = await h(mod.getById)({ db } as never, {
      sessionId: "session_404",
    });
    expect(missingById).toBeNull();

    const byId = await h(mod.getById)({ db } as never, {
      sessionId: "session_with_items",
    });
    expect(byId).toEqual(
      expect.objectContaining({
        _id: "session_with_items",
        items: [
          expect.objectContaining({
            productName: "Body Wave",
            colorName: "Natural Black",
            productCategory: "Hair",
          }),
        ],
      })
    );
  });
});
