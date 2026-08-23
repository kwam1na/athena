import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import {
  canonicalSyncedSaleInventoryReviewSkuId,
  operationalWorkMetadataString,
  stableOperationalWorkItemSourceIdentity,
} from "../../operations/logicalOperationalWork";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import { userError, type CommandResult } from "../../../shared/commandResult";
import {
  buildProductArchiveBlockedDescription,
  NO_OPEN_SYNCED_SALE_INVENTORY_REVIEW_REASON,
  OPEN_SYNCED_SALE_INVENTORY_REVIEW_ARCHIVE_REASON,
  PRODUCT_ARCHIVE_BLOCKED_TITLE,
  SYNCED_SALE_INVENTORY_REVIEW_SCAN_INCOMPLETE_REASON,
  type ProductArchiveBlockedReason,
} from "../../../shared/productArchivePolicy";

const SYNCED_SALE_INVENTORY_REVIEW_TYPE = "synced_sale_inventory_review";
const OPEN_REVIEW_STATUSES = ["open", "in_progress"] as const;

/**
 * Both scans are store-scoped and indexed. Reading one row past the budget is
 * how the precondition learns it cannot prove completeness, which is the only
 * safe way to fail closed rather than archive over unseen review work.
 */
export const PRODUCT_ARCHIVE_SKU_SCAN_LIMIT = 500;
export const PRODUCT_ARCHIVE_OPEN_REVIEW_SCAN_LIMIT = 500;

export const PRODUCT_ARCHIVE_BLOCKED_EVENT_TYPE =
  "product_availability_archive_blocked";
export const PRODUCT_ARCHIVE_ALLOWED_EVENT_TYPE =
  "product_availability_archive_allowed";

export type ProductArchivePreconditionDecision =
  | {
      allowed: true;
      openSyncedSaleInventoryReviewGroupCount: number;
      workDiscovery: "complete";
    }
  | {
      allowed: false;
      openSyncedSaleInventoryReviewGroupCount: number | null;
      reason: ProductArchiveBlockedReason;
      workDiscovery: "complete" | "incomplete";
    };

function withinBudget<T>(rows: T[], limit: number) {
  return rows.length <= limit;
}

/**
 * Work rows anchor to a SKU either through the indexed column or through the
 * metadata the resolver treats as canonical, and older rows may only carry the
 * product. All three anchors must count, otherwise the block is bypassable.
 */
function belongsToProduct(
  workItem: Doc<"operationalWorkItem">,
  args: {
    productId: Id<"product">;
    skuIds: Set<string>;
  },
) {
  if (workItem.productId && String(workItem.productId) === String(args.productId)) {
    return true;
  }

  const canonicalSkuId = canonicalSyncedSaleInventoryReviewSkuId(workItem);
  if (canonicalSkuId && args.skuIds.has(String(canonicalSkuId))) return true;

  const metadataProductId = operationalWorkMetadataString(
    workItem.metadata,
    "productId",
  );

  return metadataProductId === String(args.productId);
}

/** One resolvable unit of review work, matching the Open Work grouping rule. */
function conflictGroupKey(workItem: Doc<"operationalWorkItem">) {
  const canonicalSkuId = canonicalSyncedSaleInventoryReviewSkuId(workItem);
  return canonicalSkuId
    ? `${workItem.storeId}:${canonicalSkuId}`
    : stableOperationalWorkItemSourceIdentity(workItem);
}

