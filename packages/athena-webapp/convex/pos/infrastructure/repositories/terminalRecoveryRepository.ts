import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import type {
  TerminalRecoveryCommandReadRepository,
  TerminalRecoveryCommandRepository,
} from "../../application/terminalRecovery/terminalCommandService";
import { resolveTerminalRegisterConflict } from "./terminalRegisterConflictResolution";

type TerminalRecoveryCtx = QueryCtx | MutationCtx;
export type TerminalRecoveryConflictRepositoryCtx = QueryCtx | MutationCtx;
const TERMINAL_RECOVERY_CONFLICT_SOURCE_LOOKUP_CAP = 100;
const TERMINAL_RUNTIME_VERIFICATION_BATCH_SIZE = 20;
const TERMINAL_RUNTIME_VERIFICATION_CURRENT_SIZE = 5;
const TERMINAL_RUNTIME_VERIFICATION_ROTATION_SIZE =
  TERMINAL_RUNTIME_VERIFICATION_BATCH_SIZE -
  TERMINAL_RUNTIME_VERIFICATION_CURRENT_SIZE;
const TERMINAL_RECOVERY_CONFLICT_TYPES = [
  "duplicate_local_id",
  "inventory",
  "payment",
  "permission",
] as const;

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
    async listRuntimeVerificationReadyCommands(args) {
      if (typeof ctx.db.query !== "function") {
        return { commands: [] };
      }
      const verificationReadyQuery = () =>
        ctx.db
          .query("posTerminalRecoveryCommand")
          .withIndex("by_store_terminal_verification", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("terminalId", args.terminalId)
              .eq("verificationStatus", "runtime_verification_ready"),
          );
      const [newestCommands, rotationPage] = await Promise.all([
        // Keep current operator work prompt while a persisted cursor rotates
        // the rest of the bounded read through every verification-ready row.
        verificationReadyQuery()
          .order("desc")
          .take(TERMINAL_RUNTIME_VERIFICATION_CURRENT_SIZE),
        verificationReadyQuery()
          .order("asc")
          .paginate({
            cursor: args.cursor ?? null,
            numItems: TERMINAL_RUNTIME_VERIFICATION_ROTATION_SIZE,
          }),
      ]);

      return {
        commands: dedupeRecoveryCommandsById([
          ...newestCommands,
          ...rotationPage.page,
        ]),
        nextCursor: rotationPage.isDone
          ? undefined
          : rotationPage.continueCursor,
      };
    },
  };
}

function dedupeRecoveryCommandsById<
  T extends Pick<Doc<"posTerminalRecoveryCommand">, "_id">,
>(commands: T[]) {
  const seen = new Set<Id<"posTerminalRecoveryCommand">>();
  return commands.filter((command) => {
    if (seen.has(command._id)) return false;
    seen.add(command._id);
    return true;
  });
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

/**
 * How the register drawer that blocked this conflict currently reads. Settled
 * blockers stay in the candidate read (V26-1250) so obsolete register opens can
 * reach durable `resolved` state instead of being filtered out forever.
 */
export type TerminalRecoveryRepairBlockerStatus =
  | "current"
  | "not_register_conflict"
  | "settled"
  | "unresolved";

export type TerminalRecoveryRepairCandidate = {
  blockerStatus: TerminalRecoveryRepairBlockerStatus;
  conflict: Doc<"posLocalSyncConflict">;
};

export type TerminalRecoveryRepairCandidateRead = {
  candidates: TerminalRecoveryRepairCandidate[];
  /** True when a per-type cap truncated the read; repeat repair to converge. */
  isIncomplete: boolean;
};

export async function listTerminalRecoveryConflictsForRepair(
  ctx: QueryCtx | MutationCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<TerminalRecoveryRepairCandidateRead> {
  const { conflicts, isIncomplete } = await listTerminalRecoveryConflictSources(
    ctx,
    args,
  );

  const candidates = await Promise.all(
    conflicts.map(async (conflict) => ({
      blockerStatus: await resolveTerminalRecoveryConflictBlockerStatus(
        ctx,
        conflict,
        args,
      ),
      conflict,
    })),
  );

  return { candidates, isIncomplete };
}

/**
 * Event-scoped settle read. Every duplicate conflict row raised for one source
 * event is settled together, so this reads by `by_store_terminal_localEvent`
 * rather than rescanning the terminal-wide conflict list.
 */
export async function listTerminalRecoveryConflictRowsForEvent(
  ctx: QueryCtx | MutationCtx,
  args: {
    limit: number;
    localEventId: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<{ isIncomplete: boolean; rows: Doc<"posLocalSyncConflict">[] }> {
  // Status-scoped window: only open rows count toward the per-event cap, so an
  // event's settled history never truncates the read, while a window that is
  // still truncated fails closed rather than settling part of one event.
  const openRows = await ctx.db
    .query("posLocalSyncConflict")
    .withIndex("by_store_terminal_localEvent_status", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("terminalId", args.terminalId)
        .eq("localEventId", args.localEventId)
        .eq("status", "needs_review"),
    )
    .take(args.limit + 1);

  return {
    isIncomplete: openRows.length > args.limit,
    rows: openRows.slice(0, args.limit),
  };
}

async function listTerminalRecoveryConflictSources(
  ctx: QueryCtx | MutationCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const conflictsByType = await Promise.all(
    TERMINAL_RECOVERY_CONFLICT_TYPES.map((conflictType) =>
      ctx.db
        .query("posLocalSyncConflict")
        .withIndex("by_store_terminal_status_type", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("status", "needs_review")
            .eq("conflictType", conflictType),
        )
        .order("desc")
        .take(TERMINAL_RECOVERY_CONFLICT_SOURCE_LOOKUP_CAP + 1),
    ),
  );

  return {
    conflicts: dedupeRecoveryConflictsById(
      conflictsByType.flatMap((conflicts) =>
        conflicts.slice(0, TERMINAL_RECOVERY_CONFLICT_SOURCE_LOOKUP_CAP),
      ),
    ).sort((left, right) => right.sequence - left.sequence),
    isIncomplete: conflictsByType.some(
      (conflicts) =>
        conflicts.length > TERMINAL_RECOVERY_CONFLICT_SOURCE_LOOKUP_CAP,
    ),
  };
}

function dedupeRecoveryConflictsById<
  T extends Pick<Doc<"posLocalSyncConflict">, "_id">,
>(conflicts: T[]) {
  const seen = new Set<Id<"posLocalSyncConflict">>();
  return conflicts.filter((conflict) => {
    if (seen.has(conflict._id)) {
      return false;
    }
    seen.add(conflict._id);
    return true;
  });
}

async function resolveTerminalRecoveryConflictBlockerStatus(
  ctx: QueryCtx | MutationCtx,
  conflict: Doc<"posLocalSyncConflict">,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<TerminalRecoveryRepairBlockerStatus> {
  const resolution = await resolveTerminalRegisterConflict(ctx, {
    conflict,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
  return resolution.status;
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
