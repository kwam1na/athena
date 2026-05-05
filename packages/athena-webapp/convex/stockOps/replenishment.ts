import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { requireStoreFullAdminAccess } from "./access";

const LOW_STOCK_THRESHOLD = 2;
const DEFAULT_REPLENISHMENT_TARGET = 6;
const MAX_ACTIVE_VENDOR_CONTEXT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const PLANNED_ACTION_STALE_AFTER_MS = 7 * DAY_MS;
const LATE_INBOUND_GRACE_MS = 0;
const PLANNED_CONTEXT_STATUSES = ["draft", "submitted", "approved"] as const;
const INBOUND_COVER_STATUSES = ["ordered", "partially_received"] as const;
const HISTORICAL_CONTEXT_STATUSES = ["cancelled", "received"] as const;
const PURCHASE_ORDER_CONTEXT_STATUSES = [
  ...PLANNED_CONTEXT_STATUSES,
  ...INBOUND_COVER_STATUSES,
  ...HISTORICAL_CONTEXT_STATUSES,
] as const;

type RecommendationStatus =
  | "reorder_now"
  | "awaiting_receipt"
  | "availability_constrained";

type ContinuityStatus =
  | "exposed"
  | "planned"
  | "inbound"
  | "partially_covered"
  | "vendor_missing"
  | "stale_planned_action"
  | "late_inbound"
  | "short_receipt"
  | "cancelled_cover"
  | "resolved";

type PurchaseOrderContextStatus = (typeof PURCHASE_ORDER_CONTEXT_STATUSES)[number];
type PlannedContextStatus = (typeof PLANNED_CONTEXT_STATUSES)[number];
type InboundCoverStatus = (typeof INBOUND_COVER_STATUSES)[number];

type PurchaseOrderLineContext = {
  actionAt?: number;
  cancelledAt?: number;
  createdAt?: number;
  expectedAt?: number;
  orderedAt?: number;
  orderedQuantity: number;
  pendingQuantity: number;
  poNumber: string;
  purchaseOrderId: Id<"purchaseOrder">;
  receivedAt?: number;
  receivedQuantity: number;
  status: PurchaseOrderContextStatus;
  vendorId: Id<"vendor">;
};

type SkuContinuityContext = {
  cancelledPurchaseOrders: PurchaseOrderLineContext[];
  cancelledQuantity: number;
  inboundPurchaseOrders: Array<
    PurchaseOrderLineContext & { status: InboundCoverStatus }
  >;
  inboundQuantity: number;
  nextExpectedAt?: number;
  plannedPurchaseOrders: Array<
    PurchaseOrderLineContext & { status: PlannedContextStatus }
  >;
  plannedQuantity: number;
  receivedPurchaseOrders: PurchaseOrderLineContext[];
  receivedQuantity: number;
};

function getContinuityStatusRank(status: ContinuityStatus) {
  switch (status) {
    case "vendor_missing":
      return 0;
    case "exposed":
      return 1;
    case "partially_covered":
      return 2;
    case "stale_planned_action":
      return 3;
    case "late_inbound":
      return 4;
    case "short_receipt":
      return 5;
    case "cancelled_cover":
      return 6;
    case "planned":
      return 7;
    case "inbound":
      return 8;
    case "resolved":
      return 9;
  }
}

