import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import { isPosUsableRegisterSessionStatus } from "../../../../shared/registerSessionStatus";
import {
  getActiveRegisterSessionForTerminal,
  getDrawerAuthorityRegisterSession,
  getLatestRegisterSessionForTerminal,
  getLatestRuntimeStatusForTerminal,
  getTerminalSyncEvidence,
} from "../../infrastructure/repositories/terminalRepository";
import type { TerminalOperationalFacts } from "./facts";

export async function collectTerminalOperationalFacts(
  ctx: QueryCtx,
  args: {
    emptySyncEvidence: TerminalOperationalFacts["rawSyncEvidence"];
    includeSyncEvidence: boolean;
    terminal: Doc<"posTerminal">;
  },
): Promise<TerminalOperationalFacts> {
  const runtimeStatusPromise = getLatestRuntimeStatusForTerminal(ctx, {
    storeId: args.terminal.storeId,
    terminalId: args.terminal._id,
  });
  const [runtimeStatus, rawSyncEvidence, latestRegisterSession, activeRegisterSession] =
    await Promise.all([
      runtimeStatusPromise,
      args.includeSyncEvidence
        ? getTerminalSyncEvidence(ctx, {
            storeId: args.terminal.storeId,
            terminalId: args.terminal._id,
          })
        : args.emptySyncEvidence,
      getLatestRegisterSessionForTerminal(ctx, {
        registerNumber: args.terminal.registerNumber,
        storeId: args.terminal.storeId,
        terminalId: args.terminal._id,
      }),
      getActiveRegisterSessionForTerminal(ctx, {
        registerNumber: args.terminal.registerNumber,
        storeId: args.terminal.storeId,
        terminalId: args.terminal._id,
      }),
    ]);
  const drawerAuthorityRegisterSession = await getDrawerAuthorityRegisterSession(ctx, {
    runtimeStatus,
    storeId: args.terminal.storeId,
    terminalId: args.terminal._id,
  });

  return {
    activeRegisterSession,
    drawerAuthorityRegisterSession,
    latestRegisterSession,
    rawSyncEvidence,
    registerSessionLink: toRegisterSessionLink(activeRegisterSession),
    runtimeStatus,
  };
}

function toRegisterSessionLink(
  session: Doc<"registerSession"> | null,
): TerminalOperationalFacts["registerSessionLink"] {
  if (!session || !isPosUsableRegisterSessionStatus(session.status)) {
    return null;
  }

  return {
    registerSessionId: session._id,
    status: session.status as Extract<Doc<"registerSession">["status"], "active" | "open">,
  };
}
