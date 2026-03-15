// @vitest-environment node

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

async function loadStorefrontRoutes({
  userId,
}: {
  userId?: string | undefined;
} = {}) {
  vi.resetModules();

  const setCookie = vi.fn();
  const getStorefrontUserFromRequest = vi.fn().mockResolvedValue(userId);

  vi.doMock("hono/cookie", () => ({
    setCookie,
  }));
  vi.doMock("../../../utils", () => ({
    getStorefrontUserFromRequest,
  }));

  const module = await import("./storefront");
  const app = new Hono();
  app.route("/storefront", module.storefrontRoutes);

  return { app, setCookie };
}

async function loadUserRoutes(authResponse: Response | null = null) {
  vi.resetModules();

  const enforceActorAccess = vi.fn().mockResolvedValue(authResponse);

  vi.doMock("./actorAuth", () => ({
    enforceActorAccess,
  }));

  const module = await import("./user");
  const app = new Hono();
  app.route(
    "/organizations/:organizationId/stores/:storeId/users",
    module.userRoutes
  );

  return { app, enforceActorAccess };
}

describe("storefrontRoutes", () => {
  it("returns 404 when storeName is missing", async () => {
    const { app } = await loadStorefrontRoutes();
    const response = await app.request(
      "http://localhost/storefront",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Store name missing" });
  });

  it("creates guest context for new users and sets cookies", async () => {
    const { app, setCookie } = await loadStorefrontRoutes();
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "store_1",
        organizationId: "org_1",
      })
      .mockResolvedValueOnce(null);
    const runMutation = vi.fn().mockResolvedValue({
      _id: "guest_1",
      marker: "marker_1",
    });

    const response = await app.request(
      "http://localhost/storefront?storeName=wigclub&asNewUser=true&marker=marker_1",
      { method: "GET" },
      { runMutation, runQuery } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      _id: "store_1",
      organizationId: "org_1",
    });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      creationOrigin: "storefront",
      marker: "marker_1",
      organizationId: "org_1",
      storeId: "store_1",
    });
    expect(setCookie).toHaveBeenCalledTimes(3);
    expect(setCookie.mock.calls[0]?.[1]).toBe("guest_id");
    expect(setCookie.mock.calls[1]?.[1]).toBe("organization_id");
    expect(setCookie.mock.calls[2]?.[1]).toBe("store_id");
  });

  it("validates and returns batch inventory", async () => {
    const { app } = await loadStorefrontRoutes({ userId: "user_1" });
    const invalidResponse = await app.request(
      "http://localhost/storefront/inventory/batch",
      { method: "POST", body: JSON.stringify({}) },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    const runQuery = vi.fn().mockResolvedValue([{ skuId: "sku_1", quantity: 5 }]);
    const okResponse = await app.request(
      "http://localhost/storefront/inventory/batch",
      { method: "POST", body: JSON.stringify({ skuIds: ["sku_1"] }) },
      { runMutation: vi.fn(), runQuery } as never
    );

    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toEqual({ error: "skuIds array is required" });
    expect(okResponse.status).toBe(200);
    expect(await okResponse.json()).toEqual({
      inventory: [{ skuId: "sku_1", quantity: 5 }],
    });
    expect(runQuery.mock.calls[0]?.[1]).toEqual({ skuIds: ["sku_1"] });
  });

  it("returns 500 when batch inventory query fails", async () => {
    const { app } = await loadStorefrontRoutes({ userId: "user_1" });
    const response = await app.request(
      "http://localhost/storefront/inventory/batch",
      { method: "POST", body: JSON.stringify({ skuIds: ["sku_1"] }) },
      {
        runMutation: vi.fn(),
        runQuery: vi.fn().mockRejectedValue(new Error("inventory down")),
      } as never
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to fetch inventory data",
    });
  });
});

describe("userRoutes", () => {
  it("short-circuits when actor auth fails", async () => {
    const unauthorized = new Response(
      JSON.stringify({ error: "Forbidden." }),
      {
        status: 403,
        headers: { "content-type": "application/json" },
      }
    );
    const { app, enforceActorAccess } = await loadUserRoutes(unauthorized);
    const env = { runMutation: vi.fn(), runQuery: vi.fn() };

    const response = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/users/user_1",
      { method: "GET" },
      env as never
    );

    expect(enforceActorAccess).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden." });
    expect(env.runQuery).not.toHaveBeenCalled();
  });

  it("enforces actor auth on wildcard sub-paths", async () => {
    const unauthorized = new Response(
      JSON.stringify({ error: "Forbidden." }),
      {
        status: 403,
        headers: { "content-type": "application/json" },
      }
    );
    const { app, enforceActorAccess } = await loadUserRoutes(unauthorized);
    const response = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/users/user_1/orders",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(enforceActorAccess).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(403);
  });

  it("gets and updates a user when actor access is allowed", async () => {
    const { app } = await loadUserRoutes(null);
    const runQuery = vi.fn().mockResolvedValue({ _id: "user_1" });
    const runMutation = vi.fn().mockResolvedValue({ _id: "user_1", firstName: "Ada" });

    const getResponse = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/users/user_1",
      { method: "GET" },
      { runMutation, runQuery } as never
    );
    const putResponse = await app.request(
      "http://localhost/organizations/org_1/stores/store_1/users/user_1",
      {
        method: "PUT",
        body: JSON.stringify({
          email: "ada@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
          phoneNumber: "5555551234",
          shippingAddress: { city: "Austin" },
          billingAddress: { city: "Austin" },
        }),
      },
      { runMutation, runQuery } as never
    );

    expect(getResponse.status).toBe(200);
    expect(putResponse.status).toBe(200);
    expect(runQuery.mock.calls[0]?.[1]).toEqual({ id: "user_1" });
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      billingAddress: { city: "Austin" },
      email: "ada@example.com",
      firstName: "Ada",
      id: "user_1",
      lastName: "Lovelace",
      phoneNumber: "5555551234",
      shippingAddress: { city: "Austin" },
    });
  });
});
