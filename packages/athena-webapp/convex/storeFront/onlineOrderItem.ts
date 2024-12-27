import { v } from "convex/values";
import { mutation } from "../_generated/server";

const entity = "onlineOrderItem";

export const update = mutation({
  args: {
    id: v.id(entity),
    updates: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.patch(args.id, args.updates);
  },
});
