import { internal } from "../_generated/api";
import { mutation, query, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { createOperationalWorkItemWithCtx } from "../operations/operationalWorkItems";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { commandResultValidator } from "../lib/commandResultValidators";
import { requireStoreFullAdminAccess } from "./access";

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

function getOperationalWorkItemStatus(status: string) {
  if (["received", "cancelled"].includes(status)) {
    return "completed";
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

    return purchaseOrders.sort(
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

    const [lineItems, vendor] = await Promise.all([
      ctx.db
        .query("purchaseOrderLineItem")
        .withIndex("by_purchaseOrderId", (q) =>
          q.eq("purchaseOrderId", args.purchaseOrderId),
        )
        .take(MAX_LINE_ITEMS),
      ctx.db.get("vendor", purchaseOrder.vendorId),
    ]);

    return {
      ...purchaseOrder,
      lineItems,
      vendor,
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

  await Promise.all(
    args.lineItems.map(async (lineItem, index) => {
      const productSku = productSkus[index]!;
      await ctx.db.insert("purchaseOrderLineItem", {
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

  const { athenaUser } = await requireStoreFullAdminAccess(
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

  const updates: Record<string, unknown> = {
    notes: trimOptional(args.notes) ?? purchaseOrder.notes,
    status: args.nextStatus,
  };

  if (args.nextStatus === "submitted") {
    updates.submittedAt = Date.now();
  }

  if (args.nextStatus === "approved") {
    updates.approvedAt = Date.now();
  }

  if (args.nextStatus === "ordered") {
    updates.orderedAt = Date.now();
  }

  if (args.nextStatus === "received") {
    updates.receivedAt = Date.now();
  }

  if (args.nextStatus === "cancelled") {
    updates.cancelledAt = Date.now();
  }

  await ctx.db.patch("purchaseOrder", args.purchaseOrderId, updates);

  if (purchaseOrder.operationalWorkItemId) {
    await ctx.runMutation(
      internal.operations.operationalWorkItems.updateOperationalWorkItemStatus,
      {
        status: getOperationalWorkItemStatus(args.nextStatus),
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
      previousStatus: purchaseOrder.status,
    },
    organizationId: purchaseOrder.organizationId,
    storeId: purchaseOrder.storeId,
    subjectId: purchaseOrder._id,
    subjectLabel: purchaseOrder.poNumber,
    subjectType: "purchase_order",
    workItemId: purchaseOrder.operationalWorkItemId,
  });

  return ctx.db.get("purchaseOrder", args.purchaseOrderId);
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
