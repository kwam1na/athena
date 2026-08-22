import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import {
  ok,
  userError,
  type CommandResult,
} from "../../../../shared/commandResult";
import { canProjectRegisterOpenForTerminalCloudRepair } from "./cloudRepairPolicy";
import { createConvexLocalSyncRepository } from "../../infrastructure/repositories/localSyncRepository";
import { parseStoredLocalSyncEvent } from "../sync/ingestLocalEvents";
import { projectLocalSyncEvent } from "../sync/projectLocalEvents";
import {
  buildTerminalCloudRepairPreview,
  classifyRegisterOpenRepairLifecycle,
  classifyTerminalCloudRepairConflict,
  isRepairableTerminalCloudRepairConflict,
  type ObsoleteTerminalCloudRepairConflict,
  type SafeTerminalCloudRepairConflict,
  type TerminalCloudRepairConflictClassification,
  type TerminalCloudRepairLifecycleRead,
} from "./cloudRepairPolicy";
import {
  getTerminalRecoverySourceEvent,
  listTerminalRecoveryConflictRowsForEvent,
  listTerminalRecoveryConflictsForRepair,
  patchTerminalRecoveryConflict,
} from "../../infrastructure/repositories/terminalRecoveryRepository";

/**
 * Batch unit: one obsolete source event per invocation. Every duplicate
 * conflict row raised for that event settles together inside this mutation, so
 * the cap bounds the biggest single event we are willing to settle atomically.
 * An event with more open rows than this is skipped rather than half-repaired.
 */
const TERMINAL_CLOUD_REPAIR_EVENT_ROW_CAP = 2_000;

/** Total rows one invocation may settle across obsolete source events. */
const TERMINAL_CLOUD_REPAIR_ROW_BUDGET = 2_000;

export type TerminalCloudRepairDisposition =
  | "duplicate_resolved"
  | "fresh_projected"
  | "obsolete_resolved";

