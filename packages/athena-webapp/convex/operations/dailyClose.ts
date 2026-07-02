import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { commandResultValidator } from "../lib/commandResultValidators";
import { createOperationalWorkItemWithCtx } from "./operationalWorkItems";
import { recordOperationalEventWithCtx } from "./operationalEvents";
import {
  approvalRequired,
  ok,
  userError,
  type ApprovalCommandResult,
} from "../../shared/commandResult";
import type { ApprovalRequirement } from "../../shared/approvalPolicy";
import {
  APPROVAL_ACTIONS,
  consumeCommandApprovalProofWithCtx,
} from "./approvalActions";
import {
  dailyOperationsEodPrepareAction,
  getLatestDailyOperationsAutomationStatusWithCtx,
  type DailyOperationsAutomationStatus,
} from "./dailyOperationsAutomation";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { buildPaymentTotals, transactionCashDelta } from "./paymentTotals";
import type { AutomationDecisionEvidence } from "../automation/runLedger";

const DAILY_CLOSE_QUERY_LIMIT = 200;
const DAILY_CLOSE_CARRY_FORWARD_SOURCE_PROBE_LIMIT = 1_000;
const REGISTER_SESSION_DAILY_CLOSE_SOURCE_LIMIT = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OPERATING_DATE_RANGE_MS = 36 * 60 * 60 * 1000;
const DAILY_CLOSE_SUBJECT_TYPE = "daily_close";
const DAILY_CLOSE_CARRY_FORWARD_TYPE = "daily_close_carry_forward";
const TERMINAL_WORK_ITEM_STATUSES = new Set(["completed", "cancelled"]);
const OPEN_OPERATIONAL_WORK_ITEM_STATUSES = ["open", "in_progress"] as const;
const EOD_AUTO_COMPLETE_LOW_RISK_REVIEW_CATEGORIES = new Set([
  "cash_variance",
  "voided_sale",
]);
const ACTIVE_REGISTER_STATUSES = ["open", "active", "closing"] as const;
const REVIEW_ONLY_REGISTER_CLOSEOUT_STATUSES = ["closeout_rejected"] as const;
const OPEN_POS_SESSION_STATUSES = ["active", "held"] as const;
const DAILY_CLOSE_COMPLETION_ACTION = APPROVAL_ACTIONS.dailyCloseCompletion;
const DAILY_CLOSE_REOPEN_ACTION = APPROVAL_ACTIONS.dailyCloseReopen;
const DAILY_CLOSE_CARRY_FORWARD_RESOLUTION_ACTION = {
  key: "operations.daily_close.resolve_carry_forward",
  label: "Resolve carry-forward work",
} as const;
const DAILY_CLOSE_BLOCKER_CATEGORY_PRECEDENCE: Record<string, number> = {
  approval: 0,
  register_session: 10,
  pos_session: 20,
};

type DailyCloseSeverity = "blocker" | "review" | "carry_forward" | "ready";

type DailyCloseItem = {
  key: string;
  severity: DailyCloseSeverity;
  category: string;
  title: string;
  message: string;
  subject: {
    type: string;
    id: string;
    label?: string;
  };
  link?: {
    href?: string;
    label?: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    to?: string;
  };
  carryForwardResolution?: {
    businessDate: string;
    dailyCloseId: Id<"dailyClose">;
    sourceId: string;
    workItemId: Id<"operationalWorkItem">;
  };
  metadata?: Record<string, unknown>;
};

type DailyCloseRange = { endAt: number; startAt: number };

type RegisterSessionRangeCandidate = Pick<
  Doc<"registerSession">,
  | "closedAt"
  | "closeoutOperatingDate"
  | "closeoutRecords"
  | "countedCash"
  | "managerApprovalRequestId"
  | "openedOperatingDate"
  | "openedAt"
  | "status"
>;

type RegisterSessionCloseoutApproval = Pick<
  Doc<"approvalRequest">,
  "createdAt" | "requestType"
>;

type DailyCloseReadinessStatus = "blocked" | "needs_review" | "ready";

type DailyCloseReadiness = {
  status: DailyCloseReadinessStatus;
  blockerCount: number;
  reviewCount: number;
  carryForwardCount: number;
  readyCount: number;
};

type DailyCloseSummary = {
  adjustedSalesTotal: number;
  adjustmentCashSettlementTotal: number;
  adjustmentCollectionTotal: number;
  adjustmentNetSettlementTotal: number;
  adjustmentPaymentTotals: Array<{
    method: string;
    amount: number;
    transactionCount: number;
  }>;
  adjustmentRefundTotal: number;
  carriedOverCashTotal: number;
  carriedOverRegisterCount: number;
  cashDepositTotal: number;
  closedRegisterSessionCount: number;
  currentDayCashTotal: number;
  currentDayCashTransactionCount: number;
  expectedCashTotal: number;
  expenseTransactionCount: number;
  expenseStaffCount: number;
  expenseTotal: number;
  netCashVariance: number;
  openWorkItemCount: number;
  pendingApprovalCount: number;
  registerCount: number;
  registerVarianceCount: number;
  salesTotal: number;
  itemAdjustmentCount: number;
  netCashMovementTotal: number;
  transactionCount: number;
  voidedTransactionCount: number;
  paymentTotals: Array<{
    method: string;
    amount: number;
    transactionCount: number;
  }>;
};

type DailyCloseSourceCompletenessEntry = {
  source: string;
  complete: boolean;
  readMode: string;
  recordCount: number;
  limit?: number;
  range?: DailyCloseRange;
  statuses?: string[];
  reason?: string;
};

type DailyCloseSourceCompleteness = {
  complete: boolean;
  entries: DailyCloseSourceCompletenessEntry[];
};

type DailyCloseSourceRead<T> = {
  rows: T[];
  completeness: DailyCloseSourceCompletenessEntry;
};

type DailyCloseSnapshot = {
  operatingDate: string;
  storeId: Id<"store">;
  organizationId: Id<"organization"> | null;
  automationStatus?: DailyOperationsAutomationStatus | null;
  startAt: number;
  endAt: number;
  existingClose: Doc<"dailyClose"> | null;
  completedClose: {
    actorType?: "human" | "automation";
    automationDecisionReason?: string;
    automationPolicyVersion?: string;
    automationRunId?: Id<"automationRun">;
    completedAt?: number;
    completedByStaffProfileId?: Id<"staffProfile">;
    completedByStaffName?: string | null;
    completedByUserId?: Id<"athenaUser">;
    completionApprovalProofId?: Id<"approvalProof">;
    completionApprovedByStaffProfileId?: Id<"staffProfile">;
    completionRequestedByStaffProfileId?: Id<"staffProfile">;
    completionRequestedByUserId?: Id<"athenaUser">;
    notes?: string;
    policyReviewedItemKeys?: string[];
    restrictedDetailsRedacted?: boolean;
  } | null;
  priorClose: Doc<"dailyClose"> | null;
  priorDaySummary?: DailyCloseSummary | null;
  status: "blocked" | "needs_review" | "carry_forward" | "ready" | "completed";
  blockers: DailyCloseItem[];
  reviewItems: DailyCloseItem[];
  carryForwardItems: DailyCloseItem[];
  readyItems: DailyCloseItem[];
  readiness: DailyCloseReadiness;
  summary: DailyCloseSummary;
  sourceCompleteness: DailyCloseSourceCompleteness;
  sourceSubjects: Array<{
    type: string;
    id: string;
    label?: string;
  }>;
};

function sortDailyCloseBlockers(blockers: DailyCloseItem[]) {
  return blockers.sort((left, right) => {
    const leftPriority =
      DAILY_CLOSE_BLOCKER_CATEGORY_PRECEDENCE[left.category] ?? 100;
    const rightPriority =
      DAILY_CLOSE_BLOCKER_CATEGORY_PRECEDENCE[right.category] ?? 100;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.key.localeCompare(right.key);
  });
}

type DailyCloseReportSnapshot = {
  closeMetadata: {
    operatingDate: string;
    storeId: Id<"store">;
    organizationId: Id<"organization">;
    startAt: number;
    endAt: number;
    completedAt: number;
    completedByUserId?: Id<"athenaUser">;
    completedByStaffProfileId?: Id<"staffProfile">;
    completionApprovalProofId?: Id<"approvalProof">;
    completionApprovedByStaffProfileId?: Id<"staffProfile">;
    completionRequestedByStaffProfileId?: Id<"staffProfile">;
    completionRequestedByUserId?: Id<"athenaUser">;
    actorType?: "human" | "automation";
    automationRunId?: Id<"automationRun">;
    automationPolicyVersion?: string;
    automationDecisionReason?: string;
    currentnessMode?: "mark_current" | "historical_record";
    policyReviewedItemKeys?: string[];
    notes?: string;
    reviewedItemKeys?: string[];
    carryForwardWorkItemIds: Id<"operationalWorkItem">[];
  };
  readiness: DailyCloseReadiness;
  summary: Record<string, unknown>;
  reviewedItems: DailyCloseItem[];
  carryForwardItems: DailyCloseItem[];
  readyItems: DailyCloseItem[];
  sourceCompleteness?: DailyCloseSourceCompleteness;
  sourceSubjects: DailyCloseSnapshot["sourceSubjects"];
};

function normalizeCompletedDailyCloseSnapshot(args: {
  dailyClose: Doc<"dailyClose">;
  completedByStaffName?: string | null;
  completedByStaffProfileId?: Id<"staffProfile">;
  priorClose?: Doc<"dailyClose"> | null;
}): DailyCloseSnapshot | null {
  const reportSnapshot = args.dailyClose.reportSnapshot as
    | DailyCloseReportSnapshot
    | undefined;

  if (!reportSnapshot) {
    return null;
  }
  const attribution = completionAttributionForDailyClose(
    args.dailyClose,
    args.completedByStaffProfileId,
  );

  return {
    operatingDate: reportSnapshot.closeMetadata.operatingDate,
    storeId: reportSnapshot.closeMetadata.storeId,
    organizationId: reportSnapshot.closeMetadata.organizationId,
    startAt: reportSnapshot.closeMetadata.startAt,
    endAt: reportSnapshot.closeMetadata.endAt,
    existingClose: args.dailyClose,
    completedClose: {
      ...(attribution.actorType ? { actorType: attribution.actorType } : {}),
      ...(attribution.automationDecisionReason
        ? { automationDecisionReason: attribution.automationDecisionReason }
        : {}),
      ...(attribution.automationPolicyVersion
        ? { automationPolicyVersion: attribution.automationPolicyVersion }
        : {}),
      ...(attribution.automationRunId
        ? { automationRunId: attribution.automationRunId }
        : {}),
      completedAt: reportSnapshot.closeMetadata.completedAt,
      completedByStaffProfileId: attribution.completedByStaffProfileId,
      completedByStaffName: args.completedByStaffName ?? null,
      completedByUserId: attribution.completedByUserId,
      completionApprovalProofId: attribution.completionApprovalProofId,
      completionApprovedByStaffProfileId:
        attribution.completionApprovedByStaffProfileId,
      completionRequestedByStaffProfileId:
        attribution.completionRequestedByStaffProfileId,
      completionRequestedByUserId: attribution.completionRequestedByUserId,
      notes: reportSnapshot.closeMetadata.notes,
      ...(attribution.policyReviewedItemKeys
        ? { policyReviewedItemKeys: attribution.policyReviewedItemKeys }
        : {}),
    },
    priorClose: args.priorClose ?? null,
    priorDaySummary: args.priorClose?.summary
      ? normalizeDailyCloseSummary(args.priorClose.summary)
      : null,
    status: "completed",
    blockers: [],
    reviewItems: reportSnapshot.reviewedItems,
    carryForwardItems: reportSnapshot.carryForwardItems,
    readyItems: reportSnapshot.readyItems,
    readiness: reportSnapshot.readiness,
    summary: normalizeDailyCloseSummary(reportSnapshot.summary),
    sourceSubjects: reportSnapshot.sourceSubjects,
    sourceCompleteness:
      reportSnapshot.sourceCompleteness ?? completeSourceCompleteness([]),
  };
}

function completeSourceCompleteness(
  entries: DailyCloseSourceCompletenessEntry[],
): DailyCloseSourceCompleteness {
  return {
    complete: entries.every((entry) => entry.complete),
    entries,
  };
}

function sourceCompletenessEntry(args: {
  complete?: boolean;
  limit?: number;
  range?: DailyCloseRange;
  readMode: string;
  recordCount: number;
  reason?: string;
  source: string;
  statuses?: string[];
}): DailyCloseSourceCompletenessEntry {
  const complete =
    args.complete ?? (args.limit === undefined || args.recordCount < args.limit);

  return {
    source: args.source,
    complete,
    readMode: args.readMode,
    recordCount: args.recordCount,
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(args.range === undefined ? {} : { range: args.range }),
    ...(args.statuses === undefined ? {} : { statuses: args.statuses }),
    ...(complete ? {} : { reason: args.reason ?? `${args.source}_source_cap_reached` }),
  };
}

function mergeSourceCompleteness(
  ...sources: Array<DailyCloseSourceCompleteness | DailyCloseSourceCompletenessEntry>
) {
  return completeSourceCompleteness(
    sources.flatMap((source) => ("entries" in source ? source.entries : [source])),
  );
}

function normalizeDailyCloseSummary(
  summary: Record<string, unknown>,
): DailyCloseSummary {
  const salesTotal =
    typeof summary.salesTotal === "number" ? summary.salesTotal : 0;
  const currentDayCashTotal =
    typeof summary.currentDayCashTotal === "number"
      ? summary.currentDayCashTotal
      : 0;

  return {
    ...emptySummary(),
    ...summary,
    adjustedSalesTotal:
      typeof summary.adjustedSalesTotal === "number"
        ? summary.adjustedSalesTotal
        : salesTotal,
    adjustmentCashSettlementTotal:
      typeof summary.adjustmentCashSettlementTotal === "number"
        ? summary.adjustmentCashSettlementTotal
        : 0,
    adjustmentCollectionTotal:
      typeof summary.adjustmentCollectionTotal === "number"
        ? summary.adjustmentCollectionTotal
        : 0,
    adjustmentNetSettlementTotal:
      typeof summary.adjustmentNetSettlementTotal === "number"
        ? summary.adjustmentNetSettlementTotal
        : 0,
    adjustmentPaymentTotals: Array.isArray(summary.adjustmentPaymentTotals)
      ? (summary.adjustmentPaymentTotals as DailyCloseSummary["adjustmentPaymentTotals"])
      : [],
    adjustmentRefundTotal:
      typeof summary.adjustmentRefundTotal === "number"
        ? summary.adjustmentRefundTotal
        : 0,
    itemAdjustmentCount:
      typeof summary.itemAdjustmentCount === "number"
        ? summary.itemAdjustmentCount
        : 0,
    netCashMovementTotal:
      typeof summary.netCashMovementTotal === "number"
        ? summary.netCashMovementTotal
        : currentDayCashTotal,
  };
}

type DailyCloseHistoryListItem = {
  dailyCloseId: Id<"dailyClose">;
  operatingDate: string;
  actorType?: "human" | "automation";
  automationDecisionReason?: string;
  automationPolicyVersion?: string;
  automationRunId?: Id<"automationRun">;
  completedAt?: number;
  completedByUserId?: Id<"athenaUser">;
  completedByStaffProfileId?: Id<"staffProfile">;
  completedByStaffName?: string | null;
  completionApprovalProofId?: Id<"approvalProof">;
  completionApprovedByStaffProfileId?: Id<"staffProfile">;
  completionRequestedByStaffProfileId?: Id<"staffProfile">;
  completionRequestedByUserId?: Id<"athenaUser">;
  readinessStatus: DailyCloseReadinessStatus;
  blockerCount: number;
  reviewCount: number;
  carryForwardCount: number;
  readyCount: number;
  summary: Record<string, unknown>;
};

type DailyCloseCompletionAttribution = {
  actorType?: "human" | "automation";
  automationDecisionReason?: string;
  automationPolicyVersion?: string;
  automationRunId?: Id<"automationRun">;
  completedByStaffProfileId?: Id<"staffProfile">;
  completedByUserId?: Id<"athenaUser">;
  completionApprovalProofId?: Id<"approvalProof">;
  completionApprovedByStaffProfileId?: Id<"staffProfile">;
  completionRequestedByStaffProfileId?: Id<"staffProfile">;
  completionRequestedByUserId?: Id<"athenaUser">;
  policyReviewedItemKeys?: string[];
};

type CompleteDailyCloseArgs = {
  actorUserId?: Id<"athenaUser">;
  actorStaffProfileId?: Id<"staffProfile">;
  approvalProofId?: Id<"approvalProof">;
  carryForwardWorkItemIds?: Id<"operationalWorkItem">[];
  createCarryForwardWorkItems?: Array<{
    title: string;
    notes?: string;
    priority?: string;
    assignedToStaffProfileId?: Id<"staffProfile">;
    dueAt?: number;
    metadata?: Record<string, unknown>;
  }>;
  notes?: string;
  endAt?: number;
  operatingDate: string;
  organizationId?: Id<"organization">;
  reviewedItemKeys?: string[];
  startAt?: number;
  storeId: Id<"store">;
};

type CompleteDailyCloseForAutomationArgs = {
  automationDecisionReason: string;
  automationPolicyVersion: string;
  automationRunId: Id<"automationRun">;
  automationScheduleEvidence?: {
    closedAt?: number;
    evaluationAt?: number;
    openedAt?: number;
    scheduleVersion?: string;
    source: "canonical_schedule" | "compatibility_policy";
    storeScheduleId?: string;
  };
  eodAutoCompletePolicy: {
    cleanDayAutoCompleteEnabled: boolean;
    maxAbsoluteCashVariance: number;
    maxVoidedSaleCount: number;
    maxVoidedSaleTotal: number;
  };
  endAt?: number;
  operatingDate: string;
  organizationId?: Id<"organization">;
  policyReviewedItemKeys: string[];
  startAt?: number;
  storeId: Id<"store">;
  currentnessMode?: "mark_current" | "historical_record";
};

type CompleteDailyCloseResult = ApprovalCommandResult<{
  action: "completed" | "already_completed";
  dailyClose: Doc<"dailyClose">;
  automationDecisionEvidence?: AutomationDecisionEvidence;
  carryForwardWorkItems: Array<Doc<"operationalWorkItem">>;
  operationalEventId?: Id<"operationalEvent">;
}>;

type ReopenDailyCloseArgs = {
  actorUserId?: Id<"athenaUser">;
  actorStaffProfileId?: Id<"staffProfile">;
  approvalProofId?: Id<"approvalProof">;
  dailyCloseId: Id<"dailyClose">;
  organizationId?: Id<"organization">;
  reason: string;
  storeId: Id<"store">;
};

type ReopenDailyCloseResult = ApprovalCommandResult<{
  action: "reopened" | "already_reopened";
  originalDailyClose: Doc<"dailyClose">;
  reopenedDailyClose: Doc<"dailyClose">;
}>;

type ResolveDailyCloseCarryForwardArgs = {
  actorUserId?: Id<"athenaUser">;
  actorStaffProfileId?: Id<"staffProfile">;
  approvalProofId?: Id<"approvalProof">;
  businessDate: string;
  dailyCloseId: Id<"dailyClose">;
  organizationId?: Id<"organization">;
  outcome: "completed" | "cancelled";
  reason: string;
  sourceId: string;
  storeId: Id<"store">;
  workItemId: Id<"operationalWorkItem">;
};

type ResolveDailyCloseCarryForwardResult = ApprovalCommandResult<{
  action: "completed" | "cancelled";
  operationalEventId?: Id<"operationalEvent">;
  workItem: Doc<"operationalWorkItem">;
}>;

function buildDailyCloseApprovalSubject(args: {
  operatingDate: string;
  storeId: Id<"store">;
}) {
  return {
    id: `${args.storeId}:${args.operatingDate}`,
    label: `EOD Review ${args.operatingDate}`,
    type: DAILY_CLOSE_SUBJECT_TYPE,
  };
}

function buildDailyCloseCompletionApprovalRequirement(args: {
  operatingDate: string;
  storeId: Id<"store">;
}): ApprovalRequirement {
  return {
    action: DAILY_CLOSE_COMPLETION_ACTION,
    reason: "Manager approval is required to complete EOD Review.",
    requiredRole: "manager",
    selfApproval: "allowed",
    subject: buildDailyCloseApprovalSubject(args),
    copy: {
      title: "Manager approval required",
      message:
        "A manager needs to approve this end of day review before the operating day is saved.",
      primaryActionLabel: "Approve and complete",
      secondaryActionLabel: "Cancel",
    },
    resolutionModes: [
      {
        kind: "inline_manager_proof",
      },
    ],
    metadata: {
      operatingDate: args.operatingDate,
    },
  };
}

function buildDailyCloseReopenApprovalRequirement(args: {
  dailyCloseId: Id<"dailyClose">;
  operatingDate: string;
  storeId: Id<"store">;
}): ApprovalRequirement {
  return {
    action: DAILY_CLOSE_REOPEN_ACTION,
    reason: "Manager approval is required to reopen EOD Review.",
    requiredRole: "manager",
    selfApproval: "allowed",
    subject: {
      id: args.dailyCloseId,
      label: `EOD Review ${args.operatingDate}`,
      type: DAILY_CLOSE_SUBJECT_TYPE,
    },
    copy: {
      title: "Manager approval required",
      message:
        "A manager needs to approve reopening this EOD Review before the operating day can be revised.",
      primaryActionLabel: "Approve and reopen",
      secondaryActionLabel: "Cancel",
    },
    resolutionModes: [
      {
        kind: "inline_manager_proof",
      },
    ],
    metadata: {
      dailyCloseId: args.dailyCloseId,
      operatingDate: args.operatingDate,
    },
  };
}

