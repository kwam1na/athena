// @vitest-environment node

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

async function loadStoreRoutes(authResponse: Response | null = null) {
  vi.resetModules();

  const enforceActorAccess = vi.fn().mockResolvedValue(authResponse);

  vi.doMock("../../storeFront/routes/actorAuth", () => ({
    enforceActorAccess,
  }));

  const module = await import("./stores");
  const app = new Hono();
  app.route("/orgs/:organizationId/stores", module.storeRoutes);

  return { app, enforceActorAccess, storeRoutes: module.storeRoutes };
}

async function invokeStoresHandler({
  storeRoutes,
  method,
  path,
  params,
  body,
  runAction,
  runMutation,
  runQuery,
}: {
  storeRoutes: unknown;
  method: string;
  path: string;
  params: Record<string, string | undefined>;
  body?: unknown;
  runAction?: ReturnType<typeof vi.fn>;
  runMutation?: ReturnType<typeof vi.fn>;
  runQuery?: ReturnType<typeof vi.fn>;
}) {
  const route = (storeRoutes as any).routes.find(
    (r: any) => r.method === method && r.path === path
  );
  if (!route) {
    throw new Error(`Route ${method} ${path} not found`);
  }

  const json = vi.fn((payload: unknown, status = 200) => ({ payload, status }));
  const req = {
    param: (name?: string) => {
      if (!name) return params;
      return params[name];
    },
    json: async () => body ?? {},
  };

  return route.handler({
    env: {
      runAction: runAction ?? vi.fn(),
      runMutation: runMutation ?? vi.fn(),
      runQuery: runQuery ?? vi.fn(),
    },
    json,
    req,
  });
}

