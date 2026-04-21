import { Doc, Id } from "../../_generated/dataModel";
import { MutationCtx } from "../../_generated/server";
import { resolveRegisterSessionForInStoreCollectionWithCtx } from "../../cashControls/paymentAllocationAttribution";
import { ensureCustomerProfileFromSourcesWithCtx } from "../../operations/customerProfiles";
import { recordInventoryMovementWithCtx } from "../../operations/inventoryMovements";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import { recordPaymentAllocationWithCtx } from "../../operations/paymentAllocations";

type SignedInAthenaUser =
  | {
      id: Id<"athenaUser">;
      email: string;
    }
  | undefined;

const ONLINE_ORDER_STATUS_EVENT_TYPES: Record<string, string> = {
  cancelled: "online_order_cancelled",
  delivered: "online_order_delivered",
  "out-for-delivery": "online_order_out_for_delivery",
  "picked-up": "online_order_picked_up",
  "pickup-exception": "online_order_pickup_exception",
  "ready-for-delivery": "online_order_ready_for_delivery",
  "ready-for-pickup": "online_order_ready_for_pickup",
  "refund-submitted": "online_order_refund_submitted",
};

const COMPLETED_ONLINE_ORDER_STATUSES = new Set(["delivered", "picked-up"]);

export function getOnlineOrderStatusEventType(status: string) {
  return ONLINE_ORDER_STATUS_EVENT_TYPES[status] ?? "online_order_status_changed";
}

function isPaymentOnDeliveryOrder(
  order: Pick<Doc<"onlineOrder">, "isPODOrder" | "paymentMethod">
) {
  return Boolean(
    order.isPODOrder || order.paymentMethod?.type === "payment_on_delivery"
  );
}

export function assertValidOnlineOrderStatusTransition(
  order: Pick<
    Doc<"onlineOrder">,
    "deliveryMethod" | "isPODOrder" | "paymentCollected" | "paymentMethod" | "status"
  >,
  nextStatus: string
) {
  if (!nextStatus) {
    return;
  }

  if (nextStatus === order.status) {
    if (COMPLETED_ONLINE_ORDER_STATUSES.has(order.status)) {
      throw new Error(`Order is already completed as ${order.status}.`);
    }

    return;
  }

  if (order.deliveryMethod !== "pickup") {
    return;
  }

  if (nextStatus === "pickup-exception" && order.status !== "ready-for-pickup") {
    throw new Error(
      "Pickup exceptions can only be recorded after the order is ready for pickup."
    );
  }

  if (order.status === "pickup-exception" && nextStatus === "picked-up") {
    throw new Error(
      "Return the order to ready for pickup before completing the pickup."
    );
  }

  if (nextStatus === "picked-up" && isPaymentOnDeliveryOrder(order)) {
    if (!order.paymentCollected) {
      throw new Error(
        "Collect payment before marking this pickup order as picked up."
      );
    }
  }
}

export function getOnlineOrderPaymentMethodLabel(
  order: Pick<Doc<"onlineOrder">, "isPODOrder" | "paymentMethod" | "podPaymentMethod">
) {
  if (order.isPODOrder || order.paymentMethod?.type === "payment_on_delivery") {
    return order.podPaymentMethod ?? order.paymentMethod?.podPaymentMethod ?? "cash";
  }

  return order.paymentMethod?.channel ?? order.paymentMethod?.type ?? "unknown";
}

export function getOnlineOrderPaymentAmount(
  order: Pick<Doc<"onlineOrder">, "amount" | "paymentDue">
) {
  return order.paymentDue ?? order.amount;
}

async function getStoreOrganizationId(
  ctx: MutationCtx,
  storeId: Id<"store">
) {
  const store = await ctx.db.get("store", storeId);
  return store?.organizationId;
}

export async function resolveCustomerProfileForStoreFrontActor(
  ctx: MutationCtx,
  args: {
    organizationId?: Id<"organization">;
    storeFrontUserId: Id<"storeFrontUser"> | Id<"guest">;
    storeId: Id<"store">;
  }
) {
  try {
    const storeFrontUser = await ctx.db.get(
      "storeFrontUser",
      args.storeFrontUserId as Id<"storeFrontUser">
    );

    if (storeFrontUser) {
      return ensureCustomerProfileFromSourcesWithCtx(ctx, {
        fallbackOrganizationId: args.organizationId,
        fallbackStoreId: args.storeId,
        storeFrontUserId: args.storeFrontUserId as Id<"storeFrontUser">,
      });
    }
  } catch {}

  try {
    const guest = await ctx.db.get("guest", args.storeFrontUserId as Id<"guest">);

    if (guest) {
      return ensureCustomerProfileFromSourcesWithCtx(ctx, {
        fallbackOrganizationId: args.organizationId,
        fallbackStoreId: args.storeId,
        guestId: args.storeFrontUserId as Id<"guest">,
      });
    }
  } catch {}

  return null;
}

