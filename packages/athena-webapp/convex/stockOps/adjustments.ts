import { mutation, query, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { buildApprovalRequest } from "../operations/approvalRequestHelpers";
import { recordInventoryMovementWithCtx } from "../operations/inventoryMovements";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import {
  createOperationalWorkItemWithCtx,
  updateOperationalWorkItemStatusWithCtx,
} from "../operations/operationalWorkItems";

export const STOCK_ADJUSTMENT_APPROVAL_THRESHOLD = 5;

export const MANUAL_STOCK_ADJUSTMENT_REASON_CODES = [
  "correction",
  "damage",
  "shrinkage",
  "vendor_return",
] as const;

export const CYCLE_COUNT_REASON_CODE = "cycle_count_reconciliation" as const;

type StockAdjustmentType = "manual" | "cycle_count";
type StockAdjustmentReasonCode =
  | (typeof MANUAL_STOCK_ADJUSTMENT_REASON_CODES)[number]
  | typeof CYCLE_COUNT_REASON_CODE;

type StockAdjustmentInputLineItem = {
  countedQuantity?: number;
  productSkuId: Id<"productSku">;
  quantityDelta?: number;
};

type NormalizedStockAdjustmentLineItem = {
  countedQuantity?: number;
  productId?: Id<"product">;
  productName?: string;
  productSkuId: Id<"productSku">;
  quantityDelta: number;
  sku?: string;
  systemQuantity: number;
};

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

export function calculateCycleCountQuantityDelta(args: {
  countedQuantity: number;
  systemQuantity: number;
}) {
  if (args.countedQuantity < 0) {
    throw new Error("Cycle-count quantities cannot be negative.");
  }

  return args.countedQuantity - args.systemQuantity;
}

export function assertDistinctStockAdjustmentLineItems(
  lineItems: Array<{ productSkuId: string }>
) {
  const seenProductSkuIds = new Set<string>();

  lineItems.forEach((lineItem) => {
    if (seenProductSkuIds.has(lineItem.productSkuId)) {
      throw new Error(
        "Stock adjustment batches cannot include the same SKU twice."
      );
    }

    seenProductSkuIds.add(lineItem.productSkuId);
  });
}

export function assertStockAdjustmentReasonCode(
  adjustmentType: StockAdjustmentType,
  reasonCode: string
) {
  if (
    adjustmentType === "manual" &&
    !MANUAL_STOCK_ADJUSTMENT_REASON_CODES.includes(
      reasonCode as (typeof MANUAL_STOCK_ADJUSTMENT_REASON_CODES)[number]
    )
  ) {
    throw new Error("Manual stock adjustments require a supported reason code.");
  }

  if (adjustmentType === "cycle_count" && reasonCode !== CYCLE_COUNT_REASON_CODE) {
    throw new Error(
      "Cycle counts must reconcile with the cycle-count reason code."
    );
  }
}

export function resolveStockAdjustmentQuantityDelta(args: {
  adjustmentType: StockAdjustmentType;
  countedQuantity?: number;
  quantityDelta?: number;
  systemQuantity: number;
}): number {
  if (args.adjustmentType === "cycle_count") {
    if (
      args.countedQuantity === undefined ||
      !Number.isInteger(args.countedQuantity)
    ) {
      throw new Error(
        "Cycle counts require an integer counted quantity for every selected SKU."
      );
    }

    const countedQuantity = args.countedQuantity;
    return calculateCycleCountQuantityDelta({
      countedQuantity,
      systemQuantity: args.systemQuantity,
    });
  }

  if (args.quantityDelta === undefined || !Number.isInteger(args.quantityDelta)) {
    throw new Error(
      "Manual stock adjustments require a whole-unit delta for every selected SKU."
    );
  }

  return args.quantityDelta;
}

export function summarizeStockAdjustmentLineItems(
  lineItems: Array<{ quantityDelta: number }>
) {
  return lineItems.reduce(
    (summary, lineItem) => ({
      largestAbsoluteDelta: Math.max(
        summary.largestAbsoluteDelta,
        Math.abs(lineItem.quantityDelta)
      ),
      lineItemCount: summary.lineItemCount + 1,
      netQuantityDelta: summary.netQuantityDelta + lineItem.quantityDelta,
    }),
    {
      largestAbsoluteDelta: 0,
      lineItemCount: 0,
      netQuantityDelta: 0,
    }
  );
}

export function requiresStockAdjustmentApproval(args: {
  largestAbsoluteDelta: number;
}) {
  return args.largestAbsoluteDelta >= STOCK_ADJUSTMENT_APPROVAL_THRESHOLD;
}

function buildStockAdjustmentSourceId(batchId: string) {
  return `stock_adjustment_batch:${batchId}`;
}

function buildStockAdjustmentTitle(args: {
  adjustmentType: StockAdjustmentType;
  lineItemCount: number;
}) {
  const countLabel = `${args.lineItemCount} SKU${args.lineItemCount === 1 ? "" : "s"}`;
  return args.adjustmentType === "cycle_count"
    ? `Cycle count review · ${countLabel}`
    : `Stock adjustment review · ${countLabel}`;
}

function assertNormalizedLineItem(
  productSku: {
    inventoryCount: number;
    productId: Id<"product">;
    productName?: string;
    sku?: string;
    storeId: Id<"store">;
  } | null,
  storeId: Id<"store">,
  adjustmentType: StockAdjustmentType,
  requestedLineItem: StockAdjustmentInputLineItem
): NormalizedStockAdjustmentLineItem {
  if (!productSku || productSku.storeId !== storeId) {
    throw new Error("Selected SKU could not be found for this store.");
  }

  const systemQuantity = productSku.inventoryCount;
  const quantityDelta = resolveStockAdjustmentQuantityDelta({
    adjustmentType,
    countedQuantity: requestedLineItem.countedQuantity,
    quantityDelta: requestedLineItem.quantityDelta,
    systemQuantity,
  });

  if (!Number.isInteger(quantityDelta) || quantityDelta === 0) {
    throw new Error("Stock adjustments must change inventory by at least one unit.");
  }

  if (systemQuantity + quantityDelta < 0) {
    throw new Error("Stock adjustments cannot reduce inventory below zero.");
  }

  return {
    countedQuantity:
      adjustmentType === "cycle_count"
        ? requestedLineItem.countedQuantity
        : undefined,
    productId: productSku.productId,
    productName: productSku.productName,
    productSkuId: requestedLineItem.productSkuId,
    quantityDelta,
    sku: productSku.sku,
    systemQuantity,
  };
}

async function applyStockAdjustmentBatchWithCtx(
  ctx: MutationCtx,
  args: {
    actorUserId?: Id<"athenaUser">;
    batchId: Id<"stockAdjustmentBatch">;
    lineItems: NormalizedStockAdjustmentLineItem[];
    notes?: string;
    organizationId?: Id<"organization">;
    reasonCode: StockAdjustmentReasonCode;
    storeId: Id<"store">;
    workItemId?: Id<"operationalWorkItem">;
  }
) {
  const sourceId = buildStockAdjustmentSourceId(String(args.batchId));

  for (const lineItem of args.lineItems) {
    const productSku = await ctx.db.get("productSku", lineItem.productSkuId);

    if (!productSku || productSku.storeId !== args.storeId) {
      throw new Error("Stock adjustment SKU not found for this store.");
    }

    await ctx.db.patch("productSku", lineItem.productSkuId, {
      inventoryCount: productSku.inventoryCount + lineItem.quantityDelta,
      quantityAvailable: Math.max(
        0,
        productSku.quantityAvailable + lineItem.quantityDelta
      ),
    });

    await recordInventoryMovementWithCtx(ctx, {
      actorUserId: args.actorUserId,
      movementType:
        lineItem.countedQuantity === undefined ? "adjustment" : "cycle_count",
      notes: args.notes,
      organizationId: args.organizationId,
      productId: lineItem.productId,
      productSkuId: lineItem.productSkuId,
      quantityDelta: lineItem.quantityDelta,
      reasonCode: args.reasonCode,
      sourceId,
      sourceType: "stock_adjustment_batch",
      storeId: args.storeId,
      workItemId: args.workItemId,
    });
  }
}

function buildStockAdjustmentDecisionEventType(
  decision: "approved" | "rejected" | "cancelled"
) {
  return decision === "approved"
    ? "stock_adjustment_approved"
    : decision === "rejected"
      ? "stock_adjustment_rejected"
      : "stock_adjustment_cancelled";
}

function buildResolvedStockAdjustmentStatus(
  decision: "approved" | "rejected" | "cancelled"
) {
  return decision === "approved" ? "applied" : decision;
}

export async function resolveStockAdjustmentApprovalDecisionWithCtx(
  ctx: MutationCtx,
  args: {
    approvalRequestId: Id<"approvalRequest">;
    decision: "approved" | "rejected" | "cancelled";
    reviewedByStaffProfileId?: Id<"staffProfile">;
    reviewedByUserId?: Id<"athenaUser">;
    decisionNotes?: string;
  }
) {
  const approvalRequest = await ctx.db.get("approvalRequest", args.approvalRequestId);

  if (
    !approvalRequest ||
    approvalRequest.requestType !== "inventory_adjustment_review" ||
    approvalRequest.subjectType !== "stock_adjustment_batch"
  ) {
    throw new Error("Inventory adjustment approval request not found.");
  }

  const stockAdjustmentBatchId = approvalRequest.subjectId as Id<"stockAdjustmentBatch">;
  const stockAdjustmentBatch = await ctx.db.get(
    "stockAdjustmentBatch",
    stockAdjustmentBatchId
  );

  if (
    !stockAdjustmentBatch ||
    stockAdjustmentBatch.approvalRequestId !== args.approvalRequestId
  ) {
    throw new Error("Stock adjustment batch not found for this approval request.");
  }

  if (stockAdjustmentBatch.status !== "pending_approval") {
    throw new Error("Stock adjustment batch has already been resolved.");
  }

  const now = Date.now();

  if (args.decision === "approved") {
    await applyStockAdjustmentBatchWithCtx(ctx, {
      actorUserId: args.reviewedByUserId,
      batchId: stockAdjustmentBatchId,
      lineItems: stockAdjustmentBatch.lineItems,
      notes: stockAdjustmentBatch.notes,
      organizationId: stockAdjustmentBatch.organizationId,
      reasonCode: stockAdjustmentBatch.reasonCode as StockAdjustmentReasonCode,
      storeId: stockAdjustmentBatch.storeId,
      workItemId: stockAdjustmentBatch.operationalWorkItemId,
    });
  }

  await ctx.db.patch("stockAdjustmentBatch", stockAdjustmentBatchId, {
    status: buildResolvedStockAdjustmentStatus(args.decision),
    decidedAt: now,
    ...(args.decision === "approved" ? { appliedAt: now } : null),
  });

  if (stockAdjustmentBatch.operationalWorkItemId) {
    await updateOperationalWorkItemStatusWithCtx(ctx, {
      approvalState: args.decision,
      status: args.decision === "approved" ? "completed" : "cancelled",
      workItemId: stockAdjustmentBatch.operationalWorkItemId,
    });
  }

  await recordOperationalEventWithCtx(ctx, {
    actorStaffProfileId: args.reviewedByStaffProfileId,
    actorUserId: args.reviewedByUserId,
    approvalRequestId: args.approvalRequestId,
    eventType: buildStockAdjustmentDecisionEventType(args.decision),
    metadata: {
      adjustmentType: stockAdjustmentBatch.adjustmentType,
      decision: args.decision,
      largestAbsoluteDelta: stockAdjustmentBatch.largestAbsoluteDelta,
      lineItemCount: stockAdjustmentBatch.lineItemCount,
      netQuantityDelta: stockAdjustmentBatch.netQuantityDelta,
      reasonCode: stockAdjustmentBatch.reasonCode,
    },
    organizationId: stockAdjustmentBatch.organizationId,
    reason: trimOptional(args.decisionNotes) ?? stockAdjustmentBatch.notes,
    storeId: stockAdjustmentBatch.storeId,
    subjectId: String(stockAdjustmentBatchId),
    subjectLabel: buildStockAdjustmentTitle({
      adjustmentType: stockAdjustmentBatch.adjustmentType,
      lineItemCount: stockAdjustmentBatch.lineItemCount,
    }),
    subjectType: "stock_adjustment_batch",
    workItemId: stockAdjustmentBatch.operationalWorkItemId,
  });

  return ctx.db.get("stockAdjustmentBatch", stockAdjustmentBatchId);
}

export const listInventorySnapshot = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const productSkus = await ctx.db
      .query("productSku")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();

    return productSkus
      .map((productSku) => ({
        _id: productSku._id,
        inventoryCount: productSku.inventoryCount,
        productName:
          productSku.productName ?? productSku.sku ?? String(productSku._id),
        quantityAvailable: productSku.quantityAvailable,
        sku: productSku.sku ?? null,
      }))
      .sort((left, right) => {
        const nameCompare = left.productName.localeCompare(right.productName);
        if (nameCompare !== 0) {
          return nameCompare;
        }

        return (left.sku ?? "").localeCompare(right.sku ?? "");
      });
  },
});