describe("storeRoutes extended coverage", () => {
  it("resolves store by identifier and returns 400 when missing", async () => {
    const { app } = await loadStoreRoutes();
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ _id: "store_1", slug: "wigclub" })
      .mockResolvedValueOnce(null);

    const ok = await app.request(
      "http://localhost/orgs/org_1/stores/store_1",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery, runAction: vi.fn() } as never
    );
    const missing = await app.request(
      "http://localhost/orgs/org_1/stores/missing",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery, runAction: vi.fn() } as never
    );

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ _id: "store_1", slug: "wigclub" });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: "Store with identifier not found",
    });
  });

  it("covers placeholder CRUD endpoints and organization guard", async () => {
    const { app, storeRoutes } = await loadStoreRoutes();
    const env = { runMutation: vi.fn(), runQuery: vi.fn(), runAction: vi.fn() };

    expect(
      (
        await app.request(
          "http://localhost/orgs/org_1/stores",
          { method: "POST", body: JSON.stringify({ name: "Store" }) },
          env as never
        )
      ).status
    ).toBe(200);
    expect(
      (
        await app.request(
          "http://localhost/orgs/org_1/stores",
          { method: "GET" },
          env as never
        )
      ).status
    ).toBe(200);
    expect(
      (
        await app.request(
          "http://localhost/orgs/org_1/stores/store_1",
          { method: "PUT", body: JSON.stringify({ name: "Updated" }) },
          env as never
        )
      ).status
    ).toBe(200);
    expect(
      (
        await app.request(
          "http://localhost/orgs/org_1/stores/store_1",
          { method: "DELETE" },
          env as never
        )
      ).status
    ).toBe(200);

    const missingOrg = await new Hono().route("/stores", storeRoutes).request(
      "http://localhost/stores/store_1",
      { method: "GET" },
      env as never
    );
    expect(missingOrg.status).toBe(404);
    expect(await missingOrg.json()).toEqual({ error: "Organization id missing" });
  });

  it("handles store auth verification flows", async () => {
    const { app } = await loadStoreRoutes();
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ verified: true })
      .mockRejectedValueOnce(new Error("invalid code"));
    const runAction = vi.fn().mockResolvedValue({ sent: true });

    const withCode = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/auth/verify",
      {
        method: "POST",
        body: JSON.stringify({ email: "ada@example.com", code: "123456" }),
      },
      { runMutation, runQuery: vi.fn(), runAction } as never
    );
    const badCode = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/auth/verify",
      {
        method: "POST",
        body: JSON.stringify({ email: "ada@example.com", code: "000000" }),
      },
      { runMutation, runQuery: vi.fn(), runAction } as never
    );
    const sendCode = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/auth/verify",
      {
        method: "POST",
        body: JSON.stringify({
          email: "ada@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
        }),
      },
      { runMutation, runQuery: vi.fn(), runAction } as never
    );
    const empty = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/auth/verify",
      { method: "POST", body: JSON.stringify({}) },
      { runMutation, runQuery: vi.fn(), runAction } as never
    );

    expect(withCode.status).toBe(200);
    expect(badCode.status).toBe(400);
    expect(await badCode.json()).toEqual({ error: "invalid code" });
    expect(sendCode.status).toBe(200);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({});
  });

  it("enforces middleware on protected user-scoped routes", async () => {
    const forbidden = new Response(JSON.stringify({ error: "Forbidden." }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
    const { app, enforceActorAccess } = await loadStoreRoutes(forbidden);

    const direct = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn(), runAction: vi.fn() } as never
    );
    const nested = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/bags/active",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn(), runAction: vi.fn() } as never
    );

    expect(enforceActorAccess).toHaveBeenCalled();
    expect(direct.status).toBe(403);
    expect(nested.status).toBe(403);
  });

  it("allows middleware pass-through when actor access succeeds", async () => {
    const { app, enforceActorAccess } = await loadStoreRoutes(null);
    const response = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn(), runAction: vi.fn() } as never
    );

    expect(enforceActorAccess).toHaveBeenCalled();
    expect(response.status).toBe(404);
  });

  it("covers owner transfer and checkout action branches", async () => {
    const { app } = await loadStoreRoutes();
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });
    const runAction = vi
      .fn()
      .mockResolvedValueOnce({ authorization_url: "https://pay.example/tx" })
      .mockResolvedValueOnce({ success: true });

    const bagOwnerForbidden = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/bags/bag_1/owner",
      {
        method: "POST",
        body: JSON.stringify({ currentOwnerId: "guest_1", newOwnerId: "user_1" }),
      },
      { runMutation, runQuery: vi.fn(), runAction } as never
    );
    const bagOwnerOk = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/bags/bag_1/owner",
      {
        method: "POST",
        body: JSON.stringify({ currentOwnerId: "user_1", newOwnerId: "user_2" }),
      },
      { runMutation, runQuery: vi.fn(), runAction } as never
    );
    const savedOwnerForbidden = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/savedBags/saved_1/owner",
      {
        method: "POST",
        body: JSON.stringify({ currentOwnerId: "guest_1", newOwnerId: "user_1" }),
      },
      { runMutation, runQuery: vi.fn(), runAction } as never
    );
    const savedOwnerOk = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/savedBags/saved_1/owner",
      {
        method: "POST",
        body: JSON.stringify({ currentOwnerId: "user_1", newOwnerId: "user_2" }),
      },
      { runMutation, runQuery: vi.fn(), runAction } as never
    );
    const finalize = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/checkout/session_1",
      {
        method: "POST",
        body: JSON.stringify({
          action: "finalize-payment",
          customerEmail: "ada@example.com",
          amount: 10000,
          orderDetails: { deliveryMethod: "delivery" },
        }),
      },
      { runMutation, runQuery: vi.fn(), runAction } as never
    );
    const complete = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/checkout/session_1",
      {
        method: "POST",
        body: JSON.stringify({
          action: "complete-checkout",
          hasCompletedCheckoutSession: true,
          orderDetails: { deliveryMethod: "delivery" },
        }),
      },
      { runMutation, runQuery: vi.fn(), runAction } as never
    );
    const place = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/checkout/session_1",
      {
        method: "POST",
        body: JSON.stringify({
          action: "place-order",
          hasCompletedCheckoutSession: true,
        }),
      },
      { runMutation, runQuery: vi.fn(), runAction } as never
    );
    const cancel = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/checkout/session_1",
      { method: "POST", body: JSON.stringify({ action: "cancel-order" }) },
      { runMutation, runQuery: vi.fn(), runAction } as never
    );
    const defaultAction = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/checkout/session_1",
      { method: "POST", body: JSON.stringify({ action: "unknown-action" }) },
      { runMutation, runQuery: vi.fn(), runAction } as never
    );

    expect(bagOwnerForbidden.status).toBe(403);
    expect(bagOwnerOk.status).toBe(200);
    expect(savedOwnerForbidden.status).toBe(403);
    expect(savedOwnerOk.status).toBe(200);
    expect(finalize.status).toBe(200);
    expect(complete.status).toBe(200);
    expect(place.status).toBe(200);
    expect(cancel.status).toBe(200);
    expect(await defaultAction.json()).toEqual({});
  });

  it("covers bag/saved-bag placeholders and active-existing branches", async () => {
    const { app } = await loadStoreRoutes();
    const env = {
      runMutation: vi.fn().mockResolvedValue({ success: true }),
      runQuery: vi.fn().mockResolvedValue({ _id: "existing" }),
      runAction: vi.fn(),
    };

    const endpoints = [
      ["GET", "http://localhost/orgs/org_1/stores/store_1/users"],
      ["GET", "http://localhost/orgs/org_1/stores/store_1/users/user_1/bags/bag_1"],
      ["POST", "http://localhost/orgs/org_1/stores/store_1/users/user_1/bags"],
      ["DELETE", "http://localhost/orgs/org_1/stores/store_1/users/user_1/bags/bag_1"],
      ["GET", "http://localhost/orgs/org_1/stores/store_1/users/user_1/bags/bag_1/items"],
      ["POST", "http://localhost/orgs/org_1/stores/store_1/users/user_1/bags/bag_1/items"],
      ["PUT", "http://localhost/orgs/org_1/stores/store_1/users/user_1/bags/bag_1/items/item_1"],
      ["DELETE", "http://localhost/orgs/org_1/stores/store_1/users/user_1/bags/bag_1/items/item_1"],
      ["GET", "http://localhost/orgs/org_1/stores/store_1/users/user_1/savedBags/saved_1"],
      ["POST", "http://localhost/orgs/org_1/stores/store_1/users/user_1/savedBags"],
      ["DELETE", "http://localhost/orgs/org_1/stores/store_1/users/user_1/savedBags/saved_1"],
      ["GET", "http://localhost/orgs/org_1/stores/store_1/users/user_1/savedBags/saved_1/items"],
      ["POST", "http://localhost/orgs/org_1/stores/store_1/users/user_1/savedBags/saved_1/items"],
      ["PUT", "http://localhost/orgs/org_1/stores/store_1/users/user_1/savedBags/saved_1/items/item_1"],
      ["DELETE", "http://localhost/orgs/org_1/stores/store_1/users/user_1/savedBags/saved_1/items/item_1"],
      ["GET", "http://localhost/orgs/org_1/stores/store_1/users/user_1/bags/active"],
      ["GET", "http://localhost/orgs/org_1/stores/store_1/users/user_1/savedBags/active"],
    ] as const;

    for (const [method, url] of endpoints) {
      const response = await app.request(
        url,
        {
          method,
          body:
            method === "POST" || method === "PUT"
              ? JSON.stringify({
                  userId: "user_1",
                  productId: "product_1",
                  productSkuId: "sku_1",
                  productSku: "SKU-1",
                  quantity: 1,
                })
              : undefined,
        },
        env as never
      );
      expect(response.status).toBe(200);
    }

    const savedBagCreatePath = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/savedBags/active",
      { method: "GET" },
      {
        runMutation: vi.fn().mockResolvedValue({ _id: "saved_bag_new" }),
        runQuery: vi.fn().mockResolvedValue(null),
        runAction: vi.fn(),
      } as never
    );
    expect(savedBagCreatePath.status).toBe(200);
    expect(await savedBagCreatePath.json()).toEqual({ _id: "saved_bag_new" });
  });

  it("covers checkout creation and owner-transfer catch paths", async () => {
    const { app } = await loadStoreRoutes();

    const checkoutOk = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/checkout",
      {
        method: "POST",
        body: JSON.stringify({ products: [], bagId: "bag_1", amount: 100 }),
      },
      {
        runMutation: vi.fn().mockResolvedValue({ _id: "session_1" }),
        runQuery: vi.fn(),
        runAction: vi.fn(),
      } as never
    );
    expect(checkoutOk.status).toBe(200);

    const checkoutFail = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/checkout",
      {
        method: "POST",
        body: JSON.stringify({ products: [], bagId: "bag_1", amount: 100 }),
      },
      {
        runMutation: vi.fn().mockRejectedValue(new Error("checkout failed")),
        runQuery: vi.fn(),
        runAction: vi.fn(),
      } as never
    );
    expect(checkoutFail.status).toBe(400);
    expect(await checkoutFail.json()).toEqual({ error: "checkout failed" });

    const ownerCatch = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/orders/owner",
      {
        method: "POST",
        body: JSON.stringify({ currentOwnerId: "user_1", newOwnerId: "user_2" }),
      },
      {
        runMutation: vi.fn().mockRejectedValue(new Error("owner failed")),
        runQuery: vi.fn(),
        runAction: vi.fn(),
      } as never
    );
    expect(ownerCatch.status).toBe(400);

    const bagOwnerCatch = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/bags/bag_1/owner",
      {
        method: "POST",
        body: JSON.stringify({ currentOwnerId: "user_1", newOwnerId: "user_2" }),
      },
      {
        runMutation: vi.fn().mockRejectedValue(new Error("owner failed")),
        runQuery: vi.fn(),
        runAction: vi.fn(),
      } as never
    );
    expect(bagOwnerCatch.status).toBe(400);

    const savedOwnerCatch = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/savedBags/saved_1/owner",
      {
        method: "POST",
        body: JSON.stringify({ currentOwnerId: "user_1", newOwnerId: "user_2" }),
      },
      {
        runMutation: vi.fn().mockRejectedValue(new Error("owner failed")),
        runQuery: vi.fn(),
        runAction: vi.fn(),
      } as never
    );
    expect(savedOwnerCatch.status).toBe(400);

    const checkoutActionCatch = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/checkout/session_1",
      {
        method: "POST",
        body: JSON.stringify({
          action: "finalize-payment",
          customerEmail: "ada@example.com",
          amount: 1000,
          orderDetails: {},
        }),
      },
      {
        runMutation: vi.fn(),
        runQuery: vi.fn(),
        runAction: vi.fn().mockRejectedValue(new Error("payment fail")),
      } as never
    );
    expect(checkoutActionCatch.status).toBe(400);
  });

  it("covers undefined user-id guards by direct handler invocation", async () => {
    const { storeRoutes } = await loadStoreRoutes();

    const bagGuard = await invokeStoresHandler({
      storeRoutes,
      method: "GET",
      path: "/:storeId/users/:userId/bags/:bagId",
      params: { storeId: "store_1", userId: undefined, bagId: "active" },
      runMutation: vi.fn(),
      runQuery: vi.fn(),
    });
    expect(bagGuard).toEqual({
      payload: { error: "Customer id missing" },
      status: 404,
    });

    const checkoutCreateGuard = await invokeStoresHandler({
      storeRoutes,
      method: "POST",
      path: "/:storeId/users/:userId/checkout",
      params: { storeId: "store_1", userId: undefined },
      body: {},
      runMutation: vi.fn(),
    });
    expect(checkoutCreateGuard).toEqual({
      payload: { error: "Customer id missing" },
      status: 404,
    });

    const checkoutUpdateGuard = await invokeStoresHandler({
      storeRoutes,
      method: "POST",
      path: "/:storeId/users/:userId/checkout/:checkoutSessionId",
      params: {
        storeId: "store_1",
        userId: undefined,
        checkoutSessionId: "session_1",
      },
      body: {},
      runMutation: vi.fn(),
      runAction: vi.fn(),
    });
    expect(checkoutUpdateGuard).toEqual({
      payload: { error: "Customer id missing" },
      status: 404,
    });

    const savedBagGuard = await invokeStoresHandler({
      storeRoutes,
      method: "GET",
      path: "/:storeId/users/:userId/savedBags/:savedBagId",
      params: { storeId: "store_1", userId: undefined, savedBagId: "active" },
      runMutation: vi.fn(),
      runQuery: vi.fn(),
    });
    expect(savedBagGuard).toEqual({
      payload: { error: "Customer id missing" },
      status: 404,
    });
  });

  it("handles order and checkout lookup endpoints", async () => {
    const { app } = await loadStoreRoutes();
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ _id: "active_1" })
      .mockResolvedValueOnce([{ _id: "pending_1" }])
      .mockResolvedValueOnce({ _id: "session_1" })
      .mockResolvedValueOnce([{ _id: "order_1" }])
      .mockResolvedValueOnce({ _id: "order_1" });
    const runAction = vi
      .fn()
      .mockResolvedValueOnce({ verified: true })
      .mockResolvedValueOnce({ success: true });
    const runMutation = vi.fn().mockResolvedValue({ success: true });

    const active = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/checkout/active",
      { method: "GET" },
      { runMutation, runQuery, runAction } as never
    );
    const pending = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/checkout/pending",
      { method: "GET" },
      { runMutation, runQuery, runAction } as never
    );
    const session = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/checkout/session_1",
      { method: "GET" },
      { runMutation, runQuery, runAction } as never
    );
    const verify = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/checkout/verify/ref_1",
      { method: "GET" },
      { runMutation, runQuery, runAction } as never
    );
    const orders = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/orders",
      { method: "GET" },
      { runMutation, runQuery, runAction } as never
    );
    const order = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/orders/order_1",
      { method: "GET" },
      { runMutation, runQuery, runAction } as never
    );
    const ownerForbidden = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/orders/owner",
      {
        method: "POST",
        body: JSON.stringify({ currentOwnerId: "guest_1", newOwnerId: "user_1" }),
      },
      { runMutation, runQuery, runAction } as never
    );
    const ownerOk = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/users/user_1/orders/owner",
      {
        method: "POST",
        body: JSON.stringify({ currentOwnerId: "user_1", newOwnerId: "user_2" }),
      },
      { runMutation, runQuery, runAction } as never
    );

    expect(active.status).toBe(200);
    expect(pending.status).toBe(200);
    expect(session.status).toBe(200);
    expect(verify.status).toBe(200);
    expect(orders.status).toBe(200);
    expect(order.status).toBe(200);
    expect(ownerForbidden.status).toBe(403);
    expect(ownerOk.status).toBe(200);
  });
});
