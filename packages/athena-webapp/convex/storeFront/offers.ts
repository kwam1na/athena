import {
  ActionCtx,
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
import { sendDiscountCodeEmail, sendDiscountReminderEmail } from "../sendgrid";
import { currencyFormatter, getProductName, toSlug } from "../utils";
import { getProductDiscountValue } from "../inventory/utils";
import { GenericActionCtx } from "convex/server";

const entity = "offer" as const;

const heroImageUrl =
  "https://athena-amzn-bucket.s3.eu-west-1.amazonaws.com/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/assets/a0171a4f-036a-4928-3387-8b578e4f297d.webp";

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

    try {
      const { bestSellers, recentlyViewed } = await getUpsellProducts({
        ctx,
        storeId: offer.storeId,
        offer,
        promoCode,
      });

      // Send the email using SendGrid
      await sendDiscountCodeEmail({
        customerEmail: offer.email,
        promoCode: promoCode.code,
        promoCodeEndDate: new Date(promoCode.validTo).toISOString(),
        promoCodeSpan: promoCode.span,
        bestSellers,
        recentlyViewed,
        discountText: promoCode.displayText,
        heroImageUrl,
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

export const sendOfferReminderEmail = internalAction({
  args: {
    offerId: v.id(entity),
  },
  handler: async (ctx, args) => {
    // Get the offer
    const offer = await ctx.runQuery(api.storeFront.offers.getById, {
      id: args.offerId,
    });

    if (!offer || offer.isRedeemed) {
      return {
        success: false,
        message: "Offer not found or already redeemed",
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
      return {
        success: false,
        message: "Store not found",
      };
    }

    try {
      const [bestSellers, recentlyViewedHairProducts] = await Promise.all([
        ctx.runQuery(api.inventory.bestSeller.getAll, {
          storeId: offer.storeId,
        }),
        ctx.runQuery(api.storeFront.user.getLastViewedProducts, {
          id: offer.storeFrontUserId,
          category: "Hair",
          limit: 2,
        }),
      ]);

      const hairBestSellers = bestSellers.filter(
        (seller) => seller.productSku.productCategory === "Hair"
      );

      const formatter = currencyFormatter(store?.currency || "GHS");

      const hairBestSellersData = hairBestSellers
        .filter(
          (seller) =>
            !recentlyViewedHairProducts.find(
              (product) => product.sku === seller.productSku.sku
            )
        )
        .map((seller) => {
          return {
            image: seller.productSku.images[0],
            name: getProductName(seller.productSku),
            original_price: formatter.format(seller.productSku.price),
            discounted_price: formatter.format(
              Math.round(
                seller.productSku.price -
                  getProductDiscountValue(seller.productSku.price, promoCode)
              )
            ),
            product_url: `${process.env.STORE_URL}/shop/product/${seller.productId}?variant=${seller.productSku.sku}&origin=discount_reminder_email`,
          };
        })
        .slice(0, 4);

      const recentlyViewedHairProductsData = recentlyViewedHairProducts.map(
        (productSku) => {
          return {
            image: productSku.images[0],
            name: getProductName(productSku),
            original_price: formatter.format(productSku.price),
            discounted_price: formatter.format(
              Math.round(
                productSku.price -
                  getProductDiscountValue(productSku.price, promoCode)
              )
            ),
            product_url: `${process.env.STORE_URL}/shop/product/${productSku.productId}?variant=${productSku.sku}&origin=discount_reminder_email`,
          };
        }
      );

      // Send the email using SendGrid
      await sendDiscountReminderEmail({
        customerEmail: offer.email,
        bestSellers: hairBestSellersData,
        recentlyViewed: recentlyViewedHairProductsData,
        discountText: promoCode.displayText,
        promoCode: promoCode.code,
        heroImageUrl,
      });

      // // Mark as sent
      await ctx.runMutation(internal.storeFront.offers.updateStatus, {
        id: args.offerId,
        status: "reminded",
        activity: {
          action: "sent_first_reminder",
          timestamp: Date.now(),
        },
      });

      console.log(`Discount reminder email sent to ${offer.email}`);

      return {
        success: true,
        message: "Discount reminder email sent",
      };
    } catch (error) {
      // Handle errors

      return {
        success: false,
        message: "Failed to send discount code email",
      };
    }
  },
});

export const sendOfferReminderEmails = internalAction({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const offers: any = await ctx.runQuery(api.storeFront.offers.getAll, {
      storeId: args.storeId,
      status: "sent",
    });

    if (offers.length === 0) {
      return {
        success: true,
        message: "No offers to send reminder emails for",
      };
    }

    const queries: any = offers.map((offer: any) => {
      return ctx.scheduler.runAfter(
        0,
        internal.storeFront.offers.sendOfferReminderEmail,
        {
          offerId: offer._id,
        }
      );
    });

    await Promise.all(queries);

    console.log(`Discount reminder emails sent for ${offers.length} offer(s)`);

    return {
      success: true,
      message: `Discount reminder emails sent for ${offers.length} offer(s)`,
    };
  },
});

// Internal mutation to update the status of an offer
export const updateStatus = internalMutation({
  args: {
    id: v.id(entity),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("error"),
      v.literal("redeemed"),
      v.literal("reminded")
    ),
    sentAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    activity: v.optional(
      v.object({
        action: v.string(),
        timestamp: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    let update: any = {};

    if (args.status) {
      update.status = args.status;
    }

    if (args.sentAt) {
      update.sentAt = args.sentAt;
    }

    if (args.errorMessage) {
      update.errorMessage = args.errorMessage;
    }

    if (args.activity) {
      const offer = await ctx.db.get(args.id);
      if (offer) {
        update.activity = [...(offer.activity || []), args.activity];
      }
    }

    await ctx.db.patch(args.id, update);
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
  returns: v.array(
    v.object({
      _id: v.id("offer"),
      _creationTime: v.number(),
      email: v.string(),
      promoCodeId: v.id("promoCode"),
      storeFrontUserId: v.union(v.id("guest"), v.id("storeFrontUser")),
      storeId: v.id("store"),
      status: v.union(
        v.literal("pending"),
        v.literal("sent"),
        v.literal("error"),
        v.literal("redeemed"),
        v.literal("reminded")
      ),
      ipAddress: v.optional(v.string()),
      sentAt: v.optional(v.number()),
      errorMessage: v.optional(v.string()),
      isRedeemed: v.optional(v.boolean()),
      activity: v.optional(
        v.array(
          v.object({
            action: v.string(),
            timestamp: v.number(),
          })
        )
      ),
      promoCode: v.optional(
        v.object({
          _id: v.id("promoCode"),
          _creationTime: v.number(),
          code: v.string(),
          storeId: v.id("store"),
          discountType: v.union(v.literal("percentage"), v.literal("amount")),
          discountValue: v.number(),
          limit: v.optional(v.number()),
          validFrom: v.number(),
          validTo: v.number(),
          span: v.union(
            v.literal("entire-order"),
            v.literal("selected-products")
          ),
          active: v.boolean(),
          displayText: v.string(),
          isExclusive: v.optional(v.boolean()),
          autoApply: v.optional(v.boolean()),
          sitewide: v.optional(v.boolean()),
          createdByUserId: v.id("athenaUser"),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    const offers = await ctx.db
      .query(entity)
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.storeFrontUserId)
      )
      .order("desc")
      .collect();

    // Efficiently fetch promo codes for all offers
    const promoCodeIds = [...new Set(offers.map((offer) => offer.promoCodeId))];
    const promoCodes = await Promise.all(
      promoCodeIds.map(async (promoCodeId) => {
        const promoCode = await ctx.db.get(promoCodeId);
        return { id: promoCodeId, data: promoCode };
      })
    );

    // Create a map for quick lookup
    const promoCodeMap = new Map(promoCodes.map((pc) => [pc.id, pc.data]));

    // Attach promo code data to each offer
    const offersWithPromoCodes = offers.map((offer) => ({
      ...offer,
      promoCode: promoCodeMap.get(offer.promoCodeId) || undefined,
    }));

    return offersWithPromoCodes;
  },
});

export const getAll = query({
  args: {
    storeId: v.id("store"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("sent"),
        v.literal("error"),
        v.literal("redeemed"),
        v.literal("reminded")
      )
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => {
        if (args.status) {
          return q.eq(q.field("status"), args.status);
        } else {
          return true;
        }
      })
      .collect();
  },
});

const getUpsellProducts = async ({
  ctx,
  storeId,
  offer,
  promoCode,
}: {
  ctx: ActionCtx;
  storeId: Id<"store">;
  offer: any;
  promoCode: any;
}) => {
  const store = await ctx.runQuery(api.inventory.stores.getById, {
    id: storeId,
  });

  if (!store) {
    return {
      bestSellers: [],
      recentlyViewed: [],
    };
  }

  const [bestSellers, recentlyViewedHairProducts] = await Promise.all([
    ctx.runQuery(api.inventory.bestSeller.getAll, {
      storeId: offer.storeId,
    }),
    ctx.runQuery(api.storeFront.user.getLastViewedProducts, {
      id: offer.storeFrontUserId,
      category: "Hair",
      limit: 2,
    }),
  ]);

  const hairBestSellers = bestSellers.filter(
    (seller) => seller.productSku.productCategory === "Hair"
  );

  const formatter = currencyFormatter(store?.currency || "GHS");

  const hairBestSellersData = hairBestSellers
    .filter(
      (seller) =>
        !recentlyViewedHairProducts.find(
          (product) => product.sku === seller.productSku.sku
        )
    )
    .map((seller) => {
      return {
        image: seller.productSku.images[0],
        name: getProductName(seller.productSku),
        original_price: formatter.format(seller.productSku.price),
        discounted_price: formatter.format(
          Math.round(
            seller.productSku.price -
              getProductDiscountValue(seller.productSku.price, promoCode)
          )
        ),
        product_url: `${process.env.STORE_URL}/shop/product/${seller.productId}?variant=${seller.productSku.sku}&origin=discount_reminder_email`,
      };
    })
    .slice(0, 4);

  const recentlyViewedHairProductsData = recentlyViewedHairProducts.map(
    (productSku) => {
      return {
        image: productSku.images[0],
        name: getProductName(productSku),
        original_price: formatter.format(productSku.price),
        discounted_price: formatter.format(
          Math.round(
            productSku.price -
              getProductDiscountValue(productSku.price, promoCode)
          )
        ),
        product_url: `${process.env.STORE_URL}/shop/product/${productSku.productId}?variant=${productSku.sku}&origin=discount_reminder_email`,
      };
    }
  );

  return {
    bestSellers: hairBestSellersData,
    recentlyViewed: recentlyViewedHairProductsData,
  };
};
