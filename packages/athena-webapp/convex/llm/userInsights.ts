import { v } from "convex/values";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  llmUserInsightsGetStoreInsightsOperationDefinition,
  llmUserInsightsGetUserInsightsOperationDefinition,
} from "../operationAdmission/domains/platform_definitions";
import { admitPublicAction } from "../platform/operationAdmission";

type GetUserInsightsFromLlmArgs = {
  provider?: string;
  storeFrontUserId: Id<"storeFrontUser"> | Id<"guest">;
  storeId: Id<"store">;
};

type GetStoreInsightsFromLlmArgs = {
  provider?: string;
  storeId: Id<"store">;
};

/**
 * Compatibility shims over `intelligence/capabilities/actions`.
 *
 * Both used to re-enter that module through `api.intelligence...`, which runs a
 * SECOND admission with this backend's own context. They now call the internal
 * siblings, so each shim is the single admission point for its call.
 */
export const getUserInsightsFromLlm = action({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    provider: v.optional(v.string()),
  },
  handler: admitPublicAction(
    llmUserInsightsGetUserInsightsOperationDefinition,
    async (ctx, args: GetUserInsightsFromLlmArgs): Promise<unknown> => {
      const result = await ctx.runAction(
        internal.intelligence.capabilities.actions.internalGenerateUserInsights,
        args,
      );

      return result.kind === "ok" ? result.payload : result;
    },
  ),
});

export const getStoreInsightsFromLlm = action({
  args: {
    storeId: v.id("store"),
    provider: v.optional(v.string()),
  },
  handler: admitPublicAction(
    llmUserInsightsGetStoreInsightsOperationDefinition,
    async (ctx, args: GetStoreInsightsFromLlmArgs): Promise<unknown> => {
      const result = await ctx.runAction(
        internal.intelligence.capabilities.actions
          .internalGenerateStoreInsights,
        args,
      );

      return result.kind === "ok" ? result.payload : result;
    },
  ),
});
