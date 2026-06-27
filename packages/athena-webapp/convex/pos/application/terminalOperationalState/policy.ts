import {
  isRegisterSessionReplacementBlocking,
  isRegisterSessionSaleUsable,
} from "../../../../shared/registerSessionLifecyclePolicy";
import type {
  TerminalHealthAttentionReason,
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
  const attentionReasons = deriveTerminalHealthAttentionReasons({
    ...input,
    runtimeStatus: effectiveRuntimeStatus,
  });
  const terminalActions = buildTerminalRecoveryActions({
    runtimeStatus: effectiveRuntimeStatus,
  });
  const manualReview = buildTerminalRecoveryManualReview({
    attentionReasons,
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

  return {
    appUpdateEvidence: input.appUpdate,
    attentionReasons,
    diagnosticEvidence,
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

  const inventoryReviewCount =
    input.syncEvidence.unresolvedConflicts?.filter(
      (conflict) =>
        conflict.conflictType === "inventory" &&
        conflict.reviewTarget?.workItemType ===
          "synced_sale_inventory_review",
    ).length ?? 0;

  if (inventoryReviewCount > 0) {
    reasons.push({
      count: inventoryReviewCount,
      latestEventSequence: latestEvent?.sequence,
      latestEventStatus: latestEvent?.status,
      source: "cloud_sync",
      summary: `${inventoryReviewCount} inventory review item${inventoryReviewCount === 1 ? " needs" : "s need"} attention.`,
      type: "synced_sale_inventory_review",
    });
  }

  const conflictedCount = Math.max(
    0,
    input.syncEvidence.conflictedCount - inventoryReviewCount,
  );

  if (conflictedCount > 0) {
    reasons.push({
      count: conflictedCount,
      latestEventSequence: latestEvent?.sequence,
      latestEventStatus: latestEvent?.status,
      source: "cloud_sync",
      summary: `${conflictedCount} cloud sync conflict${conflictedCount === 1 ? " needs" : "s need"} review.`,
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
    input.healthyIdle &&
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
  input: Pick<TerminalOperationalPolicyInput, "runtimeStatus">,
): TerminalOperationalState["recoveryEvidence"]["terminalActions"] {
  const status = input.runtimeStatus;
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
  skippedConflictIds: TerminalOperationalPolicyInput["cloudRepair"]["skippedConflictIds"];
}): TerminalOperationalState["recoveryEvidence"]["manualReview"] {
  const manual: TerminalOperationalState["recoveryEvidence"]["manualReview"] =
    args.attentionReasons
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
      source: "cloud_repair",
      type: "unsafe_cloud_conflict",
    });
  }
  return manual;
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
    args.syncEvidence.conflictedCount === 0 &&
    args.syncEvidence.heldCount === 0 &&
    args.syncEvidence.rejectedCount === 0 &&
    args.terminalActions.length === 0 &&
    args.manualReview.length === 0 &&
    args.cloudRepair.safeConflictIds.length === 0
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
