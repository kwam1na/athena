import { internal } from "../_generated/api";
import { mutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { recordInventoryMovementWithCtx } from "../operations/inventoryMovements";

type ReceivingLineItemInput = {
  orderedQuantity: number;
  receivedQuantity: number;
};

type ReceivingPlanLineItem = ReceivingLineItemInput & {
  _id: string;
  currentReceivedQuantity: number;
  productId?: string;
  productSkuId: string;
};

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

export function calculateReceivingBatchTotals(
  lineItems: Array<{ receivedQuantity: number }>
) {
  return lineItems.reduce(
    (summary, lineItem) => {
      if (lineItem.receivedQuantity <= 0) {
        throw new Error("Receiving quantities must be greater than zero.");
      }

      return {
        lineItemCount: summary.lineItemCount + 1,
        totalUnits: summary.totalUnits + lineItem.receivedQuantity,
      };
    },
    {
      lineItemCount: 0,
      totalUnits: 0,
    }
  );
}

export function calculatePurchaseOrderReceivingStatus(
  lineItems: Array<{ orderedQuantity: number; receivedQuantity: number }>
) {
  return lineItems.every(
    (lineItem) => lineItem.receivedQuantity >= lineItem.orderedQuantity
  )
    ? "received"
    : "partially_received";
}

export function assertReceivingLineQuantities(
  lineItems: Array<ReceivingLineItemInput>
) {
  lineItems.forEach((lineItem) => {
    if (lineItem.receivedQuantity <= 0) {
      throw new Error("Receiving quantities must be greater than zero.");
    }

    if (lineItem.receivedQuantity > lineItem.orderedQuantity) {
      throw new Error("You cannot receive more than ordered.");
    }
  });
}

function buildReceivingBatchSourceId(
  purchaseOrderId: string,
  submissionKey: string
) {
  return `purchase_order_receiving_batch:${purchaseOrderId}:${submissionKey}`;
}

async function listPurchaseOrderLineItems(
  ctx: MutationCtx,
  purchaseOrderId: Id<"purchaseOrder">
) {
  const lineItems = [];

  for await (const lineItem of ctx.db
    .query("purchaseOrderLineItem")
    .withIndex("by_purchaseOrderId", (q) =>
      q.eq("purchaseOrderId", purchaseOrderId)
    )) {
    lineItems.push(lineItem);
  }

  return lineItems;
}

export const receivePurchaseOrderBatch = mutation({
  args: {
    purchaseOrderId: v.id("purchaseOrder"),
    storeId: v.id("store"),
    submissionKey: v.string(),
    receivedByUserId: v.optional(v.id("athenaUser")),
    notes: v.optional(v.string()),
    lineItems: v.array(
      v.object({
        purchaseOrderLineItemId: v.id("purchaseOrderLineItem"),
        receivedQuantity: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const submissionKey = trimOptional(args.submissionKey);
    if (!submissionKey) {
      throw new Error("A receiving submission key is required.");
    }

    const purchaseOrder = await ctx.db.get("purchaseOrder", args.purchaseOrderId);
    if (!purchaseOrder || purchaseOrder.storeId !== args.storeId) {
      throw new Error("Purchase order not found.");
    }

    const existingReceivingBatch = await ctx.db
      .query("receivingBatch")
      .withIndex("by_storeId_purchaseOrderId_submissionKey", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("purchaseOrderId", args.purchaseOrderId)
          .eq("submissionKey", submissionKey)
      )
      .first();

    if (existingReceivingBatch) {
      return existingReceivingBatch;
    }

    if (purchaseOrder.status === "received") {
      throw new Error("Purchase order is already fully received.");
    }

    if (args.lineItems.length === 0) {
      throw new Error("Receiving batches require at least one line item.");
    }

    const purchaseOrderLineItems = await listPurchaseOrderLineItems(
      ctx,
      args.purchaseOrderId
    );
    const purchaseOrderLineItemById = new Map(
      purchaseOrderLineItems.map((lineItem) => [String(lineItem._id), lineItem])
    );

    const normalizedLineItems = args.lineItems.map((requestedLineItem, index) => {
      const lineItem = purchaseOrderLineItemById.get(
        String(requestedLineItem.purchaseOrderLineItemId)
      );

      if (!lineItem || lineItem.purchaseOrderId !== args.purchaseOrderId) {
        throw new Error(
          `Receiving line ${index + 1} does not belong to this purchase order.`
        );
      }

      return {
        _id: String(lineItem._id),
        orderedQuantity: lineItem.orderedQuantity - lineItem.receivedQuantity,
        receivedQuantity: requestedLineItem.receivedQuantity,
        currentReceivedQuantity: lineItem.receivedQuantity,
        productId: lineItem.productId ? String(lineItem.productId) : undefined,
        productSkuId: String(lineItem.productSkuId),
      };
    });

    assertReceivingLineQuantities(
      normalizedLineItems.map((lineItem) => ({
        orderedQuantity: lineItem.orderedQuantity,
        receivedQuantity: lineItem.receivedQuantity,
      }))
    );

    const totals = calculateReceivingBatchTotals(normalizedLineItems);
    const now = Date.now();
    const sourceId = buildReceivingBatchSourceId(
      String(args.purchaseOrderId),
      submissionKey
    );

    const receivingBatchId = await ctx.db.insert("receivingBatch", {
      storeId: args.storeId,
      organizationId: purchaseOrder.organizationId,
      purchaseOrderId: args.purchaseOrderId,
      submissionKey,
      lineItemCount: totals.lineItemCount,
      totalUnits: totals.totalUnits,
      receivedByUserId: args.receivedByUserId,
      notes: trimOptional(args.notes),
      lineItems: normalizedLineItems.map((lineItem) => ({
        purchaseOrderLineItemId: lineItem._id as never,
        productSkuId: lineItem.productSkuId as never,
        receivedQuantity: lineItem.receivedQuantity,
      })),
      createdAt: now,
      receivedAt: now,
    });

    await Promise.all(
      normalizedLineItems.map(async (lineItem) => {
        const productSku = await ctx.db.get(
          "productSku",
          lineItem.productSkuId as Id<"productSku">
        );
        if (!productSku || String(productSku.storeId) !== String(args.storeId)) {
          throw new Error("Receiving SKU not found for this store.");
        }

        await ctx.db.patch("productSku", lineItem.productSkuId as never, {
          inventoryCount: productSku.inventoryCount + lineItem.receivedQuantity,
          quantityAvailable:
            productSku.quantityAvailable + lineItem.receivedQuantity,
        });

        await recordInventoryMovementWithCtx(ctx, {
          actorUserId: args.receivedByUserId,
          movementType: "receipt",
          notes: trimOptional(args.notes),
          organizationId: purchaseOrder.organizationId,
          productId: lineItem.productId as Id<"product"> | undefined,
          productSkuId: lineItem.productSkuId as Id<"productSku">,
          quantityDelta: lineItem.receivedQuantity,
          reasonCode: "purchase_order_receipt",
          sourceId,
          sourceType: "purchase_order_receiving_batch",
          storeId: args.storeId,
        });
      })
    );

    await Promise.all(
      normalizedLineItems.map(async (lineItem) => {
        await ctx.db.patch("purchaseOrderLineItem", lineItem._id as never, {
          receivedQuantity:
            lineItem.currentReceivedQuantity + lineItem.receivedQuantity,
        });
      })
    );

    const nextReceivedQuantityByLineItemId = new Map(
      normalizedLineItems.map((lineItem) => [
        lineItem._id,
        lineItem.currentReceivedQuantity + lineItem.receivedQuantity,
      ])
    );
    const nextPurchaseOrderStatus = calculatePurchaseOrderReceivingStatus(
      purchaseOrderLineItems.map((lineItem) => ({
        orderedQuantity: lineItem.orderedQuantity,
        receivedQuantity:
          nextReceivedQuantityByLineItemId.get(String(lineItem._id)) ??
          lineItem.receivedQuantity,
      }))
    );
    const purchaseOrderUpdates: Record<string, unknown> = {
      status: nextPurchaseOrderStatus,
    };

    if (nextPurchaseOrderStatus === "received") {
      purchaseOrderUpdates.receivedAt = now;
    }

    await ctx.db.patch("purchaseOrder", args.purchaseOrderId, purchaseOrderUpdates);

    if (purchaseOrder.operationalWorkItemId) {
      await ctx.runMutation(internal.operations.operationalWorkItems.updateOperationalWorkItemStatus, {
        status: nextPurchaseOrderStatus === "received" ? "completed" : "in_progress",
        workItemId: purchaseOrder.operationalWorkItemId,
      });
    }

    return ctx.db.get("receivingBatch", receivingBatchId);
  },
});
