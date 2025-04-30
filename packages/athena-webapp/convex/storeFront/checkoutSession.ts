import { CheckoutSession, CheckoutSessionItem, ProductSku } from "../../types";
import { api, internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  mutation,
  MutationCtx,
  query,
  QueryCtx,
} from "../_generated/server";
import { v } from "convex/values";
import { orderDetailsSchema } from "../schemas/storeFront";

const entity = "checkoutSession";

const sessionLimitMinutes = 20;

type Product = {
  productId: Id<"product">;
  productSku: string;
  productSkuId: Id<"productSku">;
  quantity: number;
  price: number;
};

type AvailabilityUpdate = { id: Id<"productSku">; change: number };

export const create = mutation({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    bagId: v.id("bag"),
    amount: v.number(),
    products: v.array(
      v.object({
        productId: v.id("product"),
        productSku: v.string(),
        productSkuId: v.id("productSku"),
        quantity: v.number(),
        price: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const sessionLimit = sessionLimitMinutes * 60 * 1000;
    const expiresAt = now + sessionLimit;

    // check that the store is in active mode
    const store = await ctx.db.get(args.storeId);

    const { config } = store || {};

    if (
      config?.availability?.inMaintenanceMode ||
      config?.visibility?.inReadOnlyMode
    ) {
      return {
        success: false,
        message: "Store checkout is currrently not available",
      };
    }

    // Check for valid products
    const productExistenceChecks = await Promise.all(
      args.products.map((p) => ctx.db.get(p.productId))
    );

    const invalidProducts = args.products.filter(
      (_, index) => !productExistenceChecks[index]
    );

    if (invalidProducts.length > 0) {
      return {
        success: false,
        message: "Some items in your bag are no longer available",
        unavailableProducts: invalidProducts.map((p) => ({
          productSkuId: p.productSkuId,
          requested: p.quantity,
          available: 0,
        })),
      };
    }

    // Fetch product SKUs
    const productSkus = await fetchProductSkus(ctx, args.products);

    // Check for existing session
    const existingSession = await retrieveActiveCheckoutSession(
      ctx,
      args.storeFrontUserId
    );

    let sessionItemsMap = new Map<string, number>();

    if (existingSession) {
      // Fetch existing session items
      const sessionItems = await ctx.db
        .query("checkoutSessionItem")
        .filter((q) => q.eq(q.field("sesionId"), existingSession._id))
        .collect();

      // Map existing session items by productSkuId and quantity
      sessionItemsMap = new Map(
        sessionItems.map((item) => [item.productSkuId, item.quantity])
      );
    }

    // Adjust availability checks to account for user's current session items
    const unavailableProducts = checkAdjustedAvailability(
      args.products,
      productSkus,
      sessionItemsMap
    );

    if (unavailableProducts.length > 0) {
      return {
        success: false,
        message: "Some items in your bag are no longer available",
        unavailableProducts,
      };
    }

    if (existingSession) {
      await ctx.db.patch(existingSession._id, {
        expiresAt,
        amount: args.amount,
      });

      // Update the active session and product availability
      return await updateExistingSession(
        ctx,
        existingSession,
        args.storeFrontUserId,
        args.products
      );
    }

    // Create new session
    const sessionId = await ctx.db.insert(entity, {
      amount: args.amount,
      bagId: args.bagId,
      storeFrontUserId: args.storeFrontUserId,
      storeId: args.storeId,
      expiresAt,
      isFinalizingPayment: false,
      hasCompletedPayment: false,
      hasCompletedCheckoutSession: false,
      hasVerifiedPayment: false,
      billingDetails: null,
      customerDetails: null,
      deliveryDetails: null,
      deliveryInstructions: null,
      deliveryOption: null,
      deliveryFee: null,
      pickupLocation: null,
      discount: null,
    });

    // Create session items
    await createSessionItems(
      ctx,
      sessionId,
      args.storeFrontUserId,
      args.products
    );

    // Update availability counts
    await updateProductAvailability(ctx, args.products, productSkus);

    const session = await ctx.db.get(sessionId);
    return {
      success: true,
      session: {
        ...session,
        items: args.products,
      },
    };
  },
});

export const getAbandonedCheckoutSessions = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000; // 1 hour in milliseconds

    return await ctx.db
      .query("checkoutSession")
      .filter((q) =>
        q.and(
          q.lt(q.field("expiresAt"), oneHourAgo),
          q.eq(q.field("isFinalizingPayment"), true),
          q.eq(q.field("placedOrderId"), undefined)
        )
      )
      .collect();
  },
});

