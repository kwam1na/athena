import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import {
  addressSchema,
  customerDetailsSchema,
  paymentMethodSchema,
} from "../schemas/storeFront";
import { api, internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

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
    billingDetails: v.union(
      v.object({
        ...addressSchema.fields,
        billingAddressSameAsDelivery: v.optional(v.boolean()),
      }),
      v.null()
    ),
    customerDetails: customerDetailsSchema,
    deliveryDetails: v.union(addressSchema, v.null(), v.string()),
    deliveryMethod: v.string(),
    deliveryOption: v.union(v.string(), v.null()),
    deliveryInstructions: v.union(v.string(), v.null()),
    deliveryFee: v.union(v.number(), v.null()),
    discount: v.union(v.record(v.string(), v.any()), v.null()),
    pickupLocation: v.union(v.string(), v.null()),
    paymentMethod: v.optional(paymentMethodSchema),
  },
  handler: async (ctx, args) => {
    // get the session
    const session = await ctx.db.get(args.checkoutSessionId);

    console.log(`creating online order for session: ${session?._id}`);

    if (!session) {
      return {
        error: "Invalid session",
        success: false,
      };
    }

    const orderId = await ctx.db.insert(entity, {
      storeFrontUserId: session?.storeFrontUserId,
      storeId: session?.storeId,
      checkoutSessionId: args.checkoutSessionId,
      externalReference: session?.externalReference,
      externalTransactionId: session?.externalTransactionId?.toString(),
      bagId: session?.bagId,
      amount: session?.amount,
      billingDetails: args.billingDetails,
      customerDetails: args.customerDetails,
      deliveryDetails: args.deliveryDetails,
      deliveryInstructions: args.deliveryInstructions,
      deliveryMethod: args.deliveryMethod,
      deliveryOption: args.deliveryOption,
      deliveryFee: args.deliveryFee,
      discount: args.discount,
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
          orderId,
          productId: item.productId,
          quantity: item.quantity,
          productSku: item.productSku,
          productSkuId: item.productSkuId,
          storeFrontUserId: item.storeFrontUserId,
          price: item.price,
        });
      })
    );

    // Check for items in both checkoutSessionItem and promoCodeItem tables
    await Promise.all(
      items.map(async (item) => {
        const promoCodeItem = await ctx.db
          .query("promoCodeItem")
          .filter((q) => q.eq(q.field("productSkuId"), item.productSkuId))
          .first();

        if (promoCodeItem) {
          await ctx.db.patch(promoCodeItem._id, {
            quantityClaimed:
              (promoCodeItem.quantityClaimed ?? 0) + item.quantity,
          });
        }
      })
    );

    // update used promo code for this order
    if (args.discount?.id) {
      // if the promo code is not multiple uses, insert a redeemed promo code record
      if (!args.discount.isMultipleUses)
        await ctx.db.insert("redeemedPromoCode", {
          promoCodeId: args.discount.id as Id<"promoCode">,
          storeFrontUserId: session.storeFrontUserId,
        });

      const offer = await ctx.db
        .query("offer")
        .filter((q) =>
          q.and(
            q.eq(q.field("promoCodeId"), args.discount?.id as Id<"promoCode">),
            q.eq(q.field("storeFrontUserId"), session.storeFrontUserId)
          )
        )
        .first();

      if (offer) {
        await ctx.db.patch(offer._id, { isRedeemed: true, status: "redeemed" });
      }
    }

    console.log("created online order for session.");

    return {
      success: true,
      orderId,
    };
  },
});

