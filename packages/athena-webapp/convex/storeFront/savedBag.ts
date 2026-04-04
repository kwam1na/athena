/* eslint-disable @convex-dev/no-collect-in-query -- Query refactors are tracked in V26-168, V26-169, and V26-170; this PR only hardens API boundaries. */
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import { v } from "convex/values";

const entity = "savedBag";

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query(entity).collect();
  },
});

export const create = internalMutation({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, {
      ...args,
      updatedAt: Date.now(),
      items: [],
    });

    const bag = await ctx.db.get("savedBag", id);
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
    const bag = await ctx.db.get("savedBag", args.id);
    if (!bag) return null;

    const items = await ctx.db
      .query("savedBagItem")
      .filter((q) => q.eq(q.field("savedBagId"), bag._id))
      .collect();

    // For each item, retrieve the associated product and its SKUs
    const itemsWithProductDetails = await Promise.all(
      items.map(async (item) => {
        const [sku, product] = await Promise.all([
          ctx.db.get("productSku", item.productSkuId),
          ctx.db.get("product", item.productId),
        ]);

        let colorName;

        if (sku?.color) {
          const color = await ctx.db.get("color", sku.color);
          colorName = color?.name;
        }

        let category: string | undefined;

        if (product) {
          const productCategory = await ctx.db.get("category", product.categoryId);
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

export const getByUserId = internalQuery({
  args: {
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  handler: async (ctx, args) => {
    const bag = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeFrontUserId"), args.storeFrontUserId))
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
          ctx.db.get("productSku", item.productSkuId),
          ctx.db.get("product", item.productId),
        ]);

        let colorName;

        if (sku?.color) {
          const color = await ctx.db.get("color", sku.color);
          colorName = color?.name;
        }

        let category: string | undefined;

        if (product) {
          const productCategory = await ctx.db.get("category", product.categoryId);
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
    await ctx.db.delete("savedBag", args.id);

    const items = await ctx.db
      .query("savedBagItem")
      .filter((q) => q.eq(q.field("savedBagId"), args.id))
      .collect();

    await Promise.all(items.map((item) => ctx.db.delete("savedBagItem", item._id)));

    return { message: "Bag and its items deleted" };
  },
});

export const updateOwner = internalMutation({
  args: {
    currentOwner: v.id("guest"),
    newOwner: v.id("storeFrontUser"),
  },
  handler: async (ctx, args) => {
    const savedBag = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeFrontUserId"), args.currentOwner))
      .first();

    const newOwnerBag = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeFrontUserId"), args.newOwner))
      .first();

    if (!savedBag) {
      return null; // No guest bag exists
    }

    if (newOwnerBag) {
      // Get items from current bag
      const currentItems = await ctx.db
        .query("savedBagItem")
        .filter((q) => q.eq(q.field("savedBagId"), savedBag._id))
        .collect();

      // Get items from new owner's bag
      const newOwnerItems = await ctx.db
        .query("savedBagItem")
        .filter((q) => q.eq(q.field("savedBagId"), newOwnerBag._id))
        .collect();

      // Process each item from current bag
      await Promise.all(
        currentItems.map(async (item) => {
          // Check if item already exists in new owner's bag
          const existingItem = newOwnerItems.find(
            (newItem) =>
              newItem.productId === item.productId &&
              newItem.productSkuId === item.productSkuId
          );

          if (existingItem) {
            // Update quantity of existing item
            await ctx.db.patch("savedBagItem", existingItem._id, {
              quantity: existingItem.quantity + item.quantity,
              savedBagId: newOwnerBag._id,
              storeFrontUserId: args.newOwner,
            });
            // Delete the duplicate item
            await ctx.db.delete("savedBagItem", item._id);
          } else {
            // Move item to new owner's bag
            await ctx.db.patch("savedBagItem", item._id, {
              savedBagId: newOwnerBag._id,
              storeFrontUserId: args.newOwner,
            });
          }
        })
      );

      await ctx.db.delete("savedBag", savedBag._id);
      return await ctx.db.get("savedBag", newOwnerBag._id);
    } else {
      // If new owner doesn't have a bag, update the ownership of existing bag
      await ctx.db.patch("savedBag", savedBag._id, {
        storeFrontUserId: args.newOwner,
        updatedAt: Date.now(),
      });
      return await ctx.db.get("savedBag", savedBag._id);
    }
  },
});
