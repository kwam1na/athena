import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { api } from "../_generated/api";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";

const entity = "featuredItem";

const RESERVED_STOREFRONT_CATEGORY_SLUGS = new Set(["pos-quick-add"]);
const RESERVED_STOREFRONT_SUBCATEGORY_SLUGS = new Set(["uncategorized"]);

async function requireHomepageStoreAdmin(
  ctx: QueryCtx | MutationCtx,
  storeId: Id<"store">,
) {
  const store = await ctx.db.get("store", storeId);
  if (!store) {
    throw new Error("Store not found.");
  }

  const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin"],
    failureMessage: "You do not have access to manage homepage content.",
    organizationId: store.organizationId,
    userId: athenaUser._id,
  });

  return store;
}

const isCustomerVisibleCategory = (
  category: { showOnStorefront?: boolean; slug: string } | null,
) => {
  return Boolean(
    category &&
      category.showOnStorefront !== false &&
      !RESERVED_STOREFRONT_CATEGORY_SLUGS.has(category.slug),
  );
};

const countFeaturedTargets = (args: {
  productId?: unknown;
  categoryId?: unknown;
  subcategoryId?: unknown;
}) => {
  return [args.productId, args.categoryId, args.subcategoryId].filter(Boolean)
    .length;
};

const validateFeaturedPlacement = async (
  ctx: QueryCtx | MutationCtx,
  args: {
    productId?: Id<"product">;
    categoryId?: Id<"category">;
    subcategoryId?: Id<"subcategory">;
    storeId: Id<"store">;
  },
) => {
  if (countFeaturedTargets(args) !== 1) {
    throw new Error("Featured placement must reference exactly one target kind.");
  }

  if (args.productId) {
    const product = await ctx.db.get("product", args.productId);
    if (!product || product.storeId !== args.storeId) {
      throw new Error("Featured product must belong to the same store.");
    }
    return;
  }

  if (args.categoryId) {
    const category = await ctx.db.get("category", args.categoryId);
    if (!category || category.storeId !== args.storeId) {
      throw new Error("Featured category must belong to the same store.");
    }
    if (!isCustomerVisibleCategory(category)) {
      throw new Error("Featured category must be customer-visible.");
    }
    return;
  }

  if (args.subcategoryId) {
    const subcategory = await ctx.db.get("subcategory", args.subcategoryId);
    if (!subcategory || subcategory.storeId !== args.storeId) {
      throw new Error("Featured subcategory must belong to the same store.");
    }
    if (RESERVED_STOREFRONT_SUBCATEGORY_SLUGS.has(subcategory.slug)) {
      throw new Error("Featured subcategory must be customer-visible.");
    }

    const category = await ctx.db.get("category", subcategory.categoryId);
    if (!category || category.storeId !== args.storeId) {
      throw new Error("Featured subcategory parent must belong to the same store.");
    }
    if (!isCustomerVisibleCategory(category)) {
      throw new Error("Featured subcategory parent must be customer-visible.");
    }
  }
};

export const create = mutation({
  args: {
    productId: v.optional(v.id("product")),
    categoryId: v.optional(v.id("category")),
    subcategoryId: v.optional(v.id("subcategory")),
    type: v.optional(v.string()),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireHomepageStoreAdmin(ctx, args.storeId);
    await validateFeaturedPlacement(ctx, args);

    const existing = await ctx.db
      .query(entity)
      .filter((q) => {
        if (args.type === "shop_look") {
          return q.and(
            q.eq(q.field("storeId"), args.storeId),
            q.eq(q.field("type"), "shop_look")
          );
        }

        return q.and(
          args.productId
            ? q.eq(q.field("productId"), args.productId)
            : q.eq(1, 1),
          args.categoryId
            ? q.eq(q.field("categoryId"), args.categoryId)
            : q.eq(1, 1),
          args.subcategoryId
            ? q.eq(q.field("subcategoryId"), args.subcategoryId)
            : q.eq(1, 1),
          q.eq(q.field("storeId"), args.storeId),
          q.eq(q.field("type"), args.type)
        );
      })
      .first();

    if (existing) {
      return;
    }

    const id = await ctx.db.insert(entity, {
      productId: args.productId,
      categoryId: args.categoryId,
      subcategoryId: args.subcategoryId,
      storeId: args.storeId,
      type: args.type,
    });

    return await ctx.db.get(entity, id);
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(entity, args.id);
    if (!existing) {
      return true;
    }

    await requireHomepageStoreAdmin(ctx, existing.storeId);
    await ctx.db.delete(entity, args.id);

    return true;
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(entity, args.id);
  },
});

