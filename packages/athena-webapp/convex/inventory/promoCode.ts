import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

const entity = "promoCode";

export const redeem = mutation({
  args: {
    code: v.string(),
    checkoutSessionId: v.id("checkoutSession"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  handler: async (ctx, args) => {
    console.log(
      `[Redeem] Starting redemption process for code: ${args.code}, session: ${args.checkoutSessionId}, user: ${args.storeFrontUserId}`
    );

    // Find the invite code
    const promoCode = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("code"), args.code))
      .first();

    if (!promoCode) {
      console.log(`[Redeem] Promo code not found: ${args.code}`);
      return { success: false, message: "Invalid promo code" };
    }

    console.log(
      `[Redeem] Found promo code: ${promoCode.code}, active: ${promoCode.active}, isExclusive: ${promoCode.isExclusive}`
    );

    if (!promoCode.active) {
      console.log(`[Redeem] Promo code is not active: ${args.code}`);
      return { success: false, message: "Promo code is no longer active" };
    }

    // Validate date range
    const now = Date.now();
    console.log(
      `[Redeem] Validating date range - now: ${now}, validFrom: ${promoCode.validFrom}, validTo: ${promoCode.validTo}`
    );

    if (now < promoCode.validFrom) {
      console.log(`[Redeem] Promo code not yet valid: ${args.code}`);
      return {
        success: false,
        message: "Promo code is not yet valid",
      };
    }

    if (now > promoCode.validTo) {
      console.log(`[Redeem] Promo code has expired: ${args.code}`);
      return {
        success: false,
        message: "Promo code has expired",
      };
    }

    console.log(`[Redeem] Date range validation passed for: ${args.code}`);

    // check if this code is already redeemed
    console.log(`[Redeem] Checking if code already redeemed: ${args.code}`);
    const redeemed = await ctx.db
      .query("redeemedPromoCode")
      .filter((q) =>
        q.and(
          q.eq(q.field("promoCodeId"), promoCode._id),
          q.eq(q.field("storeFrontUserId"), args.storeFrontUserId)
        )
      )
      .first();

    if (redeemed) {
      console.log(`[Redeem] Code already redeemed: ${args.code}`);
      return { success: false, message: "Promo code already redeemed" };
    }

    console.log(`[Redeem] Code not previously redeemed: ${args.code}`);

    if (promoCode.isExclusive) {
      console.log(`[Redeem] Checking exclusive code eligibility: ${args.code}`);
      const hasOffer = await ctx.db
        .query("offer")
        .filter((q) =>
          q.and(
            q.eq(q.field("promoCodeId"), promoCode._id),
            q.eq(q.field("storeFrontUserId"), args.storeFrontUserId)
          )
        )
        .first();

      if (!hasOffer) {
        console.log(
          `[Redeem] User has no offer for exclusive code: ${args.code}`
        );
        return {
          success: false,
          message: "Promo code is not eligible for this order",
        };
      }
      console.log(
        `[Redeem] User has valid offer for exclusive code: ${args.code}`
      );
    }

    const checkoutSession = await ctx.db.get(args.checkoutSessionId);

    if (!checkoutSession) {
      console.log(
        `[Redeem] Checkout session not found: ${args.checkoutSessionId}`
      );
      return { success: false, message: "Checkout session not found" };
    }

    console.log(`[Redeem] Found checkout session: ${args.checkoutSessionId}`);

    const sessionItems = await ctx.db
      .query("checkoutSessionItem")
      .filter((q) => q.eq(q.field("sesionId"), args.checkoutSessionId))
      .collect();

    console.log(
      `[Redeem] Found ${sessionItems.length} items in checkout session`
    );

    if (promoCode.span == "selected-products") {
      console.log(
        `[Redeem] Processing selected-products discount for: ${args.code}`
      );

      const expectedProducts = await ctx.db
        .query("promoCodeItem")
        .filter((q) => q.eq(q.field("promoCodeId"), promoCode._id))
        .collect();

      console.log(
        `[Redeem] Found ${expectedProducts.length} expected products for selected-products discount`
      );

      const foundItems = sessionItems.filter((sessionItem) =>
        expectedProducts.some(
          (expectedProduct) =>
            expectedProduct.productSkuId == sessionItem.productSkuId
        )
      );

      console.log(
        `[Redeem] Found ${foundItems.length} matching items in session`
      );

      const discounts = foundItems.map((item) => {
        if (promoCode.discountType == "percentage") {
          return item.price * (promoCode.discountValue / 100);
        } else {
          return promoCode.discountValue;
        }
      });

      const totalDiscount = discounts.reduce((a, b) => a + b, 0);
      console.log(
        `[Redeem] Calculated total discount for selected-products: ${totalDiscount}`
      );

      if (foundItems.length == 0) {
        console.log(
          `[Redeem] No eligible products in bag for selected-products discount: ${args.code}`
        );
        return { success: false, message: "No eligible products in bag" };
      } else {
        console.log(
          `[Redeem] Successfully applied selected-products discount: ${args.code}, totalDiscount: ${totalDiscount}`
        );
        const appliedPromoCode = {
          ...promoCode,
          productSkus: foundItems.map((i) => i.productSkuId),
          totalDiscount,
        };

        console.log(
          `[Redeem] Updating checkout session with discount: ${args.checkoutSessionId}`
        );
        await ctx.runMutation(
          internal.storeFront.checkoutSession.updateCheckoutSession,
          {
            id: args.checkoutSessionId,
            discount: appliedPromoCode,
          }
        );
        console.log(
          `[Redeem] Successfully updated checkout session with discount`
        );

        return {
          success: true,
          promoCode: appliedPromoCode,
        };
      }
    }

    // For entire-order discounts, calculate totalDiscount based on all items
    console.log(`[Redeem] Processing entire-order discount for: ${args.code}`);

    let totalDiscount = 0;

    if (promoCode.discountType === "percentage") {
      // Calculate percentage discount on subtotal
      const subtotal = sessionItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );
      totalDiscount = subtotal * (promoCode.discountValue / 100);
      console.log(
        `[Redeem] Percentage discount - subtotal: ${subtotal}, percentage: ${promoCode.discountValue}%, totalDiscount: ${totalDiscount}`
      );
    } else {
      // Amount discount applies once to the order
      totalDiscount = promoCode.discountValue;
      console.log(
        `[Redeem] Fixed amount discount - totalDiscount: ${totalDiscount}`
      );
    }

    console.log(
      `[Redeem] Successfully applied entire-order discount: ${args.code}, totalDiscount: ${totalDiscount}`
    );

    const appliedPromoCode = {
      ...promoCode,
      totalDiscount,
    };

    console.log(
      `[Redeem] Updating checkout session with discount: ${args.checkoutSessionId}`
    );
    await ctx.runMutation(
      internal.storeFront.checkoutSession.updateCheckoutSession,
      {
        id: args.checkoutSessionId,
        discount: appliedPromoCode,
      }
    );
    console.log(`[Redeem] Successfully updated checkout session with discount`);

    return {
      success: true,
      promoCode: appliedPromoCode,
    };
  },
});

