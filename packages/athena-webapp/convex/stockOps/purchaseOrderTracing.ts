import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  appendWorkflowTraceEventWithCtx,
  createWorkflowTraceWithCtx,
  registerWorkflowTraceLookupWithCtx,
} from "../workflowTraces/core";
import {
  buildPurchaseOrderReceivingLookup,
  buildPurchaseOrderTraceSeed,
  PURCHASE_ORDER_WORKFLOW_TYPE,
} from "../workflowTraces/adapters/purchaseOrder";

type PurchaseOrderTraceDoc = {
  _id: Id<"purchaseOrder">;
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  vendorId?: Id<"vendor">;
  poNumber: string;
  status: string;
  createdAt?: number;
  receivedAt?: number;
  cancelledAt?: number;
  operationalWorkItemId?: Id<"operationalWorkItem">;
};

type ReceivingTraceLineItem = {
  purchaseOrderLineItemId: Id<"purchaseOrderLineItem"> | string;
  productSkuId: Id<"productSku"> | string;
  productId?: Id<"product"> | string;
  receivedQuantity: number;
};

type ReceivingTraceMovement = {
  inventoryMovementId?: Id<"inventoryMovement"> | string;
  productSkuId?: Id<"productSku"> | string;
  sourceId?: string;
  sourceType?: string;
};

function refsFromEntries(entries: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(entries)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => [key, String(value)]),
  );
}

function compactDetails(entries: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(entries).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );
}

function getPurchaseOrderTraceStatusAt(
  purchaseOrder: PurchaseOrderTraceDoc,
  occurredAt: number,
) {
  if (purchaseOrder.status === "received") {
    return purchaseOrder.receivedAt ?? occurredAt;
  }

  if (purchaseOrder.status === "cancelled") {
    return purchaseOrder.cancelledAt ?? occurredAt;
  }

  return undefined;
}

async function ensurePurchaseOrderTraceWithCtx(
  ctx: MutationCtx,
  args: {
    purchaseOrder: PurchaseOrderTraceDoc;
    occurredAt: number;
    vendorName?: string;
  },
) {
  const seed = buildPurchaseOrderTraceSeed({
    storeId: args.purchaseOrder.storeId,
    organizationId: args.purchaseOrder.organizationId,
    purchaseOrderId: args.purchaseOrder._id,
    poNumber: args.purchaseOrder.poNumber,
    vendorId: args.purchaseOrder.vendorId,
    vendorName: args.vendorName,
    operationalWorkItemId: args.purchaseOrder.operationalWorkItemId,
    status: args.purchaseOrder.status,
    startedAt: args.purchaseOrder.createdAt ?? args.occurredAt,
    completedAt: getPurchaseOrderTraceStatusAt(
      args.purchaseOrder,
      args.occurredAt,
    ),
  });

  await createWorkflowTraceWithCtx(ctx, seed.trace);
  await Promise.all(
    seed.lookups.map((lookup) =>
      registerWorkflowTraceLookupWithCtx(ctx, lookup),
    ),
  );

  return seed;
}

export async function bestEffortRecordPurchaseOrderStatusTraceWithCtx(
  ctx: MutationCtx,
  args: {
    purchaseOrder: PurchaseOrderTraceDoc;
    previousStatus?: string;
    nextStatus: string;
    occurredAt: number;
    actorUserId?: Id<"athenaUser">;
    vendorName?: string;
  },
) {
  try {
    const seed = await ensurePurchaseOrderTraceWithCtx(ctx, {
      occurredAt: args.occurredAt,
      purchaseOrder: {
        ...args.purchaseOrder,
        status: args.nextStatus,
      },
      vendorName: args.vendorName,
    });

    await appendWorkflowTraceEventWithCtx(ctx, {
      storeId: args.purchaseOrder.storeId,
      traceId: seed.trace.traceId,
      workflowType: PURCHASE_ORDER_WORKFLOW_TYPE,
      eventKey: `purchase_order_status:${args.purchaseOrder._id}:${args.nextStatus}`,
      kind: "milestone",
      step: "purchase_order_status",
      status: args.nextStatus === "cancelled" ? "blocked" : "succeeded",
      message: `Purchase order ${args.purchaseOrder.poNumber} moved to ${args.nextStatus.replaceAll(
        "_",
        " ",
      )}.`,
      occurredAt: args.occurredAt,
      details: compactDetails({
        nextStatus: args.nextStatus,
        previousStatus: args.previousStatus,
      }),
      source: seed.eventSource,
      subjectRefs: seed.subjectRefs,
      actorRefs: args.actorUserId
        ? { actorUserId: String(args.actorUserId) }
        : undefined,
    });
  } catch {
    // Workflow traces are evidence only; purchase-order commands remain authoritative.
  }
}

