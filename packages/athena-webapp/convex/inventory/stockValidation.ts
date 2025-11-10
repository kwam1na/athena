import { query } from "../_generated/server";
import { v } from "convex/values";

const MAX_SKUS_PER_REQUEST = 50;
const SESSION_AGE_LIMIT_HOURS = 24;

/**
 * Get SKUs that are currently reserved in active checkout sessions.
 * This prevents editing stock/quantity fields for SKUs that customers
 * are actively trying to purchase.
 */
export const getSkusReservedInCheckout = query({
  args: {
    skus: v.array(v.string()),
    storeId: v.id("store"),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    // Early exit for empty arrays
    if (args.skus.length === 0) {
      return [];
    }

    // Batch size limit to prevent excessive OR conditions
    if (args.skus.length > MAX_SKUS_PER_REQUEST) {
      throw new Error(
        `Too many SKUs to check at once (${args.skus.length}). ` +
          `Maximum allowed is ${MAX_SKUS_PER_REQUEST}. Please batch your requests.`
      );
    }

    // Calculate age filter - only check sessions from last 24 hours
    const sessionAgeLimit =
      Date.now() - SESSION_AGE_LIMIT_HOURS * 60 * 60 * 1000;

    // Step 1: Get active checkout sessions (session-first approach)
    // This is typically fewer records than checkout items
    const activeSessions = await ctx.db
      .query("checkoutSession")
      .filter((q) =>
        q.and(
          q.eq(q.field("storeId"), args.storeId),
          q.eq(q.field("hasCompletedCheckoutSession"), false),
          q.gt(q.field("_creationTime"), sessionAgeLimit)
        )
      )
      .collect();

    // Early exit if no active sessions
    if (activeSessions.length === 0) {
      return [];
    }

    // Step 2: Get checkout items for these sessions that match our SKUs
    // Use the new index by querying each session individually for better performance
    const sessionIds = activeSessions.map((s) => s._id);
    const checkoutItemsPromises = sessionIds.map((sessionId) =>
      ctx.db
        .query("checkoutSessionItem")
        .withIndex("by_sessionId", (q) => q.eq("sesionId", sessionId))
        .filter((q) =>
          q.or(...args.skus.map((sku) => q.eq(q.field("productSku"), sku)))
        )
        .collect()
    );

    const checkoutItemsArrays = await Promise.all(checkoutItemsPromises);
    const checkoutItems = checkoutItemsArrays.flat();

    // Step 3: Return unique SKUs that are reserved
    const reservedSkus = [
      ...new Set(checkoutItems.map((item) => item.productSku)),
    ];

    return reservedSkus;
  },
});

/**
 * Get SKUs that are currently reserved in active POS sessions.
 * This prevents editing stock/quantity fields for SKUs that are actively
 * in use at a POS terminal.
 */
export const getSkusReservedInPosSession = query({
  args: {
    skus: v.array(v.string()),
    storeId: v.id("store"),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    // Early exit for empty arrays
    if (args.skus.length === 0) {
      return [];
    }

    // Batch size limit to prevent excessive OR conditions
    if (args.skus.length > MAX_SKUS_PER_REQUEST) {
      throw new Error(
        `Too many SKUs to check at once (${args.skus.length}). ` +
          `Maximum allowed is ${MAX_SKUS_PER_REQUEST}. Please batch your requests.`
      );
    }

    const now = Date.now();

    // Step 1: Get active and held POS sessions (session-first approach)
    // Only check sessions that haven't expired
    const activeSessions = await ctx.db
      .query("posSession")
      .withIndex("by_storeId_and_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "active")
      )
      .filter((q) => q.gte(q.field("expiresAt"), now))
      .collect();

    const heldSessions = await ctx.db
      .query("posSession")
      .withIndex("by_storeId_and_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "held")
      )
      .filter((q) => q.gte(q.field("expiresAt"), now))
      .collect();

    const allActiveSessions = [...activeSessions, ...heldSessions];

    // Early exit if no active/held sessions
    if (allActiveSessions.length === 0) {
      return [];
    }

    // Step 2: Get POS session items for these sessions that match our SKUs
    const sessionIds = allActiveSessions.map((s) => s._id);
    const posItemsPromises = sessionIds.map((sessionId) =>
      ctx.db
        .query("posSessionItem")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .filter((q) =>
          q.or(...args.skus.map((sku) => q.eq(q.field("productSku"), sku)))
        )
        .collect()
    );

    const posItemsArrays = await Promise.all(posItemsPromises);
    const posItems = posItemsArrays.flat();

    // Step 3: Return unique SKUs that are reserved
    const reservedSkus = [...new Set(posItems.map((item) => item.productSku))];

    return reservedSkus;
  },
});
