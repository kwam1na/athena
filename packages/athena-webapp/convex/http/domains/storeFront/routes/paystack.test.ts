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
});
