import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";

import type { PosLocalSyncEventStatus } from "../../../../shared/posLocalSyncContract";
import { isPosUsableRegisterSessionStatus } from "../../../../shared/registerSessionStatus";
import type {
  TerminalSyncEvidence,
  TerminalSyncReviewActionTarget,
  TerminalSyncReviewEvent,
  TerminalSyncReviewSummary,
  TerminalSyncReviewSummaryGroup,
  TerminalSyncReviewTarget,
} from "../../domain/terminalSyncEvidence";
import type { PosTerminalSummary } from "../../domain/types";

const MANAGER_REJECTED_SYNC_REVIEW_CODE = "manager_rejected";
export const TERMINAL_SYNC_REVIEW_SUMMARY_CAP = 50;
export const TERMINAL_SYNC_REVIEW_TARGET_LOOKUP_CAP = 200;
const TERMINAL_SYNC_UNRESOLVED_CONFLICT_EXAMPLE_CAP = 20;

type PosTerminalReadCtx = QueryCtx | MutationCtx;
type TerminalSyncConflictWithReviewTarget = Doc<"posLocalSyncConflict"> & {
  reviewTarget?: TerminalSyncReviewTarget;
};

export function mapTerminalRecord(
  terminal: Doc<"posTerminal">,
): Doc<"posTerminal"> {
  return {
    _id: terminal._id,
    _creationTime: terminal._creationTime,
    storeId: terminal.storeId,
    fingerprintHash: terminal.fingerprintHash,
    displayName: terminal.displayName,
    registerNumber: terminal.registerNumber,
    loginMode: terminal.loginMode,
    transactionCapability: terminal.transactionCapability,
    registeredByUserId: terminal.registeredByUserId,
    browserInfo: terminal.browserInfo,
    registeredAt: terminal.registeredAt,
    status: terminal.status,
  };
}

export async function getTerminalForRegisterState(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
  },
): Promise<PosTerminalSummary | null> {
  if (!args.terminalId) {
    return null;
  }

  const terminal = await ctx.db.get("posTerminal", args.terminalId);
  if (
    !terminal ||
    terminal.storeId !== args.storeId ||
    terminal.status !== "active"
  ) {
    return null;
  }

  return {
    _id: terminal._id,
    displayName: terminal.displayName,
    registerNumber: terminal.registerNumber,
    loginMode: terminal.loginMode,
    transactionCapability: terminal.transactionCapability,
    status: terminal.status,
    registeredAt: terminal.registeredAt,
  };
}

export async function listTerminalsForStore(
  ctx: QueryCtx,
  storeId: Id<"store">,
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Store terminal management needs the full store-scoped roster; limiting this would hide valid terminals from the register UI.
  const terminals = await ctx.db
    .query("posTerminal")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .collect();

  return terminals.map(mapTerminalRecord);
}

export async function getLatestRuntimeStatusForTerminal(
  ctx: QueryCtx | MutationCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  return ctx.db
    .query("posTerminalRuntimeStatus")
    .withIndex("by_store_terminal", (q) =>
      q.eq("storeId", args.storeId).eq("terminalId", args.terminalId),
    )
    .order("desc")
    .first();
}

export async function upsertLatestRuntimeStatus(
  ctx: MutationCtx,
  input: Omit<Doc<"posTerminalRuntimeStatus">, "_id" | "_creationTime">,
) {
  const existing = await getLatestRuntimeStatusForTerminal(ctx, {
    storeId: input.storeId,
    terminalId: input.terminalId,
  });

  if (existing) {
    if (input.reportedAt < existing.reportedAt) {
      return existing._id;
    }

    await ctx.db.patch(
      "posTerminalRuntimeStatus",
      existing._id,
      mergeRuntimeStatusPatch(existing, input),
    );
    return existing._id;
  }

  return ctx.db.insert("posTerminalRuntimeStatus", omitUndefined(input));
}

function mergeRuntimeStatusPatch(
  existing: Doc<"posTerminalRuntimeStatus">,
  input: Omit<Doc<"posTerminalRuntimeStatus">, "_id" | "_creationTime">,
) {
  if (input.appUpdate !== undefined || existing.appUpdate === undefined) {
    return input;
  }

  return {
    ...input,
    appUpdate: existing.appUpdate,
  };
}

function omitUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(
    Object.entries(input).filter((entry) => entry[1] !== undefined),
  ) as T;
}

