import { query } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { getStoreFrontUsersByIdsReadDefinition } from "../operationAdmission/domains/u6_storefrontCustomer_readDefinitions";
import { admitPublicQuery } from "../platform/operationAdmission";

export const getByIds = query({
  args: {
    ids: v.array(v.union(v.id("storeFrontUser"), v.id("guest"))),
  },
  handler: admitPublicQuery(
    getStoreFrontUsersByIdsReadDefinition,
    async (
      ctx,
      args: { ids: Array<Id<"storeFrontUser"> | Id<"guest">> },
    ) => {
      const queries = args.ids.map((id) => {
        const storeFrontUserId = ctx.db.normalizeId("storeFrontUser", id);
        if (storeFrontUserId) {
          return ctx.db.get("storeFrontUser", storeFrontUserId);
        }

        const guestId = ctx.db.normalizeId("guest", id);
        return guestId ? ctx.db.get("guest", guestId) : Promise.resolve(null);
      });
      const results = await Promise.all(queries);
      return results;
    },
  ),
});
