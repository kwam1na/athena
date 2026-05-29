import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

import {
  getLatestRuntimeStatusForTerminal,
  getTerminalByFingerprint as getTerminalByFingerprintRecord,
  getTerminalById,
  getTerminalSyncEvidence,
  listTerminalsForStore,
  resolveTerminalRegisterSessionActionTarget,
  type TerminalSyncEvidence,
} from "../../infrastructure/repositories/terminalRepository";

const EMPTY_TERMINAL_SYNC_EVIDENCE: TerminalSyncEvidence = {
  latestEvent: null,
  latestReviewEvent: null,
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

export type TerminalHealthAttentionReason = {
  actionTarget?: TerminalHealthAttentionActionTarget;
  count?: number;
  latestEventSequence?: number;
  latestEventStatus?: string;
  nextPendingUploadSequence?: number;
  oldestPendingEventAt?: number;
  source: "cloud_sync" | "local_runtime" | "terminal_runtime";
  summary: string;
  type:
    | "cloud_conflict"
    | "cloud_held"
    | "cloud_rejected"
    | "local_review"
    | "local_store_unavailable"
    | "sync_failed"
    | "sync_unavailable"
    | "terminal_seed_missing";
};

export type TerminalHealthAttentionActionTarget =
  | { type: "cash_control_register_session"; registerSessionId: Id<"registerSession"> }
  | { type: "open_work" }
  | { type: "pos_register" }
  | { type: "pos_settings" };

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
  attentionReasons: TerminalHealthAttentionReason[];
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
  const attentionReasons = deriveTerminalHealthAttentionReasons({
    runtimeStatus,
    syncEvidence,
    terminalStatus: args.terminal.status,
  });
  const resolvedAttentionReasons = await resolveAttentionReasonActionTargets(
    ctx,
    {
      attentionReasons,
      storeId: args.terminal.storeId,
      syncEvidence,
      terminalId: args.terminal._id,
    },
  );

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
      attentionReasons: resolvedAttentionReasons,
      runtimeAgeMs,
      runtimeStatus,
      syncEvidence,
      terminalStatus: args.terminal.status,
    }),
    runtimeAgeMs,
    runtimeStatus: runtimeStatus ? stripRuntimeStatusIdentity(runtimeStatus) : null,
    attentionReasons: resolvedAttentionReasons,
    syncEvidence,
  };
}

async function resolveAttentionReasonActionTargets(
  ctx: QueryCtx,
  args: {
    attentionReasons: TerminalHealthAttentionReason[];
    storeId: Id<"store">;
    syncEvidence: TerminalSyncEvidence;
    terminalId: Id<"posTerminal">;
  },
): Promise<TerminalHealthAttentionReason[]> {
  const cloudRegisterSessionId =
    args.attentionReasons.some((reason) => reason.source === "cloud_sync")
      ? await resolveTerminalRegisterSessionActionTarget(ctx, {
          localRegisterSessionId:
            args.syncEvidence.latestReviewEvent?.localRegisterSessionId ??
            args.syncEvidence.latestEvent?.localRegisterSessionId,
          storeId: args.storeId,
          terminalId: args.terminalId,
        })
      : null;

  return args.attentionReasons.map((reason) => ({
    ...reason,
    actionTarget: getAttentionReasonActionTarget(reason, {
      cloudRegisterSessionId,
    }),
  }));
}

function getAttentionReasonActionTarget(
  reason: TerminalHealthAttentionReason,
  context: {
    cloudRegisterSessionId: Id<"registerSession"> | null;
  },
): TerminalHealthAttentionActionTarget {
  switch (reason.type) {
    case "cloud_conflict":
    case "cloud_held":
    case "cloud_rejected":
      return context.cloudRegisterSessionId
        ? {
            registerSessionId: context.cloudRegisterSessionId,
            type: "cash_control_register_session",
          }
        : { type: "open_work" };
    case "terminal_seed_missing":
      return { type: "pos_settings" };
    case "local_review":
    case "local_store_unavailable":
    case "sync_failed":
    case "sync_unavailable":
      return { type: "pos_register" };
  }
}

