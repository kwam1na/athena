// @vitest-environment node

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

type LoadRoutesOptions = {
  authResponse?: Response | null;
  signingKey?: string | undefined;
  withRouteParams?: boolean;
};

async function loadRoutes(options: LoadRoutesOptions = {}) {
  vi.resetModules();
  const hasSigningKeyOverride = Object.prototype.hasOwnProperty.call(
    options,
    "signingKey"
  );

  const enforceActorStoreAccess = vi
    .fn()
    .mockResolvedValue(options.authResponse ?? null);
  const getActorClaims = vi.fn().mockResolvedValue({
    actorId: "actor_system",
    organizationId: "org_claim",
    storeId: "store_claim",
  });
  const sign = vi.fn().mockResolvedValue("signed-actor-token");

  class MockSignJWT {
    setProtectedHeader() {
      return this;
    }

    setSubject() {
      return this;
    }

    setIssuedAt() {
      return this;
    }

    sign(...args: unknown[]) {
      return sign(...args);
    }
  }

  vi.doMock("./actorAuth", () => ({
    enforceActorStoreAccess,
    getActorClaims,
  }));

  vi.doMock("../../../../_generated/api", () => ({
    api: {
      inventory: {
        products: {
          getByIdOrSlug: "inventory.products.getByIdOrSlug",
        },
      },
      storeFront: {
        bag: {
          clearBag: "storeFront.bag.clearBag",
          create: "storeFront.bag.create",
          getByUserId: "storeFront.bag.getByUserId",
        },
        bagItem: {
          addItemToBag: "storeFront.bagItem.addItemToBag",
        },
        checkoutSession: {
          create: "storeFront.checkoutSession.create",
        },
        guest: {
          create: "storeFront.guest.create",
          getByMarker: "storeFront.guest.getByMarker",
        },
      },
    },
  }));

  vi.doMock("jose", () => ({
    SignJWT: MockSignJWT,
  }));

  vi.doMock("../../../../env", () => ({
    STOREFRONT_ACTOR_SIGNING_KEY: hasSigningKeyOverride
      ? options.signingKey
      : "secret",
  }));

  const module = await import("./e2e");
  const app = new Hono();
  app.route(
    options.withRouteParams === false
      ? "/e2e"
      : "/organizations/:organizationId/stores/:storeId/e2e",
    module.e2eRoutes
  );

  return {
    app,
    enforceActorStoreAccess,
    getActorClaims,
    sign,
  };
}

