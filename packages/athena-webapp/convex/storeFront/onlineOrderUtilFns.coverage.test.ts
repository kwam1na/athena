// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendOrderEmail } = vi.hoisted(() => ({
  sendOrderEmail: vi.fn(),
}));

function createOrder(overrides: Record<string, unknown> = {}) {
  return {
    _id: "order_123",
    _creationTime: Date.UTC(2026, 2, 13, 12, 0, 0),
    amount: 12500,
    orderNumber: "WIG-1001",
    deliveryMethod: "pickup",
    customerDetails: {
      firstName: "ada",
      email: "ada@example.com",
    },
    deliveryDetails: {
      country: "US",
      address: "123 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    },
    items: [
      {
        productName: "Body Wave",
        productImage: "https://cdn.example.com/body-wave.png",
        price: 5500,
        quantity: 2,
        colorName: "Natural Black",
        length: 24,
        productSkuId: "sku_1",
      },
    ],
    didSendReadyEmail: false,
    didSendCompletedEmail: false,
    didSendCancelledEmail: false,
    ...overrides,
  };
}

function createStore(overrides: Record<string, unknown> = {}) {
  return {
    _id: "store_1",
    currency: "USD",
    config: {
      contactInfo: {
        location: "123 Pickup Lane",
      },
    },
    ...overrides,
  };
}

async function loadModule() {
  vi.resetModules();

  vi.doMock("../mailersend", () => ({
    sendOrderEmail,
  }));

  vi.doMock("../_generated/server", () => ({
    action: (definition: unknown) => definition,
  }));

  vi.doMock("../_generated/api", () => ({
    api: {
      storeFront: {
        onlineOrder: {
          get: "getOrder",
          update: "updateOrder",
        },
      },
      inventory: {
        stores: {
          findById: "findStoreById",
        },
      },
    },
  }));

  return import("./onlineOrderUtilFns");
}

describe("onlineOrderUtilFns coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("formats order items with discount and free pricing branches", async () => {
    const mod = await loadModule();

    const formatted = mod.formatOrderItems(
      [
        {
          productName: "Body Wave",
          productImage: "img1",
          price: 5000,
          quantity: 2,
          colorName: "Natural Black",
          length: 24,
          productSkuId: "sku_1",
        },
        {
          productName: "Gift",
          productImage: "img2",
          price: 0,
          quantity: 1,
          productSkuId: "sku_2",
        },
      ],
      "USD",
      {
        span: "selected-products",
        productSkus: ["sku_1"],
        discountType: "percentage",
        discountValue: 10,
      }
    );

    expect(formatted[0]).toEqual(
      expect.objectContaining({
        text: "Body Wave",
        price: "$5,000",
        discountedPrice: "$4,500",
        savings: "$1,000",
        length: "24 inches",
      })
    );
    expect(formatted[1]).toEqual(
      expect.objectContaining({
        text: "Gift",
        price: "Free",
        discountedPrice: undefined,
        savings: undefined,
      })
    );
  });

  it("covers status update paths for ready/completed/cancelled and failed sends", async () => {
    const mod = await loadModule();

    sendOrderEmail.mockResolvedValueOnce({ ok: true });
    const ready = await mod.handleOrderStatusUpdate({
      order: createOrder(),
      newStatus: "ready-for-pickup",
      store: createStore(),
    });
    expect(ready).toEqual({ didSendReadyEmail: true });

    sendOrderEmail.mockResolvedValueOnce({ ok: true });
    const completed = await mod.handleOrderStatusUpdate({
      order: createOrder(),
      newStatus: "picked-up",
      store: createStore(),
    });
    expect(completed).toEqual({ didSendCompletedEmail: true });

    sendOrderEmail.mockResolvedValueOnce({ ok: true });
    const cancelled = await mod.handleOrderStatusUpdate({
      order: createOrder(),
      newStatus: "cancelled",
      store: createStore(),
    });
    expect(cancelled).toEqual({ didSendCancelledEmail: true });

    sendOrderEmail.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "mailer-failed" }),
    });
    const failed = await mod.handleOrderStatusUpdate({
      order: createOrder({ deliveryMethod: "delivery" }),
      newStatus: "open",
      store: createStore(),
    });
    expect(failed).toBeUndefined();
  });

  it("covers catch branches when email provider throws during status updates", async () => {
    const mod = await loadModule();

    sendOrderEmail
      .mockRejectedValueOnce(new Error("open failed"))
      .mockRejectedValueOnce(new Error("ready failed"))
      .mockRejectedValueOnce(new Error("out-for-delivery failed"))
      .mockRejectedValueOnce(new Error("complete failed"))
      .mockRejectedValueOnce(new Error("cancel failed"));

    const open = await mod.handleOrderStatusUpdate({
      order: createOrder({
        deliveryFee: 5,
        discount: { span: "entire-order", discountType: "amount", discountValue: 500 },
      }),
      newStatus: "open",
      store: createStore(),
    });
    expect(open).toBeUndefined();

    const ready = await mod.handleOrderStatusUpdate({
      order: createOrder(),
      newStatus: "ready-for-pickup",
      store: createStore(),
    });
    expect(ready).toBeUndefined();

    const outForDelivery = await mod.handleOrderStatusUpdate({
      order: createOrder({ deliveryMethod: "delivery" }),
      newStatus: "out-for-delivery",
      store: createStore(),
    });
    expect(outForDelivery).toBeUndefined();

    const complete = await mod.handleOrderStatusUpdate({
      order: createOrder({ deliveryMethod: "delivery" }),
      newStatus: "delivered",
      store: createStore(),
    });
    expect(complete).toBeUndefined();

    const cancelled = await mod.handleOrderStatusUpdate({
      order: createOrder(),
      newStatus: "cancelled",
      store: createStore(),
    });
    expect(cancelled).toBeUndefined();
  });

  it("returns early when order or store cannot be loaded", async () => {
    const mod = await loadModule();

    const missingOrder = await mod.sendOrderUpdateEmail.handler(
      {
        runQuery: vi.fn().mockResolvedValueOnce(null),
        runMutation: vi.fn(),
      } as never,
      {
        orderId: "order_1",
        newStatus: "open",
      }
    );
    expect(missingOrder).toEqual({
      success: false,
      message: "Order not found",
    });

    const missingStore = await mod.sendOrderUpdateEmail.handler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce(createOrder())
          .mockResolvedValueOnce(null),
        runMutation: vi.fn(),
      } as never,
      {
        orderId: "order_1",
        newStatus: "open",
      }
    );
    expect(missingStore).toEqual({
      success: false,
      message: "Store not found",
    });
  });

  it("handles all sendOrderUpdateEmail mutation result branches", async () => {
    const mod = await loadModule();
    sendOrderEmail.mockResolvedValue({ ok: true });

    const makeCtx = (orderOverrides: Record<string, unknown> = {}) => ({
      runQuery: vi
        .fn()
        .mockResolvedValueOnce(createOrder(orderOverrides))
        .mockResolvedValueOnce(createStore()),
      runMutation: vi.fn(),
    });

    const none = await mod.sendOrderUpdateEmail.handler(
      makeCtx({ didSendReadyEmail: true, didSendCompletedEmail: true }) as never,
      {
      orderId: "order_1",
      newStatus: "noop",
      }
    );
    expect(none).toEqual({
      success: false,
      message: "No email sent for this status",
    });

    const confirmation = await mod.sendOrderUpdateEmail.handler(
      makeCtx() as never,
      {
        orderId: "order_1",
        newStatus: "open",
      }
    );
    expect(confirmation).toEqual({
      success: true,
      message: "Confirmation email sent",
    });

    const ready = await mod.sendOrderUpdateEmail.handler(
      makeCtx() as never,
      {
        orderId: "order_1",
        newStatus: "ready-for-pickup",
      }
    );
    expect(ready).toEqual({
      success: true,
      message: "Ready email sent",
    });

    const complete = await mod.sendOrderUpdateEmail.handler(
      makeCtx({ deliveryMethod: "delivery" }) as never,
      {
        orderId: "order_1",
        newStatus: "delivered",
      }
    );
    expect(complete).toEqual({
      success: true,
      message: "Completed email sent",
    });

    const cancelled = await mod.sendOrderUpdateEmail.handler(
      makeCtx() as never,
      {
        orderId: "order_1",
        newStatus: "cancelled",
      }
    );
    expect(cancelled).toEqual({
      success: true,
      message: "Cancelled email sent",
    });
  });
});