function buildDailyCloseCarryForwardApprovalSubject(args: {
  businessDate: string;
  dailyCloseId: Id<"dailyClose">;
  outcome: "completed" | "cancelled";
  sourceId: string;
}) {
  return {
    id: `${args.dailyCloseId}:${args.sourceId}:${args.outcome}`,
    label: `Carry-forward follow-up for EOD Review ${args.businessDate}`,
    type: DAILY_CLOSE_CARRY_FORWARD_TYPE,
  };
}

function buildDailyCloseCarryForwardApprovalRequirement(args: {
  businessDate: string;
  dailyCloseId: Id<"dailyClose">;
  outcome: "completed" | "cancelled";
  sourceId: string;
}): ApprovalRequirement {
  return {
    action: DAILY_CLOSE_CARRY_FORWARD_RESOLUTION_ACTION,
    reason: "Manager approval is required to resolve carry-forward work.",
    requiredRole: "manager",
    selfApproval: "allowed",
    subject: buildDailyCloseCarryForwardApprovalSubject(args),
    copy: {
      title: "Manager approval required",
      message:
        args.outcome === "completed"
          ? "A manager needs to approve completing this carry-forward follow-up."
          : "A manager needs to approve cancelling this carry-forward follow-up.",
      primaryActionLabel:
        args.outcome === "completed"
          ? "Approve and complete"
          : "Approve and cancel",
      secondaryActionLabel: "Cancel",
    },
    resolutionModes: [
      {
        kind: "inline_manager_proof",
      },
    ],
    metadata: {
      businessDate: args.businessDate,
      dailyCloseId: args.dailyCloseId,
      outcome: args.outcome,
      sourceId: args.sourceId,
    },
  };
}

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

function safeOperatingDateRange(operatingDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(operatingDate)) {
    return null;
  }

  const startAt = Date.parse(`${operatingDate}T00:00:00.000Z`);

  if (!Number.isFinite(startAt)) {
    return null;
  }

  return {
    startAt,
    endAt: startAt + DAY_MS,
  };
}

function isValidOperatingDateRange(startAt: unknown, endAt: unknown) {
  return (
    typeof startAt === "number" &&
    typeof endAt === "number" &&
    Number.isFinite(startAt) &&
    Number.isFinite(endAt) &&
    endAt > startAt &&
    endAt - startAt <= MAX_OPERATING_DATE_RANGE_MS
  );
}

function resolveOperatingDateRange(args: {
  endAt?: number;
  operatingDate: string;
  startAt?: number;
}) {
  const dateRange = safeOperatingDateRange(args.operatingDate);

  if (!dateRange) {
    return null;
  }

  if (isValidOperatingDateRange(args.startAt, args.endAt)) {
    return {
      startAt: args.startAt!,
      endAt: args.endAt!,
    };
  }

  return dateRange;
}

function isInRange(value: unknown, startAt: number, endAt: number) {
  return typeof value === "number" && value >= startAt && value < endAt;
}

function registerSessionCloseoutOperatingAt(
  session: RegisterSessionRangeCandidate,
  closeoutApproval?: RegisterSessionCloseoutApproval,
) {
  const firstClosedRecord = session.closeoutRecords?.find(
    (record) =>
      record.type === "closed" && typeof record.occurredAt === "number",
  );
  const closeoutSubmittedAt =
    isSubmittedVarianceCloseout(session, closeoutApproval)
      ? closeoutApproval?.createdAt
      : undefined;

  return firstClosedRecord?.occurredAt ?? closeoutSubmittedAt ?? session.closedAt;
}

function isSubmittedVarianceCloseout(
  session: RegisterSessionRangeCandidate,
  closeoutApproval?: RegisterSessionCloseoutApproval,
) {
  return (
    session.status === "closing" &&
    typeof session.countedCash === "number" &&
    closeoutApproval?.requestType === "variance_review"
  );
}

function registerSessionLabel(
  session: Pick<Doc<"registerSession">, "registerNumber">,
) {
  return session.registerNumber
    ? `Register ${session.registerNumber}`
    : "Register";
}

function registerMetadataLabel(
  terminalLabel: string | undefined,
  registerLabel: string | undefined,
) {
  if (!registerLabel) return undefined;

  return terminalLabel
    ?.toLocaleLowerCase()
    .includes(registerLabel.toLocaleLowerCase())
    ? undefined
    : registerLabel;
}

function formatPaymentMethodLabel(method: string) {
  return method
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function transactionPaymentSummary(
  transaction: Pick<Doc<"posTransaction">, "paymentMethod" | "payments">,
) {
  if (transaction.payments.length > 0) {
    return Array.from(
      new Set(
        transaction.payments.map((payment) =>
          formatPaymentMethodLabel(payment.method),
        ),
      ),
    ).join(", ");
  }

  return transaction.paymentMethod
    ? formatPaymentMethodLabel(transaction.paymentMethod)
    : undefined;
}

function nonZeroVarianceMetadata(variance?: number) {
  return typeof variance === "number" && variance !== 0 ? { variance } : {};
}

function approvalRequestTypeLabel(requestType: string) {
  if (requestType === "payment_method_correction") {
    return "Payment method correction";
  }

  if (requestType === "variance_review") {
    return "Register closeout variance review";
  }

  if (requestType === "inventory_adjustment_review") {
    return "Stock adjustment review";
  }

  return formatPaymentMethodLabel(requestType);
}

async function buildTerminalLabelsById(
  ctx: Pick<QueryCtx, "db">,
  terminalIds: Array<Id<"posTerminal"> | null | undefined>,
) {
  const uniqueTerminalIds = Array.from(
    new Set(terminalIds.filter(Boolean) as Id<"posTerminal">[]),
  );
  const terminalEntries = await Promise.all(
    uniqueTerminalIds.map(async (terminalId) => {
      const terminal = await ctx.db.get("posTerminal", terminalId);
      return [
        terminalId,
        trimOptional(terminal?.displayName) ?? terminalId,
      ] as const;
    }),
  );

  return new Map(terminalEntries);
}

async function buildStaffNamesById(
  ctx: Pick<QueryCtx, "db">,
  staffProfileIds: Array<Id<"staffProfile"> | null | undefined>,
) {
  const uniqueStaffProfileIds = Array.from(
    new Set(staffProfileIds.filter(Boolean) as Id<"staffProfile">[]),
  );
  const staffEntries = await Promise.all(
    uniqueStaffProfileIds.map(async (staffProfileId) => {
      const staffProfile = await ctx.db.get("staffProfile", staffProfileId);
      return [
        staffProfileId,
        trimOptional(staffProfile?.fullName) ?? "Unknown operator",
      ] as const;
    }),
  );

  return new Map(staffEntries);
}

async function buildRegisterSessionsById(
  ctx: Pick<QueryCtx, "db">,
  registerSessionIds: Array<Id<"registerSession"> | null | undefined>,
) {
  const uniqueRegisterSessionIds = Array.from(
    new Set(registerSessionIds.filter(Boolean) as Id<"registerSession">[]),
  );
  const registerSessionEntries = await Promise.all(
    uniqueRegisterSessionIds.map(async (registerSessionId) => {
      const registerSession = await ctx.db.get(
        "registerSession",
        registerSessionId,
      );
      return [registerSessionId, registerSession] as const;
    }),
  );

  return new Map(registerSessionEntries);
}

async function buildApprovalRequestsById(
  ctx: Pick<QueryCtx, "db">,
  approvalRequestIds: Array<Id<"approvalRequest"> | null | undefined>,
) {
  const uniqueApprovalRequestIds = Array.from(
    new Set(approvalRequestIds.filter(Boolean) as Id<"approvalRequest">[]),
  );
  const approvalRequestEntries = await Promise.all(
    uniqueApprovalRequestIds.map(async (approvalRequestId) => {
      const approvalRequest = await ctx.db.get(
        "approvalRequest",
        approvalRequestId,
      );
      return [approvalRequestId, approvalRequest] as const;
    }),
  );

  return new Map(approvalRequestEntries);
}

function closeoutApprovalForRegisterSession(
  session: Pick<Doc<"registerSession">, "managerApprovalRequestId">,
  approvalRequestsById: Map<Id<"approvalRequest">, Doc<"approvalRequest"> | null>,
) {
  return session.managerApprovalRequestId
    ? (approvalRequestsById.get(session.managerApprovalRequestId) ?? undefined)
    : undefined;
}

async function filterRegisterSessionsBelongingToRange<
  TSession extends RegisterSessionRangeCandidate,
>(
  ctx: Pick<QueryCtx, "db">,
  sessions: TSession[],
  range: DailyCloseRange,
) {
  const approvalRequestsById = await buildApprovalRequestsById(
    ctx,
    sessions.map((session) => session.managerApprovalRequestId),
  );

  return sessions.filter((session) =>
    registerSessionBelongsToRange(
      session,
      range,
      closeoutApprovalForRegisterSession(session, approvalRequestsById),
    ),
  );
}

async function buildExpenseSessionsById(
  ctx: Pick<QueryCtx, "db">,
  expenseSessionIds: Array<Id<"expenseSession"> | null | undefined>,
) {
  const uniqueExpenseSessionIds = Array.from(
    new Set(expenseSessionIds.filter(Boolean) as Id<"expenseSession">[]),
  );
  const expenseSessionEntries = await Promise.all(
    uniqueExpenseSessionIds.map(async (expenseSessionId) => {
      const expenseSession = await ctx.db.get(
        "expenseSession",
        expenseSessionId,
      );
      return [expenseSessionId, expenseSession] as const;
    }),
  );

  return new Map(expenseSessionEntries);
}

function asCarryForwardItem(
  workItem: Doc<"operationalWorkItem">,
  fallback?: {
    businessDate?: string;
    dailyCloseId?: Id<"dailyClose">;
    sourceId?: string;
  },
): DailyCloseItem {
  const businessDate =
    carryForwardBusinessDate(workItem) ?? fallback?.businessDate;
  const dailyCloseId =
    stringFromMetadata(workItem.metadata, "dailyCloseId") ??
    fallback?.dailyCloseId;
  const sourceId = fallback?.sourceId ?? carryForwardSourceId(workItem);
  const carryForwardResolution =
    workItem.type === DAILY_CLOSE_CARRY_FORWARD_TYPE &&
    businessDate &&
    dailyCloseId &&
    sourceId
      ? {
          businessDate,
          dailyCloseId: dailyCloseId as Id<"dailyClose">,
          sourceId,
          workItemId: workItem._id,
        }
      : undefined;

  return {
    key: `operational_work_item:${workItem._id}:carry_forward`,
    severity: "carry_forward",
    category: "open_work",
    title: workItem.title,
    message:
      "Open operational work will carry forward after the end of day review.",
    subject: {
      type: "operational_work_item",
      id: workItem._id,
      label: workItem.title,
    },
    metadata: {
      priority: workItem.priority,
      status: workItem.status,
      type: workItem.type,
    },
    ...(carryForwardResolution ? { carryForwardResolution } : {}),
  };
}

async function patchDailyCloseCarryForwardWorkItemMetadata(
  ctx: MutationCtx,
  args: {
    dailyCloseId: Id<"dailyClose">;
    operatingDate: string;
    workItems: Array<Doc<"operationalWorkItem">>;
  },
) {
  for (const workItem of args.workItems) {
    if (workItem.type !== DAILY_CLOSE_CARRY_FORWARD_TYPE) {
      continue;
    }

    await ctx.db.patch("operationalWorkItem", workItem._id, {
      metadata: {
        ...(workItem.metadata ?? {}),
        businessDate:
          carryForwardBusinessDate(workItem) ?? args.operatingDate,
        carryForwardSourceId: carryForwardSourceId(workItem),
        dailyCloseId: args.dailyCloseId,
        source: DAILY_CLOSE_SUBJECT_TYPE,
      },
    });
  }
}

async function getStore(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
): Promise<Doc<"store"> | null> {
  return ctx.db.get("store", storeId);
}

async function getDailyCloseForDate(
  ctx: Pick<QueryCtx, "db">,
  args: {
    operatingDate: string;
    storeId: Id<"store">;
  },
) {
  const activeClose = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_operatingDate_lifecycleStatus", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("operatingDate", args.operatingDate)
        .eq("lifecycleStatus", "active"),
    )
    .first();

  if (activeClose) {
    return activeClose;
  }

  const legacyClose = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", args.storeId).eq("operatingDate", args.operatingDate),
    )
    .first();

  if (
    legacyClose &&
    (legacyClose.lifecycleStatus === undefined ||
      legacyClose.lifecycleStatus === "active")
  ) {
    return legacyClose;
  }

  return null;
}

async function getPriorCompletedDailyClose(
  ctx: Pick<QueryCtx, "db">,
  args: {
    operatingDate: string;
    storeId: Id<"store">;
  },
) {
  const completedCloses = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_status_operatingDate", (q) =>
      q.eq("storeId", args.storeId).eq("status", "completed"),
    )
    .order("desc")
    .take(DAILY_CLOSE_QUERY_LIMIT);

  return (
    completedCloses.find(
      (dailyClose) =>
        dailyClose.operatingDate < args.operatingDate &&
        (dailyClose.lifecycleStatus === undefined ||
          dailyClose.lifecycleStatus === "active"),
    ) ?? null
  );
}

async function listRegisterSessionsForDailyClose(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    operatingDate: string;
    startAt: number;
    storeId: Id<"store">;
  },
) {
  const range = { startAt: args.startAt, endAt: args.endAt };
  const activeIndexedSessionPages = await Promise.all(
    ACTIVE_REGISTER_STATUSES.map((status) =>
      ctx.db
        .query("registerSession")
        .withIndex("by_storeId_status_openedOperatingDate", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("status", status)
            .lte("openedOperatingDate", args.operatingDate),
        )
        .order("desc")
        .take(REGISTER_SESSION_DAILY_CLOSE_SOURCE_LIMIT),
    ),
  );
  const activeMissingDateSessionPages = await Promise.all(
    ACTIVE_REGISTER_STATUSES.map((status) =>
      ctx.db
        .query("registerSession")
        .withIndex("by_storeId_status_openedOperatingDate", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("status", status)
            .eq("openedOperatingDate", undefined),
        )
        .take(REGISTER_SESSION_DAILY_CLOSE_SOURCE_LIMIT),
    ),
  );
  const reviewOnlyIndexedSessionPages = await Promise.all(
    REVIEW_ONLY_REGISTER_CLOSEOUT_STATUSES.map((status) =>
      ctx.db
        .query("registerSession")
        .withIndex("by_storeId_status_closeoutOperatingDate", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("status", status)
            .eq("closeoutOperatingDate", args.operatingDate),
        )
        .take(REGISTER_SESSION_DAILY_CLOSE_SOURCE_LIMIT),
    ),
  );
  const reviewOnlyMissingDateSessionPages = await Promise.all(
    REVIEW_ONLY_REGISTER_CLOSEOUT_STATUSES.map((status) =>
      ctx.db
        .query("registerSession")
        .withIndex("by_storeId_status_closeoutOperatingDate", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("status", status)
            .eq("closeoutOperatingDate", undefined),
        )
        .take(REGISTER_SESSION_DAILY_CLOSE_SOURCE_LIMIT),
    ),
  );
  const indexedClosedSessions = await ctx.db
    .query("registerSession")
    .withIndex("by_storeId_status_closeoutOperatingDate", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "closed")
        .eq("closeoutOperatingDate", args.operatingDate),
    )
    .take(REGISTER_SESSION_DAILY_CLOSE_SOURCE_LIMIT);
  const legacyClosedSessionCandidates = await ctx.db
    .query("registerSession")
    .withIndex("by_storeId_status_closeoutOperatingDate", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "closed")
        .eq("closeoutOperatingDate", undefined),
    )
    .take(REGISTER_SESSION_DAILY_CLOSE_SOURCE_LIMIT);
  const closedSessionsById = new Map<Id<"registerSession">, Doc<"registerSession">>();

  indexedClosedSessions.forEach((session) =>
    closedSessionsById.set(session._id, session),
  );
  legacyClosedSessionCandidates
    .filter(
      (session) =>
        !session.closeoutOperatingDate &&
        isInRange(
          registerSessionCloseoutOperatingAt(session),
          args.startAt,
          args.endAt,
        ),
    )
    .forEach((session) => closedSessionsById.set(session._id, session));
  const activeSessionsById = new Map<Id<"registerSession">, Doc<"registerSession">>();
  const reviewOnlySessionsById = new Map<Id<"registerSession">, Doc<"registerSession">>();

  activeIndexedSessionPages
    .flat()
    .filter((session) => registerSessionIntersectsRange(session, range))
    .forEach((session) => activeSessionsById.set(session._id, session));
  activeMissingDateSessionPages
    .flat()
    .filter((session) => registerSessionBelongsToRange(session, range))
    .forEach((session) => activeSessionsById.set(session._id, session));
  reviewOnlyIndexedSessionPages.flat().forEach((session) =>
    reviewOnlySessionsById.set(session._id, session),
  );
  reviewOnlyMissingDateSessionPages
    .flat()
    .filter((session) => registerSessionBelongsToRange(session, range))
    .forEach((session) => reviewOnlySessionsById.set(session._id, session));

  return {
    activeSessions: Array.from(activeSessionsById.values()),
    reviewOnlySessions: Array.from(reviewOnlySessionsById.values()),
    closedSessions: Array.from(closedSessionsById.values()),
    sourceCompleteness: completeSourceCompleteness([
      ...ACTIVE_REGISTER_STATUSES.map((status, index) =>
        sourceCompletenessEntry({
          source: "register_session",
          readMode: "by_storeId_status_openedOperatingDate",
          recordCount: activeIndexedSessionPages[index].length,
          limit: REGISTER_SESSION_DAILY_CLOSE_SOURCE_LIMIT,
          range,
          reason: "register_session_active_opened_date_cap_reached",
          statuses: [status],
        }),
      ),
      ...ACTIVE_REGISTER_STATUSES.map((status, index) =>
        sourceCompletenessEntry({
          source: "register_session",
          readMode: "by_storeId_status_openedOperatingDate_missing",
          recordCount: activeMissingDateSessionPages[index].length,
          limit: REGISTER_SESSION_DAILY_CLOSE_SOURCE_LIMIT,
          range,
          reason: "register_session_active_missing_opened_date_cap_reached",
          statuses: [status],
        }),
      ),
      ...REVIEW_ONLY_REGISTER_CLOSEOUT_STATUSES.map((status, index) =>
        sourceCompletenessEntry({
          source: "register_session",
          readMode: "by_storeId_status_closeoutOperatingDate",
          recordCount: reviewOnlyIndexedSessionPages[index].length,
          limit: REGISTER_SESSION_DAILY_CLOSE_SOURCE_LIMIT,
          range,
          reason: "register_session_review_closeout_date_cap_reached",
          statuses: [status],
        }),
      ),
      ...REVIEW_ONLY_REGISTER_CLOSEOUT_STATUSES.map((status, index) =>
        sourceCompletenessEntry({
          source: "register_session",
          readMode: "by_storeId_status_closeoutOperatingDate_missing",
          recordCount: reviewOnlyMissingDateSessionPages[index].length,
          limit: REGISTER_SESSION_DAILY_CLOSE_SOURCE_LIMIT,
          range,
          reason: "register_session_review_missing_closeout_date_cap_reached",
          statuses: [status],
        }),
      ),
      sourceCompletenessEntry({
        source: "register_session",
        readMode: "by_storeId_status_closeoutOperatingDate",
        recordCount: indexedClosedSessions.length,
        limit: REGISTER_SESSION_DAILY_CLOSE_SOURCE_LIMIT,
        range,
        reason: "register_session_closed_date_cap_reached",
        statuses: ["closed"],
      }),
      sourceCompletenessEntry({
        source: "register_session",
        readMode: "by_storeId_status_closeoutOperatingDate_missing",
        recordCount: legacyClosedSessionCandidates.length,
        limit: REGISTER_SESSION_DAILY_CLOSE_SOURCE_LIMIT,
        range,
        reason: "register_session_legacy_closed_fallback_cap_reached",
        statuses: ["closed"],
      }),
    ]),
  };
}

function registerSessionIntersectsRange(
  session: Pick<Doc<"registerSession">, "closedAt" | "openedAt">,
  range: DailyCloseRange,
) {
  return (
    session.openedAt < range.endAt &&
    (session.closedAt ?? Infinity) >= range.startAt
  );
}

function registerSessionBelongsToRange(
  session: RegisterSessionRangeCandidate,
  range: DailyCloseRange,
  closeoutApproval?: RegisterSessionCloseoutApproval,
) {
  const closeoutOperatingAt = registerSessionCloseoutOperatingAt(
    session,
    closeoutApproval,
  );

  if (typeof closeoutOperatingAt === "number") {
    return isInRange(closeoutOperatingAt, range.startAt, range.endAt);
  }

  return registerSessionIntersectsRange(session, range);
}

