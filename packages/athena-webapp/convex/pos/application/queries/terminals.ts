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
import {
  getTerminalRecoverySourceEvent,
  listTerminalRecoveryConflictsForRepair,
} from "../../infrastructure/repositories/terminalRecoveryRepository";
import {
  buildTerminalCloudRepairPreview,
  classifyTerminalCloudRepairConflict,
} from "../terminalRecovery/cloudRepairPolicy";
import type {
  TerminalRecoveryCommandPayload,
  TerminalRecoveryCommandType,
  TerminalRecoveryExpectedEvidence,
  TerminalRecoveryReadiness,
} from "../terminalRecovery/types";

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
    | "terminal_authorization_failed"
    | "drawer_authority_blocked"
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
  recoveryPreview: TerminalRecoveryPreview | null;
  syncEvidence: TerminalSyncEvidence;
};

export type TerminalRecoveryPreview = {
  readiness: TerminalRecoveryReadiness;
  runtimeFresh: boolean;
  evidence: {
    freshRuntimeRequiredForAbleToTransactNow: true;
  };
  cloudRepair: {
    preconditionHash: string;
    safeConflictIds: Array<Id<"posLocalSyncConflict">>;
    skippedConflictIds: Array<Id<"posLocalSyncConflict">>;
  };
  terminalActions: Array<{
    commandType: TerminalRecoveryCommandType;
    expectedEvidence: TerminalRecoveryExpectedEvidence;
    commandContext: TerminalRecoveryCommandPayload;
    reason: string;
  }>;
  manualReview: Array<{
    reason: string;
    source:
      | TerminalHealthAttentionReason["source"]
      | "cloud_repair";
    type: TerminalHealthAttentionReason["type"] | "unsafe_cloud_conflict";
  }>;
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
  const recoveryPreview = args.includeSyncEvidence
    ? await buildTerminalRecoveryPreview(ctx, {
        attentionReasons: resolvedAttentionReasons,
        now: args.now,
        runtimeAgeMs,
        runtimeStatus,
        storeId: args.terminal.storeId,
        syncEvidence,
        terminalId: args.terminal._id,
        terminalStatus: args.terminal.status,
      })
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
      attentionReasons: resolvedAttentionReasons,
      runtimeAgeMs,
      runtimeStatus,
      syncEvidence,
      terminalStatus: args.terminal.status,
    }),
    runtimeAgeMs,
    runtimeStatus: runtimeStatus ? stripRuntimeStatusIdentity(runtimeStatus) : null,
    attentionReasons: resolvedAttentionReasons,
    recoveryPreview,
    syncEvidence,
  };
}

export async function previewTerminalRecovery(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    now?: number;
  },
) {
  const summary = await getTerminalHealthSummary(ctx, args);
  return summary?.recoveryPreview ?? null;
}

async function buildTerminalRecoveryPreview(
  ctx: QueryCtx,
  args: {
    attentionReasons: TerminalHealthAttentionReason[];
    now: number;
    runtimeAgeMs: number | null;
    runtimeStatus: Doc<"posTerminalRuntimeStatus"> | null;
    storeId: Id<"store">;
    syncEvidence: TerminalSyncEvidence;
    terminalId: Id<"posTerminal">;
    terminalStatus: Doc<"posTerminal">["status"];
  },
): Promise<TerminalRecoveryPreview> {
  const runtimeFresh =
    !!args.runtimeStatus &&
    args.runtimeAgeMs !== null &&
    args.runtimeAgeMs <= 2 * 60 * 1000 &&
    args.runtimeStatus.browserInfo?.online !== false;
  const cloudRepair = await buildTerminalRecoveryCloudRepairPreview(ctx, args);
  const terminalActions = buildTerminalRecoveryActions(args);
  const manualReview = buildTerminalRecoveryManualReview({
    attentionReasons: args.attentionReasons,
    skippedConflictIds: cloudRepair.skippedConflictIds,
  });
  const healthyIdle =
    args.terminalStatus === "active" &&
    runtimeFresh &&
    terminalActions.length === 0 &&
    manualReview.length === 0 &&
    cloudRepair.safeConflictIds.length === 0 &&
    runtimeHasHealthyIdleEvidence(args.runtimeStatus, args.syncEvidence);
  const ableToTransactNow =
    healthyIdle && runtimeHasSaleAuthority(args.runtimeStatus);

  return {
    readiness: ableToTransactNow
      ? "able_to_transact_now"
      : manualReview.length > 0
        ? "needs_manual_review"
        : terminalActions.length > 0
          ? "needs_terminal_action"
          : cloudRepair.safeConflictIds.length > 0
            ? "needs_cloud_repair"
            : "healthy_idle",
    runtimeFresh,
    evidence: {
      freshRuntimeRequiredForAbleToTransactNow: true,
    },
    cloudRepair,
    terminalActions,
    manualReview,
  };
}

