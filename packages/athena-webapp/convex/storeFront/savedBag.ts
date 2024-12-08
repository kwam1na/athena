import { api } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

const entity = "savedBag";

export const getAll = query({
  handler: async (ctx) => {
    return await ctx.db.query(entity).collect();
  },
});

export const create = mutation({
  args: {
    storeId: v.id("store"),
    customerId: v.union(v.id("customer"), v.id("guest")),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, { ...args, updatedAt: Date.now() });

    const bag = await ctx.db.get(id);
    return {
      ...bag,
      items: [],
    };
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    const bag = await ctx.db.get(args.id);
    if (!bag) return null;

    const items = await ctx.db
      .query("savedBagItem")
      .filter((q) => q.eq(q.field("savedBagId"), bag._id))
      .collect();

    // For each item, retrieve the associated product and its SKUs
    const itemsWithProductDetails = await Promise.all(
      items.map(async (item) => {
        const [sku, product] = await Promise.all([
          ctx.db.get(item.productSkuId),
          ctx.db.get(item.productId),
        ]);

        let colorName;

        if (sku?.color) {
          const color = await ctx.db.get(sku.color);
          colorName = color?.name;
        }

        let category: string | undefined;

        if (product) {
          const productCategory = await ctx.db.get(product.categoryId);
          category = productCategory?.name;
        }

        return {
          ...item,
          price: sku?.price,
          length: sku?.length,
          colorName,
          productName: product?.name,
          productCategory: category,
          productImage: sku?.images?.[0],
          productSlug: product?.slug,
        };
      })
    );

    // Return the bag with the enriched items
    return {
      ...bag,
      items: itemsWithProductDetails,
    };
  },
});

export const getByCustomerId = query({
  args: {
    customerId: v.union(v.id("customer"), v.id("guest")),
  },
  handler: async (ctx, args) => {
    const bag = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("customerId"), args.customerId))
      .first();

    if (!bag) return null;

    const items = await ctx.db
      .query("savedBagItem")
      .filter((q) => q.eq(q.field("savedBagId"), bag._id))
      .collect();

    // For each item, retrieve the associated product and its SKUs
    const itemsWithProductDetails = await Promise.all(
      items.map(async (item) => {
        const [sku, product] = await Promise.all([
          ctx.db.get(item.productSkuId),
          ctx.db.get(item.productId),
        ]);

        let colorName;

        if (sku?.color) {
          const color = await ctx.db.get(sku.color);
          colorName = color?.name;
        }

        let category: string | undefined;

        if (product) {
          const productCategory = await ctx.db.get(product.categoryId);
          category = productCategory?.name;
        }

        return {
          ...item,
          price: sku?.price,
          length: sku?.length,
          colorName,
          productName: product?.name,
          productCategory: category,
          productImage: sku?.images?.[0],
          productSlug: product?.slug,
        };
      })
    );

    // Return the bag with the enriched items
    return {
      ...bag,
      items: itemsWithProductDetails,
    };
  },
});

export const deleteSavedBag = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);

    const items = await ctx.db
      .query("savedBagItem")
      .filter((q) => q.eq(q.field("savedBagId"), args.id))
      .collect();

    await Promise.all(items.map((item) => ctx.db.delete(item._id)));

    return { message: "Bag and its items deleted" };
  },
});
