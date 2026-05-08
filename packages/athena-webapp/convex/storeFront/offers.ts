import {
  ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  MutationCtx,
  mutation,
  query,
} from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { api } from "../_generated/api";
import { internal } from "../_generated/api";
import { z } from "zod";
import { QueryCtx } from "../_generated/server";
import {
  sendDiscountCodeEmail,
  sendDiscountReminderEmail,
} from "../mailersend";
import { currencyFormatter, getProductName } from "../utils";
import { getProductDiscountValue } from "../inventory/utils";
import { recordStoreFrontCustomerMilestone } from "./helpers/customerEngagementEvents";
import { toDisplayAmount } from "../lib/currency";

const entity = "offer" as const;
const MAX_OFFERS = 500;

const heroImageUrl =
  "https://images.wigclub.store/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/assets/a0171a4f-036a-4928-3387-8b578e4f297d.webp";

export function formatOfferProductPrice(
  formatter: Intl.NumberFormat,
  price: number,
) {
  return formatter.format(toDisplayAmount(price));
}

export function getDiscountedOfferProductPrice(price: number, promoCode: any) {
  return Math.max(
    0,
    Math.round(price - getProductDiscountValue(price, promoCode)),
  );
}

export function buildOfferProductEmailItem({
  formatter,
  productSku,
  productUrl,
  promoCode,
}: {
  formatter: Intl.NumberFormat;
  productSku: any;
  productUrl: string;
  promoCode: any;
}) {
  return {
    image: productSku.images[0],
    name: getProductName(productSku),
    original_price: formatOfferProductPrice(formatter, productSku.price),
    discounted_price: formatOfferProductPrice(
      formatter,
      getDiscountedOfferProductPrice(productSku.price, promoCode),
    ),
    product_url: productUrl,
  };
}

// Email validation with Zod
const emailSchema = z
  .string()
  .email("Invalid email address")
  .refine((value) => value.trim().length > 0, "Email cannot be empty");

// Check if this email + guest combination already exists for this promo
const isDuplicate = async (
  ctx: QueryCtx,
  email: string,
  storeFrontUserId: Id<"storeFrontUser"> | Id<"guest">,
  promoCodeId: Id<"promoCode">,
) => {
  const [existingByEmail, existingByUser] = await Promise.all([
    ctx.db
      .query(entity)
      .withIndex("by_email", (q) => q.eq("email", email))
      .filter((q) => q.eq(q.field("promoCodeId"), promoCodeId))
      .first(),
    ctx.db
      .query(entity)
      .withIndex("by_storeFrontUserId_promoCodeId", (q) =>
        q
          .eq("storeFrontUserId", storeFrontUserId)
          .eq("promoCodeId", promoCodeId),
      )
      .first(),
  ]);

  return !!existingByEmail || !!existingByUser;
};

const updateStoreFrontActorEmail = async (
  ctx: MutationCtx,
  storeFrontUserId: Id<"storeFrontUser"> | Id<"guest">,
  email: string,
) => {
  const storeFrontUser = await ctx.db.get(
    "storeFrontUser",
    storeFrontUserId as Id<"storeFrontUser">,
  );

  if (storeFrontUser) {
    await ctx.db.patch("storeFrontUser", storeFrontUser._id, { email });
    return;
  }

  const guest = await ctx.db.get("guest", storeFrontUserId as Id<"guest">);
  if (guest) {
    await ctx.db.patch("guest", guest._id, { email });
  }
};

const createArgs = {
  email: v.string(),
  promoCodeId: v.id("promoCode"),
  storeFrontUserId: v.union(v.id("guest"), v.id("storeFrontUser")),
  storeId: v.id("store"),
  ipAddress: v.optional(v.string()),
};

