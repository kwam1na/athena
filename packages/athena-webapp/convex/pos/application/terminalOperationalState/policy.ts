import {
  isRegisterSessionReplacementBlocking,
  isRegisterSessionSaleUsable,
} from "../../../../shared/registerSessionLifecyclePolicy";
import type { TerminalSyncReviewSummaryGroup } from "../../domain/terminalSyncEvidence";
import type {
  TerminalHealthAttentionReason,
  TerminalOperationalExplanation,
  TerminalOperationalPolicyInput,
  TerminalOperationalState,
  TerminalSalesReadiness,
  TerminalSupportRecovery,
} from "./types";

type TerminalSupportRecoveryInput = Pick<
  TerminalOperationalState["recoveryEvidence"],
  "cloudRepair" | "manualReview" | "terminalActions"
>;

type TerminalSalesReadinessInput = {
  activeRegisterSession: boolean;
  cloudRegisterSessionSaleUsable?: boolean;
  healthyIdle: boolean;
  saleAuthorityReady: boolean;
};

const LOCAL_REVIEW_COMMAND_EVENT_LIMIT = 100;

export function buildTerminalOperationalState(
  input: TerminalOperationalPolicyInput,
): TerminalOperationalState {
  const effectiveRuntimeStatus = normalizeRuntimeStatusForPolicy(input);
  const activeRegisterSession =
    runtimeHasActiveRegisterSession(effectiveRuntimeStatus) ||
    isRegisterSessionSaleUsable(input.activeRegisterSession) ||
    isRegisterSessionSaleUsable(input.latestRegisterSession);
  const cloudRegisterSessionSaleUsable = input.latestRegisterSession
    ? isRegisterSessionSaleUsable(input.latestRegisterSession)
    : undefined;
  const attentionReasons = reconcileTerminalHealthAttentionReasons(
    input.attentionReasons ??
      deriveTerminalHealthAttentionReasons({
        ...input,
        runtimeStatus: effectiveRuntimeStatus,
      }),
    effectiveRuntimeStatus,
  );
  const terminalActions = buildTerminalRecoveryActions(
    effectiveRuntimeStatus,
    input.commandStatus,
  );
  const manualReview = buildTerminalRecoveryManualReview({
    attentionReasons,
    safeConflictIds: input.cloudRepair.safeConflictIds,
    skippedConflictIds: input.cloudRepair.skippedConflictIds,
  });
  const healthyIdle = hasHealthyIdleEvidence({
    runtimeStatus: effectiveRuntimeStatus,
    syncEvidence: input.syncEvidence,
    terminalActions,
    manualReview,
    cloudRepair: input.cloudRepair,
    terminalStatus: input.terminalStatus,
    runtimeFresh: input.runtimeFresh,
  });
  const supportRecovery = classifySupportRecovery({
    cloudRepair: input.cloudRepair,
    manualReview,
    terminalActions,
  });
  const salesReadiness = classifySalesReadiness({
    activeRegisterSession,
    cloudRegisterSessionSaleUsable,
    healthyIdle,
    saleAuthorityReady: runtimeHasSaleAuthority(effectiveRuntimeStatus),
  });
  const readiness = supportRecovery?.status ?? salesReadiness;
  const diagnosticEvidence = buildDiagnosticEvidence({
    ...input,
    runtimeStatus: effectiveRuntimeStatus,
  });
  const terminalHealth = classifyTerminalHealth({
    attentionReasons,
    runtimeAgeMs: input.runtimeAgeMs,
    runtimeStatus: effectiveRuntimeStatus,
    terminalStatus: input.terminalStatus,
  });
  const operationalExplanation = buildTerminalOperationalExplanation({
    attentionReasons,
    cloudRepair: input.cloudRepair,
    diagnosticEvidence,
    recoveryEvidence: {
      cloudRepair: input.cloudRepair,
      manualReview,
      terminalActions,
    },
    runtimeFresh: input.runtimeFresh,
    runtimeStatus: effectiveRuntimeStatus,
    salesReadiness,
    supportRecovery,
    syncEvidence: input.syncEvidence,
    terminalHealth,
  });

  return {
    appUpdateEvidence: input.appUpdate,
    attentionReasons,
    diagnosticEvidence,
    operationalExplanation,
    recoveryEvidence: {
      cloudRepair: input.cloudRepair,
      commandStatus: input.commandStatus,
      manualReview,
      terminalActions,
    },
    recoveryPreview: {
      appUpdate: input.appUpdate,
      readiness,
      runtimeFresh: input.runtimeFresh,
      evidence: {
        activeRegisterSession,
        freshRuntimeRequiredForAbleToTransactNow: true,
      },
      cloudRepair: input.cloudRepair,
      commandStatus: input.commandStatus,
      terminalActions,
      manualReview,
    },
    registerEvidence: {
      activeRegisterSession,
      cloudRegisterSessionSaleUsable,
      latestCloudRegisterSessionStatus: input.latestCloudRegisterSessionStatus,
    },
    terminalHealth,
    runtimeEvidence: {
      effectiveStatus: effectiveRuntimeStatus,
      fresh: input.runtimeFresh,
      runtimeAgeMs: input.runtimeAgeMs,
    },
    salesReadiness,
    supportRecovery,
    syncEvidence: input.syncEvidence,
    terminalIdentity: {
      storeId: input.storeId,
      terminalId: input.terminalId,
      terminalStatus: input.terminalStatus,
    },
  };
}

