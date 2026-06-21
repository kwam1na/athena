import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  appendWorkflowTraceEventWithCtx,
  createWorkflowTraceWithCtx,
  registerWorkflowTraceLookupWithCtx,
} from "../workflowTraces/core";
import {
  buildOnlineOrderTraceSeed,
  buildSafeExternalReferenceRef,
  type OnlineOrderTraceSeed,
} from "../workflowTraces/adapters/onlineOrder";
import {
  buildOrderReturnExchangeTraceSeed,
  ORDER_RETURN_EXCHANGE_LOOKUP_TYPES,
  type OrderReturnExchangeTraceSeed,
} from "../workflowTraces/adapters/orderReturnExchange";

type SignedInAthenaUser =
  | {
      id: Id<"athenaUser">;
      email: string;
    }
  | undefined;

type OnlineOrderTraceStage =
  | "created"
  | "paymentCollected"
  | "paymentVerified"
  | "statusChanged";

type OnlineOrderReturnExchangeTraceStage =
  | "approvalRequired"
  | "balanceCollected"
  | "exchangeProcessed"
  | "refundFinalized"
  | "refundReleased"
  | "refundReserved"
  | "replacementIssued"
  | "restocked"
  | "returnProcessed";

export type OnlineOrderTraceRecordArgs = {
  actorUserId?: Id<"athenaUser">;
  amount?: number;
  nextStatus?: string;
  occurredAt?: number;
  order: Doc<"onlineOrder">;
  organizationId?: Id<"organization">;
  paymentMethod?: string;
  previousStatus?: string;
  registerSessionId?: Id<"registerSession">;
  signedInAthenaUser?: SignedInAthenaUser;
  stage: OnlineOrderTraceStage;
};

export type OnlineOrderReturnExchangeTraceRecordArgs = {
  actorUserId?: Id<"athenaUser">;
  amount?: number;
  approvalRequestId?: Id<"approvalRequest">;
  eventRef?: string;
  inventoryMovementIds?: Array<Id<"inventoryMovement">>;
  itemCount?: number;
  occurredAt?: number;
  operationRef: string;
  order: Doc<"onlineOrder">;
  organizationId?: Id<"organization">;
  paymentAllocationId?: Id<"paymentAllocation">;
  refundId?: string;
  replacementCount?: number;
  reservationId?: string;
  signedInAthenaUser?: SignedInAthenaUser;
  stage: OnlineOrderReturnExchangeTraceStage;
};

const ONLINE_ORDER_TRACEABLE_STATUSES = new Set([
  "cancelled",
  "delivered",
  "out-for-delivery",
  "picked-up",
  "ready-for-delivery",
  "ready-for-pickup",
]);

async function resolveStoreOrganizationId(ctx: MutationCtx, storeId: Id<"store">) {
  const store = await ctx.db.get("store", storeId);
  return store?.organizationId;
}

function buildActorRefs(args: {
  actorUserId?: Id<"athenaUser">;
  signedInAthenaUser?: SignedInAthenaUser;
}) {
  const actorUserId = args.actorUserId ?? args.signedInAthenaUser?.id;

  return actorUserId ? { athenaUserId: String(actorUserId) } : undefined;
}

function compactDetails(details: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined),
  );
}

function buildTraceRecord(traceSeed: OnlineOrderTraceSeed) {
  return {
    ...traceSeed.trace,
    details: {
      source: "storefront_online_order",
    },
  };
}

function statusStep(status: string) {
  switch (status) {
    case "cancelled":
      return "order_cancelled";
    case "delivered":
    case "picked-up":
      return "order_fulfilled";
    case "out-for-delivery":
      return "order_out_for_delivery";
    case "ready-for-delivery":
    case "ready-for-pickup":
      return "order_ready";
    default:
      return "order_status_changed";
  }
}

function statusMessage(args: OnlineOrderTraceRecordArgs) {
  switch (args.nextStatus) {
    case "cancelled":
      return `Order ${args.order.orderNumber} was cancelled`;
    case "delivered":
      return `Order ${args.order.orderNumber} was delivered`;
    case "out-for-delivery":
      return `Order ${args.order.orderNumber} went out for delivery`;
    case "picked-up":
      return `Order ${args.order.orderNumber} was picked up`;
    case "ready-for-delivery":
    case "ready-for-pickup":
      return `Order ${args.order.orderNumber} is ready`;
    default:
      return `Order ${args.order.orderNumber} changed status`;
  }
}

