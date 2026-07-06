import { v } from "convex/values";

import type { Doc, Id } from "../../../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../../../_generated/server";
import { createConvexLocalSyncRepository } from "../../infrastructure/repositories/localSyncRepository";
import { parseStoredLocalSyncEvent } from "./ingestLocalEvents";
import {
  classifyProvisionalImportLineage,
  type ProjectionProvisionalImportSku,
} from "./projectionPolicies";
import { projectLocalSyncEvent } from "./projectLocalEvents";
import type {
  LocalSyncConflictRecord,
  ParsedPosLocalSyncEventInput,
  PosLocalSalePayload,
} from "./types";

const FINALIZED_LINEAGE_REPAIR_BATCH_LIMIT = 25;
const PROVISIONAL_IMPORT_ROW_CHANGED_SUMMARY =
  "Provisional import row changed before this offline sale synced.";

export type FinalizedLineageRepairConflictClassification =
  | { kind: "repairable"; repairedConflictCount: number }
  | { kind: "skipped"; reason: string };

type RepairDecision =
  | {
      kind: "candidate";
      finalizedLineCount: number;
      localEventId: string;
      posLocalSyncEventId: Id<"posLocalSyncEvent">;
      repairedConflictCount: number;
      terminalId: Id<"posTerminal">;
    }
  | {
      kind: "skipped";
      localEventId?: string;
      posLocalSyncEventId: Id<"posLocalSyncEvent">;
      reason: string;
    };

export const repairFinalizedLineageConflictedSales = internalMutation({
  args: {
    dryRun: v.boolean(),
    eventIds: v.array(v.id("posLocalSyncEvent")),
    localRegisterSessionId: v.string(),
    repairRunId: v.optional(v.string()),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    if (args.eventIds.length > FINALIZED_LINEAGE_REPAIR_BATCH_LIMIT) {
      throw new Error(
        `Repair batches are limited to ${FINALIZED_LINEAGE_REPAIR_BATCH_LIMIT} sync events.`,
      );
    }

    if (!args.dryRun && !args.repairRunId) {
      throw new Error("Provide a repair run id before executing remediation.");
    }

    const now = Date.now();
    const repository = createConvexLocalSyncRepository(ctx);
    const candidates: RepairDecision[] = [];
    const repaired: Array<Id<"posLocalSyncEvent">> = [];
    const skipped: RepairDecision[] = [];
    const failed: Array<{
      localEventId: string;
      posLocalSyncEventId: Id<"posLocalSyncEvent">;
      projectionConflictCount: number;
      projectionStatus: "projected" | "conflicted";
    }> = [];

    for (const eventId of args.eventIds) {
      const event = await ctx.db.get("posLocalSyncEvent", eventId);
      if (!event) {
        skipped.push({
          kind: "skipped",
          posLocalSyncEventId: eventId,
          reason: "event_not_found",
        });
        continue;
      }

      const decision = await classifyRepairCandidate(ctx, repository, {
        event,
        localRegisterSessionId: args.localRegisterSessionId,
        storeId: args.storeId,
      });
      if (decision.kind === "skipped") {
        skipped.push(decision);
        continue;
      }

      candidates.push(decision);
      if (args.dryRun) continue;

      const parsed = parseStoredLocalSyncEvent(repository, event);
      if (!parsed.ok) {
        skipped.push({
          kind: "skipped",
          localEventId: event.localEventId,
          posLocalSyncEventId: event._id,
          reason: "stored_event_parse_failed",
        });
        continue;
      }

      const projection = await projectLocalSyncEvent(repository, {
        storeId: event.storeId,
        terminalId: event.terminalId,
        event: parsed.event,
        syncEventId: event._id,
        now: event.acceptedAt ?? now,
        options: {
          repairRunId: args.repairRunId,
          trustStoredStaffProof: true,
        },
      });

      if (
        projection.status !== "projected" ||
        projection.conflicts.length > 0
      ) {
        failed.push({
          localEventId: event.localEventId,
          posLocalSyncEventId: event._id,
          projectionConflictCount: projection.conflicts.length,
          projectionStatus: projection.status,
        });
        continue;
      }

      await repository.resolveConflictsForEvent({
        storeId: event.storeId,
        terminalId: event.terminalId,
        localEventId: event.localEventId,
        resolvedAt: now,
      });
      await repository.patchEvent(event._id, {
        status: "projected",
        projectedAt: now,
      });
      await recordFinalizedLineageRepairEvent(ctx, repository, {
        decision,
        event,
        repairRunId: args.repairRunId,
        repairedAt: now,
      });
      repaired.push(event._id);
    }

    return {
      candidates,
      dryRun: args.dryRun,
      failed,
      repaired,
      repairRunId: args.repairRunId,
      skipped,
    };
  },
});

