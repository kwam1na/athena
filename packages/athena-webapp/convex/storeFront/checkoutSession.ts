import { Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

type UpdatePayload = { id: Id<"productSku">; newQuantity: number };

const entity = "checkoutSession";

export const create = mutation({
  args: {
    storeId: v.id("store"),
    customerId: v.union(v.id("customer"), v.id("guest")),
    bagId: v.id("bag"),
    products: v.array(
      v.object({ productSkuId: v.string(), quantity: v.number() })
    ),
  },
  handler: async (ctx, args) => {
    // get all the sku ids
    const productSkuIds = args.products.map((p) => p.productSkuId);

    const productSkus = await ctx.db
      .query("productSku")
      .filter((q) => {
        return q.or(...productSkuIds.map((id) => q.eq(q.field("_id"), id)));
      })
      .collect();

    // Check product availability
    const unavailableProducts = [];
    for (const { productSkuId, quantity } of args.products) {
      const sku = productSkus.find((p) => p._id === productSkuId);
      if (!sku || sku.quantityAvailable < quantity) {
        unavailableProducts.push({
          productSkuId,
          requested: quantity,
          available: sku?.quantityAvailable ?? 0,
        });
      }
    }

    if (unavailableProducts.length > 0) {
      return {
        success: false,
        message: "Some products are unavailable or insufficient in stock.",
        unavailableProducts,
      };
    }

    // Insert checkout session
    const id = await ctx.db.insert(entity, {
      bagId: args.bagId,
      customerId: args.customerId,
      storeId: args.storeId,
      expiresAt: Date.now() + 5 * 60 * 1000, // Expires in 5 minutes
    });

    const updates: UpdatePayload[] = args.products
      .map(({ productSkuId, quantity }) => {
        const sku = productSkus.find((p) => p._id === productSkuId);
        if (sku) {
          return { id: sku._id, newQuantity: sku.quantityAvailable - quantity };
        }
        return null;
      })
      .filter((update): update is UpdatePayload => update !== null); // Type guard

    // Batch update
    await Promise.all(
      updates.map(({ id, newQuantity }) =>
        ctx.db.patch(id, { quantityAvailable: newQuantity })
      )
    );

    const session = await ctx.db.get(id);
    return {
      success: true,
      session: {
        ...session,
        items: args.products,
      },
    };
  },
});
