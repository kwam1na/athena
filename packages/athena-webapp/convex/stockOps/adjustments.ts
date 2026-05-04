import { mutation, query, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { buildApprovalRequest } from "../operations/approvalRequestHelpers";
import { recordInventoryMovementWithCtx } from "../operations/inventoryMovements";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import {
  createOperationalWorkItemWithCtx,
  updateOperationalWorkItemStatusWithCtx,
} from "../operations/operationalWorkItems";
import {
  CYCLE_COUNT_REASON_CODE,
  MANUAL_STOCK_ADJUSTMENT_REASON_CODES,
  STOCK_ADJUSTMENT_APPROVAL_THRESHOLD,
  assertStockAdjustmentReasonCode,
  calculateCycleCountQuantityDelta,
  requiresStockAdjustmentApproval,
  resolveStockAdjustmentQuantityDelta,
  summarizeStockAdjustmentLineItems,
} from "../../shared/stockAdjustment";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { commandResultValidator } from "../lib/commandResultValidators";

export {
  CYCLE_COUNT_REASON_CODE,
  MANUAL_STOCK_ADJUSTMENT_REASON_CODES,
  STOCK_ADJUSTMENT_APPROVAL_THRESHOLD,
  assertStockAdjustmentReasonCode,
  calculateCycleCountQuantityDelta,
  requiresStockAdjustmentApproval,
  resolveStockAdjustmentQuantityDelta,
  summarizeStockAdjustmentLineItems,
} from "../../shared/stockAdjustment";

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

const UNCATEGORIZED_SCOPE_KEY = "__uncategorized";
const TEMPORARY_DELETE_SCOPE_CONFIRMATION =
  "delete-stock-adjustment-scope-skus";

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

function getStockAdjustmentScopeKey(categoryName?: string | null) {
  return categoryName?.trim() || UNCATEGORIZED_SCOPE_KEY;
}

async function listProductSkusForStockAdjustmentScopeWithCtx(
  ctx: MutationCtx,
  args: {
    scopeKey: string;
    storeId: Id<"store">;
  }
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Temporary cleanup mutation intentionally scans the selected store scope once.
  const productSkus = await ctx.db
    .query("productSku")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .collect();
  const productIds = Array.from(
    new Set(productSkus.map((productSku) => productSku.productId))
  );
  const products = await Promise.all(
    productIds.map((productId) => ctx.db.get("product", productId))
  );
  const productMap = new Map<
    Id<"product">,
    NonNullable<(typeof products)[number]>
  >();
  products.forEach((product) => {
    if (product) {
      productMap.set(product._id, product);
    }
  });
  const categoryIds = Array.from(
    new Set(products.map((product) => product?.categoryId).filter(Boolean))
  ) as Id<"category">[];
  const categories = await Promise.all(
    categoryIds.map((categoryId) => ctx.db.get("category", categoryId))
  );
  const categoryMap = new Map<
    Id<"category">,
    NonNullable<(typeof categories)[number]>
  >();
  categories.forEach((category) => {
    if (category) {
      categoryMap.set(category._id, category);
    }
  });

  return productSkus.filter((productSku) => {
    const product = productMap.get(productSku.productId);
    const category = product?.categoryId
      ? categoryMap.get(product.categoryId)
      : null;

    return getStockAdjustmentScopeKey(category?.name) === args.scopeKey;
  });
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
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- This workspace needs the full store SKU snapshot so operators can reconcile counts across the entire catalog in one pass.
    const productSkus = await ctx.db
      .query("productSku")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();

    const productIds = Array.from(
      new Set(productSkus.map((productSku) => productSku.productId))
    );
    const colorIds = Array.from(
      new Set(productSkus.map((productSku) => productSku.color).filter(Boolean))
    ) as Id<"color">[];

    const [products, colors] = await Promise.all([
      Promise.all(productIds.map((productId) => ctx.db.get("product", productId))),
      Promise.all(colorIds.map((colorId) => ctx.db.get("color", colorId))),
    ]);

    const productMap = new Map<
      Id<"product">,
      NonNullable<(typeof products)[number]>
    >();
    products.forEach((product) => {
      if (product) {
        productMap.set(product._id, product);
      }
    });
    const categoryIds = Array.from(
      new Set(
        products
          .map((product) => product?.categoryId)
          .filter(Boolean)
      )
    ) as Id<"category">[];
    const categories = await Promise.all(
      categoryIds.map((categoryId) => ctx.db.get("category", categoryId))
    );
    const categoryMap = new Map<
      Id<"category">,
      NonNullable<(typeof categories)[number]>
    >();
    categories.forEach((category) => {
      if (category) {
        categoryMap.set(category._id, category);
      }
    });
    const colorMap = new Map<Id<"color">, NonNullable<(typeof colors)[number]>>();
    colors.forEach((color) => {
      if (color) {
        colorMap.set(color._id, color);
      }
    });

    return productSkus
      .map((productSku) => {
        const product = productMap.get(productSku.productId);
        const category = product?.categoryId
          ? categoryMap.get(product.categoryId)
          : null;
        const color = productSku.color ? colorMap.get(productSku.color) : null;

        return {
          _id: productSku._id,
          barcode: productSku.barcode ?? null,
          colorName: color?.name ?? null,
          imageUrl: productSku.images[0] ?? null,
          inventoryCount: productSku.inventoryCount,
          length: productSku.length ?? null,
          productCategory: category?.name ?? null,
          productId: productSku.productId,
          productName:
            product?.name ??
            productSku.productName ??
            productSku.sku ??
            String(productSku._id),
          quantityAvailable: productSku.quantityAvailable,
          sku: productSku.sku ?? null,
        };
      })
      .sort((left, right) => {
        const nameCompare = left.productName.localeCompare(right.productName);
        if (nameCompare !== 0) {
          return nameCompare;
        }

        return (left.sku ?? "").localeCompare(right.sku ?? "");
      });
  },
});

