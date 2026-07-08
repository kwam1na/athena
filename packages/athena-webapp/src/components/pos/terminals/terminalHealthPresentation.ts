import type {
  TerminalRecord,
  TerminalSyncEvent,
  TerminalSyncEvidence,
  TerminalRuntimeStatus,
  TerminalHealthAttentionReason,
  TerminalRecoveryAction,
  TerminalRecoveryBlocker,
  TerminalRecoveryCommandType,
  TerminalRecoveryPreview,
  TerminalRecoveryActionStatus,
  TerminalRecoveryReadinessStatus,
  TerminalAppUpdatePreview,
  TerminalAppUpdateStatus,
  TerminalOperationalExplanation,
  TerminalOperationalExplanationEvidenceReference,
  TerminalOperationalExplanationLane,
  TerminalOperationalExplanationPrimaryOwner,
  TerminalOperationalExplanationSaleImpact,
  TerminalOperationalExplanationSeverity,
  TerminalOperationalExplanationSupportAction,
} from "./terminalHealthTypes";

export type TerminalHealthClassification = {
  description: string;
  label: string;
  toneClassName: string;
};

export type TerminalRecoveryPresentationBlocker = {
  action?: TerminalRecoveryAction;
  actionTarget?: TerminalHealthAttentionReason["actionTarget"];
  detail?: string;
  id: string;
  status?: string;
  summary: string;
  title: string;
};

export type TerminalRecoveryReadinessPresentation = {
  description: string;
  label: string;
  status: TerminalRecoveryReadinessStatus;
  toneClassName: string;
};

export type TerminalRecoveryPresentation = {
  appUpdate: TerminalAppUpdatePresentation;
  commandStatus: {
    commandType?: TerminalRecoveryCommandType;
    label: string;
    latestAcknowledgement?: string;
    status: string;
    verificationStatus: string;
  };
  groups: {
    cloudRepair: TerminalRecoveryPresentationBlocker[];
    manualReview: TerminalRecoveryPresentationBlocker[];
    terminalRequired: TerminalRecoveryPresentationBlocker[];
  };
  readiness: TerminalRecoveryReadinessPresentation;
  safeActions: TerminalRecoveryAction[];
  verification: {
    status: string;
    summary: string;
  };
};

export type TerminalAppUpdatePresentation = {
  action?: TerminalRecoveryAction;
  description: string;
  label: string;
  status: TerminalAppUpdateStatus;
  toneClassName: string;
};

export type TerminalOperationalExplanationPresentation = {
  detail: string;
  evidenceReferences: Array<
    TerminalOperationalExplanationEvidenceReference & {
      label: string;
    }
  >;
  headline: string;
  label: string;
  lane: TerminalOperationalExplanationLane;
  nextStep: string;
  ownerLabel: string;
  primaryOwner: TerminalOperationalExplanationPrimaryOwner;
  saleImpact: TerminalOperationalExplanationSaleImpact;
  saleImpactLabel: string;
  secondaryActions: TerminalOperationalExplanation["secondaryActions"];
  severity: TerminalOperationalExplanationSeverity;
  summaryMeta: TerminalOperationalExplanation["summaryMeta"];
  supportAction: TerminalOperationalExplanationSupportAction;
  supportActionLabel: string;
  toneClassName: string;
};

type TerminalHealthClassificationInput = {
  attentionReasons?: TerminalHealthAttentionReason[];
  health?:
  | "needs_attention"
  | "offline"
  | "online"
  | "stale"
  | "unknown"
  | string;
  operationalExplanation?: TerminalOperationalExplanation | null;
  recovery?: TerminalRecoveryPreview | null;
  recoveryPreview?: TerminalRecoveryPreview | null;
  runtimeStatus:
  | (Omit<Partial<TerminalRuntimeStatus>, "localStore" | "sync"> & {
    localStore?: Partial<TerminalRuntimeStatus["localStore"]>;
    sync?: Partial<TerminalRuntimeStatus["sync"]>;
  })
  | null;
  syncEvidence: Partial<TerminalSyncEvidence>;
  terminal: Pick<TerminalRecord, "status"> & Partial<TerminalRecord>;
};

const STALE_CHECK_IN_MS = 30 * 60_000;
const MANUAL_REVIEW_EVENT_PATTERN =
  /\b(sale|payment|inventory|closeout|variance|transaction|cart|item)_?|\bpayment\b|\binventory\b|\bcloseout\b|\bvariance\b/i;

export function formatTerminalTimestamp(timestamp?: number | null) {
  if (!timestamp) {
    return "Not recorded";
  }

  const delta = timestamp - Date.now();
  const absoluteDelta = Math.abs(delta);
  const units = [
    { divisor: 24 * 60 * 60_000, unit: "day" },
    { divisor: 60 * 60_000, unit: "hour" },
    { divisor: 60_000, unit: "minute" },
    { divisor: 1_000, unit: "second" },
  ] as const;
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const selected =
    units.find((unit) => absoluteDelta >= unit.divisor) ?? units[3];

  return formatter.format(Math.round(delta / selected.divisor), selected.unit);
}

export function formatAge(ageMs?: number | null) {
  if (typeof ageMs !== "number" || !Number.isFinite(ageMs)) {
    return "Not reported";
  }

  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} old`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} old`;
}

export function formatRegisterNumber(registerNumber?: string | null) {
  const trimmed = registerNumber?.trim();
  if (!trimmed) {
    return "No register number";
  }

  return /^register\b/i.test(trimmed) ? trimmed : `Register ${trimmed}`;
}

