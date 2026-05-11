import {
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

const DAILY_CLOSE_QUERY_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OPERATING_DATE_RANGE_MS = 36 * 60 * 60 * 1000;
const DAILY_CLOSE_SUBJECT_TYPE = "daily_close";
const DAILY_CLOSE_CARRY_FORWARD_TYPE = "daily_close_carry_forward";
const TERMINAL_WORK_ITEM_STATUSES = new Set(["completed", "cancelled"]);
const ACTIVE_REGISTER_STATUSES = ["open", "active", "closing"] as const;
const OPEN_POS_SESSION_STATUSES = ["active", "held"] as const;
const DAILY_CLOSE_COMPLETION_ACTION = APPROVAL_ACTIONS.dailyCloseCompletion;
const DAILY_CLOSE_REOPEN_ACTION = APPROVAL_ACTIONS.dailyCloseReopen;
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
  metadata?: Record<string, unknown>;
};

type DailyCloseReadinessStatus = "blocked" | "needs_review" | "ready";

type DailyCloseReadiness = {
  status: DailyCloseReadinessStatus;
  blockerCount: number;
  reviewCount: number;
  carryForwardCount: number;
  readyCount: number;
};

type DailyCloseSummary = {
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
  transactionCount: number;
  voidedTransactionCount: number;
  paymentTotals: Array<{
    method: string;
    amount: number;
    transactionCount: number;
  }>;
};

type DailyCloseSnapshot = {
  operatingDate: string;
  storeId: Id<"store">;
  organizationId: Id<"organization"> | null;
  startAt: number;
  endAt: number;
  existingClose: Doc<"dailyClose"> | null;
  completedClose: {
    completedAt?: number;
    completedByStaffProfileId?: Id<"staffProfile">;
    completedByStaffName?: string | null;
    completedByUserId?: Id<"athenaUser">;
    notes?: string;
  } | null;
  priorClose: Doc<"dailyClose"> | null;
  status: "blocked" | "needs_review" | "carry_forward" | "ready" | "completed";
  blockers: DailyCloseItem[];
  reviewItems: DailyCloseItem[];
  carryForwardItems: DailyCloseItem[];
  readyItems: DailyCloseItem[];
  readiness: DailyCloseReadiness;
  summary: DailyCloseSummary;
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
    notes?: string;
    reviewedItemKeys?: string[];
    carryForwardWorkItemIds: Id<"operationalWorkItem">[];
  };
  readiness: DailyCloseReadiness;
  summary: Record<string, unknown>;
  reviewedItems: DailyCloseItem[];
  carryForwardItems: DailyCloseItem[];
  readyItems: DailyCloseItem[];
  sourceSubjects: DailyCloseSnapshot["sourceSubjects"];
};

function normalizeCompletedDailyCloseSnapshot(args: {
  dailyClose: Doc<"dailyClose">;
  completedByStaffName?: string | null;
  completedByStaffProfileId?: Id<"staffProfile">;
}): DailyCloseSnapshot | null {
  const reportSnapshot = args.dailyClose.reportSnapshot as
    | DailyCloseReportSnapshot
    | undefined;

  if (!reportSnapshot) {
    return null;
  }

  return {
    operatingDate: reportSnapshot.closeMetadata.operatingDate,
    storeId: reportSnapshot.closeMetadata.storeId,
    organizationId: reportSnapshot.closeMetadata.organizationId,
    startAt: reportSnapshot.closeMetadata.startAt,
    endAt: reportSnapshot.closeMetadata.endAt,
    existingClose: args.dailyClose,
    completedClose: {
      completedAt: reportSnapshot.closeMetadata.completedAt,
      completedByStaffProfileId: args.completedByStaffProfileId,
      completedByStaffName: args.completedByStaffName ?? null,
      completedByUserId: reportSnapshot.closeMetadata.completedByUserId,
      notes: reportSnapshot.closeMetadata.notes,
    },
    priorClose: null,
    status: "completed",
    blockers: [],
    reviewItems: reportSnapshot.reviewedItems,
    carryForwardItems: reportSnapshot.carryForwardItems,
    readyItems: reportSnapshot.readyItems,
    readiness: reportSnapshot.readiness,
    summary: reportSnapshot.summary as DailyCloseSummary,
    sourceSubjects: reportSnapshot.sourceSubjects,
  };
}