describe("e2eRoutes", () => {
  it("short-circuits when actor-store authorization fails", async () => {
    const unauthorized = new Response(
      JSON.stringify({ error: "Unauthorized request." }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      }
    );
    const { app, enforceActorStoreAccess } = await loadRoutes({
      authResponse: unauthorized,
    });
    const env = {
      runMutation: vi.fn(),
      runQuery: vi.fn(),
    };

    const response = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/e2e/checkout/bootstrap",
      {
        method: "POST",
        body: JSON.stringify({
          items: [{ productSlug: "body-wave", quantity: 1 }],
        }),
      },
      env as never
    );

    expect(enforceActorStoreAccess).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Unauthorized request.",
    });
    expect(env.runQuery).not.toHaveBeenCalled();
    expect(env.runMutation).not.toHaveBeenCalled();
  });

  it("returns 400 when bootstrap is missing checkout items", async () => {
    const { app } = await loadRoutes();
    const env = {
      runMutation: vi.fn(),
      runQuery: vi.fn(),
    };

    const response = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/e2e/checkout/bootstrap",
      {
        method: "POST",
        body: JSON.stringify({
          items: [],
        }),
      },
      env as never
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "At least one item is required.",
    });
    expect(env.runQuery).not.toHaveBeenCalled();
    expect(env.runMutation).not.toHaveBeenCalled();
  });

  it("returns 400 when items payload is not an array", async () => {
    const { app } = await loadRoutes();
    const response = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/e2e/checkout/bootstrap",
      {
        method: "POST",
        body: JSON.stringify({
          items: { productSlug: "body-wave", quantity: 1 },
        }),
      },
      {
        runMutation: vi.fn(),
        runQuery: vi.fn(),
      } as never
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "At least one item is required.",
    });
  });

  it("returns 400 when route params are missing", async () => {
    const { app } = await loadRoutes({ withRouteParams: false });
    const response = await app.request(
      "http://localhost/e2e/checkout/bootstrap",
      {
        method: "POST",
        body: JSON.stringify({
          items: [{ productSlug: "body-wave", quantity: 1 }],
        }),
      },
      {
        runMutation: vi.fn(),
        runQuery: vi.fn(),
      } as never
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid route context.",
    });
  });

  it("returns 404 when a requested product slug cannot be resolved", async () => {
    const { app } = await loadRoutes();
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "guest_1",
      })
      .mockResolvedValueOnce({
        _id: "bag_1",
      })
      .mockResolvedValueOnce(null);
    const runMutation = vi.fn().mockResolvedValue({});

    const response = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/e2e/checkout/bootstrap",
      {
        method: "POST",
        body: JSON.stringify({
          marker: "marker_1",
          items: [{ productSlug: "missing-product", quantity: 1 }],
        }),
      },
      {
        runMutation,
        runQuery,
      } as never
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Product not found for slug 'missing-product'.",
    });
  });

  it("returns 400 when an item is missing productSlug or quantity", async () => {
    const { app } = await loadRoutes();
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ _id: "guest_1" })
      .mockResolvedValueOnce({ _id: "bag_1" });
    const runMutation = vi.fn().mockResolvedValue({});

    const response = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/e2e/checkout/bootstrap",
      {
        method: "POST",
        body: JSON.stringify({
          marker: "marker_1",
          items: [{ productSlug: "", quantity: 0 }],
        }),
      },
      {
        runMutation,
        runQuery,
      } as never
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Each item must include productSlug and quantity.",
    });
  });

  it("returns 404 when no purchasable SKU is available", async () => {
    const { app } = await loadRoutes();
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ _id: "guest_1" })
      .mockResolvedValueOnce({ _id: "bag_1" })
      .mockResolvedValueOnce({
        _id: "product_1",
        skus: [
          {
            _id: "sku_1",
            sku: "SKU-1",
            price: 0,
            quantityAvailable: 0,
          },
        ],
      });
    const runMutation = vi.fn().mockResolvedValue({});

    const response = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/e2e/checkout/bootstrap",
      {
        method: "POST",
        body: JSON.stringify({
          marker: "marker_1",
          items: [{ productSlug: "body-wave", quantity: 1, sku: "MISSING-SKU" }],
        }),
      },
      {
        runMutation,
        runQuery,
      } as never
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "No purchasable SKU found for 'body-wave' (MISSING-SKU).",
    });
  });

  it("returns 404 when no purchasable SKU exists and no sku hint is provided", async () => {
    const { app } = await loadRoutes();
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ _id: "guest_1" })
      .mockResolvedValueOnce({ _id: "bag_1" })
      .mockResolvedValueOnce({
        _id: "product_1",
        skus: [
          {
            _id: "sku_1",
            sku: "SKU-1",
            price: 0,
            quantityAvailable: 0,
          },
        ],
      });
    const runMutation = vi.fn().mockResolvedValue({});

    const response = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/e2e/checkout/bootstrap",
      {
        method: "POST",
        body: JSON.stringify({
          marker: "marker_1",
          items: [{ productSlug: "body-wave", quantity: 1 }],
        }),
      },
      {
        runMutation,
        runQuery,
      } as never
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "No purchasable SKU found for 'body-wave'.",
    });
  });

  it("returns 500 when guest actor creation fails", async () => {
    const { app } = await loadRoutes();
    const runQuery = vi.fn().mockResolvedValueOnce(null);
    const runMutation = vi.fn().mockResolvedValueOnce(null);

    const response = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/e2e/checkout/bootstrap",
      {
        method: "POST",
        body: JSON.stringify({
          marker: "marker_1",
          items: [{ productSlug: "body-wave", quantity: 1 }],
        }),
      },
      {
        runMutation,
        runQuery,
      } as never
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Unable to create guest actor.",
    });
  });

  it("returns 400 when checkout session creation fails", async () => {
    const { app } = await loadRoutes();
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ _id: "guest_1" })
      .mockResolvedValueOnce({ _id: "bag_1" })
      .mockResolvedValueOnce({
        _id: "product_1",
        skus: [{ _id: "sku_1", sku: "SKU-1", price: 100, quantityAvailable: 4 }],
      });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        success: false,
        message: "Unavailable items",
        unavailableProducts: ["product_1"],
      });

    const response = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/e2e/checkout/bootstrap",
      {
        method: "POST",
        body: JSON.stringify({
          marker: "marker_1",
          items: [{ productSlug: "body-wave", quantity: 1 }],
        }),
      },
      {
        runMutation,
        runQuery,
      } as never
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Unavailable items",
      unavailableProducts: ["product_1"],
    });
  });

  it("returns fallback checkout failure payload when message fields are missing", async () => {
    const { app } = await loadRoutes();
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ _id: "guest_1" })
      .mockResolvedValueOnce({ _id: "bag_1" })
      .mockResolvedValueOnce({
        _id: "product_1",
        skus: [{ _id: "sku_1", sku: "SKU-1", price: 100, quantityAvailable: 4 }],
      });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        success: false,
      });

    const response = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/e2e/checkout/bootstrap",
      {
        method: "POST",
        body: JSON.stringify({
          marker: "marker_1",
          items: [{ productSlug: "body-wave", quantity: 1 }],
        }),
      },
      {
        runMutation,
        runQuery,
      } as never
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Unable to create checkout session.",
      unavailableProducts: [],
    });
  });

  it("returns 500 when actor signing key is missing", async () => {
    const { app } = await loadRoutes({ signingKey: undefined });
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ _id: "guest_1" })
      .mockResolvedValueOnce({ _id: "bag_1" })
      .mockResolvedValueOnce({
        _id: "product_1",
        skus: [{ _id: "sku_1", sku: "SKU-1", price: 100, quantityAvailable: 4 }],
      });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        success: true,
        session: { _id: "checkout_1" },
      });

    const response = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/e2e/checkout/bootstrap",
      {
        method: "POST",
        body: JSON.stringify({
          marker: "marker_1",
          items: [{ productSlug: "body-wave", quantity: 1 }],
        }),
      },
      {
        runMutation,
        runQuery,
      } as never
    );

    expect(response.status).toBe(500);
  });

  it("creates a guest checkout session and returns a signed actor token", async () => {
    const { app, getActorClaims, sign } = await loadRoutes();
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        _id: "product_1",
        skus: [
          {
            _id: "sku_1",
            price: 100,
            quantityAvailable: 10,
            sku: "SKU-1",
          },
        ],
      });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "guest_1",
      })
      .mockResolvedValueOnce({
        _id: "bag_1",
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        success: true,
        session: {
          _id: "checkout_1",
        },
      });

    const response = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/e2e/checkout/bootstrap",
      {
        method: "POST",
        body: JSON.stringify({
          marker: "marker_1",
          items: [{ productSlug: "body-wave", quantity: 2 }],
        }),
      },
      {
        runMutation,
        runQuery,
      } as never
    );

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith("storeFront.checkoutSession.create", {
      amount: 20000,
      bagId: "bag_1",
      products: [
        {
          price: 100,
          productId: "product_1",
          productSku: "SKU-1",
          productSkuId: "sku_1",
          quantity: 2,
        },
      ],
      storeFrontUserId: "guest_1",
      storeId: "store_1",
    });
    expect(sign).toHaveBeenCalledTimes(1);

    expect(await response.json()).toEqual({
      actor: {
        actorId: "guest_1",
        actorType: "guest",
        organizationId: "org_1",
        requestedBy: "actor_system",
        storeId: "store_1",
      },
      actorToken: "signed-actor-token",
      bagId: "bag_1",
      checkoutPath: "/shop/checkout",
      checkoutSession: {
        _id: "checkout_1",
      },
      checkoutSessionId: "checkout_1",
      marker: "marker_1",
    });
    expect(getActorClaims).toHaveBeenCalledTimes(1);
  });
});
