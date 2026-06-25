import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import {
  ok,
  userError,
  type CommandResult,
} from "../../../../shared/commandResult";
import {
  canReuseCloudRegisterSessionForLocalOpen as canReuseCloudRegisterSessionForLocalOpenPolicy,
  canSupersedeReviewedRegisterSessionForLocalOpen as canSupersedeReviewedRegisterSessionForLocalOpenPolicy,
  isRegisterCloseoutReviewConflict,
} from "../../../../shared/registerSessionLifecyclePolicy";
import { createConvexLocalSyncRepository } from "../../infrastructure/repositories/localSyncRepository";
import { parseStoredLocalSyncEvent } from "../sync/ingestLocalEvents";
import { projectLocalSyncEvent } from "../sync/projectLocalEvents";
import type {
  LocalSyncRegisterReviewConflictFact,
  ParsedPosLocalSyncEventInput,
  SyncProjectionRepository,
} from "../sync/types";
import {
  buildTerminalCloudRepairPreview,
  classifyTerminalCloudRepairConflict,
  type SafeTerminalCloudRepairConflict,
} from "./cloudRepairPolicy";
import {
  getTerminalRecoverySourceEvent,
  listTerminalRecoveryConflictsForRepair,
  patchTerminalRecoveryConflict,
} from "../../infrastructure/repositories/terminalRecoveryRepository";

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
    preconditionHash: string;
    resolvedConflictIds: Array<Id<"posLocalSyncConflict">>;
    skippedConflictIds: Array<Id<"posLocalSyncConflict">>;
  }>
