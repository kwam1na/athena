import type { FunctionReference } from "convex/server";
import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { buildOperationalEvent } from "./operationalEvents";
import {
  MAX_ATOMIC_SYNCED_SALE_REVIEW_GROUP_SIZE,
  projectLogicalOperationalWork,
} from "./logicalOperationalWork";
import {
  inventoryReviewSourceValidationArgsFromWorkItem,
  isQualifyingInventoryReviewStockUpdate,
  validateInventoryReviewSourceContextWithCtx,
} from "./openWorkInventoryReviews";

const SOURCE_PROBE_LIMIT = 1_000;
const REPAIR_BATCH_SIZE = 10;
const STOCK_UPDATE_SOURCE_TYPE = "stock_adjustment_batch";
const repairFunction = (
  internal as unknown as {
    operations: {
      oversizedOperationalWorkRepair: {
        processRepairBatch: FunctionReference<"mutation", "internal">;
      };
    };
  }
).operations.oversizedOperationalWorkRepair.processRepairBatch;

type RepairEvidence = {
  initiatorIdentifier: string;
  reason: string;
  supportTicket: string;
};

function requireEvidence(evidence: RepairEvidence) {
  if (
    !evidence.initiatorIdentifier.trim() ||
    !evidence.reason.trim() ||
    !evidence.supportTicket.trim()
  ) {
    throw new Error(
      "Initiator identifier, reason, and support ticket are required.",
    );
  }
}

async function readCurrentGroup(
  ctx: MutationCtx,
  args: {
    groupKey: string;
    sourceIdentities?: string[];
    storeId: Id<"store">;
  },
) {
  const lanes = await Promise.all(
    (["open", "in_progress"] as const).map((status) =>
      ctx.db
        .query("operationalWorkItem")
        .withIndex("by_storeId_type_status", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("type", "synced_sale_inventory_review")
            .eq("status", status),
        )
        .take(SOURCE_PROBE_LIMIT + 1),
    ),
  );
  if (lanes.some((lane) => lane.length > SOURCE_PROBE_LIMIT)) {
    return { kind: "incomplete" as const };
  }
  return {
    kind: "complete" as const,
    group: projectLogicalOperationalWork({
      items: lanes.flat(),
      remediationSourceIdentitiesByGroupKey: args.sourceIdentities
        ? new Map([[args.groupKey, new Set(args.sourceIdentities)]])
        : undefined,
      sourceCompleteness: "complete",
    }).groups.find((group) => group.key === args.groupKey),
  };
}

async function recordRepairAuditEvent(
  ctx: MutationCtx,
  args: {
    action: "amended" | "completed" | "created" | "paused" | "resumed";
    addedMemberIds?: Array<Id<"operationalWorkItem">>;
    evidence?: RepairEvidence;
    error?: string;
    repair: Pick<
      Doc<"oversizedOperationalWorkRepair">,
      | "_id"
      | "groupKey"
      | "initiatorIdentifier"
      | "organizationId"
      | "reason"
      | "storeId"
      | "supportTicket"
    >;
  },
) {
  const evidence = args.evidence ?? {
    initiatorIdentifier: args.repair.initiatorIdentifier,
    reason: args.repair.reason,
    supportTicket: args.repair.supportTicket,
  };
  await ctx.db.insert("oversizedOperationalWorkRepairAction", {
    action: args.action,
    ...(args.addedMemberIds
      ? { addedMemberIds: args.addedMemberIds }
      : {}),
    ...(args.error ? { error: args.error } : {}),
    groupKey: args.repair.groupKey,
    initiatorIdentifier: evidence.initiatorIdentifier.trim(),
    occurredAt: Date.now(),
    organizationId: args.repair.organizationId,
    reason: evidence.reason.trim(),
    repairId: args.repair._id,
    storeId: args.repair.storeId,
    supportTicket: evidence.supportTicket.trim(),
  });
  await ctx.db.insert(
    "operationalEvent",
    buildOperationalEvent({
      eventType: `oversized_operational_work_repair_${args.action}`,
      message: `Oversized operational work repair ${args.action}.`,
      organizationId: args.repair.organizationId,
      reason: args.evidence?.reason ?? args.error,
      storeId: args.repair.storeId,
      subjectId: args.repair._id,
      subjectLabel: "Oversized operational work repair",
      subjectType: "oversized_operational_work_repair",
      metadata: {
        action: args.action,
        groupKey: args.repair.groupKey,
        ...(args.addedMemberIds
          ? { addedMemberIds: args.addedMemberIds }
          : {}),
        ...(args.error ? { error: args.error } : {}),
        ...(args.evidence
          ? {
              initiatorIdentifier: args.evidence.initiatorIdentifier,
              supportTicket: args.evidence.supportTicket,
            }
          : {}),
      },
    }),
  );
}