export const create = mutation({
  args: {
    storeId: v.id("store"),
    code: v.string(),
    discountType: v.union(v.literal("percentage"), v.literal("amount")),
    discountValue: v.number(),
    limit: v.optional(v.number()),
    autoApply: v.optional(v.boolean()),
    isExclusive: v.optional(v.boolean()),
    isMultipleUses: v.optional(v.boolean()),
    sitewide: v.optional(v.boolean()),
    displayText: v.string(),
    validFrom: v.number(),
    validTo: v.number(),
    span: v.union(v.literal("entire-order"), v.literal("selected-products")),
    productSkus: v.optional(v.array(v.id("productSku"))),
    createdByUserId: v.id("athenaUser"),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, {
      code: args.code,
      storeId: args.storeId,
      discountType: args.discountType,
      discountValue: args.discountValue,
      limit: args.limit,
      autoApply: args.autoApply,
      isExclusive: args.isExclusive,
      isMultipleUses: args.isMultipleUses,
      sitewide: args.sitewide,
      displayText: args.displayText,
      validFrom: args.validFrom,
      validTo: args.validTo,
      span: args.span,
      createdByUserId: args.createdByUserId,
      active: true,
    });

    const promoCode = await ctx.db.get(id);

    if (args.productSkus) {
      await Promise.all(
        args.productSkus.map(async (productSkuId) => {
          await ctx.db.insert("promoCodeItem", {
            promoCodeId: promoCode!._id,
            productSkuId,
            storeId: args.storeId,
          });
        })
      );
    }

    return { success: true, promoCode };
  },
});

