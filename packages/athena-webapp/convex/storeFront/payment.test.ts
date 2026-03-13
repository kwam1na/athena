// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendOrderEmail } = vi.hoisted(() => ({
  sendOrderEmail: vi.fn(),
}));

async function loadModule({
  paystackKey = "secret",
  siteUrl = "https://shop.example.com",
  hostUrl,
}: {
  paystackKey?: string | undefined;
  siteUrl?: string | undefined;
  hostUrl?: string | undefined;
} = {}) {
  vi.resetModules();

  vi.doMock("../_generated/server", () => ({
    action: (definition: unknown) => definition,
  }));

  vi.doMock("../_generated/api", () => ({
    api: {
      storeFront: {
        checkoutSession: {
          getCheckoutSession: "checkoutSession.getCheckoutSession",
        },
        onlineOrder: {
          get: "onlineOrder.get",
          update: "onlineOrder.update",
          returnItemsToStock: "onlineOrder.returnItemsToStock",
          updateOrderItems: "onlineOrder.updateOrderItems",
        },
      },
      inventory: {
        stores: {
          getById: "inventory.stores.getById",
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

  vi.doMock("../sendgrid", () => ({
    sendOrderEmail,
  }));

  vi.doMock("../env", () => ({
    HOST_URL: hostUrl,
    PAYSTACK_SECRET_KEY: paystackKey,
    SITE_URL: siteUrl,
  }));

  return import("./payment");
}

function createOrderDetails() {
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
    deliveryFee: 10,
    deliveryMethod: "delivery",
    deliveryOption: "standard",
    deliveryInstructions: "Leave at the door",
    pickupLocation: null,
  };
}

describe("payment actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("initializes a transaction and marks the checkout session as finalizing", async () => {
    const { createTransaction } = await loadModule();
    const ctx = {
      runMutation: vi.fn(),
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          authorization_url: "https://paystack.example.com/auth",
          reference: "ref_123",
        },
      }),
    } as Response);

    const result = await createTransaction.handler(ctx as never, {
      checkoutSessionId: "session_123",
      customerEmail: "ada@example.com",
      amount: 12500,
      orderDetails: createOrderDetails(),
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.paystack.co/transaction/initialize",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
          "Content-Type": "application/json",
        }),
      })
    );
    expect(ctx.runMutation).toHaveBeenCalledWith(
      "checkoutSession.updateCheckoutSession",
      {
        id: "session_123",
        isFinalizingPayment: true,
        externalReference: "ref_123",
      }
    );
    expect(result).toEqual({
      authorization_url: "https://paystack.example.com/auth",
      reference: "ref_123",
    });
  });

  it("verifies a successful payment and sends a confirmation email", async () => {
    const { verifyPayment } = await loadModule();
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "session_123",
          amount: 12500,
        })
        .mockResolvedValueOnce({
          _id: "order_123",
          _creationTime: Date.UTC(2026, 2, 13, 12, 0, 0),
          amount: 12500,
          didSendConfirmationEmail: false,
          orderNumber: "WIG-1001",
          deliveryMethod: "delivery",
          deliveryDetails: {
            country: "US",
            address: "123 Main St",
            city: "Austin",
            state: "TX",
            zip: "78701",
          },
          customerDetails: {
            email: "ada@example.com",
            firstName: "Ada",
          },
          storeId: "store_123",
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
        })
        .mockResolvedValueOnce({
          currency: "USD",
          config: {
            contactInfo: {
              location: "123 Pickup Lane",
            },
          },
        }),
      runMutation: vi.fn(),
    };

    sendOrderEmail.mockResolvedValue({ ok: true });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          status: "success",
          amount: 12500,
        },
      }),
    } as Response);

    const result = await verifyPayment.handler(ctx as never, {
      storeFrontUserId: "guest_123",
      externalReference: "ref_123",
    });

    expect(result).toEqual({ verified: true });
    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      1,
      "checkoutSession.updateCheckoutSession",
      {
        id: "session_123",
        hasVerifiedPayment: true,
      }
    );
    expect(sendOrderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "confirmation",
        customerEmail: "ada@example.com",
        total: "$125",
      })
    );
    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      2,
      "onlineOrder.update",
      {
        externalReference: "ref_123",
        update: {
          hasVerifiedPayment: true,
          didSendConfirmationEmail: true,
        },
      }
    );
  });

  it("submits refunds and marks refund items without returning stock", async () => {
    const { refundPayment } = await loadModule();
    const ctx = {
      runMutation: vi.fn(),
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        message: "Refund queued",
        data: {
          transaction: {
            reference: "ref_123",
          },
        },
      }),
    } as Response);

    const result = await refundPayment.handler(ctx as never, {
      externalTransactionId: "txn_123",
      amount: 5000,
      returnItemsToStock: false,
      onlineOrderItemIds: ["item_1", "item_2"],
      refundItems: ["delivery-fee"],
    });

    expect(result).toEqual({
      success: true,
      message: "Refund queued",
    });
    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      1,
      "onlineOrder.update",
      {
        externalReference: "ref_123",
        update: {
          status: "refund-submitted",
          didRefundDeliveryFee: true,
        },
      }
    );
    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      2,
      "onlineOrder.updateOrderItems",
      {
        orderItemIds: ["item_1", "item_2"],
        updates: { isRefunded: true },
      }
    );
  });
});
