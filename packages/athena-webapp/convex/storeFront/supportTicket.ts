import { v } from "convex/values";
import { mutation } from "../_generated/server";

const entity = "supportTicket";

export const create = mutation({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    origin: v.string(),
    checkoutSessionId: v.optional(v.id("checkoutSession")),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, {
      ...args,
    });

    return await ctx.db.get(id);
  },
});
