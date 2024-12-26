import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import {
  addressSchema,
  customerDetailsSchema,
  paymentMethodSchema,
} from "../schemas/storeFront";

const entity = "onlineOrder";

function generateOrderNumber() {
  const timestamp = Math.floor(Date.now() / 1000); // Get current timestamp in seconds
  const baseOrderNumber = timestamp % 100000; // Reduce to 5 digits
  const randomPadding = Math.floor(Math.random() * 10); // Add random digit if needed
  return (baseOrderNumber * 10 + randomPadding).toString().padStart(5, "0"); // Ensure 7 digits
}

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
    paymentMethod: v.optional(paymentMethodSchema),
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
      paymentMethod: args.paymentMethod,
      orderNumber: generateOrderNumber(),
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

export const getAll = query({
  args: { customerId: v.union(v.id("customer"), v.id("guest")) },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("customerId"), args.customerId))
      .order("desc")
      .collect();

    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const items = await ctx.db
          .query("onlineOrderItem")
          .filter((q) => q.eq(q.field("orderId"), order._id))
          .collect();
        return { ...order, items };
      })
    );
    const ordersWithItemsAndImages = await Promise.all(
      ordersWithItems.map(async (order) => {
        const itemsWithImages = await Promise.all(
          order.items.map(async (item) => {
            const [product, productSku] = await Promise.all([
              ctx.db.get(item.productId),
              ctx.db.get(item.productSkuId),
            ]);

            return {
              ...item,
              productName: product?.name,
              productImage: productSku?.images?.[0] ?? null,
            };
          })
        );
        return { ...order, items: itemsWithImages };
      })
    );
    return ordersWithItemsAndImages;
  },
});

export const getById = query({
  args: { orderId: v.id("onlineOrder") },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order) return null;

    const items = await ctx.db
      .query("onlineOrderItem")
      .filter((q) => q.eq(q.field("orderId"), args.orderId))
      .collect();

    const itemsWithImages = await Promise.all(
      items.map(async (item) => {
        const [product, productSku] = await Promise.all([
          ctx.db.get(item.productId),
          ctx.db.get(item.productSkuId),
        ]);

        let category: string | undefined;

        let colorName;

        if (productSku?.color) {
          const color = await ctx.db.get(productSku.color);
          colorName = color?.name;
        }

        if (product) {
          const productCategory = await ctx.db.get(product.categoryId);
          category = productCategory?.name;
        }

        return {
          ...item,
          productCategory: category,
          length: productSku?.length,
          price: productSku?.price,
          colorName,
          productName: product?.name,
          productImage: productSku?.images?.[0] ?? null,
        };
      })
    );

    return { ...order, items: itemsWithImages };
  },
});

export const getByExternalReference = query({
  args: { externalReference: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("externalReference"), args.externalReference))
      .first();
  },
});

export const getAllOnlineOrders = query({
  args: { storeId: v.id("store") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      // .order("desc")
      .collect();

    // const ordersWithItems = await Promise.all(
    //   orders.map(async (order) => {
    //     const items = await ctx.db
    //       .query("onlineOrderItem")
    //       .filter((q) => q.eq(q.field("orderId"), order._id))
    //       .collect();

    //     const itemsWithImages = await Promise.all(
    //       items.map(async (item) => {
    //         const [product, productSku] = await Promise.all([
    //           ctx.db.get(item.productId),
    //           ctx.db.get(item.productSkuId),
    //         ]);

    //         return {
    //           ...item,
    //           productName: product?.name,
    //           productImage: productSku?.images?.[0] ?? null,
    //         };
    //       })
    //     );
    //     return { ...order, items: itemsWithImages };
    //   })
    // );

    // return ordersWithItems;
  },
});

export const update = mutation({
  args: {
    orderId: v.optional(v.id("onlineOrder")),
    externalReference: v.optional(v.string()),
    update: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    if (args.orderId) {
      await ctx.db.patch(args.orderId, args.update);
      return true;
    }

    if (args.externalReference) {
      const order = await ctx.db
        .query(entity)
        .filter((q) =>
          q.eq(q.field("externalReference"), args.externalReference)
        )
        .first();

      if (!order) return false;

      await ctx.db.patch(order._id, args.update);
      return true;
    }
  },
});
