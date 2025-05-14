import { v } from "convex/values";
import { query, QueryCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

/**
 * Determine if the user is eligible for offers
 */
export const getEligibility = query({
  args: {
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    // Determine eligibility based on user activity
    const eligibility = await determineOfferEligibility(
      ctx,
      args.storeFrontUserId,
      args.storeId
    );

    return eligibility;
  },
});

// Define a minimal interface for analytics records
interface AnalyticsRecord {
  _creationTime: number;
  action: string;
}

/**
 * Check whether a user is eligible for the WELCOME25 offer
 */
async function determineOfferEligibility(
  ctx: QueryCtx,
  userId: Id<"storeFrontUser"> | Id<"guest">,
  storeId: Id<"store">
) {
  // Get user's recent activity
  const recentActivity = await ctx.db
    .query("analytics")
    .withIndex("by_storeFrontUserId", (q) => q.eq("storeFrontUserId", userId))
    .take(20);

  // Check if the user is returning - look for activity more than a day old
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const hasOlderActivity = recentActivity.some(
    (activity: AnalyticsRecord) => Date.now() - activity._creationTime > ONE_DAY
  );

  // Check engagement level by counting unique actions
  const uniqueActions = new Set(
    recentActivity.map((activity: AnalyticsRecord) => activity.action)
  );
  const isEngaged = uniqueActions.size >= 2;

  const store = await ctx.db.get(storeId);
  const currentWelcomeOffer: Id<"promoCode"> | null =
    store?.config?.homepageDiscountCodeModalPromoCode;

  // Check if the WELCOME25 promo code exists and is active
  const welcomePromo = currentWelcomeOffer
    ? await ctx.db.get(currentWelcomeOffer)
    : null;

  // Check if user has already redeemed this code
  const hasRedeemed = welcomePromo
    ? (await ctx.db
        .query("redeemedPromoCode")
        .filter((q) =>
          q.and(
            q.eq(q.field("promoCodeId"), welcomePromo._id),
            q.eq(q.field("storeFrontUserId"), userId)
          )
        )
        .first()) !== null
    : false;

  // Only returning users get the WELCOME25 offer
  const isEligibleForWelcome25 =
    hasOlderActivity && welcomePromo && welcomePromo.active && !hasRedeemed;

  return {
    isReturningUser: hasOlderActivity,
    isEngaged,
    isEligibleForWelcome25,
  };
}
