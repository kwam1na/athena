import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

const entity = "promoCode";

export const redeem = mutation({
  args: {
    code: v.string(),
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
