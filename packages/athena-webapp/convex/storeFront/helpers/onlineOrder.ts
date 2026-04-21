import { Id } from "../../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../../_generated/server";
import { calculateOrderAmount } from "./paymentHelpers";
import {
  recordOnlineOrderCreatedEvent,
  recordOnlineOrderRestockMovement,
  resolveCustomerProfileForStoreFrontActor,
} from "./orderOperations";

const MAX_BAG_ITEMS = 200;
const MAX_CHECKOUT_SESSION_ITEMS = 200;
const MAX_ORDER_ITEMS = 200;

function generateOrderNumber() {
  const timestamp = Math.floor(Date.now() / 1000);
  const baseOrderNumber = timestamp % 100000;
  const randomPadding = Math.floor(Math.random() * 10);
  return (baseOrderNumber * 10 + randomPadding).toString().padStart(5, "0");
}

export async function findOrderByExternalReference(
  ctx: QueryCtx | MutationCtx,
  externalReference: string
) {
  return await ctx.db
    .query("onlineOrder")
    .withIndex("by_externalReference", (q) =>
      q.eq("externalReference", externalReference)
    )
    .first();
}

export async function findOrderByExternalTransactionId(
  ctx: QueryCtx | MutationCtx,
  externalTransactionId: string
) {
  return await ctx.db
    .query("onlineOrder")
    .withIndex("by_externalTransactionId", (q) =>
      q.eq("externalTransactionId", externalTransactionId)
    )
    .first();
}

export async function clearBagItems(
  ctx: MutationCtx,
  bagId: Id<"bag">
) {
  const items = await ctx.db
    .query("bagItem")
    .withIndex("by_bagId", (q) => q.eq("bagId", bagId))
    .take(MAX_BAG_ITEMS);

  await Promise.all(items.map((item) => ctx.db.delete("bagItem", item._id)));
}

export async function returnOrderItemsToStock(
  ctx: MutationCtx,
  orderId: Id<"onlineOrder">
) {
  const order = await ctx.db.get("onlineOrder", orderId);
  const orderItems = await ctx.db
    .query("onlineOrderItem")
    .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
    .take(MAX_ORDER_ITEMS);

  await Promise.all(
    orderItems.map(async (item) => {
      if (item.isRestocked) {
        console.log("item already restocked", item._id);
        return;
      }

      await ctx.db.patch("onlineOrderItem", item._id, {
        isRefunded: true,
        isRestocked: true,
      });

      const productSku = await ctx.db.get("productSku", item.productSkuId);
      if (!productSku) {
        return;
      }

      await ctx.db.patch("productSku", item.productSkuId, {
        quantityAvailable: productSku.quantityAvailable + item.quantity,
        inventoryCount: item.isReady
          ? productSku.inventoryCount + item.quantity
          : productSku.inventoryCount,
      });

      if (order) {
        await recordOnlineOrderRestockMovement(ctx, {
          item,
          order,
          reasonCode: item.isReady
            ? "online_order_item_restocked"
            : "online_order_reservation_released",
        });
      }
    })
  );
}

