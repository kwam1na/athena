import { v } from "convex/values";

import type { Doc, Id, TableNames } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { commandResultValidator } from "../lib/commandResultValidators";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { recordOperationalEventWithCtx } from "./operationalEvents";

const SYNCED_SALE_INVENTORY_REVIEW_TYPE = "synced_sale_inventory_review";
const INVENTORY_REVIEW_LOCAL_ID_KIND = "inventoryReviewWorkItem";
const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);
const STOCK_UPDATE_SOURCE_TYPE = "stock_adjustment_batch";
const STOCK_UPDATE_MOVEMENT_TYPES = new Set(["adjustment", "cycle_count"]);
const AUTO_RESOLVE_STOCK_REVIEW_SCAN_LIMIT = 500;
const AUTO_RESOLVE_STOCK_REVIEW_SKU_PROBE_LIMIT = 100;
const AUTO_RESOLVE_STOCK_REVIEW_REASON =
  "Resolved by applied stock adjustment.";

const syncedSaleInventoryReviewOutcomeValidator = v.union(
  v.literal("completed"),
  v.literal("dismissed"),
  v.literal("cancelled"),
  v.literal("superseded"),
);

type SyncedSaleInventoryReviewOutcome =
  | "completed"
  | "dismissed"
  | "cancelled"
  | "superseded";

type ResolveSyncedSaleInventoryReviewArgs = {
  actorStaffProfileId?: Id<"staffProfile">;
  localRegisterSessionId?: string;
  localTransactionId?: string;
  outcome: SyncedSaleInventoryReviewOutcome;
  reason: string;
  receiptNumber?: string;
  registerSessionId?: Id<"registerSession">;
  sourceId?: Id<"posTransaction">;
  storeId: Id<"store">;
  terminalId?: Id<"posTerminal">;
  workItemId: Id<"operationalWorkItem">;
};

type ResolveSyncedSaleInventoryReviewData = {
  action: "resolved";
  outcome: SyncedSaleInventoryReviewOutcome;
  status: "completed" | "cancelled";
  workItemId: Id<"operationalWorkItem">;
};

type AutoResolveSyncedSaleInventoryReviewsArgs = {
  actorUserId?: Id<"athenaUser">;
  inventoryMovements: Doc<"inventoryMovement">[];
  organizationId?: Id<"organization">;
  stockAdjustmentBatchId: Id<"stockAdjustmentBatch">;
  storeId: Id<"store">;
};

function inventoryReviewLocalId(localTransactionId: string) {
  return `${localTransactionId}:inventory-review`;
}