function buildTraceEvent(args: OnlineOrderTraceRecordArgs & {
  traceSeed: OnlineOrderTraceSeed;
}) {
  const occurredAt = args.occurredAt ?? Date.now();
  const common = {
    storeId: args.traceSeed.trace.storeId,
    traceId: args.traceSeed.trace.traceId,
    workflowType: args.traceSeed.trace.workflowType,
    occurredAt,
    source: args.traceSeed.eventSource,
    subjectRefs: {
      ...args.traceSeed.subjectRefs,
      ...(args.registerSessionId
        ? { registerSessionId: String(args.registerSessionId) }
        : {}),
    },
    actorRefs: buildActorRefs(args),
  };

  if (args.stage === "created") {
    return {
      ...common,
      eventKey: `online-order:${args.order._id}:created`,
      kind: "milestone" as const,
      step: "order_created",
      status: "started" as const,
      message: `Order ${args.order.orderNumber} was created`,
      details: {
        deliveryMethod: args.order.deliveryMethod,
        paymentState: args.order.hasVerifiedPayment ? "verified" : "pending",
        status: args.order.status,
      },
    };
  }

  if (args.stage === "paymentVerified") {
    return {
      ...common,
      eventKey: `online-order:${args.order._id}:payment-verified`,
      kind: "milestone" as const,
      step: "payment_verified",
      status: "succeeded" as const,
      message: `Payment was verified for order ${args.order.orderNumber}`,
      details: {
        amount: args.amount,
        method: args.paymentMethod,
        verification: "verified",
      },
    };
  }

  if (args.stage === "paymentCollected") {
    return {
      ...common,
      eventKey: `online-order:${args.order._id}:payment-collected`,
      kind: "milestone" as const,
      step: "payment_collected",
      status: "succeeded" as const,
      message: `Payment was collected for order ${args.order.orderNumber}`,
      details: {
        amount: args.amount,
        collectedInStore: args.order.deliveryMethod === "pickup",
        method: args.paymentMethod,
      },
    };
  }

  const nextStatus = args.nextStatus ?? args.order.status;

  return {
    ...common,
    eventKey: `online-order:${args.order._id}:status:${nextStatus}`,
    kind: "milestone" as const,
    step: statusStep(nextStatus),
    status:
      nextStatus === "cancelled"
        ? ("failed" as const)
        : nextStatus === "out-for-delivery"
          ? ("info" as const)
          : ("succeeded" as const),
    message: statusMessage(args),
    details: {
      nextStatus,
      previousStatus: args.previousStatus ?? null,
    },
  };
}

function returnExchangeStep(stage: OnlineOrderReturnExchangeTraceStage) {
  switch (stage) {
    case "approvalRequired":
      return "return_exchange_approval_required";
    case "balanceCollected":
      return "exchange_balance_collected";
    case "exchangeProcessed":
      return "exchange_processed";
    case "refundFinalized":
      return "refund_finalized";
    case "refundReleased":
      return "refund_reservation_released";
    case "refundReserved":
      return "refund_reserved";
    case "replacementIssued":
      return "replacement_issued";
    case "restocked":
      return "returned_items_restocked";
    case "returnProcessed":
      return "return_processed";
  }
}

function returnExchangeMessage(args: OnlineOrderReturnExchangeTraceRecordArgs) {
  switch (args.stage) {
    case "approvalRequired":
      return `Return or exchange for order ${args.order.orderNumber} requires approval`;
    case "balanceCollected":
      return `Exchange balance was collected for order ${args.order.orderNumber}`;
    case "exchangeProcessed":
      return `Exchange was recorded for order ${args.order.orderNumber}`;
    case "refundFinalized":
      return `Refund was finalized for order ${args.order.orderNumber}`;
    case "refundReleased":
      return `Refund reservation was released for order ${args.order.orderNumber}`;
    case "refundReserved":
      return `Refund was reserved for order ${args.order.orderNumber}`;
    case "replacementIssued":
      return `Replacement item was issued for order ${args.order.orderNumber}`;
    case "restocked":
      return `Returned item was restocked for order ${args.order.orderNumber}`;
    case "returnProcessed":
      return `Return was recorded for order ${args.order.orderNumber}`;
  }
}

function buildReturnExchangeTraceRecord(traceSeed: OrderReturnExchangeTraceSeed) {
  return traceSeed.trace;
}