type DailyCloseHistoryListItem = {
  dailyCloseId: Id<"dailyClose">;
  operatingDate: string;
  completedAt?: number;
  completedByUserId?: Id<"athenaUser">;
  completedByStaffProfileId?: Id<"staffProfile">;
  completedByStaffName?: string | null;
  readinessStatus: DailyCloseReadinessStatus;
  blockerCount: number;
  reviewCount: number;
  carryForwardCount: number;
  readyCount: number;
  summary: Record<string, unknown>;
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

type CompleteDailyCloseResult = ApprovalCommandResult<{
  action: "completed" | "already_completed";
  dailyClose: Doc<"dailyClose">;
  carryForwardWorkItems: Array<Doc<"operationalWorkItem">>;
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
  session: Pick<Doc<"registerSession">, "closedAt" | "closeoutRecords">,
) {
  const firstClosedRecord = session.closeoutRecords?.find(
    (record) =>
      record.type === "closed" && typeof record.occurredAt === "number",
  );

  return firstClosedRecord?.occurredAt ?? session.closedAt;
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
): DailyCloseItem {
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
  };
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

async function listActiveRegisterSessions(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
) {
  const sessions = await Promise.all(
    ACTIVE_REGISTER_STATUSES.map((status) =>
      ctx.db
        .query("registerSession")
        .withIndex("by_storeId_status", (q) =>
          q.eq("storeId", storeId).eq("status", status),
        )
        .take(DAILY_CLOSE_QUERY_LIMIT),
    ),
  );

  return sessions.flat();
}

async function listClosedRegisterSessionsForDay(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    storeId: Id<"store">;
  },
) {
  const sessions = await ctx.db
    .query("registerSession")
    .withIndex("by_storeId_status", (q) =>
      q.eq("storeId", args.storeId).eq("status", "closed"),
    )
    .take(DAILY_CLOSE_QUERY_LIMIT);

  return sessions.filter((session) =>
    isInRange(
      registerSessionCloseoutOperatingAt(session),
      args.startAt,
      args.endAt,
    ),
  );
}

function registerSessionIntersectsRange(
  session: Pick<Doc<"registerSession">, "closedAt" | "openedAt">,
  range: { endAt: number; startAt: number },
) {
  return (
    session.openedAt < range.endAt &&
    (session.closedAt ?? Infinity) >= range.startAt
  );
}

function registerSessionBelongsToRange(
  session: Pick<
    Doc<"registerSession">,
    "closedAt" | "closeoutRecords" | "openedAt"
  >,
  range: { endAt: number; startAt: number },
) {
  const closeoutOperatingAt = registerSessionCloseoutOperatingAt(session);

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
      return registerSessionBelongsToRange(registerSession, range);
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
) {
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

  return scopedApprovals
    .filter(({ belongsToRange }) => belongsToRange)
    .map(({ approval }) => approval);
}

async function listOpenPosSessions(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    storeId: Id<"store">;
  },
) {
  const now = Date.now();
  const sessions = await Promise.all(
    OPEN_POS_SESSION_STATUSES.map((status) =>
      ctx.db
        .query("posSession")
        .withIndex("by_storeId_and_status", (q) =>
          q.eq("storeId", args.storeId).eq("status", status),
        )
        .take(DAILY_CLOSE_QUERY_LIMIT),
    ),
  );

  return sessions
    .flat()
    .filter(
      (session) =>
        session.expiresAt >= now && posSessionIntersectsRange(session, args),
    );
}

async function listOpenOperationalWorkItems(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
) {
  const workItems = await ctx.db
    .query("operationalWorkItem")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .take(DAILY_CLOSE_QUERY_LIMIT);

  return workItems.filter(
    (workItem) => !TERMINAL_WORK_ITEM_STATUSES.has(workItem.status),
  );
}

async function listTransactionsForDay(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    status: string;
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("posTransaction")
    .withIndex("by_storeId_status_completedAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", args.status)
        .gte("completedAt", args.startAt)
        .lt("completedAt", args.endAt),
    )
    .take(DAILY_CLOSE_QUERY_LIMIT);
}

async function listExpensesForDay(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("expenseTransaction")
    .withIndex("by_storeId_status_completedAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "completed")
        .gte("completedAt", args.startAt)
        .lt("completedAt", args.endAt),
    )
    .take(DAILY_CLOSE_QUERY_LIMIT);
}

async function listDepositsForDay(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    storeId: Id<"store">;
  },
) {
  const allocations = await ctx.db
    .query("paymentAllocation")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .take(DAILY_CLOSE_QUERY_LIMIT);

  return allocations.filter(
    (allocation) =>
      allocation.allocationType === "cash_deposit" &&
      allocation.direction === "out" &&
      allocation.status === "recorded" &&
      isInRange(allocation.recordedAt, args.startAt, args.endAt),
  );
}