export function formatStatusLabel(status?: string | null) {
  if (!status) {
    return "Unknown";
  }

  return status
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getSnapshotAgeSummary(
  snapshots?: TerminalRuntimeStatus["snapshots"] | null,
) {
  if (!snapshots) {
    return "Snapshots not reported";
  }

  const parts = [
    snapshots.availabilityAgeMs !== undefined
      ? `Availability ${formatAge(snapshots.availabilityAgeMs)}`
      : null,
    snapshots.catalogAgeMs !== undefined
      ? `Catalog ${formatAge(snapshots.catalogAgeMs)}`
      : null,
    snapshots.serviceCatalogAgeMs !== undefined
      ? `Service catalog ${formatAge(snapshots.serviceCatalogAgeMs)}`
      : null,
    snapshots.registerReadModelAgeMs !== undefined
      ? `Register read model ${formatAge(snapshots.registerReadModelAgeMs)}`
      : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : "Snapshots not reported";
}

export function getStaffAuthorityLabel(
  status?: TerminalRuntimeStatus["staffAuthority"] | null,
) {
  switch (status?.status) {
    case "ready":
      return "Staff authority ready";
    case "expired":
      return "Staff authority expired";
    case "missing":
      return "Staff authority missing";
    default:
      return "Staff authority unknown";
  }
}

export function getReviewEvidenceCount(
  syncEvidence?: Partial<TerminalSyncEvidence> | null,
) {
  if (!syncEvidence) {
    return 0;
  }

  const cloudReviewCount =
    (syncEvidence.conflictedCount ?? 0) +
    (syncEvidence.heldCount ?? 0) +
    (syncEvidence.rejectedCount ?? 0);

  return Math.max(syncEvidence.unresolvedConflictCount ?? 0, cloudReviewCount);
}

export function getRecentSyncEvents(
  syncEvidence?: Partial<TerminalSyncEvidence> | null,
): TerminalSyncEvent[] {
  if (!syncEvidence) {
    return [];
  }

  return syncEvidence.latestEvent ? [syncEvidence.latestEvent] : [];
}

export function getTerminalAttentionReasons(
  summary: TerminalHealthClassificationInput,
): TerminalHealthAttentionReason[] {
  return summary.attentionReasons ?? [];
}

export function getPrimaryTerminalAttentionReason(
  summary: TerminalHealthClassificationInput,
) {
  return getTerminalAttentionReasons(summary)[0] ?? null;
}

export function buildTerminalOperationalExplanationPresentation(
  summary: TerminalHealthClassificationInput,
): TerminalOperationalExplanationPresentation {
  const serverExplanation = summary.operationalExplanation;
  if (serverExplanation) {
    return normalizeServerOperationalExplanation(serverExplanation);
  }

  return buildLegacyOperationalExplanation(summary);
}

function normalizeServerOperationalExplanation(
  explanation: TerminalOperationalExplanation,
): TerminalOperationalExplanationPresentation {
  const lane = normalizeOperationalLane(explanation.lane);
  const severity = normalizeOperationalSeverity(explanation.severity);
  const fallback = getOperationalLaneFallback(lane, severity);
  const saleImpact = normalizeSaleImpact(explanation.saleImpact);
  const supportAction = normalizeSupportAction(explanation.supportAction);
  const primaryOwner = normalizePrimaryOwner(explanation.primaryOwner);

  const headline =
    lane === "sale_ready_with_review_backlog"
      ? "Review needed"
      : sanitizeOperationalCopy(explanation.headline, fallback.headline);
  const detail =
    lane === "sale_ready_with_review_backlog"
      ? "Sales can continue."
      : sanitizeOperationalCopy(explanation.detail, fallback.detail);

  return {
    detail,
    evidenceReferences: normalizeOperationalEvidenceReferences(
      explanation.evidenceReferences,
    ),
    headline,
    label: fallback.label,
    lane,
    nextStep: sanitizeOperationalCopy(explanation.nextStep, fallback.nextStep),
    ownerLabel: getPrimaryOwnerLabel(primaryOwner),
    primaryOwner,
    saleImpact,
    saleImpactLabel: getSaleImpactLabel(saleImpact),
    secondaryActions: normalizeOperationalSecondaryActions(
      explanation.secondaryActions,
    ),
    severity,
    summaryMeta: normalizeOperationalSummaryMeta(explanation.summaryMeta),
    supportAction,
    supportActionLabel: getSupportActionLabel(supportAction),
    toneClassName: getOperationalSeverityToneClassName(severity),
  };
}

function buildLegacyOperationalExplanation(
  summary: TerminalHealthClassificationInput,
): TerminalOperationalExplanationPresentation {
  const recovery = buildTerminalRecoveryPresentation(summary);
  const runtimeStatus = summary.runtimeStatus;
  const runtimeSync = runtimeStatus?.sync;
  const reviewCount =
    (runtimeSync?.reviewEventCount ?? 0) +
    getReviewEvidenceCount(summary.syncEvidence);
  const isSaleReady =
    recovery.readiness.status === "able_to_transact_now" ||
    (runtimeStatus?.staffAuthority?.status === "ready" &&
      runtimeStatus.localStore?.available !== false &&
      Boolean(runtimeStatus.activeRegisterSession));

  if (reviewCount > 0 && isSaleReady) {
    return {
      detail: "Sales can continue.",
      evidenceReferences: [
        {
          count: reviewCount,
          label: "Review backlog",
          source: "sync_evidence",
          summary: "Review backlog",
          type: "review_backlog",
        },
      ],
      headline: "Review needed",
      label: "Review needed",
      lane: "sale_ready_with_review_backlog",
      nextStep:
        "Review the open work or cash-control backlog. Do not block new sales from this terminal.",
      ownerLabel: "Operations",
      primaryOwner: "operations",
      saleImpact: "can_transact_now",
      saleImpactLabel: "Sales can continue",
      secondaryActions: [],
      severity: "warning",
      summaryMeta: {
        hasSecondarySafeRepair: false,
        reviewBacklogCount: reviewCount,
        targetResolutionIncomplete: false,
      },
      supportAction: "review_open_work",
      supportActionLabel: "Review open work",
      toneClassName: getOperationalSeverityToneClassName("warning"),
    };
  }

  if (recovery.groups.manualReview.length > 0) {
    return buildStaticOperationalExplanation({
      detail:
        recovery.groups.manualReview[0]?.summary ??
        "Manager or operations review is required before support repairs this terminal.",
      lane: "needs_manual_review",
      nextStep:
        "Review cash-control or operations work before support repairs this terminal.",
      primaryOwner: "cash_controls",
      saleImpact: "unknown",
      severity: "danger",
      supportAction: "review_cash_controls",
    });
  }

  if (recovery.groups.terminalRequired.length > 0) {
    return buildStaticOperationalExplanation({
      detail:
        recovery.groups.terminalRequired[0]?.summary ??
        "The checkout station needs terminal-side recovery before Athena can verify it.",
      lane: "needs_terminal_action",
      nextStep: "Send the safe terminal command or wait for a fresh check-in.",
      primaryOwner: "terminal",
      saleImpact: "unknown",
      severity: "warning",
      supportAction: "run_terminal_command",
    });
  }

  if (recovery.groups.cloudRepair.length > 0) {
    return buildStaticOperationalExplanation({
      detail:
        recovery.groups.cloudRepair[0]?.summary ??
        "A safe cloud repair is available for stale terminal evidence.",
      lane: "needs_cloud_repair",
      nextStep: "Resolve the safe cloud repair item.",
      primaryOwner: "support",
      saleImpact: "unknown",
      severity: "warning",
      supportAction: "resolve_safe_cloud_repair",
    });
  }

  if (
    runtimeSync?.status === "failed" ||
    (runtimeSync?.failedEventCount ?? 0) > 0
  ) {
    return buildStaticOperationalExplanation({
      detail: "The latest terminal sync attempt failed.",
      lane: "sync_failed",
      nextStep: "Retry terminal sync or wait for the next check-in.",
      primaryOwner: "terminal",
      saleImpact: "unknown",
      severity: "danger",
      supportAction: "retry_terminal_sync",
    });
  }

  const classification = classifyTerminalHealth(summary);
  if (
    classification.label === "No check-in" ||
    classification.label === "Stale"
  ) {
    return buildStaticOperationalExplanation({
      detail: "Athena is waiting for a current terminal check-in.",
      lane: "stale_runtime",
      nextStep: "Refresh terminal health or wait for the next check-in.",
      primaryOwner: "terminal",
      saleImpact: "unknown",
      severity: "warning",
      supportAction: "wait_for_check_in",
    });
  }

  return buildStaticOperationalExplanation({
    detail: "Current terminal evidence has no repair or review blockers.",
    lane: "healthy",
    nextStep: "No action is needed for terminal health.",
    primaryOwner: "none",
    saleImpact:
      recovery.readiness.status === "able_to_transact_now"
        ? "can_transact_now"
        : "open_drawer_or_sign_in",
    severity: "info",
    supportAction: "none",
  });
}

function buildStaticOperationalExplanation({
  detail,
  lane,
  nextStep,
  primaryOwner,
  saleImpact,
  severity,
  supportAction,
}: {
  detail: string;
  lane: TerminalOperationalExplanationLane;
  nextStep: string;
  primaryOwner: TerminalOperationalExplanationPrimaryOwner;
  saleImpact: TerminalOperationalExplanationSaleImpact;
  severity: TerminalOperationalExplanationSeverity;
  supportAction: TerminalOperationalExplanationSupportAction;
}): TerminalOperationalExplanationPresentation {
  const fallback = getOperationalLaneFallback(lane, severity);
  const normalizedDetail = sanitizeOperationalCopy(detail, fallback.detail);

  return {
    detail: normalizedDetail,
    evidenceReferences: [],
    headline: fallback.headline,
    label: fallback.label,
    lane,
    nextStep,
    ownerLabel: getPrimaryOwnerLabel(primaryOwner),
    primaryOwner,
    saleImpact,
    saleImpactLabel: getSaleImpactLabel(saleImpact),
    secondaryActions: [],
    severity,
    summaryMeta: {
      hasSecondarySafeRepair: false,
      reviewBacklogCount: 0,
      targetResolutionIncomplete: false,
    },
    supportAction,
    supportActionLabel: getSupportActionLabel(supportAction),
    toneClassName: getOperationalSeverityToneClassName(severity),
  };
}

function normalizeOperationalEvidenceReferences(
  evidenceReferences: TerminalOperationalExplanationEvidenceReference[],
) {
  return evidenceReferences.map((reference) => ({
    ...(typeof reference.count === "number" ? { count: reference.count } : {}),
    label: sanitizeOperationalCopy(reference.summary, "Review evidence"),
    source: reference.source,
    summary: sanitizeOperationalCopy(reference.summary, "Review evidence"),
    type: reference.type,
  }));
}

function normalizeOperationalSecondaryActions(
  secondaryActions: TerminalOperationalExplanation["secondaryActions"],
) {
  return secondaryActions.map((action) => ({
    ...action,
    label: sanitizeOperationalCopy(
      action.label,
      getSupportActionLabel(action.supportAction),
    ),
    supportAction: action.supportAction,
  }));
}

function normalizeOperationalSummaryMeta(
  summaryMeta: TerminalOperationalExplanation["summaryMeta"],
) {
  return {
    hasSecondarySafeRepair: Boolean(summaryMeta.hasSecondarySafeRepair),
    reviewBacklogCount: normalizeCount(summaryMeta.reviewBacklogCount),
    targetResolutionIncomplete: Boolean(summaryMeta.targetResolutionIncomplete),
  };
}

function normalizeCount(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeOperationalLane(lane: TerminalOperationalExplanationLane) {
  switch (lane) {
    case "able_to_transact_now":
    case "drawer_open":
    case "healthy_idle":
    case "healthy":
    case "sale_ready_with_review_backlog":
    case "needs_manual_review":
    case "needs_terminal_action":
    case "needs_cloud_repair":
    case "sync_failed":
    case "stale_runtime":
      return lane;
    default:
      return "unknown";
  }
}

function normalizeOperationalSeverity(
  severity: TerminalOperationalExplanationSeverity,
) {
  if (severity === "critical" || severity === "danger" || severity === "warning") {
    return severity;
  }
  return "info";
}

function normalizeSaleImpact(
  saleImpact: TerminalOperationalExplanationSaleImpact,
) {
  switch (saleImpact) {
    case "can_transact_now":
    case "can_continue_local_sales":
    case "open_drawer_or_sign_in":
    case "not_ready":
    case "blocked":
      return saleImpact;
    default:
      return "unknown";
  }
}

function normalizeSupportAction(
  supportAction: TerminalOperationalExplanationSupportAction,
) {
  switch (supportAction) {
    case "manual_review":
    case "none":
    case "safe_cloud_repair":
    case "terminal_command":
    case "terminal_sync_retry":
    case "review_cash_controls":
    case "review_open_work":
    case "resolve_safe_cloud_repair":
    case "run_terminal_command":
    case "retry_terminal_sync":
    case "wait_for_check_in":
      return supportAction;
    default:
      return "diagnostic_only";
  }
}

function normalizePrimaryOwner(
  primaryOwner: TerminalOperationalExplanationPrimaryOwner,
) {
  switch (primaryOwner) {
    case "none":
    case "cash_controls":
    case "manager":
    case "operations":
    case "terminal":
    case "support":
      return primaryOwner;
    default:
      return "system";
  }
}

function getOperationalLaneFallback(
  lane: TerminalOperationalExplanationLane,
  severity: TerminalOperationalExplanationSeverity,
) {
  switch (lane) {
    case "able_to_transact_now":
      return {
        detail: "Fresh runtime evidence reports sale authority.",
        headline: "Ready for sales",
        label: "Ready",
        nextStep: "No action is needed for terminal health.",
      };
    case "drawer_open":
      return {
        detail: "A drawer is open for this terminal.",
        headline: "Drawer open",
        label: "Drawer open",
        nextStep: "No action is needed for terminal health.",
      };
    case "healthy_idle":
    case "healthy":
      return {
        detail: "Current terminal evidence has no repair or review blockers.",
        headline: "No action needed",
        label: "Healthy",
        nextStep: "No action is needed for terminal health.",
      };
    case "sale_ready_with_review_backlog":
      return {
        detail: "Sales can continue.",
        headline: "Review needed",
        label: "Review needed",
        nextStep:
          "Review the open work or cash-control backlog. Do not block new sales from this terminal.",
      };
    case "needs_manual_review":
      return {
        detail:
          "Manager or operations review is required before support repairs this terminal.",
        headline: "Manager review needed",
        label: "Manager review needed",
        nextStep:
          "Review cash-control or operations work before support repairs this terminal.",
      };
    case "needs_terminal_action":
      return {
        detail:
          "The checkout station needs terminal-side recovery before Athena can verify it.",
        headline: "Terminal action needed",
        label: "Terminal action needed",
        nextStep:
          "Send the safe terminal command or wait for a fresh check-in.",
      };
    case "needs_cloud_repair":
      return {
        detail: "A safe cloud repair is available for stale terminal evidence.",
        headline: "Safe cloud repair available",
        label: "Cloud repair",
        nextStep: "Resolve the safe cloud repair item.",
      };
    case "sync_failed":
      return {
        detail: "The latest terminal sync attempt failed.",
        headline: "Sync failed",
        label: "Sync failed",
        nextStep: "Retry terminal sync or wait for the next check-in.",
      };
    case "stale_runtime":
      return {
        detail: "Athena is waiting for a current terminal check-in.",
        headline: "Waiting for check-in",
        label: "Waiting for check-in",
        nextStep: "Refresh terminal health or wait for the next check-in.",
      };
    default:
      return {
        detail:
          "Athena does not have enough current evidence to explain this terminal.",
        headline: "Terminal status needs review",
        label:
          severity === "critical" || severity === "danger"
            ? "Needs attention"
            : "Unknown",
        nextStep: "Refresh terminal health or wait for the next check-in.",
      };
  }
}

function getOperationalSeverityToneClassName(
  severity: TerminalOperationalExplanationSeverity,
) {
  switch (severity) {
    case "critical":
    case "danger":
      return "border-danger/25 bg-danger/10 text-danger";
    case "warning":
      return "border-warning/30 bg-warning/15 text-warning";
    default:
      return "border-success/30 bg-success/10 text-success";
  }
}

function getSaleImpactLabel(
  saleImpact: TerminalOperationalExplanationSaleImpact,
) {
  switch (saleImpact) {
    case "can_transact_now":
      return "Sales can continue";
    case "can_continue_local_sales":
      return "Local sales can continue";
    case "open_drawer_or_sign_in":
      return "Open drawer or sign in";
    case "not_ready":
      return "Sales not ready";
    case "blocked":
      return "Sales blocked";
    default:
      return "Sale impact unknown";
  }
}

function getSupportActionLabel(
  supportAction: TerminalOperationalExplanationSupportAction,
) {
  switch (supportAction) {
    case "manual_review":
      return "Manual review";
    case "none":
      return "No support action";
    case "safe_cloud_repair":
      return "Safe cloud repair";
    case "terminal_command":
      return "Terminal command";
    case "terminal_sync_retry":
      return "Retry terminal sync";
    case "review_cash_controls":
      return "Review cash controls";
    case "review_open_work":
      return "Review open work";
    case "resolve_safe_cloud_repair":
      return "Resolve safe cloud repair";
    case "run_terminal_command":
      return "Run terminal command";
    case "retry_terminal_sync":
      return "Retry terminal sync";
    case "wait_for_check_in":
      return "Wait for check-in";
    default:
      return "Diagnostic review";
  }
}

function getPrimaryOwnerLabel(
  primaryOwner: TerminalOperationalExplanationPrimaryOwner,
) {
  switch (primaryOwner) {
    case "none":
      return "No owner";
    case "cash_controls":
      return "Cash controls";
    case "manager":
      return "Manager";
    case "operations":
      return "Operations";
    case "terminal":
      return "Terminal";
    case "support":
      return "Support";
    default:
      return "System";
  }
}

export function getSupportSafeAttentionReasonSummary(
  reason: TerminalHealthAttentionReason,
) {
  if (
    reason.type === "terminal_authorization_failed" ||
    /authorization_failed|sync secret/i.test(reason.summary)
  ) {
    return terminalRequiredSummary("terminal_authorization_failed");
  }

  if (reason.type === "drawer_authority_blocked") {
    return terminalRequiredSummary("drawer_authority_blocked");
  }

  if (reason.type === "terminal_seed_missing") {
    return terminalRequiredSummary("terminal_seed_missing");
  }

  return (
    normalizeSupportCopy(reason.summary) ??
    "Terminal support evidence needs review."
  );
}

export function classifyTerminalHealth(
  summary: TerminalHealthClassificationInput,
): TerminalHealthClassification {
  if (summary.terminal.status !== "active") {
    return {
      description: "This terminal is not active for checkout.",
      label: formatStatusLabel(summary.terminal.status),
      toneClassName: "border-muted bg-muted/40 text-muted-foreground",
    };
  }

  const runtimeStatus = summary.runtimeStatus;
  const primaryReason = getPrimaryTerminalAttentionReason(summary);
  const suppressClearedSetupAttention =
    isSetupAttentionReason(primaryReason) &&
    recoveryPresentationClearsTerminalAttention(summary);
  if (
    summary.health === "needs_attention" &&
    primaryReason &&
    !suppressClearedSetupAttention
  ) {
    switch (primaryReason.type) {
      case "local_review":
      case "cloud_conflict":
      case "cloud_held":
      case "cloud_rejected":
        return {
          description: primaryReason.summary,
          label: "Needs review",
          toneClassName: "border-warning/30 bg-warning/15 text-warning",
        };
      case "sync_failed":
        return {
          description: primaryReason.summary,
          label: "Sync failed",
          toneClassName: "border-danger/30 bg-danger/10 text-danger",
        };
      case "sync_unavailable":
        return {
          description: primaryReason.summary,
          label: "Sync unavailable",
          toneClassName: "border-danger/30 bg-danger/10 text-danger",
        };
      case "local_store_unavailable":
        return {
          description: primaryReason.summary,
          label: "Local store issue",
          toneClassName: "border-danger/30 bg-danger/10 text-danger",
        };
      case "terminal_seed_missing":
      case "terminal_authorization_failed":
        return {
          description: primaryReason.summary,
          label: "Setup needed",
          toneClassName: "border-warning/30 bg-warning/15 text-warning",
        };
      case "drawer_authority_blocked":
        return {
          description: primaryReason.summary,
          label: "Drawer repair needed",
          toneClassName: "border-warning/30 bg-warning/15 text-warning",
        };
    }
  }

  if (!runtimeStatus) {
    return {
      description: "This terminal has not reported runtime health yet.",
      label: "No check-in",
      toneClassName: "border-warning/30 bg-warning/15 text-warning",
    };
  }

  const sync = runtimeStatus.sync;
  if (
    sync?.status === "needs_review" ||
    (sync?.reviewEventCount ?? 0) > 0 ||
    getReviewEvidenceCount(summary.syncEvidence) > 0
  ) {
    return {
      description:
        primaryReason?.summary ??
        "Local activity needs manager or support review.",
      label: "Needs review",
      toneClassName: "border-warning/30 bg-warning/15 text-warning",
    };
  }

  if (sync?.status === "failed" || (sync?.failedEventCount ?? 0) > 0) {
    return {
      description: primaryReason?.summary ?? "The last sync attempt failed.",
      label: "Sync failed",
      toneClassName: "border-danger/30 bg-danger/10 text-danger",
    };
  }

  if (runtimeStatus.localStore?.available === false) {
    return {
      description:
        primaryReason?.summary ?? "Local terminal storage is not available.",
      label: "Local store issue",
      toneClassName: "border-danger/30 bg-danger/10 text-danger",
    };
  }

  if (isAppSessionLocalContinuation(runtimeStatus)) {
    return {
      description:
        "App session unverified; local sales stay on this terminal until cloud validation returns.",
      label: "Local continuation",
      toneClassName: "border-warning/30 bg-warning/15 text-warning",
    };
  }

  if (summary.health === "offline") {
    return {
      description: "This terminal is offline.",
      label: "Offline",
      toneClassName: "border-danger/30 bg-danger/10 text-danger",
    };
  }

  if (summary.health === "stale") {
    return {
      description: "This terminal has not checked in recently.",
      label: "Stale",
      toneClassName: "border-warning/30 bg-warning/15 text-warning",
    };
  }

  if (
    typeof runtimeStatus.receivedAt === "number" &&
    Date.now() - runtimeStatus.receivedAt > STALE_CHECK_IN_MS
  ) {
    return {
      description: "This terminal has not checked in recently.",
      label: "Stale",
      toneClassName: "border-warning/30 bg-warning/15 text-warning",
    };
  }

  if (
    sync?.status === "pending" ||
    sync?.status === "syncing" ||
    (sync?.pendingEventCount ?? 0) > 0 ||
    (sync?.uploadableEventCount ?? 0) > 0
  ) {
    return {
      description: "Local events are waiting for cloud sync.",
      label: sync?.status === "syncing" ? "Syncing" : "Pending sync",
      toneClassName: "border-warning/30 bg-warning/15 text-warning",
    };
  }

  const recoveryPresentation = buildTerminalRecoveryPresentation(summary);
  if (
    recoveryPresentation.readiness.status === "needs_terminal_action" ||
    recoveryPresentation.readiness.status === "needs_cloud_repair" ||
    recoveryPresentation.readiness.status === "needs_manual_review"
  ) {
    return {
      description:
        recoveryPresentation.groups.terminalRequired[0]?.summary ??
        recoveryPresentation.groups.cloudRepair[0]?.summary ??
        recoveryPresentation.groups.manualReview[0]?.summary ??
        recoveryPresentation.readiness.description,
      label: recoveryPresentation.readiness.label,
      toneClassName: recoveryPresentation.readiness.toneClassName,
    };
  }

  return {
    description: "The latest terminal check-in is clear.",
    label: "Healthy",
    toneClassName: "border-success/30 bg-success/10 text-success",
  };
}

function isSetupAttentionReason(reason?: TerminalHealthAttentionReason | null) {
  return (
    reason?.type === "terminal_seed_missing" ||
    reason?.type === "terminal_authorization_failed"
  );
}

function recoveryPresentationClearsTerminalAttention(
  summary: TerminalHealthClassificationInput,
) {
  const recovery = getTerminalRecoveryPreview(summary);
  if (!recovery) {
    return false;
  }

  const presentation = buildTerminalRecoveryPresentation(summary);
  return (
    presentation.groups.terminalRequired.length === 0 &&
    presentation.groups.cloudRepair.length === 0 &&
    presentation.groups.manualReview.length === 0 &&
    (presentation.readiness.status === "healthy_idle" ||
      presentation.readiness.status === "drawer_open" ||
      presentation.readiness.status === "able_to_transact_now")
  );
}

export function buildTerminalRecoveryPresentation(
  summary: TerminalHealthClassificationInput,
): TerminalRecoveryPresentation {
  const recovery = getTerminalRecoveryPreview(summary);
  const blockers = buildRecoveryBlockers(summary, recovery);
  const groups = {
    cloudRepair: blockers.filter(
      (blocker) => blocker.category === "cloud_repair",
    ),
    manualReview: blockers.filter(
      (blocker) => blocker.category === "manual_review",
    ),
    terminalRequired: blockers.filter(
      (blocker) => blocker.category === "terminal_required",
    ),
  };
  const readiness = buildRecoveryReadiness(summary, groups);
  const appUpdate = buildTerminalAppUpdatePresentation(summary, recovery);
  const safeActions = blockers
    .map((blocker) => blocker.action)
    .filter((action): action is TerminalRecoveryAction =>
      Boolean(action && isRecoveryActionIssuable(action)),
    );

  return {
    appUpdate,
    commandStatus: {
      commandType: recovery?.commandStatus?.commandType,
      label:
        normalizeSupportCopy(recovery?.commandStatus?.label) ??
        "No command issued",
      latestAcknowledgement: normalizeSupportCopy(
        recovery?.commandStatus?.latestAcknowledgement,
      ),
      status: formatStatusLabel(recovery?.commandStatus?.status ?? "idle"),
      verificationStatus: formatStatusLabel(
        recovery?.commandStatus?.verificationStatus ??
        recovery?.verification?.status ??
        "not_started",
      ),
    },
    groups,
    readiness,
    safeActions,
    verification: {
      status: formatStatusLabel(
        recovery?.verification?.status ??
        recovery?.commandStatus?.verificationStatus ??
        "not_started",
      ),
      summary:
        normalizeSupportCopy(recovery?.verification?.summary) ??
        getRecoveryVerificationSummary(
          recovery?.commandStatus?.verificationStatus,
        ) ??
        "Athena has not received recovery verification from a fresh terminal check-in.",
    },
  };
}

function buildRecoveryBlockers(
  summary: TerminalHealthClassificationInput,
  recovery:
    | TerminalRecoveryPreview
    | null
    | undefined = getTerminalRecoveryPreview(summary),
): RecoveryBlockerWithCategory[] {
  if (recovery?.blockers && !hasStructuredRecoveryPreview(recovery)) {
    return recovery.blockers.map((blocker, index) =>
      normalizeBackendRecoveryBlocker(blocker, index),
    );
  }

  if (recovery) {
    return buildRecoveryBlockersFromPreview(summary, recovery);
  }

  return deriveRecoveryBlockers(summary);
}

function getTerminalRecoveryPreview(
  summary: TerminalHealthClassificationInput,
) {
  return summary.recoveryPreview ?? summary.recovery ?? null;
}

function buildTerminalAppUpdatePresentation(
  summary: TerminalHealthClassificationInput,
  recovery: TerminalRecoveryPreview | null | undefined,
): TerminalAppUpdatePresentation {
  const preview = getTerminalAppUpdatePreview(summary, recovery);
  const status = preview.status;
  const fallback = getAppUpdateStatusFallback(status);
  const action = buildUpdateAppAction(summary, recovery);

  return {
    action,
    description:
      normalizeSupportCopy(preview.summary) ??
      getAppUpdateDescription(status, preview),
    label: fallback.label,
    status,
    toneClassName: fallback.toneClassName,
  };
}

function getTerminalAppUpdatePreview(
  summary: TerminalHealthClassificationInput,
  recovery: TerminalRecoveryPreview | null | undefined,
): TerminalAppUpdatePreview {
  if (recovery?.appUpdate) {
    return normalizeTerminalAppUpdatePreview(recovery.appUpdate);
  }

  const runtimeStatus = summary.runtimeStatus as
    | (TerminalHealthClassificationInput["runtimeStatus"] & {
      appUpdate?: unknown;
    })
    | null;
  return normalizeTerminalAppUpdatePreview(runtimeStatus?.appUpdate);
}

function normalizeTerminalAppUpdatePreview(
  value?: unknown,
): TerminalAppUpdatePreview {
  if (!value || typeof value !== "object") {
    return {
      evidenceFresh: false,
      status: "unknown",
    };
  }

  const record = value as Record<string, unknown>;
  const status = normalizeAppUpdateStatus(
    typeof record.status === "string" ? record.status : undefined,
  );
  const evidenceFresh =
    typeof record.evidenceFresh === "boolean"
      ? record.evidenceFresh
      : status !== "stale";

  return {
    commandCorrelated:
      typeof record.commandCorrelated === "boolean"
        ? record.commandCorrelated
        : undefined,
    currentBuildId:
      typeof record.currentBuildId === "string"
        ? record.currentBuildId
        : typeof record.currentBuildSha === "string"
          ? record.currentBuildSha
          : undefined,
    evidenceFresh,
    observedAt:
      typeof record.observedAt === "number" ? record.observedAt : undefined,
    pendingBuildId:
      typeof record.pendingBuildId === "string"
        ? record.pendingBuildId
        : typeof record.latestBuildId === "string"
          ? record.latestBuildId
          : undefined,
    stagingAssetCount:
      typeof record.stagingAssetCount === "number"
        ? record.stagingAssetCount
        : undefined,
    stagingFailedAssetCount:
      typeof record.stagingFailedAssetCount === "number"
        ? record.stagingFailedAssetCount
        : undefined,
    stagingReason:
      typeof record.stagingReason === "string"
        ? record.stagingReason
        : undefined,
    stagingRejectedAssetCount:
      typeof record.stagingRejectedAssetCount === "number"
        ? record.stagingRejectedAssetCount
        : undefined,
    stagingStatus:
      typeof record.stagingStatus === "string"
        ? record.stagingStatus
        : undefined,
    status,
    summary:
      typeof record.summary === "string"
        ? record.summary
        : typeof record.blockerSummary === "string"
          ? normalizeAppUpdateBlockerSummary(record.blockerSummary)
          : typeof record.selectedBlockerCode === "string"
            ? normalizeAppUpdateBlockerSummary(record.selectedBlockerCode)
            : undefined,
  };
}

function normalizeAppUpdateStatus(status?: string): TerminalAppUpdateStatus {
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

function buildUpdateAppAction(
  summary: TerminalHealthClassificationInput,
  recovery: TerminalRecoveryPreview | null | undefined,
): TerminalRecoveryAction | undefined {
  if (summary.terminal.status !== "active" || !summary.terminal._id) {
    return undefined;
  }

  const duplicateStatus = getPreviewCommandActionStatus(
    recovery?.commandStatus,
    "update_app",
  );
  const activeDuplicateStatus = isActiveDuplicateTerminalCommandStatus(
    duplicateStatus,
  )
    ? duplicateStatus
    : undefined;

  return {
    commandContext: {
      expectedBlockerType: "app_update",
      reason: "Support requested an app update check.",
    },
    commandType: "update_app",
    expectedEvidence: {},
    kind: "terminal_command",
    label: "Update app",
    status: activeDuplicateStatus ?? "available",
  };
}

function isActiveDuplicateTerminalCommandStatus(
  status: TerminalRecoveryActionStatus | undefined,
) {
  return (
    status === "pending" ||
    status === "claimed" ||
    status === "waiting_for_check_in"
  );
}

function getAppUpdateStatusFallback(status: TerminalAppUpdateStatus) {
  switch (status) {
    case "current":
      return {
        label: "App current",
        toneClassName: "border-success/30 bg-success/10 text-success",
      };
    case "update_ready":
      return {
        label: "New version available",
        toneClassName: "border-warning/30 bg-warning/15 text-warning",
      };
    case "update_ready_unstaged":
      return {
        label: "Update available",
        toneClassName: "border-warning/30 bg-warning/15 text-warning",
      };
    case "blocked":
      return {
        label: "Update blocked",
        toneClassName: "border-warning/30 bg-warning/15 text-warning",
      };
    case "applying":
      return {
        label: "Update applying",
        toneClassName: "border-warning/30 bg-warning/15 text-warning",
      };
    case "detector_failed":
      return {
        label: "Update check failed",
        toneClassName: "border-warning/30 bg-warning/15 text-warning",
      };
    case "stale":
      return {
        label: "Update status stale",
        toneClassName: "border-muted bg-muted/40 text-muted-foreground",
      };
    case "unknown":
    default:
      return {
        label: "Update status unknown",
        toneClassName: "border-muted bg-muted/40 text-muted-foreground",
      };
  }
}

function getAppUpdateDescription(
  status: TerminalAppUpdateStatus,
  appUpdate: TerminalAppUpdatePreview,
) {
  switch (status) {
    case "current":
      return "This checkout station reports the current app build.";
    case "update_ready":
      if (appUpdate.stagingStatus === "unstaged") {
        return getAppUpdateStagingWarningDescription(appUpdate);
      }
      return "An app update is ready. The checkout station will refresh only when local work is safe.";
    case "update_ready_unstaged":
      return getAppUpdateStagingDescription(appUpdate);
    case "blocked":
      return "Refresh is blocked by active checkout work.";
    case "applying":
      return "The checkout station accepted the update. Waiting for a fresh check-in.";
    case "detector_failed":
      return "Athena could not confirm this checkout station's app update state.";
    case "stale":
      return "The latest app update evidence is stale. Send Update app to ask the checkout station to check again.";
    case "unknown":
    default:
      return appUpdate.evidenceFresh
        ? "This checkout station has not reported app update readiness."
        : "App update readiness has not been reported yet.";
  }
}

function getAppUpdateStagingWarningDescription(
  appUpdate: TerminalAppUpdatePreview,
) {
  const reason = appUpdate.stagingReason;
  const assetSummary = formatStagingAssetSummary(appUpdate);

  if (reason === "service-worker-unavailable") {
    return `An app update is ready, but this browser has not connected to the POS app shell cache yet.${assetSummary}`;
  }
  if (reason === "service-worker-timeout") {
    return `An app update is ready, but offline cache preparation did not finish in time.${assetSummary}`;
  }
  if (reason === "cache-storage-unavailable") {
    return "An app update is ready, but this browser cannot prepare offline cache storage.";
  }
  if (reason === "no-static-assets" || reason === "no-entry-html") {
    return "An app update is ready, but Athena could not inspect deployed app assets for offline cache preparation.";
  }
  if (reason === "asset-staging-failed" || reason === "service-worker-error") {
    return `An app update is ready, but the POS app shell could not cache every required asset for offline use.${assetSummary}`;
  }

  return "An app update is ready, but offline cache preparation is incomplete.";
}

function getAppUpdateStagingDescription(appUpdate: TerminalAppUpdatePreview) {
  const reason = appUpdate.stagingReason;
  const assetSummary = formatStagingAssetSummary(appUpdate);

  if (reason === "service-worker-unavailable") {
    return `An app update was detected, but this browser has not connected to the POS app shell yet.${assetSummary}`;
  }
  if (reason === "service-worker-timeout") {
    return `An app update was detected, but the POS app shell did not finish staging assets in time.${assetSummary}`;
  }
  if (reason === "cache-storage-unavailable") {
    return "An app update was detected, but this browser cannot use Cache Storage to prepare it.";
  }
  if (reason === "no-static-assets" || reason === "no-entry-html") {
    return "An app update was detected, but Athena could not read the deployed app assets to prepare it.";
  }
  if (reason === "asset-staging-failed" || reason === "service-worker-error") {
    return `An app update was detected, but the POS app shell could not cache every required asset.${assetSummary}`;
  }

  return "An app update is available but not ready to refresh yet.";
}

function formatStagingAssetSummary(appUpdate: TerminalAppUpdatePreview) {
  const failed = appUpdate.stagingFailedAssetCount ?? 0;
  const rejected = appUpdate.stagingRejectedAssetCount ?? 0;
  const total = appUpdate.stagingAssetCount;

  if (!total && !failed && !rejected) {
    return "";
  }

  const issueCount = failed + rejected;
  if (issueCount > 0) {
    return ` ${issueCount} of ${total ?? "the"} asset${issueCount === 1 ? "" : "s"} ${issueCount === 1 ? "needs" : "need"} attention.`;
  }

  return typeof total === "number"
    ? ` ${total} asset${total === 1 ? "" : "s"} checked.`
    : "";
}

function normalizeAppUpdateBlockerSummary(value: string) {
  if (/sale|payment|checkout|drawer|sync|review|work/i.test(value)) {
    return "Refresh is blocked by active checkout work.";
  }
  return "Refresh is blocked by local app work.";
}

function hasStructuredRecoveryPreview(recovery: TerminalRecoveryPreview) {
  return Boolean(
    (recovery.cloudRepair?.safeConflictIds.length ?? 0) > 0 ||
    (recovery.terminalActions?.length ?? 0) > 0 ||
    (recovery.manualReview?.length ?? 0) > 0,
  );
}

function getRecoveryVerificationSummary(
  status?: TerminalRecoveryActionStatus | null,
) {
  if (status === "verified") {
    return "Recovery was verified by the latest terminal check-in.";
  }
  if (
    status === "runtime_verification_ready" ||
    status === "waiting_for_check_in"
  ) {
    return "Command completed locally. Waiting for a fresh terminal check-in before verification.";
  }
  if (status === "waiting_for_acknowledgement") {
    return "Command is waiting for this checkout station to acknowledge it.";
  }
  if (status === "verification_failed") {
    return "Recovery verification did not match the latest terminal check-in.";
  }
  return undefined;
}

function getPreviewCommandActionStatus(
  commandStatus?: TerminalRecoveryPreview["commandStatus"],
  commandType?: TerminalRecoveryCommandType,
) {
  if (
    commandStatus?.commandType &&
    commandType &&
    commandStatus.commandType !== commandType
  ) {
    return undefined;
  }
  if (commandStatus?.verificationStatus === "verified") {
    return "verified";
  }
  if (commandStatus?.verificationStatus === "runtime_verification_ready") {
    return "waiting_for_check_in";
  }
  return normalizeActionStatus(commandStatus?.status);
}

function buildRecoveryBlockersFromPreview(
  summary: TerminalHealthClassificationInput,
  preview: TerminalRecoveryPreview,
): RecoveryBlockerWithCategory[] {
  const blockers: RecoveryBlockerWithCategory[] = [];
  const commandStatus = getPreviewCommandActionStatus(preview.commandStatus);

  if ((preview.cloudRepair?.safeConflictIds.length ?? 0) > 0) {
    blockers.push({
      action: {
        expectedPreconditionHash: preview.cloudRepair?.preconditionHash,
        kind: "cloud_repair",
        label: "Resolve duplicate drawer attempts",
        status: commandStatus ?? "available",
      },
      category: "cloud_repair",
      detail: `${preview.cloudRepair?.safeConflictIds.length ?? 0} safe conflict${preview.cloudRepair?.safeConflictIds.length === 1 ? "" : "s"
        } matched.`,
      id: "cloud-repair-preview",
      status: commandStatus ?? "available",
      summary:
        "Duplicate drawer-open attempts can be resolved. No sales, payments, or inventory will be changed.",
      title: "Duplicate drawer-open attempts",
    });
  }

  preview.terminalActions?.forEach((action, index) => {
    if (isDangerousLocalReviewClearAllAction(action)) {
      return;
    }

    const actionStatus = getTerminalActionStatusForCurrentRuntime(
      summary,
      preview,
      action.commandType,
    );
    if (actionStatus === "verified") {
      return;
    }

    blockers.push({
      action: {
        commandContext: action.commandContext,
        commandType: action.commandType,
        expectedEvidence: action.expectedEvidence,
        kind: "terminal_command",
        label: getTerminalCommandActionLabel(action.commandType),
        status: actionStatus ?? "available",
      },
      category: "terminal_required",
      detail: getExpectedEvidenceSummary(action.expectedEvidence),
      id: `terminal-action-${action.commandType}-${index}`,
      status: actionStatus ?? "available",
      summary:
        getTerminalCommandRecoverySummary(action.commandType, actionStatus) ??
        normalizeSupportCopy(action.reason) ??
        terminalRequiredSummary("drawer_authority_blocked"),
      title: getTerminalCommandTitle(action.commandType),
    });
  });

  preview.manualReview?.forEach((item, index) => {
    const normalizedReason = normalizeSupportCopy(item.reason);
    blockers.push({
      category: "manual_review",
      id: `manual-review-${item.type}-${index}`,
      summary:
        isUnsafeManualReviewReason(item.reason) || !normalizedReason
          ? "Manual review required. Use the linked operations or cash-control review before support repairs this terminal."
          : normalizedReason,
      title: "Manual review required",
    });
  });

  return blockers;
}

function isDangerousLocalReviewClearAllAction(
  action: NonNullable<TerminalRecoveryPreview["terminalActions"]>[number],
) {
  return (
    action.commandType === "clear_local_review_items" &&
    action.commandContext.localReviewClearAll === true
  );
}

function getTerminalActionStatusForCurrentRuntime(
  summary: TerminalHealthClassificationInput,
  preview: TerminalRecoveryPreview,
  commandType: TerminalRecoveryCommandType,
) {
  const actionStatus = getPreviewCommandActionStatus(
    preview.commandStatus,
    commandType,
  );
  if (
    actionStatus === "verified" &&
    commandType === "collect_local_review" &&
    latestRuntimeStillNeedsLocalReviewDrain(summary)
  ) {
    return undefined;
  }
  return actionStatus;
}

function latestRuntimeStillNeedsLocalReviewDrain(
  summary: TerminalHealthClassificationInput,
) {
  const sync = summary.runtimeStatus?.sync;
  return Boolean(
    sync && (sync.status === "needs_review" || (sync.reviewEventCount ?? 0) > 0),
  );
}

export function isRecoveryActionIssuable(action: TerminalRecoveryAction) {
  if (!["cloud_repair", "terminal_command"].includes(action.kind)) {
    return false;
  }

  if (isRecoveryActionInFlightOrClosed(action.status)) {
    return false;
  }

  if (action.kind === "cloud_repair") {
    return Boolean(action.expectedPreconditionHash);
  }

  return Boolean(
    action.commandType && action.commandContext && action.expectedEvidence,
  );
}

export function isRecoveryActionInFlightOrClosed(
  status?: TerminalRecoveryActionStatus | null,
) {
  return [
    "blocked",
    "claimed",
    "completed",
    "failed",
    "pending",
    "verified",
    "waiting_for_check_in",
  ].includes(status ?? "");
}

type RecoveryBlockerWithCategory = TerminalRecoveryPresentationBlocker & {
  category: "cloud_repair" | "manual_review" | "terminal_required";
};

function buildRecoveryReadiness(
  summary: TerminalHealthClassificationInput,
  groups: TerminalRecoveryPresentation["groups"],
): TerminalRecoveryReadinessPresentation {
  const recovery = getTerminalRecoveryPreview(summary);
  const readiness = recovery?.readiness;
  const explicitStatus =
    typeof readiness === "string" ? readiness : readiness?.status;
  const derivedStatus =
    groups.manualReview.length > 0
      ? "needs_manual_review"
      : groups.cloudRepair.length > 0
        ? "needs_cloud_repair"
        : groups.terminalRequired.length > 0
          ? "needs_terminal_action"
          : "healthy_idle";
  const status =
    explicitStatus &&
      explicitReadinessMatchesVisibleEvidence(explicitStatus, groups)
      ? explicitStatus
      : derivedStatus;

  const fallback = getRecoveryReadinessFallback(status);

  return {
    description:
      normalizeSupportCopy(
        typeof readiness === "string" ? undefined : readiness?.summary,
      ) ?? fallback.description,
    label: fallback.label,
    status,
    toneClassName: fallback.toneClassName,
  };
}

function explicitReadinessMatchesVisibleEvidence(
  status: TerminalRecoveryReadinessStatus | undefined,
  groups: TerminalRecoveryPresentation["groups"],
) {
  switch (status) {
    case "needs_manual_review":
      return true;
    case "needs_cloud_repair":
      return true;
    case "needs_terminal_action":
      return groups.terminalRequired.length > 0;
    case "able_to_transact_now":
    case "drawer_open":
    case "healthy_idle":
      return true;
    default:
      return false;
  }
}

function getRecoveryReadinessFallback(status: TerminalRecoveryReadinessStatus) {
  switch (status) {
    case "able_to_transact_now":
      return {
        description:
          "Able to transact now. Drawer, cashier, and sale authority are active.",
        label: "Able to transact now",
        toneClassName: "border-success/30 bg-success/10 text-success",
      };
    case "healthy_idle":
      return {
        description: "Healthy idle. Open a drawer and sign in before selling.",
        label: "Healthy idle",
        toneClassName: "border-success/30 bg-success/10 text-success",
      };
    case "drawer_open":
      return {
        description: "Drawer is open. Sign in before selling.",
        label: "Drawer open",
        toneClassName: "border-success/30 bg-success/10 text-success",
      };
    case "needs_cloud_repair":
      return {
        description:
          "Cloud repair is available for stale terminal evidence. No sale, payment, or inventory facts will be changed.",
        label: "Needs cloud repair",
        toneClassName: "border-warning/30 bg-warning/15 text-warning",
      };
    case "needs_terminal_action":
      return {
        description:
          "Terminal action required. This checkout station needs to run the repair before Athena can verify it.",
        label: "Needs terminal action",
        toneClassName: "border-warning/30 bg-warning/15 text-warning",
      };
    case "needs_manual_review":
      return {
        description:
          "Manual review required. Use the linked operations or cash-control review before support repairs this terminal.",
        label: "Needs manual review",
        toneClassName: "border-danger/25 bg-danger/10 text-danger",
      };
    default:
      return {
        description: "Recovery status is not reported yet.",
        label: formatStatusLabel(status),
        toneClassName: "border-muted bg-muted/40 text-muted-foreground",
      };
  }
}

function normalizeBackendRecoveryBlocker(
  blocker: TerminalRecoveryBlocker,
  index: number,
): RecoveryBlockerWithCategory {
  const category = normalizeRecoveryCategory(blocker.category);
  const safeAction =
    blocker.action &&
      ["cloud_repair", "terminal_command"].includes(blocker.action.kind)
      ? {
        ...blocker.action,
        label:
          normalizeSupportCopy(blocker.action.label) ?? blocker.action.label,
        status: normalizeActionStatus(blocker.action.status),
      }
      : undefined;

  return {
    action: safeAction,
    actionTarget: blocker.actionTarget,
    category,
    detail: normalizeSupportCopy(blocker.detail),
    id: blocker.id ?? `${category}-${index}`,
    status: blocker.status ?? blocker.action?.status,
    summary:
      normalizeSupportCopy(blocker.summary) ?? defaultBlockerSummary(category),
    title:
      normalizeSupportCopy(blocker.title) ??
      (category === "cloud_repair"
        ? "Cloud repair"
        : category === "terminal_required"
          ? "Terminal action"
          : "Manual review"),
  };
}

function normalizeActionStatus(status?: TerminalRecoveryActionStatus) {
  if (status === "runtime_verification_ready") {
    return "waiting_for_check_in";
  }
  if (status === "precondition_failed" || status === "superseded") {
    return "failed";
  }
  return status;
}

function getTerminalCommandActionLabel(
  commandType: NonNullable<TerminalRecoveryAction["commandType"]>,
) {
  switch (commandType) {
    case "update_app":
      return "Update app";
    case "collect_local_review":
      return "Collect local review items";
    case "clear_local_review_items":
      return "Clear local review items";
    case "repair_terminal_seed":
      return "Send terminal setup repair";
    case "clear_stale_drawer_authority":
      return "Send drawer authority repair";
    case "refresh_staff_authority":
      return "Send staff authority refresh";
    case "refresh_snapshots":
      return "Send snapshot refresh";
    case "retry_sync":
      return "Retry terminal sync";
    case "report_diagnostics":
      return "Request diagnostics";
  }
}

function getTerminalCommandTitle(
  commandType: NonNullable<TerminalRecoveryAction["commandType"]>,
) {
  switch (commandType) {
    case "update_app":
      return "App update";
    case "collect_local_review":
      return "Local review collection";
    case "clear_local_review_items":
      return "Local review cleanup";
    case "repair_terminal_seed":
      return "Terminal setup repair";
    case "clear_stale_drawer_authority":
      return "Drawer authority repair";
    case "refresh_staff_authority":
      return "Staff authority refresh";
    case "refresh_snapshots":
      return "Snapshot refresh";
    case "retry_sync":
      return "Terminal sync retry";
    case "report_diagnostics":
      return "Diagnostics request";
  }
}

function getTerminalCommandRecoverySummary(
  commandType: NonNullable<TerminalRecoveryAction["commandType"]>,
  status?: TerminalRecoveryActionStatus,
) {
  const commandName =
    commandType === "update_app"
      ? "Update app command"
      : commandType === "collect_local_review"
        ? "Local review collection"
        : commandType === "clear_local_review_items"
          ? "Local review cleanup"
          : commandType === "clear_stale_drawer_authority"
            ? "Drawer repair command"
            : commandType === "retry_sync"
              ? "Sync retry command"
              : "Terminal repair command";
  if (status === "verified" && commandType === "collect_local_review") {
    return "Local review collection completed, but the terminal still reports local review items.";
  }
  if (status === "verified") {
    return `${commandName} was verified by the latest terminal check-in.`;
  }
  if (status === "waiting_for_check_in" || status === "completed") {
    return `${commandName} completed locally. Waiting for a fresh terminal check-in before verification.`;
  }
  if (status === "claimed") {
    return `${commandName} is running on this checkout station.`;
  }
  if (status === "pending") {
    return `${commandName} is queued for this checkout station.`;
  }
  return undefined;
}

function getExpectedEvidenceSummary(
  evidence?: TerminalRecoveryAction["expectedEvidence"],
) {
  if (!evidence) {
    return undefined;
  }

  const checks = [
    evidence.terminalIntegrityStatus
      ? `Terminal integrity ${formatStatusLabel(evidence.terminalIntegrityStatus)}`
      : null,
    evidence.drawerAuthorityStatus
      ? `Drawer authority ${formatStatusLabel(evidence.drawerAuthorityStatus)}`
      : null,
    evidence.staffAuthorityStatus
      ? `Staff authority ${formatStatusLabel(evidence.staffAuthorityStatus)}`
      : null,
    evidence.syncStatus
      ? `Sync ${formatStatusLabel(evidence.syncStatus)}`
      : null,
    evidence.localReviewDetailsCollected === true
      ? "Local review details collected"
      : null,
    evidence.localReviewEventCount !== undefined
      ? `${evidence.localReviewEventCount} local review items remaining`
      : null,
    evidence.terminalSeedReady === true ? "Terminal seed ready" : null,
    evidence.localStoreAvailable === true ? "Local store available" : null,
  ].filter(Boolean);

  return checks.length > 0
    ? `Expected after check-in: ${checks.join(", ")}.`
    : undefined;
}

function deriveRecoveryBlockers(
  summary: TerminalHealthClassificationInput,
): RecoveryBlockerWithCategory[] {
  return (summary.attentionReasons ?? []).map((reason, index) =>
    deriveRecoveryBlockerFromReason(reason, index),
  );
}

function deriveRecoveryBlockerFromReason(
  reason: TerminalHealthAttentionReason,
  index: number,
): RecoveryBlockerWithCategory {
  const normalizedSummary = normalizeSupportCopy(reason.summary);

  if (
    reason.type === "cloud_conflict" &&
    isSafeDuplicateDrawerOpen(reason.summary)
  ) {
    return {
      action: {
        kind: "cloud_repair",
        label: "Resolve duplicate drawer attempts",
        status: "available",
      },
      category: "cloud_repair",
      id: `reason-cloud-repair-${index}`,
      summary:
        "Duplicate drawer-open attempts can be resolved. No sales, payments, or inventory will be changed.",
      title: "Duplicate drawer-open attempts",
    };
  }

  if (
    reason.type === "terminal_seed_missing" ||
    reason.type === "terminal_authorization_failed" ||
    reason.type === "drawer_authority_blocked"
  ) {
    return {
      action: {
        kind: "terminal_command",
        label:
          reason.type === "drawer_authority_blocked"
            ? "Send drawer repair command"
            : "Send terminal repair command",
        status: "available",
      },
      category: "terminal_required",
      id: `reason-terminal-${index}`,
      summary: terminalRequiredSummary(reason.type),
      title:
        reason.type === "drawer_authority_blocked"
          ? "Drawer authority repair"
          : "Terminal repair required",
    };
  }

  return {
    category: "manual_review",
    id: `reason-manual-${index}`,
    summary:
      isUnsafeManualReviewReason(reason.summary) || !normalizedSummary
        ? "Manual review required. Use the linked operations or cash-control review before support repairs this terminal."
        : normalizedSummary,
    title: "Manual review required",
  };
}

function normalizeRecoveryCategory(
  category: TerminalRecoveryBlocker["category"],
): RecoveryBlockerWithCategory["category"] {
  if (category === "cloud_repair" || category === "terminal_required") {
    return category;
  }

  return "manual_review";
}

function defaultBlockerSummary(
  category: RecoveryBlockerWithCategory["category"],
) {
  if (category === "cloud_repair") {
    return "Cloud repair is available for stale terminal evidence.";
  }
  if (category === "terminal_required") {
    return "Terminal action required. This checkout station needs to run the repair before Athena can verify it.";
  }
  return "Manual review required. Use the linked operations or cash-control review before support repairs this terminal.";
}

function terminalRequiredSummary(
  reasonType: TerminalHealthAttentionReason["type"],
) {
  if (reasonType === "terminal_authorization_failed") {
    return "Terminal authorization needs refresh. This checkout station must reconnect before Athena can verify it.";
  }
  if (reasonType === "drawer_authority_blocked") {
    return "Drawer authority needs repair. This checkout station must run the repair before selling.";
  }
  return "Terminal setup data is not ready. This checkout station must repair setup before Athena can verify it.";
}

function isSafeDuplicateDrawerOpen(summary: string) {
  return (
    /\b(duplicate|already)\b/i.test(summary) &&
    /\b(register|drawer)[ _-]?open/i.test(summary) &&
    !MANUAL_REVIEW_EVENT_PATTERN.test(summary)
  );
}

function isUnsafeManualReviewReason(summary: string) {
  return (
    MANUAL_REVIEW_EVENT_PATTERN.test(summary) ||
    /authorization_failed|sync secret/i.test(summary)
  );
}

function normalizeSupportCopy(value?: string | null) {
  if (!value) return undefined;
  if (/cloud conflict \S+ needs manual review before repair/i.test(value)) {
    return "A cloud sync conflict needs manual review before support can repair this terminal.";
  }
  if (isSafeDuplicateDrawerOpen(value)) {
    return "Duplicate drawer-open attempts can be resolved. No sales, payments, or inventory will be changed.";
  }
  if (/authorization_failed|sync secret/i.test(value)) {
    return "Terminal authorization needs refresh. This checkout station must reconnect before Athena can verify it.";
  }
  if (/A register session is already open/i.test(value)) {
    return "Duplicate drawer-open attempts can be resolved. No sales, payments, or inventory will be changed.";
  }
  return value;
}

function sanitizeOperationalCopy(value: string | undefined, fallback: string) {
  const normalized = normalizeSupportCopy(value);
  if (!normalized || containsUnsafeOperationalCopy(normalized)) {
    return fallback;
  }

  return normalized;
}

function containsUnsafeOperationalCopy(value: string) {
  return /sync secret|authorization_failed|staff proof|pin\b|password|token|otp|payment payload|customer payload|card payload|raw payload|backend exception|stack trace|traceback|returnsvalidationerror|conflict[-_][a-z0-9-]+|poslocalsyncconflict/i.test(
    value,
  );
}

function isAppSessionLocalContinuation(
  runtimeStatus: TerminalHealthClassificationInput["runtimeStatus"],
) {
  if (!runtimeStatus) return false;
  if (runtimeStatus.appSessionRecovery?.status !== "waiting_for_network") {
    return false;
  }

  const sync = runtimeStatus.sync;
  return (
    (sync?.pendingEventCount ?? 0) > 0 &&
    (sync?.uploadableEventCount ?? 0) === 0 &&
    (sync?.reviewEventCount ?? 0) === 0 &&
    (sync?.failedEventCount ?? 0) === 0
  );
}
