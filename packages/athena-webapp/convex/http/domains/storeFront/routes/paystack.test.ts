// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

async function createSignature(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loadModule(secret?: string) {
  vi.resetModules();

  vi.doMock("../../../../_generated/api", () => ({
    api: {
      storeFront: {
        checkoutSession: {
          getById: "checkoutSession.getById",
        },
        onlineOrder: {
          getByExternalReference: "onlineOrder.getByExternalReference",
          update: "onlineOrder.update",
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

  vi.doMock("../../../../env", () => ({
    PAYSTACK_SECRET_KEY: secret,
  }));

  const module = await import("./paystack");

  return module.paystackRoutes;
}

describe("paystackRoutes", () => {
  it("returns 500 when the secret key is not configured", async () => {
    const paystackRoutes = await loadModule();
    const response = await paystackRoutes.request(
      "http://localhost/",
      {
        method: "POST",
        body: JSON.stringify({}),
      },
      {
        runQuery: vi.fn(),
        runMutation: vi.fn(),
      } as never
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Paystack secret key is not configured.",
    });
  });

  it("rejects missing webhook signatures", async () => {
    const paystackRoutes = await loadModule("secret");
    const env = {
      runQuery: vi.fn(),
      runMutation: vi.fn(),
    };

    const response = await paystackRoutes.request(
      "http://localhost/",
      {
        method: "POST",
        body: JSON.stringify({}),
      },
      env as never
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Missing webhook signature.",
    });
    expect(env.runQuery).not.toHaveBeenCalled();
  });

  it("rejects invalid signatures and malformed payloads", async () => {
    const paystackRoutes = await loadModule("secret");
    const invalidBody = JSON.stringify({
      event: "charge.success",
      data: {
        id: 1,
      },
    });
    const invalidSignatureResponse = await paystackRoutes.request(
      "http://localhost/",
      {
        method: "POST",
        headers: {
          "x-paystack-signature": "not-valid",
        },
        body: invalidBody,
      },
      {
        runQuery: vi.fn(),
        runMutation: vi.fn(),
      } as never
    );

    expect(invalidSignatureResponse.status).toBe(401);
    expect(await invalidSignatureResponse.json()).toEqual({
      error: "Invalid webhook signature.",
    });

    const malformedBody = "{";
    const malformedResponse = await paystackRoutes.request(
      "http://localhost/",
      {
        method: "POST",
        headers: {
          "x-paystack-signature": await createSignature("secret", malformedBody),
        },
        body: malformedBody,
      },
      {
        runQuery: vi.fn(),
        runMutation: vi.fn(),
      } as never
    );

    expect(malformedResponse.status).toBe(400);
    expect(await malformedResponse.json()).toEqual({
      error: "Malformed webhook payload.",
    });
  });

  it("updates the checkout session for valid charge.success webhooks", async () => {
    const paystackRoutes = await loadModule("secret");
    const env = {
      runQuery: vi.fn().mockResolvedValue({
        hasCompletedPayment: false,
        externalTransactionId: null,
      }),
      runMutation: vi.fn(),
    };

    const body = JSON.stringify({
      event: "charge.success",
      data: {
        id: 42,
        amount: 12500,
        authorization: {
          last4: "4242",
          brand: "visa",
          bank: "Chase",
          channel: "card",
        },
        metadata: {
          checkout_session_id: "session_123",
          order_details: {
            deliveryMethod: "delivery",
            deliveryOption: "standard",
            deliveryFee: "15.5",
            deliveryInstructions: "",
            pickupLocation: null,
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
            billingDetails: {
              country: "US",
              address: "123 Main St",
              city: "Austin",
              state: "TX",
              zip: "78701",
              billingAddressSameAsDelivery: 1,
            },
          },
        },
      },
    });

    const response = await paystackRoutes.request(
      "http://localhost/",
      {
        method: "POST",
        headers: {
          "x-paystack-signature": await createSignature("secret", body),
          "content-type": "application/json",
        },
        body,
      },
      env as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(env.runQuery).toHaveBeenCalledWith("checkoutSession.getById", {
      sessionId: "session_123",
    });
    expect(env.runMutation).toHaveBeenCalledWith(
      "checkoutSession.updateCheckoutSession",
      {
        id: "session_123",
        hasCompletedPayment: true,
        amount: 12500,
        externalTransactionId: "42",
        paymentMethod: {
          last4: "4242",
          brand: "visa",
          bank: "Chase",
          channel: "card",
        },
        orderDetails: expect.objectContaining({
          deliveryFee: 15.5,
          deliveryInstructions: "",
          billingDetails: expect.objectContaining({
            billingAddressSameAsDelivery: true,
          }),
        }),
      }
    );
  });

  it("sets delivery fee to null when absent from order details", async () => {
    const paystackRoutes = await loadModule("secret");
    const env = {
      runQuery: vi.fn().mockResolvedValue({
        hasCompletedPayment: false,
        externalTransactionId: null,
      }),
      runMutation: vi.fn(),
    };
    const body = JSON.stringify({
      event: "charge.success",
      data: {
        id: 52,
        amount: 10000,
        metadata: {
          checkout_session_id: "session_124",
          order_details: {
            billingDetails: {
              country: "US",
              billingAddressSameAsDelivery: 0,
            },
          },
        },
      },
    });

    const response = await paystackRoutes.request(
      "http://localhost/",
      {
        method: "POST",
        headers: {
          "x-paystack-signature": await createSignature("secret", body),
        },
        body,
      },
      env as never
    );

    expect(response.status).toBe(200);
    expect(env.runMutation.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        orderDetails: expect.objectContaining({
          deliveryFee: null,
        }),
      })
    );
  });

  it("deduplicates already-processed successful charges", async () => {
    const paystackRoutes = await loadModule("secret");
    const env = {
      runQuery: vi.fn().mockResolvedValue({
        hasCompletedPayment: true,
        externalTransactionId: "42",
      }),
      runMutation: vi.fn(),
    };

    const body = JSON.stringify({
      event: "charge.success",
      data: {
        id: 42,
        metadata: {
          checkout_session_id: "session_123",
          order_details: {
            billingDetails: {
              country: "US",
            },
          },
        },
      },
    });

    const response = await paystackRoutes.request(
      "http://localhost/",
      {
        method: "POST",
        headers: {
          "x-paystack-signature": await createSignature("secret", body),
        },
        body,
      },
      env as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      deduplicated: true,
    });
    expect(env.runMutation).not.toHaveBeenCalled();
  });

  it("validates charge.success metadata and session resolution", async () => {
    const paystackRoutes = await loadModule("secret");

    const missingTransactionBody = JSON.stringify({
      event: "charge.success",
      data: {
        metadata: {
          checkout_session_id: "session_123",
          order_details: {
            billingDetails: {
              country: "US",
            },
          },
        },
      },
    });

    const missingTransactionResponse = await paystackRoutes.request(
      "http://localhost/",
      {
        method: "POST",
        headers: {
          "x-paystack-signature": await createSignature(
            "secret",
            missingTransactionBody
          ),
        },
        body: missingTransactionBody,
      },
      {
        runQuery: vi.fn(),
        runMutation: vi.fn(),
      } as never
    );

    expect(missingTransactionResponse.status).toBe(400);
    expect(await missingTransactionResponse.json()).toEqual({
      error: "Missing transaction id.",
    });

    const missingOrderDetailsBody = JSON.stringify({
      event: "charge.success",
      data: {
        id: 42,
        metadata: {
          checkout_session_id: "session_123",
          order_details: {},
        },
      },
    });

    const missingOrderDetailsResponse = await paystackRoutes.request(
      "http://localhost/",
      {
        method: "POST",
        headers: {
          "x-paystack-signature": await createSignature(
            "secret",
            missingOrderDetailsBody
          ),
        },
        body: missingOrderDetailsBody,
      },
      {
        runQuery: vi.fn(),
        runMutation: vi.fn(),
      } as never
    );

    expect(missingOrderDetailsResponse.status).toBe(400);
    expect(await missingOrderDetailsResponse.json()).toEqual({
      error: "Missing order details metadata.",
    });

    const missingSessionBody = JSON.stringify({
      event: "charge.success",
      data: {
        id: 42,
        metadata: {
          checkout_session_id: "session_123",
          order_details: {
            billingDetails: {
              country: "US",
            },
          },
        },
      },
    });

    const missingSessionResponse = await paystackRoutes.request(
      "http://localhost/",
      {
        method: "POST",
        headers: {
          "x-paystack-signature": await createSignature(
            "secret",
            missingSessionBody
          ),
        },
        body: missingSessionBody,
      },
      {
        runQuery: vi.fn().mockResolvedValue(null),
        runMutation: vi.fn(),
      } as never
    );

    expect(missingSessionResponse.status).toBe(404);
    expect(await missingSessionResponse.json()).toEqual({
      error: "Checkout session not found.",
    });
  });

  it("updates refund status for refund webhooks and deduplicates repeats", async () => {
    const paystackRoutes = await loadModule("secret");
    const firstEnv = {
      runQuery: vi.fn().mockResolvedValue({
        refunds: [],
      }),
      runMutation: vi.fn(),
    };

    const body = JSON.stringify({
      event: "refund.processed",
      data: {
        id: 99,
        amount: 2500,
        transaction_reference: "ref_123",
      },
    });

    const firstResponse = await paystackRoutes.request(
      "http://localhost/",
      {
        method: "POST",
        headers: {
          "x-paystack-signature": await createSignature("secret", body),
        },
        body,
      },
      firstEnv as never
    );

    expect(firstResponse.status).toBe(200);
    expect(firstEnv.runMutation).toHaveBeenCalledWith("onlineOrder.update", {
      externalReference: "ref_123",
      update: {
        status: "refunded",
        refund_id: "99",
        refund_amount: 2500,
      },
    });

    const secondEnv = {
      runQuery: vi.fn().mockResolvedValue({
        refunds: [{ id: "99" }],
      }),
      runMutation: vi.fn(),
    };

    const secondResponse = await paystackRoutes.request(
      "http://localhost/",
      {
        method: "POST",
        headers: {
          "x-paystack-signature": await createSignature("secret", body),
        },
        body,
      },
      secondEnv as never
    );

    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toEqual({
      success: true,
      deduplicated: true,
    });
    expect(secondEnv.runMutation).not.toHaveBeenCalled();
  });

  it("updates processing, pending and failed refund statuses", async () => {
    const paystackRoutes = await loadModule("secret");
    const runQuery = vi.fn().mockResolvedValue({ refunds: [] });
    const runMutation = vi.fn();

    const events = [
      { event: "refund.processing", status: "refund-processing" },
      { event: "refund.pending", status: "refund-pending" },
      { event: "refund.failed", status: "refund-failed" },
    ];

    for (const entry of events) {
      const body = JSON.stringify({
        event: entry.event,
        data: {
          id: 91,
          amount: 1000,
          transaction_reference: "ref_123",
        },
      });

      const response = await paystackRoutes.request(
        "http://localhost/",
        {
          method: "POST",
          headers: {
            "x-paystack-signature": await createSignature("secret", body),
          },
          body,
        },
        {
          runQuery,
          runMutation,
        } as never
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
    }

    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      externalReference: "ref_123",
      update: {
        refund_amount: 1000,
        refund_id: "91",
        status: "refund-processing",
      },
    });
    expect(runMutation.mock.calls[1]?.[1]).toEqual({
      externalReference: "ref_123",
      update: {
        refund_amount: 1000,
        refund_id: "91",
        status: "refund-pending",
      },
    });
    expect(runMutation.mock.calls[2]?.[1]).toEqual({
      externalReference: "ref_123",
      update: {
        refund_amount: 1000,
        refund_id: "91",
        status: "refund-failed",
      },
    });
  });
});
