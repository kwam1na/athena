/* eslint-disable @convex-dev/no-collect-in-query -- V26-168 converts the primary commerce access paths to indexed or bounded reads first; remaining legacy scans in this large module will be reduced in follow-up passes. */
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  MutationCtx,
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
  findOrderByExternalReference,
  findOrderByExternalTransactionId,
  returnOrderItemsToStock,
} from "./helpers/onlineOrder";
import {
  assertValidOnlineOrderStatusTransition,
  recordOnlineOrderRestockMovement,
  recordOnlineOrderPaymentCollected,
  recordOnlineOrderPaymentVerified,
  recordOnlineOrderStatusEvent,
} from "./helpers/orderOperations";

const entity = "onlineOrder";
const MAX_ORDER_ITEMS = 200;
const MAX_ORDERS = 500;
type SignedInAthenaUser = {
  id: Id<"athenaUser">;
  email: string;
};

async function listOrderItems(
  ctx: QueryCtx,
  orderId: Id<"onlineOrder">,
): Promise<Doc<"onlineOrderItem">[]> {
  return await ctx.db
    .query("onlineOrderItem")
    .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
    .take(MAX_ORDER_ITEMS);
}

function appendTransition(
  transitions: Array<{
    status: string;
    date: number;
    signedInAthenaUser?: SignedInAthenaUser;
  }>,
  status: string,
  signedInAthenaUser: SignedInAthenaUser | undefined,
  date: number
) {
  if (transitions[transitions.length - 1]?.status === status) {
    return transitions;
  }

  return [
    ...transitions,
    {
      status,
      date,
      signedInAthenaUser,
    },
  ];
}

async function applyOnlineOrderUpdate(
  ctx: MutationCtx,
  order: Doc<"onlineOrder">,
  args: {
    returnItemsToStock?: boolean;
    signedInAthenaUser?: SignedInAthenaUser;
    update: Record<string, any>;
  }
) {
  const nextStatus =
    typeof args.update.status === "string" ? args.update.status : undefined;
  const statusChanged = Boolean(nextStatus && nextStatus !== order.status);
  const paymentCollectedChanged =
    args.update.paymentCollected === true && !order.paymentCollected;
  const paymentVerifiedChanged =
    args.update.hasVerifiedPayment === true && !order.hasVerifiedPayment;
  const nextPaymentCollected =
    typeof args.update.paymentCollected === "boolean"
      ? args.update.paymentCollected
      : order.paymentCollected;
  const now = Date.now();
  const baseTransitions = Array.isArray(args.update.transitions)
    ? [...args.update.transitions]
    : [...(order.transitions ?? [])];
  let updates = { ...args.update };

  if (statusChanged) {
    assertValidOnlineOrderStatusTransition(
      {
        ...order,
        paymentCollected: nextPaymentCollected,
      },
      nextStatus!
    );

    updates.transitions = appendTransition(
      baseTransitions,
      nextStatus!,
      args.signedInAthenaUser,
      now
    );

    if (nextStatus === "cancelled" && args.returnItemsToStock !== false) {
      await returnOrderItemsToStock(ctx, order._id);
    }
  }

  if (paymentCollectedChanged) {
    updates.transitions = appendTransition(
      updates.transitions ?? baseTransitions,
      "payment_collected",
      args.signedInAthenaUser,
      now
    );
  }

  const readyStatuses = ["ready-for-pickup", "ready-for-delivery"];
  if (statusChanged && readyStatuses.includes(nextStatus!)) {
    updates.readyAt = now;
  }

  const completedStatuses = ["delivered", "picked-up"];
  if (statusChanged && completedStatuses.includes(nextStatus!)) {
    updates.completedAt = now;
  }

  const shouldSendOrderUpdateEmail =
    statusChanged &&
    [
      ...completedStatuses,
      "ready-for-pickup",
      "out-for-delivery",
      "cancelled",
    ].includes(nextStatus!);

  if (shouldSendOrderUpdateEmail) {
    await ctx.scheduler.runAfter(
      0,
      internal.storeFront.onlineOrderUtilFns.sendOrderUpdateEmailInternal,
      {
        orderId: order._id,
        newStatus: nextStatus!,
      }
    );
  }

  await ctx.db.patch("onlineOrder", order._id, updates);

  const nextOrder = {
    ...order,
    ...updates,
  } as Doc<"onlineOrder">;

  if (statusChanged) {
    await recordOnlineOrderStatusEvent(ctx, {
      nextStatus: nextStatus!,
      order: nextOrder,
      previousStatus: order.status,
      signedInAthenaUser: args.signedInAthenaUser,
    });
  }

  if (paymentVerifiedChanged) {
    await recordOnlineOrderPaymentVerified(ctx, {
      order: nextOrder,
      signedInAthenaUser: args.signedInAthenaUser,
    });
  }

  if (paymentCollectedChanged) {
    await recordOnlineOrderPaymentCollected(ctx, {
      order: nextOrder,
      signedInAthenaUser: args.signedInAthenaUser,
    });
  }

  return nextOrder;
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
  handler: (ctx, args) => findOrderByExternalReference(ctx, args.externalReference),
});

