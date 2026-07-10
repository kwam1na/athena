import { internal } from "../_generated/api";
import { mutation, query, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { createOperationalWorkItemWithCtx } from "../operations/operationalWorkItems";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { commandResultValidator } from "../lib/commandResultValidators";
import { requireStoreFullAdminAccess } from "./access";
import { bestEffortRecordPurchaseOrderStatusTraceWithCtx } from "./purchaseOrderTracing";
import { getWorkflowTraceByLookupWithCtx } from "../workflowTraces/core";
import { appendReportingIngressWithCtx } from "../reporting/ingress";
import { canonicalReportingBusinessEventKey } from "../reporting/factIdentity";
import {
  PURCHASE_ORDER_ID_LOOKUP_TYPE,
  PURCHASE_ORDER_WORKFLOW_TYPE,
} from "../workflowTraces/adapters/purchaseOrder";

const MAX_LINE_ITEMS = 200;
const MAX_PURCHASE_ORDERS = 200;

const PURCHASE_ORDER_TRANSITIONS = {
  approved: new Set(["ordered", "cancelled"]),
  cancelled: new Set<string>(),
  draft: new Set(["submitted", "cancelled"]),
  ordered: new Set(["cancelled"]),
  partially_received: new Set(["cancelled"]),
  received: new Set<string>(),
  submitted: new Set(["approved", "cancelled"]),
} as const;

const purchaseOrderStatusValidator = v.union(
  v.literal("draft"),
  v.literal("submitted"),
  v.literal("approved"),
  v.literal("ordered"),
  v.literal("partially_received"),
  v.literal("received"),
  v.literal("cancelled"),
);

const createPurchaseOrderArgs = {
  storeId: v.id("store"),
  vendorId: v.id("vendor"),
  currency: v.optional(v.string()),
  expectedAt: v.optional(v.number()),
  notes: v.optional(v.string()),
  createdByUserId: v.optional(v.id("athenaUser")),
  lineItems: v.array(
    v.object({
      productSkuId: v.id("productSku"),
      orderedQuantity: v.number(),
      unitCost: v.number(),
      description: v.optional(v.string()),
    }),
  ),
};

const updatePurchaseOrderStatusArgs = {
  purchaseOrderId: v.id("purchaseOrder"),
  nextStatus: purchaseOrderStatusValidator,
  actorUserId: v.optional(v.id("athenaUser")),
  notes: v.optional(v.string()),
};

const advancePurchaseOrderToOrderedArgs = {
  purchaseOrderId: v.id("purchaseOrder"),
  actorUserId: v.optional(v.id("athenaUser")),
  notes: v.optional(v.string()),
};

type PurchaseOrderStatus = keyof typeof PURCHASE_ORDER_TRANSITIONS;

type CreatePurchaseOrderArgs = {
  storeId: Id<"store">;
  vendorId: Id<"vendor">;
  currency?: string;
  expectedAt?: number;
  notes?: string;
  createdByUserId?: Id<"athenaUser">;
  lineItems: Array<{
    productSkuId: Id<"productSku">;
    orderedQuantity: number;
    unitCost: number;
    description?: string;
  }>;
};

type UpdatePurchaseOrderStatusArgs = {
  purchaseOrderId: Id<"purchaseOrder">;
  nextStatus: PurchaseOrderStatus;
  actorUserId?: Id<"athenaUser">;
  notes?: string;
};

type AdvancePurchaseOrderToOrderedArgs = {
  purchaseOrderId: Id<"purchaseOrder">;
  actorUserId?: Id<"athenaUser">;
  notes?: string;
};

export function buildPurchaseOrderCommitmentStatusDelta(args: {
  closesCommitment: boolean;
  orderedQuantity: number;
  receivedQuantity: number;
  unitCost: number;
}) {
  const remainingQuantity = Math.max(
    0,
    args.orderedQuantity - args.receivedQuantity,
  );
  return {
    amountMinor: args.closesCommitment
      ? -(remainingQuantity * args.unitCost)
      : 0,
    quantity: args.closesCommitment ? -remainingQuantity : 0,
    remainingQuantity,
  };
}

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

export function calculatePurchaseOrderTotals(
  lineItems: Array<{ orderedQuantity: number; unitCost: number }>,
) {
  return lineItems.reduce(
    (summary, lineItem) => {
      if (lineItem.orderedQuantity <= 0) {
        throw new Error("Purchase-order quantities must be greater than zero.");
      }

      if (lineItem.unitCost < 0) {
        throw new Error("Purchase-order unit cost cannot be negative.");
      }

      const lineTotal = lineItem.orderedQuantity * lineItem.unitCost;

      return {
        lineItemCount: summary.lineItemCount + 1,
        subtotalAmount: summary.subtotalAmount + lineTotal,
        totalAmount: summary.totalAmount + lineTotal,
        totalUnits: summary.totalUnits + lineItem.orderedQuantity,
      };
    },
    {
      lineItemCount: 0,
      subtotalAmount: 0,
      totalAmount: 0,
      totalUnits: 0,
    },
  );
}

export function assertValidPurchaseOrderStatusTransition(
  currentStatus: PurchaseOrderStatus,
  nextStatus: PurchaseOrderStatus,
) {
  if (currentStatus === nextStatus) {
    return;
  }

  if (!PURCHASE_ORDER_TRANSITIONS[currentStatus].has(nextStatus)) {
    throw new Error(
      `Cannot change purchase order from ${currentStatus} to ${nextStatus}.`,
    );
  }
}

function buildPurchaseOrderNumber() {
  return `PO-${Date.now().toString(36).toUpperCase()}`;
}

export function mapPurchaseOrderStatusToWorkItemStatus(status: string) {
  if (status === "received") {
    return "completed";
  }

  if (status === "cancelled") {
    return "cancelled";
  }

  if (
    ["submitted", "approved", "ordered", "partially_received"].includes(status)
  ) {
    return "in_progress";
  }

  return "open";
}

export function mapPurchaseOrderCommandError(
  error: unknown,
): CommandResult<never> | null {
  const message = error instanceof Error ? error.message : "";

  if (
    message === "Store not found." ||
    message === "Vendor not found for this store." ||
    message === "Purchase order not found." ||
    /^Selected SKU at line \d+ could not be found for this store\.$/.test(
      message,
    )
  ) {
    return userError({
      code: "not_found",
      message,
    });
  }

  if (
    message === "Purchase orders require at least one line item." ||
    message === "Purchase-order quantities must be greater than zero." ||
    message === "Purchase-order unit cost cannot be negative."
  ) {
    return userError({
      code: "validation_failed",
      message,
    });
  }

  if (
    /^Cannot change purchase order from (cancelled|received) to [a-z_]+\.$/.test(
      message,
    )
  ) {
    return userError({
      code: "precondition_failed",
      message,
    });
  }

  if (
    /^Cannot change purchase order from [a-z_]+ to [a-z_]+\.$/.test(message)
  ) {
    return userError({
      code: "validation_failed",
      message,
    });
  }

  return null;
}

export const listPurchaseOrders = query({
  args: {
    storeId: v.id("store"),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("submitted"),
        v.literal("approved"),
        v.literal("ordered"),
        v.literal("partially_received"),
        v.literal("received"),
        v.literal("cancelled"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await requireStoreFullAdminAccess(ctx, args.storeId);

    const purchaseOrders = args.status
      ? await ctx.db
          .query("purchaseOrder")
          .withIndex("by_storeId_status", (q) =>
            q.eq("storeId", args.storeId).eq("status", args.status!),
          )
          .take(MAX_PURCHASE_ORDERS)
      : await ctx.db
          .query("purchaseOrder")
          .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
          .take(MAX_PURCHASE_ORDERS);

    const purchaseOrdersWithTraceIds = await Promise.all(
      purchaseOrders.map(async (purchaseOrder) => {
        const trace = await getWorkflowTraceByLookupWithCtx(ctx, {
          storeId: purchaseOrder.storeId,
          workflowType: PURCHASE_ORDER_WORKFLOW_TYPE,
          lookupType: PURCHASE_ORDER_ID_LOOKUP_TYPE,
          lookupValue: purchaseOrder._id,
        });

        return {
          ...purchaseOrder,
          workflowTraceId: trace?.traceId,
        };
      }),
    );

    return purchaseOrdersWithTraceIds.sort(
      (left, right) => right.createdAt - left.createdAt,
    );
  },
});

export const getPurchaseOrder = query({
  args: {
    purchaseOrderId: v.id("purchaseOrder"),
  },
  handler: async (ctx, args) => {
    const purchaseOrder = await ctx.db.get(
      "purchaseOrder",
      args.purchaseOrderId,
    );
    if (!purchaseOrder) {
      return null;
    }

    await requireStoreFullAdminAccess(ctx, purchaseOrder.storeId);

    const [lineItems, vendor, trace] = await Promise.all([
      ctx.db
        .query("purchaseOrderLineItem")
        .withIndex("by_purchaseOrderId", (q) =>
          q.eq("purchaseOrderId", args.purchaseOrderId),
        )
        .take(MAX_LINE_ITEMS),
      ctx.db.get("vendor", purchaseOrder.vendorId),
      getWorkflowTraceByLookupWithCtx(ctx, {
        storeId: purchaseOrder.storeId,
        workflowType: PURCHASE_ORDER_WORKFLOW_TYPE,
        lookupType: PURCHASE_ORDER_ID_LOOKUP_TYPE,
        lookupValue: purchaseOrder._id,
      }),
    ]);

    return {
      ...purchaseOrder,
      lineItems,
      vendor,
      workflowTraceId: trace?.traceId,
    };
  },
});

export async function createPurchaseOrderWithCtx(
  ctx: MutationCtx,
  args: CreatePurchaseOrderArgs,
) {
  if (args.lineItems.length === 0) {
    throw new Error("Purchase orders require at least one line item.");
  }

  const [{ athenaUser, store }, vendor] = await Promise.all([
    requireStoreFullAdminAccess(ctx, args.storeId),
    ctx.db.get("vendor", args.vendorId),
  ]);

  if (!vendor || vendor.storeId !== args.storeId) {
    throw new Error("Vendor not found for this store.");
  }

  const productSkus = await Promise.all(
    args.lineItems.map((lineItem) =>
      ctx.db.get("productSku", lineItem.productSkuId),
    ),
  );

  productSkus.forEach((productSku, index) => {
    if (!productSku || productSku.storeId !== args.storeId) {
      throw new Error(
        `Selected SKU at line ${index + 1} could not be found for this store.`,
      );
    }
  });

  const totals = calculatePurchaseOrderTotals(args.lineItems);
  const createdAt = Date.now();
  const poNumber = buildPurchaseOrderNumber();

  const purchaseOrderId = await ctx.db.insert("purchaseOrder", {
    storeId: args.storeId,
    organizationId: store.organizationId,
    vendorId: args.vendorId,
    poNumber,
    status: "draft",
    lineItemCount: totals.lineItemCount,
    totalUnits: totals.totalUnits,
    subtotalAmount: totals.subtotalAmount,
    totalAmount: totals.totalAmount,
    currency: trimOptional(args.currency),
    expectedAt: args.expectedAt,
    notes: trimOptional(args.notes),
    createdByUserId: athenaUser._id,
    createdAt,
  });

  const purchaseOrderLineItemIds = await Promise.all(
    args.lineItems.map(async (lineItem, index) => {
      const productSku = productSkus[index]!;
      return ctx.db.insert("purchaseOrderLineItem", {
        purchaseOrderId,
        storeId: args.storeId,
        productId: productSku.productId,
        productSkuId: lineItem.productSkuId,
        description:
          trimOptional(lineItem.description) ?? productSku.productName,
        orderedQuantity: lineItem.orderedQuantity,
        receivedQuantity: 0,
        unitCost: lineItem.unitCost,
        lineTotal: lineItem.orderedQuantity * lineItem.unitCost,
        createdAt,
      });
    }),
  );

  const currency = trimOptional(args.currency)?.toUpperCase();
  await Promise.all(
    args.lineItems.map((lineItem, index) => {
      const lineItemId = purchaseOrderLineItemIds[index]!;
      const lineTotal = lineItem.orderedQuantity * lineItem.unitCost;
      return appendReportingIngressWithCtx(ctx, {
        acceptedAt: createdAt,
        adapterVersion: 1,
        businessEventKey: canonicalReportingBusinessEventKey({
          kind: "purchase_commitment",
          lineId: String(lineItemId),
          purchaseOrderId: String(purchaseOrderId),
        }),
        ...(currency
          ? {
              currencyCode: currency,
              currencyMinorUnitScale: 2,
              grossAmountMinor: lineTotal,
              netAmountMinor: lineTotal,
            }
          : {}),
        contentFingerprint: `po-line:v1:${lineItemId}:${lineItem.productSkuId}:${lineItem.orderedQuantity}:${lineItem.unitCost}:${currency ?? "unknown"}:${args.expectedAt ?? "none"}`,
        factContractVersion: 1,
        lines: [
          {
            costStatus: "not_applicable",
            discountAmountMinor: 0,
            grossAmountMinor: lineTotal,
            lineKey: String(lineItemId),
            lineKind: "merchandise",
            netAmountMinor: lineTotal,
            productSkuId: lineItem.productSkuId,
            expectedInboundAt: args.expectedAt,
            commitmentConfirmed: false,
            procurementSignal: "commitment",
            quantity: lineItem.orderedQuantity,
          },
        ],
        materialFields: [
          "currencyCode",
          "grossAmountMinor",
          "quantity",
          "sourceDomain",
          "storeId",
        ],
        occurredAt: createdAt,
        organizationId: store.organizationId,
        quantity: lineItem.orderedQuantity,
        sourceDomain: "procurement",
        sourceEventType: "purchase_order_line_created",
        sourceReferences: [
          {
            relation: "owns",
            sourceId: String(lineItemId),
            sourceType: "purchase_order_line",
          },
          {
            relation: "owns",
            sourceId: String(purchaseOrderId),
            sourceType: "purchase_order",
          },
        ],
        storeId: args.storeId,
      });
    }),
  );

  const workItem = await createOperationalWorkItemWithCtx(ctx, {
    createdByUserId: athenaUser._id,
    metadata: {
      lineItemCount: totals.lineItemCount,
      purchaseOrderId,
      status: "draft",
      totalAmount: totals.totalAmount,
      totalUnits: totals.totalUnits,
      vendorId: vendor._id,
      vendorName: vendor.name,
    },
    notes: trimOptional(args.notes),
    organizationId: store.organizationId,
    priority: "normal",
    status: "open",
    storeId: args.storeId,
    title: poNumber,
    type: "purchase_order",
  });

  if (workItem) {
    await ctx.db.patch("purchaseOrder", purchaseOrderId, {
      operationalWorkItemId: workItem._id,
    });
  }

  await recordOperationalEventWithCtx(ctx, {
    actorUserId: athenaUser._id,
    eventType: "purchase_order_created",
    metadata: {
      lineItemCount: totals.lineItemCount,
      totalAmount: totals.totalAmount,
      totalUnits: totals.totalUnits,
      vendorId: vendor._id,
      vendorName: vendor.name,
    },
    organizationId: store.organizationId,
    storeId: args.storeId,
    subjectId: purchaseOrderId,
    subjectLabel: poNumber,
    subjectType: "purchase_order",
    workItemId: workItem?._id,
  });

  const createdPurchaseOrder = await ctx.db.get("purchaseOrder", purchaseOrderId);
  if (createdPurchaseOrder) {
    await bestEffortRecordPurchaseOrderStatusTraceWithCtx(ctx, {
      actorUserId: athenaUser._id,
      nextStatus: "draft",
      occurredAt: createdAt,
      purchaseOrder: createdPurchaseOrder,
      vendorName: vendor.name,
    });
  }

  return ctx.db.get("purchaseOrder", purchaseOrderId);
}

export async function createPurchaseOrderCommandWithCtx(
  ctx: MutationCtx,
  args: CreatePurchaseOrderArgs,
): Promise<CommandResult<any>> {
  try {
    return ok(await createPurchaseOrderWithCtx(ctx, args));
  } catch (error) {
    const result = mapPurchaseOrderCommandError(error);

    if (result) {
      return result;
    }

    throw error;
  }
}

export const createPurchaseOrder = mutation({
  args: createPurchaseOrderArgs,
  handler: createPurchaseOrderWithCtx,
});

export const createPurchaseOrderCommand = mutation({
  args: createPurchaseOrderArgs,
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) => createPurchaseOrderCommandWithCtx(ctx, args),
});

export async function updatePurchaseOrderStatusWithCtx(
  ctx: MutationCtx,
  args: UpdatePurchaseOrderStatusArgs,
) {
  const purchaseOrder = await ctx.db.get("purchaseOrder", args.purchaseOrderId);
  if (!purchaseOrder) {
    throw new Error("Purchase order not found.");
  }

  const { athenaUser, store } = await requireStoreFullAdminAccess(
    ctx,
    purchaseOrder.storeId,
  );

  assertValidPurchaseOrderStatusTransition(
    purchaseOrder.status,
    args.nextStatus,
  );

  if (purchaseOrder.status === args.nextStatus) {
    return purchaseOrder;
  }

  const previousStatus = purchaseOrder.status;
  const statusChangedAt = Date.now();
  const lineItems = await ctx.db
    .query("purchaseOrderLineItem")
    .withIndex("by_purchaseOrderId", (q) =>
      q.eq("purchaseOrderId", purchaseOrder._id),
    )
    .take(MAX_LINE_ITEMS);
  const updates: Record<string, unknown> = {
    notes: trimOptional(args.notes) ?? purchaseOrder.notes,
    status: args.nextStatus,
  };

  if (args.nextStatus === "submitted") {
    updates.submittedAt = statusChangedAt;
  }

  if (args.nextStatus === "approved") {
    updates.approvedAt = statusChangedAt;
  }

  if (args.nextStatus === "ordered") {
    updates.orderedAt = statusChangedAt;
  }

  if (args.nextStatus === "received") {
    updates.receivedAt = statusChangedAt;
  }

  if (args.nextStatus === "cancelled") {
    updates.cancelledAt = statusChangedAt;
  }

  await ctx.db.patch("purchaseOrder", args.purchaseOrderId, updates);

  const closesCommitment =
    args.nextStatus === "cancelled" || args.nextStatus === "received";
  const currencyCode = purchaseOrder.currency?.trim().toUpperCase();
  await Promise.all(
    lineItems.map((lineItem) => {
      const commitmentDelta = buildPurchaseOrderCommitmentStatusDelta({
        closesCommitment,
        orderedQuantity: lineItem.orderedQuantity,
        receivedQuantity: lineItem.receivedQuantity,
        unitCost: lineItem.unitCost,
      });
      const quantity = commitmentDelta.quantity;
      const amount = commitmentDelta.amountMinor;
      return appendReportingIngressWithCtx(ctx, {
        acceptedAt: statusChangedAt,
        adapterVersion: 1,
        businessEventKey: canonicalReportingBusinessEventKey({
          kind: "purchase_commitment_transition",
          lineId: String(lineItem._id),
          purchaseOrderId: String(purchaseOrder._id),
          status: args.nextStatus,
        }),
        ...(currencyCode
          ? {
              currencyCode,
              currencyMinorUnitScale: 2,
              grossAmountMinor: amount,
              netAmountMinor: amount,
            }
          : {}),
        contentFingerprint: `po-line-status:v1:${lineItem._id}:${previousStatus}:${args.nextStatus}:${lineItem.orderedQuantity}:${lineItem.receivedQuantity}:${lineItem.unitCost}:${purchaseOrder.expectedAt ?? "none"}`,
        factContractVersion: 1,
        lines: [
          {
            costStatus: "not_applicable",
            discountAmountMinor: 0,
            grossAmountMinor: amount,
            lineKey: String(lineItem._id),
            lineKind: "merchandise",
            netAmountMinor: amount,
            productSkuId: lineItem.productSkuId,
            expectedInboundAt: purchaseOrder.expectedAt,
            commitmentConfirmed: ["approved", "ordered", "partially_received", "received"].includes(
              args.nextStatus,
            ),
            procurementSignal:
              args.nextStatus === "received" &&
              lineItem.receivedQuantity < lineItem.orderedQuantity
                ? "short_receipt"
                : "commitment",
            quantity,
          },
        ],
        materialFields: [
          "currencyCode",
          "grossAmountMinor",
          "quantity",
          "sourceDomain",
          "storeId",
        ],
        occurredAt: statusChangedAt,
        organizationId: store.organizationId,
        quantity,
        sourceDomain: "procurement",
        sourceEventType: closesCommitment
          ? "purchase_order_commitment_released"
          : "purchase_order_commitment_revision",
        sourceReferences: [
          {
            relation: closesCommitment ? "corrects" : "supports",
            sourceId: String(lineItem._id),
            sourceType: "purchase_order_line",
          },
          {
            relation: "owns",
            sourceId: String(purchaseOrder._id),
            sourceType: "purchase_order",
          },
        ],
        storeId: purchaseOrder.storeId,
      });
    }),
  );

  if (purchaseOrder.operationalWorkItemId) {
    await ctx.runMutation(
      internal.operations.operationalWorkItems.updateOperationalWorkItemStatus,
      {
        status: mapPurchaseOrderStatusToWorkItemStatus(args.nextStatus),
        workItemId: purchaseOrder.operationalWorkItemId,
      },
    );
  }

  await recordOperationalEventWithCtx(ctx, {
    actorUserId: athenaUser._id,
    eventType: `purchase_order_${args.nextStatus}`,
    message: `Purchase order ${purchaseOrder.poNumber} moved to ${args.nextStatus.replaceAll(
      "_",
      " ",
    )}.`,
    metadata: {
      nextStatus: args.nextStatus,
      previousStatus,
    },
    organizationId: purchaseOrder.organizationId,
    storeId: purchaseOrder.storeId,
    subjectId: purchaseOrder._id,
    subjectLabel: purchaseOrder.poNumber,
    subjectType: "purchase_order",
    workItemId: purchaseOrder.operationalWorkItemId,
  });

  const updatedPurchaseOrder = await ctx.db.get(
    "purchaseOrder",
    args.purchaseOrderId,
  );
  if (!updatedPurchaseOrder) {
    throw new Error("Purchase order not found.");
  }

  await bestEffortRecordPurchaseOrderStatusTraceWithCtx(ctx, {
    actorUserId: athenaUser._id,
    nextStatus: args.nextStatus,
    occurredAt: statusChangedAt,
    previousStatus,
    purchaseOrder: updatedPurchaseOrder,
  });

  return updatedPurchaseOrder;
}

export async function updatePurchaseOrderStatusCommandWithCtx(
  ctx: MutationCtx,
  args: UpdatePurchaseOrderStatusArgs,
): Promise<CommandResult<any>> {
  try {
    return ok(await updatePurchaseOrderStatusWithCtx(ctx, args));
  } catch (error) {
    const result = mapPurchaseOrderCommandError(error);

    if (result) {
      return result;
    }

    throw error;
  }
}

function getStatusesToOrdered(currentStatus: PurchaseOrderStatus) {
  switch (currentStatus) {
    case "draft":
      return ["submitted", "approved", "ordered"] as const;
    case "submitted":
      return ["approved", "ordered"] as const;
    case "approved":
      return ["ordered"] as const;
    case "ordered":
      return [] as const;
    default:
      assertValidPurchaseOrderStatusTransition(currentStatus, "ordered");
      return [] as const;
  }
}

export async function advancePurchaseOrderToOrderedWithCtx(
  ctx: MutationCtx,
  args: AdvancePurchaseOrderToOrderedArgs,
) {
  const purchaseOrder = await ctx.db.get("purchaseOrder", args.purchaseOrderId);
  if (!purchaseOrder) {
    throw new Error("Purchase order not found.");
  }

  const nextStatuses = getStatusesToOrdered(purchaseOrder.status);
  let currentPurchaseOrder = purchaseOrder;

  for (const nextStatus of nextStatuses) {
    currentPurchaseOrder = await updatePurchaseOrderStatusWithCtx(ctx, {
      actorUserId: args.actorUserId,
      nextStatus,
      notes: args.notes,
      purchaseOrderId: args.purchaseOrderId,
    });
  }

  return currentPurchaseOrder;
}

export async function advancePurchaseOrderToOrderedCommandWithCtx(
  ctx: MutationCtx,
  args: AdvancePurchaseOrderToOrderedArgs,
): Promise<CommandResult<any>> {
  try {
    return ok(await advancePurchaseOrderToOrderedWithCtx(ctx, args));
  } catch (error) {
    const result = mapPurchaseOrderCommandError(error);

    if (result) {
      return result;
    }

    throw error;
  }
}

export const updatePurchaseOrderStatus = mutation({
  args: updatePurchaseOrderStatusArgs,
  handler: updatePurchaseOrderStatusWithCtx,
});

export const updatePurchaseOrderStatusCommand = mutation({
  args: updatePurchaseOrderStatusArgs,
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) =>
    updatePurchaseOrderStatusCommandWithCtx(ctx, args),
});

export const advancePurchaseOrderToOrderedCommand = mutation({
  args: advancePurchaseOrderToOrderedArgs,
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) =>
    advancePurchaseOrderToOrderedCommandWithCtx(ctx, args),
});
