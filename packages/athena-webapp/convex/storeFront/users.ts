import { query } from "../_generated/server";
import { v } from "convex/values";

export const getByIds = query({
  args: {
    ids: v.array(v.union(v.id("storeFrontUser"), v.id("guest"))),
  },
  handler: async (ctx, args) => {
    const queries = args.ids.map((id) => ctx.db.get(id));
    const results = await Promise.all(queries);
    return results;
  },
});
