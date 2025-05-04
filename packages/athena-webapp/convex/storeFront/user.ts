import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { addressSchema } from "../schemas/storeFront";
import { api } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";

const entity = "storeFrontUser";

export const getAll = query({
  handler: async (ctx) => {
    return await ctx.db.query(entity).collect();
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    try {
      return await ctx.db.get(args.id);
    } catch (e) {
      return null;
    }
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    shippingAddress: v.optional(addressSchema),
    billingAddress: v.optional(addressSchema),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, any> = {};

    if (args.email) {
      updates.email = args.email;
    }

    if (args.firstName) {
      updates.firstName = args.firstName;
    }

    if (args.lastName) {
      updates.lastName = args.lastName;
    }

    if (args.phoneNumber) {
      updates.phoneNumber = args.phoneNumber;
    }

    if (args.billingAddress) {
      updates.billingAddress = args.billingAddress;
    }

    if (args.shippingAddress) {
      updates.shippingAddress = args.shippingAddress;
    }

    await ctx.db.patch(args.id, updates);
    return await ctx.db.get(args.id);
  },
});

export const getByIdentifier = query({
  args: {
    id: v.union(v.id(entity), v.id("guest")),
  },
  handler: async (ctx, args) => {
    try {
      return await ctx.db.get(args.id);
    } catch (e) {
      return null;
    }
  },
});

export const getAllUserActivity = query({
  args: {
    id: v.union(v.id(entity), v.id("guest")),
  },
  handler: async (ctx, args) => {
    const analytics = await ctx.db
      .query("analytics")
      .filter((q) => q.eq(q.field("storeFrontUserId"), args.id))
      .collect();

    return analytics;
  },
});

export const getLastViewedProduct = query({
  args: {
    id: v.union(v.id(entity), v.id("guest")),
  },
  handler: async (ctx, args) => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000; // 1 day ago in ms

    // Helper function to check if a specific SKU is available
    const isSkuAvailable = async (
      productId: Id<"product">,
      storeId: Id<"store">,
      skuToCheck: string
    ) => {
      const product: any = await ctx.runQuery(api.inventory.products.getById, {
        id: productId,
        storeId,
      });
      return product?.skus?.find(
        (sku: any) =>
          sku.sku === skuToCheck &&
          sku.productCategory === "Hair" &&
          sku.quantityAvailable > 0
      );
    };

    // Get recent product views
    const analytics = await ctx.db
      .query("analytics")
      .filter((q) =>
        q.and(
          q.eq(q.field("storeFrontUserId"), args.id),
          q.eq(q.field("action"), "viewed_product"),
          q.gte(q.field("_creationTime"), oneDayAgo)
        )
      )
      .take(10);

    if (analytics.length) {
      // Get all the product SKUs from analytics
      const productSkus = analytics.map((analytic) => analytic.data.productSku);

      // Find all bag items for these SKUs
      const bagItems = await ctx.db
        .query("bagItem")
        .filter((q) => q.eq(q.field("storeFrontUserId"), args.id))
        .collect()
        .then((items) =>
          items.filter((item) => productSkus.includes(item.productSku))
        );

      // Create a Set of SKUs that are in the bag for faster lookup
      const bagSkus = new Set(bagItems.map((item) => item.productSku));

      // Try each analytic in order until we find an available product
      for (const analytic of analytics) {
        if (bagSkus.has(analytic.data.productSku)) continue;

        const availableSku = await isSkuAvailable(
          analytic.data.product,
          analytic.storeId,
          analytic.data.productSku
        );

        if (availableSku) {
          console.log(
            `Found available upsell product for user ${args.id}: ${availableSku.sku}`
          );
          return availableSku;
        }
      }

      console.log(
        `No available products found in recent views for user ${args.id}`
      );
      return null;
    }

    // If no recent views, try to find the last viewed product (all time)
    const allTimeAnalytics = await ctx.db
      .query("analytics")
      .filter((q) =>
        q.and(
          q.eq(q.field("storeFrontUserId"), args.id),
          q.eq(q.field("action"), "viewed_product")
        )
      )
      .order("desc")
      .take(20); // check up to 20 most recent all-time views

    if (allTimeAnalytics.length) {
      // Get all the product SKUs from analytics
      const productSkus = allTimeAnalytics.map(
        (analytic) => analytic.data.productSku
      );

      // Find all bag items for these SKUs
      const bagItems = await ctx.db
        .query("bagItem")
        .filter((q) => q.eq(q.field("storeFrontUserId"), args.id))
        .collect()
        .then((items) =>
          items.filter((item) => productSkus.includes(item.productSku))
        );

      // Create a Set of SKUs that are in the bag for faster lookup
      const bagSkus = new Set(bagItems.map((item) => item.productSku));

      // Try each analytic in order until we find an available product
      for (const analytic of allTimeAnalytics) {
        if (bagSkus.has(analytic.data.productSku)) continue;

        const availableSku = await isSkuAvailable(
          analytic.data.product,
          analytic.storeId,
          analytic.data.productSku
        );

        if (availableSku) {
          console.log(
            `Found available upsell product for user ${args.id}: ${availableSku.sku}`
          );
          return availableSku;
        }
      }
    }

    console.log(`No available products found for user ${args.id}`);
    return null;
  },
});

export const getOnlineOrderById = query({
  args: {
    id: v.id("onlineOrder"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
