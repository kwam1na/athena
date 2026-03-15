// @vitest-environment node

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

type LoadCheckoutRoutesOptions = {
  storeData?: {
    storeId?: string;
    organizationId?: string;
  };
  userId?: string | undefined;
};

async function loadCheckoutRoutes(options: LoadCheckoutRoutesOptions = {}) {
  vi.resetModules();

  const hasUserIdOverride = Object.prototype.hasOwnProperty.call(
    options,
    "userId"
  );
  const getStoreDataFromRequest = vi.fn().mockResolvedValue(
    options.storeData ?? {
      storeId: "store_1",
      organizationId: "org_1",
    }
  );
  const getStorefrontUserFromRequest = vi
    .fn()
    .mockResolvedValue(hasUserIdOverride ? options.userId : "guest_1");

  vi.doMock("../../../utils", () => ({
    getStoreDataFromRequest,
    getStorefrontUserFromRequest,
  }));

  const module = await import("./checkout");
  const app = new Hono();
  app.route("/checkout", module.checkoutRoutes);

  return {
    app,
    getStoreDataFromRequest,
    getStorefrontUserFromRequest,
  };
}

describe("checkoutRoutes order flows", () => {
  it("returns guard errors for checkout session creation and handles mutation failures", async () => {
    const missingUser = await loadCheckoutRoutes({ userId: undefined });
    const missingUserResponse = await missingUser.app.request(
      "http://localhost/checkout",
      {
        method: "POST",
        body: JSON.stringify({
          amount: 15000,
          bagId: "bag_1",
          products: [],
        }),
      },
      { runAction: vi.fn(), runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    expect(missingUserResponse.status).toBe(404);
    expect(await missingUserResponse.json()).toEqual({
      error: "Customer id missing",
    });

    const missingStore = await loadCheckoutRoutes({
      storeData: { storeId: undefined, organizationId: "org_1" },
    });
    const missingStoreResponse = await missingStore.app.request(
      "http://localhost/checkout",
      {
        method: "POST",
        body: JSON.stringify({
          amount: 15000,
          bagId: "bag_1",
          products: [],
        }),
      },
      { runAction: vi.fn(), runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    expect(missingStoreResponse.status).toBe(404);
    expect(await missingStoreResponse.json()).toEqual({
      error: "Store id missing",
    });

    const { app } = await loadCheckoutRoutes();
    const failingMutation = vi.fn().mockRejectedValue(new Error("create failed"));
    const failureResponse = await app.request(
      "http://localhost/checkout",
      {
        method: "POST",
        body: JSON.stringify({
          amount: 15000,
          bagId: "bag_1",
          products: [],
        }),
      },
      {
        runAction: vi.fn(),
        runMutation: failingMutation,
        runQuery: vi.fn(),
      } as never
    );
    expect(failureResponse.status).toBe(400);
    expect(await failureResponse.json()).toEqual({ error: "create failed" });
  });

  it("creates a checkout session for the current storefront user", async () => {
    const { app } = await loadCheckoutRoutes();
    const runMutation = vi.fn().mockResolvedValue({
      success: true,
      session: { _id: "checkout_1" },
    });

    const response = await app.request(
      "http://localhost/checkout",
      {
        method: "POST",
        body: JSON.stringify({
          amount: 15000,
          bagId: "bag_1",
          products: [
            {
              productId: "product_1",
              productSkuId: "sku_1",
              productSku: "SKU-1",
              price: 150,
              quantity: 1,
            },
          ],
        }),
      },
      {
        runAction: vi.fn(),
        runMutation,
        runQuery: vi.fn(),
      } as never
    );

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      amount: 15000,
      bagId: "bag_1",
      products: [
        {
          productId: "product_1",
          productSkuId: "sku_1",
          productSku: "SKU-1",
          price: 150,
          quantity: 1,
        },
      ],
      storeFrontUserId: "guest_1",
      storeId: "store_1",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      session: { _id: "checkout_1" },
    });
  });

  it("creates a POD order when the store is active", async () => {
    const { app } = await loadCheckoutRoutes();
    const runQuery = vi.fn().mockResolvedValue({
      config: {
        availability: { inMaintenanceMode: false },
        visibility: { inReadOnlyMode: false },
      },
    });
    const runAction = vi.fn().mockResolvedValue({
      success: true,
      orderId: "order_1",
    });

    const response = await app.request(
      "http://localhost/checkout/session_1",
      {
        method: "POST",
        body: JSON.stringify({
          action: "create-pod-order",
          customerEmail: "guest@example.com",
          amount: 25000,
          orderDetails: {
            deliveryMethod: "delivery",
            deliveryFee: 10,
            customerDetails: {
              email: "guest@example.com",
              firstName: "Ada",
              lastName: "Lovelace",
              phoneNumber: "5555551234",
            },
          },
        }),
      },
      {
        runAction,
        runMutation: vi.fn(),
        runQuery,
      } as never
    );

    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery.mock.calls[0]?.[1]).toEqual({
      identifier: "store_1",
      organizationId: "org_1",
    });

    expect(runAction).toHaveBeenCalledTimes(1);
    expect(runAction.mock.calls[0]?.[1]).toEqual({
      amount: 25000,
      checkoutSessionId: "session_1",
      customerEmail: "guest@example.com",
      orderDetails: {
        billingDetails: null,
        customerDetails: {
          email: "guest@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
          phoneNumber: "5555551234",
        },
        deliveryDetails: null,
        deliveryFee: 10,
        deliveryMethod: "delivery",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      orderId: "order_1",
    });
  });

  it("returns store unavailable when creating a POD order during maintenance", async () => {
    const { app } = await loadCheckoutRoutes();
    const runQuery = vi.fn().mockResolvedValue({
      config: {
        availability: { inMaintenanceMode: true },
      },
    });
    const runAction = vi.fn();

    const response = await app.request(
      "http://localhost/checkout/session_1",
      {
        method: "POST",
        body: JSON.stringify({
          action: "create-pod-order",
          customerEmail: "guest@example.com",
          amount: 25000,
          orderDetails: {
            deliveryMethod: "delivery",
          },
        }),
      },
      {
        runAction,
        runMutation: vi.fn(),
        runQuery,
      } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: false,
      message: "Store checkout is currently not available",
    });
    expect(runAction).not.toHaveBeenCalled();
  });

  it("updates the checkout session when placing an order", async () => {
    const { app } = await loadCheckoutRoutes();
    const runMutation = vi.fn().mockResolvedValue({
      success: true,
    });

    const response = await app.request(
      "http://localhost/checkout/session_2",
      {
        method: "POST",
        body: JSON.stringify({
          action: "place-order",
          hasCompletedCheckoutSession: true,
        }),
      },
      {
        runAction: vi.fn(),
        runMutation,
        runQuery: vi.fn(),
      } as never
    );

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      action: "place-order",
      hasCompletedCheckoutSession: true,
      id: "session_2",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
    });
  });

  it("completes checkout and backfills order details from the online order record", async () => {
    const { app } = await loadCheckoutRoutes();
    const runQuery = vi.fn().mockResolvedValue({
      billingDetails: {
        address: "123 Main St",
        billingAddressSameAsDelivery: true,
        city: "Austin",
        country: "US",
        state: "TX",
        zip: "78701",
      },
      customerDetails: {
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        phoneNumber: "5555551234",
      },
      deliveryDetails: {
        address: "123 Main St",
        city: "Austin",
        country: "US",
        state: "TX",
        zip: "78701",
      },
      deliveryInstructions: "Leave at front door",
      deliveryFee: 12,
      deliveryMethod: "delivery",
      deliveryOption: "standard",
      discount: 5,
      pickupLocation: null,
    });
    const runMutation = vi.fn().mockResolvedValue({
      success: true,
    });

    const response = await app.request(
      "http://localhost/checkout/session_4",
      {
        method: "POST",
        body: JSON.stringify({
          action: "complete-checkout",
        }),
      },
      {
        runAction: vi.fn(),
        runMutation,
        runQuery,
      } as never
    );

    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery.mock.calls[0]?.[1]).toEqual({
      checkoutSessionId: "session_4",
    });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      hasCompletedCheckoutSession: true,
      id: "session_4",
      orderDetails: {
        billingDetails: {
          address: "123 Main St",
          billingAddressSameAsDelivery: true,
          city: "Austin",
          country: "US",
          state: "TX",
          zip: "78701",
        },
        customerDetails: {
          email: "ada@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
          phoneNumber: "5555551234",
        },
        deliveryDetails: {
          address: "123 Main St",
          city: "Austin",
          country: "US",
          state: "TX",
          zip: "78701",
        },
        deliveryFee: 12,
        deliveryInstructions: "Leave at front door",
        deliveryMethod: "delivery",
        deliveryOption: "standard",
        discount: 5,
        pickupLocation: null,
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
    });
  });

  it("routes cancel-order to the checkout session action", async () => {
    const { app } = await loadCheckoutRoutes();
    const runAction = vi.fn().mockResolvedValue({
      success: true,
      canceled: true,
    });

    const response = await app.request(
      "http://localhost/checkout/session_5",
      {
        method: "POST",
        body: JSON.stringify({
          action: "cancel-order",
        }),
      },
      {
        runAction,
        runMutation: vi.fn(),
        runQuery: vi.fn(),
      } as never
    );

    expect(runAction).toHaveBeenCalledTimes(1);
    expect(runAction.mock.calls[0]?.[1]).toEqual({
      id: "session_5",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      canceled: true,
    });
  });

  it("updates an order reference after placement", async () => {
    const { app } = await loadCheckoutRoutes();
    const runMutation = vi.fn().mockResolvedValue({
      success: true,
      updated: true,
    });

    const response = await app.request(
      "http://localhost/checkout/session_6",
      {
        method: "POST",
        body: JSON.stringify({
          action: "update-order",
          hasCompletedCheckoutSession: true,
          placedOrderId: "order_42",
        }),
      },
      {
        runAction: vi.fn(),
        runMutation,
        runQuery: vi.fn(),
      } as never
    );

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      hasCompletedCheckoutSession: true,
      id: "session_6",
      placedOrderId: "order_42",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      updated: true,
    });
  });

  it("returns 404 when customer id is missing before order creation actions", async () => {
    const { app } = await loadCheckoutRoutes({
      userId: undefined,
    });
    const env = {
      runAction: vi.fn(),
      runMutation: vi.fn(),
      runQuery: vi.fn(),
    };

    const response = await app.request(
      "http://localhost/checkout/session_3",
      {
        method: "POST",
        body: JSON.stringify({
          action: "create-pod-order",
        }),
      },
      env as never
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Customer id missing",
    });
    expect(env.runQuery).not.toHaveBeenCalled();
    expect(env.runAction).not.toHaveBeenCalled();
    expect(env.runMutation).not.toHaveBeenCalled();
  });

  it("covers finalize-payment success and its validation branches", async () => {
    const { app } = await loadCheckoutRoutes();
    const runAction = vi.fn().mockResolvedValue({
      authorization_url: "https://pay.example/tx",
    });

    const successQuery = vi
      .fn()
      .mockResolvedValueOnce({
        config: {
          availability: { inMaintenanceMode: false },
          visibility: { inReadOnlyMode: false },
        },
      })
      .mockResolvedValueOnce({
        hasCompletedPayment: false,
      });
    const successResponse = await app.request(
      "http://localhost/checkout/session_finalize",
      {
        method: "POST",
        body: JSON.stringify({
          action: "finalize-payment",
          customerEmail: "guest@example.com",
          amount: 10000,
          orderDetails: {
            deliveryMethod: "delivery",
            deliveryDetails: {
              city: "Austin",
            },
          },
        }),
      },
      {
        runAction,
        runMutation: vi.fn(),
        runQuery: successQuery,
      } as never
    );
    expect(successResponse.status).toBe(200);
    expect(await successResponse.json()).toEqual({
      authorization_url: "https://pay.example/tx",
    });

    const maintenanceQuery = vi.fn().mockResolvedValue({
      config: { availability: { inMaintenanceMode: true } },
    });
    const maintenanceResponse = await app.request(
      "http://localhost/checkout/session_finalize",
      {
        method: "POST",
        body: JSON.stringify({
          action: "finalize-payment",
          customerEmail: "guest@example.com",
          amount: 10000,
          orderDetails: { deliveryMethod: "delivery", deliveryDetails: {} },
        }),
      },
      {
        runAction: vi.fn(),
        runMutation: vi.fn(),
        runQuery: maintenanceQuery,
      } as never
    );
    expect(maintenanceResponse.status).toBe(200);
    expect(await maintenanceResponse.json()).toEqual({
      success: false,
      message: "Store checkout is currently not available",
    });

    const completedQuery = vi
      .fn()
      .mockResolvedValueOnce({
        config: {
          availability: { inMaintenanceMode: false },
          visibility: { inReadOnlyMode: false },
        },
      })
      .mockResolvedValueOnce({
        hasCompletedPayment: true,
      });
    const completedResponse = await app.request(
      "http://localhost/checkout/session_finalize",
      {
        method: "POST",
        body: JSON.stringify({
          action: "finalize-payment",
          customerEmail: "guest@example.com",
          amount: 10000,
          orderDetails: { deliveryMethod: "delivery", deliveryDetails: {} },
        }),
      },
      {
        runAction: vi.fn(),
        runMutation: vi.fn(),
        runQuery: completedQuery,
      } as never
    );
    expect(completedResponse.status).toBe(200);
    expect(await completedResponse.json()).toEqual(
      expect.objectContaining({
        success: false,
        code: "SESSION_ALREADY_FINALIZED",
      })
    );
  });

  it("covers finalize-payment success payload variants and create-pod fallback store config", async () => {
    const { app } = await loadCheckoutRoutes();
    const finalizeResponse = await app.request(
      "http://localhost/checkout/session_finalize_2",
      {
        method: "POST",
        body: JSON.stringify({
          action: "finalize-payment",
          customerEmail: "guest@example.com",
          amount: 11000,
          orderDetails: {
            deliveryMethod: "delivery",
          },
        }),
      },
      {
        runAction: vi.fn().mockResolvedValue({ success: true }),
        runMutation: vi.fn(),
        runQuery: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ hasCompletedPayment: false }),
      } as never
    );
    expect(finalizeResponse.status).toBe(200);
    expect(await finalizeResponse.json()).toEqual({ success: true });

    const createPodResponse = await app.request(
      "http://localhost/checkout/session_pod_null_store",
      {
        method: "POST",
        body: JSON.stringify({
          action: "create-pod-order",
          customerEmail: "guest@example.com",
          amount: 9000,
          orderDetails: {
            deliveryMethod: "delivery",
          },
        }),
      },
      {
        runAction: vi.fn().mockResolvedValue({ success: true }),
        runMutation: vi.fn(),
        runQuery: vi.fn().mockResolvedValue(null),
      } as never
    );

    expect(createPodResponse.status).toBe(200);
    expect(await createPodResponse.json()).toEqual({ success: true });
  });

  it("covers finalize-payment failure-shaped provider response branch", async () => {
    const { app } = await loadCheckoutRoutes();
    const response = await app.request(
      "http://localhost/checkout/session_finalize_failure_shape",
      {
        method: "POST",
        body: JSON.stringify({
          action: "finalize-payment",
          customerEmail: "guest@example.com",
          amount: 9000,
          orderDetails: {
            deliveryMethod: "delivery",
            deliveryDetails: {},
          },
        }),
      },
      {
        runAction: vi.fn().mockResolvedValue({}),
        runMutation: vi.fn(),
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({
            config: {
              availability: { inMaintenanceMode: false },
              visibility: { inReadOnlyMode: false },
            },
          })
          .mockResolvedValueOnce({ hasCompletedPayment: false }),
      } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it("returns 400 for checkout action failures and missing context", async () => {
    const missingStoreContext = await loadCheckoutRoutes({
      storeData: { storeId: "store_1", organizationId: undefined },
    });
    const missingStoreResponse = await missingStoreContext.app.request(
      "http://localhost/checkout/session_7",
      {
        method: "POST",
        body: JSON.stringify({ action: "place-order" }),
      },
      { runAction: vi.fn(), runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    expect(missingStoreResponse.status).toBe(404);
    expect(await missingStoreResponse.json()).toEqual({
      error: "Store or organization id missing",
    });

    const { app } = await loadCheckoutRoutes();
    const completeFailResponse = await app.request(
      "http://localhost/checkout/session_8",
      {
        method: "POST",
        body: JSON.stringify({
          action: "complete-checkout",
          orderDetails: {
            deliveryMethod: "delivery",
          },
        }),
      },
      {
        runAction: vi.fn(),
        runMutation: vi.fn().mockRejectedValue(new Error("cannot complete")),
        runQuery: vi.fn(),
      } as never
    );
    expect(completeFailResponse.status).toBe(400);
    expect(await completeFailResponse.json()).toEqual({
      success: false,
      message: "cannot complete",
    });

    const outerCatchResponse = await app.request(
      "http://localhost/checkout/session_9",
      {
        method: "POST",
        body: JSON.stringify({
          action: "finalize-payment",
          customerEmail: "guest@example.com",
          amount: 10000,
          orderDetails: { deliveryMethod: "delivery", deliveryDetails: {} },
        }),
      },
      {
        runAction: vi.fn().mockRejectedValue(new Error("provider down")),
        runMutation: vi.fn(),
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({
            config: {
              availability: { inMaintenanceMode: false },
              visibility: { inReadOnlyMode: false },
            },
          })
          .mockResolvedValueOnce({
            hasCompletedPayment: false,
          }),
      } as never
    );
    expect(outerCatchResponse.status).toBe(400);
    expect(await outerCatchResponse.json()).toEqual({ error: "provider down" });
  });

  it("covers complete-checkout order fallback defaults", async () => {
    const { app } = await loadCheckoutRoutes();
    const response = await app.request(
      "http://localhost/checkout/session_10",
      {
        method: "POST",
        body: JSON.stringify({
          action: "complete-checkout",
        }),
      },
      {
        runAction: vi.fn(),
        runMutation: vi.fn().mockResolvedValue({ success: true }),
        runQuery: vi.fn().mockResolvedValue({
          billingDetails: null,
          customerDetails: { email: "ada@example.com" },
          deliveryDetails: { city: "Austin" },
          deliveryInstructions: "",
          deliveryFee: 0,
          deliveryMethod: "delivery",
          deliveryOption: "standard",
          discount: 0,
          pickupLocation: null,
        }),
      } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it("covers active, pending, session lookup and verify endpoints", async () => {
    const { app } = await loadCheckoutRoutes();
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ _id: "active_1" })
      .mockRejectedValueOnce(new Error("query failed"))
      .mockResolvedValueOnce([{ _id: "pending_1" }])
      .mockResolvedValueOnce({ _id: "session_1" });
    const runAction = vi.fn().mockResolvedValue({ verified: true });

    const activeOk = await app.request(
      "http://localhost/checkout/active",
      { method: "GET" },
      { runAction, runMutation: vi.fn(), runQuery } as never
    );
    const activeFail = await app.request(
      "http://localhost/checkout/active",
      { method: "GET" },
      { runAction, runMutation: vi.fn(), runQuery } as never
    );
    const pending = await app.request(
      "http://localhost/checkout/pending",
      { method: "GET" },
      { runAction, runMutation: vi.fn(), runQuery } as never
    );
    const session = await app.request(
      "http://localhost/checkout/session_1",
      { method: "GET" },
      { runAction, runMutation: vi.fn(), runQuery } as never
    );
    const verify = await app.request(
      "http://localhost/checkout/verify/ref_1",
      { method: "GET" },
      { runAction, runMutation: vi.fn(), runQuery } as never
    );

    expect(activeOk.status).toBe(200);
    expect(await activeOk.json()).toEqual({ _id: "active_1" });
    expect(activeFail.status).toBe(400);
    expect(await activeFail.json()).toEqual({ error: "query failed" });
    expect(pending.status).toBe(200);
    expect(session.status).toBe(200);
    expect(verify.status).toBe(200);
    expect(await verify.json()).toEqual({ verified: true });
  });

  it("returns missing-user errors for active/pending/verify routes", async () => {
    const { app } = await loadCheckoutRoutes({ userId: undefined });
    const env = { runAction: vi.fn(), runMutation: vi.fn(), runQuery: vi.fn() };

    const active = await app.request(
      "http://localhost/checkout/active",
      { method: "GET" },
      env as never
    );
    const pending = await app.request(
      "http://localhost/checkout/pending",
      { method: "GET" },
      env as never
    );
    const verify = await app.request(
      "http://localhost/checkout/verify/ref_1",
      { method: "GET" },
      env as never
    );

    expect(active.status).toBe(404);
    expect(pending.status).toBe(404);
    expect(verify.status).toBe(404);
  });

  it("returns an empty payload for unsupported checkout actions", async () => {
    const { app } = await loadCheckoutRoutes();
    const response = await app.request(
      "http://localhost/checkout/session_unknown",
      {
        method: "POST",
        body: JSON.stringify({
          action: "unknown-action",
        }),
      },
      { runAction: vi.fn(), runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });
});
