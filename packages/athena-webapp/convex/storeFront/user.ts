import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { addressSchema } from "../schemas/storeFront";
import { api } from "../_generated/api";
import { Doc } from "../_generated/dataModel";

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

    if (!analytics.length) {
      console.log(
        `no analytics match found for last viewed product for user ${args.id}`
      );
      return null;
    }

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

    // Find the first analytic whose product is not in the bag
    const validAnalytic = analytics.find(
      (analytic) => !bagSkus.has(analytic.data.productSku)
    );

    if (!validAnalytic) {
      console.log(`all viewed products are in bag for user ${args.id}`);
      return null;
    }

    const product: any = await ctx.runQuery(api.inventory.products.getById, {
      id: validAnalytic.data.product,
      storeId: validAnalytic.storeId,
    });

    console.log(
      `sending upsell product ${validAnalytic.data.productSku} for user ${args.id}`
    );

    return product?.skus?.find(
      (sku: any) =>
        sku.sku === validAnalytic.data.productSku &&
        sku.productCategory == "Hair" &&
        sku.quantityAvailable > 0
    );
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
