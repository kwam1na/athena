import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import {
  isRegisterSessionConflictBlockingStatus,
} from "../../../../shared/registerSessionStatus";

import {
  getTerminalByFingerprint as getTerminalByFingerprintRecord,
  getTerminalById,
  listTerminalsForStore,
  resolveTerminalRegisterSessionActionTarget,
} from "../../infrastructure/repositories/terminalRepository";
import {
  createTerminalRecoveryCommandReadRepository,
  getTerminalRecoverySourceEvent,
  listTerminalRecoveryConflictsForRepair,
} from "../../infrastructure/repositories/terminalRecoveryRepository";
import {
  buildTerminalCloudRepairPreview,
  canProjectRegisterOpenForTerminalCloudRepair,
  classifyTerminalCloudRepairConflict,
  skipTerminalCloudRepairConflict,
  type TerminalCloudRepairConflictClassification,
  type TerminalCloudRepairProjectionEligibilityRepository,
} from "../terminalRecovery/cloudRepairPolicy";
import { parseStoredLocalSyncEvent } from "../sync/ingestLocalEvents";
import type {
  LocalSyncIngestionRepository,
  LocalSyncMappingRecord,
} from "../sync/types";
import type { TerminalRecoveryCommandType } from "../terminalRecovery/types";
import { collectTerminalOperationalFacts } from "../terminalOperationalState/collectTerminalOperationalFacts";
import { buildTerminalOperationalState } from "../terminalOperationalState/policy";
import type { TerminalSyncEvidence } from "../../domain/terminalSyncEvidence";
import type {
  TerminalAppUpdatePreview,
  TerminalAppUpdateStatus,
  TerminalHealth,
  TerminalHealthAttentionActionTarget,
  TerminalHealthAttentionReason,
  TerminalOperationalExplanation,
  TerminalOperationalState,
  TerminalRecoveryPreview,
} from "../terminalOperationalState/types";

export type {
  TerminalAppUpdatePreview,
  TerminalAppUpdateStatus,
  TerminalHealthAttentionActionTarget,
  TerminalHealthAttentionReason,
  TerminalOperationalExplanation,
  TerminalRecoveryPreview,
} from "../terminalOperationalState/types";

const EMPTY_TERMINAL_SYNC_REVIEW_SUMMARY: NonNullable<
  TerminalSyncEvidence["reviewSummary"]
> = {
  groups: [],
  meta: {
    sampledCount: 0,
    cap: 50,
    hasMore: false,
    targetResolutionIncomplete: false,
  },
};

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
  reviewSummary: EMPTY_TERMINAL_SYNC_REVIEW_SUMMARY,
};

const UNKNOWN_OPERATIONAL_EXPLANATION: TerminalOperationalExplanation = {
  blockingDomain: "none",
  detail: "Terminal health evidence has not been collected yet.",
  evidenceReferences: [],
  headline: "Health unknown",
  lane: "unknown",
  nextStep: "Wait for terminal health evidence.",
  primaryOwner: "none",
  saleImpact: "unknown",
  secondaryActions: [],
  severity: "info",
  summaryMeta: {
    hasSecondarySafeRepair: false,
    reviewBacklogCount: 0,
    targetResolutionIncomplete: false,
  },
  supportAction: "none",
};

type TerminalHealthSummarySyncEvidence = TerminalSyncEvidence & {
  reviewSummary: NonNullable<TerminalSyncEvidence["reviewSummary"]>;
};

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
  operationalExplanation: TerminalOperationalExplanation;
  recoveryPreview: TerminalRecoveryPreview | null;
  registerSessionLink: {
    registerSessionId: Id<"registerSession">;
    status: ActiveRegisterSessionLinkStatus;
  } | null;
  syncEvidence: TerminalHealthSummarySyncEvidence;
};

type ActiveRegisterSessionLinkStatus = Extract<
  Doc<"registerSession">["status"],
  "active" | "open"
>;

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