async function buildTerminalRecoveryCloudRepairPreview(
  ctx: QueryCtx,
  args: {
    now: number;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const conflicts = await listTerminalRecoveryConflictsForRepair(ctx, {
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
  const classified = await Promise.all(
    conflicts.map(async (conflict) =>
      classifyTerminalCloudRepairConflict({
        conflict,
        now: args.now,
        sourceEvent: await getTerminalRecoverySourceEvent(ctx, {
          storeId: args.storeId,
          terminalId: args.terminalId,
          localEventId: conflict.localEventId,
        }),
        storeId: args.storeId,
        terminalId: args.terminalId,
      }),
    ),
  );
  const preview = buildTerminalCloudRepairPreview({
    classified,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });

  return {
    preconditionHash: preview.preconditionHash,
    safeConflictIds: preview.safeConflictIds,
    skippedConflictIds: preview.skipped.map((item) => item.conflictId),
  };
}

function buildTerminalRecoveryActions(args: {
  runtimeStatus: Doc<"posTerminalRuntimeStatus"> | null;
}): TerminalRecoveryPreview["terminalActions"] {
  const status = args.runtimeStatus;
  if (!status) {
    return [];
  }

  const actions: TerminalRecoveryPreview["terminalActions"] = [];
  if (status.localStore.available === false || status.localStore.terminalSeedReady === false) {
    actions.push({
      commandType: "repair_terminal_seed",
      expectedEvidence: {
        localStoreAvailable: true,
        terminalSeedReady: true,
        terminalIntegrityStatus: "healthy",
      },
      commandContext: {
        expectedBlockerType: "terminal_seed",
        reason: "Terminal setup data needs repair.",
      },
      reason: "Terminal setup data needs repair before this checkout station can sell.",
    });
  }
  if (status.terminalIntegrity && status.terminalIntegrity.status !== "healthy") {
    actions.push({
      commandType: "repair_terminal_seed",
      expectedEvidence: {
        terminalIntegrityStatus: "healthy",
      },
      commandContext: {
        expectedBlockerType: status.terminalIntegrity.reason ?? "terminal_integrity",
        reason: "Terminal integrity requires repair.",
      },
      reason: "Terminal integrity requires local repair.",
    });
  }
  if (status.drawerAuthority?.status === "blocked") {
    actions.push({
      commandType: "clear_stale_drawer_authority",
      expectedEvidence: {
        drawerAuthorityStatus: "healthy",
        localRegisterSessionId: status.drawerAuthority.localRegisterSessionId,
      },
      commandContext: {
        cloudRegisterSessionId: status.drawerAuthority.cloudRegisterSessionId,
        expectedBlockerType: status.drawerAuthority.reason ?? "drawer_authority",
        localRegisterSessionId: status.drawerAuthority.localRegisterSessionId,
        reason: "Drawer authority requires terminal-local repair.",
      },
      reason: "Drawer authority requires terminal-local repair.",
    });
  }
  if (
    status.staffAuthority.status === "expired" ||
    status.staffAuthority.status === "missing"
  ) {
    actions.push({
      commandType: "refresh_staff_authority",
      expectedEvidence: {
        staffAuthorityStatus: "ready",
      },
      commandContext: {
        expectedBlockerType: "staff_authority",
        reason: "Staff authority must be refreshed on this terminal.",
      },
      reason: "Staff authority must be refreshed on this terminal.",
    });
  }
  if (status.sync.status === "failed" || status.sync.status === "unavailable") {
    actions.push({
      commandType: "retry_sync",
      expectedEvidence: {
        syncStatus: "idle",
      },
      commandContext: {
        expectedBlockerType: "sync_runtime",
        reason: "Local sync needs a terminal retry.",
      },
      reason: "Local sync needs a terminal retry.",
    });
  }
  return dedupeTerminalActions(actions);
}

function buildTerminalRecoveryManualReview(args: {
  attentionReasons: TerminalHealthAttentionReason[];
  skippedConflictIds: Array<Id<"posLocalSyncConflict">>;
}): TerminalRecoveryPreview["manualReview"] {
  const manual: TerminalRecoveryPreview["manualReview"] = args.attentionReasons
    .filter((reason) =>
      reason.type === "cloud_held" ||
      reason.type === "cloud_rejected" ||
      reason.type === "local_review",
    )
    .map((reason) => ({
      reason: reason.summary,
      source: reason.source,
      type: reason.type,
    }));
  for (const conflictId of args.skippedConflictIds) {
    manual.push({
      reason: `Cloud conflict ${conflictId} needs manual review before repair.`,
      source: "cloud_repair" as const,
      type: "unsafe_cloud_conflict" as const,
    });
  }
  return manual;
}

function runtimeHasHealthyIdleEvidence(
  status: Doc<"posTerminalRuntimeStatus"> | null,
  syncEvidence: TerminalSyncEvidence,
) {
  return (
    !!status &&
    status.localStore.available &&
    status.localStore.terminalSeedReady &&
    status.sync.status !== "failed" &&
    status.sync.status !== "needs_review" &&
    status.sync.status !== "unavailable" &&
    status.sync.failedEventCount === 0 &&
    status.sync.reviewEventCount === 0 &&
    (!status.terminalIntegrity || status.terminalIntegrity.status === "healthy") &&
    (!status.drawerAuthority || status.drawerAuthority.status === "healthy") &&
    (syncEvidence.unresolvedConflictCount ?? 0) === 0 &&
    syncEvidence.conflictedCount === 0 &&
    syncEvidence.heldCount === 0 &&
    syncEvidence.rejectedCount === 0
  );
}

function runtimeHasSaleAuthority(status: Doc<"posTerminalRuntimeStatus"> | null) {
  return (
    !!status &&
    status.staffAuthority.status === "ready" &&
    status.saleAuthority?.status === "ready"
  );
}

function dedupeTerminalActions(
  actions: TerminalRecoveryPreview["terminalActions"],
) {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.commandType}:${action.commandContext.expectedBlockerType ?? ""}:${action.commandContext.localRegisterSessionId ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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
  const registerSessionIdByReasonType =
    args.attentionReasons.some((reason) => reason.source === "cloud_sync")
      ? await resolveRegisterSessionTargets(ctx, args)
      : new Map<TerminalHealthAttentionReason["type"], Id<"registerSession"> | null>();

  return args.attentionReasons.map((reason) => ({
    ...reason,
    actionTarget: getAttentionReasonActionTarget(reason, {
      registerSessionId:
        registerSessionIdByReasonType.get(reason.type) ?? null,
    }),
  }));
}

async function resolveRegisterSessionTargets(
  ctx: QueryCtx,
  args: {
    attentionReasons: TerminalHealthAttentionReason[];
    storeId: Id<"store">;
    syncEvidence: TerminalSyncEvidence;
    terminalId: Id<"posTerminal">;
  },
) {
  const uniqueTypes = new Set(
    args.attentionReasons
      .filter((reason) => reason.source === "cloud_sync")
      .map((reason) => reason.type),
  );
  const entries = await Promise.all(
    [...uniqueTypes].map(async (type) => {
      const localRegisterSessionId = getReviewReasonLocalRegisterSessionId(
        type,
        args.syncEvidence,
      );
      const registerSessionId = await resolveTerminalRegisterSessionActionTarget(
        ctx,
        {
          localRegisterSessionId,
          storeId: args.storeId,
          terminalId: args.terminalId,
        },
      );
      return [type, registerSessionId] as const;
    }),
  );

  return new Map(entries);
}

function getReviewReasonLocalRegisterSessionId(
  type: TerminalHealthAttentionReason["type"],
  syncEvidence: TerminalSyncEvidence,
) {
  switch (type) {
    case "cloud_conflict":
      return (
        syncEvidence.latestReviewEventsByStatus?.conflicted
          ?.localRegisterSessionId ??
        syncEvidence.latestReviewEvent?.localRegisterSessionId ??
        syncEvidence.latestEvent?.localRegisterSessionId
      );
    case "cloud_held":
      return (
        syncEvidence.latestReviewEventsByStatus?.held?.localRegisterSessionId ??
        syncEvidence.latestReviewEvent?.localRegisterSessionId ??
        syncEvidence.latestEvent?.localRegisterSessionId
      );
    case "cloud_rejected":
      return (
        syncEvidence.latestReviewEventsByStatus?.rejected
          ?.localRegisterSessionId ??
        syncEvidence.latestReviewEvent?.localRegisterSessionId ??
        syncEvidence.latestEvent?.localRegisterSessionId
      );
    default:
      return (
        syncEvidence.latestReviewEvent?.localRegisterSessionId ??
        syncEvidence.latestEvent?.localRegisterSessionId
      );
  }
}

function getAttentionReasonActionTarget(
  reason: TerminalHealthAttentionReason,
  context: {
    registerSessionId: Id<"registerSession"> | null;
  },
): TerminalHealthAttentionActionTarget {
  switch (reason.type) {
    case "cloud_conflict":
    case "cloud_held":
    case "cloud_rejected":
      return context.registerSessionId
        ? {
            registerSessionId: context.registerSessionId,
            type: "cash_control_register_session",
          }
        : { type: "open_work" };
    case "terminal_seed_missing":
    case "terminal_authorization_failed":
      return { type: "pos_settings" };
    case "drawer_authority_blocked":
      return { type: "pos_register" };
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

  if (
    input.runtimeStatus?.terminalIntegrity &&
    input.runtimeStatus.terminalIntegrity.status !== "healthy"
  ) {
    reasons.push({
      source: "terminal_runtime",
      summary:
        "Terminal setup needs repair before this checkout station can record new sales.",
      type: "terminal_authorization_failed",
    });
  }

  if (input.runtimeStatus?.drawerAuthority?.status === "blocked") {
    reasons.push({
      source: "terminal_runtime",
      summary:
        "Drawer setup needs repair before this checkout station can record new sales.",
      type: "drawer_authority_blocked",
    });
  }

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
