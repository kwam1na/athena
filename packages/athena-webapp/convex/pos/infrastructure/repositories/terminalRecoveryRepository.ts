import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import type { TerminalRecoveryCommandRepository } from "../../application/terminalRecovery/terminalCommandService";

type TerminalRecoveryCtx = QueryCtx | MutationCtx;
export type TerminalRecoveryConflictRepositoryCtx = QueryCtx | MutationCtx;

export function createTerminalRecoveryCommandRepository(
  ctx: TerminalRecoveryCtx,
): TerminalRecoveryCommandRepository {
  return {
    getCommand(commandId) {
      return ctx.db.get("posTerminalRecoveryCommand", commandId);
    },
    async insertCommand(input) {
      const mutationCtx = ctx as MutationCtx;
      return mutationCtx.db.insert("posTerminalRecoveryCommand", input);
    },
    listCommandsForTerminal(args) {
      if (typeof ctx.db.query !== "function") {
        return Promise.resolve([]);
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
    async patchCommand(commandId, patch) {
      const mutationCtx = ctx as MutationCtx;
      await mutationCtx.db.patch("posTerminalRecoveryCommand", commandId, patch);
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
  return ctx.db
    .query("posLocalSyncConflict")
    .withIndex("by_store_terminal_status", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("terminalId", args.terminalId)
        .eq("status", "needs_review"),
    )
    .take(100);
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
