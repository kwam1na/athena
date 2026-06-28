import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import { isRegisterSessionConflictBlockingStatus } from "../../../../shared/registerSessionStatus";

type TerminalRegisterConflictCtx = QueryCtx | MutationCtx;

export type TerminalRegisterConflictResolution =
  | {
      registerSession: Doc<"registerSession">;
      registerSessionId: Id<"registerSession">;
      status: "current";
    }
  | {
      registerSession: Doc<"registerSession">;
      registerSessionId: Id<"registerSession">;
      status: "settled";
    }
  | {
      status: "not_register_conflict" | "unresolved";
    };

export async function resolveTerminalRegisterConflict(
  ctx: TerminalRegisterConflictCtx,
  args: {
    conflict: Doc<"posLocalSyncConflict">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<TerminalRegisterConflictResolution> {
  if (!isRegisterSessionConflict(args.conflict)) {
    return { status: "not_register_conflict" };
  }

  const blockingRegisterSessionId =
    getBlockingRegisterSessionIdFromConflict(args.conflict);
  if (blockingRegisterSessionId) {
    const blockingResolution = await resolveScopedRegisterSession(ctx, {
      registerSessionId: blockingRegisterSessionId,
      storeId: args.storeId,
      terminalId: args.terminalId,
    });
    if (blockingResolution.status !== "unresolved") {
      return blockingResolution;
    }
  }

  return resolveTerminalRegisterSessionConflict(ctx, {
    localRegisterSessionId: args.conflict.localRegisterSessionId,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
}

export async function resolveTerminalRegisterSessionConflict(
  ctx: TerminalRegisterConflictCtx,
  args: {
    localRegisterSessionId?: string | null;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<TerminalRegisterConflictResolution> {
  if (!args.localRegisterSessionId) {
    return { status: "unresolved" };
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
    return resolveScopedRegisterSession(ctx, {
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
    return { status: "unresolved" };
  }

  return resolveScopedRegisterSession(ctx, {
    registerSessionId: cloudRegisterSessionId,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
}

export function isCurrentTerminalRegisterConflict(
  resolution: TerminalRegisterConflictResolution,
) {
  return resolution.status !== "settled";
}

function isRegisterSessionConflict(conflict: Doc<"posLocalSyncConflict">) {
  return (
    conflict.conflictType === "duplicate_local_id" ||
    conflict.conflictType === "permission"
  );
}

function getBlockingRegisterSessionIdFromConflict(
  conflict: Doc<"posLocalSyncConflict">,
) {
  const details =
    conflict.details && typeof conflict.details === "object"
      ? (conflict.details as Record<string, unknown>)
      : {};
  const blockingRegisterSessionId = details.blockingRegisterSessionId;
  return typeof blockingRegisterSessionId === "string" &&
    blockingRegisterSessionId.length > 0
    ? (blockingRegisterSessionId as Id<"registerSession">)
    : null;
}

async function resolveScopedRegisterSession(
  ctx: TerminalRegisterConflictCtx,
  args: {
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<TerminalRegisterConflictResolution> {
  const registerSession = await ctx.db.get(
    "registerSession",
    args.registerSessionId,
  );
  if (
    registerSession?.storeId !== args.storeId ||
    registerSession.terminalId !== args.terminalId
  ) {
    return { status: "unresolved" };
  }

  return isRegisterSessionConflictBlockingStatus(registerSession.status)
    ? {
        registerSession,
        registerSessionId: args.registerSessionId,
        status: "current",
      }
    : {
        registerSession,
        registerSessionId: args.registerSessionId,
        status: "settled",
      };
}
