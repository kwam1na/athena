/* eslint-disable @convex-dev/no-collect-in-query -- V26-168 converts the primary commerce access paths to indexed or bounded reads first; remaining legacy scans in this large module will be reduced in follow-up passes. */
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  QueryCtx,
  query,
} from "../_generated/server";
import {
  addressSchema,
  customerDetailsSchema,
  paymentMethodSchema,
} from "../schemas/storeFront";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import { getDiscountValue } from "../inventory/utils";
import {
  createOrderFromCheckoutSession,
  returnOrderItemsToStock,
} from "./helpers/onlineOrder";

const entity = "onlineOrder";
const MAX_ORDER_ITEMS = 200;
const MAX_ORDERS = 500;

async function listOrderItems(
  ctx: QueryCtx,
  orderId: Id<"onlineOrder">,
): Promise<Doc<"onlineOrderItem">[]> {
  return await ctx.db
    .query("onlineOrderItem")
    .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
    .take(MAX_ORDER_ITEMS);
}

export const create = mutation({
  args: {
    checkoutSessionId: v.id("checkoutSession"),
    billingDetails: v.union(
      v.object({
        ...addressSchema.fields,
        billingAddressSameAsDelivery: v.optional(v.boolean()),
      }),
      v.null(),
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
    return await createOrderFromCheckoutSession(ctx, {
      checkoutSessionId: args.checkoutSessionId,
      billingDetails: args.billingDetails,
      customerDetails: args.customerDetails,
      deliveryDetails: args.deliveryDetails,
      deliveryInstructions: args.deliveryInstructions,
      deliveryMethod: args.deliveryMethod,
      deliveryOption: args.deliveryOption,
      deliveryFee: args.deliveryFee,
      discount: args.discount,
      pickupLocation: args.pickupLocation,
      paymentMethod: args.paymentMethod,
    });
  },
});

export const createInternal = internalMutation({
  args: {
    checkoutSessionId: v.id("checkoutSession"),
    billingDetails: v.union(
      v.object({
        ...addressSchema.fields,
        billingAddressSameAsDelivery: v.optional(v.boolean()),
      }),
      v.null(),
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
    return await createOrderFromCheckoutSession(ctx, {
      checkoutSessionId: args.checkoutSessionId,
      billingDetails: args.billingDetails,
      customerDetails: args.customerDetails,
      deliveryDetails: args.deliveryDetails,
      deliveryInstructions: args.deliveryInstructions,
      deliveryMethod: args.deliveryMethod,
      deliveryOption: args.deliveryOption,
      deliveryFee: args.deliveryFee,
      discount: args.discount,
      pickupLocation: args.pickupLocation,
      paymentMethod: args.paymentMethod,
    });
  },
});

export const createFromSession = internalMutation({
  args: {
    checkoutSessionId: v.id("checkoutSession"),
    externalTransactionId: v.string(),
    paymentMethod: v.optional(paymentMethodSchema),
  },
  handler: async (ctx, args) => {
    return await createOrderFromCheckoutSession(ctx, {
      checkoutSessionId: args.checkoutSessionId,
      externalTransactionId: args.externalTransactionId,
      paymentMethod: args.paymentMethod,
      patchSessionPlacedOrderId: true,
      clearBag: true,
    });
  },
});

export const getAll = query({
  args: { storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")) },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query(entity)
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.storeFrontUserId),
      )
      .order("desc")
      .take(MAX_ORDERS);

    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const items = await listOrderItems(ctx, order._id);
        return { ...order, items };
      }),
    );
    const ordersWithItemsAndImages = await Promise.all(
      ordersWithItems.map(async (order) => {
        const itemsWithImages = await Promise.all(
          order.items.map(async (item) => {
            const [product, productSku] = await Promise.all([
              ctx.db.get("product", item.productId),
              ctx.db.get("productSku", item.productSkuId),
            ]);

            return {
              ...item,
              productName: product?.name,
              productImage: productSku?.images?.[0] ?? null,
            };
          }),
        );
        return { ...order, items: itemsWithImages };
      }),
    );
    return ordersWithItemsAndImages;
  },
});

