import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";

import type { PosLocalSyncEventStatus } from "../../../../shared/posLocalSyncContract";
import type { PosTerminalSummary } from "../../domain/types";

type PosTerminalReadCtx = QueryCtx | MutationCtx;

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
    await ctx.db.patch("posTerminalRuntimeStatus", existing._id, input);
    return existing._id;
  }

  return ctx.db.insert("posTerminalRuntimeStatus", input);
}

export type TerminalSyncEvidence = {
  latestEvent: {
    localEventId: string;
    localRegisterSessionId: string;
    sequence: number;
    eventType: Doc<"posLocalSyncEvent">["eventType"];
    status: PosLocalSyncEventStatus;
    occurredAt: number;
    submittedAt: number;
    acceptedAt?: number;
    projectedAt?: number;
  } | null;
  sampledEventCount: number;
  acceptedCount: number;
  projectedCount: number;
  conflictedCount: number;
  heldCount: number;
  rejectedCount: number;
  acceptedThroughSequence?: number;
  cursorUpdatedAt?: number;
};

const EMPTY_TERMINAL_SYNC_EVIDENCE: TerminalSyncEvidence = {
  latestEvent: null,
  sampledEventCount: 0,
  acceptedCount: 0,
  projectedCount: 0,
  conflictedCount: 0,
  heldCount: 0,
  rejectedCount: 0,
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

  const cursors = await ctx.db
    .query("posLocalSyncCursor")
    .withIndex("by_store_terminal", (q) =>
      q.eq("storeId", args.storeId).eq("terminalId", args.terminalId),
    )
    .take(50);

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
    };
  }

  const count = (status: PosLocalSyncEventStatus) =>
    events.filter((event) => event.status === status).length;
  const latestEvent = events[0];

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
    sampledEventCount: events.length,
    acceptedCount: count("accepted"),
    projectedCount: count("projected"),
    conflictedCount: count("conflicted"),
    heldCount: count("held"),
    rejectedCount: count("rejected"),
    acceptedThroughSequence: latestCursor?.acceptedThroughSequence,
    cursorUpdatedAt: latestCursor?.updatedAt,
  };
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
