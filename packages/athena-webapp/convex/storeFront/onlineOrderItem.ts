import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  MutationCtx,
  mutation,
} from "../_generated/server";
import { Id } from "../_generated/dataModel";

const entity = "onlineOrderItem";

export const get = internalQuery({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

const updateOnlineOrderItem = async (
  ctx: MutationCtx,
  args: {
    id: Id<"onlineOrderItem">;
    updates: Record<string, any>;
  }
) => {
  await ctx.db.patch(args.id, args.updates);

  const { isReady } = args.updates;

  // update the inventory count of the product sku
  if (isReady) {
    const orderItem = await ctx.db.get(args.id);

    if (!orderItem) return;

    const productSku = await ctx.db.get(orderItem.productSkuId);

    if (!productSku) return;

    await ctx.db.patch(productSku._id, {
      inventoryCount: Math.max(productSku.inventoryCount - orderItem.quantity, 0),
    });
  } else if (isReady == false) {
    const orderItem = await ctx.db.get(args.id);

    if (!orderItem) return;

    const productSku = await ctx.db.get(orderItem.productSkuId);

    if (!productSku) return;

    await ctx.db.patch(productSku._id, {
      inventoryCount: productSku.inventoryCount + orderItem.quantity,
    });
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
