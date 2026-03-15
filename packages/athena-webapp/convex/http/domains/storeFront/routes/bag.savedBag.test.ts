// @vitest-environment node

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

type RouteLoadOptions = {
  storeData?: {
    storeId?: string;
    organizationId?: string;
  };
  userId?: string | undefined;
};

async function loadBagRoutes(options: RouteLoadOptions = {}) {
  vi.resetModules();

  const hasUserOverride = Object.prototype.hasOwnProperty.call(options, "userId");
  const getStoreDataFromRequest = vi.fn().mockResolvedValue(
    options.storeData ?? { storeId: "store_1", organizationId: "org_1" }
  );
  const getStorefrontUserFromRequest = vi
    .fn()
    .mockResolvedValue(hasUserOverride ? options.userId : "guest_1");

  vi.doMock("../../../utils", () => ({
    getStoreDataFromRequest,
    getStorefrontUserFromRequest,
  }));

  const module = await import("./bag");
  const app = new Hono();
  app.route("/bags", module.bagRoutes);

  return { app };
}

async function loadSavedBagRoutes(options: RouteLoadOptions = {}) {
  vi.resetModules();

  const hasUserOverride = Object.prototype.hasOwnProperty.call(options, "userId");
  const getStoreDataFromRequest = vi.fn().mockResolvedValue(
    options.storeData ?? { storeId: "store_1", organizationId: "org_1" }
  );
  const getStorefrontUserFromRequest = vi
    .fn()
    .mockResolvedValue(hasUserOverride ? options.userId : "guest_1");

  vi.doMock("../../../utils", () => ({
    getStoreDataFromRequest,
    getStorefrontUserFromRequest,
  }));

  const module = await import("./savedBag");
  const app = new Hono();
  app.route("/saved-bags", module.savedBagRoutes);

  return { app };
}