async function resolveOnlineOrderContext(
  ctx: MutationCtx,
  order: Doc<"onlineOrder">
) {
  const organizationId =
    (await getStoreOrganizationId(ctx, order.storeId)) ?? undefined;
  const customerProfile =
    order.customerProfileId
      ? await ctx.db.get("customerProfile", order.customerProfileId)
      : await resolveCustomerProfileForStoreFrontActor(ctx, {
          organizationId,
          storeFrontUserId: order.storeFrontUserId,
          storeId: order.storeId,
        });

  if (customerProfile?._id && customerProfile._id !== order.customerProfileId) {
    await ctx.db.patch("onlineOrder", order._id, {
      customerProfileId: customerProfile._id,
    });
  }

  return {
    customerProfileId: customerProfile?._id,
    organizationId,
  };
}

export async function recordOnlineOrderCreatedEvent(
  ctx: MutationCtx,
  order: Doc<"onlineOrder">
) {
  const { customerProfileId, organizationId } = await resolveOnlineOrderContext(
    ctx,
    order
  );

  return recordOperationalEventWithCtx(ctx, {
    customerProfileId,
    eventType: "online_order_created",
    metadata: {
      deliveryMethod: order.deliveryMethod,
      externalReference: order.externalReference ?? null,
      paymentDue: getOnlineOrderPaymentAmount(order),
      status: order.status,
    },
    onlineOrderId: order._id,
    organizationId,
    storeId: order.storeId,
    subjectId: order._id,
    subjectLabel: order.orderNumber,
    subjectType: "online_order",
  });
}

export async function recordOnlineOrderStatusEvent(
  ctx: MutationCtx,
  args: {
    nextStatus: string;
    order: Doc<"onlineOrder">;
    previousStatus?: string;
    signedInAthenaUser?: SignedInAthenaUser;
  }
) {
  if (!args.nextStatus || args.nextStatus === args.previousStatus) {
    return null;
  }

  const { customerProfileId, organizationId } = await resolveOnlineOrderContext(
    ctx,
    args.order
  );

  return recordOperationalEventWithCtx(ctx, {
    actorUserId: args.signedInAthenaUser?.id,
    customerProfileId,
    eventType: getOnlineOrderStatusEventType(args.nextStatus),
    metadata: {
      nextStatus: args.nextStatus,
      previousStatus: args.previousStatus ?? null,
    },
    onlineOrderId: args.order._id,
    organizationId,
    reason:
      args.previousStatus && args.previousStatus !== args.nextStatus
        ? `${args.previousStatus}->${args.nextStatus}`
        : undefined,
    storeId: args.order.storeId,
    subjectId: args.order._id,
    subjectLabel: args.order.orderNumber,
    subjectType: "online_order",
  });
}

export async function recordOnlineOrderPaymentVerified(
  ctx: MutationCtx,
  args: {
    amount?: number;
    order: Doc<"onlineOrder">;
    signedInAthenaUser?: SignedInAthenaUser;
  }
) {
  const amount = args.amount ?? getOnlineOrderPaymentAmount(args.order);
  if (amount <= 0) {
    return null;
  }

  const { customerProfileId, organizationId } = await resolveOnlineOrderContext(
    ctx,
    args.order
  );

  const allocation = await recordPaymentAllocationWithCtx(ctx, {
    actorUserId: args.signedInAthenaUser?.id,
    allocationType: "online_payment",
    amount,
    customerProfileId,
    externalReference:
      args.order.externalTransactionId ?? args.order.externalReference,
    method: getOnlineOrderPaymentMethodLabel(args.order),
    onlineOrderId: args.order._id,
    organizationId,
    storeId: args.order.storeId,
    targetId: args.order._id,
    targetType: "online_order",
  });

  return recordOperationalEventWithCtx(ctx, {
    actorUserId: args.signedInAthenaUser?.id,
    customerProfileId,
    eventType: "online_order_payment_verified",
    onlineOrderId: args.order._id,
    organizationId,
    paymentAllocationId: allocation?._id,
    reason: args.order.externalReference,
    storeId: args.order.storeId,
    subjectId: args.order._id,
    subjectLabel: args.order.orderNumber,
    subjectType: "online_order",
  });
}