async function buildTerminalHealthSummary(
  ctx: QueryCtx,
  args: {
    includeSyncEvidence: boolean;
    terminal: Doc<"posTerminal">;
    now: number;
  },
): Promise<TerminalHealthSummary> {
  const facts = await collectTerminalOperationalFacts(ctx, {
    emptySyncEvidence: EMPTY_TERMINAL_SYNC_EVIDENCE,
    includeSyncEvidence: args.includeSyncEvidence,
    terminal: args.terminal,
  });
  const { runtimeStatus, registerSessionLink } = facts;
  const syncEvidence = normalizeTerminalSyncEvidenceReviewSummary(
    facts.rawSyncEvidence,
  );
  const runtimeAgeMs = runtimeStatus
    ? Math.max(0, args.now - runtimeStatus.receivedAt)
    : null;
  const operationalState = args.includeSyncEvidence
    ? await buildTerminalOperationalStateForSummary(ctx, {
        activeRegisterSession: facts.activeRegisterSession,
        drawerAuthorityRegisterSession: facts.drawerAuthorityRegisterSession,
        latestRegisterSession: facts.latestRegisterSession,
        now: args.now,
        runtimeAgeMs,
        runtimeStatus,
        registerNumber: args.terminal.registerNumber,
        storeId: args.terminal.storeId,
        syncEvidence: facts.rawSyncEvidence,
        terminalId: args.terminal._id,
        terminalStatus: args.terminal.status,
      })
    : null;
  const recoveryPreview = operationalState?.recoveryPreview ?? null;

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
    health: operationalState?.terminalHealth ?? "unknown",
    runtimeAgeMs,
    runtimeStatus: operationalState?.runtimeEvidence.effectiveStatus
      ? stripRuntimeStatusIdentity(operationalState.runtimeEvidence.effectiveStatus)
      : null,
    attentionReasons: operationalState?.attentionReasons ?? [],
    operationalExplanation:
      operationalState?.operationalExplanation ?? UNKNOWN_OPERATIONAL_EXPLANATION,
    recoveryPreview,
    registerSessionLink,
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

function normalizeTerminalSyncEvidenceReviewSummary(
  syncEvidence: TerminalSyncEvidence,
): TerminalHealthSummarySyncEvidence {
  return {
    ...syncEvidence,
    reviewSummary:
      syncEvidence.reviewSummary ?? EMPTY_TERMINAL_SYNC_REVIEW_SUMMARY,
  };
}

async function buildTerminalRecoveryPreview(
  ctx: QueryCtx,
  args: {
    activeRegisterSession: Doc<"registerSession"> | null;
    drawerAuthorityRegisterSession: Doc<"registerSession"> | null;
    latestRegisterSession: Doc<"registerSession"> | null;
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
  const operationalState = await buildTerminalOperationalStateForSummary(ctx, args);

  return operationalState.recoveryPreview;
}

async function buildTerminalOperationalStateForSummary(
  ctx: QueryCtx,
  args: {
    activeRegisterSession: Doc<"registerSession"> | null;
    drawerAuthorityRegisterSession: Doc<"registerSession"> | null;
    latestRegisterSession: Doc<"registerSession"> | null;
    now: number;
    runtimeAgeMs: number | null;
    runtimeStatus: Doc<"posTerminalRuntimeStatus"> | null;
    registerNumber?: string | null;
    storeId: Id<"store">;
    syncEvidence: TerminalSyncEvidence;
    terminalId: Id<"posTerminal">;
    terminalStatus: Doc<"posTerminal">["status"];
  },
): Promise<TerminalOperationalState> {
  const runtimeFresh =
    !!args.runtimeStatus &&
    args.runtimeAgeMs !== null &&
    args.runtimeAgeMs <= 2 * 60 * 1000 &&
    args.runtimeStatus.browserInfo?.online !== false;
  const cloudRepair = await buildTerminalRecoveryCloudRepairPreview(ctx, args);
  const commandStatus = await buildTerminalRecoveryCommandStatus(ctx, {
    now: args.now,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
  const policyInput = {
    appUpdate: buildTerminalAppUpdatePreview({
      commandStatus,
      now: args.now,
      runtimeAgeMs: args.runtimeAgeMs,
      runtimeFresh,
      runtimeStatus: args.runtimeStatus,
    }),
    cloudRepair,
    commandStatus,
    activeRegisterSession: args.activeRegisterSession,
    drawerAuthorityRegisterSession: args.drawerAuthorityRegisterSession,
    latestCloudRegisterSessionStatus: args.latestRegisterSession?.status,
    latestRegisterSession: args.latestRegisterSession,
    runtimeAgeMs: args.runtimeAgeMs,
    runtimeFresh,
    runtimeStatus: args.runtimeStatus,
    storeId: args.storeId,
    syncEvidence: args.syncEvidence,
    terminalId: args.terminalId,
    terminalStatus: args.terminalStatus,
  } satisfies Parameters<typeof buildTerminalOperationalState>[0];
  const operationalState = buildTerminalOperationalState(policyInput);
  const resolvedAttentionReasons = await resolveAttentionReasonActionTargets(
    ctx,
    {
      attentionReasons: operationalState.attentionReasons,
      storeId: args.storeId,
      syncEvidence: args.syncEvidence,
      terminalId: args.terminalId,
    },
  );

  return buildTerminalOperationalState({
    ...policyInput,
    attentionReasons: resolvedAttentionReasons,
  });
}

function buildTerminalAppUpdatePreview(args: {
  commandStatus: TerminalRecoveryPreview["commandStatus"];
  now: number;
  runtimeAgeMs: number | null;
  runtimeFresh: boolean;
  runtimeStatus: Doc<"posTerminalRuntimeStatus"> | null;
}): TerminalAppUpdatePreview {
  const evidence = readRuntimeAppUpdateEvidence(args.runtimeStatus);
  if (!evidence) {
    return {
      evidenceFresh: false,
      status: "unknown",
    };
  }

  const observedAt = readNumber(evidence.observedAt);
  const appUpdateEvidenceFresh =
    observedAt === undefined || args.runtimeAgeMs === null
      ? args.runtimeFresh
      : Math.max(0, args.now - observedAt) <= 2 * 60 * 1000;

  if (!args.runtimeFresh || args.runtimeAgeMs === null || !appUpdateEvidenceFresh) {
    return {
      commandCorrelated: isAppUpdateEvidenceCommandCorrelated(
        evidence,
        args.commandStatus,
      ),
      currentBuildId: readString(evidence.currentBuildId ?? evidence.currentBuildSha),
      evidenceFresh: false,
      observedAt,
      pendingBuildId: readString(evidence.pendingBuildId ?? evidence.latestBuildId),
      stagingAssetCount: readNumber(evidence.stagingAssetCount),
      stagingFailedAssetCount: readNumber(evidence.stagingFailedAssetCount),
      stagingReason: readString(evidence.stagingReason),
      stagingRejectedAssetCount: readNumber(evidence.stagingRejectedAssetCount),
      stagingStatus: readString(evidence.stagingStatus),
      status: "stale",
      summary:
        "The latest app update evidence is stale. Send Update app to ask the checkout station to check again.",
    };
  }

  const status = normalizeRuntimeAppUpdateStatus(readString(evidence.status));
  return {
    commandCorrelated: isAppUpdateEvidenceCommandCorrelated(
      evidence,
      args.commandStatus,
    ),
    currentBuildId: readString(evidence.currentBuildId ?? evidence.currentBuildSha),
    evidenceFresh: true,
    observedAt,
    pendingBuildId: readString(evidence.pendingBuildId ?? evidence.latestBuildId),
    stagingAssetCount: readNumber(evidence.stagingAssetCount),
    stagingFailedAssetCount: readNumber(evidence.stagingFailedAssetCount),
    stagingReason: readString(evidence.stagingReason),
    stagingRejectedAssetCount: readNumber(evidence.stagingRejectedAssetCount),
    stagingStatus: readString(evidence.stagingStatus),
    status,
    summary: getRuntimeAppUpdateSummary(status, evidence),
  };
}

function readRuntimeAppUpdateEvidence(
  runtimeStatus: Doc<"posTerminalRuntimeStatus"> | null,
) {
  if (!runtimeStatus) {
    return null;
  }

  const evidence = (runtimeStatus as unknown as { appUpdate?: unknown }).appUpdate;
  return evidence && typeof evidence === "object"
    ? (evidence as Record<string, unknown>)
    : null;
}

function normalizeRuntimeAppUpdateStatus(
  status?: string,
): TerminalAppUpdateStatus {
  switch (status) {
    case "applying":
      return "applying";
    case "blocked":
      return "blocked";
    case "current":
      return "current";
    case "detector-failed":
    case "detector_failed":
      return "detector_failed";
    case "ready":
    case "staged":
    case "update_ready":
      return "update_ready";
    case "ready_unstaged":
    case "update_ready_unstaged":
      return "update_ready_unstaged";
    case "stale":
      return "stale";
    case "unknown":
    default:
      return "unknown";
  }
}

function getRuntimeAppUpdateSummary(
  status: TerminalAppUpdateStatus,
  evidence: Record<string, unknown>,
) {
  if (status === "blocked") {
    return normalizeRuntimeAppUpdateBlockerSummary(
      readString(evidence.blockerSummary),
    );
  }
  if (status === "current") {
    return "This checkout station reports the current app build.";
  }
  if (status === "update_ready") {
    if (readString(evidence.stagingStatus) === "unstaged") {
      return getRuntimeAppUpdateStagingWarningSummary(evidence);
    }
    return "An app update is ready. The checkout station will refresh only when local work is safe.";
  }
  if (status === "update_ready_unstaged") {
    return getRuntimeAppUpdateStagingSummary(evidence);
  }
  if (status === "applying") {
    return "The checkout station accepted the update. Waiting for a fresh check-in.";
  }
  if (status === "detector_failed") {
    return "Athena could not confirm this checkout station's app update state.";
  }
  return "This checkout station has not reported app update readiness.";
}

function getRuntimeAppUpdateStagingWarningSummary(
  evidence: Record<string, unknown>,
) {
  const reason = readString(evidence.stagingReason);
  const assetSummary = formatRuntimeAppUpdateAssetSummary(evidence);

  if (reason === "service-worker-unavailable") {
    return `An app update is ready, but this browser has not connected to the POS app shell cache yet.${assetSummary}`;
  }
  if (reason === "service-worker-timeout") {
    return `An app update is ready, but offline cache preparation did not finish in time.${assetSummary}`;
  }
  if (reason === "cache-storage-unavailable") {
    return "An app update is ready, but this browser cannot prepare offline cache storage.";
  }
  if (reason === "no-entry-html" || reason === "no-static-assets") {
    return "An app update is ready, but Athena could not inspect deployed app assets for offline cache preparation.";
  }
  if (reason === "asset-staging-failed" || reason === "service-worker-error") {
    return `An app update is ready, but the POS app shell could not cache every required asset for offline use.${assetSummary}`;
  }

  return "An app update is ready, but offline cache preparation is incomplete.";
}

function getRuntimeAppUpdateStagingSummary(evidence: Record<string, unknown>) {
  const assetSummary = formatRuntimeAppUpdateAssetSummary(evidence);
  const reason = readString(evidence.stagingReason);

  if (reason === "service-worker-unavailable") {
    return `An app update was detected, but this browser has not connected to the POS app shell yet.${assetSummary}`;
  }
  if (reason === "service-worker-timeout") {
    return `An app update was detected, but the POS app shell did not finish staging assets in time.${assetSummary}`;
  }
  if (reason === "cache-storage-unavailable") {
    return "An app update was detected, but this browser cannot use Cache Storage to prepare it.";
  }
  if (reason === "no-entry-html" || reason === "no-static-assets") {
    return "An app update was detected, but Athena could not read the deployed app assets to prepare it.";
  }
  if (reason === "asset-staging-failed" || reason === "service-worker-error") {
    return `An app update was detected, but the POS app shell could not cache every required asset.${assetSummary}`;
  }

  return "An app update is available but not ready to refresh yet.";
}

function formatRuntimeAppUpdateAssetSummary(evidence: Record<string, unknown>) {
  const assetCount = readNumber(evidence.stagingAssetCount);
  const failedCount = readNumber(evidence.stagingFailedAssetCount) ?? 0;
  const rejectedCount = readNumber(evidence.stagingRejectedAssetCount) ?? 0;
  const issueCount = failedCount + rejectedCount;

  if (issueCount > 0) {
    return ` ${issueCount} of ${assetCount ?? "the"} asset${issueCount === 1 ? "" : "s"} ${issueCount === 1 ? "needs" : "need"} attention.`;
  }

  return "";
}

function normalizeRuntimeAppUpdateBlockerSummary(value?: string) {
  if (!value) {
    return "Refresh is blocked by active checkout work.";
  }
  if (/sale|payment|checkout|drawer|sync|review|work/i.test(value)) {
    return "Refresh is blocked by active checkout work.";
  }
  return "Refresh is blocked by local app work.";
}

function isAppUpdateEvidenceCommandCorrelated(
  evidence: Record<string, unknown>,
  commandStatus: TerminalRecoveryPreview["commandStatus"],
) {
  if (!commandStatus || String(commandStatus.commandType) !== "update_app") {
    return false;
  }

  const command =
    evidence.command && typeof evidence.command === "object"
      ? (evidence.command as Record<string, unknown>)
      : null;
  const executionId =
    readString(evidence.commandExecutionId) ?? readString(command?.executionId);
  const expectedExecutionId = commandStatus.appUpdateCommandExecutionId;
  if (executionId && expectedExecutionId) {
    return executionId === expectedExecutionId;
  }

  return false;
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
    await createTerminalRecoveryCommandReadRepository(ctx).listCommandsForTerminal({
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
    appUpdateCommandExecutionId:
      latestCommand.expectedEvidence.appUpdateCommandExecutionId,
    commandId: latestCommand._id,
    commandType: latestCommand.commandType,
    label: getTerminalRecoveryCommandLabel(latestCommand.commandType),
    latestAcknowledgement: latestCommand.acknowledgement?.message,
    localReviewEvents: stripLocalReviewEvents(
      latestCommand.acknowledgement?.localReviewEvents,
    ),
    status: getTerminalRecoveryCommandStatusForPreview(latestCommand, args.now),
    verificationStatus: latestCommand.verificationStatus,
  };
}

function stripLocalReviewEvents(
  events:
    | NonNullable<
        Doc<"posTerminalRecoveryCommand">["acknowledgement"]
      >["localReviewEvents"]
    | undefined,
) {
  return events?.map((event) => ({
    createdAt: event.createdAt,
    localEventId: event.localEventId,
    ...(event.localPosSessionId
      ? { localPosSessionId: event.localPosSessionId }
      : {}),
    ...(event.localRegisterSessionId
      ? { localRegisterSessionId: event.localRegisterSessionId }
      : {}),
    sequence: event.sequence,
    status: event.status,
    type: event.type,
    ...(event.uploaded !== undefined ? { uploaded: event.uploaded } : {}),
    ...(typeof event.uploadSequence === "number"
      ? { uploadSequence: event.uploadSequence }
      : {}),
  }));
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

function getTerminalRecoveryCommandLabel(
  commandType: TerminalRecoveryCommandType | string,
) {
  switch (commandType) {
    case "update_app":
      return "Update app";
    case "collect_local_review":
      return "Collect local review items";
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
    default:
      return "Terminal command";
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
  const repository = createTerminalCloudRepairQueryRepository(ctx);
  const classified = await Promise.all(
    conflicts.map(async (conflict): Promise<TerminalCloudRepairConflictClassification> => {
      const sourceEvent = await getTerminalRecoverySourceEvent(ctx, {
        storeId: args.storeId,
        terminalId: args.terminalId,
        localEventId: conflict.localEventId,
      });
      const classification = classifyTerminalCloudRepairConflict({
        conflict,
        now: args.now,
        sourceEvent,
        storeId: args.storeId,
        terminalId: args.terminalId,
      });
      if (classification.kind !== "safe_duplicate_register_opened") {
        return classification;
      }
      if (!sourceEvent) {
        return classification;
      }

      const parsed = parseStoredLocalSyncEvent(
        repository as unknown as LocalSyncIngestionRepository,
        sourceEvent,
      );
      if (
        !parsed.ok ||
        !(await canProjectRegisterOpenForTerminalCloudRepair(repository, {
          event: parsed.event,
          now: sourceEvent.acceptedAt ?? args.now,
          storeId: args.storeId,
          terminalId: args.terminalId,
        }))
      ) {
        return skipTerminalCloudRepairConflict(classification, "not_projection_safe");
      }

      return classification;
    }),
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

function createTerminalCloudRepairQueryRepository(
  ctx: QueryCtx,
): TerminalCloudRepairProjectionEligibilityRepository {
  const normalizeCloudId = <TableName extends string>(
    tableName: TableName,
    value: string,
  ) => {
    const normalizeId = (
      ctx.db as unknown as {
        normalizeId?: (tableName: string, value: string) => unknown;
      }
    ).normalizeId;
    if (typeof normalizeId !== "function") return null;
    const normalized = normalizeId.call(ctx.db, tableName, value);
    return typeof normalized === "string" ? normalized : null;
  };

  return {
    async findBlockingRegisterSession(args) {
      const terminalRows = await ctx.db
        .query("registerSession")
        .withIndex("by_terminalId", (q) => q.eq("terminalId", args.terminalId))
        .order("desc")
        .take(20);
      const latestByTerminal = terminalRows
        .filter(
          (session) =>
            session.storeId === args.storeId &&
            session.terminalId === args.terminalId,
        )
        .sort((left, right) => right._creationTime - left._creationTime)[0];
      if (
        latestByTerminal &&
        isRegisterSessionConflictBlockingStatus(latestByTerminal.status)
      ) {
        return latestByTerminal;
      }

      if (!args.registerNumber) {
        return null;
      }

      const registerRows = await ctx.db
        .query("registerSession")
        .withIndex("by_storeId_registerNumber", (q) =>
          q.eq("storeId", args.storeId).eq("registerNumber", args.registerNumber),
        )
        .order("desc")
        .take(20);
      const latestByRegisterNumber = registerRows
        .filter(
          (session) =>
            session.storeId === args.storeId &&
            session.registerNumber === args.registerNumber,
        )
        .sort((left, right) => right._creationTime - left._creationTime)[0];
      return latestByRegisterNumber &&
        isRegisterSessionConflictBlockingStatus(latestByRegisterNumber.status)
        ? latestByRegisterNumber
        : null;
    },
    getRegisterSession(registerSessionId) {
      return ctx.db.get("registerSession", registerSessionId);
    },
    getStaffProfile(staffProfileId) {
      return ctx.db.get("staffProfile", staffProfileId);
    },
    getTerminal(terminalId) {
      return ctx.db.get("posTerminal", terminalId);
    },
    async hasActivePosRole(args) {
      const assignments = await ctx.db
        .query("staffRoleAssignment")
        .withIndex("by_staffProfileId", (q) =>
          q.eq("staffProfileId", args.staffProfileId),
        )
        .take(50);
      return assignments.some(
        (assignment) =>
          assignment.storeId === args.storeId &&
          assignment.status === "active" &&
          (assignment.role === "cashier" || assignment.role === "manager") &&
          args.allowedRoles.includes(assignment.role),
      );
    },
    async listOpenRegisterReviewConflictFacts(args) {
      const registerSessionMappings = await ctx.db
        .query("posLocalSyncMapping")
        .withIndex("by_store_terminal_cloud", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("cloudTable", "registerSession")
            .eq("cloudId", args.registerSessionId),
        )
        .take(100);
      const scopedMappings = registerSessionMappings.filter(
        (mapping) =>
          mapping.storeId === args.storeId &&
          mapping.terminalId === args.terminalId &&
          mapping.cloudTable === "registerSession" &&
          mapping.cloudId === args.registerSessionId,
      ) as LocalSyncMappingRecord[];
      const mappingByLocalId = new Map(
        scopedMappings.map((mapping) => [mapping.localRegisterSessionId, mapping]),
      );
      const localRegisterSessionIds = new Set<string>([
        args.registerSessionId,
        ...scopedMappings.map((mapping) => mapping.localRegisterSessionId),
      ]);
      const facts = [];
      for (const localRegisterSessionId of localRegisterSessionIds) {
        const conflicts = await ctx.db
          .query("posLocalSyncConflict")
          .withIndex("by_store_terminal_register_status_type", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("terminalId", args.terminalId)
              .eq("localRegisterSessionId", localRegisterSessionId)
              .eq("status", "needs_review")
              .eq("conflictType", "permission"),
          )
          .take(100);
        for (const conflict of conflicts) {
          if (
            conflict.storeId !== args.storeId ||
            conflict.terminalId !== args.terminalId ||
            conflict.localRegisterSessionId !== localRegisterSessionId ||
            conflict.status !== "needs_review" ||
            conflict.conflictType !== "permission"
          ) {
            continue;
          }

          const directRegisterSessionId = normalizeCloudId(
            "registerSession",
            conflict.localRegisterSessionId,
          ) as Id<"registerSession"> | null;
          const directRegisterSession = directRegisterSessionId
            ? await ctx.db.get("registerSession", directRegisterSessionId)
            : null;
          facts.push({
            conflict,
            directRegisterSession:
              directRegisterSession &&
              directRegisterSession.storeId === args.storeId &&
              directRegisterSession.terminalId === args.terminalId
                ? {
                    _id: directRegisterSession._id,
                    storeId: directRegisterSession.storeId,
                    terminalId: directRegisterSession.terminalId,
                  }
                : null,
            registerSessionMapping:
              mappingByLocalId.get(conflict.localRegisterSessionId) ?? null,
          });
        }
      }

      return facts;
    },
    normalizeCloudId: normalizeCloudId as never,
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
  const registerSessionIdByReasonType =
    !args.syncEvidence.reviewSummary &&
    args.attentionReasons.some(isRegisterSessionReviewReason)
      ? await resolveRegisterSessionTargets(ctx, args)
      : new Map<TerminalHealthAttentionReason["type"], Id<"registerSession"> | null>();

  return args.attentionReasons.map((reason) => {
    const actionTarget = getAttentionReasonActionTarget(reason, {
      registerSessionId:
        registerSessionIdByReasonType.get(reason.type) ?? null,
    });
    if (actionTarget) {
      return {
        ...reason,
        actionTarget,
      };
    }

    const { actionTarget: _actionTarget, ...reasonWithoutActionTarget } = reason;
    return reasonWithoutActionTarget;
  });
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
      .filter(isRegisterSessionReviewReason)
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

function isRegisterSessionReviewReason(reason: TerminalHealthAttentionReason) {
  return (
    reason.source === "cloud_sync" &&
    (reason.type === "cloud_conflict" ||
      reason.type === "cloud_held" ||
      reason.type === "cloud_rejected")
  );
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
): TerminalHealthAttentionActionTarget | undefined {
  if (reason.actionTarget) {
    return reason.actionTarget;
  }

  switch (reason.type) {
    case "synced_sale_inventory_review":
      return undefined;
    case "cloud_conflict":
    case "cloud_held":
    case "cloud_rejected":
      return context.registerSessionId
        ? {
            registerSessionId: context.registerSessionId,
            type: "cash_control_register_session",
          }
        : undefined;
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

function stripRuntimeStatusIdentity(status: Doc<"posTerminalRuntimeStatus">) {
  const {
    _id: _id,
    _creationTime: _creationTime,
    storeId: _storeId,
    terminalId: _terminalId,
    ...runtimeStatus
  } = status;
  return {
    ...runtimeStatus,
    sync: {
      ...runtimeStatus.sync,
      reviewEvents: stripRuntimeReviewEvents(runtimeStatus.sync.reviewEvents),
    },
  };
}

function stripRuntimeReviewEvents(
  events: Doc<"posTerminalRuntimeStatus">["sync"]["reviewEvents"],
) {
  return events?.map((event) => ({
    createdAt: event.createdAt,
    localEventId: event.localEventId,
    ...(event.localPosSessionId
      ? { localPosSessionId: event.localPosSessionId }
      : {}),
    ...(event.localRegisterSessionId
      ? { localRegisterSessionId: event.localRegisterSessionId }
      : {}),
    sequence: event.sequence,
    status: event.status,
    type: event.type,
    ...(event.uploaded !== undefined ? { uploaded: event.uploaded } : {}),
    ...(typeof event.uploadSequence === "number"
      ? { uploadSequence: event.uploadSequence }
      : {}),
  }));
}
