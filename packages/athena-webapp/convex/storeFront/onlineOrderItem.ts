import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  MutationCtx,
  mutation,
} from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import {
  applyCommerceInventoryEffectWithCtx,
  outboundBasisFromEffect,
} from "../reporting/inventory/commerceEffects";

const entity = "onlineOrderItem";

async function scheduleCatalogSummaryDirtyMarker(
  ctx: Pick<MutationCtx, "scheduler">,
  storeId: Id<"store">,
) {
  const scheduler = ctx.scheduler as
    | { runAfter?: MutationCtx["scheduler"]["runAfter"] }
    | undefined;
  if (typeof scheduler?.runAfter !== "function") return;

  await scheduler.runAfter(
    0,
    internal.inventory.catalogSummary.markCatalogSummaryNeedsRefreshInternal,
    { storeId },
  );
}

export const get = internalQuery({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get("onlineOrderItem", args.id);
  },
});

const updateOnlineOrderItem = async (
  ctx: MutationCtx,
  args: {
    id: Id<"onlineOrderItem">;
    updates: Record<string, any>;
  }
) => {
  const existingOrderItem = await ctx.db.get("onlineOrderItem", args.id);
  if (!existingOrderItem) return;

  await ctx.db.patch("onlineOrderItem", args.id, args.updates);

  const { isReady } = args.updates;
  const wasReady = existingOrderItem.isReady === true;

  // update the inventory count of the product sku
  if (isReady === true && !wasReady) {
    const orderItem = await ctx.db.get("onlineOrderItem", args.id);

    if (!orderItem) return;

    const productSku = await ctx.db.get("productSku", orderItem.productSkuId);

    if (!productSku) return;

    const order = await ctx.db.get("onlineOrder", orderItem.orderId);
    if (order) {
      const store = await ctx.db.get("store", order.storeId);
      if (!store?.organizationId) {
        throw new Error("Online order organization could not be resolved.");
      }
      const occurredAt = Date.now();
      await applyCommerceInventoryEffectWithCtx(ctx, {
        activityType: "stock_fulfillment",
        businessEventKey: `storefront:${order._id}:line:${orderItem._id}:fulfillment`,
        completeness: "partial",
        contentFingerprint: `storefront-fulfillment-inventory-v1:${order._id}:${orderItem._id}:${orderItem.quantity}`,
        disposition: "merchandise_sale",
        effectType: "sale",
        kind: "outbound",
        movementType: "fulfillment",
        occurrenceAt: occurredAt,
        onlineOrderId: order._id,
        organizationId: store.organizationId,
        productId: orderItem.productId,
        productSkuId: orderItem.productSkuId,
        quantity: orderItem.quantity,
        reasonCode: "online_order_item_ready",
        sellableQuantityDelta: 0,
        sourceDomain: "storefront",
        sourceId: String(order._id),
        sourceLineId: String(orderItem._id),
        sourceType: "online_order_item",
        storeId: order.storeId,
      });
      await scheduleCatalogSummaryDirtyMarker(ctx, order.storeId);
    }
  } else if (isReady === false && wasReady) {
    const orderItem = await ctx.db.get("onlineOrderItem", args.id);

    if (!orderItem) return;

    const productSku = await ctx.db.get("productSku", orderItem.productSkuId);

    if (!productSku) return;

    const order = await ctx.db.get("onlineOrder", orderItem.orderId);
    if (order) {
      const store = await ctx.db.get("store", order.storeId);
      if (!store?.organizationId) {
        throw new Error("Online order organization could not be resolved.");
      }
      const originalEffect = await ctx.db
        .query("reportingInventoryEffect")
        .withIndex("by_storeId_sourceDomain_businessEventKey", (q) =>
          q
            .eq("storeId", order.storeId)
            .eq("sourceDomain", "storefront")
            .eq(
              "businessEventKey",
              `storefront:${order._id}:line:${orderItem._id}:fulfillment`,
            ),
        )
        .first();
      await applyCommerceInventoryEffectWithCtx(ctx, {
        activityType: "stock_restock",
        businessEventKey: `storefront:${order._id}:line:${orderItem._id}:unreadied`,
        completeness: "partial",
        contentFingerprint: `storefront-unready-inventory-v1:${order._id}:${orderItem._id}:${orderItem.quantity}`,
        effectType: "return",
        financialContribution: "none",
        kind: "return",
        movementType: "restock",
        occurrenceAt: Date.now(),
        onlineOrderId: order._id,
        organizationId: store.organizationId,
        originalBasis:
          originalEffect
            ? outboundBasisFromEffect(originalEffect, orderItem.quantity) ??
              undefined
            : undefined,
        productId: orderItem.productId,
        productSkuId: orderItem.productSkuId,
        quantity: orderItem.quantity,
        reasonCode: "online_order_item_unreadied",
        sellableQuantityDelta: 0,
        sourceDomain: "storefront",
        sourceId: String(order._id),
        sourceLineId: String(orderItem._id),
        sourceType: "online_order_item",
        storeId: order.storeId,
      });
      await scheduleCatalogSummaryDirtyMarker(ctx, order.storeId);
    }
  }
};

const updateArgs = {
  id: v.id(entity),
  updates: v.record(v.string(), v.any()),
};

export const update = mutation({
  args: {
    ...updateArgs,
  },
  handler: async (ctx, args) => {
    await updateOnlineOrderItem(ctx, args);
  },
});

export const updateInternal = internalMutation({
  args: {
    ...updateArgs,
  },
  handler: async (ctx, args) => {
    await updateOnlineOrderItem(ctx, args);
  },
});
