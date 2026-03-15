// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

async function loadStoresRoute() {
  vi.resetModules();

  vi.doMock("../../../../_generated/api", () => ({
    api: {
      inventory: {
        stores: {
          getByIdOrSlug: "inventory.stores.getByIdOrSlug",
        },
      },
      storeFront: {
        bag: {
          getByUserId: "storeFront.bag.getByUserId",
          create: "storeFront.bag.create",
          updateOwner: "storeFront.bag.updateOwner",
        },
        bagItem: {
          addItemToBag: "storeFront.bagItem.addItemToBag",
          updateItemInBag: "storeFront.bagItem.updateItemInBag",
          deleteItemFromBag: "storeFront.bagItem.deleteItemFromBag",
        },
        auth: {
          verifyCode: "storeFront.auth.verifyCode",
          sendVerificationCodeViaProvider:
            "storeFront.auth.sendVerificationCodeViaProvider",
        },
      },
    },
    internal: {},
  }));

  vi.doMock("../../storeFront/routes/actorAuth", () => ({
    enforceActorAccess: vi.fn().mockResolvedValue(null),
    getActorClaims: vi.fn().mockResolvedValue(null),
  }));

    const module = await import("./stores");
    const app = new Hono();
    app.route("/orgs/:organizationId/stores", module.storeRoutes);
    return app;
}

async function loadProductsRoute() {
  vi.resetModules();

  vi.doMock("../../../../_generated/api", () => ({
    api: {
      inventory: {
        productUtil: {
          getAllProducts: "inventory.productUtil.getAllProducts",
        },
        products: {
          getByIdOrSlug: "inventory.products.getByIdOrSlug",
        },
        bestSeller: {
          getAll: "inventory.bestSeller.getAll",
        },
        featuredItem: {
          getAll: "inventory.featuredItem.getAll",
        },
      },
    },
  }));

  vi.doMock("../../storeFront/routes/actorAuth", () => ({
    getActorClaims: vi.fn().mockResolvedValue(null),
  }));

    const module = await import("./products");
    const app = new Hono();
    app.route("/stores/:storeId/products", module.productRoutes);
    return app;
}