export const submitStockAdjustmentBatch = mutation({
  args: {
    adjustmentType: v.union(v.literal("manual"), v.literal("cycle_count")),
    createdByUserId: v.optional(v.id("athenaUser")),
    lineItems: v.array(
      v.object({
        countedQuantity: v.optional(v.number()),
        productSkuId: v.id("productSku"),
        quantityDelta: v.optional(v.number()),
      })
    ),
    notes: v.optional(v.string()),
    reasonCode: v.string(),
    storeId: v.id("store"),
    submissionKey: v.string(),
  },
  handler: async (ctx, args) => {
    const submissionKey = trimOptional(args.submissionKey);

    if (!submissionKey) {
      throw new Error("A stock-adjustment submission key is required.");
    }

    assertStockAdjustmentReasonCode(args.adjustmentType, args.reasonCode);

    if (args.lineItems.length === 0) {
      throw new Error("Stock adjustment batches require at least one line item.");
    }

    assertDistinctStockAdjustmentLineItems(
      args.lineItems.map((lineItem) => ({
        productSkuId: String(lineItem.productSkuId),
      }))
    );

    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      throw new Error("Store not found.");
    }

    const existingStockAdjustmentBatch = await ctx.db
      .query("stockAdjustmentBatch")
      .withIndex("by_storeId_adjustmentType_submissionKey", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("adjustmentType", args.adjustmentType)
          .eq("submissionKey", submissionKey)
      )
      .first();

    if (existingStockAdjustmentBatch) {
      return existingStockAdjustmentBatch;
    }

    const productSkus = await Promise.all(
      args.lineItems.map((lineItem) => ctx.db.get("productSku", lineItem.productSkuId))
    );

    const normalizedLineItems = args.lineItems.map((requestedLineItem, index) =>
      assertNormalizedLineItem(
        productSkus[index] ?? null,
        args.storeId,
        args.adjustmentType,
        requestedLineItem
      )
    );

    const summary = summarizeStockAdjustmentLineItems(normalizedLineItems);
    const approvalRequired = requiresStockAdjustmentApproval(summary);
    const now = Date.now();
    const notes = trimOptional(args.notes);

    const stockAdjustmentBatchId = await ctx.db.insert("stockAdjustmentBatch", {
      adjustmentType: args.adjustmentType,
      approvalRequired,
      createdAt: now,
      createdByUserId: args.createdByUserId,
      lineItemCount: summary.lineItemCount,
      lineItems: normalizedLineItems,
      largestAbsoluteDelta: summary.largestAbsoluteDelta,
      netQuantityDelta: summary.netQuantityDelta,
      notes,
      organizationId: store.organizationId,
      reasonCode: args.reasonCode,
      status: approvalRequired ? "pending_approval" : "applied",
      storeId: args.storeId,
      submissionKey,
      ...(approvalRequired ? null : { appliedAt: now }),
    });

    let workItemId: Id<"operationalWorkItem"> | undefined;
    let approvalRequestId: Id<"approvalRequest"> | undefined;

    if (approvalRequired) {
      const workItem = await createOperationalWorkItemWithCtx(ctx, {
        approvalState: "pending",
        createdByUserId: args.createdByUserId,
        metadata: {
          adjustmentBatchId: stockAdjustmentBatchId,
          adjustmentType: args.adjustmentType,
          largestAbsoluteDelta: summary.largestAbsoluteDelta,
          lineItemCount: summary.lineItemCount,
          netQuantityDelta: summary.netQuantityDelta,
          reasonCode: args.reasonCode,
        },
        notes,
        organizationId: store.organizationId,
        priority: "high",
        status: "open",
        storeId: args.storeId,
        title: buildStockAdjustmentTitle({
          adjustmentType: args.adjustmentType,
          lineItemCount: summary.lineItemCount,
        }),
        type: "stock_adjustment_review",
      });

      workItemId = workItem?._id;

      if (workItemId) {
        approvalRequestId = await ctx.db.insert(
          "approvalRequest",
          buildApprovalRequest({
            metadata: {
              adjustmentBatchId: stockAdjustmentBatchId,
              adjustmentType: args.adjustmentType,
              approvalThreshold: STOCK_ADJUSTMENT_APPROVAL_THRESHOLD,
              largestAbsoluteDelta: summary.largestAbsoluteDelta,
              lineItems: normalizedLineItems,
              netQuantityDelta: summary.netQuantityDelta,
              reasonCode: args.reasonCode,
            },
            notes,
            organizationId: store.organizationId,
            reason: "Inventory variance exceeded the approval threshold.",
            requestType: "inventory_adjustment_review",
            requestedByUserId: args.createdByUserId,
            storeId: args.storeId,
            subjectId: String(stockAdjustmentBatchId),
            subjectType: "stock_adjustment_batch",
            workItemId,
          })
        );

        await ctx.db.patch("operationalWorkItem", workItemId, {
          approvalRequestId,
        });
      }

      await ctx.db.patch("stockAdjustmentBatch", stockAdjustmentBatchId, {
        approvalRequestId,
        operationalWorkItemId: workItemId,
      });
    } else {
      await applyStockAdjustmentBatchWithCtx(ctx, {
        actorUserId: args.createdByUserId,
        batchId: stockAdjustmentBatchId,
        lineItems: normalizedLineItems,
        notes,
        organizationId: store.organizationId,
        reasonCode: args.reasonCode as StockAdjustmentReasonCode,
        storeId: args.storeId,
      });
    }

    await recordOperationalEventWithCtx(ctx, {
      actorUserId: args.createdByUserId,
      approvalRequestId,
      eventType: approvalRequired
        ? "stock_adjustment_approval_requested"
        : "stock_adjustment_applied",
      metadata: {
        adjustmentType: args.adjustmentType,
        approvalRequired,
        largestAbsoluteDelta: summary.largestAbsoluteDelta,
        lineItemCount: summary.lineItemCount,
        netQuantityDelta: summary.netQuantityDelta,
        reasonCode: args.reasonCode,
      },
      organizationId: store.organizationId,
      reason: notes,
      storeId: args.storeId,
      subjectId: String(stockAdjustmentBatchId),
      subjectLabel: buildStockAdjustmentTitle({
        adjustmentType: args.adjustmentType,
        lineItemCount: summary.lineItemCount,
      }),
      subjectType: "stock_adjustment_batch",
      workItemId,
    });

    return ctx.db.get("stockAdjustmentBatch", stockAdjustmentBatchId);
  },
});
