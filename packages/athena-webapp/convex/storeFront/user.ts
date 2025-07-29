import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { addressSchema } from "../schemas/storeFront";
import { api } from "../_generated/api";
import { Id } from "../_generated/dataModel";

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

export const findLinkedAccounts = query({
  args: {
    userId: v.union(v.id(entity), v.id("guest")),
  },
  handler: async (ctx, args) => {
    // Get the user to find their email
    const user = await ctx.db.get(args.userId);
    if (!user || !user.email) {
      return { storeFrontUsers: [], guestUsers: [] };
    }

    const email = user.email;

    // Find all storeFrontUsers with the same email (excluding the current user)
    const storeFrontUsers = await ctx.db
      .query("storeFrontUser")
      .filter((q) =>
        q.and(q.eq(q.field("email"), email), q.neq(q.field("_id"), args.userId))
      )
      .collect();

    // Find all guest users with the same email
    const guestUsers = await ctx.db
      .query("guest")
      .filter((q) => q.eq(q.field("email"), email))
      .collect();

    return {
      storeFrontUsers,
      guestUsers,
    };
  },
});

export const getAllUserActivity = query({
  args: {
    id: v.union(v.id(entity), v.id("guest")),
  },
  handler: async (ctx, args) => {
    // Get the user's analytics data
    const analytics = await ctx.db
      .query("analytics")
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.id)
      )
      .collect();

    // Get unique user IDs from analytics
    const userIds = new Set<string>();
    analytics.forEach((analytic) => {
      userIds.add(analytic.storeFrontUserId);
    });

    // Fetch user data for these IDs by trying both tables
    const userMap: Record<string, { email?: string }> = {};

    // Try to fetch all IDs as both types of users
    const idArray = Array.from(userIds);

    // First try as storeFrontUsers
    for (const id of idArray) {
      try {
        // Try to get from storeFrontUser table
        const user = await ctx.db.get(id as Id<"storeFrontUser">);
        if (user) {
          userMap[id] = { email: user.email };
          continue; // Found in storeFrontUser table, skip to next ID
        }
      } catch (e) {
        // ID not found in storeFrontUser table, continue to try guest table
      }

      try {
        // Try to get from guest table
        const guest = await ctx.db.get(id as Id<"guest">);
        if (guest) {
          userMap[id] = { email: guest.email };
        }
      } catch (e) {
        // Not found in either table, continue
        console.error("User ID not found in any table:", id);
      }
    }

    // Attach user data to analytics
    const enrichedAnalytics = analytics.map((analytic) => ({
      ...analytic,
      userData: userMap[analytic.storeFrontUserId] || {},
    }));

    return enrichedAnalytics;
  },
});

export const getLastViewedProduct = query({
  args: {
    id: v.union(v.id(entity), v.id("guest")),
    category: v.optional(v.string()),
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
          (!args.category || sku.productCategory === args.category) &&
          sku.quantityAvailable > 0
      );
    };

    // Get recent product views
    const analytics = await ctx.db
      .query("analytics")
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.id)
      )
      .filter((q) => q.eq(q.field("action"), "viewed_product"))
      .order("desc")
      .take(100);

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
        if (bagSkus.has(analytic.data.productSku)) {
          continue;
        }

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
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.id)
      )
      .filter((q) => q.eq(q.field("action"), "viewed_product"))
      .order("desc")
      .take(200); // check up to 20 most recent all-time views

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
        // if (bagSkus.has(analytic.data.productSku)) continue;

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

export const getLastViewedProducts = query({
  args: {
    id: v.union(v.id(entity), v.id("guest")),
    category: v.optional(v.string()),
    limit: v.number(),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const availableProducts: any[] = [];

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
          (!args.category || sku.productCategory === args.category) &&
          sku.quantityAvailable > 0
      );
    };

    // Get recent product views (increased limit to have more products to choose from)
    const analytics = await ctx.db
      .query("analytics")
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.id)
      )
      .filter((q) => q.eq(q.field("action"), "viewed_product"))
      .order("desc")
      .take(200); // Increased limit to get more products

    if (analytics.length) {
      // Get all the product SKUs from analytics
      // const productSkus = analytics.map((analytic) => analytic.data.productSku);

      // Create a Set of SKUs that are in the bag for faster lookup
      const addedSkus = new Set<string>(); // Track already added SKUs to avoid duplicates

      // Try each analytic in order until we reach the limit
      for (const analytic of analytics) {
        if (availableProducts.length >= args.limit) {
          break;
        }

        // Skip if we've already added this SKU
        if (addedSkus.has(analytic.data.productSku)) {
          continue;
        }

        const availableSku = await isSkuAvailable(
          analytic.data.product,
          analytic.storeId,
          analytic.data.productSku
        );

        if (availableSku) {
          availableProducts.push(availableSku);
          addedSkus.add(analytic.data.productSku);
          console.log(
            `Found available product ${availableProducts.length}/${args.limit} for user ${args.id}: ${availableSku.sku}`
          );
        }
      }
    }

    // If we haven't reached the limit, try to find more from all-time views
    if (availableProducts.length < args.limit) {
      const allTimeAnalytics = await ctx.db
        .query("analytics")
        .withIndex("by_storeFrontUserId", (q) =>
          q.eq("storeFrontUserId", args.id)
        )
        .filter((q) => q.eq(q.field("action"), "viewed_product"))
        .order("desc")
        .take(500); // Check more all-time views

      if (allTimeAnalytics.length) {
        const addedSkus = new Set(
          availableProducts.map((product) => product.sku)
        );

        // Try each analytic in order until we reach the limit
        for (const analytic of allTimeAnalytics) {
          if (availableProducts.length >= args.limit) {
            break;
          }

          // Skip if we've already added this SKU
          if (addedSkus.has(analytic.data.productSku)) {
            continue;
          }

          const availableSku = await isSkuAvailable(
            analytic.data.product,
            analytic.storeId,
            analytic.data.productSku
          );

          if (availableSku) {
            availableProducts.push(availableSku);
            addedSkus.add(analytic.data.productSku);
            console.log(
              `Found available product ${availableProducts.length}/${args.limit} for user ${args.id}: ${availableSku.sku}`
            );
          }
        }
      }
    }

    console.log(
      `Found ${availableProducts.length} available products for user ${args.id}`
    );
    return availableProducts;
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

// Get just the most recent user activity for efficient status checking
export const getMostRecentActivity = query({
  args: {
    id: v.union(v.id(entity), v.id("guest")),
  },
  handler: async (ctx, args) => {
    // Get only the most recent analytics record
    const analytics = await ctx.db
      .query("analytics")
      .filter((q) => q.eq(q.field("storeFrontUserId"), args.id))
      .order("desc") // Most recent first
      .first();

    return analytics;
  },
});