function normalizeRuntimeStatusForPolicy(
  input: Pick<
    TerminalOperationalPolicyInput,
    "drawerAuthorityRegisterSession" | "runtimeStatus"
  >,
): TerminalOperationalPolicyInput["runtimeStatus"] {
  const status = input.runtimeStatus;
  if (!status || !isCleanlyClosedDrawerAuthority(input)) {
    return status;
  }

  return {
    ...status,
    drawerAuthority: undefined,
  };
}

function isCleanlyClosedDrawerAuthority(
  input: Pick<
    TerminalOperationalPolicyInput,
    "drawerAuthorityRegisterSession" | "runtimeStatus"
  >,
) {
  const drawerAuthority = input.runtimeStatus?.drawerAuthority;
  const registerSession = input.drawerAuthorityRegisterSession;
  if (
    drawerAuthority?.status !== "blocked" ||
    drawerAuthority.reason !== "cloud_closed" ||
    !registerSession
  ) {
    return false;
  }

  return !isRegisterSessionReplacementBlocking({
    hasSubmittedCloseout: registerSession.status === "closing",
    session: registerSession,
  });
}

export function deriveTerminalHealthAttentionReasons(
  input: Pick<
    TerminalOperationalPolicyInput,
    "runtimeStatus" | "syncEvidence" | "terminalStatus"
  >,
): TerminalHealthAttentionReason[] {
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

  const currentReviewGroups = getCurrentReviewGroups(input.syncEvidence);
  const inventoryReviewGroups = currentReviewGroups.filter(
    (group) => isInventoryReviewGroup(group, !!input.syncEvidence.reviewSummary),
  );
  const inventoryReviewCount = sumReviewGroupCounts(inventoryReviewGroups);

  if (inventoryReviewCount > 0) {
    const inventoryReviewTarget = inventoryReviewGroups.find(
      (group) => group.reviewTarget,
    )?.reviewTarget;
    const latestInventoryReviewSequence =
      latestReviewGroupSequence(inventoryReviewGroups) ?? latestEvent?.sequence;
    const reason: TerminalHealthAttentionReason = {
      count: inventoryReviewCount,
      latestEventSequence: latestInventoryReviewSequence,
      latestEventStatus: latestEvent?.status,
      source: "cloud_sync",
      summary: `${inventoryReviewCount} inventory review item${inventoryReviewCount === 1 ? " needs" : "s need"} attention.`,
      type: "synced_sale_inventory_review",
    };
    if (inventoryReviewTarget) {
      reason.actionTarget = {
        label: "Review inventory work",
        type: "open_work",
      };
    }
    reasons.push(reason);
  }

  const cloudReviewGroups = currentReviewGroups.filter(
    (group) => !isInventoryReviewGroup(group, !!input.syncEvidence.reviewSummary),
  );
  const openWorkCloudReviewGroups = cloudReviewGroups.filter(
    isOpenWorkReviewGroup,
  );
  const cashControlCloudReviewGroups = cloudReviewGroups.filter(
    isCashControlReviewGroup,
  );
  const manualCloudReviewGroups = cloudReviewGroups.filter(
    (group) =>
      !isOpenWorkReviewGroup(group) && !isCashControlReviewGroup(group),
  );
  const openWorkCloudReviewCount = sumReviewGroupCounts(
    openWorkCloudReviewGroups,
  );
  const manualCloudReviewCount = sumReviewGroupCounts(manualCloudReviewGroups);
  const cashControlCloudReviewCount = sumReviewGroupCounts(
    cashControlCloudReviewGroups,
  );

  if (openWorkCloudReviewCount > 0) {
    reasons.push({
      actionTarget: {
        label: "Review open work",
        type: "open_work",
      },
      count: openWorkCloudReviewCount,
      latestEventSequence:
        latestReviewGroupSequence(openWorkCloudReviewGroups) ??
        latestEvent?.sequence,
      latestEventStatus: latestEvent?.status,
      source: "cloud_sync",
      summary: `${openWorkCloudReviewCount} cloud sync conflict${openWorkCloudReviewCount === 1 ? " needs" : "s need"} review.`,
      type: "cloud_conflict",
    });
  }

  if (manualCloudReviewCount > 0) {
    reasons.push({
      count: manualCloudReviewCount,
      latestEventSequence:
        latestReviewGroupSequence(manualCloudReviewGroups) ??
        latestEvent?.sequence,
      latestEventStatus: latestEvent?.status,
      source: "cloud_sync",
      summary: `${manualCloudReviewCount} cloud sync conflict${manualCloudReviewCount === 1 ? " requires" : "s require"} manager review before support can repair this terminal.`,
      type: "cloud_conflict",
    });
  }

  if (cashControlCloudReviewCount > 0) {
    const cashControlTarget = cashControlCloudReviewGroups.find(
      (group) => group.actionTarget,
    )?.actionTarget;
    const reason: TerminalHealthAttentionReason = {
      count: cashControlCloudReviewCount,
      latestEventSequence:
        latestReviewGroupSequence(cashControlCloudReviewGroups) ??
        latestEvent?.sequence,
      latestEventStatus: latestEvent?.status,
      source: "cloud_sync",
      summary: `${cashControlCloudReviewCount} cash control review item${cashControlCloudReviewCount === 1 ? " needs" : "s need"} attention.`,
      type: "cloud_conflict",
    };
    if (cashControlTarget) {
      reason.actionTarget = {
        registerSessionId: cashControlTarget.registerSessionId,
        type: "cash_control_register_session",
      };
    }
    reasons.push(reason);
  }

  if (
    input.syncEvidence.reviewSummary?.meta.targetResolutionIncomplete &&
    currentReviewGroups.length === 0
  ) {
    reasons.push({
      source: "cloud_sync",
      summary: "Cloud sync review evidence is capped before the exact owner could be resolved.",
      type: "cloud_conflict",
    });
  }

  if (!input.syncEvidence.reviewSummary && currentReviewGroups.length === 0) {
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
  }

  return reasons;
}

