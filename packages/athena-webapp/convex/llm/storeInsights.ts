import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";

const generateStoreInsightsRef = api.intelligence.capabilities.actions
  .generateStoreInsights as any;

export const getStoreInsightsFromLlm = action({
  args: {
    storeId: v.id("store"),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const result = await ctx.runAction(
      generateStoreInsightsRef,
      args,
    );

    return result.kind === "ok" ? result.payload : result;
  },
});