const createOffer = async (
  ctx: MutationCtx,
  args: {
    email: string;
    promoCodeId: Id<"promoCode">;
    storeFrontUserId: Id<"storeFrontUser"> | Id<"guest">;
    storeId: Id<"store">;
    ipAddress?: string;
  },
) => {
  try {
    emailSchema.parse(args.email);
  } catch (error) {
    return {
      success: false,
      message: "Invalid email address",
    };
  }

  const isDuplicateSubmission = await isDuplicate(
    ctx,
    args.email,
    args.storeFrontUserId,
    args.promoCodeId,
  );

  if (isDuplicateSubmission) {
    return {
      success: false,
      message: "You've already requested this offer.",
    };
  }

  const offerId = await ctx.db.insert(entity, {
    email: args.email,
    promoCodeId: args.promoCodeId,
    storeFrontUserId: args.storeFrontUserId,
    storeId: args.storeId,
    status: "pending",
    ipAddress: args.ipAddress,
  });

  await ctx.scheduler.runAfter(0, internal.storeFront.offers.sendOfferEmail, {
    offerId,
  });

  await updateStoreFrontActorEmail(ctx, args.storeFrontUserId, args.email);

  const promoCode = await ctx.db.get("promoCode", args.promoCodeId);
  const subjectLabel = promoCode?.code ?? args.email;

  await recordStoreFrontCustomerMilestone(ctx, {
    eventType: "follow_up_offer_requested",
    message: `Requested ${subjectLabel} follow-up offer.`,
    metadata: {
      email: args.email,
      promoCodeId: args.promoCodeId,
      promoCode: promoCode?.code ?? null,
    },
    storeFrontUserId: args.storeFrontUserId,
    storeId: args.storeId,
    subjectId: offerId,
    subjectLabel,
    subjectType: "follow_up",
  });

  return {
    success: true,
    message: "Offer requested successfully!",
  };
};

// Create a new offer
export const create = mutation({
  args: createArgs,
  handler: async (ctx, args) => {
    return await createOffer(ctx, args);
  },
});

export const createInternal = internalMutation({
  args: createArgs,
  handler: async (ctx, args) => {
    return await createOffer(ctx, args);
  },
});