function reconcileTerminalHealthAttentionReasons(
  reasons: TerminalHealthAttentionReason[],
  runtimeStatus: TerminalOperationalPolicyInput["runtimeStatus"],
): TerminalHealthAttentionReason[] {
  return reasons.filter((reason) => {
    if (reason.type === "local_review") {
      const sync = runtimeStatus?.sync;
      return Boolean(
        sync && (sync.status === "needs_review" || sync.reviewEventCount > 0),
      );
    }
    if (reason.type === "sync_failed") {
      const sync = runtimeStatus?.sync;
      return Boolean(
        sync && (sync.status === "failed" || sync.failedEventCount > 0),
      );
    }
    return true;
  });
}

function getCurrentReviewGroups(
  syncEvidence: TerminalOperationalPolicyInput["syncEvidence"],
): TerminalSyncReviewSummaryGroup[] {
  if (syncEvidence.reviewSummary) {
    return syncEvidence.reviewSummary.groups;
  }

  return (syncEvidence.unresolvedConflicts ?? []).map((conflict) => ({
    ...(conflict.reviewTarget
      ? {
          actionability: "open_work_review" as const,
          owner: "operations_open_work" as const,
          reviewTarget: conflict.reviewTarget,
        }
      : {
          actionability: "manual_review" as const,
          owner: "manual_review" as const,
        }),
    conflictType: conflict.conflictType,
    count: 1,
    latestCreatedAt: conflict.createdAt,
    latestSequence: conflict.sequence,
  }));
}

function sumReviewGroupCounts(groups: TerminalSyncReviewSummaryGroup[]) {
  return groups.reduce((total, group) => total + group.count, 0);
}

function isOpenWorkReviewGroup(group: TerminalSyncReviewSummaryGroup) {
  return (
    group.actionability === "open_work_review" ||
    group.owner === "operations_open_work" ||
    !!group.reviewTarget
  );
}