export const createFromSession = internalMutation({
  args: {
    checkoutSessionId: v.id("checkoutSession"),
    externalTransactionId: v.string(),
    paymentMethod: v.optional(paymentMethodSchema),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.checkoutSessionId);

    if (!session) {
      return {
        success: false,
        error: "Invalid session",
      };
    }

    const orderId = await ctx.db.insert(entity, {
      storeFrontUserId: session.storeFrontUserId,
      storeId: session.storeId,
      checkoutSessionId: args.checkoutSessionId,
      externalReference: session.externalReference,
      externalTransactionId: args.externalTransactionId,
      bagId: session.bagId,
      amount: session.amount,
      billingDetails: session.billingDetails as any,
      customerDetails: session.customerDetails as any,
      deliveryDetails: session.deliveryDetails as any,
      deliveryInstructions: session.deliveryInstructions,
      deliveryMethod: session.deliveryMethod || "n/a",
      deliveryOption: session.deliveryOption,
      deliveryFee: session.deliveryFee,
      discount: session.discount,
      pickupLocation: session.pickupLocation,
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
          orderId,
          productId: item.productId,
          quantity: item.quantity,
          productSku: item.productSku,
          productSkuId: item.productSkuId,
          storeFrontUserId: item.storeFrontUserId,
          price: item.price,
        });
      })
    );

    // Check for items in both checkoutSessionItem and promoCodeItem tables
    await Promise.all(
      items.map(async (item) => {
        const promoCodeItem = await ctx.db
          .query("promoCodeItem")
          .filter((q) => q.eq(q.field("productSkuId"), item.productSkuId))
          .first();

        if (promoCodeItem) {
          await ctx.db.patch(promoCodeItem._id, {
            quantityClaimed:
              (promoCodeItem.quantityClaimed ?? 0) + item.quantity,
          });
        }
      })
    );

    console.log("session.discount", session.discount);

    // update used promo code for this order
    if (session.discount?.id) {
      // if the promo code is not multiple uses, insert a redeemed promo code record
      if (!session.discount.isMultipleUses)
        await ctx.db.insert("redeemedPromoCode", {
          promoCodeId: session.discount.id as Id<"promoCode">,
          storeFrontUserId: session.storeFrontUserId,
        });

      const offer = await ctx.db
        .query("offer")
        .filter((q) =>
          q.and(
            q.eq(
              q.field("promoCodeId"),
              session.discount?.id as Id<"promoCode">
            ),
            q.eq(q.field("storeFrontUserId"), session.storeFrontUserId)
          )
        )
        .first();

      if (offer) {
        await ctx.db.patch(offer._id, { isRedeemed: true, status: "redeemed" });
      }
    }

    // update the session to reflect that the order has been created
    await ctx.db.patch(args.checkoutSessionId, {
      placedOrderId: orderId,
    });

    console.log("created online order for session. clearing bag..");

    // clear the bag for the sesion
    await ctx.runMutation(api.storeFront.bag.clearBag, {
      id: session.bagId,
    });

    console.log("cleared bag for session.");

    return {
      success: true,
      orderId,
    };
  },
});

export const getAll = query({
  args: { storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")) },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeFrontUserId"), args.storeFrontUserId))
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

