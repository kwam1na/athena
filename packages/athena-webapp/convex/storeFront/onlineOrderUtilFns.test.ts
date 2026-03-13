// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendOrderEmail } = vi.hoisted(() => ({
  sendOrderEmail: vi.fn(),
}));

vi.mock("../mailersend", () => ({
  sendOrderEmail,
}));

vi.mock("../_generated/server", () => ({
  action: (definition: unknown) => definition,
}));

vi.mock("../_generated/api", () => ({
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

import { handleOrderStatusUpdate } from "./onlineOrderUtilFns";

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
      },
    ],
    didSendReadyEmail: false,
    didSendCompletedEmail: false,
    ...overrides,
  };
}

function createStore(overrides: Record<string, unknown> = {}) {
  return {
    currency: "USD",
    config: {
      contactInfo: {
        location: "123 Pickup Lane",
      },
    },
    ...overrides,
  };
}

describe("handleOrderStatusUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a confirmation email for open pickup orders", async () => {
    sendOrderEmail.mockResolvedValue({ ok: true });

    const result = await handleOrderStatusUpdate({
      order: createOrder(),
      newStatus: "open",
      store: createStore(),
    });

    expect(sendOrderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "confirmation",
        customerEmail: "ada@example.com",
        pickup_type: "pickup",
        pickup_details: "123 Pickup Lane",
        total: "$125",
        order_status_messaging: expect.stringContaining("processing your order"),
      })
    );
    expect(result).toEqual({ didSendConfirmationEmail: true });
  });

  it("sends a ready email for out-for-delivery orders", async () => {
    sendOrderEmail.mockResolvedValue({ ok: true });

    const result = await handleOrderStatusUpdate({
      order: createOrder({ deliveryMethod: "delivery" }),
      newStatus: "out-for-delivery",
      store: createStore(),
    });

    expect(sendOrderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ready",
        pickup_type: "delivery",
        pickup_details: "123 Main St, Austin, TX 78701, United States",
        order_status_messaging: "Your order is out for delivery.",
      })
    );
    expect(result).toEqual({ didSendReadyEmail: true });
  });

  it("sends a completed email once for delivered orders", async () => {
    sendOrderEmail.mockResolvedValue({ ok: true });

    const result = await handleOrderStatusUpdate({
      order: createOrder({ deliveryMethod: "delivery" }),
      newStatus: "delivered",
      store: createStore(),
    });

    expect(sendOrderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "complete",
        order_status_messaging:
          "Your order has been delivered. Thank you for shopping with us!",
      })
    );
    expect(result).toEqual({ didSendCompletedEmail: true });
  });

  it("does not send a ready email when one was already sent", async () => {
    const result = await handleOrderStatusUpdate({
      order: createOrder({ didSendReadyEmail: true }),
      newStatus: "ready-for-pickup",
      store: createStore(),
    });

    expect(sendOrderEmail).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
