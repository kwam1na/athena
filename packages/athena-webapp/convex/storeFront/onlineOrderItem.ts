import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  MutationCtx,
  mutation,
} from "../_generated/server";
import { Id } from "../_generated/dataModel";
import {
  recordOnlineOrderFulfillmentMovement,
  recordOnlineOrderRestockMovement,
} from "./helpers/orderOperations";

const entity = "onlineOrderItem";

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

    await ctx.db.patch("productSku", productSku._id, {
      inventoryCount: Math.max(productSku.inventoryCount - orderItem.quantity, 0),
    });

    const order = await ctx.db.get("onlineOrder", orderItem.orderId);
    if (order) {
      await recordOnlineOrderFulfillmentMovement(ctx, {
        item: orderItem,
        order,
      });
    }
  } else if (isReady === false && wasReady) {
    const orderItem = await ctx.db.get("onlineOrderItem", args.id);

    if (!orderItem) return;

    const productSku = await ctx.db.get("productSku", orderItem.productSkuId);

    if (!productSku) return;

    await ctx.db.patch("productSku", productSku._id, {
      inventoryCount: productSku.inventoryCount + orderItem.quantity,
    });

    const order = await ctx.db.get("onlineOrder", orderItem.orderId);
    if (order) {
      await recordOnlineOrderRestockMovement(ctx, {
        item: orderItem,
        order,
        reasonCode: "online_order_item_unreadied",
      });
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
