import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import { isRegisterSessionConflictBlockingStatus } from "../../../../shared/registerSessionStatus";
import type {
  TerminalRecoveryCommandReadRepository,
  TerminalRecoveryCommandRepository,
} from "../../application/terminalRecovery/terminalCommandService";

type TerminalRecoveryCtx = QueryCtx | MutationCtx;
export type TerminalRecoveryConflictRepositoryCtx = QueryCtx | MutationCtx;

export function createTerminalRecoveryCommandReadRepository(
  ctx: TerminalRecoveryCtx,
): TerminalRecoveryCommandReadRepository {
  return {
    getCommand(commandId) {
      return ctx.db.get("posTerminalRecoveryCommand", commandId);
    },
    listCommandsForTerminal(args) {
      if (typeof ctx.db.query !== "function") {
        return Promise.resolve([]);
      }
      if (args.statuses !== undefined && args.statuses.length > 0) {
        return Promise.all(
          args.statuses.map((status) => {
            if (args.expiresAfter !== undefined) {
              const expiresAfter = args.expiresAfter;
              return ctx.db
                .query("posTerminalRecoveryCommand")
                .withIndex("by_store_terminal_status_expiresAt", (q) =>
                  q
                    .eq("storeId", args.storeId)
                    .eq("terminalId", args.terminalId)
                    .eq("status", status)
                    .gt("expiresAt", expiresAfter),
                )
                .take(50);
            }

            return ctx.db
              .query("posTerminalRecoveryCommand")
              .withIndex("by_store_terminal_status", (q) =>
                q
                  .eq("storeId", args.storeId)
                  .eq("terminalId", args.terminalId)
                  .eq("status", status),
              )
              .take(50);
          }),
        ).then((commandsByStatus) => commandsByStatus.flat());
      }
      return ctx.db
        .query("posTerminalRecoveryCommand")
        .withIndex("by_store_terminal_status", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId),
        )
        .take(50);
    },
  };
}

export function createTerminalRecoveryCommandRepository(
  ctx: MutationCtx,
): TerminalRecoveryCommandRepository {
  return {
    ...createTerminalRecoveryCommandReadRepository(ctx),
    insertCommand(input) {
      return ctx.db.insert("posTerminalRecoveryCommand", input);
    },
    async patchCommand(commandId, patch) {
      await ctx.db.patch("posTerminalRecoveryCommand", commandId, patch);
    },
  };
}

export async function listTerminalRecoveryConflictsForRepair(
  ctx: QueryCtx | MutationCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const conflicts = await ctx.db
    .query("posLocalSyncConflict")
    .withIndex("by_store_terminal_status", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("terminalId", args.terminalId)
        .eq("status", "needs_review"),
    )
    .take(100);

  const currentConflicts = await Promise.all(
    conflicts.map(async (conflict) =>
      (await isCurrentTerminalRecoveryConflict(ctx, conflict, args))
        ? conflict
        : null,
    ),
  );
  return currentConflicts.filter(
    (conflict): conflict is Doc<"posLocalSyncConflict"> => conflict !== null,
  );
}

async function isCurrentTerminalRecoveryConflict(
  ctx: QueryCtx | MutationCtx,
  conflict: Doc<"posLocalSyncConflict">,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  if (
    conflict.conflictType !== "duplicate_local_id" &&
    conflict.conflictType !== "permission"
  ) {
    return true;
  }

  const registerSession = await resolveRegisterSessionForConflict(ctx, {
    localRegisterSessionId: conflict.localRegisterSessionId,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
  if (!registerSession) {
    return true;
  }

  return isRegisterSessionConflictBlockingStatus(registerSession.status);
}

async function resolveRegisterSessionForConflict(
  ctx: QueryCtx | MutationCtx,
  args: {
    localRegisterSessionId?: string | null;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<Doc<"registerSession"> | null> {
  if (!args.localRegisterSessionId) {
    return null;
  }
  const localRegisterSessionId = args.localRegisterSessionId;

  const mappedSession = await resolveMappedRegisterSession(ctx, {
    localRegisterSessionId,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
  if (mappedSession) {
    return mappedSession;
  }

  const normalizeId = (
    ctx.db as unknown as {
      normalizeId?: (
        tableName: string,
        value: string,
      ) => Id<"registerSession"> | null;
    }
  ).normalizeId;
  const registerSessionId =
    normalizeId?.call(ctx.db, "registerSession", localRegisterSessionId) ??
    null;
  return registerSessionId
    ? getScopedRegisterSession(ctx, {
        registerSessionId,
        storeId: args.storeId,
        terminalId: args.terminalId,
      })
    : null;
}

async function resolveMappedRegisterSession(
  ctx: QueryCtx | MutationCtx,
  args: {
    localRegisterSessionId: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const registerSessionMapping = await ctx.db
    .query("posLocalSyncMapping")
    .withIndex("by_store_terminal_local", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("terminalId", args.terminalId)
        .eq("localRegisterSessionId", args.localRegisterSessionId)
        .eq("localIdKind", "registerSession")
        .eq("localId", args.localRegisterSessionId),
    )
    .unique();
  if (registerSessionMapping?.cloudTable !== "registerSession") {
    return null;
  }

  return getScopedRegisterSession(ctx, {
    registerSessionId: registerSessionMapping.cloudId as Id<"registerSession">,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
}

async function getScopedRegisterSession(
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
  return registerSession?.storeId === args.storeId &&
    registerSession.terminalId === args.terminalId
    ? registerSession
    : null;
}

export async function getTerminalRecoverySourceEvent(
  ctx: QueryCtx | MutationCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localEventId: string;
  },
): Promise<Doc<"posLocalSyncEvent"> | null> {
  return ctx.db
    .query("posLocalSyncEvent")
    .withIndex("by_store_terminal_localEvent", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("terminalId", args.terminalId)
        .eq("localEventId", args.localEventId),
    )
    .first();
}

export async function patchTerminalRecoveryConflict(
  ctx: MutationCtx,
  conflictId: Id<"posLocalSyncConflict">,
  patch: Partial<Omit<Doc<"posLocalSyncConflict">, "_id" | "_creationTime">>,
) {
  await ctx.db.patch("posLocalSyncConflict", conflictId, patch);
}