function posSessionIntersectsRange(
  session: Pick<
    Doc<"posSession">,
    "createdAt" | "expiresAt" | "heldAt" | "resumedAt"
  >,
  range: { endAt: number; startAt: number },
) {
  const startsAt = Math.min(
    session.createdAt,
    session.heldAt ?? session.createdAt,
    session.resumedAt ?? session.createdAt,
  );

  return startsAt < range.endAt && session.expiresAt >= range.startAt;
}

async function approvalBelongsToRange(
  ctx: Pick<QueryCtx, "db">,
  approval: Doc<"approvalRequest">,
  range: { endAt: number; startAt: number },
) {
  const transactionId =
    approval.subjectType === "pos_transaction"
      ? (approval.subjectId as Id<"posTransaction">)
      : typeof approval.metadata?.transactionId === "string"
        ? (approval.metadata.transactionId as Id<"posTransaction">)
        : null;

  if (transactionId) {
    const transaction = await ctx.db.get("posTransaction", transactionId);

    if (typeof transaction?.completedAt === "number") {
      return isInRange(transaction.completedAt, range.startAt, range.endAt);
    }
  }

  const registerSessionId =
    approval.registerSessionId ??
    (approval.subjectType === "register_session"
      ? (approval.subjectId as Id<"registerSession">)
      : null);

  if (registerSessionId) {
    const registerSession = await ctx.db.get(
      "registerSession",
      registerSessionId,
    );

    if (registerSession) {
      return registerSessionBelongsToRange(registerSession, range, approval);
    }
  }

  return isInRange(approval.createdAt, range.startAt, range.endAt);
}

async function listPendingCloseoutApprovals(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    storeId: Id<"store">;
  },
): Promise<DailyCloseSourceRead<Doc<"approvalRequest">>> {
  const range = { startAt: args.startAt, endAt: args.endAt };
  const approvals = await ctx.db
    .query("approvalRequest")
    .withIndex("by_storeId_status", (q) =>
      q.eq("storeId", args.storeId).eq("status", "pending"),
    )
    .take(DAILY_CLOSE_QUERY_LIMIT);

  const closeoutApprovals = approvals.filter(
    (approval) =>
      approval.registerSessionId ||
      approval.subjectType === "register_session" ||
      approval.requestType === "variance_review",
  );

  const scopedApprovals = await Promise.all(
    closeoutApprovals.map(async (approval) => ({
      approval,
      belongsToRange: await approvalBelongsToRange(ctx, approval, args),
    })),
  );

  return {
    rows: scopedApprovals
      .filter(({ belongsToRange }) => belongsToRange)
      .map(({ approval }) => approval),
    completeness: sourceCompletenessEntry({
      source: "approval_request",
      readMode: "by_storeId_status",
      recordCount: approvals.length,
      limit: DAILY_CLOSE_QUERY_LIMIT,
      range,
      reason: "approval_request_source_cap_reached",
      statuses: ["pending"],
    }),
  };
}

async function listOpenPosSessions(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    storeId: Id<"store">;
  },
): Promise<DailyCloseSourceRead<Doc<"posSession">>> {
  const range = { startAt: args.startAt, endAt: args.endAt };
  const now = Date.now();
  const sessionPages = await Promise.all(
    OPEN_POS_SESSION_STATUSES.map((status) =>
      ctx.db
        .query("posSession")
        .withIndex("by_storeId_and_status", (q) =>
          q.eq("storeId", args.storeId).eq("status", status),
        )
        .take(DAILY_CLOSE_QUERY_LIMIT),
    ),
  );

  return {
    rows: sessionPages.flat().filter(
      (session) =>
        session.expiresAt >= now && posSessionIntersectsRange(session, args),
    ),
    completeness: sourceCompletenessEntry({
      source: "pos_session",
      complete: sessionPages.every((page) => page.length < DAILY_CLOSE_QUERY_LIMIT),
      readMode: "by_storeId_and_status",
      recordCount: sessionPages.reduce((count, page) => count + page.length, 0),
      limit: DAILY_CLOSE_QUERY_LIMIT,
      range,
      reason: "pos_session_source_cap_reached",
      statuses: [...OPEN_POS_SESSION_STATUSES],
    }),
  };
}

async function listOpenOperationalWorkItems(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
): Promise<DailyCloseSourceRead<Doc<"operationalWorkItem">>> {
  const workItems = await Promise.all(
    OPEN_OPERATIONAL_WORK_ITEM_STATUSES.map((status) =>
      ctx.db
        .query("operationalWorkItem")
        .withIndex("by_storeId_status", (q) =>
          q.eq("storeId", storeId).eq("status", status),
        )
        .take(DAILY_CLOSE_QUERY_LIMIT),
    ),
  );

  return {
    rows: workItems.flat(),
    completeness: sourceCompletenessEntry({
      source: "operational_work_item",
      complete: workItems.every((page) => page.length < DAILY_CLOSE_QUERY_LIMIT),
      readMode: "by_storeId_status",
      recordCount: workItems.reduce((count, page) => count + page.length, 0),
      limit: DAILY_CLOSE_QUERY_LIMIT,
      reason: "operational_work_item_source_cap_reached",
      statuses: [...OPEN_OPERATIONAL_WORK_ITEM_STATUSES],
    }),
  };
}

async function readCappedSource<T>(args: {
  limit: number;
  query: Promise<T[]>;
  range: DailyCloseRange;
  readMode: string;
  source: string;
  statuses?: string[];
}): Promise<DailyCloseSourceRead<T>> {
  const rows = await args.query;

  return {
    rows,
    completeness: sourceCompletenessEntry({
      source: args.source,
      readMode: args.readMode,
      recordCount: rows.length,
      limit: args.limit,
      range: args.range,
      reason: `${args.source}_source_cap_reached`,
      statuses: args.statuses,
    }),
  };
}

async function listTransactionsForDay(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    status: string;
    storeId: Id<"store">;
  },
): Promise<DailyCloseSourceRead<Doc<"posTransaction">>> {
  const range = { startAt: args.startAt, endAt: args.endAt };

  return readCappedSource({
    source: "pos_transaction",
    readMode: "by_storeId_status_completedAt",
    limit: DAILY_CLOSE_QUERY_LIMIT,
    range,
    statuses: [args.status],
    query: ctx.db
      .query("posTransaction")
      .withIndex("by_storeId_status_completedAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", args.status)
          .gte("completedAt", args.startAt)
          .lt("completedAt", args.endAt),
      )
      .take(DAILY_CLOSE_QUERY_LIMIT),
  });
}

async function listExpensesForDay(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    storeId: Id<"store">;
  },
): Promise<DailyCloseSourceRead<Doc<"expenseTransaction">>> {
  const range = { startAt: args.startAt, endAt: args.endAt };

  return readCappedSource({
    source: "expense_transaction",
    readMode: "by_storeId_status_completedAt",
    limit: DAILY_CLOSE_QUERY_LIMIT,
    range,
    statuses: ["completed"],
    query: ctx.db
      .query("expenseTransaction")
      .withIndex("by_storeId_status_completedAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", "completed")
          .gte("completedAt", args.startAt)
          .lt("completedAt", args.endAt),
      )
      .take(DAILY_CLOSE_QUERY_LIMIT),
  });
}

async function buildTransactionItemCountsByTransactionId(
  ctx: Pick<QueryCtx, "db">,
  transactions: Array<Doc<"posTransaction">>,
) {
  const entries = await Promise.all(
    transactions.map(async (transaction) => {
      const items = await ctx.db
        .query("posTransactionItem")
        .withIndex("by_transactionId", (q) =>
          q.eq("transactionId", transaction._id),
        )
        .take(DAILY_CLOSE_QUERY_LIMIT);
      const itemCount = items.reduce(
        (sum, item) =>
          sum +
          (typeof item.quantity === "number" && Number.isFinite(item.quantity)
            ? item.quantity
            : 0),
        0,
      );

      return [String(transaction._id), itemCount] as const;
    }),
  );

  return new Map(entries);
}

async function buildExpenseTransactionItemCountsByTransactionId(
  ctx: Pick<QueryCtx, "db">,
  transactions: Array<Doc<"expenseTransaction">>,
) {
  const entries = await Promise.all(
    transactions.map(async (transaction) => {
      const items = await ctx.db
        .query("expenseTransactionItem")
        .withIndex("by_transactionId", (q) =>
          q.eq("transactionId", transaction._id),
        )
        .take(DAILY_CLOSE_QUERY_LIMIT);
      const itemCount = items.reduce(
        (sum, item) =>
          sum +
          (typeof item.quantity === "number" && Number.isFinite(item.quantity)
            ? item.quantity
            : 0),
        0,
      );

      return [String(transaction._id), itemCount] as const;
    }),
  );

  return new Map(entries);
}

async function listDepositsForDay(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    storeId: Id<"store">;
  },
): Promise<DailyCloseSourceRead<Doc<"paymentAllocation">>> {
  const range = { startAt: args.startAt, endAt: args.endAt };
  const allocations = await ctx.db
    .query("paymentAllocation")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .take(DAILY_CLOSE_QUERY_LIMIT);

  return {
    rows: allocations.filter(
      (allocation) =>
        allocation.allocationType === "cash_deposit" &&
        allocation.direction === "out" &&
        allocation.status === "recorded" &&
        isInRange(allocation.recordedAt, args.startAt, args.endAt),
    ),
    completeness: sourceCompletenessEntry({
      source: "payment_allocation",
      readMode: "by_storeId",
      recordCount: allocations.length,
      limit: DAILY_CLOSE_QUERY_LIMIT,
      range,
      reason: "payment_allocation_source_cap_reached",
      statuses: ["recorded"],
    }),
  };
}

type PosTransactionAdjustmentReportRow = {
  _id: string;
  appliedAt?: number;
  completedAt?: number;
  correctedTotal?: number;
  createdAt?: number;
  deltaTotal?: number;
  originalTotal?: number;
  posTransactionId?: Id<"posTransaction"> | string;
  registerSessionId?: Id<"registerSession"> | string;
  settlementAmount?: number;
  settlementDirection?: string;
  settlementMethod?: string;
  status?: string;
  storeId?: Id<"store"> | string;
  totalDelta?: number;
  transactionId?: Id<"posTransaction"> | string;
  transactionNumber?: string;
};

type AppliedTransactionAdjustment = PosTransactionAdjustmentReportRow & {
  appliedAt: number;
  signedSalesDelta: number;
  signedSettlementAmount: number;
  transactionId: string;
};

type AdjustmentReportTotals = {
  adjustedSalesTotal: number;
  adjustmentCashSettlementTotal: number;
  adjustmentCollectionTotal: number;
  adjustmentNetSettlementTotal: number;
  adjustmentPaymentTotals: DailyCloseSummary["adjustmentPaymentTotals"];
  adjustmentRefundTotal: number;
  itemAdjustmentCount: number;
  netCashMovementTotal: number;
};

const APPLIED_TRANSACTION_ADJUSTMENT_STATUSES = new Set([
  "applied",
  "completed",
  "recorded",
  "settled",
]);

function adjustmentAppliedAt(
  adjustment: PosTransactionAdjustmentReportRow,
): number | null {
  const value =
    adjustment.appliedAt ?? adjustment.completedAt ?? adjustment.createdAt;

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function adjustmentTransactionId(
  adjustment: PosTransactionAdjustmentReportRow,
) {
  return String(adjustment.posTransactionId ?? adjustment.transactionId ?? "");
}

function adjustmentSalesDelta(adjustment: PosTransactionAdjustmentReportRow) {
  if (
    typeof adjustment.deltaTotal === "number" &&
    Number.isFinite(adjustment.deltaTotal)
  ) {
    return adjustment.deltaTotal;
  }

  if (
    typeof adjustment.totalDelta === "number" &&
    Number.isFinite(adjustment.totalDelta)
  ) {
    return adjustment.totalDelta;
  }

  if (
    typeof adjustment.correctedTotal === "number" &&
    Number.isFinite(adjustment.correctedTotal) &&
    typeof adjustment.originalTotal === "number" &&
    Number.isFinite(adjustment.originalTotal)
  ) {
    return adjustment.correctedTotal - adjustment.originalTotal;
  }

  return 0;
}

function adjustmentSettlementAmount(
  adjustment: PosTransactionAdjustmentReportRow,
) {
  const rawAmount =
    typeof adjustment.settlementAmount === "number" &&
    Number.isFinite(adjustment.settlementAmount)
      ? Math.abs(adjustment.settlementAmount)
      : Math.abs(adjustmentSalesDelta(adjustment));
  const direction = adjustment.settlementDirection;

  if (
    direction === "refund" ||
    direction === "out" ||
    direction === "refund_due"
  ) {
    return -rawAmount;
  }

  if (
    direction === "collect" ||
    direction === "collection" ||
    direction === "in" ||
    direction === "balance_due"
  ) {
    return rawAmount;
  }

  return adjustmentSalesDelta(adjustment);
}

async function readAppliedTransactionAdjustmentsForDay(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    storeId: Id<"store">;
  },
): Promise<DailyCloseSourceRead<AppliedTransactionAdjustment>> {
  const range = { startAt: args.startAt, endAt: args.endAt };
  const adjustments = (await ctx.db
    .query("posTransactionAdjustment")
    .withIndex("by_storeId_status_appliedAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "applied")
        .gte("appliedAt", args.startAt)
        .lt("appliedAt", args.endAt),
    )
    .take(DAILY_CLOSE_QUERY_LIMIT)) as PosTransactionAdjustmentReportRow[];

  return {
    rows: adjustments.flatMap((adjustment) => {
      const status = adjustment.status ?? "";
      const appliedAt = adjustmentAppliedAt(adjustment);
      const transactionId = adjustmentTransactionId(adjustment);

      if (
        !APPLIED_TRANSACTION_ADJUSTMENT_STATUSES.has(status) ||
        appliedAt === null ||
        !transactionId
      ) {
        return [];
      }

      return [
        {
          ...adjustment,
          appliedAt,
          signedSalesDelta: adjustmentSalesDelta(adjustment),
          signedSettlementAmount: adjustmentSettlementAmount(adjustment),
          transactionId,
        },
      ];
    }),
    completeness: sourceCompletenessEntry({
      source: "pos_transaction_adjustment",
      readMode: "by_storeId_status_appliedAt",
      recordCount: adjustments.length,
      limit: DAILY_CLOSE_QUERY_LIMIT,
      range,
      reason: "pos_transaction_adjustment_source_cap_reached",
      statuses: ["applied"],
    }),
  };
}

export async function listAppliedTransactionAdjustmentsForDay(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    storeId: Id<"store">;
  },
): Promise<AppliedTransactionAdjustment[]> {
  const read = await readAppliedTransactionAdjustmentsForDay(ctx, args);

  return read.rows;
}

function buildAdjustmentPaymentTotals(
  adjustments: AppliedTransactionAdjustment[],
) {
  const totals = new Map<
    string,
    {
      amount: number;
      transactionCount: number;
    }
  >();

  adjustments.forEach((adjustment) => {
    if (!adjustment.settlementMethod || adjustment.signedSettlementAmount === 0) {
      return;
    }

    const existing = totals.get(adjustment.settlementMethod) ?? {
      amount: 0,
      transactionCount: 0,
    };

    totals.set(adjustment.settlementMethod, {
      amount: existing.amount + adjustment.signedSettlementAmount,
      transactionCount: existing.transactionCount + 1,
    });
  });

  return Array.from(totals.entries()).map(([method, total]) => ({
    method,
    ...total,
  }));
}

export function buildAdjustmentReportTotals(args: {
  appliedAdjustments: AppliedTransactionAdjustment[];
  completedTransactions: Array<Doc<"posTransaction">>;
  currentDayCashTotal: number;
  salesTotal: number;
}): AdjustmentReportTotals {
  const completedTransactionIds = new Set(
    args.completedTransactions.map((transaction) => String(transaction._id)),
  );
  const salesAdjustments = args.appliedAdjustments.filter((adjustment) =>
    completedTransactionIds.has(adjustment.transactionId),
  );
  const adjustedSalesTotal =
    args.salesTotal +
    salesAdjustments.reduce(
      (sum, adjustment) => sum + adjustment.signedSalesDelta,
      0,
    );
  const adjustmentNetSettlementTotal = args.appliedAdjustments.reduce(
    (sum, adjustment) => sum + adjustment.signedSettlementAmount,
    0,
  );
  const adjustmentCashSettlementTotal = args.appliedAdjustments.reduce(
    (sum, adjustment) =>
      adjustment.settlementMethod === "cash"
        ? sum + adjustment.signedSettlementAmount
        : sum,
    0,
  );

  return {
    adjustedSalesTotal,
    adjustmentCashSettlementTotal,
    adjustmentCollectionTotal: args.appliedAdjustments.reduce(
      (sum, adjustment) =>
        adjustment.signedSettlementAmount > 0
          ? sum + adjustment.signedSettlementAmount
          : sum,
      0,
    ),
    adjustmentNetSettlementTotal,
    adjustmentPaymentTotals: buildAdjustmentPaymentTotals(
      args.appliedAdjustments,
    ),
    adjustmentRefundTotal: args.appliedAdjustments.reduce(
      (sum, adjustment) =>
        adjustment.signedSettlementAmount < 0
          ? sum + Math.abs(adjustment.signedSettlementAmount)
          : sum,
      0,
    ),
    itemAdjustmentCount: args.appliedAdjustments.length,
    netCashMovementTotal:
      args.currentDayCashTotal + adjustmentCashSettlementTotal,
  };
}

function cashDeltasByRegisterSessionId(
  transactions: Array<Doc<"posTransaction">>,
) {
  const totals = new Map<Id<"registerSession">, number>();

  transactions.forEach((transaction) => {
    if (!transaction.registerSessionId) return;

    totals.set(
      transaction.registerSessionId,
      (totals.get(transaction.registerSessionId) ?? 0) +
        transactionCashDelta(transaction),
    );
  });

  return totals;
}

function buildReadiness(args: {
  blockers: DailyCloseItem[];
  carryForwardItems: DailyCloseItem[];
  readyItems: DailyCloseItem[];
  reviewItems: DailyCloseItem[];
}): DailyCloseReadiness {
  return {
    status:
      args.blockers.length > 0
        ? "blocked"
        : args.reviewItems.length > 0
          ? "needs_review"
          : "ready",
    blockerCount: args.blockers.length,
    reviewCount: args.reviewItems.length,
    carryForwardCount: args.carryForwardItems.length,
    readyCount: args.readyItems.length,
  };
}

function uniqueSourceSubjects(items: DailyCloseItem[]) {
  const subjects = new Map<string, DailyCloseItem["subject"]>();

  for (const item of items) {
    subjects.set(`${item.subject.type}:${item.subject.id}`, item.subject);
  }

  return Array.from(subjects.values());
}

function uniqueDailyCloseItems(items: DailyCloseItem[]) {
  const itemByKey = new Map<string, DailyCloseItem>();

  items.forEach((item) => itemByKey.set(item.key, item));

  return Array.from(itemByKey.values());
}

function buildDailyCloseReportSnapshot(args: {
  actorType?: "human" | "automation";
  automationDecisionReason?: string;
  automationPolicyVersion?: string;
  automationRunId?: Id<"automationRun">;
  carryForwardWorkItemIds: Id<"operationalWorkItem">[];
  carryForwardWorkItems: Array<Doc<"operationalWorkItem">>;
  completedAt: number;
  completedByStaffProfileId?: Id<"staffProfile">;
  completedByUserId?: Id<"athenaUser">;
  completionApprovalProofId?: Id<"approvalProof">;
  completionApprovedByStaffProfileId?: Id<"staffProfile">;
  completionRequestedByStaffProfileId?: Id<"staffProfile">;
  completionRequestedByUserId?: Id<"athenaUser">;
  currentnessMode?: "mark_current" | "historical_record";
  dailyCloseId?: Id<"dailyClose">;
  notes?: string;
  policyReviewedItemKeys?: string[];
  readiness: DailyCloseReadiness;
  reviewedItemKeys?: string[];
  snapshot: DailyCloseSnapshot;
  summary: Record<string, unknown>;
}): DailyCloseReportSnapshot {
  return {
    closeMetadata: {
      operatingDate: args.snapshot.operatingDate,
      storeId: args.snapshot.storeId,
      organizationId: args.snapshot.organizationId!,
      startAt: args.snapshot.startAt,
      endAt: args.snapshot.endAt,
      completedAt: args.completedAt,
      completedByUserId: args.completedByUserId,
      completedByStaffProfileId: args.completedByStaffProfileId,
      completionApprovalProofId: args.completionApprovalProofId,
      completionApprovedByStaffProfileId:
        args.completionApprovedByStaffProfileId,
      completionRequestedByStaffProfileId:
        args.completionRequestedByStaffProfileId,
      completionRequestedByUserId: args.completionRequestedByUserId,
      actorType: args.actorType,
      automationRunId: args.automationRunId,
      automationPolicyVersion: args.automationPolicyVersion,
      automationDecisionReason: args.automationDecisionReason,
      currentnessMode: args.currentnessMode,
      policyReviewedItemKeys: args.policyReviewedItemKeys,
      notes: args.notes,
      reviewedItemKeys: args.reviewedItemKeys,
      carryForwardWorkItemIds: args.carryForwardWorkItemIds,
    },
    readiness: args.readiness,
    summary: args.summary,
    reviewedItems: snapshotReviewedItems(args.snapshot, args.reviewedItemKeys),
    carryForwardItems: uniqueDailyCloseItems([
      ...args.snapshot.carryForwardItems,
      ...args.carryForwardWorkItems.map((workItem) =>
        asCarryForwardItem(workItem, {
          businessDate: args.snapshot.operatingDate,
          dailyCloseId: args.dailyCloseId,
          sourceId: carryForwardSourceId(workItem),
        }),
      ),
    ]),
    readyItems: args.snapshot.readyItems,
    sourceCompleteness: args.snapshot.sourceCompleteness,
    sourceSubjects: args.snapshot.sourceSubjects,
  };
}

