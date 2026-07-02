import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
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

function terminalStatusForOutcome(
  outcome: SyncedSaleInventoryReviewOutcome,
): "completed" | "cancelled" {
  return outcome === "completed" ? "completed" : "cancelled";
}

export async function resolveSyncedSaleInventoryReviewWithCtx(
  ctx: MutationCtx,
  args: ResolveSyncedSaleInventoryReviewArgs,
): Promise<CommandResult<ResolveSyncedSaleInventoryReviewData>> {
  const requiredLocalContext = [
    args.terminalId,
    args.localRegisterSessionId,
    args.localTransactionId,
  ];
  if (requiredLocalContext.some((value) => !value)) {
    return validationError(
      "Inventory review resolution requires terminal, local register session, and local transaction context.",
    );
  }
  if (!args.registerSessionId || !args.sourceId) {
    return validationError(
      "Inventory review resolution requires the linked register session and sale.",
    );
  }
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

  const terminal = await ctx.db.get("posTerminal", args.terminalId!);
  if (!terminal || terminal.storeId !== args.storeId) {
    return validationError("Terminal does not match the inventory review store.");
  }

  const registerSession = await ctx.db.get(
    "registerSession",
    args.registerSessionId,
  );
  if (
    !registerSession ||
    registerSession.storeId !== args.storeId ||
    registerSession.terminalId !== args.terminalId
  ) {
    return validationError(
      "Register session does not match the inventory review terminal.",
    );
  }

  const sale = await ctx.db.get("posTransaction", args.sourceId);
  if (
    !sale ||
    sale.storeId !== args.storeId ||
    sale.registerSessionId !== args.registerSessionId ||
    sale.terminalId !== args.terminalId
  ) {
    return validationError("Sale does not match the inventory review context.");
  }

  const metadata = workItem.metadata ?? {};
  if (
    stringMetadataValue(metadata, "localRegisterSessionId") !==
      args.localRegisterSessionId ||
    stringMetadataValue(metadata, "localTransactionId") !==
      args.localTransactionId ||
    stringMetadataValue(metadata, "registerSessionId") !==
      args.registerSessionId ||
    stringMetadataValue(metadata, "sourceId") !== args.sourceId
  ) {
    return validationError("Work item metadata does not match the sale context.");
  }
  if (
    args.receiptNumber &&
    stringMetadataValue(metadata, "receiptNumber") !== args.receiptNumber
  ) {
    return validationError("Receipt number does not match the inventory review.");
  }
  if (args.receiptNumber && sale.transactionNumber !== args.receiptNumber) {
    return validationError("Sale receipt does not match the inventory review.");
  }

  const canonicalLocalId = inventoryReviewLocalId(args.localTransactionId!);
  const mapping = await ctx.db
    .query("posLocalSyncMapping")
    .withIndex("by_store_terminal_local", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("terminalId", args.terminalId!)
        .eq("localRegisterSessionId", args.localRegisterSessionId!)
        .eq("localIdKind", INVENTORY_REVIEW_LOCAL_ID_KIND)
        .eq("localId", canonicalLocalId),
    )
    .unique();
  if (
    !mapping ||
    mapping.cloudTable !== "operationalWorkItem" ||
    mapping.cloudId !== args.workItemId
  ) {
    return validationError(
      "Inventory review resolution requires the canonical local work-item mapping.",
    );
  }

  const resolvedAt = Date.now();
  const status = terminalStatusForOutcome(args.outcome);
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
      mappingId: mapping._id,
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
      localRegisterSessionId: args.localRegisterSessionId,
      localTransactionId: args.localTransactionId,
      receiptNumber: args.receiptNumber,
      registerSessionId: args.registerSessionId,
      sourceId: args.sourceId,
      terminalId: args.terminalId,
    },
    terminalAudit: {
      displayName: terminal.displayName,
      registerNumber: terminal.registerNumber ?? registerSession.registerNumber,
      terminalId: args.terminalId,
    },
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
      mappingId: mapping._id,
      nextState: resolution.nextState,
      outcome: args.outcome,
      priorState: resolution.priorState,
      reason: resolution.reason,
      source: resolution.source,
      terminalAudit: resolution.terminalAudit,
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
