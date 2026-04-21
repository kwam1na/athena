import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { requireStoreFullAdminAccess } from "./access";

const LOW_STOCK_THRESHOLD = 2;
const DEFAULT_REPLENISHMENT_TARGET = 6;
const RECEIVING_CONTEXT_STATUSES = ["ordered", "partially_received"] as const;

type RecommendationStatus =
  | "reorder_now"
  | "awaiting_receipt"
  | "availability_constrained";

type ReceivingContextStatus = (typeof RECEIVING_CONTEXT_STATUSES)[number];

type PendingPurchaseOrderContext = {
  expectedAt?: number;
  pendingQuantity: number;
  poNumber: string;
  purchaseOrderId: Id<"purchaseOrder">;
  status: ReceivingContextStatus;
};

type PendingSkuContext = {
  nextExpectedAt?: number;
  pendingPurchaseOrders: PendingPurchaseOrderContext[];
  pendingQuantity: number;
};

function getStatusRank(status: RecommendationStatus) {
  switch (status) {
    case "reorder_now":
      return 0;
    case "awaiting_receipt":
      return 1;
    case "availability_constrained":
      return 2;
  }
}

function buildGuidance(args: {
  pendingQuantity: number;
  status: RecommendationStatus;
  suggestedOrderQuantity: number;
}) {
  if (args.status === "availability_constrained") {
    return "On-hand units are still healthy, but most sellable stock is already committed.";
  }

  if (args.status === "awaiting_receipt") {
    return "Active inbound purchase orders should cover this SKU once the remaining units are received.";
  }

  if (args.pendingQuantity > 0) {
    return `Existing inbound still leaves this SKU ${args.suggestedOrderQuantity} units short of the default shelf target.`;
  }

  return "No active inbound replenishment is covering this SKU right now.";
}

async function listStoreProductSkus(ctx: QueryCtx, storeId: Id<"store">) {
  const productSkus = [];

  for await (const productSku of ctx.db
    .query("productSku")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))) {
    productSkus.push(productSku);
  }

  return productSkus;
}

async function listStorePurchaseOrdersByStatus(
  ctx: QueryCtx,
  args: {
    status: ReceivingContextStatus;
    storeId: Id<"store">;
  }
) {
  const purchaseOrders = [];

  for await (const purchaseOrder of ctx.db
    .query("purchaseOrder")
    .withIndex("by_storeId_status", (q) =>
      q.eq("storeId", args.storeId).eq("status", args.status)
    )) {
    purchaseOrders.push(purchaseOrder);
  }

  return purchaseOrders;
}

