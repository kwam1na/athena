import { v } from "convex/values";

import { internalQuery } from "../_generated/server";
import { requireStoreFullAdminAccess } from "../stockOps/access";

export const requireStoreFullAdmin = internalQuery({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const { athenaUser, store } = await requireStoreFullAdminAccess(
      ctx,
      args.storeId,
    );

    return {
      athenaUserId: athenaUser._id,
      organizationId: store.organizationId,
      storeId: store._id,
    };
  },
});