// Mutation to release held quantities from expired checkout sessions
export const releaseCheckoutItems = internalMutation({
  args: { externalReferences: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    let expiredSessions: CheckoutSession[] = [];

    if (args.externalReferences && args.externalReferences.length > 0) {
      expiredSessions = await ctx.db
        .query("checkoutSession")
        .filter((q) =>
          q.or(
            ...args.externalReferences!.map((ref) =>
              q.eq(q.field("externalReference"), ref)
            )
          )
        )
        .collect();
    } else {
      const now = Date.now();

      // 1. Fetch all expired checkout sessions
      expiredSessions = await ctx.db
        .query("checkoutSession")
        .filter((q) =>
          q.and(
            q.lt(q.field("expiresAt"), now),
            q.eq(q.field("isFinalizingPayment"), false)
          )
        )
        .collect();
    }

    if (expiredSessions.length === 0) {
      console.log("No expired sessions found.");
      return;
    }

    // 2. Process each expired session
    for (const session of expiredSessions) {
      // Fetch all items within the expired session
      const sessionItems = await ctx.db
        .query("checkoutSessionItem")
        .filter((q) => q.eq(q.field("sesionId"), session._id))
        .collect();

      const availabilityUpdates = new Map<Id<"productSku">, number>();

      // Calculate the quantities to release
      for (const item of sessionItems) {
        const currentQuantity = availabilityUpdates.get(item.productSkuId) || 0;
        availabilityUpdates.set(
          item.productSkuId,
          currentQuantity + item.quantity
        );
      }

      // Update product SKU availability in bulk
      await Promise.all(
        Array.from(availabilityUpdates.entries()).map(
          async ([skuId, quantityToRelease]) => {
            const productSku = await ctx.db.get(skuId);
            if (productSku) {
              await ctx.db.patch(skuId, {
                quantityAvailable:
                  productSku.quantityAvailable + quantityToRelease,
              });
            }
          }
        )
      );

      // Delete session items and the expired session
      await Promise.all([
        ...sessionItems.map((item) => ctx.db.delete(item._id)),
        ctx.db.delete(session._id),
      ]);

      console.log(`Released quantities for session: ${session._id}`);
    }
  },
});

export const getActiveCheckoutSession = query({
  args: {
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  handler: async (ctx, args) => {
    return await retrieveActiveCheckoutSession(ctx, args.storeFrontUserId);
  },
});

export const cancelOrder = action({
  args: { id: v.id("checkoutSession") },
  handler: async (ctx, args) => {
    const session = await ctx.runQuery(api.storeFront.checkoutSession.getById, {
      sessionId: args.id,
    });

    if (!session) {
      return { success: false, message: "Invalid session." };
    }

    const response = await fetch(`https://api.paystack.co/refund`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
      body: JSON.stringify({
        transaction: session.externalTransactionId,
      }),
    });

    if (response.status == 200) {
      await Promise.all([
        await ctx.runMutation(
          internal.storeFront.checkoutSession.updateCheckoutSession,
          {
            id: session._id,
            isFinalizingPayment: false,
            isPaymentRefunded: true,
          }
        ),

        await ctx.runMutation(api.storeFront.onlineOrder.update, {
          externalReference: session.externalReference,
          update: { status: "cancelled" },
        }),
      ]);

      return { success: true, message: "Order has been cancelled." };
    } else {
      console.error("Failed to refund payment", response);
      return { success: false, message: "Failed to cancel order." };
    }
  },
});