function numberFromMetadata(
  record: Record<string, unknown> | undefined,
  key: string,
) {
  const value = record?.[key];

  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function buildEodAutomationDecisionEvidence(args: {
  automationScheduleEvidence?: CompleteDailyCloseForAutomationArgs[
    "automationScheduleEvidence"
  ];
  classification: string;
  eligible: boolean;
  policy: CompleteDailyCloseForAutomationArgs["eodAutoCompletePolicy"];
  snapshot: DailyCloseSnapshot;
}): AutomationDecisionEvidence {
  const voidedSaleTotal = args.snapshot.reviewItems
    .filter((item) => item.category === "voided_sale")
    .reduce((sum, item) => sum + numberFromMetadata(item.metadata, "total"), 0);
  const disqualifyingCategories = Array.from(
    new Set([
      ...args.snapshot.blockers.map((item) => item.category),
      ...args.snapshot.reviewItems
        .map((item) => item.category)
        .filter(
          (category) =>
            !EOD_AUTO_COMPLETE_LOW_RISK_REVIEW_CATEGORIES.has(category),
        ),
    ]),
  ).sort();

  return {
    kind: "eod_auto_complete",
    classification: args.classification,
    eligible: args.eligible,
    observed: {
      absoluteCashVariance: Math.abs(args.snapshot.summary.netCashVariance),
      blockerCount: args.snapshot.readiness.blockerCount,
      carryForwardCount: args.snapshot.readiness.carryForwardCount,
      carryForwardItemKeys: args.snapshot.carryForwardItems.map(
        (item) => item.key,
      ),
      carryForwardPreserved:
        args.snapshot.carryForwardItems.length > 0 ||
        args.snapshot.readiness.carryForwardCount > 0,
      disqualifyingCategories,
      reviewCount: args.snapshot.readiness.reviewCount,
      ...(args.automationScheduleEvidence
        ? {
            scheduleEvidenceSource: args.automationScheduleEvidence.source,
            ...(args.automationScheduleEvidence.storeScheduleId
              ? {
                  storeScheduleId:
                    args.automationScheduleEvidence.storeScheduleId,
                }
              : {}),
            ...(args.automationScheduleEvidence.scheduleVersion
              ? {
                  scheduleVersion:
                    args.automationScheduleEvidence.scheduleVersion,
                }
              : {}),
            ...(typeof args.automationScheduleEvidence.openedAt === "number"
              ? { scheduleOpenedAt: args.automationScheduleEvidence.openedAt }
              : {}),
            ...(typeof args.automationScheduleEvidence.closedAt === "number"
              ? { scheduleClosedAt: args.automationScheduleEvidence.closedAt }
              : {}),
            ...(typeof args.automationScheduleEvidence.evaluationAt === "number"
              ? {
                  scheduleEvaluationAt:
                    args.automationScheduleEvidence.evaluationAt,
                }
              : {}),
          }
        : {}),
      voidedSaleCount: args.snapshot.summary.voidedTransactionCount,
      voidedSaleTotal,
    },
    policy: {
      cleanDayAutoCompleteEnabled: args.policy.cleanDayAutoCompleteEnabled,
      maxAbsoluteCashVariance: args.policy.maxAbsoluteCashVariance,
      maxVoidedSaleCount: args.policy.maxVoidedSaleCount,
      maxVoidedSaleTotal: args.policy.maxVoidedSaleTotal,
    },
  };
}

function validateEodAutomationPolicyForSnapshot(args: {
  policy: CompleteDailyCloseForAutomationArgs["eodAutoCompletePolicy"];
  reviewedItemKeys: Set<string>;
  snapshot: DailyCloseSnapshot;
}) {
  const unsupportedReviewCategories = Array.from(
    new Set(
      args.snapshot.reviewItems
        .map((item) => item.category)
        .filter(
          (category) =>
            !EOD_AUTO_COMPLETE_LOW_RISK_REVIEW_CATEGORIES.has(category),
        ),
    ),
  );
  const disqualifyingCategories = Array.from(
    new Set([
      ...args.snapshot.blockers.map((item) => item.category),
      ...unsupportedReviewCategories,
    ]),
  ).sort();

  if (disqualifyingCategories.length > 0) {
    return {
      classification: "blocked",
      message:
        "EOD Review automation cannot complete while blockers or unsupported review evidence remain.",
      metadata: { disqualifyingCategories },
    };
  }

  if (args.snapshot.reviewItems.length === 0) {
    return args.policy.cleanDayAutoCompleteEnabled
      ? null
      : {
          classification: "clean_day",
          message:
            "EOD Review automation cannot complete clean days while clean-day auto-complete is disabled.",
          metadata: { cleanDayAutoCompleteEnabled: false },
        };
  }

  const unreviewedItemKeys = args.snapshot.reviewItems
    .map((item) => item.key)
    .filter((key) => !args.reviewedItemKeys.has(key));

  if (unreviewedItemKeys.length > 0) {
    return {
      classification: "review_unreviewed",
      message:
        "EOD Review automation cannot complete while review items are unreviewed by policy.",
      metadata: {
        reviewItemCount: args.snapshot.reviewItems.length,
        unreviewedItemKeys,
      },
    };
  }

  const absoluteCashVariance = Math.abs(args.snapshot.summary.netCashVariance);
  const voidedSaleTotal = args.snapshot.reviewItems
    .filter((item) => item.category === "voided_sale")
    .reduce((sum, item) => sum + numberFromMetadata(item.metadata, "total"), 0);
  const thresholdFailures = [
    absoluteCashVariance > args.policy.maxAbsoluteCashVariance
      ? "absolute_cash_variance"
      : null,
    args.snapshot.summary.voidedTransactionCount >
    args.policy.maxVoidedSaleCount
      ? "voided_sale_count"
      : null,
    voidedSaleTotal > args.policy.maxVoidedSaleTotal
      ? "voided_sale_total"
      : null,
  ].filter(Boolean);

  return thresholdFailures.length === 0
    ? null
    : {
        classification: "review_threshold_exceeded",
        message:
          "EOD Review automation cannot complete while review evidence exceeds policy thresholds.",
        metadata: {
          absoluteCashVariance,
          thresholdFailures,
          voidedSaleCount: args.snapshot.summary.voidedTransactionCount,
          voidedSaleTotal,
        },
      };
}

function snapshotReviewedItems(
  snapshot: DailyCloseSnapshot,
  reviewedItemKeys?: string[],
) {
  if (!reviewedItemKeys) {
    return snapshot.reviewItems;
  }

  const reviewedItemKeySet = new Set(reviewedItemKeys);
  return snapshot.reviewItems.filter((item) =>
    reviewedItemKeySet.has(item.key),
  );
}

function incompleteSourceCompletenessEntries(snapshot: DailyCloseSnapshot) {
  return snapshot.sourceCompleteness.entries.filter((entry) => !entry.complete);
}

function completionAttributionForDailyClose(
  dailyClose: Doc<"dailyClose">,
  completedByStaffProfileId = dailyClose.completedByStaffProfileId,
): DailyCloseCompletionAttribution {
  const reportSnapshot = dailyClose.reportSnapshot as
    | DailyCloseReportSnapshot
    | undefined;
  const closeMetadata = reportSnapshot?.closeMetadata;

  return {
    actorType: dailyClose.actorType ?? closeMetadata?.actorType,
    automationDecisionReason:
      dailyClose.automationDecisionReason ??
      closeMetadata?.automationDecisionReason,
    automationPolicyVersion:
      dailyClose.automationPolicyVersion ?? closeMetadata?.automationPolicyVersion,
    automationRunId: dailyClose.automationRunId ?? closeMetadata?.automationRunId,
    completedByStaffProfileId,
    completedByUserId:
      dailyClose.completedByUserId ?? closeMetadata?.completedByUserId,
    completionApprovalProofId:
      dailyClose.completionApprovalProofId ??
      closeMetadata?.completionApprovalProofId,
    completionApprovedByStaffProfileId:
      dailyClose.completionApprovedByStaffProfileId ??
      closeMetadata?.completionApprovedByStaffProfileId,
    completionRequestedByStaffProfileId:
      dailyClose.completionRequestedByStaffProfileId ??
      closeMetadata?.completionRequestedByStaffProfileId,
    completionRequestedByUserId:
      dailyClose.completionRequestedByUserId ??
      closeMetadata?.completionRequestedByUserId,
    policyReviewedItemKeys:
      dailyClose.policyReviewedItemKeys ?? closeMetadata?.policyReviewedItemKeys,
  };
}

const broadViewRestrictedMetadataLabels = new Set([
  "amount",
  "changegiven",
  "countedcash",
  "expectedcash",
  "total",
  "totalpaid",
  "variance",
]);

function normalizeBroadViewMetadataLabel(label: string) {
  return label.replace(/[\s_-]+/g, "").toLowerCase();
}

function redactDailyCloseItemForBroadView(
  item: DailyCloseItem,
  index = 0,
): DailyCloseItem {
  const safeMetadata = item.metadata
    ? Object.fromEntries(
        Object.entries(item.metadata).filter(
          ([label]) =>
            !broadViewRestrictedMetadataLabels.has(
              normalizeBroadViewMetadataLabel(label),
            ),
        ),
      )
    : undefined;

  return {
    key: `${item.severity}:${item.category}:${index}`,
    severity: item.severity,
    category: item.category,
    title: item.title,
    message: item.message,
    subject: {
      type: item.subject.type,
      id: "redacted",
      label: item.subject.label,
    },
    ...(item.link ? { link: item.link } : {}),
    ...(safeMetadata && Object.keys(safeMetadata).length > 0
      ? { metadata: safeMetadata }
      : {}),
  };
}

function redactDailyCloseSummaryForBroadView(
  summary: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = normalizeDailyCloseSummary(summary);

  return {
    carriedOverRegisterCount: normalized.carriedOverRegisterCount,
    closedRegisterSessionCount: normalized.closedRegisterSessionCount,
    currentDayCashTransactionCount: normalized.currentDayCashTransactionCount,
    expenseStaffCount: normalized.expenseStaffCount,
    expenseTransactionCount: normalized.expenseTransactionCount,
    itemAdjustmentCount: normalized.itemAdjustmentCount,
    openWorkItemCount: normalized.openWorkItemCount,
    pendingApprovalCount: normalized.pendingApprovalCount,
    registerCount: normalized.registerCount,
    registerVarianceCount: normalized.registerVarianceCount,
    transactionCount: normalized.transactionCount,
  };
}

function redactDailyCloseReportSnapshotForBroadView(
  snapshot: DailyCloseReportSnapshot,
): DailyCloseReportSnapshot {
  return {
    closeMetadata: {
      operatingDate: snapshot.closeMetadata.operatingDate,
      storeId: snapshot.closeMetadata.storeId,
      organizationId: snapshot.closeMetadata.organizationId,
      startAt: snapshot.closeMetadata.startAt,
      endAt: snapshot.closeMetadata.endAt,
      completedAt: snapshot.closeMetadata.completedAt,
      actorType: snapshot.closeMetadata.actorType,
      automationRunId: snapshot.closeMetadata.automationRunId,
      automationPolicyVersion: snapshot.closeMetadata.automationPolicyVersion,
      automationDecisionReason: snapshot.closeMetadata.automationDecisionReason,
      currentnessMode: snapshot.closeMetadata.currentnessMode,
      notes: snapshot.closeMetadata.notes,
      carryForwardWorkItemIds: [],
    },
    readiness: snapshot.readiness,
    summary: redactDailyCloseSummaryForBroadView(snapshot.summary),
    reviewedItems: snapshot.reviewedItems.map(redactDailyCloseItemForBroadView),
    carryForwardItems: snapshot.carryForwardItems.map(
      redactDailyCloseItemForBroadView,
    ),
    readyItems: snapshot.readyItems.map(redactDailyCloseItemForBroadView),
    sourceCompleteness: snapshot.sourceCompleteness,
    sourceSubjects: [],
  };
}

function maybeRedactDailyCloseSnapshotForBroadView(
  snapshot: DailyCloseSnapshot,
  includeManagerReviewEvidence: boolean,
): DailyCloseSnapshot {
  if (includeManagerReviewEvidence) return snapshot;
  const redactedCompletedClose = snapshot.completedClose
    ? (({ policyReviewedItemKeys: _policyReviewedItemKeys, ...completedClose }) => ({
        ...completedClose,
        restrictedDetailsRedacted: Boolean(_policyReviewedItemKeys?.length),
      }))(snapshot.completedClose)
    : null;

  return {
    ...snapshot,
    completedClose: redactedCompletedClose,
    blockers: snapshot.blockers.map(redactDailyCloseItemForBroadView),
    reviewItems: snapshot.reviewItems.map(redactDailyCloseItemForBroadView),
    carryForwardItems: snapshot.carryForwardItems.map(
      redactDailyCloseItemForBroadView,
    ),
    existingClose: null,
    priorClose: null,
    readyItems: snapshot.readyItems.map(redactDailyCloseItemForBroadView),
    summary: {
      ...emptySummary(),
      ...redactDailyCloseSummaryForBroadView(snapshot.summary),
    },
    sourceSubjects: [],
  };
}

function toDailyCloseHistoryListItem(
  dailyClose: Doc<"dailyClose">,
  completedByStaffName?: string | null,
  completedByStaffProfileId = dailyClose.completedByStaffProfileId,
  includeManagerReviewEvidence = true,
): DailyCloseHistoryListItem {
  const attribution = completionAttributionForDailyClose(
    dailyClose,
    completedByStaffProfileId,
  );

  return {
    dailyCloseId: dailyClose._id,
    operatingDate: dailyClose.operatingDate,
    actorType: attribution.actorType,
    automationDecisionReason: attribution.automationDecisionReason,
    automationPolicyVersion: attribution.automationPolicyVersion,
    automationRunId: attribution.automationRunId,
    completedAt: dailyClose.completedAt,
    completedByUserId: attribution.completedByUserId,
    completedByStaffProfileId: attribution.completedByStaffProfileId,
    completedByStaffName,
    completionApprovalProofId: attribution.completionApprovalProofId,
    completionApprovedByStaffProfileId:
      attribution.completionApprovedByStaffProfileId,
    completionRequestedByStaffProfileId:
      attribution.completionRequestedByStaffProfileId,
    completionRequestedByUserId: attribution.completionRequestedByUserId,
    readinessStatus: dailyClose.readiness.status,
    blockerCount: dailyClose.readiness.blockerCount,
    reviewCount: dailyClose.readiness.reviewCount,
    carryForwardCount: dailyClose.readiness.carryForwardCount,
    readyCount: dailyClose.readiness.readyCount,
    summary: includeManagerReviewEvidence
      ? dailyClose.summary
      : redactDailyCloseSummaryForBroadView(dailyClose.summary),
  };
}

async function getDailyCloseCompletionEventStaffProfileId(
  ctx: Pick<QueryCtx, "db">,
  args: {
    dailyCloseId: Id<"dailyClose">;
    storeId: Id<"store">;
  },
): Promise<Id<"staffProfile"> | undefined> {
  const events = await ctx.db
    .query("operationalEvent")
    .withIndex("by_storeId_subject", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("subjectType", DAILY_CLOSE_SUBJECT_TYPE)
        .eq("subjectId", args.dailyCloseId),
    )
    .take(DAILY_CLOSE_QUERY_LIMIT);
  const completionEvent = events
    .filter((event) => event.eventType === "daily_close_completed")
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))[0];
  const approvedByStaffProfileId =
    completionEvent?.metadata?.approvedByStaffProfileId;

  return typeof approvedByStaffProfileId === "string"
    ? (approvedByStaffProfileId as Id<"staffProfile">)
    : undefined;
}

function emptySummary(): DailyCloseSummary {
  return {
    adjustedSalesTotal: 0,
    adjustmentCashSettlementTotal: 0,
    adjustmentCollectionTotal: 0,
    adjustmentNetSettlementTotal: 0,
    adjustmentPaymentTotals: [],
    adjustmentRefundTotal: 0,
    carriedOverCashTotal: 0,
    carriedOverRegisterCount: 0,
    cashDepositTotal: 0,
    closedRegisterSessionCount: 0,
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expectedCashTotal: 0,
    expenseTransactionCount: 0,
    expenseStaffCount: 0,
    expenseTotal: 0,
    netCashVariance: 0,
    openWorkItemCount: 0,
    pendingApprovalCount: 0,
    registerCount: 0,
    registerVarianceCount: 0,
    salesTotal: 0,
    itemAdjustmentCount: 0,
    netCashMovementTotal: 0,
    transactionCount: 0,
    voidedTransactionCount: 0,
    paymentTotals: [],
  };
}

export async function buildDailyCloseSnapshotWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt?: number;
    includeManagerReviewEvidence?: boolean;
    operatingDate: string;
    startAt?: number;
    storeId: Id<"store">;
  },
): Promise<DailyCloseSnapshot> {
  const includeManagerReviewEvidence = args.includeManagerReviewEvidence ?? true;
  const range = resolveOperatingDateRange(args);
  const store = await getStore(ctx, args.storeId);
  const automationStatus =
    await getLatestDailyOperationsAutomationStatusWithCtx(ctx, {
      action: dailyOperationsEodPrepareAction.action,
      operatingDate: args.operatingDate,
      storeId: args.storeId,
    });

  if (!range) {
    const blocker: DailyCloseItem = {
      key: "daily_close:operating_date:invalid",
      severity: "blocker",
      category: "operating_date",
      title: "Invalid operating date",
      message:
        "EOD Review requires an operating date in YYYY-MM-DD format.",
      subject: {
        type: DAILY_CLOSE_SUBJECT_TYPE,
        id: args.operatingDate,
      },
    };

    return {
      operatingDate: args.operatingDate,
      storeId: args.storeId,
      organizationId: store?.organizationId ?? null,
      automationStatus,
      startAt: 0,
      endAt: 0,
      existingClose: null,
      completedClose: null,
      priorClose: null,
      priorDaySummary: null,
      status: "blocked",
      blockers: [blocker],
      reviewItems: [],
      carryForwardItems: [],
      readyItems: [],
      readiness: {
        status: "blocked",
        blockerCount: 1,
        reviewCount: 0,
        carryForwardCount: 0,
        readyCount: 0,
      },
      summary: emptySummary(),
      sourceCompleteness: completeSourceCompleteness([
        {
          source: "operating_date",
          complete: false,
          readMode: "validation",
          recordCount: 0,
          reason: "invalid_operating_date",
        },
      ]),
      sourceSubjects: [blocker.subject],
    };
  }

  const existingClose = await getDailyCloseForDate(ctx, args);

  if (existingClose?.status === "completed" && existingClose.reportSnapshot) {
    const completedByStaffProfileId =
      existingClose.completedByStaffProfileId ??
      (await getDailyCloseCompletionEventStaffProfileId(ctx, {
        dailyCloseId: existingClose._id,
        storeId: args.storeId,
      }));
    const staffNamesById = await buildStaffNamesById(ctx, [
      completedByStaffProfileId,
    ]);
    const priorClose = await getPriorCompletedDailyClose(ctx, args);
    const completedSnapshot = normalizeCompletedDailyCloseSnapshot({
      dailyClose: existingClose,
      completedByStaffProfileId,
      completedByStaffName: completedByStaffProfileId
        ? (staffNamesById.get(completedByStaffProfileId) ?? null)
        : null,
      priorClose,
    });

    if (completedSnapshot) {
      return maybeRedactDailyCloseSnapshotForBroadView(
        {
          ...completedSnapshot,
          automationStatus,
        },
        includeManagerReviewEvidence,
      );
    }
  }

  const [
    registerSessionRead,
    pendingApprovalRead,
    openPosSessionRead,
    openWorkItemRead,
    completedTransactionRead,
    appliedTransactionAdjustmentRead,
    voidedTransactionRead,
    expenseTransactionRead,
    cashDepositRead,
    priorClose,
  ] = await Promise.all([
    listRegisterSessionsForDailyClose(ctx, {
      ...range,
      operatingDate: args.operatingDate,
      storeId: args.storeId,
    }),
    listPendingCloseoutApprovals(ctx, { ...range, storeId: args.storeId }),
    listOpenPosSessions(ctx, { ...range, storeId: args.storeId }),
    listOpenOperationalWorkItems(ctx, args.storeId),
    listTransactionsForDay(ctx, {
      ...range,
      status: "completed",
      storeId: args.storeId,
    }),
    readAppliedTransactionAdjustmentsForDay(ctx, {
      ...range,
      storeId: args.storeId,
    }),
    listTransactionsForDay(ctx, {
      ...range,
      status: "void",
      storeId: args.storeId,
    }),
    listExpensesForDay(ctx, { ...range, storeId: args.storeId }),
    listDepositsForDay(ctx, { ...range, storeId: args.storeId }),
    getPriorCompletedDailyClose(ctx, args),
  ]);
  const completedTransactions = completedTransactionRead.rows;
  const appliedTransactionAdjustments = appliedTransactionAdjustmentRead.rows;
  const voidedTransactions = voidedTransactionRead.rows;
  const expenseTransactions = expenseTransactionRead.rows;
  const completedTransactionItemCountsById =
    await buildTransactionItemCountsByTransactionId(ctx, [
      ...completedTransactions,
      ...voidedTransactions,
    ]);
  const expenseTransactionItemCountsById =
    await buildExpenseTransactionItemCountsByTransactionId(
      ctx,
      expenseTransactions,
    );
  const cashDeposits = cashDepositRead.rows;
  const pendingApprovals = pendingApprovalRead.rows;
  const openPosSessions = openPosSessionRead.rows;
  const openWorkItems = openWorkItemRead.rows;
  const sourceCompleteness = mergeSourceCompleteness(
    registerSessionRead.sourceCompleteness,
    pendingApprovalRead.completeness,
    openPosSessionRead.completeness,
    openWorkItemRead.completeness,
    completedTransactionRead.completeness,
    appliedTransactionAdjustmentRead.completeness,
    voidedTransactionRead.completeness,
    expenseTransactionRead.completeness,
    cashDepositRead.completeness,
  );

  const activeRegisterSessionsInRange =
    await filterRegisterSessionsBelongingToRange(
      ctx,
      registerSessionRead.activeSessions,
      range,
    );
  const reviewOnlyRegisterCloseoutSessionsInRange =
    await filterRegisterSessionsBelongingToRange(
      ctx,
      registerSessionRead.reviewOnlySessions,
      range,
    );
  const closedRegisterSessions = registerSessionRead.closedSessions;
  const activeRegisterSessionApprovalsById = await buildApprovalRequestsById(
    ctx,
    activeRegisterSessionsInRange.map(
      (session) => session.managerApprovalRequestId,
    ),
  );
  const submittedVarianceCloseoutSessions = activeRegisterSessionsInRange.filter(
    (session) =>
      isSubmittedVarianceCloseout(
        session,
        closeoutApprovalForRegisterSession(
          session,
          activeRegisterSessionApprovalsById,
        ),
      ),
  );
  const activeRegisterSessions = activeRegisterSessionsInRange.filter(
    (session) =>
      !isSubmittedVarianceCloseout(
        session,
        closeoutApprovalForRegisterSession(
          session,
          activeRegisterSessionApprovalsById,
        ),
      ),
  );
  const reviewOnlyRegisterCloseoutSessions = [
    ...reviewOnlyRegisterCloseoutSessionsInRange,
    ...submittedVarianceCloseoutSessions,
  ];
  const reviewOnlyRegisterCloseoutApprovalsById =
    await buildApprovalRequestsById(
      ctx,
      reviewOnlyRegisterCloseoutSessions.map(
        (session) => session.managerApprovalRequestId,
      ),
    );
  const relevantRegisterSessions = [
    ...activeRegisterSessions,
    ...closedRegisterSessions,
  ];
  const carriedOverRegisterSessions = relevantRegisterSessions.filter(
    (session) => session.openedAt < range.startAt,
  );
  const cashCollectedTodayByRegisterSessionId = cashDeltasByRegisterSessionId(
    completedTransactions,
  );
  const approvalRegisterSessionsById = await buildRegisterSessionsById(
    ctx,
    pendingApprovals.map((approval) => approval.registerSessionId),
  );
  const approvalRegisterSessions = Array.from(
    approvalRegisterSessionsById.values(),
  ).filter((session): session is Doc<"registerSession"> => Boolean(session));
  const expenseSessionsById = await buildExpenseSessionsById(
    ctx,
    expenseTransactions.map((transaction) => transaction.sessionId),
  );
  const expenseSessions = Array.from(expenseSessionsById.values()).filter(
    (session): session is Doc<"expenseSession"> => Boolean(session),
  );
  const completedByStaffProfileId =
    existingClose?.status === "completed"
      ? (existingClose.completedByStaffProfileId ??
        (await getDailyCloseCompletionEventStaffProfileId(ctx, {
          dailyCloseId: existingClose._id,
          storeId: args.storeId,
        })))
      : undefined;
  const terminalLabelsById = await buildTerminalLabelsById(ctx, [
    ...activeRegisterSessions.map((session) => session.terminalId),
    ...reviewOnlyRegisterCloseoutSessions.map((session) => session.terminalId),
    ...closedRegisterSessions.map((session) => session.terminalId),
    ...approvalRegisterSessions.map((session) => session.terminalId),
    ...expenseSessions.map((session) => session.terminalId),
    ...openPosSessions.map((session) => session.terminalId),
    ...completedTransactions.map((transaction) => transaction.terminalId),
    ...voidedTransactions.map((transaction) => transaction.terminalId),
  ]);
  const staffNamesById = await buildStaffNamesById(ctx, [
    ...activeRegisterSessions.map((session) => session.openedByStaffProfileId),
    ...activeRegisterSessions.map((session) => session.closedByStaffProfileId),
    ...reviewOnlyRegisterCloseoutSessions.map(
      (session) => session.openedByStaffProfileId,
    ),
    ...reviewOnlyRegisterCloseoutSessions.map(
      (session) => session.closedByStaffProfileId,
    ),
    ...closedRegisterSessions.map((session) => session.openedByStaffProfileId),
    ...closedRegisterSessions.map((session) => session.closedByStaffProfileId),
    ...approvalRegisterSessions.map(
      (session) => session.openedByStaffProfileId,
    ),
    ...approvalRegisterSessions.map(
      (session) => session.closedByStaffProfileId,
    ),
    ...openPosSessions.map((session) => session.staffProfileId),
    ...completedTransactions.map((transaction) => transaction.staffProfileId),
    ...voidedTransactions.map((transaction) => transaction.staffProfileId),
    ...expenseTransactions.map((transaction) => transaction.staffProfileId),
    ...pendingApprovals.map((approval) => approval.requestedByStaffProfileId),
    completedByStaffProfileId,
  ]);

  const blockers: DailyCloseItem[] = [];
  const reviewItems: DailyCloseItem[] = [];
  const readyItems: DailyCloseItem[] = [];
  const carryForwardItems = openWorkItems.map((workItem) =>
    asCarryForwardItem(workItem),
  );

  activeRegisterSessions.forEach((session) => {
    const terminalLabel = session.terminalId
      ? terminalLabelsById.get(session.terminalId)
      : undefined;
    const registerLabel = trimOptional(session.registerNumber)
      ? registerSessionLabel(session)
      : undefined;
    const registerMetadata = registerMetadataLabel(
      terminalLabel,
      registerLabel,
    );
    const openedBy = session.openedByStaffProfileId
      ? staffNamesById.get(session.openedByStaffProfileId)
      : undefined;
    const closedBy = session.closedByStaffProfileId
      ? staffNamesById.get(session.closedByStaffProfileId)
      : undefined;
    const isCarriedOver = session.openedAt < range.startAt;

    blockers.push({
      key: `register_session:${session._id}:${session.status}`,
      severity: "blocker",
      category: "register_session",
      title:
        session.status === "closing"
          ? "Register closeout is still in progress"
          : "Register session is still open",
      message:
        session.status === "closing"
          ? "Finish the register closeout before completing the end of day review."
          : isCarriedOver
            ? "Close the register session carried over from a prior operating day before completing the end of day review."
            : "Close the register session before completing the end of day review.",
      subject: {
        type: "register_session",
        id: session._id,
        label: registerSessionLabel(session),
      },
      link: {
        label: "View session",
        params: { sessionId: session._id },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      metadata: {
        ...(terminalLabel ? { terminal: terminalLabel } : {}),
        ...(registerMetadata ? { register: registerMetadata } : {}),
        operatingScope: isCarriedOver
          ? "Carried over from prior day"
          : "Opened today",
        openedAt: session.openedAt,
        ...(openedBy ? { openedBy } : {}),
        expectedCash: session.expectedCash,
        ...(typeof session.countedCash === "number"
          ? { countedCash: session.countedCash }
          : {}),
        status: session.status,
        ...nonZeroVarianceMetadata(session.variance),
        ...(typeof session.closedAt === "number"
          ? { closedAt: session.closedAt }
          : {}),
        ...(closedBy ? { closedBy } : {}),
      },
    });
  });

  reviewOnlyRegisterCloseoutSessions.forEach((session) => {
    const terminalLabel = session.terminalId
      ? terminalLabelsById.get(session.terminalId)
      : undefined;
    const registerLabel = trimOptional(session.registerNumber)
      ? registerSessionLabel(session)
      : undefined;
    const registerMetadata = registerMetadataLabel(
      terminalLabel,
      registerLabel,
    );
    const openedBy = session.openedByStaffProfileId
      ? staffNamesById.get(session.openedByStaffProfileId)
      : undefined;
    const closedBy = session.closedByStaffProfileId
      ? staffNamesById.get(session.closedByStaffProfileId)
      : undefined;
    const isCarriedOver = session.openedAt < range.startAt;
    const closeoutApproval = closeoutApprovalForRegisterSession(
      session,
      reviewOnlyRegisterCloseoutApprovalsById,
    );
    const isSubmittedVarianceReview = isSubmittedVarianceCloseout(
      session,
      closeoutApproval,
    );

    blockers.push({
      key: `register_session:${session._id}:${
        isSubmittedVarianceReview ? "variance_review" : session.status
      }`,
      severity: "blocker",
      category: "register_session",
      title: isSubmittedVarianceReview
        ? "Register closeout variance needs review"
        : "Register closeout needs review",
      message: isSubmittedVarianceReview
        ? "Resolve the submitted register closeout variance review before completing the end of day review."
        : "Review or reopen the rejected register closeout before completing the end of day review.",
      subject: {
        type: "register_session",
        id: session._id,
        label: registerSessionLabel(session),
      },
      link: {
        label: "View session",
        params: { sessionId: session._id },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      metadata: {
        ...(terminalLabel ? { terminal: terminalLabel } : {}),
        ...(registerMetadata ? { register: registerMetadata } : {}),
        operatingScope: isCarriedOver
          ? "Carried over from prior day"
          : "Opened today",
        openedAt: session.openedAt,
        ...(openedBy ? { openedBy } : {}),
        expectedCash: session.expectedCash,
        ...(typeof session.countedCash === "number"
          ? { countedCash: session.countedCash }
          : {}),
        status: session.status,
        ...nonZeroVarianceMetadata(session.variance),
        ...(typeof session.closedAt === "number"
          ? { closedAt: session.closedAt }
          : {}),
        ...(closedBy ? { closedBy } : {}),
        ...(closeoutApproval
          ? { reviewRequestedAt: closeoutApproval.createdAt }
          : {}),
      },
    });
  });

  pendingApprovals.forEach((approval) => {
    const requestedBy = approval.requestedByStaffProfileId
      ? staffNamesById.get(approval.requestedByStaffProfileId)
      : undefined;
    const approvalRegisterSession = approval.registerSessionId
      ? approvalRegisterSessionsById.get(approval.registerSessionId)
      : undefined;
    const approvalRegisterLabel = approvalRegisterSession
      ? registerSessionLabel(approvalRegisterSession)
      : undefined;
    const terminalLabel = approvalRegisterSession?.terminalId
      ? terminalLabelsById.get(approvalRegisterSession.terminalId)
      : undefined;
    const metadata = approval.metadata ?? {};
    const previousPaymentMethod =
      typeof metadata.previousPaymentMethod === "string"
        ? metadata.previousPaymentMethod
        : undefined;
    const paymentMethod =
      typeof metadata.paymentMethod === "string"
        ? metadata.paymentMethod
        : undefined;
    const transactionNumber =
      typeof metadata.transactionNumber === "string"
        ? metadata.transactionNumber
        : undefined;
    const transactionId =
      typeof metadata.transactionId === "string"
        ? metadata.transactionId
        : approval.subjectType === "pos_transaction"
          ? approval.subjectId
          : undefined;
    const amount =
      typeof metadata.amount === "number" ? metadata.amount : undefined;

    blockers.push({
      key: `approval_request:${approval._id}:pending`,
      severity: "blocker",
      category: "approval",
      title: `${approvalRequestTypeLabel(approval.requestType)} pending`,
      message:
        "Resolve pending closeout approval before completing the end of day review.",
      subject: {
        type: "approval_request",
        id: approval._id,
      },
      link: {
        label: "View approvals",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
      },
      metadata: {
        approval: approvalRequestTypeLabel(approval.requestType),
        ...(requestedBy ? { requestedBy } : {}),
        requestedAt: approval.createdAt,
        ...(approval.reason ? { reason: approval.reason } : {}),
        ...(approval.notes ? { notes: approval.notes } : {}),
        ...(terminalLabel ? { terminal: terminalLabel } : {}),
        ...(approvalRegisterLabel ? { register: approvalRegisterLabel } : {}),
        ...(transactionNumber ? { transaction: transactionNumber } : {}),
        ...(transactionId ? { transactionId } : {}),
        ...(previousPaymentMethod
          ? {
              currentMethod: formatPaymentMethodLabel(previousPaymentMethod),
            }
          : {}),
        ...(paymentMethod
          ? { requestedMethod: formatPaymentMethodLabel(paymentMethod) }
          : {}),
        ...(typeof amount === "number" ? { amount } : {}),
      },
    });
  });

  openPosSessions.forEach((session) => {
    const terminalLabel = session.terminalId
      ? terminalLabelsById.get(session.terminalId)
      : undefined;
    const registerLabel = trimOptional(session.registerNumber)
      ? `Register ${session.registerNumber}`
      : undefined;
    const customerLabel =
      trimOptional(session.customerInfo?.name) ??
      trimOptional(session.customerInfo?.phone) ??
      trimOptional(session.customerInfo?.email);
    const staffName = session.staffProfileId
      ? staffNamesById.get(session.staffProfileId)
      : undefined;

    blockers.push({
      key: `pos_session:${session._id}:${session.status}`,
      severity: "blocker",
      category: "pos_session",
      title: "POS session is still unresolved",
      message:
        "Complete, void, or release held POS sessions before the end of day review.",
      subject: {
        type: "pos_session",
        id: session._id,
        label: session.sessionNumber,
      },
      metadata: {
        session: session.sessionNumber,
        ...(terminalLabel
          ? {
              terminal: registerLabel
                ? `${terminalLabel} / ${registerLabel}`
                : terminalLabel,
            }
          : {}),
        ...(customerLabel ? { customer: customerLabel } : {}),
        ...(staffName ? { owner: staffName } : {}),
        status: session.status,
        ...(typeof session.total === "number" ? { total: session.total } : {}),
        ...(typeof session.expiresAt === "number"
          ? { expiresAt: session.expiresAt }
          : {}),
      },
    });
  });

  closedRegisterSessions.forEach((session) => {
    const terminalLabel = session.terminalId
      ? terminalLabelsById.get(session.terminalId)
      : undefined;
    const registerLabel = trimOptional(session.registerNumber)
      ? registerSessionLabel(session)
      : undefined;
    const registerMetadata = registerMetadataLabel(
      terminalLabel,
      registerLabel,
    );
    const openedBy = session.openedByStaffProfileId
      ? staffNamesById.get(session.openedByStaffProfileId)
      : undefined;
    const closedBy = session.closedByStaffProfileId
      ? staffNamesById.get(session.closedByStaffProfileId)
      : undefined;
    const isCarriedOver = session.openedAt < range.startAt;

    readyItems.push({
      key: `register_session:${session._id}:closed`,
      severity: "ready",
      category: "register_session",
      title: "Register session closed",
      message: "Closed register session is included in the end of day review.",
      subject: {
        type: "register_session",
        id: session._id,
        label: registerSessionLabel(session),
      },
      link: {
        label: "View session",
        params: { sessionId: session._id },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      metadata: {
        ...(terminalLabel ? { terminal: terminalLabel } : {}),
        ...(registerMetadata ? { register: registerMetadata } : {}),
        operatingScope: isCarriedOver
          ? "Carried over from prior day"
          : "Opened today",
        openedAt: session.openedAt,
        ...(openedBy ? { openedBy } : {}),
        expectedCash: session.expectedCash,
        ...(typeof session.countedCash === "number"
          ? { countedCash: session.countedCash }
          : {}),
        status: session.status,
        ...nonZeroVarianceMetadata(session.variance),
        ...(typeof session.closedAt === "number"
          ? { closedAt: session.closedAt }
          : {}),
        ...(closedBy ? { closedBy } : {}),
      },
    });

    if (session.variance && session.variance !== 0) {
      reviewItems.push({
        key: `register_session:${session._id}:variance`,
        severity: "review",
        category: "cash_variance",
        title: "Closed register has a cash variance",
        message:
          "Review the cash variance before completing the end of day review.",
        subject: {
          type: "register_session",
          id: session._id,
          label: registerSessionLabel(session),
        },
        link: {
          label: "View session",
          params: { sessionId: session._id },
          to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
        },
        metadata: {
          ...(terminalLabel ? { terminal: terminalLabel } : {}),
          ...(registerMetadata ? { register: registerMetadata } : {}),
          operatingScope: isCarriedOver
            ? "Carried over from prior day"
            : "Opened today",
          openedAt: session.openedAt,
          expectedCash: session.expectedCash,
          countedCash: session.countedCash,
          status: session.status,
          variance: session.variance,
          ...(typeof session.closedAt === "number"
            ? { closedAt: session.closedAt }
            : {}),
        },
      });
    }
  });

  completedTransactions.forEach((transaction) => {
    const terminalLabel = transaction.terminalId
      ? terminalLabelsById.get(transaction.terminalId)
      : undefined;
    const registerLabel = trimOptional(transaction.registerNumber)
      ? `Register ${transaction.registerNumber}`
      : undefined;
    const customerLabel =
      trimOptional(transaction.customerInfo?.name) ??
      trimOptional(transaction.customerInfo?.phone) ??
      trimOptional(transaction.customerInfo?.email);
    const staffName = transaction.staffProfileId
      ? staffNamesById.get(transaction.staffProfileId)
      : undefined;
    const paymentSummary = transactionPaymentSummary(transaction);

    readyItems.push({
      key: `pos_transaction:${transaction._id}:completed`,
      severity: "ready",
      category: "sale",
      title: "Completed sale",
      message: "Completed sale is included in the end of day review.",
      subject: {
        type: "pos_transaction",
        id: transaction._id,
        label: transaction.transactionNumber,
      },
      link: {
        label: "View transaction",
        params: { transactionId: transaction._id },
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
      },
      metadata: {
        transaction: transaction.transactionNumber,
        ...(terminalLabel
          ? {
              terminal: registerLabel
                ? `${terminalLabel} / ${registerLabel}`
                : terminalLabel,
            }
          : {}),
        ...(staffName ? { owner: staffName } : {}),
        ...(customerLabel ? { customer: customerLabel } : {}),
        ...(paymentSummary ? { paymentMethods: paymentSummary } : {}),
        completedAt: transaction.completedAt,
        total: transaction.total,
        totalPaid: transaction.totalPaid,
        ...(completedTransactionItemCountsById.get(String(transaction._id))
          ? {
              itemCount: completedTransactionItemCountsById.get(
                String(transaction._id),
              ),
            }
          : {}),
        ...(typeof transaction.changeGiven === "number"
          ? { changeGiven: transaction.changeGiven }
          : {}),
      },
    });
  });

  appliedTransactionAdjustments.forEach((adjustment) => {
    const originalTotal =
      typeof adjustment.originalTotal === "number"
        ? adjustment.originalTotal
        : undefined;
    const adjustedTotal =
      typeof adjustment.correctedTotal === "number"
        ? adjustment.correctedTotal
        : originalTotal !== undefined
          ? originalTotal + adjustment.signedSalesDelta
          : undefined;

    readyItems.push({
      key: `pos_transaction_adjustment:${adjustment._id}:applied`,
      severity: "ready",
      category: "sale_adjustment",
      title: "Completed item adjustment",
      message:
        "Completed transaction item adjustment is included separately from the original sale total.",
      subject: {
        type: "pos_transaction_adjustment",
        id: adjustment._id,
        label: adjustment.transactionNumber,
      },
      link: {
        label: "View transaction",
        params: { transactionId: adjustment.transactionId },
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
      },
      metadata: {
        ...(adjustment.transactionNumber
          ? { transaction: adjustment.transactionNumber }
          : {}),
        appliedAt: adjustment.appliedAt,
        ...(originalTotal !== undefined ? { originalTotal } : {}),
        ...(adjustedTotal !== undefined ? { adjustedTotal } : {}),
        settlementAmount: adjustment.signedSettlementAmount,
        ...(adjustment.settlementMethod
          ? {
              settlementMethod: formatPaymentMethodLabel(
                adjustment.settlementMethod,
              ),
            }
          : {}),
      },
    });
  });

  expenseTransactions.forEach((transaction) => {
    const staffName = staffNamesById.get(transaction.staffProfileId);
    const expenseSession = expenseSessionsById.get(transaction.sessionId);
    const terminalLabel = expenseSession?.terminalId
      ? terminalLabelsById.get(expenseSession.terminalId)
      : undefined;
    const expenseSessionRegisterNumber = trimOptional(
      expenseSession?.registerNumber,
    );
    const registerLabel = trimOptional(transaction.registerNumber)
      ? `Register ${transaction.registerNumber}`
      : expenseSessionRegisterNumber
        ? `Register ${expenseSessionRegisterNumber}`
        : undefined;

    readyItems.push({
      key: `expense_transaction:${transaction._id}:completed`,
      severity: "ready",
      category: "expense",
      title: "Completed expense",
      message: "Completed expense is included in the end of day review.",
      subject: {
        type: "expense_transaction",
        id: transaction._id,
        label: transaction.transactionNumber,
      },
      link: {
        label: "View expense",
        params: { reportId: transaction._id },
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos/expense-reports/$reportId",
      },
      metadata: {
        report: transaction.transactionNumber,
        ...(terminalLabel
          ? {
              terminal: registerLabel
                ? `${terminalLabel} / ${registerLabel}`
                : terminalLabel,
            }
          : {}),
        ...(!terminalLabel && registerLabel ? { register: registerLabel } : {}),
        ...(staffName ? { owner: staffName } : {}),
        ...(transaction.notes ? { notes: transaction.notes } : {}),
        total: transaction.totalValue,
        completedAt: transaction.completedAt,
        ...(expenseTransactionItemCountsById.get(String(transaction._id))
          ? {
              itemCount: expenseTransactionItemCountsById.get(
                String(transaction._id),
              ),
            }
          : {}),
      },
    });
  });

  voidedTransactions.forEach((transaction) => {
    const terminalLabel = transaction.terminalId
      ? terminalLabelsById.get(transaction.terminalId)
      : undefined;
    const registerLabel = trimOptional(transaction.registerNumber)
      ? `Register ${transaction.registerNumber}`
      : undefined;
    const customerLabel =
      trimOptional(transaction.customerInfo?.name) ??
      trimOptional(transaction.customerInfo?.phone) ??
      trimOptional(transaction.customerInfo?.email);
    const staffName = transaction.staffProfileId
      ? staffNamesById.get(transaction.staffProfileId)
      : undefined;
    const paymentSummary = transactionPaymentSummary(transaction);

    reviewItems.push({
      key: `pos_transaction:${transaction._id}:void`,
      severity: "review",
      category: "voided_sale",
      title: "Voided sale needs review",
      message: "Review voided sales before completing the end of day review.",
      subject: {
        type: "pos_transaction",
        id: transaction._id,
        label: transaction.transactionNumber,
      },
      link: {
        label: "View transaction",
        params: { transactionId: transaction._id },
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
      },
      metadata: {
        transaction: transaction.transactionNumber,
        ...(terminalLabel
          ? {
              terminal: registerLabel
                ? `${terminalLabel} / ${registerLabel}`
                : terminalLabel,
            }
          : {}),
        ...(staffName ? { owner: staffName } : {}),
        ...(customerLabel ? { customer: customerLabel } : {}),
        ...(paymentSummary ? { paymentMethods: paymentSummary } : {}),
        total: transaction.total,
        totalPaid: transaction.totalPaid,
        completedAt: transaction.completedAt,
        ...(completedTransactionItemCountsById.get(String(transaction._id))
          ? {
              itemCount: completedTransactionItemCountsById.get(
                String(transaction._id),
              ),
            }
          : {}),
        ...(typeof transaction.voidedAt === "number"
          ? { voidedAt: transaction.voidedAt }
          : {}),
      },
    });
  });

  const currentDayCashTotal = completedTransactions.reduce(
    (sum, transaction) => sum + transactionCashDelta(transaction),
    0,
  );
  const salesTotal = completedTransactions.reduce(
    (sum, transaction) => sum + transaction.total,
    0,
  );
  const adjustmentReportTotals = buildAdjustmentReportTotals({
    appliedAdjustments: appliedTransactionAdjustments,
    completedTransactions,
    currentDayCashTotal,
    salesTotal,
  });
  const summary: DailyCloseSummary = {
    ...adjustmentReportTotals,
    carriedOverCashTotal: carriedOverRegisterSessions.reduce(
      (sum, session) =>
        sum +
        Math.max(
          0,
          session.expectedCash -
            (cashCollectedTodayByRegisterSessionId.get(session._id) ?? 0),
        ),
      0,
    ),
    carriedOverRegisterCount: carriedOverRegisterSessions.length,
    cashDepositTotal: cashDeposits.reduce(
      (sum, deposit) => sum + deposit.amount,
      0,
    ),
    closedRegisterSessionCount: closedRegisterSessions.length,
    currentDayCashTotal,
    currentDayCashTransactionCount: completedTransactions.filter(
      (transaction) => transactionCashDelta(transaction) > 0,
    ).length,
    expectedCashTotal: relevantRegisterSessions.reduce(
      (sum, session) => sum + session.expectedCash,
      0,
    ),
    expenseTotal: expenseTransactions.reduce(
      (sum, transaction) => sum + transaction.totalValue,
      0,
    ),
    expenseTransactionCount: expenseTransactions.length,
    expenseStaffCount: new Set(
      expenseTransactions.map((transaction) => transaction.staffProfileId),
    ).size,
    netCashVariance: relevantRegisterSessions.reduce(
      (sum, session) => sum + (session.variance ?? 0),
      0,
    ),
    openWorkItemCount: openWorkItems.length,
    pendingApprovalCount: pendingApprovals.length,
    registerCount: relevantRegisterSessions.length,
    registerVarianceCount: relevantRegisterSessions.filter((session) =>
      Boolean(session.variance),
    ).length,
    salesTotal,
    transactionCount: completedTransactions.length,
    voidedTransactionCount: voidedTransactions.length,
    paymentTotals: buildPaymentTotals(completedTransactions),
  };
  sortDailyCloseBlockers(blockers);
  const readiness = buildReadiness({
    blockers,
    carryForwardItems,
    readyItems,
    reviewItems,
  });
  const allItems = [
    ...blockers,
    ...reviewItems,
    ...carryForwardItems,
    ...readyItems,
  ];
  const completedClose =
    existingClose?.status === "completed"
      ? (() => {
          const attribution = completionAttributionForDailyClose(
            existingClose,
            completedByStaffProfileId,
          );

          return {
            ...(attribution.actorType ? { actorType: attribution.actorType } : {}),
            ...(attribution.automationDecisionReason
              ? {
                  automationDecisionReason:
                    attribution.automationDecisionReason,
                }
              : {}),
            ...(attribution.automationPolicyVersion
              ? {
                  automationPolicyVersion:
                    attribution.automationPolicyVersion,
                }
              : {}),
            ...(attribution.automationRunId
              ? { automationRunId: attribution.automationRunId }
              : {}),
            ...(includeManagerReviewEvidence &&
            attribution.policyReviewedItemKeys
              ? { policyReviewedItemKeys: attribution.policyReviewedItemKeys }
              : {}),
            completedAt: existingClose.completedAt,
            completedByStaffProfileId: attribution.completedByStaffProfileId,
            completedByStaffName: completedByStaffProfileId
              ? (staffNamesById.get(completedByStaffProfileId) ?? null)
              : null,
            completedByUserId: attribution.completedByUserId,
            notes: existingClose.notes,
          };
        })()
      : null;
  const status = completedClose
    ? "completed"
    : readiness.status === "ready" && carryForwardItems.length > 0
      ? "carry_forward"
      : readiness.status;

  return maybeRedactDailyCloseSnapshotForBroadView(
    {
      operatingDate: args.operatingDate,
      storeId: args.storeId,
      organizationId: store?.organizationId ?? null,
      automationStatus,
      startAt: range.startAt,
      endAt: range.endAt,
      existingClose,
      completedClose,
      priorClose,
      priorDaySummary: priorClose?.summary
        ? normalizeDailyCloseSummary(priorClose.summary)
        : null,
      status,
      blockers,
      reviewItems,
      carryForwardItems,
      readyItems,
      readiness,
      summary,
      sourceCompleteness,
      sourceSubjects: uniqueSourceSubjects(allItems),
    },
    includeManagerReviewEvidence,
  );
}

async function validateCarryForwardWorkItemIds(
  ctx: Pick<MutationCtx, "db">,
  args: {
    storeId: Id<"store">;
    workItemIds: Id<"operationalWorkItem">[];
  },
) {
  const workItems: Array<Doc<"operationalWorkItem">> = [];

  for (const workItemId of args.workItemIds) {
    const workItem = await ctx.db.get("operationalWorkItem", workItemId);

    if (!workItem || workItem.storeId !== args.storeId) {
      return {
        ok: false as const,
        message: "Carry-forward work item not found for this store.",
      };
    }

    workItems.push(workItem);
  }

  return {
    ok: true as const,
    workItems,
  };
}

function uniqueOperationalWorkItemIds(
  workItemIds: Id<"operationalWorkItem">[],
) {
  return Array.from(new Set(workItemIds));
}

function stringFromMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = metadata?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function carryForwardBusinessDate(
  workItem: Pick<Doc<"operationalWorkItem">, "metadata">,
) {
  return (
    stringFromMetadata(workItem.metadata, "businessDate") ??
    stringFromMetadata(workItem.metadata, "operatingDate")
  );
}

function carryForwardSourceId(
  workItem: Pick<Doc<"operationalWorkItem">, "_id" | "metadata">,
) {
  return (
    stringFromMetadata(workItem.metadata, "carryForwardSourceId") ??
    stringFromMetadata(workItem.metadata, "sourceId") ??
    workItem._id
  );
}

function sourceIdFromCarryForwardInput(
  item: NonNullable<CompleteDailyCloseArgs["createCarryForwardWorkItems"]>[number],
) {
  return (
    stringFromMetadata(item.metadata, "carryForwardSourceId") ??
    stringFromMetadata(item.metadata, "sourceId")
  );
}

function carryForwardMetadataMatches(args: {
  businessDate: string;
  sourceId: string;
  workItem: Pick<Doc<"operationalWorkItem">, "_id" | "metadata">;
}) {
  return (
    carryForwardBusinessDate(args.workItem) === args.businessDate &&
    carryForwardSourceId(args.workItem) === args.sourceId
  );
}

async function findCurrentCarryForwardWorkItemBySource(
  ctx: Pick<QueryCtx, "db">,
  args: {
    businessDate: string;
    sourceId: string;
    storeId: Id<"store">;
  },
) {
  const pages = await Promise.all(
    OPEN_OPERATIONAL_WORK_ITEM_STATUSES.map((status) =>
      ctx.db
        .query("operationalWorkItem")
        .withIndex("by_storeId_type_status", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("type", DAILY_CLOSE_CARRY_FORWARD_TYPE)
            .eq("status", status),
        )
        .take(DAILY_CLOSE_CARRY_FORWARD_SOURCE_PROBE_LIMIT),
    ),
  );

  return (
    pages
      .flat()
      .find((workItem) =>
        carryForwardMetadataMatches({
          businessDate: args.businessDate,
          sourceId: args.sourceId,
          workItem,
        }),
      ) ?? null
  );
}

function carryForwardWorkItemIdFromItem(
  item: DailyCloseItem,
): Id<"operationalWorkItem"> | null {
  if (item.subject.type !== "operational_work_item") {
    return null;
  }

  return item.subject.id as Id<"operationalWorkItem">;
}

async function validateAutomationCarryForwardWorkItems(
  ctx: Pick<MutationCtx, "db">,
  args: {
    organizationId: Id<"organization">;
    snapshot: DailyCloseSnapshot;
    storeId: Id<"store">;
  },
) {
  const workItemIds = args.snapshot.carryForwardItems
    .map(carryForwardWorkItemIdFromItem)
    .filter(Boolean) as Id<"operationalWorkItem">[];
  const uniqueWorkItemIds = Array.from(new Set(workItemIds));

  if (
    workItemIds.length !== args.snapshot.carryForwardItems.length ||
    uniqueWorkItemIds.length !== workItemIds.length
  ) {
    return {
      ok: false as const,
      message:
        "EOD Review automation cannot preserve unmapped or duplicated carry-forward work.",
      metadata: {
        carryForwardCount: args.snapshot.carryForwardItems.length,
        mappedWorkItemCount: uniqueWorkItemIds.length,
      },
    };
  }

  const workItems: Array<Doc<"operationalWorkItem">> = [];

  for (const workItemId of uniqueWorkItemIds) {
    const workItem = await ctx.db.get("operationalWorkItem", workItemId);

    if (!workItem) {
      return {
        ok: false as const,
        message:
          "EOD Review automation cannot preserve missing carry-forward work.",
        metadata: { workItemId },
      };
    }

    if (
      workItem.storeId !== args.storeId ||
      workItem.organizationId !== args.organizationId
    ) {
      return {
        ok: false as const,
        message:
          "EOD Review automation cannot preserve carry-forward work outside this store.",
        metadata: { workItemId },
      };
    }

    if (TERMINAL_WORK_ITEM_STATUSES.has(workItem.status)) {
      return {
        ok: false as const,
        message:
          "EOD Review automation cannot preserve terminal carry-forward work.",
        metadata: { status: workItem.status, workItemId },
      };
    }

    workItems.push(workItem);
  }

  return {
    ok: true as const,
    workItemIds: uniqueWorkItemIds,
    workItems,
  };
}

async function createCarryForwardWorkItems(
  ctx: MutationCtx,
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    actorUserId?: Id<"athenaUser">;
    items: NonNullable<CompleteDailyCloseArgs["createCarryForwardWorkItems"]>;
    organizationId: Id<"organization">;
    operatingDate: string;
    storeId: Id<"store">;
  },
) {
  const workItems: Array<Doc<"operationalWorkItem">> = [];
  const createdWorkItems: Array<Doc<"operationalWorkItem">> = [];

  for (const item of args.items) {
    const title = trimOptional(item.title);

    if (!title) {
      return {
        ok: false as const,
        message: "Carry-forward work items require a title.",
      };
    }

    const sourceId = sourceIdFromCarryForwardInput(item);

    if (sourceId) {
      const existingWorkItem = await findCurrentCarryForwardWorkItemBySource(
        ctx,
        {
          businessDate: args.operatingDate,
          sourceId,
          storeId: args.storeId,
        },
      );

      if (existingWorkItem) {
        workItems.push(existingWorkItem);
        continue;
      }
    }

    const workItem = await createOperationalWorkItemWithCtx(ctx, {
      storeId: args.storeId,
      organizationId: args.organizationId,
      type: DAILY_CLOSE_CARRY_FORWARD_TYPE,
      status: "open",
      priority: item.priority ?? "normal",
      title,
      notes: trimOptional(item.notes),
      dueAt: item.dueAt,
      createdByUserId: args.actorUserId,
      createdByStaffProfileId: args.actorStaffProfileId,
      assignedToStaffProfileId: item.assignedToStaffProfileId,
      metadata: {
        ...(item.metadata ?? {}),
        businessDate: args.operatingDate,
        ...(sourceId ? { carryForwardSourceId: sourceId } : {}),
        operatingDate: args.operatingDate,
        source: DAILY_CLOSE_SUBJECT_TYPE,
      },
    });

    if (workItem) {
      workItems.push(workItem);
      createdWorkItems.push(workItem);
    }
  }

  return {
    ok: true as const,
    createdWorkItems,
    workItems,
  };
}

async function markOtherDailyClosesNotCurrent(
  ctx: Pick<MutationCtx, "db">,
  args: {
    currentCloseId: Id<"dailyClose">;
    storeId: Id<"store">;
  },
) {
  const currentCloses = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_isCurrent", (q) =>
      q.eq("storeId", args.storeId).eq("isCurrent", true),
    )
    .take(DAILY_CLOSE_QUERY_LIMIT);

  await Promise.all(
    currentCloses
      .filter((dailyClose) => dailyClose._id !== args.currentCloseId)
      .map((dailyClose) =>
        ctx.db.patch("dailyClose", dailyClose._id, { isCurrent: false }),
      ),
  );
}

async function getNonActiveDailyCloseForDate(
  ctx: Pick<QueryCtx, "db">,
  args: {
    operatingDate: string;
    storeId: Id<"store">;
  },
) {
  const closes = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", args.storeId).eq("operatingDate", args.operatingDate),
    )
    .take(DAILY_CLOSE_QUERY_LIMIT);

  return (
    closes.find(
      (dailyClose) =>
        dailyClose.lifecycleStatus === "reopened" ||
        dailyClose.lifecycleStatus === "superseded",
    ) ?? null
  );
}