export const getByExternalTransactionId = internalQuery({
  args: { externalTransactionId: v.string() },
  handler: (ctx, args) =>
    findOrderByExternalTransactionId(ctx, args.externalTransactionId),
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
      await applyOnlineOrderUpdate(ctx, order, args);
      return { success: true, message: "Order updated" };
    }

    // external reference is passed in as args from the verifyPayment action
    if (args.externalReference) {
      const order = await findOrderByExternalReference(ctx, args.externalReference);

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
        await applyOnlineOrderUpdate(ctx, order, {
          ...args,
          update: {
            ...rest,
            refunds,
          },
        });
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
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    return await ctx.db
      .query("onlineOrder")
      .filter((q) =>
        q.and(
          q.neq(q.field("hasVerifiedPayment"), true),
          q.lt(q.field("_creationTime"), fiveMinutesAgo),
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

      await applyOnlineOrderUpdate(ctx, order, args);
      return { success: true, message: "Order updated" };
    }

    if (args.externalReference) {
      const order = await findOrderByExternalReference(ctx, args.externalReference);

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
        await applyOnlineOrderUpdate(ctx, order, {
          ...args,
          update: {
            ...rest,
            refunds,
          },
        });
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
      const order = await findOrderByExternalTransactionId(
        ctx,
        args.externalTransactionId
      );

      if (!order) return false;

      if (args.onlineOrderItemIds?.length) {
        await Promise.all(
          args.onlineOrderItemIds.map(async (itemId) => {
            const onlineOrderItem = await ctx.db.get("onlineOrderItem", itemId);
            if (!onlineOrderItem || onlineOrderItem.isRestocked) {
              return;
            }

            await ctx.db.patch("onlineOrderItem", itemId, {
              isRefunded: true,
              isRestocked: true,
            });

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
              await recordOnlineOrderRestockMovement(ctx, {
                item: onlineOrderItem,
                order,
                reasonCode: onlineOrderItem.isReady
                  ? "online_order_item_restocked"
                  : "online_order_reservation_released",
              });
            }
          }),
        );

        return true;
      }

      await returnOrderItemsToStock(ctx, order._id);

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
      const order = await findOrderByExternalTransactionId(
        ctx,
        args.externalTransactionId
      );

      if (!order) return false;

      if (args.onlineOrderItemIds?.length) {
        await Promise.all(
          args.onlineOrderItemIds.map(async (itemId) => {
            const onlineOrderItem = await ctx.db.get("onlineOrderItem", itemId);
            if (!onlineOrderItem || onlineOrderItem.isRestocked) {
              return;
            }

            await ctx.db.patch("onlineOrderItem", itemId, {
              isRefunded: true,
              isRestocked: true,
            });

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
              await recordOnlineOrderRestockMovement(ctx, {
                item: onlineOrderItem,
                order,
                reasonCode: onlineOrderItem.isReady
                  ? "online_order_item_restocked"
                  : "online_order_reservation_released",
              });
            }
          }),
        );

        return true;
      }

      await returnOrderItemsToStock(ctx, order._id);

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
