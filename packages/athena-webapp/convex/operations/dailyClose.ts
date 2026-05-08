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

function buildDailyCloseApprovalSubject(args: {
  operatingDate: string;
  storeId: Id<"store">;
}) {
  return {
    id: `${args.storeId}:${args.operatingDate}`,
    label: `Daily Close ${args.operatingDate}`,
    type: DAILY_CLOSE_SUBJECT_TYPE,
  };
}

function buildDailyCloseCompletionApprovalRequirement(args: {
  operatingDate: string;
  storeId: Id<"store">;
}): ApprovalRequirement {
  return {
    action: DAILY_CLOSE_COMPLETION_ACTION,
    reason: "Manager approval is required to complete Daily Close.",
    requiredRole: "manager",
    selfApproval: "allowed",
    subject: buildDailyCloseApprovalSubject(args),
    copy: {
      title: "Manager approval required",
      message:
        "A manager needs to approve this Daily Close before the operating day is saved.",
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

function asCarryForwardItem(
  workItem: Doc<"operationalWorkItem">,
): DailyCloseItem {
  return {
    key: `operational_work_item:${workItem._id}:carry_forward`,
    severity: "carry_forward",
    category: "open_work",
    title: workItem.title,
    message: "Open operational work will carry forward after Daily Close.",
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
  return ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", args.storeId).eq("operatingDate", args.operatingDate),
    )
    .first();
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
      (dailyClose) => dailyClose.operatingDate < args.operatingDate,
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
    isInRange(session.closedAt, args.startAt, args.endAt),
  );
}

async function listPendingCloseoutApprovals(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
) {
  const approvals = await ctx.db
    .query("approvalRequest")
    .withIndex("by_storeId_status", (q) =>
      q.eq("storeId", storeId).eq("status", "pending"),
    )
    .take(DAILY_CLOSE_QUERY_LIMIT);

  return approvals.filter(
    (approval) =>
      approval.registerSessionId ||
      approval.subjectType === "register_session" ||
      approval.requestType === "variance_review",
  );
}

async function listOpenPosSessions(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
) {
  const now = Date.now();
  const sessions = await Promise.all(
    OPEN_POS_SESSION_STATUSES.map((status) =>
      ctx.db
        .query("posSession")
        .withIndex("by_storeId_and_status", (q) =>
          q.eq("storeId", storeId).eq("status", status),
        )
        .take(DAILY_CLOSE_QUERY_LIMIT),
    ),
  );

  return sessions
    .flat()
    .filter((session) => !session.expiresAt || session.expiresAt >= now);
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
  const paymentTotals = new Map<string, number>();

  transactions.forEach((transaction) => {
    transaction.payments.forEach((payment) => {
      paymentTotals.set(
        payment.method,
        (paymentTotals.get(payment.method) ?? 0) + payment.amount,
      );
    });
  });

  return Array.from(paymentTotals.entries()).map(([method, amount]) => ({
    method,
    amount,
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

function emptySummary(): DailyCloseSummary {
  return {
    carriedOverCashTotal: 0,
    carriedOverRegisterCount: 0,
    cashDepositTotal: 0,
    closedRegisterSessionCount: 0,
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expectedCashTotal: 0,
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
      message: "Daily Close requires an operating date in YYYY-MM-DD format.",
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
    existingClose,
    priorClose,
  ] = await Promise.all([
    listActiveRegisterSessions(ctx, args.storeId),
    listClosedRegisterSessionsForDay(ctx, { ...range, storeId: args.storeId }),
    listPendingCloseoutApprovals(ctx, args.storeId),
    listOpenPosSessions(ctx, args.storeId),
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
    getDailyCloseForDate(ctx, args),
    getPriorCompletedDailyClose(ctx, args),
  ]);

  const activeRegisterSessions = activeRegisterSessionsForStore.filter(
    (session) => session.openedAt < range.endAt,
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
  const terminalLabelsById = await buildTerminalLabelsById(ctx, [
    ...activeRegisterSessions.map((session) => session.terminalId),
    ...closedRegisterSessions.map((session) => session.terminalId),
    ...approvalRegisterSessions.map((session) => session.terminalId),
    ...openPosSessions.map((session) => session.terminalId),
    ...completedTransactions.map((transaction) => transaction.terminalId),
    ...voidedTransactions.map((transaction) => transaction.terminalId),
  ]);
  const staffNamesById = await buildStaffNamesById(ctx, [
    ...activeRegisterSessions.map((session) => session.openedByStaffProfileId),
    ...activeRegisterSessions.map((session) => session.closedByStaffProfileId),
    ...closedRegisterSessions.map((session) => session.openedByStaffProfileId),
    ...closedRegisterSessions.map((session) => session.closedByStaffProfileId),
    ...approvalRegisterSessions.map((session) => session.openedByStaffProfileId),
    ...approvalRegisterSessions.map((session) => session.closedByStaffProfileId),
    ...openPosSessions.map((session) => session.staffProfileId),
    ...completedTransactions.map((transaction) => transaction.staffProfileId),
    ...voidedTransactions.map((transaction) => transaction.staffProfileId),
    ...expenseTransactions.map((transaction) => transaction.staffProfileId),
    ...pendingApprovals.map((approval) => approval.requestedByStaffProfileId),
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
          ? "Finish the register closeout before completing Daily Close."
          : isCarriedOver
            ? "Close the register session carried over from a prior operating day before completing Daily Close."
            : "Close the register session before completing Daily Close.",
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
        "Resolve pending closeout approval before completing Daily Close.",
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
        ...(approvalRegisterSession
          ? {
              openedAt: approvalRegisterSession.openedAt,
              expectedCash: approvalRegisterSession.expectedCash,
              ...(typeof approvalRegisterSession.countedCash === "number"
                ? { countedCash: approvalRegisterSession.countedCash }
                : {}),
              status: approvalRegisterSession.status,
              ...nonZeroVarianceMetadata(approvalRegisterSession.variance),
              ...(typeof approvalRegisterSession.closedAt === "number"
                ? { closedAt: approvalRegisterSession.closedAt }
                : {}),
            }
          : {}),
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
        "Complete, void, or release held POS sessions before Daily Close.",
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
      message: "Closed register session is included in Daily Close.",
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
        message: "Review the cash variance before completing Daily Close.",
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
      message: "Completed sale is included in Daily Close.",
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
    const registerLabel = trimOptional(transaction.registerNumber)
      ? `Register ${transaction.registerNumber}`
      : undefined;

    readyItems.push({
      key: `expense_transaction:${transaction._id}:completed`,
      severity: "ready",
      category: "expense",
      title: "Completed expense",
      message: "Completed expense is included in Daily Close.",
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
        ...(staffName ? { owner: staffName } : {}),
        ...(registerLabel ? { register: registerLabel } : {}),
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
      message: "Review voided sales before completing Daily Close.",
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
    registerVarianceCount: relevantRegisterSessions.filter(
      (session) => Boolean(session.variance),
    ).length,
    salesTotal: completedTransactions.reduce(
      (sum, transaction) => sum + transaction.total,
      0,
    ),
    transactionCount: completedTransactions.length,
    voidedTransactionCount: voidedTransactions.length,
    paymentTotals: buildPaymentTotals(completedTransactions),
  };
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
          completedByStaffProfileId: existingClose.completedByStaffProfileId,
          completedByStaffName: null,
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
      message: "Daily Close store does not belong to this organization.",
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
      message: "Daily Close cannot be completed while blocker items remain.",
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
        "Daily Close review items must be acknowledged before completion.",
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
  const carryForwardWorkItems = [
    ...linkedWorkItemResult.workItems,
    ...createdWorkItemResult.workItems,
  ];
  const carryForwardWorkItemIds = carryForwardWorkItems.map(
    (workItem) => workItem._id,
  );
  const closeFields = {
    storeId: args.storeId,
    organizationId: store.organizationId,
    operatingDate: args.operatingDate,
    status: "completed" as const,
    isCurrent: true,
    readiness: {
      ...snapshot.readiness,
      carryForwardCount: carryForwardWorkItemIds.length,
    },
    summary: {
      ...snapshot.summary,
      carryForwardWorkItemCount: carryForwardWorkItemIds.length,
    },
    sourceSubjects: snapshot.sourceSubjects,
    carryForwardWorkItemIds,
    reviewedItemKeys: args.reviewedItemKeys,
    notes: trimOptional(args.notes),
    updatedAt: now,
    completedAt: now,
    completedByUserId: args.actorUserId,
    completedByStaffProfileId: args.actorStaffProfileId,
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
      message: "Daily Close could not be loaded after completion.",
      retryable: true,
    });
  }

  await recordOperationalEventWithCtx(ctx, {
    storeId: args.storeId,
    organizationId: store.organizationId,
    eventType: "daily_close_completed",
    subjectType: DAILY_CLOSE_SUBJECT_TYPE,
    subjectId: dailyClose._id,
    subjectLabel: `Daily Close ${args.operatingDate}`,
    message: `Daily Close completed for ${args.operatingDate}.`,
    actorUserId: args.actorUserId,
    actorStaffProfileId: args.actorStaffProfileId,
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
      subjectLabel: `Daily Close ${args.operatingDate}`,
      message: "Daily Close created a carry-forward work item.",
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

export const getDailyCloseOpeningContext = query({
  args: {
    operatingDate: v.string(),
    storeId: v.id("store"),
  },
  handler: (ctx, args) => getDailyCloseOpeningContextWithCtx(ctx, args),
});