export const getAll = query({
  args: { storeId: v.id("store") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();
  },
});

export const getAllItems = query({
  args: { storeId: v.id("store") },
  handler: async (ctx, args): Promise<any> => {
    const items = await ctx.db
      .query("promoCodeItem")
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();

    const skus = items
      .filter((i) => (i.quantityClaimed ?? 0) < (i.quantity ?? 0))
      .map((item) => item.productSkuId)
      .filter((i) => i !== undefined);

    const skuData = await Promise.all(
      skus.map(async (sku) => {
        return await ctx.runQuery(api.inventory.productSku.retrieve, {
          id: sku,
        });
      })
    );

    return items.map((item, index) => ({
      ...item,
      productSku: skuData[index],
    }));
  },
});

export const getById = query({
  args: { id: v.id(entity) },
  returns: v.union(
    v.object({
      _id: v.id(entity),
      _creationTime: v.number(),
      code: v.string(),
      storeId: v.id("store"),
      discountType: v.union(v.literal("percentage"), v.literal("amount")),
      discountValue: v.number(),
      limit: v.optional(v.number()),
      autoApply: v.optional(v.boolean()),
      isExclusive: v.optional(v.boolean()),
      isMultipleUses: v.optional(v.boolean()),
      sitewide: v.optional(v.boolean()),
      displayText: v.string(),
      validFrom: v.number(),
      validTo: v.number(),
      span: v.union(v.literal("entire-order"), v.literal("selected-products")),
      createdByUserId: v.id("athenaUser"),
      active: v.boolean(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getPromoCodeItems = query({
  args: { promoCodeId: v.id(entity) },
  returns: v.array(
    v.object({
      _id: v.id("productSku"),
      _creationTime: v.number(),
      attributes: v.optional(v.record(v.string(), v.any())),
      color: v.optional(v.id("color")),
      images: v.array(v.string()),
      isVisible: v.optional(v.boolean()),
      inventoryCount: v.number(),
      length: v.optional(v.number()),
      netPrice: v.optional(v.number()),
      price: v.number(),
      productId: v.id("product"),
      productName: v.optional(v.string()),
      quantityAvailable: v.number(),
      size: v.optional(v.string()),
      sku: v.optional(v.string()),
      storeId: v.id("store"),
      unitCost: v.optional(v.number()),
      weight: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("promoCodeItem")
      .filter((q) => q.eq(q.field("promoCodeId"), args.promoCodeId))
      .collect();

    const productSkuIds = items
      .map((item) => item.productSkuId)
      .filter((id): id is Id<"productSku"> => id !== undefined);

    // Fetch all productSku documents
    const productSkus = await Promise.all(
      productSkuIds.map((id) => ctx.db.get(id))
    );

    // Filter out any null values (in case some IDs don't exist)
    return productSkus.filter((sku) => sku !== null);
  },
});

export const getPromoCodeItemsLightweight = query({
  args: { promoCodeId: v.id(entity) },
  returns: v.array(
    v.object({
      _id: v.id("productSku"),
      productName: v.optional(v.string()),
      price: v.number(),
      images: v.array(v.string()),
      productId: v.id("product"),
    })
  ),
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("promoCodeItem")
      .withIndex("by_promoCodeId", (q) => q.eq("promoCodeId", args.promoCodeId))
      .collect();

    const productSkuIds = items
      .map((item) => item.productSkuId)
      .filter((id): id is Id<"productSku"> => id !== undefined);

    // Fetch only essential fields from productSku documents
    const productSkus = await Promise.all(
      productSkuIds.map(async (id) => {
        const sku = await ctx.db.get(id);
        if (!sku) return null;

        return {
          _id: sku._id,
          productName: sku.productName,
          price: sku.price,
          images: sku.images,
          productId: sku.productId,
        };
      })
    );

    // Filter out any null values (in case some IDs don't exist)
    return productSkus.filter((sku) => sku !== null);
  },
});

export const remove = mutation({
  args: { id: v.id(entity) },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const promoCodeItems = await ctx.db
      .query("promoCodeItem")
      .filter((q) => q.eq(q.field("promoCodeId"), args.id))
      .collect();

    await Promise.all(
      promoCodeItems.map((promoCodeItem) => ctx.db.delete(promoCodeItem._id))
    );

    await ctx.db.delete(args.id);

    return { success: true };
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    active: v.optional(v.boolean()),
    autoApply: v.optional(v.boolean()),
    isExclusive: v.optional(v.boolean()),
    isMultipleUses: v.optional(v.boolean()),
    sitewide: v.optional(v.boolean()),
    displayText: v.optional(v.string()),
    code: v.optional(v.string()),
    discountType: v.optional(
      v.union(v.literal("percentage"), v.literal("amount"))
    ),
    discountValue: v.optional(v.number()),
    limit: v.optional(v.number()),
    validFrom: v.optional(v.number()),
    validTo: v.optional(v.number()),
    span: v.optional(
      v.union(v.literal("entire-order"), v.literal("selected-products"))
    ),
    productSkus: v.optional(v.array(v.id("productSku"))),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const promoCode = await ctx.db.get(args.id);
    if (!promoCode) {
      throw new Error("Promo code not found");
    }

    await ctx.db.patch(args.id, {
      code: args.code,
      active: args.active,
      autoApply: args.autoApply,
      isExclusive: args.isExclusive,
      isMultipleUses: args.isMultipleUses,
      sitewide: args.sitewide,
      displayText: args.displayText,
      discountType: args.discountType,
      discountValue: args.discountValue,
      limit: args.limit,
      validFrom: args.validFrom,
      validTo: args.validTo,
      span: args.span,
    });

    // Remove all existing promo code items first
    const existingItems = await ctx.db
      .query("promoCodeItem")
      .filter((q) => q.eq(q.field("promoCodeId"), args.id))
      .collect();

    await Promise.all(existingItems.map((item) => ctx.db.delete(item._id)));

    // Add new promo code items if span is "selected-products"
    if (args.span === "selected-products" && args.productSkus) {
      await Promise.all(
        args.productSkus.map(async (productSkuId) => {
          await ctx.db.insert("promoCodeItem", {
            promoCodeId: args.id,
            productSkuId,
            storeId: promoCode.storeId,
          });
        })
      );
    }

    return { success: true };
  },
});

export const updateQuantityClaimedForMiniStraightener = internalMutation({
  args: {},
  handler: async (ctx, args) => {
    const promoCodeItem = await ctx.db.query("promoCodeItem").first();

    if (
      !promoCodeItem ||
      !promoCodeItem.quantity ||
      !promoCodeItem.quantityClaimed
    ) {
      return { success: false, message: "Promo code item not found" };
    }

    if (promoCodeItem.quantityClaimed >= promoCodeItem.quantity) {
      return { success: false, message: "Promo code item quantity claimed" };
    }

    await ctx.db.patch(promoCodeItem._id, {
      quantityClaimed:
        (promoCodeItem?.quantityClaimed ?? 0) + Math.floor(Math.random() * 2),
    });

    return { success: true };
  },
});

export const getRedeemedPromoCodesForUser = query({
  args: {
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  returns: v.array(
    v.object({
      _id: v.id("redeemedPromoCode"),
      _creationTime: v.number(),
      promoCodeId: v.id("promoCode"),
      storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    })
  ),
  handler: async (ctx, args) => {
    const redeemedPromoCodes = await ctx.db
      .query("redeemedPromoCode")
      .filter((q) => q.eq(q.field("storeFrontUserId"), args.storeFrontUserId))
      .collect();

    return redeemedPromoCodes;
  },
});