export const get = query({
  args: {
    identifier: v.union(v.id("onlineOrder"), v.string()),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db
      .query(entity)
      .filter((q) =>
        q.or(
          q.eq(q.field("_id"), args.identifier),
          q.eq(q.field("externalReference"), args.identifier),
          q.eq(q.field("checkoutSessionId"), args.identifier)
        )
      )
      .first();

    if (!order) return null;

    const items = await ctx.db
      .query("onlineOrderItem")
      .filter((q) => q.eq(q.field("orderId"), order._id))
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

        // Calculate stock status
        const currentQuantityAvailable = productSku?.quantityAvailable ?? 0;
        const isOutOfStock = productSku?.inventoryCount === 0;
        const isLowStock =
          (currentQuantityAvailable <= 2 && currentQuantityAvailable > 0) ||
          (productSku?.inventoryCount ?? 0) <= 2;

        return {
          ...item,
          productCategory: category,
          length: productSku?.length,
          colorName,
          productName: product?.name,
          productImage: productSku?.images?.[0],
          // Stock information
          currentQuantityAvailable,
          currentInventoryCount: productSku?.inventoryCount ?? 0,
          isOutOfStock,
          isLowStock,
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

export const getByCheckoutSessionId = query({
  args: { checkoutSessionId: v.id("checkoutSession") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("checkoutSessionId"), args.checkoutSessionId))
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

export const getAllOnlineOrdersByStoreFrontUserId = query({
  args: { storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")) },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeFrontUserId"), args.storeFrontUserId))
      .order("desc")
      .collect();

    return orders;
  },
});

export const update = mutation({
  args: {
    orderId: v.optional(v.id("onlineOrder")),
    externalReference: v.optional(v.string()),
    update: v.record(v.string(), v.any()),
    returnItemsToStock: v.optional(v.boolean()),
    signedInAthenaUser: v.optional(
      v.object({
        id: v.id("athenaUser"),
        email: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    if (args.orderId) {
      const order = await ctx.db.get(args.orderId);
      if (!order) return { success: false, message: "Order not found" };

      // Initialize base updates from args
      let updates = { ...args.update };

      // Add transition if status is being updated
      if (args.update.status) {
        updates.transitions = [
          ...(order.transitions ?? []),
          {
            status: args.update.status,
            date: Date.now(),
            signedInAthenaUser: args.signedInAthenaUser,
          },
        ];

        // if we are cancelling the order, conditionally return items to stock
        if (
          args.update.status === "cancelled" &&
          args.returnItemsToStock !== false
        ) {
          await ctx.runMutation(
            api.storeFront.onlineOrder.returnAllItemsToStock,
            {
              orderId: order._id,
            }
          );
        }
      }

      // Add transition if payment is being marked as collected for POD orders
      if (args.update.paymentCollected === true && !order.paymentCollected) {
        updates.transitions = [
          ...(updates.transitions ?? order.transitions ?? []),
          {
            status: "payment_collected",
            date: Date.now(),
            signedInAthenaUser: args.signedInAthenaUser,
          },
        ];
      }

      // Add readyAt timestamp for specific status updates
      const readyStatuses = ["ready-for-pickup", "ready-for-delivery"];
      if (readyStatuses.includes(args.update.status)) {
        updates.readyAt = Date.now();
      }

      const completedStatuses = ["delivered", "picked-up"];
      if (completedStatuses.includes(args.update.status)) {
        updates.completedAt = Date.now();
      }

      const shouldSendOrderUpdateEmail = [
        ...completedStatuses,
        "ready-for-pickup",
        "out-for-delivery",
        "cancelled",
      ].includes(args.update.status);

      if (shouldSendOrderUpdateEmail) {
        // Send email if status is being updated
        await ctx.scheduler.runAfter(
          0,
          api.storeFront.onlineOrderUtilFns.sendOrderUpdateEmail,
          {
            orderId: args.orderId,
            newStatus: args.update.status,
          }
        );
      }

      await ctx.db.patch(args.orderId, updates);
      return { success: true, message: "Order updated" };
    }

    // external reference is passed in as args from the verifyPayment action
    if (args.externalReference) {
      const order = await ctx.db
        .query(entity)
        .filter((q) =>
          q.eq(q.field("externalReference"), args.externalReference)
        )
        .first();

      if (!order) return false;

      const { refund_id, refund_amount, ...rest } = args.update;

      const refunds = [
        ...(order?.refunds ?? []),
        ...(refund_id && refund_amount
          ? [
              {
                id: refund_id,
                amount: refund_amount,
                date: Date.now(),
                signedInAthenaUser: args.signedInAthenaUser,
              },
            ]
          : []),
      ];

      if (args.update.status) {
        const updates = {
          ...rest,
          refunds,
          transitions: [
            ...(order?.transitions ?? []),
            {
              status: args.update.status,
              date: Date.now(),
              signedInAthenaUser: args.signedInAthenaUser,
            },
          ],
        };

        // if we are cancelling the order, conditionally return items to stock
        if (
          args.update.status === "cancelled" &&
          args.returnItemsToStock !== false
        ) {
          await ctx.runMutation(
            api.storeFront.onlineOrder.returnAllItemsToStock,
            {
              orderId: order._id,
            }
          );
        }

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

export const newOrder = query({
  args: { storeId: v.id("store") },
  handler: async (ctx, args) => {
    const order = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .order("desc")
      .first();

    return order;
  },
});

export const getOrderItems = query({
  args: { orderId: v.id("onlineOrder") },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("onlineOrderItem")
      .filter((q) => q.eq(q.field("orderId"), args.orderId))
      .collect();

    return items;
  },
});

export const updateOwner = mutation({
  args: {
    currentOwner: v.id("guest"),
    newOwner: v.id("storeFrontUser"),
  },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeFrontUserId"), args.currentOwner))
      .collect();

    console.info(
      `updating owner for orders from ${args.currentOwner} to ${args.newOwner}`
    );

    // Update all orders
    await Promise.all(
      orders.map(async (order) => {
        await ctx.db.patch(order._id, {
          storeFrontUserId: args.newOwner,
        });

        // Get and update all order items for this order
        const orderItems = await ctx.db
          .query("onlineOrderItem")
          .filter((q) => q.eq(q.field("orderId"), order._id))
          .collect();

        await Promise.all(
          orderItems.map((item) =>
            ctx.db.patch(item._id, {
              storeFrontUserId: args.newOwner,
            })
          )
        );
      })
    );

    console.info("successfully updated owner for orders");

    return true;
  },
});

export const isDuplicateOrder = query({
  args: {
    id: v.id("onlineOrder"),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.id);
    if (!order) {
      return false;
    }

    const orders = await ctx.db
      .query(entity)
      .filter((q) =>
        q.eq(q.field("externalReference"), order.externalReference)
      )
      .collect();

    return orders.length > 1;
  },
});
