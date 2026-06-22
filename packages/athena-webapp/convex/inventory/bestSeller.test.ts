import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as athenaUserAuth from "../lib/athenaUserAuth";
import type { QueryCtx } from "../_generated/server";
import { create, getAll } from "./bestSeller";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("best-seller product visibility", () => {
  beforeEach(() => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _id: "athena-user-1",
      email: "admin@example.com",
    } as any);
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue({ _id: "member-1", role: "full_admin" } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("filters archived product SKUs from public best-seller results", async () => {
    const bestSellers = [
      {
        _id: "bestSeller-live",
        productSkuId: "sku-live",
        storeId: "store123",
      },
      {
        _id: "bestSeller-archived",
        productSkuId: "sku-archived",
        storeId: "store123",
      },
    ];
    const skus = new Map([
      [
        "sku-live",
        {
          _id: "sku-live",
          isVisible: true,
          product: { availability: "live" },
        },
      ],
      [
        "sku-archived",
        {
          _id: "sku-archived",
          isVisible: true,
          product: { availability: "archived" },
        },
      ],
    ]);

    const ctx = {
      db: {
        query() {
          return {
            filter() {
              return {
                collect: async () => bestSellers,
              };
            },
          };
        },
      },
      runQuery: vi.fn(async (_ref, args: { id: string }) => skus.get(args.id)),
    } as unknown as QueryCtx;

    const results = await getHandler(getAll)(ctx, {
      storeId: "store123",
      isVisible: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0]._id).toBe("bestSeller-live");
    expect(results[0].productSku._id).toBe("sku-live");
  });

  it("rejects best-seller product and SKU pairings outside the same store", async () => {
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "store") {
            return { _id: id, organizationId: "org-1" };
          }

          if (table === "product") {
            return { _id: id, storeId: "store123" };
          }

          return { _id: id, storeId: "other-store", productId: "product-1" };
        }),
        query: vi.fn(() => ({
          filter: vi.fn(() => ({
            collect: vi.fn(async () => []),
            first: vi.fn(async () => null),
          })),
        })),
        insert: vi.fn(),
      },
    } as any;

    await expect(
      getHandler(create)(ctx, {
        storeId: "store123",
        productId: "product-1",
        productSkuId: "sku-1",
      }),
    ).rejects.toThrow("same store");

    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("rejects best-seller SKU rows that do not belong to the selected product", async () => {
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "store") {
            return { _id: id, organizationId: "org-1" };
          }

          if (table === "product") {
            return { _id: id, storeId: "store123" };
          }

          return { _id: id, storeId: "store123", productId: "other-product" };
        }),
        query: vi.fn(() => ({
          filter: vi.fn(() => ({
            collect: vi.fn(async () => []),
            first: vi.fn(async () => null),
          })),
        })),
        insert: vi.fn(),
      },
    } as any;

    await expect(
      getHandler(create)(ctx, {
        storeId: "store123",
        productId: "product-1",
        productSkuId: "sku-1",
      }),
    ).rejects.toThrow("selected product");

    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("requires homepage full-admin access before creating best sellers", async () => {
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "store") {
            return { _id: id, organizationId: "org-1" };
          }
          if (table === "product") {
            return { _id: id, storeId: "store123" };
          }
          if (table === "productSku") {
            return { _id: id, storeId: "store123", productId: "product-1" };
          }
          if (table === "bestSeller") {
            return { _id: id, storeId: "store123" };
          }
          return null;
        }),
        query: vi.fn(() => ({
          filter: vi.fn(() => ({
            collect: vi.fn(async () => []),
            first: vi.fn(async () => null),
          })),
        })),
        insert: vi.fn(async () => "best-seller-1"),
      },
    } as any;

    await getHandler(create)(ctx, {
      storeId: "store123",
      productId: "product-1",
      productSkuId: "sku-1",
    });

    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "You do not have access to manage homepage content.",
      organizationId: "org-1",
      userId: "athena-user-1",
    });
  });

  it("appends newly created best sellers after the current ranked list", async () => {
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "store") {
            return { _id: id, organizationId: "org-1" };
          }
          if (table === "product") {
            return { _id: id, storeId: "store123" };
          }
          if (table === "productSku") {
            return { _id: id, storeId: "store123", productId: "product-1" };
          }
          if (table === "bestSeller") {
            return { _id: id, storeId: "store123", rank: 5 };
          }
          return null;
        }),
        query: vi.fn(() => ({
          filter: vi.fn(() => ({
            collect: vi.fn(async () => [
              { _id: "best-seller-1", storeId: "store123", rank: 0 },
              { _id: "best-seller-2", storeId: "store123", rank: 4 },
              { _id: "best-seller-legacy", storeId: "store123" },
            ]),
            first: vi.fn(async () => null),
          })),
        })),
        insert: vi.fn(async () => "best-seller-3"),
      },
    } as any;

    await getHandler(create)(ctx, {
      storeId: "store123",
      productId: "product-1",
      productSkuId: "sku-1",
    });

    expect(ctx.db.insert).toHaveBeenCalledWith("bestSeller", {
      productId: "product-1",
      productSkuId: "sku-1",
      rank: 5,
      storeId: "store123",
    });
  });
});
