import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { recordStoreFrontCustomerMilestone } from "./helpers/customerEngagementEvents";
import { createRewardTierOperationDefinition } from "../operationAdmission/domains/u6_storefrontCustomer_definitions";
import { getRewardTiersReadDefinition } from "../operationAdmission/domains/u6_storefrontCustomer_readDefinitions";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import {
  assertCustomerOwnsRow,
  assertCustomerOwnsStore,
  customerOwnerActorId,
  customerOwnerValidator,
  denyCustomerOwnership,
} from "./customerOwnership";

function formatPointsLabel(points: number) {
  return `${points} points`;
}

/**
 * Internal siblings for the storefront rewards routes.
 *
 * Each takes the admitted shopper and re-derives what it can from the claim
 * rather than the request: points are read for the admitted account, tiers and
 * balances only for the admitted store, and an order's points only when that
 * order belongs to the admitted store.
 */
export const getUserPointsInternal = internalQuery({
  args: {
    storeFrontUserId: v.id("storeFrontUser"),
    storeId: v.id("store"),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, { owner, ...args }) => {
    assertCustomerOwnsStore(owner, args.storeId);
    if (String(args.storeFrontUserId) !== String(customerOwnerActorId(owner))) {
      denyCustomerOwnership();
    }
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

export const getTiersInternal = internalQuery({
  args: {
    storeId: v.id("store"),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, { owner, ...args }) => {
    assertCustomerOwnsStore(owner, args.storeId);
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- Reward tiers are store-scoped and intentionally returned as the active set for checkout and loyalty surfaces.
    return await ctx.db
      .query("rewardTiers")
      .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

export const getOrderPointsInternal = internalQuery({
  args: {
    orderId: v.id("onlineOrder"),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, { owner, ...args }) => {
    const order = await ctx.db.get("onlineOrder", args.orderId);
    assertCustomerOwnsRow(owner, order);

    const transaction = await ctx.db
      .query("rewardTransactions")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .first();

    if (transaction) {
      return { points: transaction.points, transaction };
    }
    if (!order) return { points: 0 };

    const potentialPoints = Math.floor(order.amount / 1000);
    return { points: order.hasVerifiedPayment ? potentialPoints : 0 };
  },
});

async function listPointHistory(
  ctx: QueryCtx,
  storeFrontUserId: Id<"storeFrontUser">,
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Point history is intentionally returned as the full user-visible ledger for one storefront account.
  return await ctx.db
    .query("rewardTransactions")
    .withIndex("by_user", (q) => q.eq("storeFrontUserId", storeFrontUserId))
    .order("desc")
    .collect();
}

// Get all reward tiers for a store
export const getTiers = query({
  args: {
    storeId: v.id("store"),
  },
  handler: admitPublicQuery(
    getRewardTiersReadDefinition,
    async (ctx, args: { storeId: Id<"store"> }) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- Reward tiers are store-scoped and intentionally returned as the active set for checkout and loyalty surfaces.
      return await ctx.db
        .query("rewardTiers")
        .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect();
    },
  ),
});

/**
 * Internal sibling for `GET /rewards/history`. The ledger is read for the
 * ADMITTED shopper, so the query string cannot select another account.
 */
export const getPointHistoryInternal = internalQuery({
  args: {
    storeFrontUserId: v.id("storeFrontUser"),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, args) => {
    if (
      String(args.storeFrontUserId) !== String(customerOwnerActorId(args.owner))
    ) {
      denyCustomerOwnership();
    }
    return await listPointHistory(
      ctx,
      args.storeFrontUserId,
    );
  },
});

// Award points for an order
export const awardOrderPoints = internalMutation({
  args: {
    orderId: v.id("onlineOrder"),
    points: v.number(),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get("onlineOrder", args.orderId);
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
    const rewardTransactionId = await ctx.db.insert("rewardTransactions", {
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
      await ctx.db.patch("rewardPoints", existing._id, {
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

    await recordStoreFrontCustomerMilestone(ctx, {
      eventType: "loyalty_points_awarded",
      message: `Awarded ${formatPointsLabel(args.points)} after order ${order.orderNumber}.`,
      metadata: {
        orderId: args.orderId,
        orderNumber: order.orderNumber,
        points: args.points,
        reason: "order_placed",
      },
      storeFrontUserId: order.storeFrontUserId as Id<"storeFrontUser">,
      storeId: order.storeId,
      subjectId: rewardTransactionId,
      subjectLabel: formatPointsLabel(args.points),
      subjectType: "loyalty",
    });

    return { success: true };
  },
});

// Redeem points for a discount
type RedeemPointsArgs = {
  storeFrontUserId: Id<"storeFrontUser">;
  storeId: Id<"store">;
  rewardTierId: Id<"rewardTiers">;
};

async function redeemPointsWithCtx(ctx: MutationCtx, args: RedeemPointsArgs) {
  {
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
    const tier = await ctx.db.get("rewardTiers", args.rewardTierId);
    if (!tier) {
      return { success: false, error: "Reward tier not found" };
    }

    // Check if user has enough points
    if (pointsRecord.points < tier.pointsRequired) {
      return { success: false, error: "Not enough points" };
    }

    // Record the redemption transaction
    const rewardTransactionId = await ctx.db.insert("rewardTransactions", {
      storeFrontUserId: args.storeFrontUserId,
      storeId: args.storeId,
      points: -tier.pointsRequired, // Negative points for redemption
      reason: "points_redeemed",
    });

    // Update the user's point balance
    await ctx.db.patch("rewardPoints", pointsRecord._id, {
      points: pointsRecord.points - tier.pointsRequired,
      updatedAt: Date.now(),
    });

    await recordStoreFrontCustomerMilestone(ctx, {
      eventType: "reward_redeemed",
      message: `Redeemed ${tier.pointsRequired} points for ${tier.name}.`,
      metadata: {
        discountType: tier.discountType,
        discountValue: tier.discountValue,
        points: tier.pointsRequired,
        rewardTierId: args.rewardTierId,
        rewardTierName: tier.name,
      },
      storeFrontUserId: args.storeFrontUserId,
      storeId: args.storeId,
      subjectId: rewardTransactionId,
      subjectLabel: tier.name,
      subjectType: "reward",
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
  }
}

/**
 * Internal sibling for `POST /rewards/redeem`. Points are spent from the
 * ADMITTED shopper's balance, in their own store, against a tier that belongs
 * to that store — none of those three ids is taken on trust from the body.
 */
export const redeemPointsInternal = internalMutation({
  args: {
    storeFrontUserId: v.id("storeFrontUser"),
    storeId: v.id("store"),
    rewardTierId: v.id("rewardTiers"),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, { owner, ...args }) => {
    assertCustomerOwnsStore(owner, args.storeId);
    if (String(args.storeFrontUserId) !== String(customerOwnerActorId(owner))) {
      denyCustomerOwnership();
    }
    const tier = await ctx.db.get("rewardTiers", args.rewardTierId);
    assertCustomerOwnsStore(owner, tier?.storeId);
    return await redeemPointsWithCtx(ctx, args);
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
  handler: admitPublicMutation(
    createRewardTierOperationDefinition,
    async (
      ctx,
      args: {
        storeId: Id<"store">;
        name: string;
        pointsRequired: number;
        discountType: "percentage" | "fixed";
        discountValue: number;
        isActive: boolean;
      },
    ) => {
      return await ctx.db.insert("rewardTiers", {
        storeId: args.storeId,
        name: args.name,
        pointsRequired: args.pointsRequired,
        discountType: args.discountType,
        discountValue: args.discountValue,
        isActive: args.isActive,
      });
    },
  ),
});

// Add a new query to get potential past orders for rewards
async function listPastEligibleOrders(
  ctx: QueryCtx,
  args: { storeFrontUserId: Id<"storeFrontUser">; email: string },
) {
  {
    // Get all past orders for this email that were made as a guest
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- This guest-order recovery flow needs the full matching paid-order set before it can filter already-awarded transactions.
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
          potentialPoints: Math.floor(order.amount / 1000), // 1 point per GH₵10 (pesewas / 1000)
        });
      }
    }

    return eligibleOrders;
  }
}

/**
 * Internal sibling for `GET /rewards/eligible-past-orders`. The recovery flow
 * matches historical GUEST orders by email, so the email is not an ownership
 * proof on its own — the admitted account id is what authorizes the lookup.
 */
export const getPastEligibleOrdersInternal = internalQuery({
  args: {
    storeFrontUserId: v.id("storeFrontUser"),
    email: v.string(),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, { owner, ...args }) => {
    if (String(args.storeFrontUserId) !== String(customerOwnerActorId(owner))) {
      denyCustomerOwnership();
    }
    return await listPastEligibleOrders(ctx, args);
  },
});

type AwardPointsForPastOrderArgs = {
  storeFrontUserId: Id<"storeFrontUser">;
  orderId: Id<"onlineOrder">;
};

async function awardPointsForPastOrderWithCtx(
  ctx: MutationCtx,
  args: AwardPointsForPastOrderArgs,
) {
  {
    // Get the order
    const order = await ctx.db.get("onlineOrder", args.orderId);
    if (!order) return { success: false, error: "Order not found" };

    // Check if this order has already had points awarded
    const existingTransaction = await ctx.db
      .query("rewardTransactions")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .first();

    if (existingTransaction) {
      return { success: false, error: "Points already awarded for this order" };
    }

    // Calculate points (1 point per GH₵10 spent, rounded down)
    const pointsToAward = Math.floor(order.amount / 1000);

    // Record the transaction
    const rewardTransactionId = await ctx.db.insert("rewardTransactions", {
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
      await ctx.db.patch("rewardPoints", existing._id, {
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

    await recordStoreFrontCustomerMilestone(ctx, {
      eventType: "loyalty_points_awarded",
      message: `Awarded ${formatPointsLabel(pointsToAward)} after order ${order.orderNumber}.`,
      metadata: {
        orderId: args.orderId,
        orderNumber: order.orderNumber,
        points: pointsToAward,
        reason: "past_order_points",
      },
      storeFrontUserId: args.storeFrontUserId,
      storeId: order.storeId,
      subjectId: rewardTransactionId,
      subjectLabel: formatPointsLabel(pointsToAward),
      subjectType: "loyalty",
    });

    return {
      success: true,
      points: pointsToAward,
    };
  }
}

/**
 * Internal sibling for `POST /rewards/award-past-order`. Points land on the
 * ADMITTED account, and the order must belong to the store the claim clamped
 * to — a stranger's order id cannot be converted into this shopper's points.
 */
export const awardPointsForPastOrderInternal = internalMutation({
  args: {
    storeFrontUserId: v.id("storeFrontUser"),
    orderId: v.id("onlineOrder"),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, { owner, ...args }) => {
    if (String(args.storeFrontUserId) !== String(customerOwnerActorId(owner))) {
      denyCustomerOwnership();
    }
    const order = await ctx.db.get("onlineOrder", args.orderId);
    assertCustomerOwnsStore(owner, order?.storeId);
    return await awardPointsForPastOrderWithCtx(ctx, args);
  },
});

type AwardPointsForGuestOrdersArgs = {
  storeFrontUserId: Id<"storeFrontUser">;
  guestId: Id<"guest">;
};

async function awardPointsForGuestOrdersWithCtx(
  ctx: MutationCtx,
  args: AwardPointsForGuestOrdersArgs,
) {
  {
    // Get guest information first
    const guest = await ctx.db.get("guest", args.guestId);
    if (!guest || !guest.email) {
      return { success: false, error: "Guest not found or has no email" };
    }

    // Get eligible past orders. This used to re-enter through
    // `api.storeFront.rewards.getPastEligibleOrders`, which ran a SECOND
    // admission with the backend's own context; the shared implementation is
    // called directly instead, so the caller's admission is the only one.
    const pastEligibleOrders = await listPastEligibleOrders(ctx, {
      storeFrontUserId: args.storeFrontUserId,
      email: guest.email,
    });

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
        await ctx.db.patch("rewardTransactions", existingTransaction._id, {
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
        transactions.map(async (transaction) => {
          const rewardTransactionId = await ctx.db.insert(
            "rewardTransactions",
            transaction,
          );

          await recordStoreFrontCustomerMilestone(ctx, {
            eventType: "loyalty_points_awarded",
            message: `Awarded ${formatPointsLabel(transaction.points)} after order ${transaction.orderNumber}.`,
            metadata: {
              orderId: transaction.orderId,
              orderNumber: transaction.orderNumber,
              points: transaction.points,
              reason: transaction.reason,
            },
            storeFrontUserId: transaction.storeFrontUserId,
            storeId: transaction.storeId,
            subjectId: rewardTransactionId,
            subjectLabel: formatPointsLabel(transaction.points),
            subjectType: "loyalty",
          });
        }),
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
          return ctx.db.patch("rewardPoints", existingPointsRecord._id, {
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
  }
}

/**
 * Internal sibling for `POST /rewards/award-guest-orders`. This merges a guest
 * history into an account, so BOTH ids must be the admitted shopper's.
 *
 * The account is the claim itself. The guest side is bounded twice: it must be
 * the guest session the CALLER holds a cookie for (`claimGuestId`, resolved by
 * the rail from the request, never from the body), and that guest row must
 * belong to the admitted store. Store alone was not enough — reward points are
 * transferable value, so a store-only bound let any signed-in shopper claim a
 * stranger's guest order history and the points attached to it.
 */
export const awardPointsForGuestOrdersInternal = internalMutation({
  args: {
    storeFrontUserId: v.id("storeFrontUser"),
    guestId: v.id("guest"),
    claimGuestId: v.optional(v.id("guest")),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, { owner, claimGuestId, ...args }) => {
    if (String(args.storeFrontUserId) !== String(customerOwnerActorId(owner))) {
      denyCustomerOwnership();
    }
    if (!claimGuestId || String(claimGuestId) !== String(args.guestId)) {
      denyCustomerOwnership();
    }
    const guest = await ctx.db.get("guest", args.guestId);
    assertCustomerOwnsStore(owner, guest?.storeId);
    return await awardPointsForGuestOrdersWithCtx(ctx, args);
  },
});