async function listPurchaseOrderLineItems(
  ctx: QueryCtx,
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

async function buildPendingSkuContextById(
  ctx: QueryCtx,
  storeId: Id<"store">
) {
  const pendingSkuContextById = new Map<string, PendingSkuContext>();
  const purchaseOrdersByStatus = await Promise.all(
    RECEIVING_CONTEXT_STATUSES.map((status) =>
      listStorePurchaseOrdersByStatus(ctx, { status, storeId })
    )
  );

  for (const purchaseOrder of purchaseOrdersByStatus.flat()) {
    const lineItems = await listPurchaseOrderLineItems(ctx, purchaseOrder._id);

    lineItems.forEach((lineItem) => {
      const pendingQuantity = Math.max(
        lineItem.orderedQuantity - lineItem.receivedQuantity,
        0
      );

      if (pendingQuantity === 0) {
        return;
      }

      const key = String(lineItem.productSkuId);
      const currentContext = pendingSkuContextById.get(key) ?? {
        pendingPurchaseOrders: [],
        pendingQuantity: 0,
      };

      currentContext.pendingQuantity += pendingQuantity;
      currentContext.pendingPurchaseOrders.push({
        expectedAt: purchaseOrder.expectedAt,
        pendingQuantity,
        poNumber: purchaseOrder.poNumber,
        purchaseOrderId: purchaseOrder._id,
        status:
          purchaseOrder.status === "ordered" ? "ordered" : "partially_received",
      });

      if (
        purchaseOrder.expectedAt !== undefined &&
        (currentContext.nextExpectedAt === undefined ||
          purchaseOrder.expectedAt < currentContext.nextExpectedAt)
      ) {
        currentContext.nextExpectedAt = purchaseOrder.expectedAt;
      }

      pendingSkuContextById.set(key, currentContext);
    });
  }

  pendingSkuContextById.forEach((context) => {
    context.pendingPurchaseOrders.sort((left, right) => {
      const leftExpectedAt = left.expectedAt ?? Number.MAX_SAFE_INTEGER;
      const rightExpectedAt = right.expectedAt ?? Number.MAX_SAFE_INTEGER;

      if (leftExpectedAt !== rightExpectedAt) {
        return leftExpectedAt - rightExpectedAt;
      }

      return left.poNumber.localeCompare(right.poNumber);
    });
  });

  return pendingSkuContextById;
}

export async function listReplenishmentRecommendationsWithCtx(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
  }
) {
  const [pendingSkuContextById, productSkus] = await Promise.all([
    buildPendingSkuContextById(ctx, args.storeId),
    listStoreProductSkus(ctx, args.storeId),
  ]);

  return productSkus
    .flatMap((productSku) => {
      const lowInventory = productSku.inventoryCount <= LOW_STOCK_THRESHOLD;
      const lowAvailability =
        productSku.quantityAvailable <= LOW_STOCK_THRESHOLD;

      if (!lowInventory && !lowAvailability) {
        return [];
      }

      const pendingContext = pendingSkuContextById.get(String(productSku._id));
      const pendingQuantity = pendingContext?.pendingQuantity ?? 0;
      const projectedInventory = productSku.inventoryCount + pendingQuantity;
      const suggestedOrderQuantity = lowInventory
        ? Math.max(DEFAULT_REPLENISHMENT_TARGET - projectedInventory, 0)
        : 0;

      const status: RecommendationStatus =
        !lowInventory || productSku.inventoryCount > LOW_STOCK_THRESHOLD
          ? "availability_constrained"
          : suggestedOrderQuantity > 0
            ? "reorder_now"
            : "awaiting_receipt";

      return [
        {
          _id: productSku._id,
          guidance: buildGuidance({
            pendingQuantity,
            status,
            suggestedOrderQuantity,
          }),
          inventoryCount: productSku.inventoryCount,
          nextExpectedAt: pendingContext?.nextExpectedAt,
          pendingPurchaseOrderCount:
            pendingContext?.pendingPurchaseOrders.length ?? 0,
          pendingPurchaseOrderQuantity: pendingQuantity,
          pendingPurchaseOrders: pendingContext?.pendingPurchaseOrders ?? [],
          productName:
            productSku.productName ?? productSku.sku ?? String(productSku._id),
          quantityAvailable: productSku.quantityAvailable,
          sku: productSku.sku ?? null,
          status,
          suggestedOrderQuantity,
        },
      ];
    })
    .sort((left, right) => {
      const statusRank = getStatusRank(left.status) - getStatusRank(right.status);

      if (statusRank !== 0) {
        return statusRank;
      }

      if (left.quantityAvailable !== right.quantityAvailable) {
        return left.quantityAvailable - right.quantityAvailable;
      }

      if (left.inventoryCount !== right.inventoryCount) {
        return left.inventoryCount - right.inventoryCount;
      }

      const nameCompare = left.productName.localeCompare(right.productName);
      if (nameCompare !== 0) {
        return nameCompare;
      }

      return (left.sku ?? "").localeCompare(right.sku ?? "");
    });
}

export const listReplenishmentRecommendations = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireStoreFullAdminAccess(ctx, args.storeId);
    return listReplenishmentRecommendationsWithCtx(ctx, args);
  },
});
