import { CheckoutSessionItem, ProductSku } from "../../types";
import { api } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { internalMutation, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { orderDetailsSchema } from "../schemas/storeFront";

const entity = "checkoutSession";

const sessionLimitMinutes = 10;

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
    const sessionLimit = sessionLimitMinutes * 60 * 1000; // 15 minutes in ms
    const expiresAt = now + sessionLimit;

    // Fetch product SKUs
    const productSkus = await fetchProductSkus(ctx, args.products);

    // Check for existing session
    const { session: existingSession } = await getActiveCheckoutSession(
      ctx,
      args
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
        message: "Some products are unavailable or insufficient in stock.",
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
      deliveryOption: null,
      deliveryFee: null,
      pickupLocation: null,
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

// Mutation to release held quantities from expired checkout sessions
export const releaseCheckoutItems = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();

    // 1. Fetch all expired checkout sessions
    const expiredSessions = await ctx.db
      .query("checkoutSession")
      .filter((q) =>
        q.and(
          q.lt(q.field("expiresAt"), now),
          q.or(
            q.eq(q.field("isFinalizingPayment"), false), // Explicitly false
            q.not(q.field("isFinalizingPayment")) // Undefined
          )
        )
      )
      .collect();

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
    const now = Date.now();

    // Query for the first active session for the given storeFrontUserId

    // a session is active if:
    // it has not expired, or isFinalizingPayment is true, or has
    const activeSession = await ctx.db
      .query("checkoutSession")
      .filter((q) =>
        q.and(
          q.and(
            q.eq(q.field("storeFrontUserId"), args.storeFrontUserId),
            q.or(
              q.gt(q.field("expiresAt"), now),
              q.eq(q.field("isFinalizingPayment"), true)
            )
          ),
          q.eq(q.field("hasCompletedCheckoutSession"), false)
        )
      )
      .first();

    if (activeSession) {
      return {
        session: activeSession,
      };
    }

    return {
      message: "No active session found.",
    };
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
    hasVerifiedPayment: v.optional(v.boolean()),
    amount: v.optional(v.number()),
    orderDetails: v.optional(orderDetailsSchema),
    paymentMethod: v.optional(
      v.object({
        last4: v.optional(v.string()),
        brand: v.optional(v.string()),
        bank: v.optional(v.string()),
        channel: v.optional(v.string()),
      })
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ success: boolean; message?: string; orderId?: string }> => {
    const patchObject: Record<string, any> = {};
    if (args.isFinalizingPayment !== undefined) {
      patchObject.isFinalizingPayment = args.isFinalizingPayment;
    }

    if (args.hasCompletedPayment !== undefined) {
      patchObject.hasCompletedPayment = args.hasCompletedPayment;
    }

    if (args.hasCompletedCheckoutSession !== undefined) {
      patchObject.hasCompletedCheckoutSession =
        args.hasCompletedCheckoutSession;
    }

    if (args.externalReference) {
      patchObject.externalReference = args.externalReference;
    }

    if (args.externalTransactionId) {
      patchObject.externalTransactionId = args.externalTransactionId;
    }

    if (args.hasVerifiedPayment !== undefined) {
      patchObject.hasVerifiedPayment = args.hasVerifiedPayment;
    }

    if (args.amount) {
      patchObject.amount = args.amount;
    }

    if (args.paymentMethod) {
      patchObject.paymentMethod = args.paymentMethod;
    }

    if (args.orderDetails) {
      patchObject.billingDetails = args.orderDetails.billingDetails;
      patchObject.customerDetails = args.orderDetails.customerDetails;
      patchObject.deliveryDetails = args.orderDetails.deliveryDetails;
      patchObject.deliveryMethod = args.orderDetails.deliveryMethod;
      patchObject.deliveryOption = args.orderDetails.deliveryOption;
      patchObject.deliveryFee = args.orderDetails.deliveryFee;
      patchObject.pickupLocation = args.orderDetails.pickupLocation;
    }

    try {
      await ctx.db.patch(args.id, patchObject);

      // Move online order creation up in dance
      const session = await ctx.db.get(args.id);

      if (args.action == "place-order" && session) {
        // check that an order has not already been placed for this session
        if (session.placedOrderId) {
          console.log(`Order has already been placed for session: ${args.id}`);
          return {
            success: false,
            orderId: session.placedOrderId,
            message: "Order has already been placed for this session.",
          };
        }

        const { address, city, country, zip, region } =
          (session?.deliveryDetails as Record<string, any>) || {};

        const onlineOrderResponse:
          | {
              error: string;
              success: boolean;
              orderId?: undefined;
            }
          | {
              success: boolean;
              orderId: Id<"onlineOrder">;
              error?: undefined;
            } = await ctx.runMutation(api.storeFront.onlineOrder.create, {
          checkoutSessionId: args.id,
          billingDetails: {
            zip: session?.billingDetails?.zip,
            country: session?.billingDetails?.country,
            address: session?.billingDetails?.address,
            city: session?.billingDetails?.city,
          },
          customerDetails: {
            email: session?.customerDetails?.email,
            firstName: session?.customerDetails?.firstName,
            lastName: session?.customerDetails?.lastName,
            phoneNumber: session?.customerDetails?.phoneNumber,
          },
          deliveryDetails: {
            zip,
            country,
            address,
            city,
            region,
          },
          deliveryMethod: session.deliveryMethod || "",
          deliveryOption: session.deliveryOption,
          deliveryFee: session.deliveryFee,
          pickupLocation: session.pickupLocation,
          paymentMethod: session?.paymentMethod,
        });

        if (!onlineOrderResponse.success) {
          console.error(
            `Failed to create online order for session: ${args.id} with error: ${onlineOrderResponse.error}`
          );
          return { success: false, message: "Failed to create online order." };
        }

        console.log(
          `online order created for ${session?._id} | ${session?.customerDetails?.email}`
        );

        await ctx.db.patch(args.id, {
          placedOrderId: onlineOrderResponse.orderId,
        });

        return { success: true, orderId: onlineOrderResponse.orderId };
      }

      if (args.orderDetails && session?.hasCompletedPayment) {
        if (!session) {
          console.error(`Invalid session: ${args.id}`);
          return { success: false, message: "Invalid session." };
        }

        // check that an order has not already been placed for this session
        if (session.placedOrderId) {
          console.log(`Order has already been placed for session: ${args.id}`);
          return {
            success: false,
            orderId: session.placedOrderId,
            message: "Order has already been placed for this session.",
          };
        }

        const onlineOrderResponse:
          | {
              error: string;
              success: boolean;
              orderId?: undefined;
            }
          | {
              success: boolean;
              orderId: Id<"onlineOrder">;
              error?: undefined;
            } = await ctx.runMutation(api.storeFront.onlineOrder.create, {
          checkoutSessionId: args.id,
          billingDetails: args.orderDetails.billingDetails,
          customerDetails: args.orderDetails.customerDetails,
          deliveryDetails: args.orderDetails.deliveryDetails,
          deliveryMethod: args.orderDetails.deliveryMethod,
          deliveryOption: args.orderDetails.deliveryOption,
          deliveryFee: args.orderDetails.deliveryFee,
          pickupLocation: args.orderDetails.pickupLocation,
          paymentMethod: session?.paymentMethod,
        });

        if (!onlineOrderResponse.success) {
          console.error(
            `Failed to create online order for session: ${args.id} with error: ${onlineOrderResponse.error}`
          );
          return { success: false, message: "Failed to create online order." };
        }

        console.log(
          `online order created for ${session?._id} | ${args.orderDetails.customerDetails.email}`
        );

        await ctx.db.patch(args.id, {
          placedOrderId: onlineOrderResponse.orderId,
        });

        if (session) {
          // clear all items in the current active bag
          await ctx.runMutation(api.storeFront.bag.clearBag, {
            id: session.bagId,
          });
        }

        return { success: true, orderId: onlineOrderResponse.orderId };
      }

      return { success: true, orderId: session?.placedOrderId };
    } catch (e) {
      console.error(e);
      return { success: false };
    }
  },
});

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
    const threshold = Date.now() - 10 * 60 * 1000;

    return await ctx.db
      .query("checkoutSession")
      .filter((q) =>
        q.and(
          q.eq(q.field("storeFrontUserId"), args.storeFrontUserId),
          q.eq(q.field("hasCompletedPayment"), true),
          q.eq(q.field("hasCompletedCheckoutSession"), true),
          q.eq(q.field("placedOrderId"), undefined)
          // q.lt(q.field("expiresAt"), threshold)
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

async function fetchProductSkus(ctx: any, products: Product[]) {
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
  for (const { productSkuId, quantity } of products) {
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
          sku?.quantityAvailable + existingQuantity || 0,
          sku?.inventoryCount || 0
        ),
      });
    }
  }
  return unavailable;
}

async function updateExistingSession(
  ctx: any,
  session: any,
  storeFrontUserId: string,
  products: Product[]
) {
  const sessionItems: CheckoutSessionItem[] = await ctx.db
    .query("checkoutSessionItem")
    .filter((q: any) => q.eq(q.field("sesionId"), session._id))
    .collect();

  const sessionItemsMap = new Map(
    sessionItems.map((item: any) => [item.productSkuId, item])
  );

  const itemsToInsert: CheckoutSessionItem[] = [];
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
  ctx: any,
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
  ctx: any,
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
