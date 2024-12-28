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
      externalTransactionId: session?.externalTransactionId?.toString(),
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
      status: "open",
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
      .order("desc")
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
    console.log("in update with args", args);

    if (args.orderId) {
      const order = await ctx.db.get(args.orderId);
      if (!order) return false;

      // Initialize base updates from args
      let updates = { ...args.update };

      // Add transition if status is being updated
      if (args.update.status) {
        updates.transitions = [
          ...(order.transitions ?? []),
          {
            status: args.update.status,
            date: Date.now(),
          },
        ];
      }

      // Add readyAt timestamp for specific status updates
      const readyStatuses = ["ready-for-pickup", "ready-for-delivery"];
      if (readyStatuses.includes(args.update.status)) {
        updates.readyAt = Date.now();
      }

      await ctx.db.patch(args.orderId, updates);
      return true;
    }

    // external reference is passed in as args from the verifyPayment action
    if (args.externalReference) {
      console.log("received external reference", args.externalReference);

      const order = await ctx.db
        .query(entity)
        .filter((q) =>
          q.eq(q.field("externalReference"), args.externalReference)
        )
        .first();

      console.log("found order", order);

      if (!order) return false;

      const { refund_id, refund_amount, ...rest } = args.update;

      const refunds = [
        ...(order?.refunds ?? []),
        ...(refund_id && refund_amount
          ? [{ id: refund_id, amount: refund_amount, date: Date.now() }]
          : []),
      ];

      if (args.update.status) {
        const updates = {
          ...rest,
          refunds,
          transitions: [
            ...(order?.transitions ?? []),
            { status: args.update.status, date: Date.now() },
          ],
        };
        await ctx.db.patch(order._id, updates);
      } else {
        await ctx.db.patch(order._id, { ...rest, refunds });
      }

      return true;
    }
  },
});

export const returnItemsToStock = mutation({
  args: {
    externalTransactionId: v.string(),
    onlineOrderItemIds: v.optional(v.array(v.id("onlineOrderItem"))),
  },
  handler: async (ctx, args) => {
    if (args.externalTransactionId) {
      const order = await ctx.db
        .query(entity)
        .filter((q) =>
          q.eq(q.field("externalTransactionId"), args.externalTransactionId)
        )
        .first();

      if (!order) return false;

      if (args.onlineOrderItemIds?.length) {
        await Promise.all(
          args.onlineOrderItemIds.map(async (itemId) => {
            await ctx.db.patch(itemId, { isRefunded: true, isRestocked: true });
            const onlineOrderItem = await ctx.db.get(itemId);

            if (onlineOrderItem) {
              const productSku = await ctx.db.get(onlineOrderItem.productSkuId);

              if (productSku) {
                await ctx.db.patch(onlineOrderItem.productSkuId, {
                  quantityAvailable:
                    productSku.quantityAvailable + onlineOrderItem.quantity,
                  inventoryCount: onlineOrderItem.isReady
                    ? productSku.inventoryCount + onlineOrderItem.quantity
                    : productSku.inventoryCount,
                });
              }
            }
          })
        );

        return true;
      }

      const orderItems = await ctx.db
        .query("onlineOrderItem")
        .filter((q) => q.eq(q.field("orderId"), order._id))
        .collect();

      await Promise.all(
        orderItems.map(async (item) => {
          await ctx.db.patch(item._id, { isRefunded: true, isRestocked: true });
          const productSku = await ctx.db.get(item.productSkuId);
          if (productSku) {
            await ctx.db.patch(item.productSkuId, {
              quantityAvailable: productSku.quantityAvailable + item.quantity,
              inventoryCount: item.isReady
                ? productSku.inventoryCount + item.quantity
                : productSku.inventoryCount,
            });
          }
        })
      );

      return true;
    }
  },
});

export const updateOrderItems = mutation({
  args: {
    orderItemIds: v.array(v.id("onlineOrderItem")),
    updates: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    await Promise.all(
      args.orderItemIds.map(async (itemId) => {
        await ctx.db.patch(itemId, args.updates);
      })
    );
    return true;
  },
});

export const returnAllItemsToStock = mutation({
  args: { orderId: v.id("onlineOrder") },
  handler: async (ctx, args) => {
    const orderItems = await ctx.db
      .query("onlineOrderItem")
      .filter((q) => q.eq(q.field("orderId"), args.orderId))
      .collect();

    await Promise.all(
      orderItems.map(async (item) => {
        if (item.isRestocked) {
          console.log("item already restocked", item._id);
          return true;
        }

        await ctx.db.patch(item._id, { isRefunded: true, isRestocked: true });
        const productSku = await ctx.db.get(item.productSkuId);
        if (productSku) {
          await ctx.db.patch(item.productSkuId, {
            quantityAvailable: productSku.quantityAvailable + item.quantity,
            inventoryCount: item.isReady
              ? productSku.inventoryCount + item.quantity
              : productSku.inventoryCount,
          });
        }
      })
    );

    return true;
  },
});