export async function resolveTerminalCloudRepair(
  ctx: MutationCtx,
  args: {
    expectedPreconditionHash: string;
    now: number;
    resolvedByStaffProfileId?: Id<"staffProfile">;
    resolvedByUserId: Id<"athenaUser">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<
  CommandResult<{
    hasMoreCandidates: boolean;
    preconditionHash: string;
    repairedSourceEventIds: string[];
    resolvedByDisposition: Record<TerminalCloudRepairDisposition, number>;
    resolvedConflictIds: Array<Id<"posLocalSyncConflict">>;
    skippedConflictIds: Array<Id<"posLocalSyncConflict">>;
  }>
> {
  const { candidates, isIncomplete } =
    await listTerminalRecoveryConflictsForRepair(ctx, args);
  const localSyncRepository = createConvexLocalSyncRepository(ctx);
  const terminal = await ctx.db.get("posTerminal", args.terminalId);
  const terminalRegisterNumber =
    typeof terminal?.registerNumber === "string" &&
    terminal.registerNumber.trim().length > 0
      ? terminal.registerNumber.trim()
      : undefined;

  // One source-event read and one lifecycle decision per distinct local event,
  // never per conflict row: a single obsolete open can carry >1,000 rows.
  const sourceEventByLocalEventId = new Map<
    string,
    Doc<"posLocalSyncEvent"> | null
  >();
  const lifecycleByLocalEventId = new Map<
    string,
    TerminalCloudRepairLifecycleRead | undefined
  >();
  for (const localEventId of new Set(
    candidates.map((candidate) => candidate.conflict.localEventId),
  )) {
    const sourceEvent = await getTerminalRecoverySourceEvent(ctx, {
      storeId: args.storeId,
      terminalId: args.terminalId,
      localEventId,
    });
    sourceEventByLocalEventId.set(localEventId, sourceEvent);
    lifecycleByLocalEventId.set(
      localEventId,
      sourceEvent?.eventType === "register_opened"
        ? await classifyRegisterOpenRepairLifecycle(localSyncRepository, {
            event: {
              localRegisterSessionId: sourceEvent.localRegisterSessionId,
              occurredAt: sourceEvent.occurredAt,
            },
            registerNumber: terminalRegisterNumber,
            storeId: args.storeId,
            terminalId: args.terminalId,
          })
        : undefined,
    );
  }

  const classified: TerminalCloudRepairConflictClassification[] =
    candidates.map((candidate) =>
      classifyTerminalCloudRepairConflict({
        blockerStatus: lifecycleByLocalEventId.get(
          candidate.conflict.localEventId,
        )?.hasBlockingRegisterSession
          ? "current"
          : candidate.blockerStatus,
        conflict: candidate.conflict,
        lifecycleDisposition: lifecycleByLocalEventId.get(
          candidate.conflict.localEventId,
        )?.disposition,
        now: args.now,
        sourceEvent:
          sourceEventByLocalEventId.get(candidate.conflict.localEventId) ??
          null,
        storeId: args.storeId,
        terminalId: args.terminalId,
      }),
    );
  const preview = buildTerminalCloudRepairPreview({
    classified,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });

  if (preview.preconditionHash !== args.expectedPreconditionHash) {
    return preconditionDrift();
  }

  const resolvedConflictIds: Array<Id<"posLocalSyncConflict">> = [];
  const repairedSourceEventIds: string[] = [];
  const resolvedByDisposition: Record<TerminalCloudRepairDisposition, number> =
    {
      duplicate_resolved: 0,
      fresh_projected: 0,
      obsolete_resolved: 0,
    };

  // 1. Obsolete / already-projected source events settle without projection.
  const obsoleteConflicts = classified.filter(
    (item): item is ObsoleteTerminalCloudRepairConflict =>
      item.kind === "obsolete_register_opened",
  );
  let rowBudget = TERMINAL_CLOUD_REPAIR_ROW_BUDGET;
  for (const localEventId of orderObsoleteSourceEvents(obsoleteConflicts)) {
    if (rowBudget <= 0) break;
    const disposition: TerminalCloudRepairDisposition =
      obsoleteConflicts.find(
        (item) => item.localEventId === localEventId,
      )?.disposition === "duplicate"
        ? "duplicate_resolved"
        : "obsolete_resolved";
    const eventRows = await listTerminalRecoveryConflictRowsForEvent(ctx, {
      limit: Math.min(TERMINAL_CLOUD_REPAIR_EVENT_ROW_CAP, rowBudget),
      localEventId,
      storeId: args.storeId,
      terminalId: args.terminalId,
    });
    // Fail closed: never settle part of a source event's duplicate rows.
    if (eventRows.isIncomplete) continue;

    await Promise.all(
      eventRows.rows.map((row) =>
        patchTerminalRecoveryConflict(ctx, row._id, {
          // Durable audit: resolver, time, disposition, no raw event payload.
          details: { ...row.details, cloudRepairDisposition: disposition },
          resolvedAt: args.now,
          resolvedByStaffProfileId: args.resolvedByStaffProfileId,
          resolvedByUserId: args.resolvedByUserId,
          status: "resolved",
        }),
      ),
    );
    const sourceEvent = sourceEventByLocalEventId.get(localEventId);
    if (sourceEvent) {
      await localSyncRepository.patchEvent(
        sourceEvent._id,
        disposition === "duplicate_resolved"
          ? { projectedAt: sourceEvent.projectedAt ?? args.now, status: "projected" }
          : { rejectionCode: "obsolete_register_open", status: "rejected" },
      );
    }
    rowBudget -= eventRows.rows.length;
    repairedSourceEventIds.push(localEventId);
    resolvedByDisposition[disposition] += eventRows.rows.length;
    resolvedConflictIds.push(...eventRows.rows.map((row) => row._id));
  }

  // 2. A genuinely fresh replacement event keeps the existing safe projection
  //    path, unchanged: preconditions, staff proof, and one drawer only.
  const safeConflicts = classified.filter(
    (item): item is SafeTerminalCloudRepairConflict =>
      item.kind === "safe_duplicate_register_opened",
  );
  const conflictToRepair = selectLatestSafeDuplicateOpenConflict(safeConflicts);
  const supersededSafeConflicts = safeConflicts
    .filter((conflict) => conflict.conflictId !== conflictToRepair?.conflictId)
    .filter(
      (conflict) =>
        conflictToRepair === undefined ||
        conflict.sequence <= conflictToRepair.sequence,
    );

  if (conflictToRepair) {
    const sourceEvent = sourceEventByLocalEventId.get(
      conflictToRepair.localEventId,
    );
    if (!sourceEvent) {
      return preconditionDrift();
    }

    const parsed = parseStoredLocalSyncEvent(localSyncRepository, sourceEvent);
    if (!parsed.ok) {
      return preconditionDrift();
    }
    if (
      !(await canProjectRegisterOpenForTerminalCloudRepair(localSyncRepository, {
        event: parsed.event,
        now: sourceEvent.acceptedAt ?? args.now,
        storeId: args.storeId,
        terminalId: args.terminalId,
      }))
    ) {
      return preconditionDrift();
    }

    const projection = await projectLocalSyncEvent(localSyncRepository, {
      storeId: args.storeId,
      terminalId: args.terminalId,
      event: parsed.event,
      syncEventId: sourceEvent._id,
      now: sourceEvent.acceptedAt ?? args.now,
      options: {
        trustStoredStaffProof: true,
      },
    });
    if (projection.status !== "projected" || projection.conflicts.length > 0) {
      return preconditionDrift();
    }

    await localSyncRepository.resolveConflictsForEvent({
      storeId: args.storeId,
      terminalId: args.terminalId,
      localEventId: sourceEvent.localEventId,
      resolvedAt: args.now,
    });
    await localSyncRepository.patchEvent(sourceEvent._id, {
      status: "projected",
      projectedAt: args.now,
    });
    await patchTerminalRecoveryConflict(ctx, conflictToRepair.conflictId, {
      resolvedAt: args.now,
      resolvedByStaffProfileId: args.resolvedByStaffProfileId,
      resolvedByUserId: args.resolvedByUserId,
      status: "resolved",
    });
    await Promise.all(
      supersededSafeConflicts.map((conflict) =>
        patchTerminalRecoveryConflict(ctx, conflict.conflictId, {
          resolvedAt: args.now,
          resolvedByStaffProfileId: args.resolvedByStaffProfileId,
          resolvedByUserId: args.resolvedByUserId,
          status: "resolved",
        }),
      ),
    );
    repairedSourceEventIds.push(conflictToRepair.localEventId);
    resolvedByDisposition.fresh_projected +=
      1 + supersededSafeConflicts.length;
    resolvedConflictIds.push(
      conflictToRepair.conflictId,
      ...supersededSafeConflicts.map((conflict) => conflict.conflictId),
    );
  }

  const resolvedConflictIdSet = new Set<string>(resolvedConflictIds);
  const remainingRepairableCount = classified.filter(
    (item) =>
      isRepairableTerminalCloudRepairConflict(item) &&
      !resolvedConflictIdSet.has(item.conflictId),
  ).length;

  return ok({
    hasMoreCandidates: isIncomplete || remainingRepairableCount > 0,
    preconditionHash: preview.preconditionHash,
    repairedSourceEventIds,
    resolvedByDisposition,
    resolvedConflictIds,
    // A row classified skipped per-row can still settle with its obsolete
    // source event; returned evidence must not list one id in both sets.
    skippedConflictIds: preview.skipped
      .map((item) => item.conflictId)
      .filter((conflictId) => !resolvedConflictIdSet.has(conflictId)),
  });
}

function preconditionDrift() {
  return userError({
    code: "precondition_failed" as const,
    message: "Terminal recovery evidence changed. Preview the repair again.",
    metadata: {
      preconditionDrift: true,
    },
  });
}

/** Newest obsolete source event first, so repeated repair drains predictably. */
function orderObsoleteSourceEvents(
  conflicts: ObsoleteTerminalCloudRepairConflict[],
) {
  const highestSequenceByLocalEventId = new Map<string, number>();
  for (const conflict of conflicts) {
    highestSequenceByLocalEventId.set(
      conflict.localEventId,
      Math.max(
        highestSequenceByLocalEventId.get(conflict.localEventId) ??
          Number.NEGATIVE_INFINITY,
        conflict.sequence,
      ),
    );
  }

  return [...highestSequenceByLocalEventId.entries()]
    .sort(
      (left, right) =>
        right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .map(([localEventId]) => localEventId);
}

function selectLatestSafeDuplicateOpenConflict(
  conflicts: SafeTerminalCloudRepairConflict[],
) {
  return [...conflicts].sort(
    (left, right) =>
      right.sequence - left.sequence ||
      String(right.conflictId).localeCompare(String(left.conflictId)),
  )[0];
}