// Send the discount code email
export const sendOfferEmail = internalAction({
  args: {
    offerId: v.id(entity),
  },
  handler: async (ctx, args) => {
    console.log(
      `[SendOfferEmail] Starting email send process for offer ${args.offerId}`,
    );

    // Get the offer
    const offer = await ctx.runQuery(internal.storeFront.offers.getById, {
      id: args.offerId,
    });

    if (!offer || offer.status !== "pending") {
      console.log(
        `[SendOfferEmail] Offer validation failed - Offer found: ${!!offer}, Status: ${offer?.status}`,
      );
      return {
        success: false,
        message: "Offer not found or already processed",
      };
    }

    console.log(
      `[SendOfferEmail] Offer validated - Email: ${offer.email}, User: ${offer.storeFrontUserId}, PromoCode: ${offer.promoCodeId}`,
    );

    // Get the promo code
    const promoCode = await ctx.runQuery(
      internal.inventory.promoCode.getByIdInternal,
      {
        id: offer.promoCodeId,
      },
    );

    if (!promoCode) {
      console.log(
        `[SendOfferEmail] Promo code not found for offer ${args.offerId}`,
      );
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

    console.log(
      `[SendOfferEmail] Promo code retrieved - Code: ${promoCode.code}, Value: ${promoCode.discountValue}, Type: ${promoCode.discountType}`,
    );

    try {
      console.log(
        `[SendOfferEmail] Fetching upsell products for offer ${args.offerId}`,
      );
      const { bestSellers, recentlyViewed } = await getUpsellProducts({
        ctx,
        storeId: offer.storeId,
        offer,
        promoCode,
      });

      console.log(
        `[SendOfferEmail] Upsell products fetched - Best sellers: ${bestSellers.length}, Recently viewed: ${recentlyViewed.length}`,
      );

      console.log(
        `[SendOfferEmail] Sending email to ${offer.email} with promo code ${promoCode.code}`,
      );

      // Send the email
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

      console.log(`[SendOfferEmail] Email sent successfully to ${offer.email}`);

      // Mark as sent
      await ctx.runMutation(internal.storeFront.offers.updateStatus, {
        id: args.offerId,
        status: "sent",
        sentAt: Date.now(),
      });

      console.log(
        `[SendOfferEmail] Offer ${args.offerId} marked as sent successfully`,
      );

      return {
        success: true,
        message: "Discount code email sent",
      };
    } catch (error) {
      console.error(
        `[SendOfferEmail] Error sending email for offer ${args.offerId}:`,
        error,
      );

      // Handle errors
      await ctx.runMutation(internal.storeFront.offers.updateStatus, {
        id: args.offerId,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });

      console.log(
        `[SendOfferEmail] Offer ${args.offerId} marked as error with message: ${error instanceof Error ? error.message : "Unknown error"}`,
      );

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
    const offer = await ctx.runQuery(internal.storeFront.offers.getById, {
      id: args.offerId,
    });

    if (!offer || offer.isRedeemed) {
      return {
        success: false,
        message: "Offer not found or already redeemed",
      };
    }

    // Get the promo code
    const promoCode = await ctx.runQuery(
      internal.inventory.promoCode.getByIdInternal,
      {
        id: offer.promoCodeId,
      },
    );

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
    const store = await ctx.runQuery(internal.inventory.stores.findById, {
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
        ctx.runQuery(internal.inventory.bestSeller.getAllInternal, {
          storeId: offer.storeId,
        }),
        ctx.runQuery(internal.storeFront.user.getLastViewedProductsInternal, {
          id: offer.storeFrontUserId,
          category: "Hair",
          limit: 2,
        }),
      ]);

      const hairBestSellers = bestSellers.filter(
        (seller) => seller.productSku.productCategory === "Hair",
      );

      const formatter = currencyFormatter(store?.currency || "GHS");

      const hairBestSellersData = hairBestSellers
        .filter(
          (seller) =>
            !recentlyViewedHairProducts.find(
              (product) => product.sku === seller.productSku.sku,
            ),
        )
        .map((seller) => {
          return buildOfferProductEmailItem({
            formatter,
            productSku: seller.productSku,
            productUrl: `${process.env.STORE_URL}/shop/product/${seller.productId}?variant=${seller.productSku.sku}&origin=discount_reminder_email`,
            promoCode,
          });
        })
        .slice(0, 4);

      const recentlyViewedHairProductsData = recentlyViewedHairProducts.map(
        (productSku) => {
          return buildOfferProductEmailItem({
            formatter,
            productSku,
            productUrl: `${process.env.STORE_URL}/shop/product/${productSku.productId}?variant=${productSku.sku}&origin=discount_reminder_email`,
            promoCode,
          });
        },
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
    const offers: any = await ctx.runQuery(internal.storeFront.offers.getAll, {
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
        },
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
      v.literal("reminded"),
    ),
    sentAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    activity: v.optional(
      v.object({
        action: v.string(),
        timestamp: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existingOffer = await ctx.db.get("offer", args.id);
    if (!existingOffer) {
      return;
    }

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
      update.activity = [...(existingOffer.activity || []), args.activity];
    }

    await ctx.db.patch("offer", args.id, update);

    const promoCode = await ctx.db.get("promoCode", existingOffer.promoCodeId);
    const subjectLabel = promoCode?.code ?? existingOffer.email;

    if (args.status === "sent") {
      await recordStoreFrontCustomerMilestone(ctx, {
        eventType: "follow_up_offer_sent",
        message: `Sent ${subjectLabel} follow-up offer email.`,
        metadata: {
          email: existingOffer.email,
          promoCode: promoCode?.code ?? null,
          promoCodeId: existingOffer.promoCodeId,
          sentAt: args.sentAt ?? null,
          status: args.status,
        },
        storeFrontUserId: existingOffer.storeFrontUserId,
        storeId: existingOffer.storeId,
        subjectId: existingOffer._id,
        subjectLabel,
        subjectType: "follow_up",
      });
    }

    if (args.status === "reminded") {
      await recordStoreFrontCustomerMilestone(ctx, {
        eventType: "follow_up_offer_reminded",
        message: `Sent ${subjectLabel} follow-up reminder email.`,
        metadata: {
          activity: args.activity?.action ?? null,
          email: existingOffer.email,
          promoCode: promoCode?.code ?? null,
          promoCodeId: existingOffer.promoCodeId,
          status: args.status,
        },
        storeFrontUserId: existingOffer.storeFrontUserId,
        storeId: existingOffer.storeId,
        subjectId: existingOffer._id,
        subjectLabel,
        subjectType: "follow_up",
      });
    }

    if (args.status === "redeemed") {
      await recordStoreFrontCustomerMilestone(ctx, {
        eventType: "follow_up_offer_redeemed",
        message: `Redeemed ${subjectLabel} follow-up offer.`,
        metadata: {
          email: existingOffer.email,
          promoCode: promoCode?.code ?? null,
          promoCodeId: existingOffer.promoCodeId,
          status: args.status,
        },
        storeFrontUserId: existingOffer.storeFrontUserId,
        storeId: existingOffer.storeId,
        subjectId: existingOffer._id,
        subjectLabel,
        subjectType: "follow_up",
      });
    }
  },
});

// Get an offer by ID
export const getById = internalQuery({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get("offer", args.id);
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
      .take(MAX_OFFERS);
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
      .take(MAX_OFFERS);
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
      .take(MAX_OFFERS);
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
        v.literal("reminded"),
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
          }),
        ),
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
            v.literal("selected-products"),
          ),
          active: v.boolean(),
          displayText: v.string(),
          isExclusive: v.optional(v.boolean()),
          isMultipleUses: v.optional(v.boolean()),
          autoApply: v.optional(v.boolean()),
          sitewide: v.optional(v.boolean()),
          createdByUserId: v.id("athenaUser"),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const offers = await ctx.db
      .query(entity)
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.storeFrontUserId),
      )
      .order("desc")
      .take(MAX_OFFERS);

    // Efficiently fetch promo codes for all offers
    const promoCodeIds = [...new Set(offers.map((offer) => offer.promoCodeId))];
    const promoCodes = await Promise.all(
      promoCodeIds.map(async (promoCodeId) => {
        const promoCode = await ctx.db.get("promoCode", promoCodeId);
        return { id: promoCodeId, data: promoCode };
      }),
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

export const getAll = internalQuery({
  args: {
    storeId: v.id("store"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("sent"),
        v.literal("error"),
        v.literal("redeemed"),
        v.literal("reminded"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      return await ctx.db
        .query(entity)
        .withIndex("by_storeId_status", (q) =>
          q.eq("storeId", args.storeId).eq("status", args.status!),
        )
        .take(MAX_OFFERS);
    }

    return await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .take(MAX_OFFERS);
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
  const store = await ctx.runQuery(internal.inventory.stores.findById, {
    id: storeId,
  });

  if (!store) {
    return {
      bestSellers: [],
      recentlyViewed: [],
    };
  }

  const [bestSellers, recentlyViewedHairProducts] = await Promise.all([
    ctx.runQuery(internal.inventory.bestSeller.getAllInternal, {
      storeId: offer.storeId,
    }),
    ctx.runQuery(internal.storeFront.user.getLastViewedProductsInternal, {
      id: offer.storeFrontUserId,
      category: "Hair",
      limit: 2,
    }),
  ]);

  const hairBestSellers = bestSellers.filter(
    (seller) => seller.productSku.productCategory === "Hair",
  );

  const formatter = currencyFormatter(store?.currency || "GHS");

  const hairBestSellersData = hairBestSellers
    .filter(
      (seller) =>
        !recentlyViewedHairProducts.find(
          (product) => product.sku === seller.productSku.sku,
        ),
    )
    .map((seller) => {
      return buildOfferProductEmailItem({
        formatter,
        productSku: seller.productSku,
        productUrl: `${process.env.STORE_URL}/shop/product/${seller.productId}?variant=${seller.productSku.sku}&origin=discount_reminder_email`,
        promoCode,
      });
    })
    .slice(0, 4);

  const recentlyViewedHairProductsData = recentlyViewedHairProducts.map(
    (productSku) => {
      return buildOfferProductEmailItem({
        formatter,
        productSku,
        productUrl: `${process.env.STORE_URL}/shop/product/${productSku.productId}?variant=${productSku.sku}&origin=discount_reminder_email`,
        promoCode,
      });
    },
  );

  return {
    bestSellers: hairBestSellersData,
    recentlyViewed: recentlyViewedHairProductsData,
  };
};
