// @vitest-environment node

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { analyticsRoutes } from "./analytics";
import { authRoutes } from "./auth";
import { bannerMessageRoutes } from "./bannerMessage";
import { categoryRoutes } from "./categories";
import { colorRoutes } from "./colors";
import { orgRoutes } from "./organizations";
import { subcategoryRoutes } from "./subcategories";
import * as inventoryIndex from "./index";

function cookieHeader(values: Record<string, string>) {
  return Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

describe("analyticsRoutes", () => {
  const app = new Hono().route("/analytics", analyticsRoutes);

  it("validates storefront user and store context", async () => {
    const missingUser = await app.request(
      "http://localhost/analytics",
      {
        method: "POST",
        headers: { Cookie: cookieHeader({ store_id: "store_1", organization_id: "org_1" }) },
        body: JSON.stringify({ action: "view", origin: "storefront", data: {} }),
      },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    const missingStore = await app.request(
      "http://localhost/analytics",
      {
        method: "POST",
        headers: { Cookie: cookieHeader({ guest_id: "guest_1" }) },
        body: JSON.stringify({ action: "view", origin: "storefront", data: {} }),
      },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(missingUser.status).toBe(400);
    expect(await missingUser.json()).toEqual({ error: "Customer id missing" });
    expect(missingStore.status).toBe(400);
    expect(await missingStore.json()).toEqual({
      error: "Store or organization id missing",
    });
  });

  it("creates analytics records and supports owner updates/view counts", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });
    const runQuery = vi.fn().mockResolvedValueOnce(42);
    const headers = {
      Cookie: cookieHeader({
        guest_id: "guest_1",
        store_id: "store_1",
        organization_id: "org_1",
      }),
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    };

    const createResponse = await app.request(
      "http://localhost/analytics",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "view-product",
          origin: "product-page",
          data: { ref: "homepage" },
          productId: "product_1",
        }),
      },
      { runMutation, runQuery } as never
    );

    const updateOwnerResponse = await app.request(
      "http://localhost/analytics/update-owner",
      {
        method: "POST",
        body: JSON.stringify({ guestId: "guest_1", userId: "user_1" }),
      },
      { runMutation, runQuery } as never
    );

    const countResponse = await app.request(
      "http://localhost/analytics/product-view-count?productId=product_1",
      { method: "GET" },
      { runMutation, runQuery } as never
    );

    expect(createResponse.status).toBe(200);
    expect(updateOwnerResponse.status).toBe(200);
    expect(countResponse.status).toBe(200);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      action: "view-product",
      data: { ref: "homepage" },
      device: "mobile",
      origin: "product-page",
      productId: "product_1",
      storeFrontUserId: "guest_1",
      storeId: "store_1",
    });
    expect(runMutation.mock.calls[1]?.[1]).toEqual({
      guestId: "guest_1",
      userId: "user_1",
    });
    expect(runQuery.mock.calls[0]?.[1]).toEqual({ productId: "product_1" });
  });

  it("records desktop analytics when user-agent is not mobile", async () => {
    const runMutation = vi.fn().mockResolvedValue({ success: true });
    const response = await app.request(
      "http://localhost/analytics",
      {
        method: "POST",
        headers: {
          Cookie: cookieHeader({
            guest_id: "guest_1",
            store_id: "store_1",
            organization_id: "org_1",
          }),
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1)",
        },
        body: JSON.stringify({
          action: "view-product",
          origin: "product-page",
          data: {},
          productId: "product_1",
        }),
      },
      { runMutation, runQuery: vi.fn() } as never
    );

    expect(response.status).toBe(200);
    expect(runMutation.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ device: "desktop" })
    );
  });

  it("validates update-owner and product-view-count payloads and handles errors", async () => {
    const missingIds = await app.request(
      "http://localhost/analytics/update-owner",
      {
        method: "POST",
        body: JSON.stringify({ guestId: "guest_1" }),
      },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    const errorUpdate = await app.request(
      "http://localhost/analytics/update-owner",
      {
        method: "POST",
        body: JSON.stringify({ guestId: "guest_1", userId: "user_1" }),
      },
      { runMutation: vi.fn().mockRejectedValue(new Error("boom")), runQuery: vi.fn() } as never
    );
    const missingProduct = await app.request(
      "http://localhost/analytics/product-view-count",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(missingIds.status).toBe(400);
    expect(errorUpdate.status).toBe(500);
    expect(missingProduct.status).toBe(400);
  });
});