function buildGuidance(args: {
  actionGap: number;
  hasActiveVendor: boolean;
  inboundQuantity: number;
  plannedQuantity: number;
  status: ContinuityStatus;
  suggestedOrderQuantity: number;
}) {
  switch (args.status) {
    case "vendor_missing":
      return "No active vendor is available for this exposed SKU.";
    case "stale_planned_action":
      return "Planned purchase-order action has been waiting past the current stale-action threshold.";
    case "late_inbound":
      return "Inbound cover is past its expected receipt date and still has units outstanding.";
    case "short_receipt":
      return "A partially received purchase order still leaves this SKU below the default shelf target.";
    case "cancelled_cover":
      return "The latest related cover was cancelled and no replacement planned or inbound action exists.";
    case "partially_covered":
      return `Existing planned or inbound cover still leaves this SKU ${args.actionGap} units short of the default shelf target.`;
    case "planned":
      return "Planned purchase-order action exists, but it is not inbound cover until the PO is ordered.";
    case "inbound":
      return "Active inbound purchase orders should cover this SKU once the remaining units are received.";
    case "resolved":
      return "Current stock pressure is cleared for this SKU.";
    case "exposed":
      if (!args.hasActiveVendor) {
        return "This SKU needs reorder action, but no active vendor is available.";
      }

      if (args.suggestedOrderQuantity === 0) {
        return "On-hand units are still healthy, but most sellable stock is already committed.";
      }

      if (args.inboundQuantity > 0 || args.plannedQuantity > 0) {
        return `Existing cover still leaves this SKU ${args.suggestedOrderQuantity} units short of the default shelf target.`;
      }

      return "No planned or inbound replenishment is covering this SKU right now.";
  }
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
    status: PurchaseOrderContextStatus;
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

async function listActiveStoreVendors(ctx: QueryCtx, storeId: Id<"store">) {
  const vendors = [];

  for await (const vendor of ctx.db
    .query("vendor")
    .withIndex("by_storeId_status", (q) =>
      q.eq("storeId", storeId).eq("status", "active")
    )) {
    vendors.push(vendor);

    if (vendors.length >= MAX_ACTIVE_VENDOR_CONTEXT) {
      break;
    }
  }

  return vendors;
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

function isPlannedStatus(
  status: PurchaseOrderContextStatus
): status is PlannedContextStatus {
  return PLANNED_CONTEXT_STATUSES.includes(status as PlannedContextStatus);
}

function isInboundStatus(
  status: PurchaseOrderContextStatus
): status is InboundCoverStatus {
  return INBOUND_COVER_STATUSES.includes(status as InboundCoverStatus);
}

function getPlannedActionAt(purchaseOrder: {
  approvedAt?: number;
  createdAt?: number;
  submittedAt?: number;
}) {
  return (
    purchaseOrder.approvedAt ??
    purchaseOrder.submittedAt ??
    purchaseOrder.createdAt
  );
}

function getStartOfCurrentDay(timestamp: number) {
  const date = new Date(timestamp);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function hasStalePlannedAction(
  context: SkuContinuityContext,
  now: number
) {
  return context.plannedPurchaseOrders.some(
    (purchaseOrder) =>
      purchaseOrder.actionAt !== undefined &&
      now - purchaseOrder.actionAt > PLANNED_ACTION_STALE_AFTER_MS
  );
}

function hasLateInbound(context: SkuContinuityContext, now: number) {
  const lateBefore = getStartOfCurrentDay(now) - LATE_INBOUND_GRACE_MS;

  return context.inboundPurchaseOrders.some(
    (purchaseOrder) =>
      purchaseOrder.expectedAt !== undefined &&
      purchaseOrder.expectedAt < lateBefore &&
      purchaseOrder.pendingQuantity > 0
  );
}

function sortPurchaseOrderContexts<T extends PurchaseOrderLineContext>(
  purchaseOrders: T[]
) {
  purchaseOrders.sort((left, right) => {
    const leftSortAt =
      left.expectedAt ??
      left.actionAt ??
      left.cancelledAt ??
      left.receivedAt ??
      left.createdAt ??
      Number.MAX_SAFE_INTEGER;
    const rightSortAt =
      right.expectedAt ??
      right.actionAt ??
      right.cancelledAt ??
      right.receivedAt ??
      right.createdAt ??
      Number.MAX_SAFE_INTEGER;

    if (leftSortAt !== rightSortAt) {
      return leftSortAt - rightSortAt;
    }

    return left.poNumber.localeCompare(right.poNumber);
  });
}

async function buildSkuContinuityContextById(
  ctx: QueryCtx,
  storeId: Id<"store">
) {
  const skuContinuityContextById = new Map<string, SkuContinuityContext>();
  const purchaseOrdersByStatus = await Promise.all(
    PURCHASE_ORDER_CONTEXT_STATUSES.map((status) =>
      listStorePurchaseOrdersByStatus(ctx, { status, storeId })
    )
  );

  for (const purchaseOrder of purchaseOrdersByStatus.flat()) {
    const lineItems = await listPurchaseOrderLineItems(ctx, purchaseOrder._id);

    lineItems.forEach((lineItem) => {
      if (String(lineItem.storeId) !== String(storeId)) {
        return;
      }

      const pendingQuantity = Math.max(
        lineItem.orderedQuantity - lineItem.receivedQuantity,
        0
      );

      const key = String(lineItem.productSkuId);
      const currentContext = skuContinuityContextById.get(key) ?? {
        cancelledPurchaseOrders: [],
        cancelledQuantity: 0,
        inboundPurchaseOrders: [],
        inboundQuantity: 0,
        plannedPurchaseOrders: [],
        plannedQuantity: 0,
        receivedPurchaseOrders: [],
        receivedQuantity: 0,
      };
      const lineContext: PurchaseOrderLineContext = {
        actionAt: getPlannedActionAt(purchaseOrder),
        cancelledAt: purchaseOrder.cancelledAt,
        createdAt: purchaseOrder.createdAt,
        expectedAt: purchaseOrder.expectedAt,
        orderedAt: purchaseOrder.orderedAt,
        orderedQuantity: lineItem.orderedQuantity,
        pendingQuantity,
        poNumber: purchaseOrder.poNumber,
        purchaseOrderId: purchaseOrder._id,
        receivedAt: purchaseOrder.receivedAt,
        receivedQuantity: lineItem.receivedQuantity,
        status: purchaseOrder.status,
        vendorId: purchaseOrder.vendorId,
      };

      if (isPlannedStatus(purchaseOrder.status) && pendingQuantity > 0) {
        currentContext.plannedQuantity += pendingQuantity;
        currentContext.plannedPurchaseOrders.push({
          ...lineContext,
          status: purchaseOrder.status,
        });
      }

      if (isInboundStatus(purchaseOrder.status) && pendingQuantity > 0) {
        currentContext.inboundQuantity += pendingQuantity;
        currentContext.inboundPurchaseOrders.push({
          ...lineContext,
          status: purchaseOrder.status,
        });

        if (
          purchaseOrder.expectedAt !== undefined &&
          (currentContext.nextExpectedAt === undefined ||
            purchaseOrder.expectedAt < currentContext.nextExpectedAt)
        ) {
          currentContext.nextExpectedAt = purchaseOrder.expectedAt;
        }
      }

      if (purchaseOrder.status === "cancelled" && pendingQuantity > 0) {
        currentContext.cancelledQuantity += pendingQuantity;
        currentContext.cancelledPurchaseOrders.push(lineContext);
      }

      if (purchaseOrder.status === "received" && lineItem.receivedQuantity > 0) {
        currentContext.receivedQuantity += lineItem.receivedQuantity;
        currentContext.receivedPurchaseOrders.push(lineContext);
      }

      skuContinuityContextById.set(key, currentContext);
    });
  }

  skuContinuityContextById.forEach((context) => {
    sortPurchaseOrderContexts(context.plannedPurchaseOrders);
    sortPurchaseOrderContexts(context.inboundPurchaseOrders);
    sortPurchaseOrderContexts(context.cancelledPurchaseOrders);
    sortPurchaseOrderContexts(context.receivedPurchaseOrders);
  });

  return skuContinuityContextById;
}

function hasRelatedPurchaseOrderContext(context?: SkuContinuityContext) {
  return (
    (context?.plannedPurchaseOrders.length ?? 0) > 0 ||
    (context?.inboundPurchaseOrders.length ?? 0) > 0 ||
    (context?.cancelledPurchaseOrders.length ?? 0) > 0 ||
    (context?.receivedPurchaseOrders.length ?? 0) > 0
  );
}

function deriveRecommendationStatus(args: {
  inboundCoverageGap: number;
  lowInventory: boolean;
}): RecommendationStatus {
  if (!args.lowInventory) {
    return "availability_constrained";
  }

  return args.inboundCoverageGap > 0 ? "reorder_now" : "awaiting_receipt";
}

function deriveContinuityStatus(args: {
  actionGap: number;
  context?: SkuContinuityContext;
  hasActiveVendor: boolean;
  hasPressure: boolean;
  lowInventory: boolean;
  now: number;
}): ContinuityStatus | null {
  const hasContext = hasRelatedPurchaseOrderContext(args.context);
  const hasPlanned = (args.context?.plannedQuantity ?? 0) > 0;
  const hasInbound = (args.context?.inboundQuantity ?? 0) > 0;
  const hasCancelled = (args.context?.cancelledQuantity ?? 0) > 0;
  const hasReceived = (args.context?.receivedQuantity ?? 0) > 0;
  const hasPartiallyReceivedInbound =
    args.context?.inboundPurchaseOrders.some(
      (purchaseOrder) => purchaseOrder.status === "partially_received"
    ) ?? false;

  if (!args.hasPressure) {
    return hasContext || hasReceived ? "resolved" : null;
  }

  if (!args.hasActiveVendor && !hasContext) {
    return "vendor_missing";
  }

  if (args.context && hasStalePlannedAction(args.context, args.now)) {
    return "stale_planned_action";
  }

  if (args.context && hasLateInbound(args.context, args.now)) {
    return "late_inbound";
  }

  if (hasPartiallyReceivedInbound && args.lowInventory && args.actionGap > 0) {
    return "short_receipt";
  }

  if (hasCancelled && !hasPlanned && !hasInbound) {
    return "cancelled_cover";
  }

  if (!hasPlanned && !hasInbound) {
    return "exposed";
  }

  if (args.lowInventory && args.actionGap > 0) {
    return "partially_covered";
  }

  if (hasPlanned && !hasInbound) {
    return "planned";
  }

  return "inbound";
}

export async function listReplenishmentRecommendationsWithCtx(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
  }
) {
  const [activeVendors, productSkus, skuContinuityContextById] = await Promise.all([
    listActiveStoreVendors(ctx, args.storeId),
    listStoreProductSkus(ctx, args.storeId),
    buildSkuContinuityContextById(ctx, args.storeId),
  ]);
  const hasActiveVendor = activeVendors.length > 0;
  const now = Date.now();

  return productSkus
    .flatMap((productSku) => {
      const lowInventory = productSku.inventoryCount <= LOW_STOCK_THRESHOLD;
      const lowAvailability =
        productSku.quantityAvailable <= LOW_STOCK_THRESHOLD;
      const hasPressure = lowInventory || lowAvailability;
      const context = skuContinuityContextById.get(String(productSku._id));
      const hasContext = hasRelatedPurchaseOrderContext(context);

      if (!hasPressure && !hasContext) {
        return [];
      }

      const inboundQuantity = context?.inboundQuantity ?? 0;
      const plannedQuantity = context?.plannedQuantity ?? 0;
      const inboundCoverageGap = lowInventory
        ? Math.max(
            DEFAULT_REPLENISHMENT_TARGET -
              productSku.inventoryCount -
              inboundQuantity,
            0
          )
        : 0;
      const actionGap = lowInventory
        ? Math.max(inboundCoverageGap - plannedQuantity, 0)
        : 0;
      const suggestedOrderQuantity = actionGap;
      const status = deriveContinuityStatus({
        actionGap,
        context,
        hasActiveVendor,
        hasPressure,
        lowInventory,
        now,
      });

      if (status === null) {
        return [];
      }

      const recommendationStatus: RecommendationStatus =
        deriveRecommendationStatus({
          inboundCoverageGap,
          lowInventory,
        });

      return [
        {
          _id: productSku._id,
          actionGap,
          cancelledPurchaseOrderCount:
            context?.cancelledPurchaseOrders.length ?? 0,
          cancelledPurchaseOrderQuantity: context?.cancelledQuantity ?? 0,
          cancelledPurchaseOrders: context?.cancelledPurchaseOrders ?? [],
          continuityState: status,
          guidance: buildGuidance({
            actionGap,
            hasActiveVendor,
            inboundQuantity,
            plannedQuantity,
            status,
            suggestedOrderQuantity,
          }),
          inboundCoverageGap,
          inboundPurchaseOrderCount: context?.inboundPurchaseOrders.length ?? 0,
          inboundPurchaseOrderQuantity: inboundQuantity,
          inboundPurchaseOrders: context?.inboundPurchaseOrders ?? [],
          inventoryCount: productSku.inventoryCount,
          isException: [
            "vendor_missing",
            "stale_planned_action",
            "late_inbound",
            "short_receipt",
            "cancelled_cover",
          ].includes(status),
          needsAction: [
            "vendor_missing",
            "exposed",
            "partially_covered",
            "stale_planned_action",
            "late_inbound",
            "short_receipt",
            "cancelled_cover",
          ].includes(status),
          nextExpectedAt: context?.nextExpectedAt,
          pendingPurchaseOrderCount:
            context?.inboundPurchaseOrders.length ?? 0,
          pendingPurchaseOrderQuantity: inboundQuantity,
          pendingPurchaseOrders: context?.inboundPurchaseOrders ?? [],
          plannedPurchaseOrderCount: context?.plannedPurchaseOrders.length ?? 0,
          plannedPurchaseOrderQuantity: plannedQuantity,
          plannedPurchaseOrders: context?.plannedPurchaseOrders ?? [],
          productName:
            productSku.productName ?? productSku.sku ?? String(productSku._id),
          quantityAvailable: productSku.quantityAvailable,
          receivedPurchaseOrderCount:
            context?.receivedPurchaseOrders.length ?? 0,
          receivedPurchaseOrderQuantity: context?.receivedQuantity ?? 0,
          receivedPurchaseOrders: context?.receivedPurchaseOrders ?? [],
          recommendationStatus,
          sku: productSku.sku ?? null,
          status,
          suggestedOrderQuantity,
        },
      ];
    })
    .sort((left, right) => {
      const statusRank =
        getContinuityStatusRank(left.status) -
        getContinuityStatusRank(right.status);

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
