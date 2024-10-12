import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

const entity = "bag";

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
      .query("bagItem")
      .filter((q) => q.eq(q.field("bagId"), bag._id))
      .collect();

    // For each item, retrieve the associated product and its SKUs
    const itemsWithProductDetails = await Promise.all(
      items.map(async (item) => {
        const [sku, product] = await Promise.all([
          ctx.db.get(item.productSku),
          ctx.db.get(item.productId),
        ]);

        let category: string | undefined;

        if (product) {
          const productCategory = await ctx.db.get(product.categoryId);
          category = productCategory?.name;
        }

        return {
          ...item,
          price: sku?.price,
          length: sku?.length,
          color: sku?.color,
          productName: product?.name,
          productCategory: category,
          productImage: sku?.images?.[0],
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
      .query("bagItem")
      .filter((q) => q.eq(q.field("bagId"), bag._id))
      .collect();

    // For each item, retrieve the associated product and its SKUs
    const itemsWithProductDetails = await Promise.all(
      items.map(async (item) => {
        const [sku, product] = await Promise.all([
          ctx.db.get(item.productSku),
          ctx.db.get(item.productId),
        ]);

        let category: string | undefined;

        if (product) {
          const productCategory = await ctx.db.get(product.categoryId);
          category = productCategory?.name;
        }

        return {
          ...item,
          price: sku?.price,
          length: sku?.length,
          color: sku?.color,
          productName: product?.name,
          productCategory: category,
          productImage: sku?.images?.[0],
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

export const deleteBag = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);

    const items = await ctx.db
      .query("bagItem")
      .filter((q) => q.eq(q.field("bagId"), args.id))
      .collect();

    await Promise.all(items.map((item) => ctx.db.delete(item._id)));

    return { message: "Bag and its items deleted" };
  },
});
