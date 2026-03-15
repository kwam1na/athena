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

  it("throws when paystack secret key is missing", async () => {
    const { createTransaction } = await loadModule({ paystackKey: "" });

    await expect(
      createTransaction.handler(
        { runMutation: vi.fn() } as never,
        {
          checkoutSessionId: "session_123",
          customerEmail: "ada@example.com",
          amount: 12500,
          orderDetails: createOrderDetails(),
        }
      )
    ).rejects.toThrow("PAYSTACK_SECRET_KEY is not configured.");
  });

  it("logs and continues when checkout-session finalizing patch fails", async () => {
    const { createTransaction } = await loadModule({
      siteUrl: "",
      hostUrl: "https://host.example.com",
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      runMutation: vi.fn().mockRejectedValue(new Error("db offline")),
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          authorization_url: "https://paystack.example.com/auth",
          reference: "ref_456",
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
        body: expect.stringContaining("https://host.example.com/shop/checkout/verify"),
      })
    );
    expect(result).toEqual({
      authorization_url: "https://paystack.example.com/auth",
      reference: "ref_456",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to update checkout session",
      expect.any(Error)
    );
  });

  it("returns undefined when transaction initialization fails", async () => {
    const { createTransaction } = await loadModule({
      siteUrl: "",
      hostUrl: "",
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      runMutation: vi.fn(),
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
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
        body: expect.stringContaining("http://localhost:3000/shop/checkout/verify"),
      })
    );
    expect(result).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to create transaction",
      expect.objectContaining({ ok: false })
    );
  });

  it("handles unverified payment responses and failed verify fetch", async () => {
    const { verifyPayment } = await loadModule();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const mismatchCtx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({ _id: "session_123", amount: 10000 })
        .mockResolvedValueOnce({ _id: "order_123", amount: 10000 }),
      runMutation: vi.fn(),
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          status: "success",
          amount: 9000,
        },
      }),
    } as Response);

    const mismatchResult = await verifyPayment.handler(mismatchCtx as never, {
      storeFrontUserId: "user_123",
      externalReference: "ref_bad",
    });
    expect(mismatchResult).toEqual({ verified: false });
    expect(errorSpy).toHaveBeenCalledWith(
      "unable to verify payment. [session: session_123, order: order_123, customer: user_123, externalReference: ref_bad]"
    );

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);
    const failedFetch = await verifyPayment.handler(
      {
        runQuery: vi.fn(),
        runMutation: vi.fn(),
      } as never,
      {
        storeFrontUserId: "user_123",
        externalReference: "ref_bad",
      }
    );
    expect(failedFetch).toEqual({
      message: "No active session found.",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to create transaction",
      expect.objectContaining({ ok: false })
    );
  });

  it("catches confirmation email errors for pickup orders", async () => {
    const { verifyPayment } = await loadModule();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "session_pickup",
          amount: 11000,
        })
        .mockResolvedValueOnce({
          _id: "order_pickup",
          _creationTime: Date.UTC(2026, 2, 14, 12, 0, 0),
          amount: 11000,
          didSendConfirmationEmail: false,
          orderNumber: "WIG-2001",
          deliveryMethod: "pickup",
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
          items: [],
        })
        .mockResolvedValueOnce({
          currency: "USD",
          config: {
            contactInfo: {
              location: "Pickup Desk",
            },
          },
        }),
      runMutation: vi.fn(),
    };

    sendOrderEmail.mockRejectedValueOnce(new Error("mailer failed"));
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          status: "success",
          amount: 11000,
        },
      }),
    } as Response);

    const result = await verifyPayment.handler(ctx as never, {
      storeFrontUserId: "guest_123",
      externalReference: "ref_pickup",
    });

    expect(result).toEqual({ verified: true });
    expect(ctx.runMutation).toHaveBeenCalledWith("onlineOrder.update", {
      externalReference: "ref_pickup",
      update: {
        hasVerifiedPayment: true,
      },
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to send order confirmation email",
      expect.any(Error)
    );
  });

  it("submits refunds and returns items to stock branch", async () => {
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
            reference: "ref_999",
          },
        },
      }),
    } as Response);

    const result = await refundPayment.handler(ctx as never, {
      externalTransactionId: "txn_999",
      amount: 1000,
      returnItemsToStock: true,
      onlineOrderItemIds: ["item_1"],
      refundItems: [],
    });

    expect(result).toEqual({ success: true, message: "Refund queued" });
    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      2,
      "onlineOrder.returnItemsToStock",
      {
        externalTransactionId: "txn_999",
        onlineOrderItemIds: ["item_1"],
      }
    );
  });

  it("returns refund failure payload when paystack refund request fails", async () => {
    const { refundPayment } = await loadModule();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        message: "Refund failed",
      }),
    } as Response);

    const result = await refundPayment.handler(
      { runMutation: vi.fn() } as never,
      {
        externalTransactionId: "txn_777",
        amount: 1000,
        returnItemsToStock: false,
      }
    );

    expect(result).toEqual({ success: false, message: "Refund failed" });
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to refund payment",
      expect.objectContaining({ ok: false })
    );
  });
});
