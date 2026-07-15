import { v } from "convex/values";
import { query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { getAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";

export function isExpiredSharedDemoSessionError(error: unknown) {
  return (
    error instanceof Error &&
    error.message ===
      "The demo session has expired. Open the demo again."
  );
}

export const getAuthenticatedUser = query({
  args: {},
  handler: async (ctx) => {
    try {
      return await getAuthenticatedAthenaUserWithCtx(ctx, {
        sharedDemoCapability: "reports.read",
      });
    } catch (error) {
      if (isExpiredSharedDemoSessionError(error)) {
        return null;
      }
      throw error;
    }
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