function stringMetadataValue(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

function validationError(message: string) {
  return userError({
    code: "validation_failed",
    message,
  });
}

function conflictError(message: string) {
  return userError({
    code: "conflict",
    message,
  });
}

function idMetadataValue<TableName extends TableNames>(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = stringMetadataValue(metadata, key);
  return value as Id<TableName> | null;
}

function optionalMetadataMatches(
  metadata: Record<string, unknown>,
  key: string,
  value: string | undefined,
) {
  return !value || stringMetadataValue(metadata, key) === value;
}

async function findPostReviewStockUpdateWithCtx(
  ctx: MutationCtx,
  args: {
    createdAt: number;
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
  },
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- SKU-scoped stock adjustments are bounded by one operational SKU review.
  const movements = await ctx.db
    .query("inventoryMovement")
    .withIndex("by_storeId_productSkuId", (q) =>
      q.eq("storeId", args.storeId).eq("productSkuId", args.productSkuId),
    )
    .collect();

  return (
    movements
      .filter(
        (movement) =>
          movement.createdAt >= args.createdAt &&
          movement.sourceType === STOCK_UPDATE_SOURCE_TYPE &&
          STOCK_UPDATE_MOVEMENT_TYPES.has(movement.movementType),
      )
      .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
  );
}

async function readPositiveCurrentInventoryProofWithCtx(
  ctx: MutationCtx,
  args: {
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
  },
) {
  const productSku = await ctx.db.get("productSku", args.productSkuId);
  if (
    !productSku ||
    productSku.storeId !== args.storeId ||
    productSku.inventoryCount <= 0
  ) {
    return null;
  }

  return {
    inventoryCount: productSku.inventoryCount,
    productSkuId: args.productSkuId,
    proofKind: "current_inventory_state" as const,
    quantityAvailable: productSku.quantityAvailable,
    reviewedAt: Date.now(),
  };
}

function terminalStatusForOutcome(
  outcome: SyncedSaleInventoryReviewOutcome,
): "completed" | "cancelled" {
  return outcome === "completed" ? "completed" : "cancelled";
}

function sourceMetadataFromWorkItem(metadata: Record<string, unknown>) {
  const localTransactionId = stringMetadataValue(metadata, "localTransactionId");

  return {
    localId: localTransactionId
      ? inventoryReviewLocalId(localTransactionId)
      : null,
    localIdKind: INVENTORY_REVIEW_LOCAL_ID_KIND,
    localRegisterSessionId: stringMetadataValue(
      metadata,
      "localRegisterSessionId",
    ),
    localTransactionId,
    receiptNumber: stringMetadataValue(metadata, "receiptNumber"),
    registerSessionId: idMetadataValue<"registerSession">(
      metadata,
      "registerSessionId",
    ),
    sourceId: idMetadataValue<"posTransaction">(metadata, "sourceId"),
    terminalId: idMetadataValue<"posTerminal">(metadata, "terminalId"),
  };
}

async function readOpenSyncedSaleInventoryReviewWorkItemsWithCtx(
  ctx: MutationCtx,
  args: {
    productSkuId: Id<"productSku">;
    status: "open" | "in_progress";
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("operationalWorkItem")
    .withIndex("by_storeId_type_status_productSkuId", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("type", SYNCED_SALE_INVENTORY_REVIEW_TYPE)
        .eq("status", args.status)
        .eq("productSkuId", args.productSkuId),
    )
    .take(AUTO_RESOLVE_STOCK_REVIEW_SCAN_LIMIT);
}

async function readLegacyOpenSyncedSaleInventoryReviewWorkItemsWithCtx(
  ctx: MutationCtx,
  args: {
    productSkuIds: Set<Id<"productSku">>;
    status: "open" | "in_progress";
    storeId: Id<"store">;
  },
) {
  const rows = await ctx.db
    .query("operationalWorkItem")
    .withIndex("by_storeId_type_status", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("type", SYNCED_SALE_INVENTORY_REVIEW_TYPE)
        .eq("status", args.status),
    )
    .take(AUTO_RESOLVE_STOCK_REVIEW_SCAN_LIMIT + 1);

  if (rows.length > AUTO_RESOLVE_STOCK_REVIEW_SCAN_LIMIT) {
    throw new Error(
      "Too many synced sale inventory review work items to scan for legacy auto-resolution. Resolve older inventory review work and retry.",
    );
  }

  return rows.filter((workItem) => {
    if (workItem.productSkuId) return false;
    const primaryProductSkuId = idMetadataValue<"productSku">(
      workItem.metadata ?? {},
      "primaryProductSkuId",
    );
    return Boolean(
      primaryProductSkuId && args.productSkuIds.has(primaryProductSkuId),
    );
  });
}

export async function autoResolveSyncedSaleInventoryReviewsForStockAdjustmentWithCtx(
  ctx: MutationCtx,
  args: AutoResolveSyncedSaleInventoryReviewsArgs,
) {
  const movementsBySkuId = new Map<
    Id<"productSku">,
    Doc<"inventoryMovement">
  >();

  for (const movement of args.inventoryMovements) {
    if (
      movement.storeId !== args.storeId ||
      movement.sourceType !== STOCK_UPDATE_SOURCE_TYPE ||
      !STOCK_UPDATE_MOVEMENT_TYPES.has(movement.movementType) ||
      !movement.productSkuId
    ) {
      continue;
    }

    const existingMovement = movementsBySkuId.get(movement.productSkuId);
    if (!existingMovement || movement.createdAt > existingMovement.createdAt) {
      movementsBySkuId.set(movement.productSkuId, movement);
    }
  }

  if (movementsBySkuId.size === 0) {
    return { resolvedCount: 0 };
  }
  if (movementsBySkuId.size > AUTO_RESOLVE_STOCK_REVIEW_SKU_PROBE_LIMIT) {
    return { resolvedCount: 0 };
  }

  const workItemGroups = [];
  const productSkuIds = Array.from(movementsBySkuId.keys());
  for (const status of ["open", "in_progress"] as const) {
    for (const productSkuId of productSkuIds) {
      workItemGroups.push(
        await readOpenSyncedSaleInventoryReviewWorkItemsWithCtx(ctx, {
          productSkuId,
          status,
          storeId: args.storeId,
        }),
      );
    }
    workItemGroups.push(
      await readLegacyOpenSyncedSaleInventoryReviewWorkItemsWithCtx(ctx, {
        productSkuIds: new Set(productSkuIds),
        status,
        storeId: args.storeId,
      }),
    );
  }
  const resolvedAt = Date.now();
  let resolvedCount = 0;

  for (const workItem of workItemGroups.flat()) {
    const metadata = workItem.metadata ?? {};
    const primaryProductSkuId = idMetadataValue<"productSku">(
      metadata,
      "primaryProductSkuId",
    );
    const stockUpdate = primaryProductSkuId
      ? movementsBySkuId.get(primaryProductSkuId)
      : null;

    if (!primaryProductSkuId || !stockUpdate) {
      continue;
    }
    if (stockUpdate.createdAt < workItem.createdAt) {
      continue;
    }

    const domainTrace = {
      boundary:
        "operations.openWorkInventoryReviews.autoResolveSyncedSaleInventoryReviewsForStockAdjustment",
      inventoryMovementId: stockUpdate._id,
      proofKind: "stock_update_movement",
      stockAdjustmentBatchId: args.stockAdjustmentBatchId,
    };
    const resolution = {
      ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
      authority: {
        kind: "system",
        reason: "stock_adjustment_applied",
      },
      domainTrace,
      outcome: "completed" as const,
      priorState: {
        status: workItem.status,
      },
      reason: AUTO_RESOLVE_STOCK_REVIEW_REASON,
      resolvedAt,
      source: sourceMetadataFromWorkItem(metadata),
      stockState: null,
      stockUpdate: {
        createdAt: stockUpdate.createdAt,
        inventoryMovementId: stockUpdate._id,
        movementType: stockUpdate.movementType,
        productSkuId: primaryProductSkuId,
        quantityDelta: stockUpdate.quantityDelta,
        reasonCode: stockUpdate.reasonCode ?? null,
        sourceId: stockUpdate.sourceId,
        sourceType: stockUpdate.sourceType,
      },
      nextState: {
        status: "completed" as const,
      },
    };

    await ctx.db.patch("operationalWorkItem", workItem._id, {
      completedAt: resolvedAt,
      metadata: {
        ...metadata,
        resolution,
      },
      status: "completed",
    });

    await recordOperationalEventWithCtx(ctx, {
      actorUserId: args.actorUserId,
      eventType: "synced_sale_inventory_review_completed",
      message: "Synced sale inventory review completed by stock adjustment.",
      organizationId: workItem.organizationId ?? args.organizationId,
      reason: AUTO_RESOLVE_STOCK_REVIEW_REASON,
      storeId: args.storeId,
      subjectId: workItem._id,
      subjectLabel: workItem.title,
      subjectType: SYNCED_SALE_INVENTORY_REVIEW_TYPE,
      workItemId: workItem._id,
      metadata: {
        authority: resolution.authority,
        domainTrace,
        inventoryMovementId: stockUpdate._id,
        nextState: resolution.nextState,
        outcome: resolution.outcome,
        priorState: resolution.priorState,
        reason: resolution.reason,
        source: resolution.source,
        stockState: null,
        stockUpdate: resolution.stockUpdate,
        terminalAudit: null,
      },
    });

    resolvedCount += 1;
  }

  return { resolvedCount };
}

export async function resolveSyncedSaleInventoryReviewWithCtx(
  ctx: MutationCtx,
  args: ResolveSyncedSaleInventoryReviewArgs,
): Promise<CommandResult<ResolveSyncedSaleInventoryReviewData>> {
  if (!args.reason.trim()) {
    return validationError("Reason is required to resolve inventory review work.");
  }

  const [athenaUser, workItem, store] = await Promise.all([
    requireAuthenticatedAthenaUserWithCtx(ctx),
    ctx.db.get("operationalWorkItem", args.workItemId),
    ctx.db.get("store", args.storeId),
  ]);
  if (!store) {
    return userError({
      code: "not_found",
      message: "Store not found.",
    });
  }
  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin"],
    failureMessage: "Only store admins can resolve inventory review work.",
    organizationId: store.organizationId,
    userId: athenaUser._id,
  });

  if (!workItem || workItem.storeId !== args.storeId) {
    return userError({
      code: "not_found",
      message: "Inventory review work item not found for this store.",
    });
  }
  if (
    workItem.organizationId !== store.organizationId ||
    workItem.type !== SYNCED_SALE_INVENTORY_REVIEW_TYPE
  ) {
    return validationError("Work item is not a synced sale inventory review.");
  }
  if (TERMINAL_STATUSES.has(workItem.status)) {
    return conflictError("Inventory review work is already terminal.");
  }
  if (workItem.status !== "open" && workItem.status !== "in_progress") {
    return conflictError("Inventory review work is not currently resolvable.");
  }

  const actorStaffProfile = await ctx.db
    .query("staffProfile")
    .withIndex("by_storeId_linkedUserId", (q) =>
      q.eq("storeId", args.storeId).eq("linkedUserId", athenaUser._id),
    )
    .first();

  if (
    args.actorStaffProfileId &&
    (!actorStaffProfile || actorStaffProfile._id !== args.actorStaffProfileId)
  ) {
    return validationError(
      "Staff attribution does not match the authenticated user.",
    );
  }

  const actorStaffProfileId = actorStaffProfile?._id;
  const metadata = workItem.metadata ?? {};
  const primaryProductSkuId = idMetadataValue<"productSku">(
    metadata,
    "primaryProductSkuId",
  );
  if (!primaryProductSkuId) {
    return validationError(
      "Inventory review work item is missing the affected SKU.",
    );
  }

  const stockUpdate = await findPostReviewStockUpdateWithCtx(ctx, {
    createdAt: workItem.createdAt,
    productSkuId: primaryProductSkuId,
    storeId: args.storeId,
  });
  const stockState = stockUpdate
    ? null
    : await readPositiveCurrentInventoryProofWithCtx(ctx, {
        productSkuId: primaryProductSkuId,
        storeId: args.storeId,
      });
  if (!stockUpdate && !stockState) {
    return validationError(
      "Update the affected SKU's stock count before marking this inventory review complete.",
    );
  }

  const terminal = args.terminalId
    ? await ctx.db.get("posTerminal", args.terminalId)
    : null;
  if (args.terminalId && (!terminal || terminal.storeId !== args.storeId)) {
    return validationError("Terminal does not match the inventory review store.");
  }

  const registerSession = args.registerSessionId
    ? await ctx.db.get("registerSession", args.registerSessionId)
    : null;
  if (args.registerSessionId) {
    if (!registerSession || registerSession.storeId !== args.storeId) {
      return validationError(
        "Register session does not match the inventory review terminal.",
      );
    }
    if (args.terminalId && registerSession.terminalId !== args.terminalId) {
      return validationError(
        "Register session does not match the inventory review terminal.",
      );
    }
  }

  const sale = args.sourceId
    ? await ctx.db.get("posTransaction", args.sourceId)
    : null;
  if (args.sourceId) {
    if (!sale || sale.storeId !== args.storeId) {
      return validationError("Sale does not match the inventory review context.");
    }
    if (
      args.registerSessionId &&
      sale.registerSessionId !== args.registerSessionId
    ) {
      return validationError("Sale does not match the inventory review context.");
    }
    if (args.terminalId && sale.terminalId !== args.terminalId) {
      return validationError("Sale does not match the inventory review context.");
    }
  }

  if (
    !optionalMetadataMatches(
      metadata,
      "localRegisterSessionId",
      args.localRegisterSessionId,
    ) ||
    !optionalMetadataMatches(
      metadata,
      "localTransactionId",
      args.localTransactionId,
    ) ||
    !optionalMetadataMatches(
      metadata,
      "registerSessionId",
      args.registerSessionId,
    ) ||
    !optionalMetadataMatches(metadata, "sourceId", args.sourceId) ||
    !optionalMetadataMatches(metadata, "terminalId", args.terminalId)
  ) {
    return validationError("Work item metadata does not match the sale context.");
  }
  if (
    args.receiptNumber &&
    stringMetadataValue(metadata, "receiptNumber") !== args.receiptNumber
  ) {
    return validationError("Receipt number does not match the inventory review.");
  }
  if (args.receiptNumber && sale && sale.transactionNumber !== args.receiptNumber) {
    return validationError("Sale receipt does not match the inventory review.");
  }

  const resolvedAt = Date.now();
  const status = terminalStatusForOutcome(args.outcome);
  const canonicalLocalId = args.localTransactionId
    ? inventoryReviewLocalId(args.localTransactionId)
    : null;
  const terminalIdFromMetadata = idMetadataValue<"posTerminal">(
    metadata,
    "terminalId",
  );
  const registerNumber =
    terminal?.registerNumber ?? registerSession?.registerNumber;
  const resolution = {
    actorStaffProfileId,
    actorUserId: athenaUser._id,
    authority: {
      kind: "organization_member_role",
      role: "full_admin",
    },
    domainTrace: {
      boundary:
        "operations.openWorkInventoryReviews.resolveSyncedSaleInventoryReview",
      proofKind: stockUpdate ? "stock_update_movement" : "current_inventory_state",
      ...(stockUpdate ? { inventoryMovementId: stockUpdate._id } : {}),
    },
    outcome: args.outcome,
    priorState: {
      status: workItem.status,
    },
    reason: args.reason.trim(),
    resolvedAt,
    source: {
      localId: canonicalLocalId,
      localIdKind: INVENTORY_REVIEW_LOCAL_ID_KIND,
      localRegisterSessionId:
        args.localRegisterSessionId ??
        stringMetadataValue(metadata, "localRegisterSessionId"),
      localTransactionId:
        args.localTransactionId ??
        stringMetadataValue(metadata, "localTransactionId"),
      receiptNumber:
        args.receiptNumber ?? stringMetadataValue(metadata, "receiptNumber"),
      registerSessionId:
        args.registerSessionId ?? idMetadataValue<"registerSession">(
          metadata,
          "registerSessionId",
        ),
      sourceId:
        args.sourceId ?? idMetadataValue<"posTransaction">(
          metadata,
          "sourceId",
        ),
      terminalId: args.terminalId ?? terminalIdFromMetadata,
    },
    stockState,
    stockUpdate: stockUpdate
      ? {
          createdAt: stockUpdate.createdAt,
          inventoryMovementId: stockUpdate._id,
          movementType: stockUpdate.movementType,
          productSkuId: primaryProductSkuId,
          quantityDelta: stockUpdate.quantityDelta,
          reasonCode: stockUpdate.reasonCode,
          sourceId: stockUpdate.sourceId,
          sourceType: stockUpdate.sourceType,
        }
      : null,
    ...(terminal || registerNumber
      ? {
          terminalAudit: {
            displayName: terminal?.displayName,
            registerNumber,
            terminalId: args.terminalId ?? terminalIdFromMetadata,
          },
        }
      : {}),
    nextState: {
      status,
    },
  };

  await ctx.db.patch("operationalWorkItem", args.workItemId, {
    ...(status === "completed" ? { completedAt: resolvedAt } : {}),
    metadata: {
      ...metadata,
      resolution,
    },
    status,
  });

  await recordOperationalEventWithCtx(ctx, {
    actorStaffProfileId,
    actorUserId: athenaUser._id,
    eventType: `synced_sale_inventory_review_${status}`,
    message:
      status === "completed"
        ? "Synced sale inventory review completed."
        : "Synced sale inventory review cancelled.",
    organizationId: store.organizationId,
    reason: args.reason.trim(),
    storeId: args.storeId,
    subjectId: args.workItemId,
    subjectLabel: workItem.title,
    subjectType: SYNCED_SALE_INVENTORY_REVIEW_TYPE,
    workItemId: args.workItemId,
    metadata: {
      authority: resolution.authority,
      domainTrace: resolution.domainTrace,
      inventoryMovementId: stockUpdate?._id,
      nextState: resolution.nextState,
      outcome: args.outcome,
      priorState: resolution.priorState,
      reason: resolution.reason,
      source: resolution.source,
      stockState: resolution.stockState,
      stockUpdate: resolution.stockUpdate,
      terminalAudit: "terminalAudit" in resolution ? resolution.terminalAudit : null,
    },
  });

  return ok({
    action: "resolved",
    outcome: args.outcome,
    status,
    workItemId: args.workItemId,
  });
}

export const resolveSyncedSaleInventoryReview = mutation({
  args: {
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    localRegisterSessionId: v.optional(v.string()),
    localTransactionId: v.optional(v.string()),
    outcome: syncedSaleInventoryReviewOutcomeValidator,
    reason: v.string(),
    receiptNumber: v.optional(v.string()),
    registerSessionId: v.optional(v.id("registerSession")),
    sourceId: v.optional(v.id("posTransaction")),
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
    workItemId: v.id("operationalWorkItem"),
  },
  returns: commandResultValidator(v.any()),
  handler: resolveSyncedSaleInventoryReviewWithCtx,
});