async function recordDailyCloseCompletedEvent(
  ctx: MutationCtx,
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    actorType: "human" | "automation";
    actorUserId?: Id<"athenaUser">;
    approvedByStaffProfileId?: Id<"staffProfile">;
    approvalProofId?: Id<"approvalProof">;
    automationDecisionReason?: string;
    automationPolicyVersion?: string;
    automationRunId?: Id<"automationRun">;
    dailyClose: Doc<"dailyClose">;
    operatingDate: string;
    organizationId: Id<"organization">;
    policyReviewedItemKeys?: string[];
    requestedByStaffProfileId?: Id<"staffProfile">;
    requestedByUserId?: Id<"athenaUser">;
    storeId: Id<"store">;
  },
) {
  return recordOperationalEventWithCtx(ctx, {
    storeId: args.storeId,
    organizationId: args.organizationId,
    eventType: "daily_close_completed",
    subjectType: DAILY_CLOSE_SUBJECT_TYPE,
    subjectId: args.dailyClose._id,
    subjectLabel: `EOD Review ${args.operatingDate}`,
    message:
      args.actorType === "automation"
        ? `Athena completed EOD Review for ${args.operatingDate}.`
        : `EOD Review completed for ${args.operatingDate}.`,
    actorUserId: args.actorUserId,
    actorStaffProfileId: args.actorStaffProfileId,
    actorType: args.actorType,
    automationDecisionReason: args.automationDecisionReason,
    automationPolicyVersion: args.automationPolicyVersion,
    automationRunId: args.automationRunId,
    metadata: {
      ...(args.approvalProofId
        ? { approvalProofId: args.approvalProofId }
        : {}),
      ...(args.approvedByStaffProfileId
        ? { approvedByStaffProfileId: args.approvedByStaffProfileId }
        : {}),
      ...(args.requestedByStaffProfileId
        ? { requestedByStaffProfileId: args.requestedByStaffProfileId }
        : {}),
      ...(args.requestedByUserId
        ? { requestedByUserId: args.requestedByUserId }
        : {}),
      ...(args.policyReviewedItemKeys
        ? { policyReviewedItemKeys: args.policyReviewedItemKeys }
        : {}),
      operatingDate: args.operatingDate,
      readiness: args.dailyClose.readiness,
      summary: args.dailyClose.summary,
    },
  });
}