async function scheduleNextBatch(
  ctx: MutationCtx,
  repairId: Id<"oversizedOperationalWorkRepair">,
) {
  await ctx.scheduler.runAfter(0, repairFunction, { repairId });
}

export async function createRepairWithCtx(
  ctx: MutationCtx,
  args: RepairEvidence & {
    groupKey: string;
    organizationId: Id<"organization">;
    storeId: Id<"store">;
  },
) {
  requireEvidence(args);
  const store = await ctx.db.get("store", args.storeId);
  if (!store || store.organizationId !== args.organizationId) {
    throw new Error("Store does not match the repair organization.");
  }
  const currentGroup = await readCurrentGroup(ctx, args);
  if (currentGroup.kind === "incomplete") {
    throw new Error("Current inventory review membership is incomplete.");
  }
  const group = currentGroup.group;
  if (
    !group?.productSkuId ||
    group.items.length <= MAX_ATOMIC_SYNCED_SALE_REVIEW_GROUP_SIZE
  ) {
    throw new Error("The current logical group does not require repair.");
  }

  for (const status of ["pending", "running", "paused"] as const) {
    const existing = await ctx.db
      .query("oversizedOperationalWorkRepair")
      .withIndex("by_storeId_groupKey_status", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("groupKey", args.groupKey)
          .eq("status", status),
      )
      .first();
    if (existing) return existing;
  }

  const now = Date.now();
  const repairId = await ctx.db.insert("oversizedOperationalWorkRepair", {
    createdAt: now,
    cursor: 0,
    groupKey: args.groupKey,
    initiatorIdentifier: args.initiatorIdentifier.trim(),
    memberIds: group.items.map((item) => item._id),
    organizationId: args.organizationId,
    productSkuId: group.productSkuId,
    reason: args.reason.trim(),
    sourceIdentities: group.sourceIdentities,
    status: "pending",
    storeId: args.storeId,
    supportTicket: args.supportTicket.trim(),
    updatedAt: now,
  });
  await recordRepairAuditEvent(ctx, {
    action: "created",
    evidence: args,
    repair: {
      _id: repairId,
      groupKey: args.groupKey,
      initiatorIdentifier: args.initiatorIdentifier.trim(),
      organizationId: args.organizationId,
      reason: args.reason.trim(),
      storeId: args.storeId,
      supportTicket: args.supportTicket.trim(),
    },
  });
  await scheduleNextBatch(ctx, repairId);
  return ctx.db.get("oversizedOperationalWorkRepair", repairId);
}

async function pauseRepair(
  ctx: MutationCtx,
  repair: Doc<"oversizedOperationalWorkRepair">,
  error: string,
) {
  await ctx.db.patch("oversizedOperationalWorkRepair", repair._id, {
    error,
    status: "paused",
    updatedAt: Date.now(),
  });
  await recordRepairAuditEvent(ctx, {
    action: "paused",
    error,
    repair,
  });
  return { action: "paused" as const, error };
}