> {
  const conflicts = await listTerminalRecoveryConflictsForRepair(ctx, args);
  const classified = await Promise.all(
    conflicts.map(async (conflict) =>
      classifyTerminalCloudRepairConflict({
        conflict,
        now: args.now,
        sourceEvent: await getTerminalRecoverySourceEvent(ctx, {
          storeId: args.storeId,
          terminalId: args.terminalId,
          localEventId: conflict.localEventId,
        }),
        storeId: args.storeId,
        terminalId: args.terminalId,
      }),
    ),
  );
  const preview = buildTerminalCloudRepairPreview({
    classified,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });

  if (preview.preconditionHash !== args.expectedPreconditionHash) {
    return userError({
      code: "precondition_failed",
      message: "Terminal recovery evidence changed. Preview the repair again.",
      metadata: {
        preconditionDrift: true,
      },
    });
  }

  const localSyncRepository = createConvexLocalSyncRepository(ctx);
  const safeConflicts = classified.filter(
    (item): item is SafeTerminalCloudRepairConflict =>
      item.kind === "safe_duplicate_register_opened",
  );
  const conflictToRepair = selectLatestSafeDuplicateOpenConflict(safeConflicts);
  const obsoleteSafeConflicts = safeConflicts
    .filter((conflict) => conflict.conflictId !== conflictToRepair?.conflictId)
    .filter(
      (conflict) =>
        conflictToRepair === undefined ||
        conflict.sequence <= conflictToRepair.sequence,
    );

  if (conflictToRepair) {
    const sourceEvent = await getTerminalRecoverySourceEvent(ctx, {
      storeId: args.storeId,
      terminalId: args.terminalId,
      localEventId: conflictToRepair.localEventId,
    });
    if (!sourceEvent) {
      return userError({
        code: "precondition_failed",
        message: "Terminal recovery evidence changed. Preview the repair again.",
        metadata: {
          preconditionDrift: true,
        },
      });
    }

    const parsed = parseStoredLocalSyncEvent(localSyncRepository, sourceEvent);
    if (!parsed.ok) {
      return userError({
        code: "precondition_failed",
        message: "Terminal recovery evidence changed. Preview the repair again.",
        metadata: {
          preconditionDrift: true,
        },
      });
    }
    if (
      !(await canRepairProjectRegisterOpen(localSyncRepository, {
        event: parsed.event,
        now: sourceEvent.acceptedAt ?? args.now,
        storeId: args.storeId,
        terminalId: args.terminalId,
      }))
    ) {
      return userError({
        code: "precondition_failed",
        message: "Terminal recovery evidence changed. Preview the repair again.",
        metadata: {
          preconditionDrift: true,
        },
      });
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
      return userError({
        code: "precondition_failed",
        message: "Terminal recovery evidence changed. Preview the repair again.",
        metadata: {
          preconditionDrift: true,
        },
      });
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
      obsoleteSafeConflicts.map((conflict) =>
        patchTerminalRecoveryConflict(ctx, conflict.conflictId, {
          resolvedAt: args.now,
          resolvedByStaffProfileId: args.resolvedByStaffProfileId,
          resolvedByUserId: args.resolvedByUserId,
          status: "resolved",
        }),
      ),
    );
  }
  const resolvedConflictIds = conflictToRepair
    ? [
        conflictToRepair.conflictId,
        ...obsoleteSafeConflicts.map((conflict) => conflict.conflictId),
      ]
    : [];

  return ok({
    preconditionHash: preview.preconditionHash,
    resolvedConflictIds,
    skippedConflictIds: preview.skipped.map((item) => item.conflictId),
  });
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

async function canRepairProjectRegisterOpen(
  repository: SyncProjectionRepository,
  args: {
    event: ParsedPosLocalSyncEventInput;
    now: number;
    storeId: Parameters<SyncProjectionRepository["getStore"]>[0];
    terminalId: Parameters<SyncProjectionRepository["getTerminal"]>[0];
  },
) {
  if (args.event.eventType !== "register_opened") return false;

  const terminal = await repository.getTerminal(args.terminalId);
  const staff = await repository.getStaffProfile(args.event.staffProfileId);
  const terminalRegisterNumber = normalizeRepairString(terminal?.registerNumber);
  const payloadRegisterNumber = normalizeRepairString(args.event.payload.registerNumber);
  if (
    !terminal ||
    terminal.storeId !== args.storeId ||
    terminal.status !== "active" ||
    !terminalRegisterNumber ||
    (payloadRegisterNumber && payloadRegisterNumber !== terminalRegisterNumber)
  ) {
    return false;
  }

  const hasActiveOpenRole = staff
    ? await repository.hasActivePosRole({
        staffProfileId: args.event.staffProfileId,
        storeId: args.storeId,
        allowedRoles: ["cashier", "manager"],
      })
    : false;
  if (
    !staff ||
    staff.storeId !== args.storeId ||
    staff.status !== "active" ||
    !hasActiveOpenRole
  ) {
    return false;
  }

  const directRegisterSessionId = repository.normalizeCloudId(
    "registerSession",
    args.event.localRegisterSessionId,
  );
  if (directRegisterSessionId) {
    const registerSession = await repository.getRegisterSession(directRegisterSessionId);
    return canReuseCloudRegisterSessionForLocalOpenPolicy({
      hasOpenRegisterCloseoutReview: false,
      registerSession,
      storeId: args.storeId,
      terminalId: args.terminalId,
    });
  }

  const blockingRegisterSession = await repository.findBlockingRegisterSession({
    storeId: args.storeId,
    terminalId: args.terminalId,
    registerNumber: terminalRegisterNumber,
  });
  if (!blockingRegisterSession) return true;

  const reviewState = await getRepairOpenRegisterCloseoutReviewState(repository, {
    registerSessionId: blockingRegisterSession._id,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });

  return canSupersedeReviewedRegisterSessionForLocalOpenPolicy({
    hasOpenRegisterCloseoutReview: reviewState.hasOpenRegisterCloseoutReview,
    replacementLocalRegisterSessionId: args.event.localRegisterSessionId,
    replacementSequence: args.event.sequence,
    registerSession: blockingRegisterSession,
    reviewSequence: reviewState.latestReviewSequence ?? null,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
}

async function getRepairOpenRegisterCloseoutReviewState(
  repository: SyncProjectionRepository,
  args: {
    registerSessionId: Parameters<
      SyncProjectionRepository["listOpenRegisterReviewConflictFacts"]
    >[0]["registerSessionId"];
    storeId: Parameters<SyncProjectionRepository["getStore"]>[0];
    terminalId: Parameters<SyncProjectionRepository["getTerminal"]>[0];
  },
) {
  const conflicts = (
    await repository.listOpenRegisterReviewConflictFacts(args)
  )
    .filter((fact) =>
      repairFactMatchesRegisterSessionCloseoutReview(fact, args.registerSessionId),
    )
    .map((fact) => fact.conflict);

  return {
    hasOpenRegisterCloseoutReview: conflicts.length > 0,
    latestReviewSequence: conflicts.reduce<number | undefined>(
      (latest, conflict) =>
        latest === undefined ? conflict.sequence : Math.max(latest, conflict.sequence),
      undefined,
    ),
  };
}

function repairFactMatchesRegisterSessionCloseoutReview(
  fact: LocalSyncRegisterReviewConflictFact,
  registerSessionId: Parameters<
    SyncProjectionRepository["listOpenRegisterReviewConflictFacts"]
  >[0]["registerSessionId"],
) {
  if (!isRegisterCloseoutReviewConflict(fact.conflict)) return false;
  if (
    fact.registerSessionMapping?.cloudTable === "registerSession" &&
    fact.registerSessionMapping.cloudId === registerSessionId
  ) {
    return true;
  }

  return fact.directRegisterSession?._id === registerSessionId;
}

function normalizeRepairString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
