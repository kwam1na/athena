import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import { isPosUsableRegisterSessionStatus } from "../../../../shared/registerSessionStatus";

import {
  getLatestRuntimeStatusForTerminal,
  getTerminalByFingerprint as getTerminalByFingerprintRecord,
  getTerminalById,
  getTerminalSyncEvidence,
  hasActiveRegisterSessionForTerminal,
  listTerminalsForStore,
  resolveTerminalRegisterSessionActionTarget,
  type TerminalSyncEvidence,
} from "../../infrastructure/repositories/terminalRepository";
import {
  getTerminalRecoverySourceEvent,
  listTerminalRecoveryConflictsForRepair,
  createTerminalRecoveryCommandRepository,
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
  | {
      automaticRepairEligible?: boolean;
      type: "cash_control_register_session";
      registerSessionId: Id<"registerSession">;
    }
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
  registerSessionLink: {
    registerSessionId: Id<"registerSession">;
    status: ActiveRegisterSessionLinkStatus;
  } | null;
  syncEvidence: TerminalSyncEvidence;
};

type ActiveRegisterSessionLinkStatus = Extract<
  Doc<"registerSession">["status"],
  "active" | "open"
>;

export type TerminalRecoveryPreview = {
  readiness: TerminalRecoveryReadiness;
  runtimeFresh: boolean;
  evidence: {
    freshRuntimeRequiredForAbleToTransactNow: true;
    activeRegisterSession: boolean;
  };
  cloudRepair: {
    preconditionHash: string;
    safeConflictIds: Array<Id<"posLocalSyncConflict">>;
    skippedConflictIds: Array<Id<"posLocalSyncConflict">>;
  };
  commandStatus: {
    commandId?: Id<"posTerminalRecoveryCommand">;
    commandType: TerminalRecoveryCommandType;
    label: string;
    latestAcknowledgement?: string;
    status: Doc<"posTerminalRecoveryCommand">["status"];
    verificationStatus: Doc<"posTerminalRecoveryCommand">["verificationStatus"];
  } | null;
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
        includeSyncEvidence: true,
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

async function normalizeRuntimeStatusForSupport(
  ctx: QueryCtx,
  args: {
    runtimeStatus: Doc<"posTerminalRuntimeStatus"> | null;
    terminal: Doc<"posTerminal">;
  },
): Promise<Doc<"posTerminalRuntimeStatus"> | null> {
  if (!args.runtimeStatus) {
    return null;
  }

  if (
    !(await isCleanlyClosedDrawerAuthority(ctx, {
      runtimeStatus: args.runtimeStatus,
      terminal: args.terminal,
    }))
  ) {
    return args.runtimeStatus;
  }

  return {
    ...args.runtimeStatus,
    drawerAuthority: undefined,
  };
}

async function isCleanlyClosedDrawerAuthority(
  ctx: QueryCtx,
  args: {
    runtimeStatus: Doc<"posTerminalRuntimeStatus">;
    terminal: Doc<"posTerminal">;
  },
) {
  const drawerAuthority = args.runtimeStatus.drawerAuthority;
  if (
    drawerAuthority?.status !== "blocked" ||
    drawerAuthority.reason !== "cloud_closed" ||
    !drawerAuthority.cloudRegisterSessionId
  ) {
    return false;
  }

  const db = ctx.db as {
    get?: (
      tableName: "registerSession",
      id: Id<"registerSession">,
    ) => Promise<Doc<"registerSession"> | null>;
    normalizeId?: (
      tableName: "registerSession",
      id: string,
    ) => Id<"registerSession"> | null;
  } | null;
  if (!db || typeof db.get !== "function") {
    return false;
  }

  const registerSessionId =
    typeof db.normalizeId === "function"
      ? db.normalizeId("registerSession", drawerAuthority.cloudRegisterSessionId)
      : (drawerAuthority.cloudRegisterSessionId as Id<"registerSession">);
  if (!registerSessionId) {
    return false;
  }

  const registerSession = await db.get("registerSession", registerSessionId);
  return (
    registerSession?.storeId === args.terminal.storeId &&
    registerSession.terminalId === args.terminal._id &&
    registerSession.status === "closed"
  );
}

async function buildTerminalHealthSummary(
  ctx: QueryCtx,
  args: {
    includeSyncEvidence: boolean;
    terminal: Doc<"posTerminal">;
    now: number;
  },
): Promise<TerminalHealthSummary> {
  const [runtimeStatus, syncEvidence, registerSessionLink] = await Promise.all([
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
    getActiveRegisterSessionLink(ctx, {
      storeId: args.terminal.storeId,
      terminalId: args.terminal._id,
    }),
  ]);
  const supportRuntimeStatus = await normalizeRuntimeStatusForSupport(ctx, {
    runtimeStatus,
    terminal: args.terminal,
  });
  const runtimeAgeMs = runtimeStatus
    ? Math.max(0, args.now - runtimeStatus.receivedAt)
    : null;
  const attentionReasons = deriveTerminalHealthAttentionReasons({
    runtimeStatus: supportRuntimeStatus,
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
        runtimeStatus: supportRuntimeStatus,
        registerNumber: args.terminal.registerNumber,
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
      runtimeStatus: supportRuntimeStatus,
      syncEvidence,
      terminalStatus: args.terminal.status,
    }),
    runtimeAgeMs,
    runtimeStatus: supportRuntimeStatus
      ? stripRuntimeStatusIdentity(supportRuntimeStatus)
      : null,
    attentionReasons: resolvedAttentionReasons,
    recoveryPreview,
    registerSessionLink,
    syncEvidence,
  };
}

