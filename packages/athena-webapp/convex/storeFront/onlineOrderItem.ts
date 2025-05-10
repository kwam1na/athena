import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

const entity = "onlineOrderItem";

export const get = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    updates: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.updates);

    const { isReady } = args.updates;

    // update the inventory count of the product sku
    if (isReady) {
      const orderItem = await ctx.db.get(args.id);

      if (!orderItem) return;

      const productSku = await ctx.db.get(orderItem.productSkuId);

      if (!productSku) return;

      await ctx.db.patch(productSku._id, {
        inventoryCount: Math.max(
          productSku.inventoryCount - orderItem.quantity,
          0
        ),
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
  },
});