export const get = query({
  args: {
    identifier: v.union(v.id("onlineOrder"), v.string()),
  },
  handler: async (ctx, args) => {
    let order: Doc<"onlineOrder"> | null = null;

    try {
      order = await ctx.db.get(
        "onlineOrder",
        args.identifier as Id<"onlineOrder">,
      );
    } catch (e) {
      order = await ctx.db
        .query(entity)
        .withIndex("by_externalReference", (q) =>
          q.eq("externalReference", args.identifier as string),
        )
        .first();
    }

    if (!order) {
      order = await ctx.db
        .query(entity)
        .withIndex("by_checkoutSessionId", (q) =>
          q.eq("checkoutSessionId", args.identifier as Id<"checkoutSession">),
        )
        .first();
    }

    if (!order) return null;

    const items = await listOrderItems(ctx, order._id);

    const itemsWithImages = await Promise.all(
      items.map(async (item) => {
        const [product, productSku] = await Promise.all([
          ctx.db.get("product", item.productId),
          ctx.db.get("productSku", item.productSkuId),
        ]);

        let category: string | undefined;

        let colorName;

        if (productSku?.color) {
          const color = await ctx.db.get("color", productSku.color);
          colorName = color?.name;
        }

        if (product) {
          const productCategory = await ctx.db.get(
            "category",
            product.categoryId,
          );
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
      }),
    );

    return { ...order, items: itemsWithImages };
  },
});

export const getInternal = internalQuery({
  args: {
    identifier: v.union(v.id("onlineOrder"), v.string()),
  },
  handler: async (ctx, args) => {
    let order =
      (await ctx.db.get("onlineOrder", args.identifier as Id<"onlineOrder">)) ??
      null;

    if (!order) {
      order = await ctx.db
        .query(entity)
        .withIndex("by_externalReference", (q) =>
          q.eq("externalReference", args.identifier as string),
        )
        .first();
    }

    if (!order) {
      order = await ctx.db
        .query(entity)
        .withIndex("by_checkoutSessionId", (q) =>
          q.eq("checkoutSessionId", args.identifier as Id<"checkoutSession">),
        )
        .first();
    }

    if (!order) return null;

    const items = await listOrderItems(ctx, order._id);

    const itemsWithImages = await Promise.all(
      items.map(async (item) => {
        const [product, productSku] = await Promise.all([
          ctx.db.get("product", item.productId),
          ctx.db.get("productSku", item.productSkuId),
        ]);

        let category: string | undefined;
        let colorName;

        if (productSku?.color) {
          const color = await ctx.db.get("color", productSku.color);
          colorName = color?.name;
        }

        if (product) {
          const productCategory = await ctx.db.get(
            "category",
            product.categoryId,
          );
          category = productCategory?.name;
        }

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
          currentQuantityAvailable,
          currentInventoryCount: productSku?.inventoryCount ?? 0,
          isOutOfStock,
          isLowStock,
        };
      }),
    );

    return { ...order, items: itemsWithImages };
  },
});

export const getByExternalReference = query({
  args: { externalReference: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query(entity)
      .withIndex("by_externalReference", (q) =>
        q.eq("externalReference", args.externalReference),
      )
      .first();
  },
});

export const getByCheckoutSessionId = query({
  args: { checkoutSessionId: v.id("checkoutSession") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query(entity)
      .withIndex("by_checkoutSessionId", (q) =>
        q.eq("checkoutSessionId", args.checkoutSessionId),
      )
      .first();
  },
});

export const getAllOnlineOrders = query({
  args: { storeId: v.id("store") },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .take(MAX_ORDERS);

    // Include items for net amount calculation
    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const items = await listOrderItems(ctx, order._id);

        return { ...order, items };
      }),
    );

    return ordersWithItems;
  },
});