export async function createOrderFromCheckoutSession(
  ctx: MutationCtx,
  args: {
    checkoutSessionId: Id<"checkoutSession">;
    billingDetails?: any;
    customerDetails?: any;
    deliveryDetails?: any;
    deliveryInstructions?: string | null;
    deliveryMethod?: string | null;
    deliveryOption?: string | null;
    deliveryFee?: number | null;
    discount?: any;
    pickupLocation?: string | null;
    paymentMethod?: any;
    externalTransactionId?: string;
    patchSessionPlacedOrderId?: boolean;
    clearBag?: boolean;
  }
) {
  const session = await ctx.db.get("checkoutSession", args.checkoutSessionId);

  console.log(`creating online order for session: ${session?._id}`);

  if (!session) {
    return {
      success: false,
      error: "Invalid session",
    };
  }

  const discount = args.discount ?? session.discount;
  const store = await ctx.db.get("store", session.storeId);
  const customerProfile = await resolveCustomerProfileForStoreFrontActor(ctx, {
    organizationId: store?.organizationId,
    storeFrontUserId: session.storeFrontUserId,
    storeId: session.storeId,
  });

  const items = await ctx.db
    .query("checkoutSessionItem")
    .withIndex("by_sessionId", (q) => q.eq("sesionId", args.checkoutSessionId))
    .take(MAX_CHECKOUT_SESSION_ITEMS);

  const paymentDue = calculateOrderAmount({
    deliveryFee: args.deliveryFee ?? session.deliveryFee ?? 0,
    discount,
    items: items.map((item) => ({
      price: item.price,
      productSkuId: item.productSkuId,
      quantity: item.quantity,
    })),
    subtotal: session.amount,
  });

  const orderId = await ctx.db.insert("onlineOrder", {
    amount: session.amount,
    bagId: session.bagId,
    billingDetails: args.billingDetails ?? (session.billingDetails as any),
    checkoutSessionId: args.checkoutSessionId,
    customerDetails: args.customerDetails ?? (session.customerDetails as any),
    customerProfileId: customerProfile?._id,
    deliveryDetails: args.deliveryDetails ?? (session.deliveryDetails as any),
    deliveryFee: args.deliveryFee ?? session.deliveryFee,
    deliveryInstructions:
      args.deliveryInstructions ?? session.deliveryInstructions,
    deliveryMethod: args.deliveryMethod ?? session.deliveryMethod ?? "n/a",
    deliveryOption: args.deliveryOption ?? session.deliveryOption,
    discount,
    externalReference: session.externalReference,
    externalTransactionId:
      args.externalTransactionId ?? session.externalTransactionId?.toString(),
    hasVerifiedPayment: session.hasVerifiedPayment,
    orderNumber: generateOrderNumber(),
    paymentDue,
    paymentMethod: args.paymentMethod,
    pickupLocation: args.pickupLocation ?? session.pickupLocation,
    status: "open",
    storeFrontUserId: session.storeFrontUserId,
    storeId: session.storeId,
  });

  await Promise.all(
    items.map((item) =>
      ctx.db.insert("onlineOrderItem", {
        orderId,
        productId: item.productId,
        quantity: item.quantity,
        productSku: item.productSku,
        productSkuId: item.productSkuId,
        storeFrontUserId: item.storeFrontUserId,
        price: item.price,
      })
    )
  );

  await Promise.all(
    items.map(async (item) => {
      const promoCodeItem = await ctx.db
        .query("promoCodeItem")
        .withIndex("by_productSkuId", (q) =>
          q.eq("productSkuId", item.productSkuId)
        )
        .first();

      if (promoCodeItem) {
        await ctx.db.patch("promoCodeItem", promoCodeItem._id, {
          quantityClaimed:
            (promoCodeItem.quantityClaimed ?? 0) + item.quantity,
        });
      }
    })
  );

  if (discount?.id) {
    if (!discount.isMultipleUses) {
      await ctx.db.insert("redeemedPromoCode", {
        promoCodeId: discount.id as Id<"promoCode">,
        storeFrontUserId: session.storeFrontUserId,
      });
    }

    const offer = await ctx.db
      .query("offer")
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", session.storeFrontUserId)
      )
      .filter((q) => q.eq(q.field("promoCodeId"), discount.id))
      .first();

    if (offer) {
      await ctx.db.patch("offer", offer._id, {
        isRedeemed: true,
        status: "redeemed",
      });
    }
  }

  if (args.patchSessionPlacedOrderId) {
    await ctx.db.patch("checkoutSession", args.checkoutSessionId, {
      placedOrderId: orderId,
    });
  }

  if (args.clearBag) {
    await clearBagItems(ctx, session.bagId);
  }

  const createdOrder = await ctx.db.get("onlineOrder", orderId);
  if (createdOrder) {
    await recordOnlineOrderCreatedEvent(ctx, createdOrder);
  }

  console.log("created online order for session.");

  return {
    success: true,
    orderId,
  };
}