export async function completeDailyCloseWithCtx(
  ctx: MutationCtx,
  args: CompleteDailyCloseArgs,
): Promise<CompleteDailyCloseResult> {
  const store = await getStore(ctx, args.storeId);

  if (!store) {
    return userError({
      code: "not_found",
      message: "Store not found.",
    });
  }

  if (args.organizationId && args.organizationId !== store.organizationId) {
    return userError({
      code: "authorization_failed",
      message: "EOD Review store does not belong to this organization.",
    });
  }

  const range = resolveOperatingDateRange(args);

  if (!range) {
    return userError({
      code: "validation_failed",
      message: "Operating date must use YYYY-MM-DD.",
    });
  }

  const snapshot = await buildDailyCloseSnapshotWithCtx(ctx, {
    endAt: args.endAt,
    operatingDate: args.operatingDate,
    startAt: args.startAt,
    storeId: args.storeId,
  });

  if (snapshot.existingClose?.status === "completed") {
    const carryForwardWorkItems = await Promise.all(
      snapshot.existingClose.carryForwardWorkItemIds.map((workItemId) =>
        ctx.db.get("operationalWorkItem", workItemId),
      ),
    );

    return ok({
      action: "already_completed",
      dailyClose: snapshot.existingClose,
      carryForwardWorkItems: carryForwardWorkItems.filter(Boolean) as Array<
        Doc<"operationalWorkItem">
      >,
    });
  }

  if (snapshot.blockers.length > 0) {
    return userError({
      code: "precondition_failed",
      message:
        "EOD Review cannot be completed while blocker items remain.",
      metadata: {
        blockerCount: snapshot.blockers.length,
      },
    });
  }

  const linkedWorkItemResult = await validateCarryForwardWorkItemIds(ctx, {
    storeId: args.storeId,
    workItemIds: uniqueOperationalWorkItemIds(
      args.carryForwardWorkItemIds ?? [],
    ),
  });

  if (!linkedWorkItemResult.ok) {
    return userError({
      code: "validation_failed",
      message: linkedWorkItemResult.message,
    });
  }

  if (!args.approvalProofId) {
    return approvalRequired(
      buildDailyCloseCompletionApprovalRequirement({
        operatingDate: args.operatingDate,
        storeId: args.storeId,
      }),
    );
  }

  const approvalProof = await consumeCommandApprovalProofWithCtx(ctx, {
    action: DAILY_CLOSE_COMPLETION_ACTION,
    approvalProofId: args.approvalProofId,
    requiredRole: "manager",
    requestedByStaffProfileId: args.actorStaffProfileId,
    storeId: args.storeId,
    subject: buildDailyCloseApprovalSubject({
      operatingDate: args.operatingDate,
      storeId: args.storeId,
    }),
  });

  if (approvalProof.kind !== "ok") {
    return approvalProof;
  }

  const createdWorkItemResult = await createCarryForwardWorkItems(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    items: args.createCarryForwardWorkItems ?? [],
    operatingDate: args.operatingDate,
    organizationId: store.organizationId,
    storeId: args.storeId,
  });

  if (!createdWorkItemResult.ok) {
    return userError({
      code: "validation_failed",
      message: createdWorkItemResult.message,
    });
  }

  const now = Date.now();
  const completionApprovalProofId = approvalProof.data.approvalProofId;
  const completionApprovedByStaffProfileId =
    approvalProof.data.approvedByStaffProfileId;
  const completionRequestedByStaffProfileId = args.actorStaffProfileId;
  const completionRequestedByUserId = args.actorUserId;
  const completedByStaffProfileId = completionApprovedByStaffProfileId;
  const reviewedItemKeys = snapshot.reviewItems.map((item) => item.key);
  const carryForwardWorkItemIds = uniqueOperationalWorkItemIds(
    [
      ...(snapshot.existingClose?.carryForwardWorkItemIds ?? []),
      ...linkedWorkItemResult.workItems.map((workItem) => workItem._id),
      ...createdWorkItemResult.workItems.map((workItem) => workItem._id),
    ] as Id<"operationalWorkItem">[],
  );
  const carryForwardWorkItems = (
    await Promise.all(
      carryForwardWorkItemIds.map((workItemId) =>
        ctx.db.get("operationalWorkItem", workItemId),
      ),
    )
  ).filter(Boolean) as Array<Doc<"operationalWorkItem">>;
  const notes = trimOptional(args.notes);
  const readiness = {
    ...snapshot.readiness,
    carryForwardCount: carryForwardWorkItemIds.length,
  };
  const summary = {
    ...snapshot.summary,
    carryForwardWorkItemCount: carryForwardWorkItemIds.length,
  };
  const reportSnapshotArgs = {
    carryForwardWorkItemIds,
    carryForwardWorkItems,
    completedAt: now,
    completedByStaffProfileId,
    completedByUserId: args.actorUserId,
    completionApprovalProofId,
    completionApprovedByStaffProfileId,
    completionRequestedByStaffProfileId,
    completionRequestedByUserId,
    actorType: "human" as const,
    notes,
    readiness,
    reviewedItemKeys,
    snapshot,
    summary,
  };
  const closeFields = {
    storeId: args.storeId,
    organizationId: store.organizationId,
    operatingDate: args.operatingDate,
    status: "completed" as const,
    lifecycleStatus: "active" as const,
    isCurrent: true,
    readiness,
    summary,
    sourceCompleteness: snapshot.sourceCompleteness,
    sourceSubjects: snapshot.sourceSubjects,
    reportSnapshot: buildDailyCloseReportSnapshot(reportSnapshotArgs),
    carryForwardWorkItemIds,
    reviewedItemKeys,
    notes,
    updatedAt: now,
    completedAt: now,
    completedByUserId: args.actorUserId,
    completedByStaffProfileId,
    completionApprovalProofId,
    completionApprovedByStaffProfileId,
    completionRequestedByStaffProfileId,
    completionRequestedByUserId,
    actorType: "human" as const,
  };

  let dailyCloseId = snapshot.existingClose?._id;

  if (dailyCloseId) {
    await ctx.db.patch("dailyClose", dailyCloseId, closeFields);
  } else {
    dailyCloseId = await ctx.db.insert("dailyClose", {
      ...closeFields,
      createdAt: now,
    });
  }

  await ctx.db.patch("dailyClose", dailyCloseId, {
    reportSnapshot: buildDailyCloseReportSnapshot({
      ...reportSnapshotArgs,
      dailyCloseId,
    }),
  });

  await markOtherDailyClosesNotCurrent(ctx, {
    currentCloseId: dailyCloseId,
    storeId: args.storeId,
  });

  const dailyClose = await ctx.db.get("dailyClose", dailyCloseId);

  if (!dailyClose) {
    return userError({
      code: "unavailable",
      message: "EOD Review could not be loaded after completion.",
      retryable: true,
    });
  }

  if (dailyClose.supersedesDailyCloseId) {
    await ctx.db.patch("dailyClose", dailyClose.supersedesDailyCloseId, {
      lifecycleStatus: "superseded",
      isCurrent: false,
      supersededByDailyCloseId: dailyClose._id,
      updatedAt: now,
    });
  }

  await patchDailyCloseCarryForwardWorkItemMetadata(ctx, {
    dailyCloseId: dailyClose._id,
    operatingDate: args.operatingDate,
    workItems: carryForwardWorkItems,
  });

  const operationalEvent = await recordDailyCloseCompletedEvent(ctx, {
    storeId: args.storeId,
    organizationId: store.organizationId,
    actorType: "human",
    actorUserId: args.actorUserId,
    actorStaffProfileId: args.actorStaffProfileId,
    approvalProofId: completionApprovalProofId,
    approvedByStaffProfileId: completionApprovedByStaffProfileId,
    requestedByStaffProfileId: completionRequestedByStaffProfileId,
    requestedByUserId: completionRequestedByUserId,
    dailyClose,
    operatingDate: args.operatingDate,
  });

  for (const workItem of createdWorkItemResult.createdWorkItems) {
    await recordOperationalEventWithCtx(ctx, {
      storeId: args.storeId,
      organizationId: store.organizationId,
      eventType: "daily_close_carry_forward_created",
      subjectType: DAILY_CLOSE_SUBJECT_TYPE,
      subjectId: dailyClose._id,
      subjectLabel: `EOD Review ${args.operatingDate}`,
      message: "EOD Review created a carry-forward work item.",
      actorUserId: args.actorUserId,
      actorStaffProfileId: args.actorStaffProfileId,
      workItemId: workItem._id,
      metadata: {
        operatingDate: args.operatingDate,
        workItemTitle: workItem.title,
      },
    });
  }

  return ok({
    action: "completed",
    dailyClose,
    carryForwardWorkItems,
    operationalEventId: operationalEvent?._id,
  });
}

export async function completeDailyCloseForAutomationWithCtx(
  ctx: MutationCtx,
  args: CompleteDailyCloseForAutomationArgs,
): Promise<CompleteDailyCloseResult> {
  const currentnessMode = args.currentnessMode ?? "mark_current";
  const markAsCurrent = currentnessMode === "mark_current";
  const store = await getStore(ctx, args.storeId);

  if (!store) {
    return userError({
      code: "not_found",
      message: "Store not found.",
    });
  }

  if (args.organizationId && args.organizationId !== store.organizationId) {
    return userError({
      code: "authorization_failed",
      message: "EOD Review store does not belong to this organization.",
    });
  }

  const range = resolveOperatingDateRange(args);

  if (!range) {
    return userError({
      code: "validation_failed",
      message: "Operating date must use YYYY-MM-DD.",
    });
  }

  const snapshot = await buildDailyCloseSnapshotWithCtx(ctx, {
    endAt: args.endAt,
    operatingDate: args.operatingDate,
    startAt: args.startAt,
    storeId: args.storeId,
  });

  if (snapshot.existingClose?.status === "completed") {
    const carryForwardWorkItems = await Promise.all(
      snapshot.existingClose.carryForwardWorkItemIds.map((workItemId) =>
        ctx.db.get("operationalWorkItem", workItemId),
      ),
    );

    return ok({
      action: "already_completed",
      dailyClose: snapshot.existingClose,
      carryForwardWorkItems: carryForwardWorkItems.filter(Boolean) as Array<
        Doc<"operationalWorkItem">
      >,
    });
  }

  if (!args.eodAutoCompletePolicy) {
    return userError({
      code: "precondition_failed",
      message:
        "EOD Review automation requires policy evidence before completion.",
    });
  }

  if (!snapshot.existingClose) {
    const nonActiveClose = await getNonActiveDailyCloseForDate(ctx, {
      operatingDate: args.operatingDate,
      storeId: args.storeId,
    });

    if (nonActiveClose) {
      return userError({
        code: "precondition_failed",
        message:
          "EOD Review automation cannot complete while a reopened or superseded close exists for this store day.",
        metadata: {
          dailyCloseId: nonActiveClose._id,
          lifecycleStatus: nonActiveClose.lifecycleStatus,
        },
      });
    }
  }

  if (
    snapshot.existingClose?.lifecycleStatus === "reopened" ||
    snapshot.existingClose?.lifecycleStatus === "superseded" ||
    snapshot.existingClose?.reopenedFromDailyCloseId ||
    snapshot.existingClose?.supersedesDailyCloseId
  ) {
    return userError({
      code: "precondition_failed",
      message:
        "EOD Review automation cannot complete while a reopened or superseded close exists for this store day.",
      metadata: {
        dailyCloseId: snapshot.existingClose._id,
        lifecycleStatus: snapshot.existingClose.lifecycleStatus,
      },
    });
  }

  if (currentnessMode === "historical_record") {
    const incompleteSources = incompleteSourceCompletenessEntries(snapshot);

    if (incompleteSources.length > 0) {
      return userError({
        code: "precondition_failed",
        message:
          "EOD Review automation cannot complete historic records without complete source evidence.",
        metadata: {
          incompleteSources,
        },
      });
    }
  }

  if (snapshot.blockers.length > 0) {
    return userError({
      code: "precondition_failed",
      message:
        "EOD Review automation cannot complete while blocker items remain.",
      metadata: {
        blockerCount: snapshot.blockers.length,
      },
    });
  }

  const reviewedItemKeys = new Set(args.policyReviewedItemKeys);
  const policyError = validateEodAutomationPolicyForSnapshot({
    policy: args.eodAutoCompletePolicy,
    reviewedItemKeys,
    snapshot,
  });

  if (policyError) {
    return userError({
      code: "precondition_failed",
      message: policyError.message,
      metadata: policyError.metadata,
    });
  }

  const unreviewedItemKeys = snapshot.reviewItems
    .map((item) => item.key)
    .filter((key) => !reviewedItemKeys.has(key));

  if (unreviewedItemKeys.length > 0) {
    return userError({
      code: "precondition_failed",
      message:
        "EOD Review automation cannot complete while review items are unreviewed by policy.",
      metadata: {
        reviewItemCount: snapshot.reviewItems.length,
        unreviewedItemKeys,
      },
    });
  }

  const carryForwardResult = await validateAutomationCarryForwardWorkItems(ctx, {
    organizationId: store.organizationId,
    snapshot,
    storeId: args.storeId,
  });

  if (!carryForwardResult.ok) {
    return userError({
      code: "precondition_failed",
      message: carryForwardResult.message,
      metadata: carryForwardResult.metadata,
    });
  }

  const now = Date.now();
  const carryForwardWorkItemIds = carryForwardResult.workItemIds;
  const carryForwardWorkItems = carryForwardResult.workItems;
  const readiness = {
    ...snapshot.readiness,
    carryForwardCount: carryForwardWorkItemIds.length,
  };
  const summary = {
    ...snapshot.summary,
    carryForwardWorkItemCount: carryForwardWorkItemIds.length,
  };
  const automationDecisionEvidence = buildEodAutomationDecisionEvidence({
    automationScheduleEvidence: args.automationScheduleEvidence,
    classification:
      snapshot.reviewItems.length > 0 ? "low_risk_review" : "clean_day",
    eligible: true,
    policy: args.eodAutoCompletePolicy,
    snapshot,
  });
  const reportSnapshotArgs = {
    actorType: "automation" as const,
    automationDecisionReason: args.automationDecisionReason,
    automationPolicyVersion: args.automationPolicyVersion,
    automationRunId: args.automationRunId,
    carryForwardWorkItemIds,
    carryForwardWorkItems,
    completedAt: now,
    currentnessMode,
    policyReviewedItemKeys: args.policyReviewedItemKeys,
    readiness,
    reviewedItemKeys: args.policyReviewedItemKeys,
    snapshot,
    summary,
  };
  const closeFields = {
    storeId: args.storeId,
    organizationId: store.organizationId,
    operatingDate: args.operatingDate,
    status: "completed" as const,
    lifecycleStatus: "active" as const,
    isCurrent: markAsCurrent,
    readiness,
    summary,
    sourceCompleteness: snapshot.sourceCompleteness,
    sourceSubjects: snapshot.sourceSubjects,
    reportSnapshot: buildDailyCloseReportSnapshot(reportSnapshotArgs),
    carryForwardWorkItemIds,
    reviewedItemKeys: args.policyReviewedItemKeys,
    actorType: "automation" as const,
    automationRunId: args.automationRunId,
    automationPolicyVersion: args.automationPolicyVersion,
    automationDecisionReason: args.automationDecisionReason,
    policyReviewedItemKeys: args.policyReviewedItemKeys,
    updatedAt: now,
    completedAt: now,
  };

  let dailyCloseId = snapshot.existingClose?._id;

  if (dailyCloseId) {
    await ctx.db.patch("dailyClose", dailyCloseId, closeFields);
  } else {
    dailyCloseId = await ctx.db.insert("dailyClose", {
      ...closeFields,
      createdAt: now,
    });
  }

  await ctx.db.patch("dailyClose", dailyCloseId, {
    reportSnapshot: buildDailyCloseReportSnapshot({
      ...reportSnapshotArgs,
      dailyCloseId,
    }),
  });

  if (markAsCurrent) {
    await markOtherDailyClosesNotCurrent(ctx, {
      currentCloseId: dailyCloseId,
      storeId: args.storeId,
    });
  }

  const dailyClose = await ctx.db.get("dailyClose", dailyCloseId);

  if (!dailyClose) {
    return userError({
      code: "unavailable",
      message: "EOD Review could not be loaded after automation completion.",
      retryable: true,
    });
  }

  if (markAsCurrent && dailyClose.supersedesDailyCloseId) {
    await ctx.db.patch("dailyClose", dailyClose.supersedesDailyCloseId, {
      lifecycleStatus: "superseded",
      isCurrent: false,
      supersededByDailyCloseId: dailyClose._id,
      updatedAt: now,
    });
  }

  await patchDailyCloseCarryForwardWorkItemMetadata(ctx, {
    dailyCloseId: dailyClose._id,
    operatingDate: args.operatingDate,
    workItems: carryForwardWorkItems,
  });

  const operationalEvent = await recordDailyCloseCompletedEvent(ctx, {
    storeId: args.storeId,
    organizationId: store.organizationId,
    actorType: "automation",
    automationDecisionReason: args.automationDecisionReason,
    automationPolicyVersion: args.automationPolicyVersion,
    automationRunId: args.automationRunId,
    dailyClose,
    operatingDate: args.operatingDate,
    policyReviewedItemKeys: args.policyReviewedItemKeys,
  });

  return ok({
    action: "completed",
    automationDecisionEvidence,
    dailyClose,
    carryForwardWorkItems,
    operationalEventId: operationalEvent?._id,
  });
}

async function listDailyOpeningHandoffsForCarryForward(
  ctx: Pick<QueryCtx, "db">,
  args: {
    dailyCloseId: Id<"dailyClose">;
    storeId: Id<"store">;
    workItemId: Id<"operationalWorkItem">;
  },
) {
  const openings = await ctx.db
    .query("dailyOpening")
    .withIndex("by_storeId_status", (q) =>
      q.eq("storeId", args.storeId).eq("status", "started"),
    )
    .take(DAILY_CLOSE_QUERY_LIMIT);

  return openings
    .filter(
      (opening) =>
        opening.priorDailyCloseId === args.dailyCloseId &&
        opening.carryForwardWorkItemIds.includes(args.workItemId),
    )
    .map((opening) => ({
      dailyOpeningId: opening._id,
      operatingDate: opening.operatingDate,
      acknowledgedItemKeys: opening.acknowledgedItemKeys,
      startedAt: opening.startedAt,
    }));
}

function carryForwardResolutionValidationError(message: string) {
  return userError({
    code: "precondition_failed",
    message,
  });
}

export async function resolveDailyCloseCarryForwardWithCtx(
  ctx: MutationCtx,
  args: ResolveDailyCloseCarryForwardArgs,
): Promise<ResolveDailyCloseCarryForwardResult> {
  const reason = trimOptional(args.reason);

  if (!reason) {
    return userError({
      code: "validation_failed",
      message: "A carry-forward resolution reason is required.",
    });
  }

  const store = await getStore(ctx, args.storeId);

  if (!store) {
    return userError({
      code: "not_found",
      message: "Store not found.",
    });
  }

  if (args.organizationId && args.organizationId !== store.organizationId) {
    return userError({
      code: "authorization_failed",
      message: "Carry-forward work does not belong to this organization.",
    });
  }

  const dailyClose = await ctx.db.get("dailyClose", args.dailyCloseId);

  if (!dailyClose || dailyClose.storeId !== args.storeId) {
    return userError({
      code: "not_found",
      message: "EOD Review was not found for this store.",
    });
  }

  if (dailyClose.operatingDate !== args.businessDate) {
    return carryForwardResolutionValidationError(
      "Carry-forward work does not match this business date.",
    );
  }

  const workItem = await ctx.db.get("operationalWorkItem", args.workItemId);

  if (!workItem || workItem.storeId !== args.storeId) {
    return userError({
      code: "not_found",
      message: "Carry-forward work was not found for this store.",
    });
  }

  if (workItem.organizationId !== store.organizationId) {
    return userError({
      code: "authorization_failed",
      message: "Carry-forward work does not belong to this organization.",
    });
  }

  if (!dailyClose.carryForwardWorkItemIds.includes(workItem._id)) {
    return carryForwardResolutionValidationError(
      "Carry-forward work is not linked to this EOD Review.",
    );
  }

  if (workItem.type !== DAILY_CLOSE_CARRY_FORWARD_TYPE) {
    return carryForwardResolutionValidationError(
      "Only Daily Close carry-forward work can be resolved here.",
    );
  }

  if (TERMINAL_WORK_ITEM_STATUSES.has(workItem.status)) {
    return carryForwardResolutionValidationError(
      "Carry-forward work is already completed or cancelled.",
    );
  }

  if (
    !OPEN_OPERATIONAL_WORK_ITEM_STATUSES.includes(
      workItem.status as (typeof OPEN_OPERATIONAL_WORK_ITEM_STATUSES)[number],
    )
  ) {
    return carryForwardResolutionValidationError(
      "Carry-forward work must be open before it can be resolved.",
    );
  }

  const metadataBusinessDate = carryForwardBusinessDate(workItem);

  if (metadataBusinessDate !== args.businessDate) {
    return carryForwardResolutionValidationError(
      "Carry-forward source metadata does not match this business date.",
    );
  }

  if (stringFromMetadata(workItem.metadata, "source") !== DAILY_CLOSE_SUBJECT_TYPE) {
    return carryForwardResolutionValidationError(
      "Carry-forward source metadata is incomplete.",
    );
  }

  const metadataDailyCloseId = stringFromMetadata(
    workItem.metadata,
    "dailyCloseId",
  );

  if (metadataDailyCloseId !== args.dailyCloseId) {
    return carryForwardResolutionValidationError(
      "Carry-forward source metadata does not match this EOD Review.",
    );
  }

  const metadataSourceId = carryForwardSourceId(workItem);

  if (metadataSourceId !== args.sourceId) {
    return carryForwardResolutionValidationError(
      "Carry-forward source metadata does not match this source.",
    );
  }

  if (!args.approvalProofId) {
    return approvalRequired(
      buildDailyCloseCarryForwardApprovalRequirement({
        businessDate: args.businessDate,
        dailyCloseId: args.dailyCloseId,
        outcome: args.outcome,
        sourceId: args.sourceId,
      }),
    );
  }

  const approvalProofRecord = await ctx.db.get("approvalProof", args.approvalProofId);
  const approvalProof = await consumeCommandApprovalProofWithCtx(ctx, {
    action: DAILY_CLOSE_CARRY_FORWARD_RESOLUTION_ACTION,
    approvalProofId: args.approvalProofId,
    requiredRole: "manager",
    requestedByStaffProfileId: approvalProofRecord?.requestedByStaffProfileId
      ? args.actorStaffProfileId
      : undefined,
    storeId: args.storeId,
    subject: buildDailyCloseCarryForwardApprovalSubject({
      businessDate: args.businessDate,
      dailyCloseId: args.dailyCloseId,
      outcome: args.outcome,
      sourceId: args.sourceId,
    }),
  });

  if (approvalProof.kind !== "ok") {
    return approvalProof;
  }

  const now = Date.now();
  const nextStatus = args.outcome === "completed" ? "completed" : "cancelled";
  const handoffs = await listDailyOpeningHandoffsForCarryForward(ctx, {
    dailyCloseId: args.dailyCloseId,
    storeId: args.storeId,
    workItemId: args.workItemId,
  });
  const handoff = {
    dailyOpeningIds: handoffs.map((opening) => opening.dailyOpeningId),
    openings: handoffs,
  };
  const priorState = {
    approvalState: workItem.approvalState,
    status: workItem.status,
  };
  const nextState = {
    approvalState: workItem.approvalState,
    status: nextStatus,
  };
  const resolutionEvidence = {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    approvalBasis: {
      actionKey: DAILY_CLOSE_CARRY_FORWARD_RESOLUTION_ACTION.key,
      approvalProofId: approvalProof.data.approvalProofId,
      approvedByStaffProfileId: approvalProof.data.approvedByStaffProfileId,
      requiredRole: "manager",
      subject: buildDailyCloseCarryForwardApprovalSubject({
        businessDate: args.businessDate,
        dailyCloseId: args.dailyCloseId,
        outcome: args.outcome,
        sourceId: args.sourceId,
      }),
    },
    approvalProofId: approvalProof.data.approvalProofId,
    approvedByStaffProfileId: approvalProof.data.approvedByStaffProfileId,
    businessDate: args.businessDate,
    dailyCloseId: args.dailyCloseId,
    handoff,
    nextStatus,
    outcome: args.outcome,
    priorStatus: workItem.status,
    reason,
    resolvedAt: now,
    sourceId: args.sourceId,
  };

  await ctx.db.patch("operationalWorkItem", workItem._id, {
    status: nextStatus,
    ...(nextStatus === "completed" ? { completedAt: now } : {}),
    metadata: {
      ...(workItem.metadata ?? {}),
      carryForwardResolution: resolutionEvidence,
    },
  });

  const updatedWorkItem = await ctx.db.get("operationalWorkItem", workItem._id);

  if (!updatedWorkItem) {
    return userError({
      code: "unavailable",
      message: "Carry-forward work could not be loaded after resolution.",
      retryable: true,
    });
  }

  const event = await recordOperationalEventWithCtx(ctx, {
    storeId: args.storeId,
    organizationId: store.organizationId,
    eventType: `daily_close_carry_forward_${nextStatus}`,
    subjectType: DAILY_CLOSE_CARRY_FORWARD_TYPE,
    subjectId: workItem._id,
    subjectLabel: workItem.title,
    message:
      nextStatus === "completed"
        ? "Daily Close carry-forward work completed."
        : "Daily Close carry-forward work cancelled.",
    reason,
    actorUserId: args.actorUserId,
    actorStaffProfileId: args.actorStaffProfileId,
    workItemId: workItem._id,
    metadata: {
      approvalBasis: resolutionEvidence.approvalBasis,
      approvalProofId: approvalProof.data.approvalProofId,
      approvedByStaffProfileId: approvalProof.data.approvedByStaffProfileId,
      businessDate: args.businessDate,
      dailyCloseId: args.dailyCloseId,
      handoff,
      nextState,
      outcome: args.outcome,
      priorState,
      reason,
      resolvedAt: now,
      sourceReference: {
        dailyCloseId: args.dailyCloseId,
        sourceId: args.sourceId,
        workItemId: workItem._id,
      },
    },
  });

  return ok({
    action: args.outcome,
    operationalEventId: event?._id,
    workItem: updatedWorkItem,
  });
}