describe("inventory HTTP routes", () => {
  it("resolves a store by slug within an organization", async () => {
    const storeRoutes = await loadStoresRoute();
    const env = {
      runQuery: vi.fn().mockResolvedValue({
        _id: "store_1",
        slug: "accra-store",
      }),
    };

    const response = await storeRoutes.request(
      "http://localhost/orgs/org_1/stores/accra-store",
      {
        method: "GET",
      },
      env as never
    );

    expect(env.runQuery).toHaveBeenCalledWith("inventory.stores.getByIdOrSlug", {
      identifier: "accra-store",
      organizationId: "org_1",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      _id: "store_1",
      slug: "accra-store",
    });
  });

  it("creates an active bag on demand for a store user", async () => {
    const storeRoutes = await loadStoresRoute();
    const env = {
      runQuery: vi.fn().mockResolvedValue(null),
      runMutation: vi.fn().mockResolvedValue({
        _id: "bag_1",
        storeFrontUserId: "guest_1",
      }),
    };

    const response = await storeRoutes.request(
      "http://localhost/orgs/org_1/stores/store_1/users/guest_1/bags/active",
      {
        method: "GET",
      },
      env as never
    );

    expect(env.runQuery).toHaveBeenCalledWith("storeFront.bag.getByUserId", {
      storeFrontUserId: "guest_1",
    });
    expect(env.runMutation).toHaveBeenCalledWith("storeFront.bag.create", {
      storeFrontUserId: "guest_1",
      storeId: "store_1",
    });
    expect(await response.json()).toEqual({
      _id: "bag_1",
      storeFrontUserId: "guest_1",
    });
  });

  it("parses product filter query params and forwards them to the inventory query", async () => {
    const productRoutes = await loadProductsRoute();
    const env = {
      runAction: vi.fn().mockResolvedValue([{ _id: "product_1" }]),
      runQuery: vi.fn().mockResolvedValue([{ _id: "product_1" }]),
    };

    const response = await productRoutes.request(
      "http://localhost/stores/store_1/products?color=color_1,color_2&length=12,16&category=wigs&subcategory=lace-front",
      {
        method: "GET",
        headers: {
          Cookie: "store_id=store_1",
        },
      },
      env as never
    );

    expect(env.runAction).toHaveBeenCalledWith(
      "inventory.productUtil.getAllProducts",
      {
      storeId: "store_1",
      color: ["color_1", "color_2"],
      length: [12, 16],
      category: ["wigs"],
      subcategory: ["lace-front"],
      isVisible: false,
    }
    );
    expect(await response.json()).toEqual({
      products: [{ _id: "product_1" }],
    });
  });

  it("returns a product by slug and a 400 when not found", async () => {
    const productRoutes = await loadProductsRoute();
    const env = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "product_1",
          slug: "body-wave",
        })
        .mockResolvedValueOnce(null),
    };

    const okResponse = await productRoutes.request(
      "http://localhost/stores/store_1/products/body-wave",
      {
        method: "GET",
        headers: {
          Cookie: "store_id=store_1",
        },
      },
      env as never
    );

    expect(okResponse.status).toBe(200);
    expect(await okResponse.json()).toEqual({
      _id: "product_1",
      slug: "body-wave",
    });

    const missingResponse = await productRoutes.request(
      "http://localhost/stores/store_1/products/missing-product",
      {
        method: "GET",
        headers: {
          Cookie: "store_id=store_1",
        },
      },
      env as never
    );

    expect(missingResponse.status).toBe(400);
    expect(await missingResponse.json()).toEqual({
      error: "Product with identifier not found",
    });
  });

  it("covers product sub-routes and missing-store guards", async () => {
    const productRoutes = await loadProductsRoute();

    const missingStoreList = await productRoutes.request(
      "http://localhost/stores/store_1/products",
      { method: "GET" },
      { runAction: vi.fn(), runQuery: vi.fn() } as never
    );
    const missingStoreColors = await productRoutes.request(
      "http://localhost/stores/store_1/products/colors",
      { method: "GET" },
      { runAction: vi.fn(), runQuery: vi.fn() } as never
    );
    const missingStoreBest = await productRoutes.request(
      "http://localhost/stores/store_1/products/bestSellers",
      { method: "GET" },
      { runAction: vi.fn(), runQuery: vi.fn() } as never
    );
    const missingStoreFeatured = await productRoutes.request(
      "http://localhost/stores/store_1/products/featured",
      { method: "GET" },
      { runAction: vi.fn(), runQuery: vi.fn() } as never
    );
    const missingStoreProduct = await productRoutes.request(
      "http://localhost/stores/store_1/products/body-wave",
      { method: "GET" },
      { runAction: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(missingStoreList.status).toBe(404);
    expect(missingStoreColors.status).toBe(404);
    expect(missingStoreBest.status).toBe(404);
    expect(missingStoreFeatured.status).toBe(404);
    expect(missingStoreProduct.status).toBe(404);

    const env = {
      runAction: vi.fn().mockResolvedValue([]),
      runQuery: vi
        .fn()
        .mockResolvedValueOnce([{ _id: "best_1" }])
        .mockResolvedValueOnce([{ _id: "featured_1" }]),
    };
    const headers = { Cookie: "store_id=store_1" };
    const colors = await productRoutes.request(
      "http://localhost/stores/store_1/products/colors",
      { method: "GET", headers },
      env as never
    );
    const best = await productRoutes.request(
      "http://localhost/stores/store_1/products/bestSellers",
      { method: "GET", headers },
      env as never
    );
    const featured = await productRoutes.request(
      "http://localhost/stores/store_1/products/featured",
      { method: "GET", headers },
      env as never
    );

    expect(colors.status).toBe(200);
    expect(await colors.json()).toEqual({});
    expect(best.status).toBe(200);
    expect(await best.json()).toEqual([{ _id: "best_1" }]);
    expect(featured.status).toBe(200);
    expect(await featured.json()).toEqual([{ _id: "featured_1" }]);
  });

  it("parses optional tags and isVisible=true query values", async () => {
    const productRoutes = await loadProductsRoute();
    const env = {
      runAction: vi.fn().mockResolvedValue([]),
      runQuery: vi.fn(),
    };

    const response = await productRoutes.request(
      "http://localhost/stores/store_1/products?tags=featured,new&isVisible=true",
      {
        method: "GET",
        headers: {
          Cookie: "store_id=store_1",
        },
      },
      env as never
    );

    expect(response.status).toBe(200);
    expect(env.runAction).toHaveBeenCalledWith(
      "inventory.productUtil.getAllProducts",
      expect.objectContaining({
        isVisible: true,
      })
    );
  });
});