export async function processRepairBatchWithCtx(
  ctx: MutationCtx,
  args: { repairId: Id<"oversizedOperationalWorkRepair"> },
) {
  const repair = await ctx.db.get("oversizedOperationalWorkRepair", args.repairId);
  if (!repair || repair.status === "completed") {
    return { action: "noop" as const };
  }
  if (repair.status === "paused") {
    return { action: "paused" as const, error: repair.error };
  }

  const currentGroupRead = await readCurrentGroup(ctx, repair);
  if (currentGroupRead.kind === "incomplete") {
    return pauseRepair(
      ctx,
      repair,
      "Current inventory review membership is incomplete.",
    );
  }
  const currentGroup = currentGroupRead.group;
  const remainingIds = repair.memberIds.slice(repair.cursor).map(String).sort();
  const currentIds = (currentGroup?.items ?? []).map((item) => String(item._id)).sort();
  if (
    currentIds.length !== remainingIds.length ||
    currentIds.some((id, index) => id !== remainingIds[index])
  ) {
    return pauseRepair(
      ctx,
      repair,
      "Current membership changed. Amend the frozen repair before resuming.",
    );
  }

  const productSku = await ctx.db.get("productSku", repair.productSkuId);
  const latestMovement = await ctx.db
    .query("inventoryMovement")
    .withIndex("by_storeId_productSkuId_sourceType_createdAt", (q) =>
      q
        .eq("storeId", repair.storeId)
        .eq("productSkuId", repair.productSkuId)
        .eq("sourceType", STOCK_UPDATE_SOURCE_TYPE),
    )
    .order("desc")
    .first();
  const newestRemainingWorkItemCreatedAt = Math.max(
    ...currentGroup!.items.map((item) => item.createdAt),
  );
  const hasQualifyingStockUpdate = Boolean(
    isQualifyingInventoryReviewStockUpdate(
      latestMovement,
      newestRemainingWorkItemCreatedAt,
    ),
  );
  const hasPositiveCurrentInventory = Boolean(
    productSku &&
      productSku.storeId === repair.storeId &&
      productSku.inventoryCount > 0,
  );
  if (!hasPositiveCurrentInventory && !hasQualifyingStockUpdate) {
    return pauseRepair(
      ctx,
      repair,
      "The affected SKU has no qualifying stock proof.",
    );
  }

  const batchIds = repair.memberIds.slice(
    repair.cursor,
    repair.cursor + REPAIR_BATCH_SIZE,
  );
  const batchItems = await Promise.all(
    batchIds.map((workItemId) => ctx.db.get("operationalWorkItem", workItemId)),
  );
  if (
    batchItems.some(
      (item) =>
        !item ||
        item.storeId !== repair.storeId ||
        item.organizationId !== repair.organizationId ||
        item.type !== "synced_sale_inventory_review" ||
        (item.status !== "open" && item.status !== "in_progress"),
    )
  ) {
    return pauseRepair(
      ctx,
      repair,
      "Frozen repair membership is no longer actionable.",
    );
  }
  for (const item of batchItems as Array<Doc<"operationalWorkItem">>) {
    const sourceValidation =
      await validateInventoryReviewSourceContextWithCtx(ctx, {
        ...inventoryReviewSourceValidationArgsFromWorkItem(item),
        storeId: repair.storeId,
        workItem: item,
      });
    if (sourceValidation.kind !== "ok") {
      return pauseRepair(
        ctx,
        repair,
        `Frozen repair source validation failed: ${sourceValidation.error.message}`,
      );
    }
  }
  const resolvedAt = Date.now();
  for (const item of batchItems as Array<Doc<"operationalWorkItem">>) {
    const workItemId = item._id;
    const priorState = { status: item.status };
    const authority = {
      initiatorIdentifier: repair.initiatorIdentifier,
      kind: "support_repair",
      supportTicket: repair.supportTicket,
    };
    await ctx.db.patch("operationalWorkItem", workItemId, {
      completedAt: resolvedAt,
      metadata: {
        ...(item.metadata ?? {}),
        resolution: {
          authority,
          nextState: { status: "completed" },
          outcome: "completed",
          priorState,
          reason: repair.reason,
          repairId: repair._id,
          resolvedAt,
        },
      },
      status: "completed",
    });
    await ctx.db.insert(
      "operationalEvent",
      buildOperationalEvent({
        eventType: "synced_sale_inventory_review_completed",
        message: "Synced sale inventory review completed by support repair.",
        organizationId: repair.organizationId,
        reason: repair.reason,
        storeId: repair.storeId,
        subjectId: workItemId,
        subjectLabel: item.title,
        subjectType: "synced_sale_inventory_review",
        workItemId,
        metadata: {
          authority,
          nextState: { status: "completed" },
          priorState,
          repairId: repair._id,
        },
      }),
    );
  }

  const cursor = repair.cursor + batchIds.length;
  if (cursor >= repair.memberIds.length) {
    await ctx.db.patch("oversizedOperationalWorkRepair", repair._id, {
      cursor,
      error: undefined,
      status: "completed",
      updatedAt: resolvedAt,
    });
    await recordRepairAuditEvent(ctx, {
      action: "completed",
      evidence: {
        initiatorIdentifier: repair.initiatorIdentifier,
        reason: repair.reason,
        supportTicket: repair.supportTicket,
      },
      repair,
    });
    return { action: "completed" as const, processedCount: batchIds.length };
  }
  await ctx.db.patch("oversizedOperationalWorkRepair", repair._id, {
    cursor,
    error: undefined,
    status: "running",
    updatedAt: resolvedAt,
  });
  await scheduleNextBatch(ctx, repair._id);
  return { action: "continued" as const, processedCount: batchIds.length };
}