export async function evaluateProductArchivePrecondition(
  ctx: MutationCtx,
  args: {
    productId: Id<"product">;
    storeId: Id<"store">;
  },
): Promise<ProductArchivePreconditionDecision> {
  const skuRows = await ctx.db
    .query("productSku")
    .withIndex("by_productId", (q) => q.eq("productId", args.productId))
    .take(PRODUCT_ARCHIVE_SKU_SCAN_LIMIT + 1);

  if (!withinBudget(skuRows, PRODUCT_ARCHIVE_SKU_SCAN_LIMIT)) {
    return {
      allowed: false,
      openSyncedSaleInventoryReviewGroupCount: null,
      reason: SYNCED_SALE_INVENTORY_REVIEW_SCAN_INCOMPLETE_REASON,
      workDiscovery: "incomplete",
    };
  }

  const skuIds = new Set(
    skuRows
      .filter((sku) => String(sku.storeId) === String(args.storeId))
      .map((sku) => String(sku._id)),
  );
  const conflictGroups = new Set<string>();

  for (const status of OPEN_REVIEW_STATUSES) {
    const workItems = await ctx.db
      .query("operationalWorkItem")
      .withIndex("by_storeId_type_status", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("type", SYNCED_SALE_INVENTORY_REVIEW_TYPE)
          .eq("status", status),
      )
      .take(PRODUCT_ARCHIVE_OPEN_REVIEW_SCAN_LIMIT + 1);

    if (!withinBudget(workItems, PRODUCT_ARCHIVE_OPEN_REVIEW_SCAN_LIMIT)) {
      return {
        allowed: false,
        openSyncedSaleInventoryReviewGroupCount: null,
        reason: SYNCED_SALE_INVENTORY_REVIEW_SCAN_INCOMPLETE_REASON,
        workDiscovery: "incomplete",
      };
    }

    for (const workItem of workItems) {
      if (String(workItem.storeId) !== String(args.storeId)) continue;
      if (!belongsToProduct(workItem, { productId: args.productId, skuIds })) {
        continue;
      }

      conflictGroups.add(conflictGroupKey(workItem));
    }
  }

  if (conflictGroups.size > 0) {
    return {
      allowed: false,
      openSyncedSaleInventoryReviewGroupCount: conflictGroups.size,
      reason: OPEN_SYNCED_SALE_INVENTORY_REVIEW_ARCHIVE_REASON,
      workDiscovery: "complete",
    };
  }

  return {
    allowed: true,
    openSyncedSaleInventoryReviewGroupCount: 0,
    workDiscovery: "complete",
  };
}

/**
 * The decision is audited before the caller returns, so a rejected archive
 * still leaves an explanation behind. A thrown rejection would roll the event
 * back with the rest of the transaction, which is why blocks are returned.
 */
export async function recordProductArchiveDecision(
  ctx: MutationCtx,
  args: {
    actorUserId?: Id<"athenaUser">;
    decision: ProductArchivePreconditionDecision;
    priorAvailability: string;
    product: Doc<"product">;
  },
) {
  const { decision, product } = args;

  await recordOperationalEventWithCtx(ctx, {
    actorType: args.actorUserId ? "human" : "automation",
    actorUserId: args.actorUserId,
    eventType: decision.allowed
      ? PRODUCT_ARCHIVE_ALLOWED_EVENT_TYPE
      : PRODUCT_ARCHIVE_BLOCKED_EVENT_TYPE,
    message: decision.allowed
      ? `Archived ${product.name}.`
      : `Archiving ${product.name} is on hold.`,
    metadata: {
      openSyncedSaleInventoryReviewGroupCount:
        decision.openSyncedSaleInventoryReviewGroupCount,
      priorAvailability: args.priorAvailability,
      requestedAvailability: "archived",
      result: decision.allowed ? "allowed" : "blocked",
      workDiscovery: decision.workDiscovery,
    },
    metadataDedupeKeys: [
      "openSyncedSaleInventoryReviewGroupCount",
      "priorAvailability",
      "requestedAvailability",
      "result",
      "workDiscovery",
    ],
    organizationId: product.organizationId,
    reason: decision.allowed
      ? NO_OPEN_SYNCED_SALE_INVENTORY_REVIEW_REASON
      : decision.reason,
    storeId: product.storeId,
    subjectId: String(product._id),
    subjectLabel: product.name,
    subjectType: "product",
  });
}

export function productArchiveBlockedResult(
  decision: Extract<ProductArchivePreconditionDecision, { allowed: false }>,
): CommandResult<never> {
  return userError({
    code: "conflict",
    message: buildProductArchiveBlockedDescription({
      openSyncedSaleInventoryReviewGroupCount:
        decision.openSyncedSaleInventoryReviewGroupCount,
      reason: decision.reason,
    }),
    metadata: {
      openSyncedSaleInventoryReviewGroupCount:
        decision.openSyncedSaleInventoryReviewGroupCount,
      reason: decision.reason,
    },
    title: PRODUCT_ARCHIVE_BLOCKED_TITLE,
  });
}

/**
 * The single entry point every public product transition into `archived` must
 * pass through. Returning `null` means the caller may proceed.
 */
export async function guardProductArchiveTransition(
  ctx: MutationCtx,
  args: {
    actorUserId?: Id<"athenaUser">;
    product: Doc<"product">;
  },
): Promise<CommandResult<never> | null> {
  const decision = await evaluateProductArchivePrecondition(ctx, {
    productId: args.product._id,
    storeId: args.product.storeId,
  });

  await recordProductArchiveDecision(ctx, {
    actorUserId: args.actorUserId,
    decision,
    priorAvailability: args.product.availability,
    product: args.product,
  });

  return decision.allowed ? null : productArchiveBlockedResult(decision);
}