function buildPaymentTotals(transactions: Array<Doc<"posTransaction">>) {
  const paymentTotals = new Map<
    string,
    {
      amount: number;
      transactionCount: number;
    }
  >();

  transactions.forEach((transaction) => {
    transaction.payments.forEach((payment) => {
      const existing = paymentTotals.get(payment.method) ?? {
        amount: 0,
        transactionCount: 0,
      };

      paymentTotals.set(payment.method, {
        amount: existing.amount + payment.amount,
        transactionCount: existing.transactionCount + 1,
      });
    });
  });

  return Array.from(paymentTotals.entries()).map(([method, total]) => ({
    method,
    ...total,
  }));
}

function transactionCashDelta(
  transaction: Pick<Doc<"posTransaction">, "changeGiven" | "payments">,
) {
  const cashTendered = transaction.payments.reduce(
    (sum, payment) => (payment.method === "cash" ? sum + payment.amount : sum),
    0,
  );

  return Math.max(0, cashTendered - (transaction.changeGiven ?? 0));
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
  carryForwardWorkItemIds: Id<"operationalWorkItem">[];
  carryForwardWorkItems: Array<Doc<"operationalWorkItem">>;
  completedAt: number;
  completedByStaffProfileId?: Id<"staffProfile">;
  completedByUserId?: Id<"athenaUser">;
  notes?: string;
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
      notes: args.notes,
      reviewedItemKeys: args.reviewedItemKeys,
      carryForwardWorkItemIds: args.carryForwardWorkItemIds,
    },
    readiness: args.readiness,
    summary: args.summary,
    reviewedItems: snapshotReviewedItems(args.snapshot, args.reviewedItemKeys),
    carryForwardItems: uniqueDailyCloseItems([
      ...args.snapshot.carryForwardItems,
      ...args.carryForwardWorkItems.map(asCarryForwardItem),
    ]),
    readyItems: args.snapshot.readyItems,
    sourceSubjects: args.snapshot.sourceSubjects,
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

function toDailyCloseHistoryListItem(
  dailyClose: Doc<"dailyClose">,
  completedByStaffName?: string | null,
  completedByStaffProfileId = dailyClose.completedByStaffProfileId,
): DailyCloseHistoryListItem {
  return {
    dailyCloseId: dailyClose._id,
    operatingDate: dailyClose.operatingDate,
    completedAt: dailyClose.completedAt,
    completedByUserId: dailyClose.completedByUserId,
    completedByStaffProfileId,
    completedByStaffName,
    readinessStatus: dailyClose.readiness.status,
    blockerCount: dailyClose.readiness.blockerCount,
    reviewCount: dailyClose.readiness.reviewCount,
    carryForwardCount: dailyClose.readiness.carryForwardCount,
    readyCount: dailyClose.readiness.readyCount,
    summary: dailyClose.summary,
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
    transactionCount: 0,
    voidedTransactionCount: 0,
    paymentTotals: [],
  };
}

export async function buildDailyCloseSnapshotWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt?: number;
    operatingDate: string;
    startAt?: number;
    storeId: Id<"store">;
  },
): Promise<DailyCloseSnapshot> {
  const range = resolveOperatingDateRange(args);
  const store = await getStore(ctx, args.storeId);

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
      startAt: 0,
      endAt: 0,
      existingClose: null,
      completedClose: null,
      priorClose: null,
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
    const completedSnapshot = normalizeCompletedDailyCloseSnapshot({
      dailyClose: existingClose,
      completedByStaffProfileId,
      completedByStaffName: completedByStaffProfileId
        ? (staffNamesById.get(completedByStaffProfileId) ?? null)
        : null,
    });

    if (completedSnapshot) {
      return completedSnapshot;
    }
  }

  const [
    activeRegisterSessionsForStore,
    closedRegisterSessions,
    pendingApprovals,
    openPosSessions,
    openWorkItems,
    completedTransactions,
    voidedTransactions,
    expenseTransactions,
    cashDeposits,
    priorClose,
  ] = await Promise.all([
    listActiveRegisterSessions(ctx, args.storeId),
    listClosedRegisterSessionsForDay(ctx, { ...range, storeId: args.storeId }),
    listPendingCloseoutApprovals(ctx, { ...range, storeId: args.storeId }),
    listOpenPosSessions(ctx, { ...range, storeId: args.storeId }),
    listOpenOperationalWorkItems(ctx, args.storeId),
    listTransactionsForDay(ctx, {
      ...range,
      status: "completed",
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

  const activeRegisterSessions = activeRegisterSessionsForStore.filter(
    (session) => registerSessionBelongsToRange(session, range),
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
  const carryForwardItems = openWorkItems.map(asCarryForwardItem);

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
        ...(typeof transaction.changeGiven === "number"
          ? { changeGiven: transaction.changeGiven }
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
        ...(typeof transaction.voidedAt === "number"
          ? { voidedAt: transaction.voidedAt }
          : {}),
      },
    });
  });

  const summary: DailyCloseSummary = {
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
    currentDayCashTotal: completedTransactions.reduce(
      (sum, transaction) => sum + transactionCashDelta(transaction),
      0,
    ),
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
    salesTotal: completedTransactions.reduce(
      (sum, transaction) => sum + transaction.total,
      0,
    ),
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
      ? {
          completedAt: existingClose.completedAt,
          completedByStaffProfileId,
          completedByStaffName: completedByStaffProfileId
            ? (staffNamesById.get(completedByStaffProfileId) ?? null)
            : null,
          completedByUserId: existingClose.completedByUserId,
          notes: existingClose.notes,
        }
      : null;
  const status = completedClose
    ? "completed"
    : readiness.status === "ready" && carryForwardItems.length > 0
      ? "carry_forward"
      : readiness.status;

  return {
    operatingDate: args.operatingDate,
    storeId: args.storeId,
    organizationId: store?.organizationId ?? null,
    startAt: range.startAt,
    endAt: range.endAt,
    existingClose,
    completedClose,
    priorClose,
    status,
    blockers,
    reviewItems,
    carryForwardItems,
    readyItems,
    readiness,
    summary,
    sourceSubjects: uniqueSourceSubjects(allItems),
  };
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

  for (const item of args.items) {
    const title = trimOptional(item.title);

    if (!title) {
      return {
        ok: false as const,
        message: "Carry-forward work items require a title.",
      };
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
        operatingDate: args.operatingDate,
        source: DAILY_CLOSE_SUBJECT_TYPE,
      },
    });

    if (workItem) {
      workItems.push(workItem);
    }
  }

  return {
    ok: true as const,
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

  const reviewedItemKeys = new Set(args.reviewedItemKeys ?? []);
  const unreviewedItemKeys = snapshot.reviewItems
    .map((item) => item.key)
    .filter((key) => !reviewedItemKeys.has(key));

  if (unreviewedItemKeys.length > 0) {
    return userError({
      code: "precondition_failed",
      message:
        "EOD Review items must be acknowledged before completion.",
      metadata: {
        reviewItemCount: snapshot.reviewItems.length,
        unreviewedItemKeys,
      },
    });
  }

  const linkedWorkItemResult = await validateCarryForwardWorkItemIds(ctx, {
    storeId: args.storeId,
    workItemIds: args.carryForwardWorkItemIds ?? [],
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
  const completedByStaffProfileId = approvalProof.data.approvedByStaffProfileId;
  const carryForwardWorkItems = [
    ...linkedWorkItemResult.workItems,
    ...createdWorkItemResult.workItems,
  ];
  const carryForwardWorkItemIds = carryForwardWorkItems.map(
    (workItem) => workItem._id,
  );
  const notes = trimOptional(args.notes);
  const readiness = {
    ...snapshot.readiness,
    carryForwardCount: carryForwardWorkItemIds.length,
  };
  const summary = {
    ...snapshot.summary,
    carryForwardWorkItemCount: carryForwardWorkItemIds.length,
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
    sourceSubjects: snapshot.sourceSubjects,
    reportSnapshot: buildDailyCloseReportSnapshot({
      carryForwardWorkItemIds,
      carryForwardWorkItems,
      completedAt: now,
      completedByStaffProfileId,
      completedByUserId: args.actorUserId,
      notes,
      readiness,
      reviewedItemKeys: args.reviewedItemKeys,
      snapshot,
      summary,
    }),
    carryForwardWorkItemIds,
    reviewedItemKeys: args.reviewedItemKeys,
    notes,
    updatedAt: now,
    completedAt: now,
    completedByUserId: args.actorUserId,
    completedByStaffProfileId,
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

  await recordOperationalEventWithCtx(ctx, {
    storeId: args.storeId,
    organizationId: store.organizationId,
    eventType: "daily_close_completed",
    subjectType: DAILY_CLOSE_SUBJECT_TYPE,
    subjectId: dailyClose._id,
    subjectLabel: `EOD Review ${args.operatingDate}`,
    message: `EOD Review completed for ${args.operatingDate}.`,
    actorUserId: args.actorUserId,
    actorStaffProfileId: completedByStaffProfileId,
    metadata: {
      approvalProofId: approvalProof.data.approvalProofId,
      approvedByStaffProfileId: approvalProof.data.approvedByStaffProfileId,
      operatingDate: args.operatingDate,
      readiness: dailyClose.readiness,
      summary: dailyClose.summary,
    },
  });

  for (const workItem of createdWorkItemResult.workItems) {
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
  const reopenedDailyCloseId = await ctx.db.insert("dailyClose", {
    storeId: originalDailyClose.storeId,
    organizationId: originalDailyClose.organizationId,
    operatingDate: originalDailyClose.operatingDate,
    status: "open",
    lifecycleStatus: "active",
    isCurrent: true,
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
    reopenedByStaffProfileId: approvalProof.data.approvedByStaffProfileId,
    reopenReason: reason,
    reopenedFromDailyCloseId: originalDailyClose._id,
    supersedesDailyCloseId: originalDailyClose._id,
  });

  await ctx.db.patch("dailyClose", originalDailyClose._id, {
    lifecycleStatus: "reopened",
    isCurrent: false,
    reopenedAt: now,
    reopenedByUserId: args.actorUserId,
    reopenedByStaffProfileId: approvalProof.data.approvedByStaffProfileId,
    reopenReason: reason,
    supersededByDailyCloseId: reopenedDailyCloseId,
    updatedAt: now,
  });

  await markOtherDailyClosesNotCurrent(ctx, {
    currentCloseId: reopenedDailyCloseId,
    storeId: args.storeId,
  });

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
    actorStaffProfileId: approvalProof.data.approvedByStaffProfileId,
    metadata: {
      approvalProofId: approvalProof.data.approvalProofId,
      approvedByStaffProfileId: approvalProof.data.approvedByStaffProfileId,
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

export async function listCompletedDailyCloseHistoryWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    limit?: number;
    storeId: Id<"store">;
  },
) {
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
    );
  });
}

export async function getCompletedDailyCloseHistoryDetailWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    dailyCloseId: Id<"dailyClose">;
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

  return {
    dailyCloseId: dailyClose._id,
    operatingDate: dailyClose.operatingDate,
    completedAt: dailyClose.completedAt,
    completedByUserId: dailyClose.completedByUserId,
    completedByStaffProfileId,
    completedByStaffName: completedByStaffProfileId
      ? (staffNamesById.get(completedByStaffProfileId) ?? null)
      : null,
    reportSnapshot: dailyClose.reportSnapshot,
  };
}