export async function recordOnlineOrderPaymentCollected(
  ctx: MutationCtx,
  args: {
    order: Doc<"onlineOrder">;
    registerSessionId?: Id<"registerSession">;
    signedInAthenaUser?: SignedInAthenaUser;
  }
) {
  const amount = getOnlineOrderPaymentAmount(args.order);
  if (amount <= 0) {
    return null;
  }

  const { customerProfileId, organizationId } = await resolveOnlineOrderContext(
    ctx,
    args.order
  );
  const collectedInStore = args.order.deliveryMethod === "pickup";
  const resolvedRegisterSessionId = collectedInStore
    ? await resolveRegisterSessionForInStoreCollectionWithCtx(ctx, {
        actorUserId: args.signedInAthenaUser?.id,
        registerSessionId: args.registerSessionId,
        storeId: args.order.storeId,
      })
    : undefined;

  const allocation = await recordPaymentAllocationWithCtx(ctx, {
    actorUserId: args.signedInAthenaUser?.id,
    allocationType: "payment_on_delivery_collection",
    amount,
    collectedInStore,
    customerProfileId,
    externalReference:
      args.order.externalTransactionId ?? args.order.externalReference,
    method: getOnlineOrderPaymentMethodLabel(args.order),
    onlineOrderId: args.order._id,
    organizationId,
    registerSessionId: resolvedRegisterSessionId,
    storeId: args.order.storeId,
    targetId: args.order._id,
    targetType: "online_order",
  });

  return recordOperationalEventWithCtx(ctx, {
    actorUserId: args.signedInAthenaUser?.id,
    customerProfileId,
    eventType: "online_order_payment_collected",
    onlineOrderId: args.order._id,
    organizationId,
    paymentAllocationId: allocation?._id,
    registerSessionId: resolvedRegisterSessionId,
    reason: getOnlineOrderPaymentMethodLabel(args.order),
    storeId: args.order.storeId,
    subjectId: args.order._id,
    subjectLabel: args.order.orderNumber,
    subjectType: "online_order",
  });
}

export async function recordOnlineOrderRefundAllocation(
  ctx: MutationCtx,
  args: {
    amount: number;
    externalReference?: string;
    order: Doc<"onlineOrder">;
    signedInAthenaUser?: SignedInAthenaUser;
  }
) {
  if (args.amount <= 0) {
    return null;
  }

  const { customerProfileId, organizationId } = await resolveOnlineOrderContext(
    ctx,
    args.order
  );

  return recordPaymentAllocationWithCtx(ctx, {
    actorUserId: args.signedInAthenaUser?.id,
    allocationType: "refund",
    amount: args.amount,
    customerProfileId,
    direction: "out",
    externalReference: args.externalReference ?? args.order.externalTransactionId,
    method: getOnlineOrderPaymentMethodLabel(args.order),
    onlineOrderId: args.order._id,
    organizationId,
    storeId: args.order.storeId,
    targetId: args.order._id,
    targetType: "online_order",
  });
}

export async function recordOnlineOrderFulfillmentMovement(
  ctx: MutationCtx,
  args: {
    item: Doc<"onlineOrderItem">;
    order: Doc<"onlineOrder">;
  }
) {
  const { customerProfileId, organizationId } = await resolveOnlineOrderContext(
    ctx,
    args.order
  );

  return recordInventoryMovementWithCtx(ctx, {
    customerProfileId,
    movementType: "fulfillment",
    notes: args.order.orderNumber,
    onlineOrderId: args.order._id,
    organizationId,
    productId: args.item.productId,
    productSkuId: args.item.productSkuId,
    quantityDelta: -args.item.quantity,
    reasonCode: "online_order_item_ready",
    sourceId: args.item._id,
    sourceType: "online_order_item",
    storeId: args.order.storeId,
  });
}

export async function recordOnlineOrderRestockMovement(
  ctx: MutationCtx,
  args: {
    item: Doc<"onlineOrderItem">;
    order: Doc<"onlineOrder">;
    reasonCode: string;
  }
) {
  const { customerProfileId, organizationId } = await resolveOnlineOrderContext(
    ctx,
    args.order
  );

  return recordInventoryMovementWithCtx(ctx, {
    customerProfileId,
    movementType: "restock",
    notes: args.order.orderNumber,
    onlineOrderId: args.order._id,
    organizationId,
    productId: args.item.productId,
    productSkuId: args.item.productSkuId,
    quantityDelta: args.item.quantity,
    reasonCode: args.reasonCode,
    sourceId: args.item._id,
    sourceType: "online_order_item",
    storeId: args.order.storeId,
  });
}