export const getAll = query({
  args: {
    storeId: v.id("store"),
    type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query(entity)
      .filter((q) => {
        return q.and(
          q.eq(q.field("storeId"), args.storeId),
          args.type ? q.eq(q.field("type"), args.type) : q.eq(1, 1)
        );
      })
      .take(100);

    const enrichedItems: any[] = await Promise.all(
      items.map(async (item) => {
        let enrichedData: Record<string, any> = { ...item };

        if (item.productId) {
          const product = await ctx.runQuery(
            api.inventory.products.getByIdOrSlug,
            {
              identifier: item.productId,
              storeId: args.storeId,
              filters: {
                isVisible: true,
              },
            }
          );
          enrichedData.product = product;
        }

        if (item.categoryId) {
          const category = await ctx.db.get("category", item.categoryId);
          enrichedData.category = category;

          // Get first 5 products from this category
          const categoryProducts = await ctx.db
            .query("product")
            .filter((q) =>
              q.and(
                q.eq(q.field("categoryId"), item.categoryId),
                q.eq(q.field("storeId"), args.storeId),
                q.eq(q.field("isVisible"), true),
                q.neq(q.field("availability"), "archived")
              )
            )
            .take(5);

          // Get first SKU for each product
          const productsWithSku = await Promise.all(
            categoryProducts.map(async (product) => {
              const firstSku = await ctx.db
                .query("productSku")
                .filter((q) => q.eq(q.field("productId"), product._id))
                .first();
              return { ...product, skus: [firstSku] };
            })
          );

          enrichedData.category = {
            ...enrichedData.category,
            products: productsWithSku,
          };
        }

        if (item.subcategoryId) {
          const subcategory = await ctx.db.get(
            "subcategory",
            item.subcategoryId
          );
          enrichedData.subcategory = subcategory;

          // Get first 5 products from this subcategory
          const subcategoryProducts = await ctx.db
            .query("product")
            .filter((q) =>
              q.and(
                q.eq(q.field("subcategoryId"), item.subcategoryId),
                q.eq(q.field("storeId"), args.storeId),
                q.eq(q.field("isVisible"), true),
                q.neq(q.field("availability"), "archived")
              )
            )
            .take(5);

          // Get first SKU for each product
          const productsWithSku = await Promise.all(
            subcategoryProducts.map(async (product) => {
              const firstSku = await ctx.db
                .query("productSku")
                .filter((q) => q.eq(q.field("productId"), product._id))
                .first();
              return { ...product, skus: [firstSku] };
            })
          );

          enrichedData.subcategory = {
            ...enrichedData.subcategory,
            products: productsWithSku,
          };
        }

        return enrichedData;
      })
    );

    return enrichedItems;
  },
});

export const updateRanks = mutation({
  args: {
    ranks: v.array(v.object({ id: v.id(entity), rank: v.number() })),
  },
  handler: async (ctx, args) => {
    const rows = await Promise.all(
      args.ranks.map((item) => ctx.db.get(entity, item.id))
    );
    const storeIds = new Set(
      rows
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .map((row) => row.storeId)
    );

    await Promise.all(
      Array.from(storeIds).map((storeId) =>
        requireHomepageStoreAdmin(ctx, storeId)
      )
    );

    await Promise.all(
      args.ranks.map(async (item) => {
        await ctx.db.patch(entity, item.id, {
          rank: item.rank,
        });
      })
    );

    return true;
  },
});