export const getDailyCloseSnapshot = query({
  args: {
    endAt: v.optional(v.number()),
    operatingDate: v.string(),
    startAt: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: (ctx, args) => buildDailyCloseSnapshotWithCtx(ctx, args),
});

export const completeDailyClose = mutation({
  args: {
    actorUserId: v.optional(v.id("athenaUser")),
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
  handler: (ctx, args) => completeDailyCloseWithCtx(ctx, args),
});

export const reopenDailyClose = mutation({
  args: {
    actorUserId: v.optional(v.id("athenaUser")),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    approvalProofId: v.optional(v.id("approvalProof")),
    dailyCloseId: v.id("dailyClose"),
    organizationId: v.optional(v.id("organization")),
    reason: v.string(),
    storeId: v.id("store"),
  },
  returns: commandResultValidator(v.any()),
  handler: (ctx, args) => reopenDailyCloseWithCtx(ctx, args),
});

export const getDailyCloseOpeningContext = query({
  args: {
    operatingDate: v.string(),
    storeId: v.id("store"),
  },
  handler: (ctx, args) => getDailyCloseOpeningContextWithCtx(ctx, args),
});

export const listCompletedDailyCloseHistory = query({
  args: {
    limit: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: (ctx, args) => listCompletedDailyCloseHistoryWithCtx(ctx, args),
});

export const getCompletedDailyCloseHistoryDetail = query({
  args: {
    dailyCloseId: v.id("dailyClose"),
    storeId: v.id("store"),
  },
  handler: (ctx, args) => getCompletedDailyCloseHistoryDetailWithCtx(ctx, args),
});
