import { CheckoutSessionItem, ProductSku } from "../../types";
import { Id } from "../_generated/dataModel";
import { internalMutation, mutation, query } from "../_generated/server";
import { v } from "convex/values";

const entity = "checkoutSession";

const sessionLimitMinutes = 10;

type Product = {
  productId: Id<"product">;
  productSku: string;
  productSkuId: Id<"productSku">;
  quantity: number;
};

type AvailabilityUpdate = { id: Id<"productSku">; change: number };

export const create = mutation({
  args: {
    storeId: v.id("store"),
    customerId: v.union(v.id("customer"), v.id("guest")),
    bagId: v.id("bag"),
    products: v.array(
      v.object({
        productId: v.id("product"),
        productSku: v.string(),
        productSkuId: v.id("productSku"),
        quantity: v.number(),
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
    const existingSession = await getActiveSession(ctx, args.customerId, now);

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
      await ctx.db.patch(existingSession._id, { expiresAt });

      // Update the active session and product availability
      return await updateExistingSession(
        ctx,
        existingSession,
        args.customerId,
        args.products
      );
    }

    // Create new session
    const sessionId = await ctx.db.insert(entity, {
      bagId: args.bagId,
      customerId: args.customerId,
      storeId: args.storeId,
      expiresAt,
    });

    // Create session items
    await createSessionItems(ctx, sessionId, args.customerId, args.products);

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

export const getActiveChekoutSession = query({
  args: {
    customerId: v.union(v.id("customer"), v.id("guest")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Query for the first active session for the given customerId
    const activeSession = await ctx.db
      .query("checkoutSession")
      .filter((q) =>
        q.and(
          q.eq(q.field("customerId"), args.customerId),
          q.or(
            q.gt(q.field("expiresAt"), now),
            q.eq(q.field("isFinalizingPayment"), true)
          )
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

export const updateCheckoutSession = mutation({
  args: {
    id: v.id("checkoutSession"),
    isFinalizingPayment: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      isFinalizingPayment: args.isFinalizingPayment,
    });

    return { success: true };
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

function checkAvailability(products: Product[], productSkus: any[]) {
  const unavailable = [];
  for (const { productSkuId, quantity } of products) {
    const sku = productSkus.find((p) => p._id === productSkuId);
    if (!sku || sku.quantityAvailable < quantity) {
      unavailable.push({
        productSkuId,
        requested: quantity,
        available: sku?.quantityAvailable ?? 0,
      });
    }
  }
  return unavailable;
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

    if (!sku || sku.quantityAvailable < adjustedRequested) {
      unavailable.push({
        productSkuId,
        requested: quantity,
        available: sku?.quantityAvailable + existingQuantity || 0,
      });
    }
  }
  return unavailable;
}

async function getActiveSession(
  ctx: any,
  customerId: Id<"customer" | "guest">,
  now: number
) {
  return ctx.db
    .query(entity)
    .filter((q: any) =>
      q.and(
        q.eq(q.field("customerId"), customerId),
        q.gt(q.field("expiresAt"), now)
      )
    )
    .first();
}

async function updateExistingSession(
  ctx: any,
  session: any,
  customerId: string,
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
        customerId: customerId,
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
  customerId: Id<"customer"> | Id<"guest">,
  products: Product[]
) {
  return Promise.all(
    products.map((product) =>
      ctx.db.insert("checkoutSessionItem", {
        sesionId: sessionId,
        productId: product.productId,
        productSku: product.productSku,
        productSkuId: product.productSkuId,
        quantity: product.quantity,
        customerId: customerId,
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
