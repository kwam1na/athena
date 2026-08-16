import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { llmStoreInsightsGetStoreInsightsOperationDefinition } from "../operationAdmission/domains/u9_platform_definitions";
import { admitPublicAction } from "../platform/operationAdmission";

type GetStoreInsightsFromLlmArgs = {
  provider?: string;
  storeId: Id<"store">;
};

/**
 * Compatibility shim over `intelligence/capabilities/actions`.
 *
 * It used to re-enter that module through `api.intelligence...`, which runs a
 * SECOND admission with this backend's own context — the shape that lets a
 * client-supplied `storeId` cross the boundary twice. It now calls the internal
 * sibling, so this shim is the single admission point and the store clamp it
 * resolves is the one the generation body runs under.
 */
export const getStoreInsightsFromLlm = action({
  args: {
    storeId: v.id("store"),
    provider: v.optional(v.string()),
  },
  handler: admitPublicAction(
    llmStoreInsightsGetStoreInsightsOperationDefinition,
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