export async function amendRepairWithCtx(
  ctx: MutationCtx,
  args: RepairEvidence & { repairId: Id<"oversizedOperationalWorkRepair"> },
) {
  requireEvidence(args);
  const repair = await ctx.db.get("oversizedOperationalWorkRepair", args.repairId);
  if (!repair || repair.status !== "paused") {
    throw new Error("Only a paused repair can be amended.");
  }
  const currentGroupRead = await readCurrentGroup(ctx, repair);
  if (currentGroupRead.kind === "incomplete") {
    return pauseRepair(
      ctx,
      repair,
      "Current inventory review membership is incomplete.",
    );
  }
  const currentGroup = currentGroupRead.group;
  const frozenIds = new Set(repair.memberIds.map(String));
  const addedMemberIds = (currentGroup?.items ?? [])
    .map((item) => item._id)
    .filter((id) => !frozenIds.has(String(id)));
  if (addedMemberIds.length === 0) {
    throw new Error("No new aliases are available to amend.");
  }
  const amendedAt = Date.now();
  await ctx.db.patch("oversizedOperationalWorkRepair", repair._id, {
    error: undefined,
    memberIds: [...repair.memberIds, ...addedMemberIds],
    status: "running",
    updatedAt: amendedAt,
  });
  await recordRepairAuditEvent(ctx, {
    action: "amended",
    addedMemberIds,
    evidence: args,
    repair,
  });
  await scheduleNextBatch(ctx, repair._id);
  return { action: "amended" as const, addedCount: addedMemberIds.length };
}

export async function resumeRepairWithCtx(
  ctx: MutationCtx,
  args: RepairEvidence & { repairId: Id<"oversizedOperationalWorkRepair"> },
) {
  requireEvidence(args);
  const repair = await ctx.db.get("oversizedOperationalWorkRepair", args.repairId);
  if (!repair || repair.status !== "paused") {
    throw new Error("Only a paused repair can be resumed.");
  }
  const resumedAt = Date.now();
  await ctx.db.patch("oversizedOperationalWorkRepair", repair._id, {
    error: undefined,
    status: "running",
    updatedAt: resumedAt,
  });
  await recordRepairAuditEvent(ctx, {
    action: "resumed",
    evidence: args,
    repair,
  });
  await scheduleNextBatch(ctx, repair._id);
  return { action: "resumed" as const };
}

const evidenceArgs = {
  initiatorIdentifier: v.string(),
  reason: v.string(),
  supportTicket: v.string(),
};

export const createRepair = internalMutation({
  args: {
    ...evidenceArgs,
    groupKey: v.string(),
    organizationId: v.id("organization"),
    storeId: v.id("store"),
  },
  handler: createRepairWithCtx,
});

export const processRepairBatch = internalMutation({
  args: { repairId: v.id("oversizedOperationalWorkRepair") },
  handler: processRepairBatchWithCtx,
});

export const amendRepair = internalMutation({
  args: { ...evidenceArgs, repairId: v.id("oversizedOperationalWorkRepair") },
  handler: amendRepairWithCtx,
});

export const resumeRepair = internalMutation({
  args: { ...evidenceArgs, repairId: v.id("oversizedOperationalWorkRepair") },
  handler: resumeRepairWithCtx,
});