function isCashControlReviewGroup(group: TerminalSyncReviewSummaryGroup) {
  return (
    group.actionability === "cash_controls_review" ||
    group.owner === "cash_controls" ||
    group.actionTarget?.type === "register_session"
  );
}

function latestReviewGroupSequence(groups: TerminalSyncReviewSummaryGroup[]) {
  return groups.reduce<number | undefined>(
    (latest, group) =>
      latest === undefined
        ? group.latestSequence
        : Math.max(latest, group.latestSequence),
    undefined,
  );
}

function isInventoryReviewGroup(
  group: TerminalSyncReviewSummaryGroup,
  hasRepositoryReviewSummary: boolean,
) {
  if (group.conflictType !== "inventory") {
    return false;
  }
  if (!hasRepositoryReviewSummary) {
    return true;
  }
  return true;
}

export function classifySupportRecovery(
  input: TerminalSupportRecoveryInput,
): TerminalSupportRecovery {
  if (input.manualReview.length > 0) {
    return {
      reasonCount: input.manualReview.length,
      status: "needs_manual_review",
    };
  }

  if (input.terminalActions.length > 0) {
    return {
      reasonCount: input.terminalActions.length,
      status: "needs_terminal_action",
    };
  }

  if (input.cloudRepair.safeConflictIds.length > 0) {
    return {
      reasonCount: input.cloudRepair.safeConflictIds.length,
      status: "needs_cloud_repair",
    };
  }

  return null;
}