const EMPTY_TERMINAL_SYNC_EVIDENCE: TerminalSyncEvidence = {
  latestEvent: null,
  latestReviewEvent: null,
  latestReviewEventsByStatus: {
    conflicted: null,
    held: null,
    rejected: null,
  },
  sampledEventCount: 0,
  acceptedCount: 0,
  projectedCount: 0,
  conflictedCount: 0,
  heldCount: 0,
  rejectedCount: 0,
  unresolvedConflictCount: 0,
  unresolvedConflicts: [],
  reviewSummary: {
    groups: [],
    meta: {
      sampledCount: 0,
      cap: TERMINAL_SYNC_REVIEW_SUMMARY_CAP,
      hasMore: false,
      targetResolutionIncomplete: false,
    },
  },
};

export async function getTerminalSyncEvidence(
  ctx: QueryCtx | MutationCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<TerminalSyncEvidence> {
  const events = await ctx.db
    .query("posLocalSyncEvent")
    .withIndex("by_store_terminal_sequence", (q) =>
      q.eq("storeId", args.storeId).eq("terminalId", args.terminalId),
    )
    .order("desc")
    .take(100);

  const [cursors, conflicts] = await Promise.all([
    ctx.db
      .query("posLocalSyncCursor")
      .withIndex("by_store_terminal", (q) =>
        q.eq("storeId", args.storeId).eq("terminalId", args.terminalId),
      )
      .take(50),
    ctx.db
      .query("posLocalSyncConflict")
      .withIndex("by_store_terminal_status", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("terminalId", args.terminalId)
          .eq("status", "needs_review"),
      )
      .order("desc")
      .take(TERMINAL_SYNC_REVIEW_SUMMARY_CAP + 1),
  ]);
  const conflictSample = conflicts
    .slice(0, TERMINAL_SYNC_REVIEW_SUMMARY_CAP)
    .sort((left, right) => right.sequence - left.sequence);
  const conflictSummary = await buildTerminalSyncReviewSummary(ctx, {
    conflicts: conflictSample,
    hasMore: conflicts.length > TERMINAL_SYNC_REVIEW_SUMMARY_CAP,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
  const unresolvedConflicts = conflictSummary.conflicts
    .slice(0, TERMINAL_SYNC_UNRESOLVED_CONFLICT_EXAMPLE_CAP)
    .map(toTerminalSyncConflictExample);

  const latestCursor = cursors.reduce<Doc<"posLocalSyncCursor"> | null>(
    (latest, cursor) =>
      !latest || cursor.updatedAt > latest.updatedAt ? cursor : latest,
    null,
  );

  if (events.length === 0) {
    return {
      ...EMPTY_TERMINAL_SYNC_EVIDENCE,
      acceptedThroughSequence: latestCursor?.acceptedThroughSequence,
      cursorUpdatedAt: latestCursor?.updatedAt,
      unresolvedConflictCount: conflictSummary.reviewSummary.meta.sampledCount,
      unresolvedConflicts,
      reviewSummary: conflictSummary.reviewSummary,
    };
  }

  const count = (status: PosLocalSyncEventStatus) =>
    events.filter((event) =>
      status === "rejected"
        ? isActionableRejectedSyncEvent(event)
        : event.status === status,
    ).length;
  const latestEvent = events[0];
  const latestReviewEvent =
    events.find(isActionableTerminalReviewSyncEvent) ?? null;
  const latestReviewEventsByStatus = {
    conflicted: toTerminalSyncReviewEvent(
      events.find((event) => event.status === "conflicted") ?? null,
    ),
    held: toTerminalSyncReviewEvent(
      events.find((event) => event.status === "held") ?? null,
    ),
    rejected: toTerminalSyncReviewEvent(
      events.find(isActionableRejectedSyncEvent) ?? null,
    ),
  };

  return {
    latestEvent: {
      localEventId: latestEvent.localEventId,
      localRegisterSessionId: latestEvent.localRegisterSessionId,
      sequence: latestEvent.sequence,
      eventType: latestEvent.eventType,
      status: latestEvent.status,
      occurredAt: latestEvent.occurredAt,
      submittedAt: latestEvent.submittedAt,
      acceptedAt: latestEvent.acceptedAt,
      projectedAt: latestEvent.projectedAt,
    },
    latestReviewEvent: toTerminalSyncReviewEvent(latestReviewEvent),
    latestReviewEventsByStatus,
    sampledEventCount: events.length,
    acceptedCount: count("accepted"),
    projectedCount: count("projected"),
    conflictedCount: count("conflicted"),
    heldCount: count("held"),
    rejectedCount: count("rejected"),
    unresolvedConflictCount: conflictSummary.reviewSummary.meta.sampledCount,
    unresolvedConflicts,
    reviewSummary: conflictSummary.reviewSummary,
    acceptedThroughSequence: latestCursor?.acceptedThroughSequence,
    cursorUpdatedAt: latestCursor?.updatedAt,
  };
}

function emptyTerminalSyncReviewSummary(): TerminalSyncReviewSummary {
  return {
    groups: [],
    meta: {
      sampledCount: 0,
      cap: TERMINAL_SYNC_REVIEW_SUMMARY_CAP,
      hasMore: false,
      targetResolutionIncomplete: false,
    },
  };
}

async function buildTerminalSyncReviewSummary(
  ctx: QueryCtx | MutationCtx,
  args: {
    conflicts: Array<Doc<"posLocalSyncConflict">>;
    hasMore: boolean;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<{
  conflicts: TerminalSyncConflictWithReviewTarget[];
  reviewSummary: TerminalSyncReviewSummary;
}> {
  if (args.conflicts.length === 0) {
    const empty = emptyTerminalSyncReviewSummary();
    return {
      conflicts: [],
      reviewSummary: {
        ...empty,
        meta: {
          ...empty.meta,
          hasMore: args.hasMore,
          targetResolutionIncomplete: args.hasMore,
        },
      },
    };
  }

  const openWorkTargets = await getOpenWorkTargetsByLocalEventId(ctx, {
    conflicts: args.conflicts,
    storeId: args.storeId,
  });
  const annotatedConflicts = args.conflicts.map((conflict) => {
    const reviewTarget =
      conflict.conflictType === "inventory"
        ? openWorkTargets.targetByLocalEventId.get(conflict.localEventId)
        : undefined;
    return reviewTarget ? { ...conflict, reviewTarget } : conflict;
  });
  const groupByKey = new Map<string, TerminalSyncReviewSummaryGroup>();

  for (const conflict of annotatedConflicts) {
    const groupInput = await classifyTerminalSyncReviewConflict(ctx, {
      conflict,
      storeId: args.storeId,
      targetResolutionIncomplete:
        openWorkTargets.targetResolutionIncomplete,
      terminalId: args.terminalId,
    });
    const key = [
      groupInput.owner,
      groupInput.actionability,
      groupInput.conflictType,
      groupInput.reviewTarget?.workItemId ?? "",
      groupInput.actionTarget?.registerSessionId ?? "",
    ].join(":");
    const existing = groupByKey.get(key);
    if (existing) {
      existing.count += 1;
      if (groupInput.latestSequence > existing.latestSequence) {
        existing.latestCreatedAt = groupInput.latestCreatedAt;
        existing.latestSequence = groupInput.latestSequence;
      }
      continue;
    }
    groupByKey.set(key, groupInput);
  }

  return {
    conflicts: annotatedConflicts,
    reviewSummary: {
      groups: Array.from(groupByKey.values()).sort(
        (left, right) => right.latestSequence - left.latestSequence,
      ),
      meta: {
        sampledCount: annotatedConflicts.length,
        cap: TERMINAL_SYNC_REVIEW_SUMMARY_CAP,
        hasMore: args.hasMore,
        targetResolutionIncomplete:
          args.hasMore || openWorkTargets.targetResolutionIncomplete,
      },
    },
  };
}

async function getOpenWorkTargetsByLocalEventId(
  ctx: QueryCtx | MutationCtx,
  args: {
    conflicts: Array<Doc<"posLocalSyncConflict">>;
    storeId: Id<"store">;
  },
): Promise<{
  targetByLocalEventId: Map<string, TerminalSyncReviewTarget>;
  targetResolutionIncomplete: boolean;
}> {
  const inventoryConflictLocalEventIds = new Set(
    args.conflicts
      .filter((conflict) => conflict.conflictType === "inventory")
      .map((conflict) => conflict.localEventId),
  );
  if (inventoryConflictLocalEventIds.size === 0) {
    return {
      targetByLocalEventId: new Map(),
      targetResolutionIncomplete: false,
    };
  }

  const workItems = await ctx.db
    .query("operationalWorkItem")
    .withIndex("by_storeId_type_status", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("type", "synced_sale_inventory_review")
        .eq("status", "open"),
    )
    .take(TERMINAL_SYNC_REVIEW_TARGET_LOOKUP_CAP + 1);
  const targetByLocalEventId = new Map<string, TerminalSyncReviewTarget>();
  for (const workItem of workItems.slice(
    0,
    TERMINAL_SYNC_REVIEW_TARGET_LOOKUP_CAP,
  )) {
    const localEventId = workItem.metadata?.localEventId;
    if (
      typeof localEventId === "string" &&
      inventoryConflictLocalEventIds.has(localEventId)
    ) {
      targetByLocalEventId.set(localEventId, {
        type: "open_work",
        workItemId: workItem._id,
        workItemType: "synced_sale_inventory_review",
      });
    }
  }

  return {
    targetByLocalEventId,
    targetResolutionIncomplete:
      workItems.length > TERMINAL_SYNC_REVIEW_TARGET_LOOKUP_CAP,
  };
}

async function classifyTerminalSyncReviewConflict(
  ctx: QueryCtx | MutationCtx,
  args: {
    conflict: TerminalSyncConflictWithReviewTarget;
    storeId: Id<"store">;
    targetResolutionIncomplete: boolean;
    terminalId: Id<"posTerminal">;
  },
): Promise<TerminalSyncReviewSummaryGroup> {
  if (args.conflict.reviewTarget) {
    return {
      actionability: "open_work_review",
      conflictType: args.conflict.conflictType,
      count: 1,
      latestCreatedAt: args.conflict.createdAt,
      latestSequence: args.conflict.sequence,
      owner: "operations_open_work",
      reviewTarget: args.conflict.reviewTarget,
    };
  }

  const actionTarget = await getRegisterSessionReviewActionTarget(ctx, args);
  if (actionTarget) {
    return {
      actionTarget,
      actionability: "cash_controls_review",
      conflictType: args.conflict.conflictType,
      count: 1,
      latestCreatedAt: args.conflict.createdAt,
      latestSequence: args.conflict.sequence,
      owner: "cash_controls",
    };
  }

  if (args.conflict.conflictType === "inventory" && args.targetResolutionIncomplete) {
    return {
      actionability: "diagnostic_only",
      conflictType: args.conflict.conflictType,
      count: 1,
      latestCreatedAt: args.conflict.createdAt,
      latestSequence: args.conflict.sequence,
      owner: "diagnostic",
    };
  }

  return {
    actionability: "manual_review",
    conflictType: args.conflict.conflictType,
    count: 1,
    latestCreatedAt: args.conflict.createdAt,
    latestSequence: args.conflict.sequence,
    owner: "manual_review",
  };
}

async function getRegisterSessionReviewActionTarget(
  ctx: QueryCtx | MutationCtx,
  args: {
    conflict: Doc<"posLocalSyncConflict">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<TerminalSyncReviewActionTarget | null> {
  if (
    args.conflict.conflictType !== "duplicate_local_id" &&
    args.conflict.conflictType !== "permission"
  ) {
    return null;
  }

  const registerSessionId = await resolveTerminalRegisterSessionActionTarget(
    ctx,
    {
      localRegisterSessionId: args.conflict.localRegisterSessionId,
      storeId: args.storeId,
      terminalId: args.terminalId,
    },
  );
  return registerSessionId
    ? {
        type: "register_session",
        registerSessionId,
      }
    : null;
}

function toTerminalSyncConflictExample(
  conflict: TerminalSyncConflictWithReviewTarget,
): NonNullable<TerminalSyncEvidence["unresolvedConflicts"]>[number] {
  return {
    _id: conflict._id,
    conflictType: conflict.conflictType,
    createdAt: conflict.createdAt,
    localEventId: conflict.localEventId,
    localRegisterSessionId: conflict.localRegisterSessionId,
    ...(conflict.reviewTarget ? { reviewTarget: conflict.reviewTarget } : {}),
    sequence: conflict.sequence,
    summary: buildDisplaySafeConflictSummary(conflict),
  };
}

function buildDisplaySafeConflictSummary(
  conflict: Pick<Doc<"posLocalSyncConflict">, "conflictType">,
) {
  switch (conflict.conflictType) {
    case "inventory":
      return "Inventory needs manager review for a synced offline sale.";
    case "duplicate_local_id":
      return "A synced register event needs duplicate review.";
    case "permission":
      return "A synced register event needs permission review.";
    default:
      return "A synced register event needs review.";
  }
}

export async function hasActiveRegisterSessionForTerminal(
  ctx: QueryCtx | MutationCtx,
  args: {
    registerNumber?: string | null;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const recentByTerminal = await ctx.db
    .query("registerSession")
    .withIndex("by_terminalId", (q) => q.eq("terminalId", args.terminalId))
    .order("desc")
    .take(25);

  if (
    recentByTerminal.some((session) =>
      isUsableRegisterSessionForTerminal(session, args),
    )
  ) {
    return true;
  }

  const registerNumber = args.registerNumber?.trim();
  if (!registerNumber) {
    return false;
  }

  const recentByRegisterNumber = await ctx.db
    .query("registerSession")
    .withIndex("by_storeId_registerNumber", (q) =>
      q.eq("storeId", args.storeId).eq("registerNumber", registerNumber),
    )
    .order("desc")
    .take(25);

  return recentByRegisterNumber.some((session) =>
    isUsableRegisterSessionForTerminal(session, args),
  );
}

export async function getLatestRegisterSessionForTerminal(
  ctx: QueryCtx | MutationCtx,
  args: {
    registerNumber?: string | null;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<Doc<"registerSession"> | null> {
  const recentByTerminal = await ctx.db
    .query("registerSession")
    .withIndex("by_terminalId", (q) => q.eq("terminalId", args.terminalId))
    .order("desc")
    .take(25);
  const terminalSession = recentByTerminal
    .filter((session) => isScopedRegisterSessionForTerminal(session, args))
    .sort((left, right) => right.openedAt - left.openedAt)[0];
  if (terminalSession) {
    return terminalSession;
  }

  const registerNumber = args.registerNumber?.trim();
  if (!registerNumber) {
    return null;
  }

  const recentByRegisterNumber = await ctx.db
    .query("registerSession")
    .withIndex("by_storeId_registerNumber", (q) =>
      q.eq("storeId", args.storeId).eq("registerNumber", registerNumber),
    )
    .order("desc")
    .take(25);

  return (
    recentByRegisterNumber
      .filter((session) => isScopedRegisterSessionForTerminal(session, args))
      .sort((left, right) => right.openedAt - left.openedAt)[0] ?? null
  );
}

export async function getActiveRegisterSessionForTerminal(
  ctx: QueryCtx | MutationCtx,
  args: {
    registerNumber?: string | null;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<Doc<"registerSession"> | null> {
  const recentByTerminal = await ctx.db
    .query("registerSession")
    .withIndex("by_terminalId", (q) => q.eq("terminalId", args.terminalId))
    .order("desc")
    .take(25);
  const terminalSession = recentByTerminal
    .filter((session) => isUsableRegisterSessionForTerminal(session, args))
    .sort((left, right) => right.openedAt - left.openedAt)[0];
  if (terminalSession) {
    return terminalSession;
  }

  const registerNumber = args.registerNumber?.trim();
  if (!registerNumber) {
    return null;
  }

  const recentByRegisterNumber = await ctx.db
    .query("registerSession")
    .withIndex("by_storeId_registerNumber", (q) =>
      q.eq("storeId", args.storeId).eq("registerNumber", registerNumber),
    )
    .order("desc")
    .take(25);

  return (
    recentByRegisterNumber
      .filter((session) => isUsableRegisterSessionForTerminal(session, args))
      .sort((left, right) => right.openedAt - left.openedAt)[0] ?? null
  );
}

export async function getDrawerAuthorityRegisterSession(
  ctx: QueryCtx | MutationCtx,
  args: {
    runtimeStatus: Doc<"posTerminalRuntimeStatus"> | null;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<Doc<"registerSession"> | null> {
  const cloudRegisterSessionId =
    args.runtimeStatus?.drawerAuthority?.cloudRegisterSessionId;
  if (!cloudRegisterSessionId) {
    return null;
  }

  const normalizeId = (
    ctx.db as unknown as {
      normalizeId?: (
        tableName: "registerSession",
        id: string,
      ) => Id<"registerSession"> | null;
    }
  ).normalizeId;
  const registerSessionId =
    normalizeId?.call(ctx.db, "registerSession", cloudRegisterSessionId) ??
    (cloudRegisterSessionId as Id<"registerSession">);
  if (!registerSessionId) {
    return null;
  }

  const registerSession = await ctx.db.get(
    "registerSession",
    registerSessionId,
  );
  if (
    registerSession?.storeId === args.storeId &&
    registerSession.terminalId === args.terminalId
  ) {
    return registerSession;
  }

  return null;
}

function isUsableRegisterSessionForTerminal(
  session: Doc<"registerSession">,
  args: {
    registerNumber?: string | null;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const registerNumber = args.registerNumber?.trim();
  return (
    session.storeId === args.storeId &&
    session.terminalId === args.terminalId &&
    (!registerNumber ||
      !session.registerNumber ||
      session.registerNumber === registerNumber) &&
    isPosUsableRegisterSessionStatus(session.status)
  );
}

function isScopedRegisterSessionForTerminal(
  session: Doc<"registerSession">,
  args: {
    registerNumber?: string | null;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const registerNumber = args.registerNumber?.trim();
  return (
    session.storeId === args.storeId &&
    session.terminalId === args.terminalId &&
    (!registerNumber ||
      !session.registerNumber ||
      session.registerNumber === registerNumber)
  );
}

function isActionableTerminalReviewSyncEvent(event: Doc<"posLocalSyncEvent">) {
  if (event.status === "conflicted" || event.status === "held") {
    return true;
  }

  return isActionableRejectedSyncEvent(event);
}

function isActionableRejectedSyncEvent(event: Doc<"posLocalSyncEvent">) {
  return (
    event.status === "rejected" &&
    event.rejectionCode !== MANAGER_REJECTED_SYNC_REVIEW_CODE
  );
}

function toTerminalSyncReviewEvent(
  event: Doc<"posLocalSyncEvent"> | null,
): TerminalSyncReviewEvent | null {
  return event
    ? {
        localEventId: event.localEventId,
        localRegisterSessionId: event.localRegisterSessionId,
        sequence: event.sequence,
        eventType: event.eventType,
        status: event.status,
      }
    : null;
}

export async function resolveTerminalRegisterSessionActionTarget(
  ctx: QueryCtx | MutationCtx,
  args: {
    localRegisterSessionId?: string | null;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<Id<"registerSession"> | null> {
  if (!args.localRegisterSessionId) {
    return null;
  }
  const localRegisterSessionId = args.localRegisterSessionId;

  const registerSessionMapping = await ctx.db
    .query("posLocalSyncMapping")
    .withIndex("by_store_terminal_local", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("terminalId", args.terminalId)
        .eq("localRegisterSessionId", localRegisterSessionId)
        .eq("localIdKind", "registerSession")
        .eq("localId", localRegisterSessionId),
    )
    .unique();
  if (registerSessionMapping?.cloudTable === "registerSession") {
    return resolveRegisterSessionActionTarget(ctx, {
      registerSessionId:
        registerSessionMapping.cloudId as Id<"registerSession">,
      storeId: args.storeId,
      terminalId: args.terminalId,
    });
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
  if (!cloudRegisterSessionId) {
    return null;
  }

  return resolveRegisterSessionActionTarget(ctx, {
    registerSessionId: cloudRegisterSessionId,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
}

async function resolveRegisterSessionActionTarget(
  ctx: QueryCtx | MutationCtx,
  args: {
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const registerSession = await ctx.db.get(
    "registerSession",
    args.registerSessionId,
  );
  if (
    registerSession?.storeId === args.storeId &&
    registerSession.terminalId === args.terminalId
  ) {
    return args.registerSessionId;
  }

  return null;
}

export async function getTerminalByFingerprint(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    fingerprintHash: string;
  },
) {
  const terminal = await ctx.db
    .query("posTerminal")
    .withIndex("by_storeId_and_fingerprintHash", (q) =>
      q.eq("storeId", args.storeId).eq("fingerprintHash", args.fingerprintHash),
    )
    .first();

  return terminal ? mapTerminalRecord(terminal) : null;
}

export async function getTerminalByStoreIdAndRegisterNumber(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    registerNumber: string;
  },
) {
  return ctx.db
    .query("posTerminal")
    .withIndex("by_storeId_registerNumber", (q) =>
      q.eq("storeId", args.storeId).eq("registerNumber", args.registerNumber),
    )
    .first();
}

export async function getTerminalById(
  ctx: PosTerminalReadCtx,
  terminalId: Id<"posTerminal">,
) {
  return ctx.db.get("posTerminal", terminalId);
}

export async function registerTerminalRecord(
  ctx: MutationCtx,
  input: Omit<Doc<"posTerminal">, "_id" | "_creationTime">,
) {
  return ctx.db.insert("posTerminal", input);
}

export async function patchTerminalRecord(
  ctx: MutationCtx,
  terminalId: Id<"posTerminal">,
  patch: Partial<Omit<Doc<"posTerminal">, "_id" | "_creationTime">>,
) {
  await ctx.db.patch("posTerminal", terminalId, patch);
}

export async function deleteTerminalRecord(
  ctx: MutationCtx,
  terminalId: Id<"posTerminal">,
) {
  await ctx.db.delete("posTerminal", terminalId);
}