function buildReturnExchangeTraceEvent(
  args: OnlineOrderReturnExchangeTraceRecordArgs & {
    traceSeed: OrderReturnExchangeTraceSeed;
  },
) {
  const occurredAt = args.occurredAt ?? Date.now();
  const step = returnExchangeStep(args.stage);
  const safeRefundRef = buildSafeExternalReferenceRef(args.refundId);
  const eventRef =
    args.eventRef ??
    safeRefundRef ??
    args.reservationId ??
    args.paymentAllocationId ??
    args.approvalRequestId ??
    args.inventoryMovementIds?.[0] ??
    args.operationRef;

  return {
    storeId: args.traceSeed.trace.storeId,
    traceId: args.traceSeed.trace.traceId,
    workflowType: args.traceSeed.trace.workflowType,
    occurredAt,
    eventKey: `online-order-return-exchange:${args.operationRef}:${step}:${eventRef}`,
    kind: "milestone" as const,
    step,
    status:
      args.stage === "approvalRequired"
        ? ("blocked" as const)
        : args.stage === "refundReleased"
          ? ("info" as const)
          : ("succeeded" as const),
    message: returnExchangeMessage(args),
    source: args.traceSeed.eventSource,
    subjectRefs: {
      ...args.traceSeed.subjectRefs,
      ...(args.approvalRequestId
        ? { approvalRequestId: String(args.approvalRequestId) }
        : {}),
      ...(args.inventoryMovementIds?.length
        ? { inventoryMovementIds: args.inventoryMovementIds.map(String).join(",") }
        : {}),
      ...(args.paymentAllocationId
        ? { paymentAllocationId: String(args.paymentAllocationId) }
        : {}),
      ...(safeRefundRef ? { safeRefundRef } : {}),
      ...(args.reservationId ? { refundReservationId: args.reservationId } : {}),
    },
    actorRefs: buildActorRefs(args),
    details: compactDetails({
      amount: args.amount,
      itemCount: args.itemCount,
      replacementCount: args.replacementCount,
      stage: args.stage,
    }),
  };
}

async function safeTraceWrite(label: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    console.error(`[workflow-trace] ${label}`, error);
  }
}

export async function recordOnlineOrderTraceBestEffort(
  ctx: MutationCtx,
  args: OnlineOrderTraceRecordArgs,
) {
  if (
    args.stage === "statusChanged" &&
    (!args.nextStatus || !ONLINE_ORDER_TRACEABLE_STATUSES.has(args.nextStatus))
  ) {
    return null;
  }

  const organizationId =
    args.organizationId ?? (await resolveStoreOrganizationId(ctx, args.order.storeId));
  const traceSeed = buildOnlineOrderTraceSeed({
    order: args.order,
    organizationId,
  });
  const traceRecord = buildTraceRecord(traceSeed);
  const traceEvent = buildTraceEvent({ ...args, traceSeed });
  let traceCreated = false;

  await safeTraceWrite("online.order.trace.create", async () => {
    await createWorkflowTraceWithCtx(ctx, traceRecord);
    traceCreated = true;
  });

  await safeTraceWrite("online.order.trace.lookup", async () => {
    await Promise.all(
      traceSeed.lookups.map((lookup) =>
        registerWorkflowTraceLookupWithCtx(ctx, lookup),
      ),
    );
  });

  await safeTraceWrite("online.order.trace.event", async () => {
    await appendWorkflowTraceEventWithCtx(ctx, traceEvent);
  });

  return {
    traceCreated,
    traceId: traceSeed.trace.traceId,
  };
}

export async function recordOnlineOrderReturnExchangeTraceBestEffort(
  ctx: MutationCtx,
  args: OnlineOrderReturnExchangeTraceRecordArgs,
) {
  try {
    const organizationId =
      args.organizationId ??
      (await resolveStoreOrganizationId(ctx, args.order.storeId));
    const traceSeed = buildOrderReturnExchangeTraceSeed({
      operationRef: args.operationRef,
      order: args.order,
      organizationId,
      startedAt: args.occurredAt,
    });
    const traceRecord = buildReturnExchangeTraceRecord(traceSeed);
    const traceEvent = buildReturnExchangeTraceEvent({ ...args, traceSeed });
    let traceCreated = false;

    await safeTraceWrite("online.order.return_exchange.trace.create", async () => {
      await createWorkflowTraceWithCtx(ctx, traceRecord);
      traceCreated = true;
    });

    await safeTraceWrite("online.order.return_exchange.trace.lookup", async () => {
      await Promise.all(
        traceSeed.lookups.map((lookup) =>
          registerWorkflowTraceLookupWithCtx(ctx, lookup),
        ),
      );
      if (args.stage === "refundFinalized" && args.refundId) {
        const safeRefundLookupRef = buildSafeExternalReferenceRef(args.refundId);
        if (!safeRefundLookupRef) return;

        await registerWorkflowTraceLookupWithCtx(ctx, {
          storeId: traceSeed.trace.storeId,
          workflowType: traceSeed.trace.workflowType,
          lookupType: ORDER_RETURN_EXCHANGE_LOOKUP_TYPES.subflowRef,
          lookupValue: `${args.order._id}:${safeRefundLookupRef}`,
          traceId: traceSeed.trace.traceId,
        });
      }
    });

    await safeTraceWrite("online.order.return_exchange.trace.event", async () => {
      await appendWorkflowTraceEventWithCtx(ctx, traceEvent);
    });

    return {
      traceCreated,
      traceId: traceSeed.trace.traceId,
    };
  } catch (error) {
    console.error("[workflow-trace] online.order.return_exchange.trace", error);
    return null;
  }
}
