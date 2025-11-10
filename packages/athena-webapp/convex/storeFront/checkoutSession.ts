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

const checkIfItemsHaveChanged = (
  products: Product[],
  sessionItemsMap: Map<string, number>
) => {
  return products.some((product) => {
    const existingQuantity = sessionItemsMap.get(product.productSkuId);
    return existingQuantity !== product.quantity;
  });
};

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

    // Check if products are visible
    const invisibleProducts = productExistenceChecks.filter(
      (product) => product && product.isVisible === false
    );

    if (invisibleProducts.length > 0) {
      return {
        success: false,
        message: "Some items in your bag are no longer available",
        unavailableProducts: invisibleProducts.map((product) => {
          const correspondingProductData = args.products.find(
            (p) => p.productId === product?._id
          );
          return {
            productSkuId: correspondingProductData?.productSkuId,
            requested: correspondingProductData?.quantity || 0,
            available: 0,
          };
        }),
      };
    }

    // Fetch product SKUs
    const productSkus = await fetchProductSkus(ctx, args.products);

    // Check if product SKUs are visible
    const invisibleProductSkus = productSkus.filter(
      (sku) => sku.isVisible === false
    );

    if (invisibleProductSkus.length > 0) {
      return {
        success: false,
        message: "Some items in your bag are no longer available",
        unavailableProducts: invisibleProductSkus.map((sku) => ({
          productSkuId: sku._id,
          requested:
            args.products.find((p) => p.productSkuId === sku._id)?.quantity ||
            0,
          available: 0,
        })),
      };
    }

    // Check for existing session
    const existingSession = await retrieveActiveCheckoutSession(
      ctx,
      args.storeFrontUserId
    );

    let sessionItemsMap = new Map<string, number>();

    if (existingSession && existingSession.placedOrderId === undefined) {
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
        message: "Some items in your bag are low in stock or unavailable",
        unavailableProducts,
      };
    }

    if (existingSession && existingSession.placedOrderId === undefined) {
      return await handleExistingSession(
        ctx,
        existingSession,
        sessionItemsMap,
        {
          products: args.products,
          amount: args.amount,
          expiresAt,
          storeId: args.storeId,
          storeFrontUserId: args.storeFrontUserId,
        }
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

    // Auto-apply best-value promo code
    console.log(
      `[NewSession] Starting auto-apply process for session ${sessionId}`
    );

    const eligiblePromoCode = await findBestValuePromoCode(
      ctx,
      args.storeId,
      args.storeFrontUserId,
      sessionId
    );

    console.log(
      `[NewSession] Best-value promo code found: ${eligiblePromoCode}`
    );

    if (eligiblePromoCode) {
      console.log(
        `[NewSession] Attempting to redeem promo code: ${eligiblePromoCode}`
      );
      const redeemResult = await ctx.runMutation(
        api.inventory.promoCode.redeem,
        {
          code: eligiblePromoCode,
          checkoutSessionId: sessionId,
          storeFrontUserId: args.storeFrontUserId,
        }
      );

      console.log(`[NewSession] Redeem result:`, redeemResult);

      if (redeemResult.success) {
        console.log(
          `[NewSession] Successfully applied promo code: ${eligiblePromoCode}`
        );
      } else {
        console.log(
          `[NewSession] Failed to apply promo code: ${redeemResult.message}`
        );
      }
    } else {
      console.log(`[NewSession] No eligible promo code found for auto-apply`);
    }

    // Fetch updated session with discount applied
    const updatedSession = await ctx.db.get(sessionId);

    console.log("updatedSession", updatedSession);
    return {
      success: true,
      session: {
        ...updatedSession,
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

export const getActiveCheckoutSessionsForStore = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Query for the first active session for the given storeFrontUserId

    // a session is active if:
    // it has not expired, or isFinalizingPayment is true, or has
    return await ctx.db
      .query("checkoutSession")
      .filter((q) =>
        q.and(
          q.and(
            q.eq(q.field("storeId"), args.storeId),
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
      .collect();
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
    discount: v.optional(v.any()),
    paymentMethod: v.optional(
      v.object({
        last4: v.optional(v.string()),
        brand: v.optional(v.string()),
        bank: v.optional(v.string()),
        channel: v.optional(v.string()),
        type: v.optional(
          v.union(v.literal("online_payment"), v.literal("payment_on_delivery"))
        ),
        podPaymentMethod: v.optional(
          v.union(v.literal("cash"), v.literal("mobile_money"))
        ),
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

export const clearDiscount = internalMutation({
  args: { id: v.id("checkoutSession") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { discount: null });
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
  if (args.discount) patchObject.discount = args.discount;
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

/**
 * Handle updating an existing checkout session with new items
 * This consolidates the logic for:
 * - Updating session expiry and amount
 * - Updating session items
 * - Validating existing discount
 * - Finding and applying best-value promo code if needed
 */
async function handleExistingSession(
  ctx: MutationCtx,
  existingSession: any,
  sessionItemsMap: Map<string, number>,
  args: {
    products: Product[];
    amount: number;
    expiresAt: number;
    storeId: Id<"store">;
    storeFrontUserId: Id<"storeFrontUser"> | Id<"guest">;
  }
) {
  console.log(
    `[HandleExisting] Processing existing session: ${existingSession._id} | User: ${args.storeFrontUserId}`
  );

  // Update session expiry and amount
  await ctx.db.patch(existingSession._id, {
    expiresAt: args.expiresAt,
    amount: args.amount,
  });

  // Check if items have changed
  const itemsChanged = checkIfItemsHaveChanged(args.products, sessionItemsMap);
  console.log(`[HandleExisting] Items changed: ${itemsChanged}`);

  // Update session items if changed
  if (itemsChanged) {
    console.log(`[HandleExisting] Updating session items`);
    const updateResult = await updateExistingSession(
      ctx,
      existingSession,
      args.storeFrontUserId,
      args.products
    );

    if (!updateResult.success) {
      console.log(`[HandleExisting] Failed to update session items`);
      return {
        success: false,
        message: "Failed to update session",
      };
    }
  }

  // Handle discount validation and application
  let shouldFindNewPromo = false;

  if (existingSession.discount) {
    console.log(
      `[HandleExisting] Existing session has discount: ${existingSession.discount.code}`
    );

    // Validate existing discount against current session state
    const isDiscountValid = await validateExistingDiscount(
      ctx,
      existingSession.discount,
      args.storeFrontUserId,
      existingSession._id
    );

    if (!isDiscountValid) {
      console.log(`[HandleExisting] Existing discount is invalid, clearing it`);
      await ctx.runMutation(internal.storeFront.checkoutSession.clearDiscount, {
        id: existingSession._id,
      });
      shouldFindNewPromo = true;
    } else {
      console.log(
        `[HandleExisting] Existing discount is still valid: ${existingSession.discount.code}`
      );

      // If items changed, re-apply the discount to recalculate values
      if (itemsChanged) {
        console.log(
          `[HandleExisting] Re-applying existing discount due to item changes`
        );
        const redeemResult = await ctx.runMutation(
          api.inventory.promoCode.redeem,
          {
            code: existingSession.discount.code,
            checkoutSessionId: existingSession._id,
            storeFrontUserId: args.storeFrontUserId,
          }
        );

        if (!redeemResult.success) {
          console.log(
            `[HandleExisting] Failed to re-apply existing discount: ${redeemResult.message}`
          );
          await ctx.runMutation(
            internal.storeFront.checkoutSession.clearDiscount,
            {
              id: existingSession._id,
            }
          );
          shouldFindNewPromo = true;
        }
      }
    }
  } else {
    // No existing discount
    console.log(`[HandleExisting] No existing discount`);
    shouldFindNewPromo = true;
  }

  // Find and apply best-value promo code if needed
  if (shouldFindNewPromo) {
    console.log(`[HandleExisting] Searching for best-value promo code`);
    const eligiblePromoCode = await findBestValuePromoCode(
      ctx,
      args.storeId,
      args.storeFrontUserId,
      existingSession._id
    );

    if (eligiblePromoCode) {
      console.log(
        `[HandleExisting] Found best-value promo code: ${eligiblePromoCode}`
      );
      const redeemResult = await ctx.runMutation(
        api.inventory.promoCode.redeem,
        {
          code: eligiblePromoCode,
          checkoutSessionId: existingSession._id,
          storeFrontUserId: args.storeFrontUserId,
        }
      );

      if (redeemResult.success) {
        console.log(
          `[HandleExisting] Successfully applied promo code: ${eligiblePromoCode}`
        );
      } else {
        console.log(
          `[HandleExisting] Failed to apply promo code: ${redeemResult.message}`
        );
      }
    } else {
      console.log(`[HandleExisting] No eligible promo code found`);
    }
  }

  // Fetch and return updated session
  const updatedSession = await ctx.db.get(existingSession._id);
  const updatedSessionItems = await ctx.db
    .query("checkoutSessionItem")
    .filter((q) => q.eq(q.field("sesionId"), existingSession._id))
    .collect();

  console.log(`[HandleExisting] Successfully processed existing session`);
  return {
    success: true,
    session: { ...updatedSession, items: updatedSessionItems },
  };
}

/**
 * Validate if an existing discount is still valid and applicable to current session items
 */
async function validateExistingDiscount(
  ctx: MutationCtx,
  discount: any,
  storeFrontUserId: Id<"storeFrontUser"> | Id<"guest">,
  sessionId: Id<"checkoutSession">
): Promise<boolean> {
  const promoCodeId = discount.promoCodeId || discount._id || discount.id;
  if (!discount || !promoCodeId) {
    console.log(`[ValidateDiscount] No discount or promo code id found`);
    return false;
  }

  console.log(
    `[ValidateDiscount] Validating existing discount: ${discount.code}`
  );

  // Get the promo code
  const promoCode = await ctx.db.get(promoCodeId);
  if (!promoCode || promoCode._id !== promoCodeId) {
    console.log(
      `[ValidateDiscount] Promo code not found for existing discount: ${discount.code}`
    );
    return false;
  }

  // Type assertion since we know this is a promo code
  const promoCodeDoc = promoCode as any;

  // Check if still active
  if (!promoCodeDoc.active) {
    console.log(
      `[ValidateDiscount] Promo code no longer active: ${discount.code}`
    );
    return false;
  }

  // Check date validity
  const now = Date.now();
  if (now < promoCodeDoc.validFrom || now > promoCodeDoc.validTo) {
    console.log(
      `[ValidateDiscount] Promo code outside valid date range: ${discount.code}`
    );
    return false;
  }

  // Check if already redeemed
  const redeemed = await ctx.db
    .query("redeemedPromoCode")
    .filter((q) =>
      q.and(
        q.eq(q.field("promoCodeId"), promoCodeDoc._id),
        q.eq(q.field("storeFrontUserId"), storeFrontUserId)
      )
    )
    .first();

  if (redeemed) {
    console.log(
      `[ValidateDiscount] Promo code already redeemed: ${discount.code}`
    );
    return false;
  }

  // For exclusive codes, check if user still has valid offer
  if ((promoCodeDoc as any).isExclusive) {
    const hasOffer = await ctx.db
      .query("offer")
      .filter((q) =>
        q.and(
          q.eq(q.field("promoCodeId"), promoCodeDoc._id),
          q.eq(q.field("storeFrontUserId"), storeFrontUserId),
          q.eq(q.field("isRedeemed"), false)
        )
      )
      .first();

    if (!hasOffer) {
      console.log(
        `[ValidateDiscount] User no longer has valid offer for exclusive code: ${discount.code}`
      );
      return false;
    }
  }

  // Validate discount applies to current session items
  const sessionItems = await ctx.db
    .query("checkoutSessionItem")
    .filter((q) => q.eq(q.field("sesionId"), sessionId))
    .collect();

  if (sessionItems.length === 0) {
    console.log(`[ValidateDiscount] No items in session`);
    return false;
  }

  // For selected-products discounts, ensure at least one item matches
  if (promoCodeDoc.span === "selected-products") {
    const expectedProducts = await ctx.db
      .query("promoCodeItem")
      .filter((q) => q.eq(q.field("promoCodeId"), promoCodeDoc._id))
      .collect();

    const foundItems = sessionItems.filter((sessionItem) =>
      expectedProducts.some(
        (expectedProduct) =>
          expectedProduct.productSkuId === sessionItem.productSkuId
      )
    );

    if (foundItems.length === 0) {
      console.log(
        `[ValidateDiscount] No eligible products in session for selected-products discount: ${discount.code}`
      );
      return false;
    }
  }

  console.log(
    `[ValidateDiscount] Existing discount is still valid: ${discount.code}`
  );
  return true;
}

/**
 * Calculate the discount value for a promo code without applying it
 */
async function calculatePromoCodeValue(
  ctx: MutationCtx,
  promoCode: any,
  sessionItems: any[]
): Promise<number> {
  if (promoCode.span === "selected-products") {
    const expectedProducts = await ctx.db
      .query("promoCodeItem")
      .filter((q) => q.eq(q.field("promoCodeId"), promoCode._id))
      .collect();

    const foundItems = sessionItems.filter((sessionItem) =>
      expectedProducts.some(
        (expectedProduct) =>
          expectedProduct.productSkuId === sessionItem.productSkuId
      )
    );

    if (foundItems.length === 0) {
      return 0;
    }

    const discounts = foundItems.map((item) => {
      if (promoCode.discountType === "percentage") {
        return item.price * item.quantity * (promoCode.discountValue / 100);
      } else {
        return promoCode.discountValue;
      }
    });

    return discounts.reduce((a, b) => a + b, 0);
  }

  // For entire-order discounts
  if (promoCode.discountType === "percentage") {
    const subtotal = sessionItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    return subtotal * (promoCode.discountValue / 100);
  } else {
    return promoCode.discountValue;
  }
}

/**
 * Find the promo code that provides the best value (highest discount) for the customer
 */
async function findBestValuePromoCode(
  ctx: MutationCtx,
  storeId: Id<"store">,
  storeFrontUserId: Id<"storeFrontUser"> | Id<"guest">,
  sessionId: Id<"checkoutSession">
): Promise<string | null> {
  const now = Date.now();
  console.log(
    `[BestValue] Starting search for best-value promo code for store ${storeId}, user ${storeFrontUserId}`
  );

  // Get session items for discount calculation
  const sessionItems = await ctx.db
    .query("checkoutSessionItem")
    .filter((q) => q.eq(q.field("sesionId"), sessionId))
    .collect();

  if (sessionItems.length === 0) {
    console.log(`[BestValue] No items in session, skipping promo search`);
    return null;
  }

  // Query all active promo codes for the store with autoApply enabled
  const promoCodes = await ctx.db
    .query("promoCode")
    .filter((q) =>
      q.and(
        q.eq(q.field("storeId"), storeId),
        q.eq(q.field("active"), true),
        q.eq(q.field("autoApply"), true),
        q.lte(q.field("validFrom"), now),
        q.gte(q.field("validTo"), now)
      )
    )
    .collect();

  console.log(
    `[BestValue] Found ${promoCodes.length} active auto-apply promo codes for store`
  );

  if (promoCodes.length === 0) {
    console.log(`[BestValue] No eligible promo codes found`);
    return null;
  }

  // Filter to eligible codes (not already redeemed, has offer if exclusive)
  const eligibleCodes = [];

  for (const code of promoCodes) {
    // Check if user already redeemed this code
    const redeemed = await ctx.db
      .query("redeemedPromoCode")
      .filter((q) =>
        q.and(
          q.eq(q.field("promoCodeId"), code._id),
          q.eq(q.field("storeFrontUserId"), storeFrontUserId)
        )
      )
      .first();

    if (redeemed) {
      console.log(`[BestValue] Code already redeemed: ${code.code}`);
      continue;
    }

    // For exclusive codes, check if user has an offer
    if (code.isExclusive) {
      const offer = await ctx.db
        .query("offer")
        .filter((q) =>
          q.and(
            q.eq(q.field("promoCodeId"), code._id),
            q.eq(q.field("storeFrontUserId"), storeFrontUserId),
            q.eq(q.field("isRedeemed"), false)
          )
        )
        .first();

      if (!offer) {
        console.log(
          `[BestValue] User has no offer for exclusive code: ${code.code}`
        );
        continue;
      }
    }

    eligibleCodes.push(code);
  }

  console.log(`[BestValue] Found ${eligibleCodes.length} eligible codes`);

  if (eligibleCodes.length === 0) {
    return null;
  }

  // Calculate value for each eligible code
  const codeValues = await Promise.all(
    eligibleCodes.map(async (code) => {
      const value = await calculatePromoCodeValue(ctx, code, sessionItems);
      console.log(
        `[BestValue] Code ${code.code} provides discount of ${value}`
      );
      return { code: code.code, value };
    })
  );

  // Find the code with the highest discount value
  const bestCode = codeValues.reduce((best, current) => {
    return current.value > best.value ? current : best;
  });

  console.log(
    `[BestValue] Selected best-value code: ${bestCode.code} with discount of ${bestCode.value}`
  );

  return bestCode.value > 0 ? bestCode.code : null;
}