export async function bestEffortRecordPurchaseOrderReceivingTraceWithCtx(
  ctx: MutationCtx,
  args: {
    purchaseOrder: PurchaseOrderTraceDoc;
    receivingBatchId: Id<"receivingBatch"> | string;
    submissionKey: string;
    receivedByUserId?: Id<"athenaUser">;
    occurredAt: number;
    lineItems: ReceivingTraceLineItem[];
    inventoryMovements: ReceivingTraceMovement[];
    sourceId: string;
    nextStatus: string;
  },
) {
  try {
    const seed = await ensurePurchaseOrderTraceWithCtx(ctx, {
      occurredAt: args.occurredAt,
      purchaseOrder: {
        ...args.purchaseOrder,
        receivedAt:
          args.nextStatus === "received"
            ? args.purchaseOrder.receivedAt ?? args.occurredAt
            : args.purchaseOrder.receivedAt,
        status: args.nextStatus,
      },
    });

    await registerWorkflowTraceLookupWithCtx(
      ctx,
      buildPurchaseOrderReceivingLookup({
        storeId: args.purchaseOrder.storeId,
        submissionKey: args.submissionKey,
        traceId: seed.trace.traceId,
      }),
    );

    await appendWorkflowTraceEventWithCtx(ctx, {
      storeId: args.purchaseOrder.storeId,
      traceId: seed.trace.traceId,
      workflowType: PURCHASE_ORDER_WORKFLOW_TYPE,
      eventKey: `purchase_order_receiving:${args.purchaseOrder._id}:${args.submissionKey}`,
      kind: "milestone",
      step: "purchase_order_receiving",
      status: "succeeded",
      message: `Received stock for purchase order ${args.purchaseOrder.poNumber}.`,
      occurredAt: args.occurredAt,
      details: {
        inventoryMovementRefs: args.inventoryMovements.map((movement) =>
          refsFromEntries({
            inventoryMovementId: movement.inventoryMovementId,
            productSkuId: movement.productSkuId,
            sourceId: movement.sourceId,
            sourceType: movement.sourceType,
          }),
        ),
        lineRefs: args.lineItems.map((lineItem) =>
          refsFromEntries({
            productId: lineItem.productId,
            productSkuId: lineItem.productSkuId,
            purchaseOrderLineItemId: lineItem.purchaseOrderLineItemId,
            receivedQuantity: lineItem.receivedQuantity,
          }),
        ),
        nextStatus: args.nextStatus,
        receivingBatchId: String(args.receivingBatchId),
        sourceId: args.sourceId,
        submissionKey: args.submissionKey,
        workItemRefs: args.purchaseOrder.operationalWorkItemId
          ? [
              {
                operationalWorkItemId: String(
                  args.purchaseOrder.operationalWorkItemId,
                ),
              },
            ]
          : [],
      },
      source: seed.eventSource,
      subjectRefs: {
        ...seed.subjectRefs,
        receivingBatchId: String(args.receivingBatchId),
        submissionKey: args.submissionKey,
      },
      actorRefs: args.receivedByUserId
        ? { receivedByUserId: String(args.receivedByUserId) }
        : undefined,
    });
  } catch {
    // Workflow traces are evidence only; receiving and inventory movement writes remain authoritative.
  }
}