export async function temporaryDeleteStockAdjustmentScopeSkusWithCtx(
  ctx: MutationCtx,
  args: {
    confirmation?: string;
    dryRun?: boolean;
    scopeKey: string;
    storeId: Id<"store">;
  }
) {
  const store = await ctx.db.get("store", args.storeId);

  if (!store) {
    throw new Error("Store not found.");
  }

  const actorUser = await requireAuthenticatedAthenaUserWithCtx(ctx);

  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin"],
    failureMessage: "Only full admins can delete stock cleanup SKUs.",
    organizationId: store.organizationId,
    userId: actorUser._id,
  });

  const scopeKey = args.scopeKey.trim();

  if (!scopeKey) {
    throw new Error("A stock cleanup scope key is required.");
  }

  const candidateSkus = await listProductSkusForStockAdjustmentScopeWithCtx(ctx, {
    scopeKey,
    storeId: args.storeId,
  });
  const response = {
    deletedCount: 0,
    dryRun: args.dryRun ?? true,
    productSkuIds: candidateSkus.map((sku) => sku._id),
    scopeKey,
  };

  if (args.dryRun !== false) {
    return response;
  }

  if (args.confirmation !== TEMPORARY_DELETE_SCOPE_CONFIRMATION) {
    throw new Error(
      `Pass confirmation "${TEMPORARY_DELETE_SCOPE_CONFIRMATION}" to delete these SKUs.`
    );
  }

  await Promise.all(
    candidateSkus.map((productSku) => ctx.db.delete("productSku", productSku._id))
  );

  return {
    ...response,
    deletedCount: candidateSkus.length,
    dryRun: false,
  };
}

export const temporaryDeleteStockAdjustmentScopeSkus = mutation({
  args: {
    confirmation: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    scopeKey: v.string(),
    storeId: v.id("store"),
  },
  handler: temporaryDeleteStockAdjustmentScopeSkusWithCtx,
});

type SubmitStockAdjustmentBatchArgs = {
  adjustmentType: "manual" | "cycle_count";
  lineItems: StockAdjustmentInputLineItem[];
  notes?: string;
  reasonCode: string;
  storeId: Id<"store">;
  submissionKey: string;
};

export async function submitStockAdjustmentBatchWithCtx(
  ctx: MutationCtx,
  args: SubmitStockAdjustmentBatchArgs
) {
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

  const createdByUser = await requireAuthenticatedAthenaUserWithCtx(ctx);

  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin", "pos_only"],
    failureMessage: "You do not have permission to adjust stock for this store.",
    organizationId: store.organizationId,
    userId: createdByUser._id,
  });

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
    createdByUserId: createdByUser._id,
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
      createdByUserId: createdByUser._id,
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
          requestedByUserId: createdByUser._id,
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
      actorUserId: createdByUser._id,
      batchId: stockAdjustmentBatchId,
      lineItems: normalizedLineItems,
      notes,
      organizationId: store.organizationId,
      reasonCode: args.reasonCode as StockAdjustmentReasonCode,
      storeId: args.storeId,
    });
  }

  await recordOperationalEventWithCtx(ctx, {
    actorUserId: createdByUser._id,
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
}

function mapSubmitStockAdjustmentBatchError(
  error: unknown
): CommandResult<never> | null {
  const message = error instanceof Error ? error.message : "";

  if (message === "Sign in again to continue.") {
    return userError({
      code: "authentication_failed",
      message,
    });
  }

  if (message === "You do not have permission to adjust stock for this store.") {
    return userError({
      code: "authorization_failed",
      message,
    });
  }

  if (
    message === "Store not found." ||
    message === "Selected SKU could not be found for this store." ||
    message === "Stock adjustment SKU not found for this store."
  ) {
    return userError({
      code: "not_found",
      message,
    });
  }

  if (
    message === "A stock-adjustment submission key is required." ||
    message === "Stock adjustment batches require at least one line item." ||
    message === "Stock adjustment batches cannot include the same SKU twice." ||
    message === "Manual stock adjustments require a supported reason code." ||
    message === "Cycle counts must reconcile with the cycle-count reason code." ||
    message ===
      "Manual stock adjustments require a whole-unit delta for every selected SKU." ||
    message ===
      "Cycle counts require an integer counted quantity for every selected SKU." ||
    message ===
      "Stock adjustments must change inventory by at least one unit." ||
    message === "Stock adjustments cannot reduce inventory below zero."
  ) {
    return userError({
      code: "validation_failed",
      message,
    });
  }

  return null;
}

export async function submitStockAdjustmentBatchCommandWithCtx(
  ctx: MutationCtx,
  args: SubmitStockAdjustmentBatchArgs
): Promise<CommandResult<any>> {
  try {
    return ok(await submitStockAdjustmentBatchWithCtx(ctx, args));
  } catch (error) {
    const result = mapSubmitStockAdjustmentBatchError(error);

    if (result) {
      return result;
    }

    throw error;
  }
}

export const submitStockAdjustmentBatch = mutation({
  args: {
    adjustmentType: v.union(v.literal("manual"), v.literal("cycle_count")),
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
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) =>
    submitStockAdjustmentBatchCommandWithCtx(ctx, args),
});
