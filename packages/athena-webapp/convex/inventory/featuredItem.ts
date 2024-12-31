import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { api } from "../_generated/api";

const entity = "featuredItem";

export const create = mutation({
  args: {
    productId: v.optional(v.id("product")),
    categoryId: v.optional(v.id("category")),
    subcategoryId: v.optional(v.id("subcategory")),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query(entity)
      .filter((q) => {
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
          q.eq(q.field("storeId"), args.storeId)
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
    });

    return await ctx.db.get(id);
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);

    return true;
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getAll = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();

    const enrichedItems: any[] = await Promise.all(
      items.map(async (item) => {
        let enrichedData: Record<string, any> = { ...item };

        if (item.productId) {
          const product = await ctx.runQuery(
            api.inventory.products.getByIdOrSlug,
            {
              identifier: item.productId,
              storeId: args.storeId,
            }
          );
          enrichedData.product = product;
        }

        if (item.categoryId) {
          const category = await ctx.db.get(item.categoryId);
          enrichedData.category = category;

          // Get first 5 products from this category
          const categoryProducts = await ctx.db
            .query("product")
            .filter((q) =>
              q.and(
                q.eq(q.field("categoryId"), item.categoryId),
                q.eq(q.field("storeId"), args.storeId)
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
          const subcategory = await ctx.db.get(item.subcategoryId);
          enrichedData.subcategory = subcategory;

          // Get first 5 products from this subcategory
          const subcategoryProducts = await ctx.db
            .query("product")
            .filter((q) =>
              q.and(
                q.eq(q.field("subcategoryId"), item.subcategoryId),
                q.eq(q.field("storeId"), args.storeId)
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
    await Promise.all(
      args.ranks.map(async (item) => {
        await ctx.db.patch(item.id, {
          rank: item.rank,
        });
      })
    );

    return true;
  },
});