describe("bagRoutes", () => {
  it("returns an empty object for non-active bag lookup", async () => {
    const { app } = await loadBagRoutes();
    const response = await app.request(
      "http://localhost/bags/bag_123",
      { method: "GET" },
      { runQuery: vi.fn(), runMutation: vi.fn() } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it("returns active bag when it exists", async () => {
    const { app } = await loadBagRoutes();
    const runQuery = vi.fn().mockResolvedValue({ _id: "bag_1" });
    const runMutation = vi.fn();

    const response = await app.request(
      "http://localhost/bags/active",
      { method: "GET" },
      { runQuery, runMutation } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ _id: "bag_1" });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("returns 400 when active bag query throws", async () => {
    const { app } = await loadBagRoutes();
    const response = await app.request(
      "http://localhost/bags/active",
      { method: "GET" },
      {
        runQuery: vi.fn().mockRejectedValue(new Error("query failed")),
        runMutation: vi.fn(),
      } as never
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });

  it("creates an active bag when none exists", async () => {
    const { app } = await loadBagRoutes();
    const runQuery = vi.fn().mockResolvedValue(null);
    const runMutation = vi.fn().mockResolvedValue({ _id: "bag_new" });

    const response = await app.request(
      "http://localhost/bags/active",
      { method: "GET" },
      { runQuery, runMutation } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ _id: "bag_new" });
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      storeFrontUserId: "guest_1",
      storeId: "store_1",
    });
  });

  it("returns 404 when store id is missing", async () => {
    const { app } = await loadBagRoutes({ storeData: { storeId: undefined } });
    const env = { runMutation: vi.fn(), runQuery: vi.fn() };

    const response = await app.request(
      "http://localhost/bags/active",
      { method: "GET" },
      env as never
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Store id missing" });
    expect(env.runQuery).not.toHaveBeenCalled();
  });

  it("adds and updates bag items", async () => {
    const { app } = await loadBagRoutes();
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ success: true, itemId: "item_1" })
      .mockResolvedValueOnce({ success: true });

    const addResponse = await app.request(
      "http://localhost/bags/bag_1/items",
      {
        method: "POST",
        body: JSON.stringify({
          productId: "product_1",
          productSkuId: "sku_1",
          productSku: "SKU-1",
          quantity: 2,
        }),
      },
      { runMutation, runQuery: vi.fn() } as never
    );

    const updateResponse = await app.request(
      "http://localhost/bags/bag_1/items/item_1",
      {
        method: "PUT",
        body: JSON.stringify({ quantity: 3 }),
      },
      { runMutation, runQuery: vi.fn() } as never
    );

    expect(addResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      bagId: "bag_1",
      productId: "product_1",
      productSku: "SKU-1",
      productSkuId: "sku_1",
      quantity: 2,
      storeFrontUserId: "guest_1",
    });
    expect(runMutation.mock.calls[1]?.[1]).toEqual({
      itemId: "item_1",
      quantity: 3,
    });
  });

  it("deletes one item and clears a bag", async () => {
    const { app } = await loadBagRoutes();
    const runMutation = vi.fn();

    const deleteItem = await app.request(
      "http://localhost/bags/bag_1/items/item_1",
      { method: "DELETE" },
      { runMutation, runQuery: vi.fn() } as never
    );

    const clearBag = await app.request(
      "http://localhost/bags/bag_1/items/",
      { method: "DELETE" },
      { runMutation, runQuery: vi.fn() } as never
    );

    expect(deleteItem.status).toBe(200);
    expect(clearBag.status).toBe(200);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({ itemId: "item_1" });
    expect(runMutation.mock.calls[1]?.[1]).toEqual({ id: "bag_1" });
  });

  it("returns 404 when active bag customer id is missing and handles owner update errors", async () => {
    const missingUser = await loadBagRoutes({ userId: undefined });
    const missingUserResponse = await missingUser.app.request(
      "http://localhost/bags/active",
      { method: "GET" },
      { runQuery: vi.fn(), runMutation: vi.fn() } as never
    );
    expect(missingUserResponse.status).toBe(404);
    expect(await missingUserResponse.json()).toEqual({
      error: "Customer id missing",
    });

    const { app } = await loadBagRoutes();
    const ownerFailResponse = await app.request(
      "http://localhost/bags/bag_1/owner",
      {
        method: "POST",
        body: JSON.stringify({ currentOwnerId: "guest_1", newOwnerId: "user_1" }),
      },
      {
        runQuery: vi.fn(),
        runMutation: vi.fn().mockRejectedValue(new Error("owner failed")),
      } as never
    );
    expect(ownerFailResponse.status).toBe(400);
    expect(await ownerFailResponse.json()).toEqual({
      error: "Internal server error",
    });

    const ownerOkResponse = await app.request(
      "http://localhost/bags/bag_1/owner",
      {
        method: "POST",
        body: JSON.stringify({ currentOwnerId: "guest_1", newOwnerId: "user_1" }),
      },
      {
        runQuery: vi.fn(),
        runMutation: vi.fn().mockResolvedValue({ success: true }),
      } as never
    );
    expect(ownerOkResponse.status).toBe(200);
    expect(await ownerOkResponse.json()).toEqual({ success: true });
  });
});

