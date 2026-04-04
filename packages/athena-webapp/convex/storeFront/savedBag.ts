import {
  internalMutation,
  internalQuery,
  mutation,
  QueryCtx,
  query,
} from "../_generated/server";
import { v } from "convex/values";

const entity = "savedBag";
const MAX_SAVED_BAGS = 500;
const MAX_SAVED_BAG_ITEMS = 200;

async function listSavedBagItems(
  ctx: QueryCtx,
  savedBagId: string
) {
  return await ctx.db
    .query("savedBagItem")
    .withIndex("by_savedBagId", (q) => q.eq("savedBagId", savedBagId as any))
    .take(MAX_SAVED_BAG_ITEMS);
}

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query(entity).take(MAX_SAVED_BAGS);
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

    const items = await listSavedBagItems(ctx, bag._id);

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
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.storeFrontUserId)
      )
      .first();

    if (!bag) return null;

    const items = await listSavedBagItems(ctx, bag._id);

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
      .withIndex("by_savedBagId", (q) => q.eq("savedBagId", args.id))
      .take(MAX_SAVED_BAG_ITEMS);

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
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.currentOwner)
      )
      .first();

    const newOwnerBag = await ctx.db
      .query(entity)
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.newOwner)
      )
      .first();

    if (!savedBag) {
      return null; // No guest bag exists
    }

    if (newOwnerBag) {
      // Get items from current bag
      const currentItems = await ctx.db
        .query("savedBagItem")
        .withIndex("by_savedBagId", (q) => q.eq("savedBagId", savedBag._id))
        .take(MAX_SAVED_BAG_ITEMS);

      // Get items from new owner's bag
      const newOwnerItems = await ctx.db
        .query("savedBagItem")
        .withIndex("by_savedBagId", (q) => q.eq("savedBagId", newOwnerBag._id))
        .take(MAX_SAVED_BAG_ITEMS);

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