describe("authRoutes", () => {
  const app = new Hono().route("/auth", authRoutes);

  it("sends verification code when email is present and returns empty payload otherwise", async () => {
    const runAction = vi.fn().mockResolvedValue({ success: true });
    const withEmail = await app.request(
      "http://localhost/auth/verify",
      {
        method: "POST",
        body: JSON.stringify({
          email: "ada@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
        }),
      },
      { runAction, runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    const empty = await app.request(
      "http://localhost/auth/verify",
      { method: "POST", body: JSON.stringify({}) },
      { runAction, runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(withEmail.status).toBe(200);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({});
    expect(runAction.mock.calls[0]?.[1]).toEqual({
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });
});

describe("banner/category/color/subcategory routes", () => {
  const bannerApp = new Hono().route("/banner", bannerMessageRoutes);
  const categoryApp = new Hono().route("/categories", categoryRoutes);
  const colorApp = new Hono().route("/colors", colorRoutes);
  const subcategoryApp = new Hono().route(
    "/orgs/:organizationId/stores/:storeId/subcategories",
    subcategoryRoutes
  );

  it("handles banner message lookups", async () => {
    const missingStore = await bannerApp.request(
      "http://localhost/banner",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    const runQuery = vi.fn().mockResolvedValue({ text: "Welcome" });
    const ok = await bannerApp.request(
      "http://localhost/banner",
      {
        method: "GET",
        headers: { Cookie: cookieHeader({ store_id: "store_1" }) },
      },
      { runMutation: vi.fn(), runQuery } as never
    );

    expect(missingStore.status).toBe(400);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ bannerMessage: { text: "Welcome" } });
  });

  it("handles category and color queries", async () => {
    const categoryMissingStore = await categoryApp.request(
      "http://localhost/categories",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    const categoryQuery = vi
      .fn()
      .mockResolvedValueOnce([{ _id: "cat_1" }])
      .mockResolvedValueOnce([{ _id: "cat_2" }]);

    const withSubs = await categoryApp.request(
      "http://localhost/categories?withSubcategories=true",
      {
        method: "GET",
        headers: { Cookie: cookieHeader({ store_id: "store_1" }) },
      },
      { runMutation: vi.fn(), runQuery: categoryQuery } as never
    );

    const withoutSubs = await categoryApp.request(
      "http://localhost/categories",
      {
        method: "GET",
        headers: { Cookie: cookieHeader({ store_id: "store_1" }) },
      },
      { runMutation: vi.fn(), runQuery: categoryQuery } as never
    );

    const colorMissingStore = await colorApp.request(
      "http://localhost/colors",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    const colorQuery = vi.fn().mockResolvedValue([{ _id: "color_1" }]);
    const colorOk = await colorApp.request(
      "http://localhost/colors",
      {
        method: "GET",
        headers: { Cookie: cookieHeader({ store_id: "store_1" }) },
      },
      { runMutation: vi.fn(), runQuery: colorQuery } as never
    );

    expect(categoryMissingStore.status).toBe(400);
    expect(withSubs.status).toBe(200);
    expect(withoutSubs.status).toBe(200);
    expect(colorMissingStore.status).toBe(400);
    expect(colorOk.status).toBe(200);
  });

  it("handles subcategory retrieval with and without required params", async () => {
    const missing = await new Hono()
      .route("/subcategories", subcategoryRoutes)
      .request(
        "http://localhost/subcategories",
        { method: "GET" },
        { runMutation: vi.fn(), runQuery: vi.fn() } as never
      );

    const runQuery = vi.fn().mockResolvedValue([{ _id: "sub_1" }]);
    const ok = await subcategoryApp.request(
      "http://localhost/orgs/org_1/stores/store_1/subcategories?categoryId=cat_1",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery } as never
    );

    expect(missing.status).toBe(400);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ subcategories: [{ _id: "sub_1" }] });
    expect(runQuery.mock.calls[0]?.[1]).toEqual({
      storeId: "store_1",
      categoryId: "cat_1",
    });
  });

  it("covers placeholder subcategory mutation/detail routes", async () => {
    const app = new Hono().route(
      "/orgs/:organizationId/stores/:storeId/subcategories",
      subcategoryRoutes
    );
    const env = { runMutation: vi.fn(), runQuery: vi.fn() };

    const create = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/subcategories",
      { method: "POST", body: JSON.stringify({ name: "Lace Front" }) },
      env as never
    );
    const update = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/subcategories/sub_1",
      { method: "PUT", body: JSON.stringify({ name: "Updated" }) },
      env as never
    );
    const getOne = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/subcategories/sub_1",
      { method: "GET" },
      env as never
    );
    const del = await app.request(
      "http://localhost/orgs/org_1/stores/store_1/subcategories/sub_1",
      { method: "DELETE" },
      env as never
    );

    expect(create.status).toBe(200);
    expect(update.status).toBe(200);
    expect(getOne.status).toBe(200);
    expect(del.status).toBe(200);
    expect(await create.json()).toEqual({});
    expect(await update.json()).toEqual({});
    expect(await getOne.json()).toEqual({});
    expect(await del.json()).toEqual({});
  });
});

describe("orgRoutes and inventory index exports", () => {
  const app = new Hono().route("/orgs", orgRoutes);

  it("returns placeholder responses for org endpoints", async () => {
    const env = { runMutation: vi.fn(), runQuery: vi.fn() };

    const res1 = await app.request(
      "http://localhost/orgs",
      { method: "POST", body: JSON.stringify({ name: "Org" }) },
      env as never
    );
    const res2 = await app.request(
      "http://localhost/orgs/org_1",
      { method: "PUT", body: JSON.stringify({ name: "Org2" }) },
      env as never
    );
    const res3 = await app.request(
      "http://localhost/orgs/org_1",
      { method: "GET" },
      env as never
    );
    const res4 = await app.request(
      "http://localhost/orgs/users/me/organizations",
      { method: "GET" },
      env as never
    );
    const res5 = await app.request(
      "http://localhost/orgs/org_1",
      { method: "DELETE" },
      env as never
    );

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(200);
    expect(res4.status).toBe(200);
    expect(res5.status).toBe(200);
    expect(await res1.json()).toEqual({});
    expect(await res2.json()).toEqual({});
    expect(await res3.json()).toEqual({});
    expect(await res4.json()).toEqual({});
    expect(await res5.json()).toEqual({});
  });

  it("re-exports inventory route modules from index.ts", () => {
    expect(inventoryIndex).toHaveProperty("analyticsRoutes");
    expect(inventoryIndex).toHaveProperty("authRoutes");
    expect(inventoryIndex).toHaveProperty("bannerMessageRoutes");
    expect(inventoryIndex).toHaveProperty("categoryRoutes");
    expect(inventoryIndex).toHaveProperty("orgRoutes");
    expect(inventoryIndex).toHaveProperty("productRoutes");
    expect(inventoryIndex).toHaveProperty("storeRoutes");
    expect(inventoryIndex).toHaveProperty("subcategoryRoutes");
  });
});