export async function reopenDailyCloseWithCtx(
  ctx: MutationCtx,
  args: ReopenDailyCloseArgs,
): Promise<ReopenDailyCloseResult> {
  const reason = trimOptional(args.reason);

  if (!reason) {
    return userError({
      code: "validation_failed",
      message: "A reopen reason is required.",
    });
  }

  const originalDailyClose = await ctx.db.get("dailyClose", args.dailyCloseId);

  if (!originalDailyClose || originalDailyClose.storeId !== args.storeId) {
    return userError({
      code: "not_found",
      message: "EOD Review was not found for this store.",
    });
  }

  if (
    args.organizationId &&
    args.organizationId !== originalDailyClose.organizationId
  ) {
    return userError({
      code: "authorization_failed",
      message: "EOD Review store does not belong to this organization.",
    });
  }

  if (
    originalDailyClose.status !== "completed" ||
    !originalDailyClose.reportSnapshot
  ) {
    return userError({
      code: "precondition_failed",
      message: "Only a completed EOD Review can be reopened.",
    });
  }

  if (originalDailyClose.lifecycleStatus === "superseded") {
    return userError({
      code: "precondition_failed",
      message: "This EOD Review has already been superseded.",
    });
  }

  const existingReopenedClose = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_operatingDate_lifecycleStatus", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("operatingDate", originalDailyClose.operatingDate)
        .eq("lifecycleStatus", "active"),
    )
    .first();
  const activeReopenedClose =
    existingReopenedClose?._id === originalDailyClose._id
      ? null
      : existingReopenedClose;

  if (
    activeReopenedClose?.status === "open" &&
    activeReopenedClose.reopenedFromDailyCloseId === originalDailyClose._id
  ) {
    return ok({
      action: "already_reopened",
      originalDailyClose,
      reopenedDailyClose: activeReopenedClose,
    });
  }

  if (
    originalDailyClose.lifecycleStatus === "reopened" ||
    activeReopenedClose
  ) {
    return userError({
      code: "precondition_failed",
      message: "This EOD Review is already reopened.",
    });
  }

  if (!args.approvalProofId) {
    return approvalRequired(
      buildDailyCloseReopenApprovalRequirement({
        dailyCloseId: originalDailyClose._id,
        operatingDate: originalDailyClose.operatingDate,
        storeId: args.storeId,
      }),
    );
  }

  const approvalProof = await consumeCommandApprovalProofWithCtx(ctx, {
    action: DAILY_CLOSE_REOPEN_ACTION,
    approvalProofId: args.approvalProofId,
    requiredRole: "manager",
    requestedByStaffProfileId: args.actorStaffProfileId,
    storeId: args.storeId,
    subject: {
      id: originalDailyClose._id,
      label: `EOD Review ${originalDailyClose.operatingDate}`,
      type: DAILY_CLOSE_SUBJECT_TYPE,
    },
  });

  if (approvalProof.kind !== "ok") {
    return approvalProof;
  }

  const now = Date.now();
  const reopenApprovalProofId = approvalProof.data.approvalProofId;
  const reopenApprovedByStaffProfileId =
    approvalProof.data.approvedByStaffProfileId;
  const reopenRequestedByStaffProfileId = args.actorStaffProfileId;
  const reopenRequestedByUserId = args.actorUserId;
  const originalReportSnapshot =
    originalDailyClose.reportSnapshot as DailyCloseReportSnapshot;
  const reopenedShouldBeCurrent =
    originalDailyClose.isCurrent !== false &&
    originalReportSnapshot.closeMetadata.currentnessMode !== "historical_record";
  const reopenedDailyCloseId = await ctx.db.insert("dailyClose", {
    storeId: originalDailyClose.storeId,
    organizationId: originalDailyClose.organizationId,
    operatingDate: originalDailyClose.operatingDate,
    status: "open",
    lifecycleStatus: "active",
    isCurrent: reopenedShouldBeCurrent,
    readiness: originalDailyClose.readiness,
    summary: originalDailyClose.summary,
    sourceSubjects: originalDailyClose.sourceSubjects,
    carryForwardWorkItemIds: originalDailyClose.carryForwardWorkItemIds,
    reviewedItemKeys: originalDailyClose.reviewedItemKeys,
    notes: originalDailyClose.notes,
    createdAt: now,
    updatedAt: now,
    reopenedAt: now,
    reopenedByUserId: args.actorUserId,
    reopenedByStaffProfileId: reopenApprovedByStaffProfileId,
    reopenApprovalProofId,
    reopenApprovedByStaffProfileId,
    reopenRequestedByStaffProfileId,
    reopenRequestedByUserId,
    reopenReason: reason,
    reopenedFromDailyCloseId: originalDailyClose._id,
    supersedesDailyCloseId: originalDailyClose._id,
  });

  await ctx.db.patch("dailyClose", originalDailyClose._id, {
    lifecycleStatus: "reopened",
    isCurrent: false,
    reopenedAt: now,
    reopenedByUserId: args.actorUserId,
    reopenedByStaffProfileId: reopenApprovedByStaffProfileId,
    reopenApprovalProofId,
    reopenApprovedByStaffProfileId,
    reopenRequestedByStaffProfileId,
    reopenRequestedByUserId,
    reopenReason: reason,
    supersededByDailyCloseId: reopenedDailyCloseId,
    updatedAt: now,
  });

  if (reopenedShouldBeCurrent) {
    await markOtherDailyClosesNotCurrent(ctx, {
      currentCloseId: reopenedDailyCloseId,
      storeId: args.storeId,
    });
  }

  const reopenedDailyClose = await ctx.db.get(
    "dailyClose",
    reopenedDailyCloseId,
  );
  const updatedOriginalDailyClose = await ctx.db.get(
    "dailyClose",
    originalDailyClose._id,
  );

  if (!reopenedDailyClose || !updatedOriginalDailyClose) {
    return userError({
      code: "unavailable",
      message: "Reopened EOD Review could not be loaded.",
      retryable: true,
    });
  }

  await recordOperationalEventWithCtx(ctx, {
    storeId: args.storeId,
    organizationId: originalDailyClose.organizationId,
    eventType: "daily_close_reopened",
    subjectType: DAILY_CLOSE_SUBJECT_TYPE,
    subjectId: originalDailyClose._id,
    subjectLabel: `EOD Review ${originalDailyClose.operatingDate}`,
    message: `EOD Review reopened for ${originalDailyClose.operatingDate}.`,
    actorUserId: args.actorUserId,
    actorStaffProfileId: args.actorStaffProfileId,
    metadata: {
      approvalProofId: reopenApprovalProofId,
      approvedByStaffProfileId: reopenApprovedByStaffProfileId,
      ...(reopenRequestedByStaffProfileId
        ? { requestedByStaffProfileId: reopenRequestedByStaffProfileId }
        : {}),
      ...(reopenRequestedByUserId
        ? { requestedByUserId: reopenRequestedByUserId }
        : {}),
      operatingDate: originalDailyClose.operatingDate,
      reason,
      reopenedDailyCloseId,
    },
  });

  return ok({
    action: "reopened",
    originalDailyClose: updatedOriginalDailyClose,
    reopenedDailyClose,
  });
}

export async function getDailyCloseOpeningContextWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    operatingDate: string;
    storeId: Id<"store">;
  },
) {
  const priorClose = await getPriorCompletedDailyClose(ctx, args);

  if (!priorClose) {
    return {
      priorClose: null,
      carryForwardWorkItems: [],
    };
  }

  const carryForwardWorkItems = await Promise.all(
    priorClose.carryForwardWorkItemIds.map((workItemId) =>
      ctx.db.get("operationalWorkItem", workItemId),
    ),
  );

  return {
    priorClose,
    carryForwardWorkItems: carryForwardWorkItems.filter(
      (workItem): workItem is Doc<"operationalWorkItem"> => {
        if (!workItem) {
          return false;
        }

        return !TERMINAL_WORK_ITEM_STATUSES.has(workItem.status);
      },
    ),
  };
}

function redactDailyCloseOpeningContextForBroadView(
  context: Awaited<ReturnType<typeof getDailyCloseOpeningContextWithCtx>>,
) {
  return {
    priorClose: context.priorClose
      ? {
          actorType: context.priorClose.actorType,
          automationPolicyVersion: context.priorClose.automationPolicyVersion,
          completedAt: context.priorClose.completedAt,
          lifecycleStatus: context.priorClose.lifecycleStatus,
          operatingDate: context.priorClose.operatingDate,
          status: context.priorClose.status,
        }
      : null,
    carryForwardWorkItems: context.carryForwardWorkItems.map((workItem) => ({
      approvalState: workItem.approvalState,
      ...(workItem.dueAt ? { dueAt: workItem.dueAt } : {}),
      priority: workItem.priority,
      status: workItem.status,
      title: workItem.title,
      type: workItem.type,
    })),
  };
}

export async function listCompletedDailyCloseHistoryWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    includeManagerReviewEvidence?: boolean;
    limit?: number;
    storeId: Id<"store">;
  },
) {
  const includeManagerReviewEvidence = args.includeManagerReviewEvidence ?? true;
  const limit = Math.min(
    Math.max(Math.floor(args.limit ?? 50), 1),
    DAILY_CLOSE_QUERY_LIMIT,
  );
  const completedCloses = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_status_operatingDate", (q) =>
      q.eq("storeId", args.storeId).eq("status", "completed"),
    )
    .order("desc")
    .take(limit);
  const completedClosesWithSnapshots = completedCloses.filter(
    (dailyClose) => dailyClose.reportSnapshot,
  );
  const completedByStaffProfileIds = await Promise.all(
    completedClosesWithSnapshots.map((dailyClose) =>
      dailyClose.completedByStaffProfileId
        ? Promise.resolve(dailyClose.completedByStaffProfileId)
        : getDailyCloseCompletionEventStaffProfileId(ctx, {
            dailyCloseId: dailyClose._id,
            storeId: args.storeId,
          }),
    ),
  );
  const staffNamesById = await buildStaffNamesById(
    ctx,
    completedByStaffProfileIds,
  );

  return completedClosesWithSnapshots.map((dailyClose, index) => {
    const completedByStaffProfileId = completedByStaffProfileIds[index];

    return toDailyCloseHistoryListItem(
      dailyClose,
      completedByStaffProfileId
        ? (staffNamesById.get(completedByStaffProfileId) ?? null)
        : null,
      completedByStaffProfileId,
      includeManagerReviewEvidence,
    );
  });
}

export async function getCompletedDailyCloseHistoryDetailWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    dailyCloseId: Id<"dailyClose">;
    includeManagerReviewEvidence?: boolean;
    storeId: Id<"store">;
  },
) {
  const dailyClose = await ctx.db.get("dailyClose", args.dailyCloseId);

  if (
    !dailyClose ||
    dailyClose.storeId !== args.storeId ||
    dailyClose.status !== "completed" ||
    !dailyClose.reportSnapshot
  ) {
    return null;
  }

  const completedByStaffProfileId =
    dailyClose.completedByStaffProfileId ??
    (await getDailyCloseCompletionEventStaffProfileId(ctx, {
      dailyCloseId: dailyClose._id,
      storeId: args.storeId,
    }));
  const staffNamesById = await buildStaffNamesById(ctx, [
    completedByStaffProfileId,
  ]);
  const attribution = completionAttributionForDailyClose(
    dailyClose,
    completedByStaffProfileId,
  );
  const reportSnapshot = dailyClose.reportSnapshot as DailyCloseReportSnapshot;
  const includeManagerReviewEvidence = args.includeManagerReviewEvidence ?? true;

  return {
    dailyCloseId: dailyClose._id,
    operatingDate: dailyClose.operatingDate,
    actorType: attribution.actorType,
    automationDecisionReason: attribution.automationDecisionReason,
    automationPolicyVersion: attribution.automationPolicyVersion,
    automationRunId: attribution.automationRunId,
    completedAt: dailyClose.completedAt,
    completedByUserId: attribution.completedByUserId,
    completedByStaffProfileId: attribution.completedByStaffProfileId,
    completedByStaffName: attribution.completedByStaffProfileId
      ? (staffNamesById.get(attribution.completedByStaffProfileId) ?? null)
      : null,
    reportSnapshot: includeManagerReviewEvidence
      ? reportSnapshot
      : redactDailyCloseReportSnapshotForBroadView(reportSnapshot),
  };
}

export const getDailyCloseSnapshot = query({
  args: {
    endAt: v.optional(v.number()),
    operatingDate: v.string(),
    startAt: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      throw new Error("Store not found.");
    }

    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    const membership = await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot view EOD Review for this store.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    return buildDailyCloseSnapshotWithCtx(ctx, {
      ...args,
      includeManagerReviewEvidence: membership.role === "full_admin",
    });
  },
});

export const completeDailyClose = mutation({
  args: {
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    approvalProofId: v.optional(v.id("approvalProof")),
    carryForwardWorkItemIds: v.optional(v.array(v.id("operationalWorkItem"))),
    createCarryForwardWorkItems: v.optional(
      v.array(
        v.object({
          title: v.string(),
          notes: v.optional(v.string()),
          priority: v.optional(v.string()),
          assignedToStaffProfileId: v.optional(v.id("staffProfile")),
          dueAt: v.optional(v.number()),
          metadata: v.optional(v.record(v.string(), v.any())),
        }),
      ),
    ),
    endAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    operatingDate: v.string(),
    organizationId: v.optional(v.id("organization")),
    reviewedItemKeys: v.optional(v.array(v.string())),
    startAt: v.optional(v.number()),
    storeId: v.id("store"),
  },
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) => {
    let athenaUser: Awaited<
      ReturnType<typeof requireAuthenticatedAthenaUserWithCtx>
    >;
    try {
      athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    } catch {
      return userError({
        code: "authorization_failed",
        message: "Sign in again to continue.",
      });
    }

    return completeDailyCloseWithCtx(ctx, {
      ...args,
      actorUserId: athenaUser._id,
    });
  },
});

export const completeDailyCloseForAutomation = internalMutation({
  args: {
    automationDecisionReason: v.string(),
    automationPolicyVersion: v.string(),
    automationRunId: v.id("automationRun"),
    automationScheduleEvidence: v.optional(
      v.object({
        closedAt: v.optional(v.number()),
        evaluationAt: v.optional(v.number()),
        openedAt: v.optional(v.number()),
        scheduleVersion: v.optional(v.string()),
        source: v.union(
          v.literal("canonical_schedule"),
          v.literal("compatibility_policy"),
        ),
        storeScheduleId: v.optional(v.string()),
      }),
    ),
    eodAutoCompletePolicy: v.object({
      cleanDayAutoCompleteEnabled: v.boolean(),
      maxAbsoluteCashVariance: v.number(),
      maxVoidedSaleCount: v.number(),
      maxVoidedSaleTotal: v.number(),
    }),
    currentnessMode: v.optional(
      v.union(v.literal("mark_current"), v.literal("historical_record")),
    ),
    endAt: v.optional(v.number()),
    operatingDate: v.string(),
    organizationId: v.optional(v.id("organization")),
    policyReviewedItemKeys: v.array(v.string()),
    startAt: v.optional(v.number()),
    storeId: v.id("store"),
  },
  returns: commandResultValidator(v.any()),
  handler: (ctx, args) => completeDailyCloseForAutomationWithCtx(ctx, args),
});

export const resolveDailyCloseCarryForward = mutation({
  args: {
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    approvalProofId: v.optional(v.id("approvalProof")),
    businessDate: v.string(),
    dailyCloseId: v.id("dailyClose"),
    organizationId: v.optional(v.id("organization")),
    outcome: v.union(v.literal("completed"), v.literal("cancelled")),
    reason: v.string(),
    sourceId: v.string(),
    storeId: v.id("store"),
    workItemId: v.id("operationalWorkItem"),
  },
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) => {
    let athenaUser: Awaited<
      ReturnType<typeof requireAuthenticatedAthenaUserWithCtx>
    >;
    try {
      athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    } catch {
      return userError({
        code: "authorization_failed",
        message: "Sign in again to continue.",
      });
    }

    const store = await ctx.db.get("store", args.storeId);

    if (!store) {
      return userError({
        code: "not_found",
        message: "Store not found.",
      });
    }

    try {
      await requireOrganizationMemberRoleWithCtx(ctx, {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage:
          "You cannot resolve carry-forward work for this store.",
        organizationId: store.organizationId,
        userId: athenaUser._id,
      });
    } catch {
      return userError({
        code: "authorization_failed",
        message: "You cannot resolve carry-forward work for this store.",
      });
    }

    const actorStaffProfile = await ctx.db
      .query("staffProfile")
      .withIndex("by_storeId_linkedUserId", (q) =>
        q.eq("storeId", args.storeId).eq("linkedUserId", athenaUser._id),
      )
      .first();

    return resolveDailyCloseCarryForwardWithCtx(ctx, {
      ...args,
      actorStaffProfileId: actorStaffProfile?._id,
      actorUserId: athenaUser._id,
      organizationId: args.organizationId ?? store.organizationId,
    });
  },
});

export const reopenDailyClose = mutation({
  args: {
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    approvalProofId: v.optional(v.id("approvalProof")),
    dailyCloseId: v.id("dailyClose"),
    organizationId: v.optional(v.id("organization")),
    reason: v.string(),
    storeId: v.id("store"),
  },
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) => {
    let athenaUser: Awaited<
      ReturnType<typeof requireAuthenticatedAthenaUserWithCtx>
    >;
    try {
      athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    } catch {
      return userError({
        code: "authorization_failed",
        message: "Sign in again to continue.",
      });
    }

    return reopenDailyCloseWithCtx(ctx, {
      ...args,
      actorUserId: athenaUser._id,
    });
  },
});

export const getDailyCloseOpeningContext = query({
  args: {
    operatingDate: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) =>
    redactDailyCloseOpeningContextForBroadView(
      await getDailyCloseOpeningContextWithCtx(ctx, args),
    ),
});

export const listCompletedDailyCloseHistory = query({
  args: {
    limit: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: (ctx, args) =>
    listCompletedDailyCloseHistoryWithCtx(ctx, {
      ...args,
      includeManagerReviewEvidence: false,
    }),
});

export const getCompletedDailyCloseHistoryDetail = query({
  args: {
    dailyCloseId: v.id("dailyClose"),
    storeId: v.id("store"),
  },
  handler: (ctx, args) =>
    getCompletedDailyCloseHistoryDetailWithCtx(ctx, {
      ...args,
      includeManagerReviewEvidence: false,
    }),
});