export const completeCheckoutSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const oneHourAgo = now - 60 * 60 * 1000; // 1 hour in milliseconds

    const sessions = await ctx.db
      .query("checkoutSession")
      .filter((q) =>
        q.and(
          q.lt(q.field("expiresAt"), oneHourAgo),
          q.eq(q.field("isFinalizingPayment"), true),
          q.eq(q.field("hasCompletedPayment"), true),
          q.eq(q.field("hasVerifiedPayment"), true),
          q.eq(q.field("hasCompletedCheckoutSession"), false)
        )
      )
      .collect();

    if (sessions.length === 0) {
      console.log("No sessions to complete.");
      return;
    }

    // set all sessions to completed
    await Promise.all(
      sessions.map((session) =>
        ctx.db.patch(session._id, { hasCompletedCheckoutSession: true })
      )
    );

    console.log(
      "Completed checkout sessions",
      sessions.map((s) => s._id)
    );
  },
});

export const clearAbandonedSessions = internalAction({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.runQuery(
      api.storeFront.checkoutSession.getAbandonedCheckoutSessions,
      {}
    );

    if (sessions.length === 0) {
      console.log("No abandoned sessions found.");
      return { success: false, message: "No abandoned sessions" };
    }

    const checks = await Promise.all(
      sessions.map((session) => {
        return fetch(
          `https://api.paystack.co/transaction/verify/${session.externalReference}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
          }
        );
      })
    );

    const responses = await Promise.all(checks.map((check) => check.json()));

    const abandonededBags = responses
      .filter(
        (r) => r.data.status === "abandoned" || r.data.status === "failed"
      )
      .map((r) => r.data.reference);

    await ctx.runMutation(
      internal.storeFront.checkoutSession.releaseCheckoutItems,
      { externalReferences: abandonededBags }
    );
  },
});

export const updateCheckoutSession = internalMutation({
  args: {
    id: v.id("checkoutSession"),
    action: v.optional(v.string()),
    externalReference: v.optional(v.string()),
    externalTransactionId: v.optional(v.string()),
    isFinalizingPayment: v.optional(v.boolean()),
    hasCompletedPayment: v.optional(v.boolean()),
    hasCompletedCheckoutSession: v.optional(v.boolean()),
    isPaymentRefunded: v.optional(v.boolean()),
    hasVerifiedPayment: v.optional(v.boolean()),
    amount: v.optional(v.number()),
    orderDetails: v.optional(orderDetailsSchema),
    placedOrderId: v.optional(v.string()),
    paymentMethod: v.optional(
      v.object({
        last4: v.optional(v.string()),
        brand: v.optional(v.string()),
        bank: v.optional(v.string()),
        channel: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    try {
      const patchObject = createPatchObject(args);
      await ctx.db.patch(args.id, patchObject);

      const session = await ctx.db.get(args.id);

      if (!session) {
        console.log(
          "Session missing for id in updateCheckoutSession. Returning false.",
          args.id
        );
        return { success: false, message: "Invalid session." };
      }

      if (args.action === "place-order") {
        console.log("Placing order for session", args.id);
        return await handlePlaceOrder(ctx, args.id, session);
      }

      const shouldPlaceOrder =
        (session.hasCompletedPayment || session.hasVerifiedPayment) &&
        !session.placedOrderId;

      if (args.orderDetails && shouldPlaceOrder) {
        console.log(`Placing order from calculation for session ${args.id}`);
        return await handleOrderCreation(
          ctx,
          args.id,
          session,
          args.orderDetails
        );
      }

      return { success: true, orderId: session.placedOrderId };
    } catch (e) {
      console.error(e);
      return { success: false };
    }
  },
});

function createPatchObject(args: any) {
  const patchObject: Record<string, any> = {};

  // Status updates
  if (args.isFinalizingPayment !== undefined)
    patchObject.isFinalizingPayment = args.isFinalizingPayment;
  if (args.hasCompletedPayment !== undefined)
    patchObject.hasCompletedPayment = args.hasCompletedPayment;
  if (args.hasCompletedCheckoutSession !== undefined)
    patchObject.hasCompletedCheckoutSession = args.hasCompletedCheckoutSession;
  if (args.hasVerifiedPayment !== undefined)
    patchObject.hasVerifiedPayment = args.hasVerifiedPayment;

  if (args.isPaymentRefunded !== undefined)
    patchObject.isPaymentRefunded = args.isPaymentRefunded;

  // Reference and amount updates
  if (args.externalReference)
    patchObject.externalReference = args.externalReference;
  if (args.externalTransactionId)
    patchObject.externalTransactionId = args.externalTransactionId;
  if (args.amount) patchObject.amount = args.amount;

  // Payment method and order details
  if (args.paymentMethod) patchObject.paymentMethod = args.paymentMethod;
  if (args.orderDetails) {
    Object.assign(patchObject, {
      billingDetails: args.orderDetails.billingDetails,
      customerDetails: args.orderDetails.customerDetails,
      deliveryDetails: args.orderDetails.deliveryDetails,
      deliveryMethod: args.orderDetails.deliveryMethod,
      deliveryOption: args.orderDetails.deliveryOption,
      deliveryFee: args.orderDetails.deliveryFee,
      pickupLocation: args.orderDetails.pickupLocation,
    });

    if (args.orderDetails.discount) {
      patchObject.discount = args.orderDetails.discount;
    }
  }

  if (args.placedOrderId) patchObject.placedOrderId = args.placedOrderId;

  return patchObject;
}

async function handlePlaceOrder(
  ctx: MutationCtx,
  sessionId: Id<"checkoutSession">,
  session: CheckoutSession
) {
  const placedOrder = session.externalReference
    ? await ctx.runQuery(api.storeFront.onlineOrder.get, {
        identifier: session.externalReference,
      })
    : null;

  if (session.placedOrderId || placedOrder) {
    console.log(`Order has already been placed for session: ${sessionId}`);
    return {
      success: false,
      orderId: session.placedOrderId,
      message: "Order has already been placed for this session.",
    };
  }

  const orderResponse = await createOnlineOrder(ctx, sessionId, {
    billingDetails: session.billingDetails,
    customerDetails: session.customerDetails,
    deliveryDetails: session.deliveryDetails,
    deliveryMethod: session.deliveryMethod || "",
    deliveryOption: session.deliveryOption,
    deliveryInstructions: session.deliveryInstructions,
    deliveryFee: session.deliveryFee,
    discount: session.discount,
    pickupLocation: session.pickupLocation,
    paymentMethod: session.paymentMethod,
  });

  console.log(`Created online order for session ${sessionId}`, orderResponse);

  return orderResponse;
}

async function handleOrderCreation(
  ctx: MutationCtx,
  sessionId: Id<"checkoutSession">,
  session: CheckoutSession,
  orderDetails: any
) {
  const placedOrder = session.externalReference
    ? await ctx.runQuery(api.storeFront.onlineOrder.get, {
        identifier: session.externalReference,
      })
    : null;

  if (session.placedOrderId || placedOrder) {
    return {
      success: false,
      orderId: session.placedOrderId,
      message: "Order has already been placed for this session.",
    };
  }

  const orderResponse = await createOnlineOrder(ctx, sessionId, {
    ...orderDetails,
    paymentMethod: session.paymentMethod,
  });

  if (orderResponse.success) {
    console.log("Order created successfully. Clearing user bag.");
    await ctx.runMutation(api.storeFront.bag.clearBag, { id: session.bagId });
  }

  return orderResponse;
}

async function createOnlineOrder(
  ctx: MutationCtx,
  sessionId: Id<"checkoutSession">,
  orderData: any
): Promise<any> {
  const response = await ctx.runMutation(api.storeFront.onlineOrder.create, {
    checkoutSessionId: sessionId,
    ...orderData,
  });

  if (!response.success) {
    console.error(
      `Failed to create online order for session: ${sessionId} with error: ${response.error}`
    );
    return { success: false, message: "Failed to create online order." };
  }

  await ctx.db.patch(sessionId, { placedOrderId: response.orderId });
  return { success: true, orderId: response.orderId };
}

export const getCheckoutSession = query({
  args: {
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    externalReference: v.optional(v.string()),
    sessionId: v.optional(v.id("checkoutSession")),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("checkoutSession")
      .filter((q) =>
        q.and(
          q.eq(q.field("storeFrontUserId"), args.storeFrontUserId),
          q.or(
            q.eq(q.field("externalReference"), args.externalReference),
            q.eq(q.field("_id"), args.sessionId)
          )
        )
      )
      .first();
  },
});

export const getPendingCheckoutSessions = query({
  args: { storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("checkoutSession")
      .filter((q) =>
        q.and(
          q.eq(q.field("storeFrontUserId"), args.storeFrontUserId),
          q.eq(q.field("hasCompletedPayment"), true),
          q.eq(q.field("placedOrderId"), undefined),
          q.neq(q.field("isPaymentRefunded"), true)
        )
      )
      .collect();
  },
});

export const getById = query({
  args: { sessionId: v.id("checkoutSession") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;

    const sessionItems = await ctx.db
      .query("checkoutSessionItem")
      .filter((q) => q.eq(q.field("sesionId"), args.sessionId))
      .collect();

    const sessionItemsWithImages = await Promise.all(
      sessionItems.map(async (item) => {
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

    return {
      ...session,
      items: sessionItemsWithImages,
    };
  },
});

// --- Helper Methods ---

async function retrieveActiveCheckoutSession(
  ctx: QueryCtx,
  storeFrontUserId: Id<"storeFrontUser"> | Id<"guest">
) {
  const now = Date.now();

  // Query for the first active session for the given storeFrontUserId

  // a session is active if:
  // it has not expired, or isFinalizingPayment is true, or has
  return await ctx.db
    .query("checkoutSession")
    .filter((q) =>
      q.and(
        q.and(
          q.eq(q.field("storeFrontUserId"), storeFrontUserId),
          q.or(
            q.gt(q.field("expiresAt"), now),
            q.eq(q.field("isFinalizingPayment"), true)
          )
        ),
        q.eq(q.field("hasCompletedCheckoutSession"), false)
        // q.eq(q.field("placedOrderId"), undefined)
        // q.eq(q.field("hasCompletedPayment"), false)
      )
    )
    .first();
}

async function fetchProductSkus(ctx: QueryCtx, products: Product[]) {
  const productSkuIds = products.map((p) => p.productSkuId);
  return ctx.db
    .query("productSku")
    .filter((q: any) =>
      q.or(...productSkuIds.map((id) => q.eq(q.field("_id"), id)))
    )
    .collect();
}

// Adjusted availability check
function checkAdjustedAvailability(
  products: Product[],
  productSkus: ProductSku[],
  sessionItemsMap: Map<string, number>
) {
  const unavailable = [];
  for (const { productSkuId, productId, quantity } of products) {
    const sku = productSkus.find((p) => p._id === productSkuId);
    const existingQuantity = sessionItemsMap.get(productSkuId) || 0; // User's current session quantity
    const adjustedRequested = quantity - existingQuantity; // Net new quantity to request

    // Check both quantityAvailable and inventoryCount
    if (
      !sku ||
      sku.quantityAvailable < adjustedRequested ||
      (typeof sku.inventoryCount === "number" && sku.inventoryCount < quantity)
    ) {
      unavailable.push({
        productSkuId,
        requested: quantity,
        available: Math.min(
          (sku?.quantityAvailable ?? 0) + existingQuantity || 0,
          sku?.inventoryCount || 0
        ),
      });
    }
  }
  return unavailable;
}

async function updateExistingSession(
  ctx: MutationCtx,
  session: any,
  storeFrontUserId: Id<"storeFrontUser"> | Id<"guest">,
  products: Product[]
) {
  const sessionItems: CheckoutSessionItem[] = await ctx.db
    .query("checkoutSessionItem")
    .filter((q: any) => q.eq(q.field("sesionId"), session._id))
    .collect();

  const sessionItemsMap = new Map(
    sessionItems.map((item: any) => [item.productSkuId, item])
  );

  const itemsToInsert: Omit<CheckoutSessionItem, "_id" | "_creationTime">[] =
    [];
  const itemsToUpdate: { id: Id<"checkoutSessionItem">; quantity: number }[] =
    [];
  const itemsToDelete: Id<"checkoutSessionItem">[] = [];
  const availabilityUpdates: AvailabilityUpdate[] = [];

  for (const product of products) {
    const existingItem = sessionItemsMap.get(product.productSkuId);
    if (existingItem) {
      const diff = product.quantity - existingItem.quantity;
      if (diff !== 0) {
        itemsToUpdate.push({
          id: existingItem._id,
          quantity: product.quantity,
        });
        availabilityUpdates.push({ id: product.productSkuId, change: -diff });
      }
      sessionItemsMap.delete(product.productSkuId);
    } else {
      itemsToInsert.push({
        sesionId: session._id,
        productId: product.productId,
        productSku: product.productSku,
        productSkuId: product.productSkuId,
        quantity: product.quantity,
        price: product.price,
        storeFrontUserId: storeFrontUserId,
      });
      availabilityUpdates.push({
        id: product.productSkuId,
        change: -product.quantity,
      });
    }
  }

  for (const [, staleItem] of sessionItemsMap) {
    itemsToDelete.push(staleItem._id);
    availabilityUpdates.push({
      id: staleItem.productSkuId,
      change: staleItem.quantity,
    });
  }

  // Perform batch operations
  await Promise.all([
    ...itemsToInsert.map((item) => ctx.db.insert("checkoutSessionItem", item)),
    ...itemsToUpdate.map(({ id, quantity }) => ctx.db.patch(id, { quantity })),
    ...itemsToDelete.map((id) => ctx.db.delete(id)),
    ...availabilityUpdates.map(({ id, change }) =>
      updateAvailability(ctx, id, change)
    ),
  ]);

  const updatedSessionItems = await ctx.db
    .query("checkoutSessionItem")
    .filter((q: any) => q.eq(q.field("sesionId"), session._id))
    .collect();

  return {
    success: true,
    session: { ...session, sessionItems: updatedSessionItems },
  };
}

async function createSessionItems(
  ctx: MutationCtx,
  sessionId: Id<"checkoutSession">,
  storeFrontUserId: Id<"storeFrontUser"> | Id<"guest">,
  products: Product[]
) {
  return Promise.all(
    products.map((product) =>
      ctx.db.insert("checkoutSessionItem", {
        sesionId: sessionId,
        productId: product.productId,
        productSku: product.productSku,
        price: product.price,
        productSkuId: product.productSkuId,
        quantity: product.quantity,
        storeFrontUserId: storeFrontUserId,
      })
    )
  );
}

async function updateProductAvailability(
  ctx: MutationCtx,
  products: Product[],
  productSkus: any[]
) {
  await Promise.all(
    products.map(({ productSkuId, quantity }) => {
      const sku = productSkus.find((p) => p._id === productSkuId);
      if (sku) {
        return ctx.db.patch(productSkuId, {
          quantityAvailable: sku.quantityAvailable - quantity,
        });
      }
    })
  );
}

async function updateAvailability(
  ctx: any,
  productSkuId: Id<"productSku">,
  change: number
) {
  const productSku = await ctx.db.get(productSkuId);
  if (productSku) {
    await ctx.db.patch(productSkuId, {
      quantityAvailable: productSku.quantityAvailable + change,
    });
  }
}
