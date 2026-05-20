import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

import {
  getLatestRuntimeStatusForTerminal,
  getTerminalByFingerprint as getTerminalByFingerprintRecord,
  getTerminalById,
  getTerminalSyncEvidence,
  listTerminalsForStore,
  type TerminalSyncEvidence,
} from "../../infrastructure/repositories/terminalRepository";

const EMPTY_TERMINAL_SYNC_EVIDENCE: TerminalSyncEvidence = {
  latestEvent: null,
  sampledEventCount: 0,
  acceptedCount: 0,
  projectedCount: 0,
  conflictedCount: 0,
  heldCount: 0,
  rejectedCount: 0,
};

export type TerminalHealth =
  | "online"
  | "stale"
  | "offline"
  | "needs_attention"
  | "unknown";

export type TerminalHealthSummary = {
  terminal: {
    _id: Id<"posTerminal">;
    displayName: string;
    registerNumber?: string;
    registeredByUserId: Id<"athenaUser">;
    registeredAt: number;
    status: Doc<"posTerminal">["status"];
    browserInfo: Doc<"posTerminal">["browserInfo"];
  };
  health: TerminalHealth;
  runtimeAgeMs: number | null;
  runtimeStatus: Omit<
    Doc<"posTerminalRuntimeStatus">,
    "_id" | "_creationTime" | "storeId" | "terminalId"
  > | null;
  syncEvidence: TerminalSyncEvidence;
};

export async function listTerminals(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
  },
) {
  return listTerminalsForStore(ctx, args.storeId);
}

export async function getTerminalByFingerprint(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    fingerprintHash: string;
  },
) {
  return getTerminalByFingerprintRecord(ctx, args);
}

export async function listTerminalHealthSummaries(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    now?: number;
  },
): Promise<TerminalHealthSummary[]> {
  const terminals = await listTerminalsForStore(ctx, args.storeId);
  return Promise.all(
    terminals.map((terminal) =>
      buildTerminalHealthSummary(ctx, {
        includeSyncEvidence: false,
        terminal,
        now: args.now ?? Date.now(),
      }),
    ),
  );
}

export async function getTerminalHealthSummary(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    now?: number;
  },
): Promise<TerminalHealthSummary | null> {
  const terminal = await getTerminalById(ctx, args.terminalId);
  if (!terminal || terminal.storeId !== args.storeId) {
    return null;
  }

  return buildTerminalHealthSummary(ctx, {
    includeSyncEvidence: true,
    terminal,
    now: args.now ?? Date.now(),
  });
}

export const listTerminalHealth = listTerminalHealthSummaries;
export const getTerminalHealthDetail = getTerminalHealthSummary;

async function buildTerminalHealthSummary(
  ctx: QueryCtx,
  args: {
    includeSyncEvidence: boolean;
    terminal: Doc<"posTerminal">;
    now: number;
  },
): Promise<TerminalHealthSummary> {
  const [runtimeStatus, syncEvidence] = await Promise.all([
    getLatestRuntimeStatusForTerminal(ctx, {
      storeId: args.terminal.storeId,
      terminalId: args.terminal._id,
    }),
    args.includeSyncEvidence
      ? getTerminalSyncEvidence(ctx, {
          storeId: args.terminal.storeId,
          terminalId: args.terminal._id,
        })
      : EMPTY_TERMINAL_SYNC_EVIDENCE,
  ]);
  const runtimeAgeMs = runtimeStatus
    ? Math.max(0, args.now - runtimeStatus.receivedAt)
    : null;

  return {
    terminal: {
      _id: args.terminal._id,
      displayName: args.terminal.displayName,
      registerNumber: args.terminal.registerNumber,
      registeredByUserId: args.terminal.registeredByUserId,
      registeredAt: args.terminal.registeredAt,
      status: args.terminal.status,
      browserInfo: args.terminal.browserInfo,
    },
    health: deriveTerminalHealth({
      runtimeAgeMs,
      runtimeStatus,
      syncEvidence,
      terminalStatus: args.terminal.status,
    }),
    runtimeAgeMs,
    runtimeStatus: runtimeStatus ? stripRuntimeStatusIdentity(runtimeStatus) : null,
    syncEvidence,
  };
}

function deriveTerminalHealth(input: {
  runtimeAgeMs: number | null;
  runtimeStatus: Doc<"posTerminalRuntimeStatus"> | null;
  syncEvidence: TerminalSyncEvidence;
  terminalStatus: Doc<"posTerminal">["status"];
}): TerminalHealth {
  if (input.terminalStatus !== "active") {
    return "offline";
  }

  if (!input.runtimeStatus || input.runtimeAgeMs === null) {
    return "unknown";
  }

  if (
    input.runtimeStatus.sync.status === "failed" ||
    input.runtimeStatus.sync.status === "needs_review" ||
    input.runtimeStatus.sync.status === "unavailable" ||
    input.runtimeStatus.sync.failedEventCount > 0 ||
    input.runtimeStatus.sync.reviewEventCount > 0 ||
    input.syncEvidence.conflictedCount > 0 ||
    input.syncEvidence.heldCount > 0 ||
    input.syncEvidence.rejectedCount > 0
  ) {
    return "needs_attention";
  }

  if (
    input.runtimeAgeMs <= 2 * 60 * 1000 &&
    input.runtimeStatus.browserInfo?.online !== false
  ) {
    return "online";
  }

  return input.runtimeAgeMs <= 15 * 60 * 1000 ? "stale" : "offline";
}

function stripRuntimeStatusIdentity(status: Doc<"posTerminalRuntimeStatus">) {
  const {
    _id: _id,
    _creationTime: _creationTime,
    storeId: _storeId,
    terminalId: _terminalId,
    ...runtimeStatus
  } = status;
  return runtimeStatus;
}