async function getActiveRegisterSessionLink(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<TerminalHealthSummary["registerSessionLink"]> {
  if (!ctx.db || typeof ctx.db.query !== "function") {
    return null;
  }

  const byTerminal = await ctx.db
    .query("registerSession")
    .withIndex("by_terminalId", (q) => q.eq("terminalId", args.terminalId))
    .order("desc")
    .take(20);
  const activeSession = byTerminal
    .filter(
      (session) =>
        session.storeId === args.storeId &&
        session.terminalId === args.terminalId,
    )
    .filter(isActiveRegisterSessionLinkTarget)
    .sort((left, right) => right.openedAt - left.openedAt)[0];

  return activeSession
    ? {
        registerSessionId: activeSession._id,
        status: activeSession.status,
      }
    : null;
}

function isActiveRegisterSessionLinkTarget(
  session: Doc<"registerSession">,
): session is Doc<"registerSession"> & {
  status: ActiveRegisterSessionLinkStatus;
} {
  return isPosUsableRegisterSessionStatus(session.status);
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
    registerNumber?: string | null;
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
  const activeRegisterSession =
    runtimeHasActiveRegisterSession(args.runtimeStatus) ||
    (await hasActiveRegisterSessionForTerminal(ctx, {
      registerNumber: args.registerNumber,
      storeId: args.storeId,
      terminalId: args.terminalId,
    }));
  const commandStatus = await buildTerminalRecoveryCommandStatus(ctx, {
    now: args.now,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
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
    activeRegisterSession && healthyIdle && runtimeHasSaleAuthority(args.runtimeStatus);

  return {
    readiness: ableToTransactNow
      ? "able_to_transact_now"
      : manualReview.length > 0
        ? "needs_manual_review"
        : terminalActions.length > 0
          ? "needs_terminal_action"
          : cloudRepair.safeConflictIds.length > 0
            ? "needs_cloud_repair"
            : activeRegisterSession
              ? "drawer_open"
            : "healthy_idle",
    runtimeFresh,
    evidence: {
      activeRegisterSession,
      freshRuntimeRequiredForAbleToTransactNow: true,
    },
    cloudRepair,
    commandStatus,
    terminalActions,
    manualReview,
  };
}

async function buildTerminalRecoveryCommandStatus(
  ctx: QueryCtx,
  args: {
    now: number;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<TerminalRecoveryPreview["commandStatus"]> {
  const commands =
    await createTerminalRecoveryCommandRepository(ctx).listCommandsForTerminal({
      storeId: args.storeId,
      terminalId: args.terminalId,
    });
  const latestCommand = commands
    .filter(
      (command) =>
        command.storeId === args.storeId &&
        command.terminalId === args.terminalId,
    )
    .sort((left, right) => right.issuedAt - left.issuedAt)
    .at(0);
  if (!latestCommand) {
    return null;
  }

  return {
    commandId: latestCommand._id,
    commandType: latestCommand.commandType,
    label: getTerminalRecoveryCommandLabel(latestCommand.commandType),
    latestAcknowledgement: latestCommand.acknowledgement?.message,
    status: getTerminalRecoveryCommandStatusForPreview(latestCommand, args.now),
    verificationStatus: latestCommand.verificationStatus,
  };
}

function getTerminalRecoveryCommandStatusForPreview(
  command: Doc<"posTerminalRecoveryCommand">,
  now: number,
) {
  if (
    command.expiresAt <= now &&
    (command.status === "pending" || command.status === "claimed")
  ) {
    return "expired" as const;
  }

  return command.status;
}

function getTerminalRecoveryCommandLabel(commandType: TerminalRecoveryCommandType) {
  switch (commandType) {
    case "repair_terminal_seed":
      return "Terminal setup repair";
    case "clear_stale_drawer_authority":
      return "Drawer authority repair";
    case "refresh_staff_authority":
      return "Staff authority refresh";
    case "refresh_snapshots":
      return "Snapshot refresh";
    case "retry_sync":
      return "Sync retry";
    case "report_diagnostics":
      return "Diagnostics request";
  }
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
  if (status.sync.status === "needs_review" || status.sync.reviewEventCount > 0) {
    actions.push({
      commandType: "retry_sync",
      expectedEvidence: {
        syncStatus: "idle",
      },
      commandContext: {
        expectedBlockerType: "local_review",
        reason: "Local review items need a terminal sync retry.",
      },
      reason: "Local review items need a terminal sync retry.",
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
      reason:
        "A cloud sync conflict needs manual review before support can repair this terminal.",
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
    status.staffAuthority.status === "ready" &&
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

function runtimeHasActiveRegisterSession(
  status: Doc<"posTerminalRuntimeStatus"> | null,
) {
  return (
    status?.activeRegisterSession?.status === "open" ||
    status?.activeRegisterSession?.status === "active"
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
