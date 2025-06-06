import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { api } from "../_generated/api";
import { internal } from "../_generated/api";
import { z } from "zod";
import { QueryCtx } from "../_generated/server";
import { sendDiscountCodeEmail } from "../sendgrid";

const entity = "offer" as const;

// Email validation with Zod
const emailSchema = z
  .string()
  .email("Invalid email address")
  .refine((value) => value.trim().length > 0, "Email cannot be empty");

// Rate limiting: check if there are too many requests from this IP
const isRateLimited = async (
  ctx: QueryCtx,
  ipAddress: string | undefined,
  email: string
) => {
  if (!ipAddress) return false;

  // Check IP-based rate limiting (10 attempts per hour)
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const ipRequests = await ctx.db
    .query(entity)
    .withIndex("by_ipAddress", (q) => q.eq("ipAddress", ipAddress))
    .filter((q) => q.gte(q.field("_creationTime"), hourAgo))
    .collect();

  if (ipRequests.length >= 10) {
    return true;
  }

  // Check email-based rate limiting (3 attempts per day)
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const emailRequests = await ctx.db
    .query(entity)
    .withIndex("by_email", (q) => q.eq("email", email))
    .filter((q) => q.gte(q.field("_creationTime"), dayAgo))
    .collect();

  if (emailRequests.length >= 3) {
    return true;
  }

  return false;
};

// Check if this email + guest combination already exists for this promo
const isDuplicate = async (
  ctx: QueryCtx,
  email: string,
  storeFrontUserId: Id<"storeFrontUser"> | Id<"guest">
) => {
  const [existing] = await Promise.all([
    ctx.db
      .query(entity)
      .filter((q) =>
        q.or(
          q.eq(q.field("email"), email),
          q.eq(q.field("storeFrontUserId"), storeFrontUserId)
        )
      )
      .first(),
  ]);

  return !!existing;
};

// Create a new offer
export const create = mutation({
  args: {
    email: v.string(),
    promoCodeId: v.id("promoCode"),
    storeFrontUserId: v.union(v.id("guest"), v.id("storeFrontUser")),
    storeId: v.id("store"),
    ipAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate email
    try {
      emailSchema.parse(args.email);
    } catch (error) {
      return {
        success: false,
        message: "Invalid email address",
      };
    }

    // Check rate limiting
    // const isLimited = await isRateLimited(ctx, args.ipAddress, args.email);
    // if (isLimited) {
    //   return {
    //     success: false,
    //     message: "Too many requests. Please try again later.",
    //   };
    // }

    // Check for duplicates
    const isDuplicateSubmission = await isDuplicate(
      ctx,
      args.email,
      args.storeFrontUserId
    );

    if (isDuplicateSubmission) {
      return {
        success: false,
        message: "You've already requested this offer.",
      };
    }

    // Create the offer
    const offerId = await ctx.db.insert(entity, {
      email: args.email,
      promoCodeId: args.promoCodeId,
      storeFrontUserId: args.storeFrontUserId,
      storeId: args.storeId,
      status: "pending",
      ipAddress: args.ipAddress,
    });

    // Schedule email sending
    await ctx.scheduler.runAfter(0, internal.storeFront.offers.sendOfferEmail, {
      offerId,
    });

    await ctx.db.patch(args.storeFrontUserId, {
      email: args.email,
    });

    return {
      success: true,
      message: "Offer requested successfully!",
    };
  },
});

// Send the discount code email
export const sendOfferEmail = internalAction({
  args: {
    offerId: v.id(entity),
  },
  handler: async (ctx, args) => {
    // Get the offer
    const offer = await ctx.runQuery(api.storeFront.offers.getById, {
      id: args.offerId,
    });

    if (!offer || offer.status !== "pending") {
      return {
        success: false,
        message: "Offer not found or already processed",
      };
    }

    // Get the promo code
    const promoCode = await ctx.runQuery(api.inventory.promoCode.getById, {
      id: offer.promoCodeId,
    });

    if (!promoCode) {
      await ctx.runMutation(internal.storeFront.offers.updateStatus, {
        id: args.offerId,
        status: "error",
        errorMessage: "Promo code not found",
      });
      return {
        success: false,
        message: "Promo code not found",
      };
    }

    // Get the store
    const store = await ctx.runQuery(api.inventory.stores.getById, {
      id: offer.storeId,
    });

    if (!store) {
      await ctx.runMutation(internal.storeFront.offers.updateStatus, {
        id: args.offerId,
        status: "error",
        errorMessage: "Store not found",
      });
      return {
        success: false,
        message: "Store not found",
      };
    }

    try {
      // Send the email using SendGrid
      await sendDiscountCodeEmail({
        customerEmail: offer.email,
        promoCode: promoCode.code,
        validTo: new Date(promoCode.validTo),
        discount: promoCode.displayText,
      });

      // Mark as sent
      await ctx.runMutation(internal.storeFront.offers.updateStatus, {
        id: args.offerId,
        status: "sent",
        sentAt: Date.now(),
      });

      return {
        success: true,
        message: "Discount code email sent",
      };
    } catch (error) {
      // Handle errors
      await ctx.runMutation(internal.storeFront.offers.updateStatus, {
        id: args.offerId,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        message: "Failed to send discount code email",
      };
    }
  },
});

// Internal mutation to update the status of an offer
export const updateStatus = internalMutation({
  args: {
    id: v.id(entity),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("error")
    ),
    sentAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      sentAt: args.sentAt,
      errorMessage: args.errorMessage,
    });
  },
});

// Get an offer by ID
export const getById = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Get offers by store ID
export const getByStoreId = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .collect();
  },
});

// Get offers by promo code ID
export const getByPromoCodeId = query({
  args: {
    promoCodeId: v.id("promoCode"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query(entity)
      .withIndex("by_promoCodeId", (q) => q.eq("promoCodeId", args.promoCodeId))
      .order("desc")
      .collect();
  },
});

// Get offers by email
export const getByEmail = query({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query(entity)
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .order("desc")
      .collect();
  },
});

// Get offers by storefront user ID
export const getByStorefrontUserId = query({
  args: {
    storeFrontUserId: v.union(v.id("guest"), v.id("storeFrontUser")),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query(entity)
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.storeFrontUserId)
      )
      .order("desc")
      .collect();
  },
});

export const getAll = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();
  },
});
