import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { internalMutation, type MutationCtx } from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { createOperationalWorkItemWithCtx } from "../../../operations/operationalWorkItems";
import { recordOperationalEventWithCtx } from "../../../operations/operationalEvents";

const REVIEW_WORK_TYPE = "pos_pending_checkout_item_review";
const OPEN_REVIEW_WORK_STATUSES = ["open", "in_progress"] as const;
const ACTIONABLE_PENDING_CHECKOUT_STATUSES = new Set(["pending_review", "flagged"]);
const OPEN_WORK_SCAN_LIMIT = 1_000;
const PRODUCT_SKU_SCAN_LIMIT = 500;
const PENDING_CHECKOUT_SCAN_LIMIT = 500;
const REPAIR_WORK_ITEM_BATCH_LIMIT = 100;

type OpenReviewWorkStatus = (typeof OPEN_REVIEW_WORK_STATUSES)[number];
type PendingCheckoutReviewItem = Doc<"posPendingCheckoutItem">;

function now() {
  return Date.now();
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function matchesPendingCheckoutSource(
  workItem: Doc<"operationalWorkItem">,
  item: PendingCheckoutReviewItem,
) {
  const pendingCheckoutItemId =
    metadataString(workItem.metadata, "pendingCheckoutItemId") ??
    metadataString(workItem.metadata, "posPendingCheckoutItemId");

  return pendingCheckoutItemId === String(item._id);
}

function assertCompleteScan<T>(rows: T[], limit: number, label: string) {
  if (rows.length > limit) {
    throw new Error(
      `Too many ${label} to safely reconcile in one mutation. Run the repair path in smaller batches.`,
    );
  }
}

export function buildPendingCheckoutReviewWorkItemPriority(
  reviewPriority: PendingCheckoutReviewItem["reviewPriority"],
) {
  if (reviewPriority === "high") return "high";
  if (reviewPriority === "elevated") return "medium";
  return "normal";
}

export function buildPendingCheckoutReviewWorkItemTitle(
  item: PendingCheckoutReviewItem,
) {
  return `Review pending checkout item: ${item.name}`;
}

function buildPendingCheckoutReviewWorkItemMetadata(
  item: PendingCheckoutReviewItem,
  extra?: Record<string, unknown>,
) {
  return {
    lookupCode: item.lookupCode,
    pendingCheckoutItemId: item._id,
    price: item.provisionalPrice,
    provisionalProductId: item.provisionalProductId,
    provisionalProductSkuId: item.provisionalProductSkuId,
    reviewPriority: item.reviewPriority,
    totalQuantitySold: item.evidence.totalQuantitySold,
    transactionCount: item.evidence.transactionCount,
    ...extra,
  };
}

async function getProductSkusForProduct(
  ctx: MutationCtx,
  productId: Id<"product">,
) {
  const rows = await ctx.db
    .query("productSku")
    .withIndex("by_productId", (q) => q.eq("productId", productId))
    .take(PRODUCT_SKU_SCAN_LIMIT + 1);

  assertCompleteScan(rows, PRODUCT_SKU_SCAN_LIMIT, "product SKUs");
  return rows;
}

async function getPendingCheckoutItemsForProduct(
  ctx: MutationCtx,
  args: {
    productId: Id<"product">;
    storeId: Id<"store">;
  },
) {
  const skus = await getProductSkusForProduct(ctx, args.productId);
  const itemById = new Map<Id<"posPendingCheckoutItem">, PendingCheckoutReviewItem>();

  for (const sku of skus) {
    const items = await ctx.db
      .query("posPendingCheckoutItem")
      .withIndex("by_storeId_provisionalProductSkuId", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("provisionalProductSkuId", sku._id),
      )
      .take(PENDING_CHECKOUT_SCAN_LIMIT + 1);

    assertCompleteScan(items, PENDING_CHECKOUT_SCAN_LIMIT, "pending checkout items");

    for (const item of items) {
      if (item.provisionalProductId === args.productId) {
        itemById.set(item._id, item);
      }
    }
  }

  const productAnchoredItems = await ctx.db
    .query("posPendingCheckoutItem")
    .withIndex("by_storeId_provisionalProductId", (q) =>
      q.eq("storeId", args.storeId).eq("provisionalProductId", args.productId),
    )
    .take(PENDING_CHECKOUT_SCAN_LIMIT + 1);

  assertCompleteScan(
    productAnchoredItems,
    PENDING_CHECKOUT_SCAN_LIMIT,
    "pending checkout items",
  );

  for (const item of productAnchoredItems) {
    itemById.set(item._id, item);
  }

  return Array.from(itemById.values());
}

async function getOpenReviewWorkItemsForStore(
  ctx: MutationCtx,
  storeId: Id<"store">,
) {
  const rows: Array<Doc<"operationalWorkItem">> = [];

  for (const status of OPEN_REVIEW_WORK_STATUSES) {
    const workItems = await ctx.db
      .query("operationalWorkItem")
      .withIndex("by_storeId_type_status", (q) =>
        q.eq("storeId", storeId).eq("type", REVIEW_WORK_TYPE).eq("status", status),
      )
      .take(OPEN_WORK_SCAN_LIMIT + 1);

    assertCompleteScan(workItems, OPEN_WORK_SCAN_LIMIT, "open pending checkout review work items");
    rows.push(...workItems);
  }

  return rows;
}

function groupOpenReviewWorkByPendingCheckoutItem(
  workItems: Array<Doc<"operationalWorkItem">>,
) {
  const grouped = new Map<string, Array<Doc<"operationalWorkItem">>>();

  for (const workItem of workItems) {
    const pendingCheckoutItemId =
      metadataString(workItem.metadata, "pendingCheckoutItemId") ??
      metadataString(workItem.metadata, "posPendingCheckoutItemId");

    if (!pendingCheckoutItemId) continue;

    const existing = grouped.get(pendingCheckoutItemId) ?? [];
    existing.push(workItem);
    grouped.set(pendingCheckoutItemId, existing);
  }

  return grouped;
}

async function getOpenReviewWorkItemFromPointer(
  ctx: MutationCtx,
  item: PendingCheckoutReviewItem,
) {
  if (!item.operationalWorkItemId) return null;

  const workItem = await ctx.db.get(
    "operationalWorkItem",
    item.operationalWorkItemId,
  );
  if (
    !workItem ||
    workItem.storeId !== item.storeId ||
    workItem.type !== REVIEW_WORK_TYPE ||
    !OPEN_REVIEW_WORK_STATUSES.includes(workItem.status as OpenReviewWorkStatus)
  ) {
    return null;
  }

  return workItem;
}

async function recordLifecycleEvent(
  ctx: MutationCtx,
  args: {
    actorUserId?: Id<"athenaUser">;
    eventType: string;
    item: PendingCheckoutReviewItem;
    message: string;
    metadata: Record<string, unknown>;
    workItemId?: Id<"operationalWorkItem">;
  },
) {
  await recordOperationalEventWithCtx(ctx, {
    actorType: args.actorUserId ? "human" : "automation",
    actorUserId: args.actorUserId,
    eventType: args.eventType,
    message: args.message,
    metadata: {
      lookupCode: args.item.lookupCode,
      pendingCheckoutItemId: args.item._id,
      provisionalProductId: args.item.provisionalProductId,
      provisionalProductSkuId: args.item.provisionalProductSkuId,
      status: args.item.status,
      ...args.metadata,
    },
    metadataDedupeKeys: ["pendingCheckoutItemId", "workItemId", "reason"],
    organizationId: args.item.organizationId,
    storeId: args.item.storeId,
    subjectId: String(args.item._id),
    subjectLabel: args.item.name,
    subjectType: "pos_pending_checkout_item",
    workItemId: args.workItemId,
  });
}

async function cancelPendingCheckoutReviewWorkItem(
  ctx: MutationCtx,
  args: {
    actorUserId?: Id<"athenaUser">;
    item: PendingCheckoutReviewItem;
    reason: string;
    repairRunId?: string;
    workItem: Doc<"operationalWorkItem">;
  },
) {
  const completedAt = now();

  await ctx.db.patch("operationalWorkItem", args.workItem._id, {
    completedAt,
    metadata: {
      ...(args.workItem.metadata ?? {}),
      pendingCheckoutItemId: args.item._id,
      provisionalProductId: args.item.provisionalProductId,
      provisionalProductSkuId: args.item.provisionalProductSkuId,
      retiredAt: completedAt,
      retiredByUserId: args.actorUserId,
      retiredReason: args.reason,
      ...(args.repairRunId ? { repairRunId: args.repairRunId } : {}),
    },
    status: "cancelled",
  });

  await recordLifecycleEvent(ctx, {
    actorUserId: args.actorUserId,
    eventType: "pos_pending_checkout_item_review_work_cancelled",
    item: args.item,
    message: `Cancelled pending checkout review work for ${args.item.name}.`,
    metadata: {
      reason: args.reason,
      workItemId: args.workItem._id,
      ...(args.repairRunId ? { repairRunId: args.repairRunId } : {}),
    },
    workItemId: args.workItem._id,
  });
}

export async function retirePendingCheckoutReviewWorkForArchivedProduct(
  ctx: MutationCtx,
  args: {
    actorUserId?: Id<"athenaUser">;
    productId: Id<"product">;
    reason?: string;
    repairRunId?: string;
    storeId: Id<"store">;
  },
) {
  const [items, openWorkItems] = await Promise.all([
    getPendingCheckoutItemsForProduct(ctx, args),
    getOpenReviewWorkItemsForStore(ctx, args.storeId),
  ]);
  const openWorkByItemId = groupOpenReviewWorkByPendingCheckoutItem(openWorkItems);
  const reason = args.reason ?? "provisional_product_archived";
  const retiredWorkItemIds: Array<Id<"operationalWorkItem">> = [];
  const clearedPendingCheckoutItemIds: Array<Id<"posPendingCheckoutItem">> = [];

  for (const item of items) {
    if (!ACTIONABLE_PENDING_CHECKOUT_STATUSES.has(item.status)) continue;

    const matchingWorkItemsById = new Map<Id<"operationalWorkItem">, Doc<"operationalWorkItem">>();
    const pointerWorkItem = await getOpenReviewWorkItemFromPointer(ctx, item);

    if (pointerWorkItem) {
      matchingWorkItemsById.set(pointerWorkItem._id, pointerWorkItem);
    }

    for (const workItem of openWorkByItemId.get(String(item._id)) ?? []) {
      if (matchesPendingCheckoutSource(workItem, item)) {
        matchingWorkItemsById.set(workItem._id, workItem);
      }
    }

    const matchingWorkItems = Array.from(matchingWorkItemsById.values());
    const retiredWorkItemIdsForItem: Array<Id<"operationalWorkItem">> = [];

    for (const workItem of matchingWorkItems) {
      await cancelPendingCheckoutReviewWorkItem(ctx, {
        actorUserId: args.actorUserId,
        item,
        reason,
        repairRunId: args.repairRunId,
        workItem,
      });
      retiredWorkItemIds.push(workItem._id);
      retiredWorkItemIdsForItem.push(workItem._id);
    }

    if (
      item.operationalWorkItemId &&
      retiredWorkItemIdsForItem.includes(item.operationalWorkItemId)
    ) {
      await ctx.db.patch("posPendingCheckoutItem", item._id, {
        operationalWorkItemId: undefined,
        updatedAt: now(),
      });
      clearedPendingCheckoutItemIds.push(item._id);
    }
  }

  return {
    clearedPendingCheckoutItemIds,
    pendingCheckoutItemCount: items.length,
    retiredWorkItemIds,
  };
}

export async function ensurePendingCheckoutReviewWorkForUnarchivedProduct(
  ctx: MutationCtx,
  args: {
    actorUserId?: Id<"athenaUser">;
    productId: Id<"product">;
    storeId: Id<"store">;
  },
) {
  const [items, openWorkItems] = await Promise.all([
    getPendingCheckoutItemsForProduct(ctx, args),
    getOpenReviewWorkItemsForStore(ctx, args.storeId),
  ]);
  const openWorkByItemId = groupOpenReviewWorkByPendingCheckoutItem(openWorkItems);
  const createdWorkItemIds: Array<Id<"operationalWorkItem">> = [];
  const restoredPendingCheckoutItemIds: Array<Id<"posPendingCheckoutItem">> = [];

  for (const item of items) {
    if (!ACTIONABLE_PENDING_CHECKOUT_STATUSES.has(item.status)) continue;

    const existingWorkItem =
      (await getOpenReviewWorkItemFromPointer(ctx, item)) ??
      (openWorkByItemId.get(String(item._id)) ?? [])[0];
    if (existingWorkItem) {
      await ctx.db.patch("operationalWorkItem", existingWorkItem._id, {
        metadata: buildPendingCheckoutReviewWorkItemMetadata(item, {
          restoredReason: "provisional_product_unarchived",
        }),
        priority: buildPendingCheckoutReviewWorkItemPriority(item.reviewPriority),
        title: buildPendingCheckoutReviewWorkItemTitle(item),
      });

      if (item.operationalWorkItemId !== existingWorkItem._id) {
        await ctx.db.patch("posPendingCheckoutItem", item._id, {
          operationalWorkItemId: existingWorkItem._id,
          updatedAt: now(),
        });
        restoredPendingCheckoutItemIds.push(item._id);
      }
      continue;
    }

    const workItem = await createOperationalWorkItemWithCtx(ctx, {
      createdByUserId: args.actorUserId,
      metadata: buildPendingCheckoutReviewWorkItemMetadata(item, {
        restoredReason: "provisional_product_unarchived",
      }),
      organizationId: item.organizationId,
      priority: buildPendingCheckoutReviewWorkItemPriority(item.reviewPriority),
      status: "open",
      storeId: item.storeId,
      title: buildPendingCheckoutReviewWorkItemTitle(item),
      type: REVIEW_WORK_TYPE,
    });

    if (!workItem) continue;

    await ctx.db.patch("posPendingCheckoutItem", item._id, {
      operationalWorkItemId: workItem._id,
      updatedAt: now(),
    });
    createdWorkItemIds.push(workItem._id);
    restoredPendingCheckoutItemIds.push(item._id);

    await recordLifecycleEvent(ctx, {
      actorUserId: args.actorUserId,
      eventType: "pos_pending_checkout_item_review_work_reopened",
      item,
      message: `Opened pending checkout review work for ${item.name}.`,
      metadata: {
        reason: "provisional_product_unarchived",
        workItemId: workItem._id,
      },
      workItemId: workItem._id,
    });
  }

  return {
    createdWorkItemIds,
    pendingCheckoutItemCount: items.length,
    restoredPendingCheckoutItemIds,
  };
}

function isActionablePendingCheckoutItem(
  item: Doc<"posPendingCheckoutItem"> | null,
): item is Doc<"posPendingCheckoutItem"> {
  return item !== null && ACTIONABLE_PENDING_CHECKOUT_STATUSES.has(item.status);
}

export const repairArchivedPendingCheckoutReviewWork = internalMutation({
  args: {
    dryRun: v.boolean(),
    paginationOpts: v.optional(paginationOptsValidator),
    repairRunId: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("in_progress")),
    storeId: v.id("store"),
    workItemIds: v.optional(v.array(v.id("operationalWorkItem"))),
  },
  handler: async (ctx, args) => {
    if (args.workItemIds && args.workItemIds.length > REPAIR_WORK_ITEM_BATCH_LIMIT) {
      throw new Error(
        `Repair batches are limited to ${REPAIR_WORK_ITEM_BATCH_LIMIT} work items.`,
      );
    }

    if (args.dryRun && !args.paginationOpts) {
      throw new Error("Provide pagination options for repair dry runs.");
    }

    if (!args.dryRun && (!args.repairRunId || !args.workItemIds?.length)) {
      throw new Error("Provide a repair run id and explicit dry-run candidate work item ids to repair.");
    }

    const page = args.workItemIds
      ? {
          continueCursor: null,
          isDone: true,
          page: (
            await Promise.all(args.workItemIds.map((id) => ctx.db.get("operationalWorkItem", id)))
          ).filter((row): row is Doc<"operationalWorkItem"> => row !== null),
        }
      : await ctx.db
          .query("operationalWorkItem")
          .withIndex("by_storeId_type_status", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("type", REVIEW_WORK_TYPE)
              .eq("status", args.status),
          )
          .paginate(args.paginationOpts!);
    const repaired: Array<Id<"operationalWorkItem">> = [];
    const candidates: Array<Id<"operationalWorkItem">> = [];
    const skipped: Array<{ workItemId: Id<"operationalWorkItem">; reason: string }> = [];

    for (const workItem of page.page) {
      if (
        workItem.storeId !== args.storeId ||
        workItem.type !== REVIEW_WORK_TYPE ||
        workItem.status !== args.status
      ) {
        skipped.push({ workItemId: workItem._id, reason: "work_item_no_longer_matches_repair_scope" });
        continue;
      }

      const pendingCheckoutItemId =
        metadataString(workItem.metadata, "pendingCheckoutItemId") ??
        metadataString(workItem.metadata, "posPendingCheckoutItemId");

      if (!pendingCheckoutItemId) {
        skipped.push({ workItemId: workItem._id, reason: "missing_pending_checkout_item_id" });
        continue;
      }

      const normalizedPendingCheckoutItemId = ctx.db.normalizeId(
        "posPendingCheckoutItem",
        pendingCheckoutItemId,
      );
      if (!normalizedPendingCheckoutItemId) {
        skipped.push({ workItemId: workItem._id, reason: "invalid_pending_checkout_item_id" });
        continue;
      }

      const item = await ctx.db.get(
        "posPendingCheckoutItem",
        normalizedPendingCheckoutItemId,
      );
      if (!isActionablePendingCheckoutItem(item)) {
        skipped.push({ workItemId: workItem._id, reason: "pending_checkout_item_not_actionable" });
        continue;
      }

      if (item.storeId !== args.storeId) {
        skipped.push({ workItemId: workItem._id, reason: "pending_checkout_item_wrong_store" });
        continue;
      }

      const productId =
        item.provisionalProductId ??
        (metadataString(workItem.metadata, "provisionalProductId") as Id<"product"> | null);
      if (!productId) {
        skipped.push({ workItemId: workItem._id, reason: "missing_provisional_product" });
        continue;
      }

      const normalizedProductId = ctx.db.normalizeId("product", productId);
      if (!normalizedProductId) {
        skipped.push({ workItemId: workItem._id, reason: "invalid_provisional_product" });
        continue;
      }

      const product = await ctx.db.get("product", normalizedProductId);
      if (!product || product.storeId !== args.storeId) {
        skipped.push({ workItemId: workItem._id, reason: "provisional_product_missing" });
        continue;
      }

      if (product.availability !== "archived") {
        skipped.push({ workItemId: workItem._id, reason: "provisional_product_not_archived" });
        continue;
      }

      candidates.push(workItem._id);

      if (!args.dryRun) {
        await cancelPendingCheckoutReviewWorkItem(ctx, {
          item,
          reason: "archived_provisional_product_repair",
          repairRunId: args.repairRunId,
          workItem,
        });

        if (item.operationalWorkItemId === workItem._id) {
          await ctx.db.patch("posPendingCheckoutItem", item._id, {
            operationalWorkItemId: undefined,
            updatedAt: now(),
          });
        }

        repaired.push(workItem._id);
      }
    }

    return {
      candidates,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      repaired,
      skipped,
      status: args.status,
    };
  },
});