describe("savedBagRoutes", () => {
  it("returns an empty object for non-active saved bag lookup", async () => {
    const { app } = await loadSavedBagRoutes();
    const response = await app.request(
      "http://localhost/saved-bags/saved_123",
      { method: "GET" },
      { runQuery: vi.fn(), runMutation: vi.fn() } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it("creates an active saved bag when none exists", async () => {
    const { app } = await loadSavedBagRoutes();
    const runQuery = vi.fn().mockResolvedValue(null);
    const runMutation = vi.fn().mockResolvedValue({ _id: "saved_bag_1" });

    const response = await app.request(
      "http://localhost/saved-bags/active",
      { method: "GET" },
      { runQuery, runMutation } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ _id: "saved_bag_1" });
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      storeFrontUserId: "guest_1",
      storeId: "store_1",
    });
  });

  it("returns active saved bag when it exists and handles query failures", async () => {
    const { app } = await loadSavedBagRoutes();
    const okResponse = await app.request(
      "http://localhost/saved-bags/active",
      { method: "GET" },
      {
        runQuery: vi.fn().mockResolvedValue({ _id: "saved_bag_existing" }),
        runMutation: vi.fn(),
      } as never
    );
    expect(okResponse.status).toBe(200);
    expect(await okResponse.json()).toEqual({ _id: "saved_bag_existing" });

    const errResponse = await app.request(
      "http://localhost/saved-bags/active",
      { method: "GET" },
      {
        runQuery: vi.fn().mockRejectedValue(new Error("query failed")),
        runMutation: vi.fn(),
      } as never
    );
    expect(errResponse.status).toBe(400);
    expect(await errResponse.json()).toEqual({ error: "Internal server error" });
  });

  it("adds and updates saved bag items", async () => {
    const { app } = await loadSavedBagRoutes();
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ success: true, itemId: "saved_item_1" })
      .mockResolvedValueOnce({ success: true });

    const addResponse = await app.request(
      "http://localhost/saved-bags/saved_bag_1/items",
      {
        method: "POST",
        body: JSON.stringify({
          productId: "product_1",
          productSkuId: "sku_1",
          productSku: "SKU-1",
          quantity: 1,
        }),
      },
      { runMutation, runQuery: vi.fn() } as never
    );

    const updateResponse = await app.request(
      "http://localhost/saved-bags/saved_bag_1/items/saved_item_1",
      {
        method: "PUT",
        body: JSON.stringify({ quantity: 4 }),
      },
      { runMutation, runQuery: vi.fn() } as never
    );

    expect(addResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      productId: "product_1",
      productSku: "SKU-1",
      productSkuId: "sku_1",
      quantity: 1,
      savedBagId: "saved_bag_1",
      storeFrontUserId: "guest_1",
    });
    expect(runMutation.mock.calls[1]?.[1]).toEqual({
      itemId: "saved_item_1",
      quantity: 4,
    });
  });

  it("updates saved bag owner and returns 400 on thrown errors", async () => {
    const { app } = await loadSavedBagRoutes();
    const okEnv = {
      runMutation: vi.fn().mockResolvedValue({ success: true }),
      runQuery: vi.fn(),
    };

    const okResponse = await app.request(
      "http://localhost/saved-bags/saved_bag_1/owner",
      {
        method: "POST",
        body: JSON.stringify({
          currentOwnerId: "guest_1",
          newOwnerId: "user_1",
        }),
      },
      okEnv as never
    );

    const errorEnv = {
      runMutation: vi.fn().mockRejectedValue(new Error("boom")),
      runQuery: vi.fn(),
    };

    const errorResponse = await app.request(
      "http://localhost/saved-bags/saved_bag_1/owner",
      {
        method: "POST",
        body: JSON.stringify({
          currentOwnerId: "guest_1",
          newOwnerId: "user_1",
        }),
      },
      errorEnv as never
    );

    expect(okResponse.status).toBe(200);
    expect(errorResponse.status).toBe(400);
    expect(await errorResponse.json()).toEqual({ error: "Internal server error" });
  });

  it("deletes a saved bag item", async () => {
    const { app } = await loadSavedBagRoutes();
    const runMutation = vi.fn();

    const response = await app.request(
      "http://localhost/saved-bags/saved_bag_1/items/saved_item_1",
      { method: "DELETE" },
      { runMutation, runQuery: vi.fn() } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(runMutation.mock.calls[0]?.[1]).toEqual({ itemId: "saved_item_1" });
  });

  it("returns 404 when active saved bag customer id is missing", async () => {
    const { app } = await loadSavedBagRoutes({ userId: undefined });
    const response = await app.request(
      "http://localhost/saved-bags/active",
      { method: "GET" },
      { runQuery: vi.fn(), runMutation: vi.fn() } as never
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Customer id missing",
    });
  });

  it("returns 404 when saved bag store id is missing", async () => {
    const { app } = await loadSavedBagRoutes({
      storeData: { storeId: undefined },
    });
    const response = await app.request(
      "http://localhost/saved-bags/active",
      { method: "GET" },
      { runQuery: vi.fn(), runMutation: vi.fn() } as never
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Store id missing" });
  });
});
