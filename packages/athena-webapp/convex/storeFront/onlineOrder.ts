import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { addressSchema, customerDetailsSchema } from "../schemas/storeFront";

const entity = "onlineOrder";

export const create = mutation({
  args: {
    checkoutSessionId: v.id("checkoutSession"),
    billingDetails: addressSchema,
    customerDetails: customerDetailsSchema,
    deliveryDetails: v.union(addressSchema, v.null()),
    deliveryMethod: v.string(),
    deliveryOption: v.union(v.string(), v.null()),
    deliveryFee: v.union(v.number(), v.null()),
    pickupLocation: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    // get the session
    const session = await ctx.db.get(args.checkoutSessionId);

    if (!session) {
      return {
        error: "Invalid session",
        success: false,
      };
    }

    const orderId = await ctx.db.insert(entity, {
      customerId: session?.customerId,
      storeId: session?.storeId,
      checkoutSessionId: args.checkoutSessionId,
      externalReference: session?.externalReference,
      bagId: session?.bagId,
      amount: session?.amount,
      billingDetails: args.billingDetails,
      customerDetails: args.customerDetails,
      deliveryDetails: args.deliveryDetails,
      deliveryMethod: args.deliveryMethod,
      deliveryOption: args.deliveryOption,
      deliveryFee: args.deliveryFee,
      pickupLocation: args.pickupLocation,
      hasVerifiedPayment: session.hasVerifiedPayment,
    });

    // get the session items using the session id to create the online order items
    const items = await ctx.db
      .query("checkoutSessionItem")
      .filter((q) => q.eq(q.field("sesionId"), args.checkoutSessionId))
      .collect();

    await Promise.all(
      items.map((item) => {
        return ctx.db.insert("onlineOrderItem", {
          orderId: orderId,
          productId: item.productId,
          quantity: item.quantity,
          productSku: item.productSku,
          productSkuId: item.productSkuId,
          customerId: item.customerId,
        });
      })
    );

    return {
      success: true,
      orderId,
    };
  },
});
