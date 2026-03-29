import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { api } from "../_generated/api";

// Get user's current points
export const getUserPoints = query({
  args: {
    storeFrontUserId: v.id("storeFrontUser"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const pointsRecord = await ctx.db
      .query("rewardPoints")
      .withIndex("by_user_store", (q) =>
        q
          .eq("storeFrontUserId", args.storeFrontUserId)
          .eq("storeId", args.storeId)
      )
      .first();

    return pointsRecord?.points || 0;
  },
});

// Get all reward tiers for a store
export const getTiers = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rewardTiers")
      .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

// Get user's point history
export const getPointHistory = query({
  args: {
    storeFrontUserId: v.id("storeFrontUser"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rewardTransactions")
      .withIndex("by_user", (q) =>
        q.eq("storeFrontUserId", args.storeFrontUserId)
      )
      .order("desc")
      .collect();
  },
});

// Award points for an order
export const awardOrderPoints = internalMutation({
  args: {
    orderId: v.id("onlineOrder"),
    points: v.number(),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order) return { success: false, error: "Order not found" };

    // We can only award points to registered users, not guests
    const userId = order.storeFrontUserId;
    if (typeof userId === "string" && userId.startsWith("guest")) {
      return { success: false, error: "Guest orders don't earn points" };
    }

    console.log("userId", userId);

    try {
      const user = await ctx.db
        .query("storeFrontUser")
        .filter((q) => q.eq(q.field("_id"), userId))
        .first();

      if (!user) {
        return { success: false, error: "Guest orders don't earn points" };
      }

      console.log("User found", user);
    } catch (e) {
      console.error("Error finding user", e);
      return { success: false, error: "Guest orders don't earn points" };
    }

    // Record the transaction
    await ctx.db.insert("rewardTransactions", {
      storeFrontUserId: order.storeFrontUserId as Id<"storeFrontUser">,
      storeId: order.storeId,
      points: args.points,
      orderId: args.orderId,
      reason: "order_placed",
      orderNumber: order.orderNumber,
    });

    // Update or create the user's point balance
    const existing = await ctx.db
      .query("rewardPoints")
      .withIndex("by_user_store", (q) =>
        q
          .eq(
            "storeFrontUserId",
            order.storeFrontUserId as Id<"storeFrontUser">
          )
          .eq("storeId", order.storeId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        points: existing.points + args.points,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("rewardPoints", {
        storeFrontUserId: order.storeFrontUserId as Id<"storeFrontUser">,
        storeId: order.storeId,
        points: args.points,
        updatedAt: Date.now(),
      });
    }

    return { success: true };
  },
});

// Redeem points for a discount
export const redeemPoints = mutation({
  args: {
    storeFrontUserId: v.id("storeFrontUser"),
    storeId: v.id("store"),
    rewardTierId: v.id("rewardTiers"),
  },
  handler: async (ctx, args) => {
    // Get user's current points
    const pointsRecord = await ctx.db
      .query("rewardPoints")
      .withIndex("by_user_store", (q) =>
        q
          .eq("storeFrontUserId", args.storeFrontUserId)
          .eq("storeId", args.storeId)
      )
      .first();

    if (!pointsRecord) {
      return { success: false, error: "No points available" };
    }

    // Get the reward tier
    const tier = await ctx.db.get(args.rewardTierId);
    if (!tier) {
      return { success: false, error: "Reward tier not found" };
    }

    // Check if user has enough points
    if (pointsRecord.points < tier.pointsRequired) {
      return { success: false, error: "Not enough points" };
    }

    // Record the redemption transaction
    await ctx.db.insert("rewardTransactions", {
      storeFrontUserId: args.storeFrontUserId,
      storeId: args.storeId,
      points: -tier.pointsRequired, // Negative points for redemption
      reason: "points_redeemed",
    });

    // Update the user's point balance
    await ctx.db.patch(pointsRecord._id, {
      points: pointsRecord.points - tier.pointsRequired,
      updatedAt: Date.now(),
    });

    // Return the discount information for application
    return {
      success: true,
      pointsUsed: tier.pointsRequired,
      discount: {
        type: tier.discountType,
        value: tier.discountValue,
        name: tier.name,
      },
    };
  },
});

// Admin function to create a reward tier
export const createRewardTier = mutation({
  args: {
    storeId: v.id("store"),
    name: v.string(),
    pointsRequired: v.number(),
    discountType: v.union(v.literal("percentage"), v.literal("fixed")),
    discountValue: v.number(),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("rewardTiers", {
      storeId: args.storeId,
      name: args.name,
      pointsRequired: args.pointsRequired,
      discountType: args.discountType,
      discountValue: args.discountValue,
      isActive: args.isActive,
    });
  },
});

// Add a new query to get potential past orders for rewards
export const getPastEligibleOrders = query({
  args: {
    storeFrontUserId: v.id("storeFrontUser"),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    // Get all past orders for this email that were made as a guest
    const guestOrders = await ctx.db
      .query("onlineOrder")
      .filter((q) =>
        q.and(
          // Only consider orders with verified payment
          q.eq(q.field("hasVerifiedPayment"), true),
          // Check if order has customer details with matching email
          q.eq(q.field("customerDetails.email"), args.email)
        )
      )
      .collect();

    // Filter to only get orders that haven't already been awarded points
    const eligibleOrders = [];

    for (const order of guestOrders) {
      // Check if this order has already had points awarded
      const transaction = await ctx.db
        .query("rewardTransactions")
        .withIndex("by_order", (q) => q.eq("orderId", order._id))
        .first();

      // If no transaction exists, this order is eligible
      if (!transaction) {
        eligibleOrders.push({
          _id: order._id,
          _creationTime: order._creationTime,
          amount: order.amount,
          storeId: order.storeId,
          status: order.status,
          orderNumber: order.orderNumber,
          hasVerifiedPayment: order.hasVerifiedPayment,
          potentialPoints: Math.floor(order.amount / 10), // 1 point per dollar
        });
      }
    }

    return eligibleOrders;
  },
});

// Add a mutation to award points for a past order
export const awardPointsForPastOrder = mutation({
  args: {
    storeFrontUserId: v.id("storeFrontUser"),
    orderId: v.id("onlineOrder"),
  },
  handler: async (ctx, args) => {
    // Get the order
    const order = await ctx.db.get(args.orderId);
    if (!order) return { success: false, error: "Order not found" };

    // Check if this order has already had points awarded
    const existingTransaction = await ctx.db
      .query("rewardTransactions")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .first();

    if (existingTransaction) {
      return { success: false, error: "Points already awarded for this order" };
    }

    // Calculate points (1 point per dollar spent, rounded down)
    const pointsToAward = Math.floor(order.amount / 10);

    // Record the transaction
    await ctx.db.insert("rewardTransactions", {
      storeFrontUserId: args.storeFrontUserId,
      storeId: order.storeId,
      points: pointsToAward,
      orderId: args.orderId,
      orderNumber: order.orderNumber,
      reason: "past_order_points",
    });

    // Update or create the user's point balance
    const existing = await ctx.db
      .query("rewardPoints")
      .withIndex("by_user_store", (q) =>
        q
          .eq("storeFrontUserId", args.storeFrontUserId)
          .eq("storeId", order.storeId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        points: existing.points + pointsToAward,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("rewardPoints", {
        storeFrontUserId: args.storeFrontUserId,
        storeId: order.storeId,
        points: pointsToAward,
        updatedAt: Date.now(),
      });
    }

    return {
      success: true,
      points: pointsToAward,
    };
  },
});

// Get reward points for a specific order
export const getOrderPoints = query({
  args: {
    orderId: v.id("onlineOrder"),
  },
  handler: async (ctx, args) => {
    // First, check if there's a transaction for this order
    const transaction = await ctx.db
      .query("rewardTransactions")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .first();

    if (transaction) {
      return {
        points: transaction.points,
        transaction,
      };
    }

    // If no transaction found, get the order to calculate potential points
    const order = await ctx.db.get(args.orderId);
    if (!order) {
      return { points: 0 };
    }

    // Calculate potential points (1 point per dollar spent, rounded down)
    const potentialPoints = Math.floor(order.amount / 10);

    return {
      points: order.hasVerifiedPayment ? potentialPoints : 0,
    };
  },
});

export const awardPointsForGuestOrders = mutation({
  args: {
    storeFrontUserId: v.id("storeFrontUser"),
    guestId: v.id("guest"),
  },
  handler: async (ctx, args) => {
    // Get guest information first
    const guest = await ctx.db.get(args.guestId);
    if (!guest || !guest.email) {
      return { success: false, error: "Guest not found or has no email" };
    }

    // Get eligible past orders
    const pastEligibleOrders = await ctx.runQuery(
      api.storeFront.rewards.getPastEligibleOrders,
      {
        storeFrontUserId: args.storeFrontUserId,
        email: guest.email,
      }
    );

    if (pastEligibleOrders.length === 0) {
      return {
        success: false,
        error: "No eligible orders found for this guest",
      };
    }

    let totalPointsAwarded = 0;
    let ordersProcessed = 0;

    // Process batches of transactions to avoid excessive database operations
    const transactions: Array<{
      storeFrontUserId: Id<"storeFrontUser">;
      storeId: Id<"store">;
      points: number;
      orderId: Id<"onlineOrder">;
      reason: string;
      orderNumber: string;
    }> = [];

    // Map to collect point updates by store
    const storePointsMap: Record<Id<"store">, number> = {};

    // Process each eligible order
    for (const order of pastEligibleOrders) {
      const existingTransaction = await ctx.db
        .query("rewardTransactions")
        .withIndex("by_order", (q) => q.eq("orderId", order._id))
        .first();

      if (existingTransaction) {
        await ctx.db.patch(existingTransaction._id, {
          points: existingTransaction.points + order.potentialPoints,
        });
      } else {
        // Collect transactions to insert
        transactions.push({
          storeFrontUserId: args.storeFrontUserId,
          storeId: order.storeId,
          points: order.potentialPoints,
          orderId: order._id,
          orderNumber: order.orderNumber,
          reason: "past_order_points",
        });
      }

      // Collect points by store for batched updates
      if (storePointsMap[order.storeId]) {
        storePointsMap[order.storeId] += order.potentialPoints;
      } else {
        storePointsMap[order.storeId] = order.potentialPoints;
      }

      totalPointsAwarded += order.potentialPoints;
      ordersProcessed++;
    }

    // Batch insert all new transactions
    if (transactions.length > 0) {
      await Promise.all(
        transactions.map((transaction) =>
          ctx.db.insert("rewardTransactions", transaction)
        )
      );
    }

    // Update point records for each store
    const pointUpdatePromises = Object.entries(storePointsMap).map(
      async ([storeId, points]) => {
        const typedStoreId = storeId as Id<"store">;
        const existingPointsRecord = await ctx.db
          .query("rewardPoints")
          .withIndex("by_user_store", (q) =>
            q
              .eq("storeFrontUserId", args.storeFrontUserId)
              .eq("storeId", typedStoreId)
          )
          .first();

        if (existingPointsRecord) {
          return ctx.db.patch(existingPointsRecord._id, {
            points: existingPointsRecord.points + points,
            updatedAt: Date.now(),
          });
        } else {
          return ctx.db.insert("rewardPoints", {
            storeFrontUserId: args.storeFrontUserId,
            storeId: typedStoreId,
            points: points,
            updatedAt: Date.now(),
          });
        }
      }
    );

    await Promise.all(pointUpdatePromises);

    return {
      success: true,
      pointsAwarded: totalPointsAwarded,
      ordersProcessed,
    };
  },
});