export function classifyTerminalHealth(input: {
  attentionReasons: TerminalHealthAttentionReason[];
  runtimeAgeMs: number | null;
  runtimeStatus: TerminalOperationalPolicyInput["runtimeStatus"];
  terminalStatus: TerminalOperationalPolicyInput["terminalStatus"];
}): TerminalOperationalState["terminalHealth"] {
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

export function classifySalesReadiness(
  input: TerminalSalesReadinessInput,
): TerminalSalesReadiness {
  if (
    input.activeRegisterSession &&
    input.saleAuthorityReady &&
    input.cloudRegisterSessionSaleUsable !== false
  ) {
    return "able_to_transact_now";
  }

  if (input.activeRegisterSession) {
    return "drawer_open";
  }

  return "healthy_idle";
}

function buildDiagnosticEvidence(input: TerminalOperationalPolicyInput) {
  const diagnostics = [];
  const activeRegisterSession =
    runtimeHasActiveRegisterSession(input.runtimeStatus) ||
    isRegisterSessionSaleUsable(input.activeRegisterSession) ||
    isRegisterSessionSaleUsable(input.latestRegisterSession);
  const saleAuthorityReady = runtimeHasSaleAuthority(input.runtimeStatus);
  const cloudRegisterSessionSaleUsable = input.latestRegisterSession
    ? isRegisterSessionSaleUsable(input.latestRegisterSession)
    : undefined;

  if (!input.runtimeFresh) {
    diagnostics.push({
      severity: "warning" as const,
      source: "local_runtime" as const,
      summary: "Terminal runtime evidence is stale or unavailable.",
    });
  }

  if (
    activeRegisterSession &&
    saleAuthorityReady &&
    cloudRegisterSessionSaleUsable === false
  ) {
    diagnostics.push({
      severity: "warning" as const,
      source: "cloud_register_lifecycle" as const,
      summary:
        "Runtime reports an active drawer, but cloud register lifecycle evidence is not sale-usable.",
    });
  }

  if (input.commandStatus && input.commandStatus.verificationStatus !== "verified") {
    diagnostics.push({
      severity: "info" as const,
      source: "recovery_command" as const,
      summary: "Recovery command acknowledgement is awaiting runtime verification.",
    });
  }

  if ((input.syncEvidence.unresolvedConflictCount ?? 0) > 0) {
    diagnostics.push({
      severity: "warning" as const,
      source: "sync_evidence" as const,
      summary: "Terminal sync evidence includes unresolved review items.",
    });
  }

  return diagnostics;
}

function buildTerminalRecoveryActions(
  status: TerminalOperationalPolicyInput["runtimeStatus"],
  commandStatus: TerminalOperationalPolicyInput["commandStatus"],
): TerminalOperationalState["recoveryEvidence"]["terminalActions"] {
  if (!status) {
    return [];
  }

  const actions: TerminalOperationalState["recoveryEvidence"]["terminalActions"] = [];
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
  const replayableReviewEvents =
    getReplayableRuntimeLocalReviewEvents(status.sync) ??
    getReplayableCollectedLocalReviewEvents(status.sync, commandStatus);
  if (replayableReviewEvents) {
    actions.push({
      commandType: "retry_sync",
      expectedEvidence: {
        syncStatus: "idle",
      },
      commandContext: {
        expectedBlockerType: "local_review_replay",
        reason:
          "Uploaded local review items should be replayed against current cloud rules.",
      },
      reason:
        "Uploaded local review items should be replayed against current cloud rules.",
    });
  } else if (
    status.sync.status === "needs_review" ||
    status.sync.reviewEventCount > 0
  ) {
    actions.push({
      commandType: "collect_local_review",
      expectedEvidence: {
        localReviewDetailsCollected: true,
      },
      commandContext: {
        expectedBlockerType: "local_review",
        reason: "Local review items need terminal-local evidence collection.",
      },
      reason: "Local review items need terminal-local evidence collection.",
    });
  }
  return dedupeTerminalActions(actions);
}

function getReplayableRuntimeLocalReviewEvents(
  sync: NonNullable<
    TerminalOperationalPolicyInput["runtimeStatus"]
  >["sync"],
) {
  if (sync.reviewEventCount <= 0) {
    return null;
  }
  const reviewEvents = sync.reviewEvents ?? [];
  return reviewEvents.length > 0 &&
    reviewEvents.length <= sync.reviewEventCount &&
    reviewEvents.every(isReplayableLocalReviewEvent)
    ? reviewEvents.slice(0, LOCAL_REVIEW_COMMAND_EVENT_LIMIT)
    : null;
}

function getReplayableCollectedLocalReviewEvents(
  sync: NonNullable<
    TerminalOperationalPolicyInput["runtimeStatus"]
  >["sync"],
  commandStatus: TerminalOperationalPolicyInput["commandStatus"],
) {
  if (
    commandStatus?.commandType !== "collect_local_review" ||
    commandStatus.verificationStatus !== "verified"
  ) {
    return null;
  }

  const reviewEvents = commandStatus.localReviewEvents ?? [];
  const runtimeReviewEvents = sync.reviewEvents ?? [];
  if (sync.reviewEventCount <= 0 || runtimeReviewEvents.length === 0) {
    return null;
  }
  if (
    runtimeReviewEvents.length > 0 &&
    !sameLocalReviewEventIds(reviewEvents, runtimeReviewEvents)
  ) {
    return null;
  }

  return reviewEvents.length > 0 &&
    reviewEvents.length <= sync.reviewEventCount &&
    reviewEvents.every(isReplayableLocalReviewEvent)
    ? reviewEvents.slice(0, LOCAL_REVIEW_COMMAND_EVENT_LIMIT)
    : null;
}

function isReplayableLocalReviewEvent(event: {
  type: string;
  uploaded?: boolean;
}) {
  return event.uploaded === true && event.type === "register.opened";
}

function sameLocalReviewEventIds(
  left: Array<{ localEventId: string }>,
  right: Array<{ localEventId: string }>,
) {
  if (left.length !== right.length) {
    return false;
  }
  const rightIds = new Set(right.map((event) => event.localEventId));
  return left.every((event) => rightIds.has(event.localEventId));
}

function buildTerminalRecoveryManualReview(args: {
  attentionReasons: TerminalHealthAttentionReason[];
  safeConflictIds: TerminalOperationalPolicyInput["cloudRepair"]["safeConflictIds"];
  skippedConflictIds: TerminalOperationalPolicyInput["cloudRepair"]["skippedConflictIds"];
}): TerminalOperationalState["recoveryEvidence"]["manualReview"] {
  const hasSafeCloudRepair = args.safeConflictIds.length > 0;
  const manual: TerminalOperationalState["recoveryEvidence"]["manualReview"] =
    args.attentionReasons
      .filter((reason) =>
        reason.type === "cloud_held" ||
        reason.type === "cloud_rejected" ||
        (reason.type === "synced_sale_inventory_review" &&
          !reason.actionTarget &&
          !hasSafeCloudRepair) ||
        (reason.type === "cloud_conflict" &&
          !reason.actionTarget &&
          !hasSafeCloudRepair),
      )
      .map((reason) => ({
        reason: reason.summary,
        source: reason.source,
        type: reason.type,
      }));

  if (
    args.skippedConflictIds.length > 0 &&
    !manual.some((item) => item.source === "cloud_sync")
  ) {
    const count = args.skippedConflictIds.length;
    manual.push({
      reason: `${count} cloud sync conflict${count === 1 ? " requires" : "s require"} manager review before support can repair this terminal.`,
      source: "cloud_repair",
      type: "unsafe_cloud_conflict",
    });
  }
  return manual;
}

function buildTerminalOperationalExplanation(args: {
  attentionReasons: TerminalHealthAttentionReason[];
  cloudRepair: TerminalOperationalPolicyInput["cloudRepair"];
  diagnosticEvidence: TerminalOperationalState["diagnosticEvidence"];
  recoveryEvidence: Pick<
    TerminalOperationalState["recoveryEvidence"],
    "cloudRepair" | "manualReview" | "terminalActions"
  >;
  runtimeFresh: boolean;
  runtimeStatus: TerminalOperationalPolicyInput["runtimeStatus"];
  salesReadiness: TerminalSalesReadiness;
  supportRecovery: TerminalSupportRecovery;
  syncEvidence: TerminalOperationalPolicyInput["syncEvidence"];
  terminalHealth: TerminalOperationalState["terminalHealth"];
}): TerminalOperationalExplanation {
  const reviewBacklogReasons = args.attentionReasons.filter(isReviewBacklogReason);
  const reviewBacklogCount = reviewBacklogReasons.reduce(
    (total, reason) => total + (reason.count ?? 1),
    0,
  );
  const targetResolutionIncomplete =
    args.syncEvidence.reviewSummary?.meta.targetResolutionIncomplete ?? false;
  const evidenceReferences = [
    ...args.attentionReasons.map((reason) =>
      buildExplanationEvidenceReference({
        count: reason.count,
        source: reason.source,
        summary: reason.summary,
        type: reason.type,
      }),
    ),
    ...args.diagnosticEvidence.map((diagnostic) => ({
      source: diagnostic.source,
      summary: diagnostic.summary,
      type: "diagnostic" as const,
    })),
  ];
  const safeRepairSecondaryAction =
    args.cloudRepair.safeConflictIds.length > 0 &&
    args.supportRecovery?.status !== "needs_cloud_repair"
      ? {
          label: "Safe cloud repair available",
          primaryOwner: "support" as const,
          supportAction: "safe_cloud_repair" as const,
        }
      : null;
  const secondaryActions = safeRepairSecondaryAction
    ? [safeRepairSecondaryAction]
    : [];

  if (
    reviewBacklogReasons.length > 0 &&
    !args.supportRecovery
  ) {
    const saleReady = args.salesReadiness === "able_to_transact_now";
    return {
      blockingDomain: "sync_review",
      detail:
        targetResolutionIncomplete
          ? "Review-owned sync work needs attention, but the exact owner was capped while this terminal remains sale-ready."
          : saleReady
            ? "Review-owned sync work needs attention, but this terminal has fresh sale authority."
            : "Review-owned sync work needs attention before terminal health is clear.",
      evidenceReferences,
      headline: saleReady
        ? "Review needed. Sales can continue."
        : "Review needed",
      lane: saleReady ? "sale_ready_with_review_backlog" : "needs_manual_review",
      nextStep: targetResolutionIncomplete
        ? "Use Operations or Cash Controls review workspaces to locate the backlog."
        : "Use the linked review workspace to clear the backlog.",
      primaryOwner: resolveReviewBacklogOwner(
        reviewBacklogReasons,
        targetResolutionIncomplete,
      ),
      saleImpact: saleImpactForReadiness(args.salesReadiness),
      secondaryActions,
      severity: saleReady ? "warning" : "critical",
      summaryMeta: {
        hasSecondarySafeRepair: !!safeRepairSecondaryAction,
        reviewBacklogCount,
        targetResolutionIncomplete,
      },
      supportAction: "manual_review",
    };
  }

  if (args.supportRecovery?.status === "needs_manual_review") {
    return {
      blockingDomain: "manual_review",
      detail:
        "Manual review must finish before support repairs this terminal.",
      evidenceReferences,
      headline: "Manager review needed",
      lane: "needs_manual_review",
      nextStep: "Use the linked review workspace before running support repair.",
      primaryOwner: "manager",
      saleImpact: saleImpactForReadiness(args.salesReadiness),
      secondaryActions,
      severity: "critical",
      summaryMeta: {
        hasSecondarySafeRepair: !!safeRepairSecondaryAction,
        reviewBacklogCount,
        targetResolutionIncomplete,
      },
      supportAction: "manual_review",
    };
  }

  if (args.supportRecovery?.status === "needs_terminal_action") {
    const retryOnly = args.recoveryEvidence.terminalActions.every(
      (action) => action.commandType === "retry_sync",
    );
    const localReviewCollectionOnly =
      args.recoveryEvidence.terminalActions.length > 0 &&
      args.recoveryEvidence.terminalActions.every(
        (action) => action.commandType === "collect_local_review",
      );
    return {
      blockingDomain: "terminal_runtime",
      detail: localReviewCollectionOnly
        ? "The terminal needs to publish local review item evidence before support can continue."
        : retryOnly
        ? "The terminal needs to retry local sync before evidence is current."
        : "The terminal needs a local repair command before support can continue.",
      evidenceReferences,
      headline: localReviewCollectionOnly
        ? "Local review collection needed"
        : retryOnly
          ? "Terminal sync retry needed"
          : "Terminal action needed",
      lane: "needs_terminal_action",
      nextStep: localReviewCollectionOnly
        ? "Collect local review items and wait for a fresh check-in."
        : retryOnly
        ? "Send a terminal sync retry and wait for a fresh check-in."
        : "Send the available terminal repair command.",
      primaryOwner: "terminal",
      saleImpact: saleImpactForReadiness(args.salesReadiness),
      secondaryActions,
      severity: "warning",
      summaryMeta: {
        hasSecondarySafeRepair: !!safeRepairSecondaryAction,
        reviewBacklogCount,
        targetResolutionIncomplete,
      },
      supportAction: retryOnly ? "terminal_sync_retry" : "terminal_command",
    };
  }

  if (args.supportRecovery?.status === "needs_cloud_repair") {
    return {
      blockingDomain: "cloud_repair",
      detail: "Support can run the safe cloud repair for the listed sync evidence.",
      evidenceReferences: [
        ...evidenceReferences,
        {
          count: args.cloudRepair.safeConflictIds.length,
          source: "cloud_repair",
          summary: "Safe cloud repair conflicts are available.",
          type: "safe_cloud_conflict",
        },
      ],
      headline: "Cloud repair available",
      lane: "needs_cloud_repair",
      nextStep: "Run the safe cloud repair action.",
      primaryOwner: "support",
      saleImpact: saleImpactForReadiness(args.salesReadiness),
      secondaryActions,
      severity: "warning",
      summaryMeta: {
        hasSecondarySafeRepair: false,
        reviewBacklogCount,
        targetResolutionIncomplete,
      },
      supportAction: "safe_cloud_repair",
    };
  }

  if (
    !args.runtimeFresh ||
    !args.runtimeStatus ||
    args.terminalHealth === "stale" ||
    args.terminalHealth === "offline"
  ) {
    return {
      blockingDomain: "terminal_runtime",
      detail: "Terminal runtime evidence is stale or unavailable.",
      evidenceReferences,
      headline: "Waiting for check-in",
      lane: args.runtimeStatus ? "stale_runtime" : "unknown",
      nextStep: "Wait for a fresh terminal check-in or send terminal sync retry.",
      primaryOwner: "terminal",
      saleImpact: args.salesReadiness === "able_to_transact_now"
        ? "can_transact_now"
        : "unknown",
      secondaryActions,
      severity: "warning",
      summaryMeta: {
        hasSecondarySafeRepair: !!safeRepairSecondaryAction,
        reviewBacklogCount,
        targetResolutionIncomplete,
      },
      supportAction: "wait_for_check_in",
    };
  }

  if (args.salesReadiness === "able_to_transact_now") {
    return {
      blockingDomain: "none",
      detail: "Fresh runtime evidence reports an active drawer with sale authority.",
      evidenceReferences,
      headline: "Ready for sales",
      lane: "able_to_transact_now",
      nextStep: "No support action needed.",
      primaryOwner: "none",
      saleImpact: "can_transact_now",
      secondaryActions,
      severity: "info",
      summaryMeta: {
        hasSecondarySafeRepair: !!safeRepairSecondaryAction,
        reviewBacklogCount,
        targetResolutionIncomplete,
      },
      supportAction: "none",
    };
  }

  if (args.salesReadiness === "drawer_open") {
    return {
      blockingDomain: "none",
      detail: "A drawer is open for this terminal.",
      evidenceReferences,
      headline: "Drawer open",
      lane: "drawer_open",
      nextStep: "No support action needed.",
      primaryOwner: "none",
      saleImpact: "unknown",
      secondaryActions,
      severity: "info",
      summaryMeta: {
        hasSecondarySafeRepair: !!safeRepairSecondaryAction,
        reviewBacklogCount,
        targetResolutionIncomplete,
      },
      supportAction: "none",
    };
  }

  return {
    blockingDomain: "none",
    detail: "No terminal health blockers are reported.",
    evidenceReferences,
    headline: "Healthy idle",
    lane: "healthy_idle",
    nextStep: "No support action needed.",
    primaryOwner: "none",
    saleImpact: "unknown",
    secondaryActions,
    severity: "info",
    summaryMeta: {
      hasSecondarySafeRepair: !!safeRepairSecondaryAction,
      reviewBacklogCount,
      targetResolutionIncomplete,
    },
    supportAction: "none",
  };
}

function isReviewBacklogReason(reason: TerminalHealthAttentionReason) {
  return (
    reason.type === "synced_sale_inventory_review" ||
    reason.type === "cloud_conflict" ||
    reason.type === "cloud_held" ||
    reason.type === "cloud_rejected"
  );
}

function buildExplanationEvidenceReference(args: {
  count?: number;
  source: TerminalOperationalExplanation["evidenceReferences"][number]["source"];
  summary: string;
  type: TerminalOperationalExplanation["evidenceReferences"][number]["type"];
}): TerminalOperationalExplanation["evidenceReferences"][number] {
  const reference: TerminalOperationalExplanation["evidenceReferences"][number] = {
    source: args.source,
    summary: args.summary,
    type: args.type,
  };
  if (args.count !== undefined) {
    reference.count = args.count;
  }
  return reference;
}

function resolveReviewBacklogOwner(
  reasons: TerminalHealthAttentionReason[],
  targetResolutionIncomplete = false,
): TerminalOperationalExplanation["primaryOwner"] {
  if (targetResolutionIncomplete) {
    return "operations";
  }
  if (reasons.some((reason) => reason.actionTarget?.type === "open_work")) {
    return "operations";
  }
  if (
    reasons.some(
      (reason) => reason.actionTarget?.type === "cash_control_register_session",
    )
  ) {
    return "cash_controls";
  }
  return "manager";
}

function saleImpactForReadiness(
  readiness: TerminalSalesReadiness,
): TerminalOperationalExplanation["saleImpact"] {
  return readiness === "able_to_transact_now"
    ? "can_transact_now"
    : "not_ready";
}

function hasHealthyIdleEvidence(args: {
  cloudRepair: TerminalOperationalPolicyInput["cloudRepair"];
  manualReview: TerminalOperationalState["recoveryEvidence"]["manualReview"];
  runtimeFresh: boolean;
  runtimeStatus: TerminalOperationalPolicyInput["runtimeStatus"];
  syncEvidence: TerminalOperationalPolicyInput["syncEvidence"];
  terminalActions: TerminalOperationalState["recoveryEvidence"]["terminalActions"];
  terminalStatus: TerminalOperationalPolicyInput["terminalStatus"];
}) {
  const status = args.runtimeStatus;
  return (
    args.terminalStatus === "active" &&
    args.runtimeFresh &&
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
    (args.syncEvidence.unresolvedConflictCount ?? 0) === 0 &&
    !hasCurrentSyncReviewBacklog(args.syncEvidence) &&
    args.terminalActions.length === 0 &&
    args.manualReview.length === 0 &&
    args.cloudRepair.safeConflictIds.length === 0
  );
}

function hasCurrentSyncReviewBacklog(
  syncEvidence: TerminalOperationalPolicyInput["syncEvidence"],
) {
  if (getCurrentReviewGroups(syncEvidence).length > 0) {
    return true;
  }
  if (syncEvidence.reviewSummary) {
    return syncEvidence.reviewSummary.meta.targetResolutionIncomplete;
  }
  return (
    syncEvidence.conflictedCount > 0 ||
    syncEvidence.heldCount > 0 ||
    syncEvidence.rejectedCount > 0
  );
}

function runtimeHasSaleAuthority(
  status: TerminalOperationalPolicyInput["runtimeStatus"],
) {
  return (
    !!status &&
    status.staffAuthority.status === "ready" &&
    status.saleAuthority?.status === "ready"
  );
}

function runtimeHasActiveRegisterSession(
  status: TerminalOperationalPolicyInput["runtimeStatus"],
) {
  return (
    status?.activeRegisterSession?.status === "open" ||
    status?.activeRegisterSession?.status === "active"
  );
}

function dedupeTerminalActions(
  actions: TerminalOperationalState["recoveryEvidence"]["terminalActions"],
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
