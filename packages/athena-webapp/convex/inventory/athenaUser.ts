import { v } from "convex/values";
import { query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { getAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";

export const getAuthenticatedUser = query({
  args: {},
  handler: async (ctx) => {
    return getAuthenticatedAthenaUserWithCtx(ctx);
  },
});

export const getUserById = query({
  args: { id: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    if (!args.id) {
      return null;
    }

    try {
      const res = await ctx.db.get("athenaUser", args.id as Id<"athenaUser">);

      return res;
    } catch (e) {
      console.error(e);
      return null;
    }
  },
});