export const getAllOnlineOrdersByStoreFrontUserId = query({
  args: { storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")) },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query(entity)
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.storeFrontUserId),
      )
      .order("desc")
      .take(MAX_ORDERS);

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
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.orderId) {
      const order = await ctx.db.get("onlineOrder", args.orderId);
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
          await returnOrderItemsToStock(ctx, order._id);
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
          internal.storeFront.onlineOrderUtilFns.sendOrderUpdateEmailInternal,
          {
            orderId: args.orderId,
            newStatus: args.update.status,
          },
        );
      }

      await ctx.db.patch("onlineOrder", args.orderId, updates);
      return { success: true, message: "Order updated" };
    }

    // external reference is passed in as args from the verifyPayment action
    if (args.externalReference) {
      const order = await ctx.db
        .query(entity)
        .filter((q) =>
          q.eq(q.field("externalReference"), args.externalReference),
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
          await returnOrderItemsToStock(ctx, order._id);
        }

        await ctx.db.patch("onlineOrder", order._id, updates);
      } else {
        await ctx.db.patch("onlineOrder", order._id, { ...rest, refunds });
      }

      return true;
    }
  },
});

export const getUnverifiedPaidOrders = internalQuery({
  args: {},
  handler: async (ctx) => {
    const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;

    return await ctx.db
      .query("onlineOrder")
      .filter((q) =>
        q.and(
          q.neq(q.field("hasVerifiedPayment"), true),
          q.lt(q.field("_creationTime"), fifteenMinutesAgo),
        ),
      )
      .collect();
  },
});

