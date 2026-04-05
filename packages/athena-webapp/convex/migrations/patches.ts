import { internalMutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export const patchMissingProduct = internalMutation({
  args: {},
  handler: async (ctx) => {
    const skus = await ctx.db
      .query("productSku")
      .withIndex("by_productId", (q) =>
        q.eq("productId", "n578z11ncxwsmg4xdqbq9yvefn7x0mxh" as Id<"product">),
      )
      .collect();

    let migrated = 0;

    for (const sku of skus) {
      const updates: Record<string, any> = {
        sku: `KK38-FPS-${sku._id.slice(-3).toUpperCase()}`,
        productId: "n574fp6ezby81k00t3qqd9cb3x848fps",
      };

      await ctx.db.patch(sku._id, updates);
      migrated++;
    }

    return { migrated, total: skus.length };
  },
});
