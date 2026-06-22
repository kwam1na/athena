import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as athenaUserAuth from "../lib/athenaUserAuth";
import type { MutationCtx } from "../_generated/server";
import { create, remove, updateRanks } from "./featuredItem";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function makeCreateCtx(
  records: Record<string, unknown> = {},
  rankedRows: unknown[] = [],
) {
  const first = vi.fn(async () => null);
  const take = vi.fn(async () => rankedRows);

  return {
    db: {
      get: vi.fn(async (_table: string, id: string) => records[id] ?? null),
      query: vi.fn(() => ({
        filter: vi.fn(() => ({
          first,
          take,
        })),
      })),
      insert: vi.fn(async () => "featured-created"),
      delete: vi.fn(),
      patch: vi.fn(),
    },
  } as unknown as MutationCtx;
}

describe("featured homepage placement writes", () => {
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

  it("requires exactly one target kind", async () => {
    const ctx = makeCreateCtx({
      "store-1": {
        _id: "store-1",
        organizationId: "org-1",
      },
    });

    await expect(
      getHandler(create)(ctx, {
        storeId: "store-1",
        type: "regular",
        productId: "product-1",
        categoryId: "category-1",
      }),
    ).rejects.toThrow("exactly one");

    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("rejects referenced rows from another store", async () => {
    const ctx = makeCreateCtx({
      "store-1": {
        _id: "store-1",
        organizationId: "org-1",
      },
      "category-1": {
        _id: "category-1",
        storeId: "store-2",
        slug: "lace-fronts",
      },
    });

    await expect(
      getHandler(create)(ctx, {
        storeId: "store-1",
        type: "regular",
        categoryId: "category-1",
      }),
    ).rejects.toThrow("same store");

    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("requires homepage full-admin access before creating placements", async () => {
    const ctx = makeCreateCtx({
      "store-1": {
        _id: "store-1",
        organizationId: "org-1",
      },
      "product-1": {
        _id: "product-1",
        storeId: "store-1",
      },
    });

    await getHandler(create)(ctx, {
      storeId: "store-1",
      type: "regular",
      productId: "product-1",
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

  it("appends regular highlighted items after the current ranked list", async () => {
    const ctx = makeCreateCtx(
      {
        "store-1": {
          _id: "store-1",
          organizationId: "org-1",
        },
        "product-1": {
          _id: "product-1",
          storeId: "store-1",
        },
        "featured-created": {
          _id: "featured-created",
          storeId: "store-1",
          rank: 5,
        },
      },
      [
        { _id: "featured-1", storeId: "store-1", type: "regular", rank: 0 },
        { _id: "featured-2", storeId: "store-1", type: "regular", rank: 4 },
        { _id: "featured-legacy", storeId: "store-1", type: "regular" },
      ],
    );

    await getHandler(create)(ctx, {
      storeId: "store-1",
      type: "regular",
      productId: "product-1",
    });

    expect(ctx.db.insert).toHaveBeenCalledWith("featuredItem", {
      productId: "product-1",
      categoryId: undefined,
      subcategoryId: undefined,
      rank: 5,
      storeId: "store-1",
      type: "regular",
    });
  });

  it("keeps Shop the Look to one placement per store", async () => {
    const existingShopLook = {
      _id: "shop-look-existing",
      storeId: "store-1",
      type: "shop_look",
      productId: "product-old",
    };
    const ctx = makeCreateCtx({
      "store-1": {
        _id: "store-1",
        organizationId: "org-1",
      },
      "product-new": {
        _id: "product-new",
        storeId: "store-1",
      },
    });
    const capturedFields: string[] = [];
    const capturedValues = new Map<string, unknown>();
    vi.mocked(ctx.db.query).mockReturnValue({
      filter: vi.fn((predicate: Function) => {
        const clauses = predicate({
          and: (...conditions: Array<{ field?: string; value?: unknown }>) =>
            conditions,
          eq: (field: { field: string } | unknown, value: unknown) => ({
            field: typeof field === "object" && field && "field" in field
              ? String(field.field)
              : String(field),
            value,
          }),
          field: (field: string) => ({ field }),
        });

        capturedFields.push(
          ...clauses.map((clause: { field?: string }) => clause.field ?? ""),
        );
        for (const clause of clauses) {
          if (clause.field) {
            capturedValues.set(clause.field, clause.value);
          }
        }

        return {
          first: vi.fn(async () =>
            capturedValues.get("storeId") === "store-1" &&
            capturedValues.get("type") === "shop_look"
              ? existingShopLook
              : null,
          ),
        };
      }),
    } as any);

    await expect(
      getHandler(create)(ctx, {
        storeId: "store-1",
        type: "shop_look",
        productId: "product-new",
      }),
    ).resolves.toBeUndefined();

    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(capturedFields).toContain("storeId");
    expect(capturedFields).toContain("type");
    expect(capturedFields).not.toContain("productId");
    expect(capturedValues.get("storeId")).toBe("store-1");
    expect(capturedValues.get("type")).toBe("shop_look");
  });

  it("rejects reserved or hidden storefront placements", async () => {
    const ctx = makeCreateCtx({
      "store-1": {
        _id: "store-1",
        organizationId: "org-1",
      },
      "category-hidden": {
        _id: "category-hidden",
        storeId: "store-1",
        slug: "lace-fronts",
        showOnStorefront: false,
      },
      "subcategory-reserved": {
        _id: "subcategory-reserved",
        storeId: "store-1",
        categoryId: "category-1",
        slug: "uncategorized",
      },
    });

    await expect(
      getHandler(create)(ctx, {
        storeId: "store-1",
        type: "regular",
        categoryId: "category-hidden",
      }),
    ).rejects.toThrow("customer-visible");

    await expect(
      getHandler(create)(ctx, {
        storeId: "store-1",
        type: "regular",
        subcategoryId: "subcategory-reserved",
      }),
    ).rejects.toThrow("customer-visible");

    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("rejects subcategories whose parent category is hidden", async () => {
    const ctx = makeCreateCtx({
      "store-1": {
        _id: "store-1",
        organizationId: "org-1",
      },
      "subcategory-1": {
        _id: "subcategory-1",
        storeId: "store-1",
        categoryId: "category-hidden",
        slug: "closures",
      },
      "category-hidden": {
        _id: "category-hidden",
        storeId: "store-1",
        slug: "lace-fronts",
        showOnStorefront: false,
      },
    });

    await expect(
      getHandler(create)(ctx, {
        storeId: "store-1",
        type: "regular",
        subcategoryId: "subcategory-1",
      }),
    ).rejects.toThrow("parent must be customer-visible");

    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("authorizes removal through the existing highlighted item store", async () => {
    const ctx = makeCreateCtx({
      "featured-1": {
        _id: "featured-1",
        storeId: "store-1",
      },
      "store-1": {
        _id: "store-1",
        organizationId: "org-1",
      },
    });

    await expect(getHandler(remove)(ctx, { id: "featured-1" })).resolves.toBe(
      true,
    );

    expect(ctx.db.delete).toHaveBeenCalledWith("featuredItem", "featured-1");
    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "You do not have access to manage homepage content.",
      organizationId: "org-1",
      userId: "athena-user-1",
    });
  });

  it("authorizes reorder through each existing highlighted item store", async () => {
    const ctx = makeCreateCtx({
      "featured-1": {
        _id: "featured-1",
        storeId: "store-1",
      },
      "featured-2": {
        _id: "featured-2",
        storeId: "store-1",
      },
      "store-1": {
        _id: "store-1",
        organizationId: "org-1",
      },
    });

    await expect(
      getHandler(updateRanks)(ctx, {
        ranks: [
          { id: "featured-1", rank: 1 },
          { id: "featured-2", rank: 0 },
        ],
      }),
    ).resolves.toBe(true);

    expect(ctx.db.patch).toHaveBeenCalledWith("featuredItem", "featured-1", {
      rank: 1,
    });
    expect(ctx.db.patch).toHaveBeenCalledWith("featuredItem", "featured-2", {
      rank: 0,
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
});
