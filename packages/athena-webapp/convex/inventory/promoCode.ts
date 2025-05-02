import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import { api } from "../_generated/api";
import { Id } from "../_generated/dataModel";

const entity = "promoCode";

export const redeem = mutation({
  args: {
    code: v.string(),
    checkoutSessionId: v.id("checkoutSession"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  handler: async (ctx, args) => {
    // Find the invite code
    const promoCode = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("code"), args.code))
      .first();

    if (!promoCode) {
      return { success: false, message: "Invalid promo code" };
    }

    // check if this code is already redeemed
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
      return { success: false, message: "Promo code already redeemed" };
    }

    const checkoutSession = await ctx.db.get(args.checkoutSessionId);

    if (!checkoutSession) {
      return { success: false, message: "Checkout session not found" };
    }

    if (promoCode.span == "selected-products") {
      const sessionItems = await ctx.db
        .query("checkoutSessionItem")
        .filter((q) => q.eq(q.field("sesionId"), args.checkoutSessionId))
        .collect();

      const expectedProducts = await ctx.db
        .query("promoCodeItem")
        .filter((q) => q.eq(q.field("promoCodeId"), promoCode._id))
        .collect();

      const foundItems = sessionItems.filter((sessionItem) =>
        expectedProducts.some(
          (expectedProduct) =>
            expectedProduct.productSkuId == sessionItem.productSkuId
        )
      );

      const discounts = foundItems.map((item) => {
        if (promoCode.discountType == "percentage") {
          return item.price * (promoCode.discountValue / 100);
        } else {
          return promoCode.discountValue;
        }
      });

      const totalDiscount = discounts.reduce((a, b) => a + b, 0);

      if (foundItems.length == 0) {
        return { success: false, message: "No eligible products in bag" };
      } else {
        return {
          success: true,
          promoCode: {
            ...promoCode,
            productSkus: foundItems.map((i) => i.productSkuId),
            totalDiscount,
          },
        };
      }
    }

    return { success: true, promoCode };
  },
});

export const create = mutation({
  args: {
    storeId: v.id("store"),
    code: v.string(),
    discountType: v.union(v.literal("percentage"), v.literal("amount")),
    discountValue: v.number(),
    limit: v.optional(v.number()),
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
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const remove = mutation({
  args: { id: v.id(entity) },
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
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      code: args.code,
      active: args.active,
      autoApply: args.autoApply,
      discountType: args.discountType,
      discountValue: args.discountValue,
      limit: args.limit,
      validFrom: args.validFrom,
      validTo: args.validTo,
      span: args.span,
    });

    // Remove all existing promo code items
    if (args.span == "entire-order") {
      const items = await ctx.db
        .query("promoCodeItem")
        .filter((q) => q.eq(q.field("promoCodeId"), args.id))
        .collect();

      await Promise.all(items.map((item) => ctx.db.delete(item._id)));
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
        (promoCodeItem?.quantityClaimed ?? 0) + Math.floor(Math.random() * 3),
    });

    return { success: true };
  },
});