async function classifyRepairCandidate(
  ctx: MutationCtx,
  repository: ReturnType<typeof createConvexLocalSyncRepository>,
  args: {
    event: Doc<"posLocalSyncEvent">;
    localRegisterSessionId: string;
    storeId: Id<"store">;
  },
): Promise<RepairDecision> {
  if (args.event.storeId !== args.storeId) {
    return skipped(args.event, "event_wrong_store");
  }
  if (args.event.localRegisterSessionId !== args.localRegisterSessionId) {
    return skipped(args.event, "event_wrong_register_session");
  }
  if (args.event.status !== "conflicted") {
    return skipped(args.event, "event_not_conflicted");
  }
  if (args.event.eventType !== "sale_completed") {
    return skipped(args.event, "event_not_sale_completed");
  }

  const conflicts = await repository.listConflictsForEvent({
    storeId: args.event.storeId,
    terminalId: args.event.terminalId,
    localEventId: args.event.localEventId,
  });
  const conflictClassification = classifyFinalizedLineageRepairConflicts(
    conflicts,
    args.localRegisterSessionId,
  );
  if (conflictClassification.kind === "skipped") {
    return skipped(args.event, conflictClassification.reason);
  }

  const parsed = parseStoredLocalSyncEvent(repository, args.event);
  if (!parsed.ok || parsed.event.eventType !== "sale_completed") {
    return skipped(args.event, "stored_event_parse_failed");
  }

  const finalizedLineCount = await countRepairableFinalizedLineageLines(ctx, {
    event: parsed.event,
    storeId: args.storeId,
  });
  if (finalizedLineCount === 0) {
    return skipped(args.event, "no_repairable_finalized_lineage");
  }

  return {
    kind: "candidate",
    finalizedLineCount,
    localEventId: args.event.localEventId,
    posLocalSyncEventId: args.event._id,
    repairedConflictCount: conflictClassification.repairedConflictCount,
    terminalId: args.event.terminalId,
  };
}

export function classifyFinalizedLineageRepairConflicts(
  conflicts: LocalSyncConflictRecord[],
  localRegisterSessionId: string,
): FinalizedLineageRepairConflictClassification {
  const openConflicts = conflicts.filter(
    (conflict) => conflict.status === "needs_review",
  );
  if (
    openConflicts.some(
      (conflict) => conflict.localRegisterSessionId !== localRegisterSessionId,
    )
  ) {
    return { kind: "skipped", reason: "conflict_wrong_register_session" };
  }
  const repairableConflicts = openConflicts.filter(
    isFinalizedLineageRepairConflict,
  );
  if (repairableConflicts.length === 0) {
    return {
      kind: "skipped",
      reason: "missing_finalized_lineage_repair_conflict",
    };
  }
  if (repairableConflicts.length !== openConflicts.length) {
    return {
      kind: "skipped",
      reason: "event_has_unrelated_open_conflicts",
    };
  }

  return {
    kind: "repairable",
    repairedConflictCount: repairableConflicts.length,
  };
}

function isFinalizedLineageRepairConflict(conflict: LocalSyncConflictRecord) {
  return (
    conflict.status === "needs_review" &&
    conflict.conflictType === "inventory" &&
    conflict.summary === PROVISIONAL_IMPORT_ROW_CHANGED_SUMMARY
  );
}

async function countRepairableFinalizedLineageLines(
  ctx: MutationCtx,
  args: {
    event: Extract<
      ParsedPosLocalSyncEventInput,
      { eventType: "sale_completed" }
    >;
    storeId: Id<"store">;
  },
) {
  const payload = args.event.payload as PosLocalSalePayload;
  let count = 0;
  for (const item of payload.items) {
    if (!item.inventoryImportProvisionalSkuId) continue;
    const provisionalImportSku = await getProvisionalImportSku(ctx, {
      inventoryImportProvisionalSkuId: item.inventoryImportProvisionalSkuId,
    });
    const classification = classifyProvisionalImportLineage({
      item,
      provisionalImportSku,
      saleOccurredAt: args.event.occurredAt,
      storeId: args.storeId,
    });
    if (
      classification.kind === "accepted" &&
      classification.linePolicy.source === "finalized_provisional_lineage"
    ) {
      count += 1;
    }
  }

  return count;
}

async function getProvisionalImportSku(
  ctx: MutationCtx,
  args: {
    inventoryImportProvisionalSkuId: string;
  },
): Promise<ProjectionProvisionalImportSku | null> {
  const normalized = ctx.db.normalizeId(
    "inventoryImportProvisionalSku",
    args.inventoryImportProvisionalSkuId,
  );
  if (!normalized) return null;

  const row = await ctx.db.get("inventoryImportProvisionalSku", normalized);
  if (!row) return null;

  return {
    _id: row._id,
    finalizedAt: row.finalizedAt,
    importedBarcode: row.importedBarcode,
    importedPrice: row.importedPrice,
    posExposureStatus: row.posExposureStatus,
    productId: row.productId,
    productSkuId: row.productSkuId,
    status: row.status,
    storeId: row.storeId,
  };
}

function skipped(
  event: Doc<"posLocalSyncEvent">,
  reason: string,
): RepairDecision {
  return {
    kind: "skipped",
    localEventId: event.localEventId,
    posLocalSyncEventId: event._id,
    reason,
  };
}

async function recordFinalizedLineageRepairEvent(
  ctx: MutationCtx,
  repository: ReturnType<typeof createConvexLocalSyncRepository>,
  args: {
    decision: Extract<RepairDecision, { kind: "candidate" }>;
    event: Doc<"posLocalSyncEvent">;
    repairedAt: number;
    repairRunId?: string;
  },
) {
  const store = await ctx.db.get("store", args.event.storeId);
  await repository.createOperationalEvent({
    storeId: args.event.storeId,
    organizationId: store?.organizationId,
    eventType: "pos_local_sync.finalized_lineage_repaired",
    subjectType: "posLocalSyncEvent",
    subjectId: args.event._id,
    message: "Finalized provisional inventory lineage was reapplied.",
    metadata: {
      finalizedLineCount: args.decision.finalizedLineCount,
      localEventId: args.event.localEventId,
      localRegisterSessionId: args.event.localRegisterSessionId,
      repairRunId: args.repairRunId,
      resolvedConflictCount: args.decision.repairedConflictCount,
    },
    createdAt: args.repairedAt,
    terminalId: args.event.terminalId,
    localEventId: args.event.localEventId,
  });
}