export const updateInternal = internalMutation({
  args: {
    orderId: v.optional(v.id("onlineOrder")),
    externalReference: v.optional(v.string()),
    update: v.record(v.string(), v.any()),
    returnItemsToStock: v.optional(v.boolean()),
    signedInAthenaUser: v.optional(
      v.object({
        id: v.id("athenaUser"),
        email: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.orderId) {
      const order = await ctx.db.get("onlineOrder", args.orderId);
      if (!order) return { success: false, message: "Order not found" };

      let updates = { ...args.update };

      if (args.update.status) {
        updates.transitions = [
          ...(order.transitions ?? []),
          {
            status: args.update.status,
            date: Date.now(),
            signedInAthenaUser: args.signedInAthenaUser,
          },
        ];

        if (
          args.update.status === "cancelled" &&
          args.returnItemsToStock !== false
        ) {
          await returnOrderItemsToStock(ctx, order._id);
        }
      }

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
        await ctx.scheduler.runAfter(
          0,
          internal.storeFront.onlineOrderUtilFns.sendOrderUpdateEmailInternal,
          {
            orderId: args.orderId,
            newStatus: args.update.status,
          },
        );
      }

      await ctx.db.patch("onlineOrder", args.orderId, updates);
      return { success: true, message: "Order updated" };
    }

    if (args.externalReference) {
      const order = await ctx.db
        .query(entity)
        .filter((q) =>
          q.eq(q.field("externalReference"), args.externalReference),
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

        if (
          args.update.status === "cancelled" &&
          args.returnItemsToStock !== false
        ) {
          await returnOrderItemsToStock(ctx, order._id);
        }

        await ctx.db.patch("onlineOrder", order._id, updates);
      } else {
        await ctx.db.patch("onlineOrder", order._id, { ...rest, refunds });
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
          q.eq(q.field("externalTransactionId"), args.externalTransactionId),
        )
        .first();

      if (!order) return false;

      if (args.onlineOrderItemIds?.length) {
        await Promise.all(
          args.onlineOrderItemIds.map(async (itemId) => {
            await ctx.db.patch("onlineOrderItem", itemId, {
              isRefunded: true,
              isRestocked: true,
            });
            const onlineOrderItem = await ctx.db.get("onlineOrderItem", itemId);

            if (onlineOrderItem) {
              const productSku = await ctx.db.get(
                "productSku",
                onlineOrderItem.productSkuId,
              );

              if (productSku) {
                await ctx.db.patch("productSku", onlineOrderItem.productSkuId, {
                  quantityAvailable:
                    productSku.quantityAvailable + onlineOrderItem.quantity,
                  inventoryCount: onlineOrderItem.isReady
                    ? productSku.inventoryCount + onlineOrderItem.quantity
                    : productSku.inventoryCount,
                });
              }
            }
          }),
        );

        return true;
      }

      const orderItems = await ctx.db
        .query("onlineOrderItem")
        .filter((q) => q.eq(q.field("orderId"), order._id))
        .collect();

      await Promise.all(
        orderItems.map(async (item) => {
          await ctx.db.patch("onlineOrderItem", item._id, {
            isRefunded: true,
            isRestocked: true,
          });
          const productSku = await ctx.db.get("productSku", item.productSkuId);
          if (productSku) {
            await ctx.db.patch("productSku", item.productSkuId, {
              quantityAvailable: productSku.quantityAvailable + item.quantity,
              inventoryCount: item.isReady
                ? productSku.inventoryCount + item.quantity
                : productSku.inventoryCount,
            });
          }
        }),
      );

      return true;
    }
  },
});

export const returnItemsToStockInternal = internalMutation({
  args: {
    externalTransactionId: v.string(),
    onlineOrderItemIds: v.optional(v.array(v.id("onlineOrderItem"))),
  },
  handler: async (ctx, args) => {
    if (args.externalTransactionId) {
      const order = await ctx.db
        .query(entity)
        .filter((q) =>
          q.eq(q.field("externalTransactionId"), args.externalTransactionId),
        )
        .first();

      if (!order) return false;

      if (args.onlineOrderItemIds?.length) {
        await Promise.all(
          args.onlineOrderItemIds.map(async (itemId) => {
            await ctx.db.patch("onlineOrderItem", itemId, {
              isRefunded: true,
              isRestocked: true,
            });
            const onlineOrderItem = await ctx.db.get("onlineOrderItem", itemId);

            if (onlineOrderItem) {
              const productSku = await ctx.db.get(
                "productSku",
                onlineOrderItem.productSkuId,
              );

              if (productSku) {
                await ctx.db.patch("productSku", onlineOrderItem.productSkuId, {
                  quantityAvailable:
                    productSku.quantityAvailable + onlineOrderItem.quantity,
                  inventoryCount: onlineOrderItem.isReady
                    ? productSku.inventoryCount + onlineOrderItem.quantity
                    : productSku.inventoryCount,
                });
              }
            }
          }),
        );

        return true;
      }

      const orderItems = await ctx.db
        .query("onlineOrderItem")
        .filter((q) => q.eq(q.field("orderId"), order._id))
        .collect();

      await Promise.all(
        orderItems.map(async (item) => {
          await ctx.db.patch("onlineOrderItem", item._id, {
            isRefunded: true,
            isRestocked: true,
          });
          const productSku = await ctx.db.get("productSku", item.productSkuId);
          if (productSku) {
            await ctx.db.patch("productSku", item.productSkuId, {
              quantityAvailable: productSku.quantityAvailable + item.quantity,
              inventoryCount: item.isReady
                ? productSku.inventoryCount + item.quantity
                : productSku.inventoryCount,
            });
          }
        }),
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
        await ctx.db.patch("onlineOrderItem", itemId, args.updates);
      }),
    );
    return true;
  },
});

export const updateOrderItemsInternal = internalMutation({
  args: {
    orderItemIds: v.array(v.id("onlineOrderItem")),
    updates: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    await Promise.all(
      args.orderItemIds.map(async (itemId) => {
        await ctx.db.patch("onlineOrderItem", itemId, args.updates);
      }),
    );
    return true;
  },
});

export const returnAllItemsToStock = mutation({
  args: { orderId: v.id("onlineOrder") },
  handler: async (ctx, args) => {
    await returnOrderItemsToStock(ctx, args.orderId);
    return true;
  },
});

