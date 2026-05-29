import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

const SYNC_CONFLICT_LIMIT = 500;

export type RegisterSessionSyncConflict = {
  _id: string;
  conflictType?: string;
  createdAt: number;
  details?: Record<string, unknown>;
  localEventId: string;
  localRegisterSessionId?: string;
  sequence: number;
  status: string;
  storeId?: Id<"store">;
  summary?: string;
  terminalId?: Id<"posTerminal">;
};

export type RegisterSessionLocalSyncStatus = {
  status: "needs_review";
  reconciliationItems: Array<{
    createdAt?: number | null;
    countedCash?: number | null;
    expectedCash?: number | null;
    id?: string;
    localEventId?: string | null;
    sequence?: number | null;
    status?: string | null;
    summary?: string | null;
    type?: string | null;
    variance?: number | null;
  }>;
};

function getSyncConflictReconciliationType(
  conflict: Pick<
    RegisterSessionSyncConflict,
    "conflictType" | "localEventId" | "summary"
  >,
) {
  const localEventId = conflict.localEventId?.toLowerCase() ?? "";
  const summary = conflict.summary?.toLowerCase() ?? "";

  if (
    localEventId.includes("register-closed") ||
    localEventId.includes("register-closeout") ||
    summary.includes("register closeout")
  ) {
    return "register_closeout";
  }

  return conflict.conflictType ?? null;
}

function numberDetail(
  details: Record<string, unknown> | undefined,
  key: string,
) {
  const value = details?.[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildRegisterSessionLocalSyncStatus(
  conflicts: RegisterSessionSyncConflict[],
): RegisterSessionLocalSyncStatus | null {
  if (conflicts.length === 0) {
    return null;
  }

  return {
    status: "needs_review",
    reconciliationItems: conflicts.map((conflict) => ({
      createdAt: conflict.createdAt,
      countedCash: numberDetail(conflict.details, "countedCash"),
      expectedCash: numberDetail(conflict.details, "expectedCash"),
      id: conflict._id,
      localEventId: conflict.localEventId,
      sequence: conflict.sequence,
      status: conflict.status,
      summary: conflict.summary,
      type: getSyncConflictReconciliationType(conflict),
      variance: numberDetail(conflict.details, "variance"),
    })),
  };
}

export async function listOpenLocalSyncConflictsByRegisterSession(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
  options: { includeRejectedEvidence?: boolean } = {},
) {
  const [needsReviewConflicts, resolvedConflicts, rejectedEvents] = await Promise.all([
    ctx.db
      .query("posLocalSyncConflict")
      .withIndex("by_store_status", (q) =>
        q.eq("storeId", storeId).eq("status", "needs_review"),
      )
      .take(SYNC_CONFLICT_LIMIT),
    ctx.db
      .query("posLocalSyncConflict")
      .withIndex("by_store_status", (q) =>
        q.eq("storeId", storeId).eq("status", "resolved"),
      )
      .take(SYNC_CONFLICT_LIMIT),
    options.includeRejectedEvidence
      ? ctx.db
          .query("posLocalSyncEvent")
          .withIndex("by_store_status", (q) =>
            q.eq("storeId", storeId).eq("status", "rejected"),
          )
          .take(SYNC_CONFLICT_LIMIT)
      : Promise.resolve([]),
  ]);
  const staleResolvedConflicts = await Promise.all(
    resolvedConflicts.map(async (conflict) => {
      const syncEvent = await ctx.db
        .query("posLocalSyncEvent")
        .withIndex("by_store_terminal_localEvent", (q) =>
          q
            .eq("storeId", conflict.storeId)
            .eq("terminalId", conflict.terminalId)
            .eq("localEventId", conflict.localEventId),
        )
        .unique();

      if (syncEvent?.status === "conflicted") {
        return { ...conflict, status: "needs_review" };
      }

      if (options.includeRejectedEvidence && syncEvent?.status === "rejected") {
        return {
          ...conflict,
          conflictType: "server_rejected",
          status: "rejected",
          summary:
            syncEvent.rejectionMessage ??
            "Server rejected synced register activity for this drawer.",
        };
      }

      return null;
    }),
  );
  const conflicts: RegisterSessionSyncConflict[] = [
    ...needsReviewConflicts,
    ...staleResolvedConflicts.filter(
      (conflict): conflict is Doc<"posLocalSyncConflict"> => conflict !== null,
    ),
  ];
  const includedConflictKeys = new Set(
    conflicts.map((conflict) =>
      [conflict.terminalId, conflict.localEventId].join(":"),
    ),
  );
  if (options.includeRejectedEvidence) {
    for (const event of rejectedEvents) {
      const key = [event.terminalId, event.localEventId].join(":");
      if (includedConflictKeys.has(key)) continue;

      conflicts.push({
        _id: event._id,
        conflictType: "server_rejected",
        createdAt: event.acceptedAt ?? event.submittedAt,
        details: {},
        localEventId: event.localEventId,
        localRegisterSessionId: event.localRegisterSessionId,
        sequence: event.sequence,
        status: event.status,
        storeId: event.storeId,
        summary:
          event.rejectionMessage ??
          "Server rejected synced register activity for this drawer.",
        terminalId: event.terminalId,
      });
    }
  }
  const entries = await Promise.all(
    conflicts.map(async (conflict) => {
      const { terminalId, localRegisterSessionId } = conflict;
      if (!terminalId || !localRegisterSessionId) {
        return null;
      }
      const conflictStoreId = conflict.storeId ?? storeId;

      const registerSessionMapping = await ctx.db
        .query("posLocalSyncMapping")
        .withIndex("by_store_terminal_local", (q) =>
          q
            .eq("storeId", conflictStoreId)
            .eq("terminalId", terminalId)
            .eq("localRegisterSessionId", localRegisterSessionId)
            .eq("localIdKind", "registerSession")
            .eq("localId", localRegisterSessionId),
        )
        .unique();
      if (registerSessionMapping?.cloudTable === "registerSession") {
        return [
          registerSessionMapping.cloudId as Id<"registerSession">,
          conflict,
        ] as const;
      }

      const normalizeId = (
        ctx.db as unknown as {
          normalizeId?: (
            tableName: string,
            value: string,
          ) => Id<"registerSession"> | null;
        }
      ).normalizeId;
      const cloudRegisterSessionId =
        normalizeId?.call(ctx.db, "registerSession", localRegisterSessionId) ??
        null;
      if (cloudRegisterSessionId) {
        const registerSession = await ctx.db.get(
          "registerSession",
          cloudRegisterSessionId,
        );
        if (!registerSession) return null;
        if (
          registerSession.storeId === conflictStoreId &&
          registerSession.terminalId === terminalId
        ) {
          return [cloudRegisterSessionId, conflict] as const;
        }
      }

      return null;
    }),
  );

  return entries.reduce(
    (conflictsBySessionId, entry) => {
      if (!entry) return conflictsBySessionId;
      const [registerSessionId, conflict] = entry;
      conflictsBySessionId.set(registerSessionId, [
        ...(conflictsBySessionId.get(registerSessionId) ?? []),
        conflict,
      ]);
      return conflictsBySessionId;
    },
    new Map<Id<"registerSession">, RegisterSessionSyncConflict[]>(),
  );
}