function deriveTerminalHealth(input: {
  attentionReasons: TerminalHealthAttentionReason[];
  runtimeAgeMs: number | null;
  runtimeStatus: Doc<"posTerminalRuntimeStatus"> | null;
  syncEvidence: TerminalSyncEvidence;
  terminalStatus: Doc<"posTerminal">["status"];
}): TerminalHealth {
  if (input.terminalStatus !== "active") {
    return "offline";
  }

  if (input.attentionReasons.length > 0) {
    return "needs_attention";
  }

  if (!input.runtimeStatus || input.runtimeAgeMs === null) {
    return "unknown";
  }

  if (
    input.runtimeAgeMs <= 2 * 60 * 1000 &&
    input.runtimeStatus.browserInfo?.online !== false
  ) {
    return "online";
  }

  return input.runtimeAgeMs <= 15 * 60 * 1000 ? "stale" : "offline";
}

function deriveTerminalHealthAttentionReasons(input: {
  runtimeStatus: Doc<"posTerminalRuntimeStatus"> | null;
  syncEvidence: TerminalSyncEvidence;
  terminalStatus: Doc<"posTerminal">["status"];
}): TerminalHealthAttentionReason[] {
  if (input.terminalStatus !== "active") {
    return [];
  }

  const reasons: TerminalHealthAttentionReason[] = [];
  const sync = input.runtimeStatus?.sync;
  const latestEvent = input.syncEvidence.latestEvent;

  if (sync && (sync.status === "needs_review" || sync.reviewEventCount > 0)) {
    const count = Math.max(1, sync.reviewEventCount);
    reasons.push({
      count,
      nextPendingUploadSequence: sync.nextPendingUploadSequence,
      oldestPendingEventAt: sync.oldestPendingEventAt,
      source: "local_runtime",
      summary: `${count} local review item${count === 1 ? " is" : "s are"} still on this terminal.`,
      type: "local_review",
    });
  }

  if (sync && (sync.status === "failed" || sync.failedEventCount > 0)) {
    const count = Math.max(1, sync.failedEventCount);
    reasons.push({
      count,
      nextPendingUploadSequence: sync.nextPendingUploadSequence,
      oldestPendingEventAt: sync.oldestPendingEventAt,
      source: "local_runtime",
      summary: `${count} local sync item${count === 1 ? " has" : "s have"} failed on this terminal.`,
      type: "sync_failed",
    });
  }

  if (sync?.status === "unavailable") {
    reasons.push({
      source: "local_runtime",
      summary: "Local sync runtime is unavailable on this terminal.",
      type: "sync_unavailable",
    });
  }

  if (input.runtimeStatus?.localStore.available === false) {
    reasons.push({
      source: "terminal_runtime",
      summary: "Local terminal storage is not available.",
      type: "local_store_unavailable",
    });
  }

  if (input.runtimeStatus?.localStore.terminalSeedReady === false) {
    reasons.push({
      source: "terminal_runtime",
      summary: "Terminal setup data is not ready on this checkout station.",
      type: "terminal_seed_missing",
    });
  }

  if (input.syncEvidence.conflictedCount > 0) {
    reasons.push({
      count: input.syncEvidence.conflictedCount,
      latestEventSequence: latestEvent?.sequence,
      latestEventStatus: latestEvent?.status,
      source: "cloud_sync",
      summary: `${input.syncEvidence.conflictedCount} cloud sync conflict${input.syncEvidence.conflictedCount === 1 ? " needs" : "s need"} review.`,
      type: "cloud_conflict",
    });
  }

  if (input.syncEvidence.heldCount > 0) {
    reasons.push({
      count: input.syncEvidence.heldCount,
      latestEventSequence: latestEvent?.sequence,
      latestEventStatus: latestEvent?.status,
      source: "cloud_sync",
      summary: `${input.syncEvidence.heldCount} synced item${input.syncEvidence.heldCount === 1 ? " is" : "s are"} held before projection.`,
      type: "cloud_held",
    });
  }

  if (input.syncEvidence.rejectedCount > 0) {
    reasons.push({
      count: input.syncEvidence.rejectedCount,
      latestEventSequence: latestEvent?.sequence,
      latestEventStatus: latestEvent?.status,
      source: "cloud_sync",
      summary: `${input.syncEvidence.rejectedCount} synced item${input.syncEvidence.rejectedCount === 1 ? " was" : "s were"} rejected by the server.`,
      type: "cloud_rejected",
    });
  }

  return reasons;
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