export const returnAllItemsToStockInternal = internalMutation({
  args: { orderId: v.id("onlineOrder") },
  handler: async (ctx, args) => {
    await returnOrderItemsToStock(ctx, args.orderId);
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
      `updating owner for orders from ${args.currentOwner} to ${args.newOwner}`,
    );

    // Update all orders
    await Promise.all(
      orders.map(async (order) => {
        await ctx.db.patch("onlineOrder", order._id, {
          storeFrontUserId: args.newOwner,
        });

        // Get and update all order items for this order
        const orderItems = await ctx.db
          .query("onlineOrderItem")
          .filter((q) => q.eq(q.field("orderId"), order._id))
          .collect();

        await Promise.all(
          orderItems.map((item) =>
            ctx.db.patch("onlineOrderItem", item._id, {
              storeFrontUserId: args.newOwner,
            }),
          ),
        );
      }),
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
    const order = await ctx.db.get("onlineOrder", args.id);
    if (!order) {
      return false;
    }

    const orders = await ctx.db
      .query(entity)
      .filter((q) =>
        q.eq(q.field("externalReference"), order.externalReference),
      )
      .collect();

    return orders.length > 1;
  },
});

export const getOrderMetrics = query({
  args: {
    storeId: v.id("store"),
    timeRange: v.union(
      v.literal("day"),
      v.literal("week"),
      v.literal("month"),
      v.literal("all"),
    ),
  },
  returns: v.object({
    totalOrders: v.number(),
    grossSales: v.number(),
    totalDiscounts: v.number(),
    netRevenue: v.number(),
  }),
  handler: async (ctx, args) => {
    // Calculate time filter based on time range
    let timeFilter: number | undefined;
    const now = Date.now();

    switch (args.timeRange) {
      case "day":
        timeFilter = now - 24 * 60 * 60 * 1000; // Last 24 hours
        break;
      case "week":
        timeFilter = now - 7 * 24 * 60 * 60 * 1000; // Last 7 days
        break;
      case "month":
        timeFilter = now - 30 * 24 * 60 * 60 * 1000; // Last 30 days
        break;
      case "all":
        timeFilter = undefined; // No time filter
        break;
    }

    // Query orders filtered by store and time range
    let ordersQuery = ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), args.storeId));

    // Apply time filter if specified
    if (timeFilter !== undefined) {
      ordersQuery = ordersQuery.filter((q) =>
        q.gte(q.field("_creationTime"), timeFilter!),
      );
    }

    const allOrders = await ordersQuery.collect();

    // Filter for open and completed orders only
    const allowedStatuses = [
      "picked-up",
      "delivered",
      "out-for-delivery",
      "ready-for-pickup",
      "ready-for-delivery",
      "open",
    ];

    const filteredOrders = allOrders.filter((order) =>
      allowedStatuses.includes(order.status),
    );

    // Get all order items for discount calculations
    const ordersWithItems = await Promise.all(
      filteredOrders.map(async (order) => {
        const items = await ctx.db
          .query("onlineOrderItem")
          .filter((q) => q.eq(q.field("orderId"), order._id))
          .collect();
        return { ...order, items };
      }),
    );

    // Calculate metrics
    const totalOrders = ordersWithItems.length;
    let grossSales = 0;
    let totalDiscounts = 0;
    let netRevenue = 0;

    ordersWithItems.forEach((order) => {
      // Gross sales = subtotal (order.amount is in cents/pesewas)
      const subtotal = order.amount || 0;
      grossSales += subtotal;

      // Calculate discount using the utility function for consistency
      const discountValue = getDiscountValue(order.items, order.discount);
      totalDiscounts += discountValue;

      // Net revenue = subtotal + delivery fees - discounts
      const deliveryFee = order.deliveryFee || 0; // already pesewas
      netRevenue += subtotal + deliveryFee - discountValue;
    });

    return {
      totalOrders,
      grossSales,
      totalDiscounts,
      netRevenue,
    };
  },
});
