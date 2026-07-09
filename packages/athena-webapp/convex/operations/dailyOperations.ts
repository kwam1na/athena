import { query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  buildAdjustmentReportTotals,
  buildDailyCloseSnapshotWithCtx,
  listAppliedTransactionAdjustmentsForDay,
} from "./dailyClose";
import { buildDailyOpeningSnapshotWithCtx } from "./dailyOpening";
import { toDisplayAmount } from "../lib/currency";
import { currencyFormatter } from "../utils";
import { listAutomationRunsForStoreDayActionWithCtx } from "../automation/runLedger";
import {
  getStorePulseSummaryForWindow,
  type DailyOperationsStorePulseWindow,
} from "../pos/application/queries/storePulse";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { buildPaymentTotals, transactionCashDelta } from "./paymentTotals";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OPERATIONS_QUERY_LIMIT = 200;
const MAX_OPERATIONS_LOOKAHEAD_LIMIT = MAX_OPERATIONS_QUERY_LIMIT + 1;
const COMPACT_OPERATIONS_TIMELINE_LIMIT = 5;
const COMPACT_SCHEDULED_RUN_SUMMARY_LIMIT = 3;
const FULL_SCHEDULED_RUN_SUMMARY_LIMIT = 8;
const SCHEDULED_RUN_CRON_FAMILIES = [
  "release-checkout-items",
  "clear-abandoned-sessions",
  "complete-checkout-sessions",
  "release-pos-session-items",
  "auto-verify-payments",
] as const;
const MEANINGFUL_ZERO_CANDIDATE_CRON_FAMILIES = new Set<string>([
  "complete-checkout-sessions",
  "auto-verify-payments",
]);
const OPEN_WORK_ITEM_STATUSES = ["open", "in_progress"] as const;
const TIMELINE_REGISTER_SESSION_STATUSES = ["closed", "closing"] as const;
const TIMELINE_PENDING_REGISTER_COUNT_STATUSES = [
  "accepted",
  "conflicted",
  "held",
] as const;

type LinkTarget = {
  label?: string;
  matchLabel?: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  to?: string;
};

type SourceSubject = {
  id: string;
  label?: string;
  type: string;
};

type SourceItem = {
  category?: string;
  key: string;
  link?: LinkTarget;
  message: string;
  severity?: string;
  subject: SourceSubject;
  title: string;
};

type AttentionSeverity = "critical" | "warning" | "info";
type LaneStatus =
  | "blocked"
  | "needs_attention"
  | "ready"
  | "closed"
  | "unknown";
type LifecycleStatus =
  | "not_opened"
  | "operating"
  | "close_blocked"
  | "ready_to_close"
  | "reopened"
  | "closed";

type DailyOperationsAttentionItem = {
  id: string;
  label: string;
  message: string;
  owner: "daily_opening" | "daily_close" | "operations_queue";
  params?: Record<string, string>;
  search?: Record<string, string>;
  severity: AttentionSeverity;
  source: SourceSubject;
  to?: string;
};

type DailyOperationsLane = {
  count: number;
  countLabel?: string;
  description: string;
  key:
    | "opening"
    | "close"
    | "queue"
    | "approvals"
    | "registers"
    | "pos_sessions"
    | "expenses";
  label: string;
  status: LaneStatus;
  to: string;
};

type DailyOperationsTimelineEvent = {
  approvedProductLink?: LinkTarget;
  createdAt: number;
  id: string;
  message: string;
  onlineOrderLink?: LinkTarget;
  productLink?: LinkTarget;
  registerLink?: LinkTarget;
  subject: SourceSubject;
  transactionLink?: LinkTarget;
  type: string;
};

type DailyOperationsAutomationStatus = {
  bucket:
    | "failed"
    | "action_taken"
    | "needs_review"
    | "policy_skipped"
    | "scheduled_later";
  id: string;
  decisionEvidence?: unknown;
  decisionReason?: string;
  lane: "opening" | "close";
  occurredAt?: number | null;
  outcome:
    | "applied"
    | "prepared"
    | "skipped"
    | "failed"
    | "dry_run"
    | "disabled"
    | "eligible";
  policyMode?: string;
  policyVersion?: string;
  reviewEvidence?: Array<{
    id: string;
    label: string;
    message?: string | null;
    source?: SourceSubject;
    sourceLink?: LinkTarget;
  }>;
  sourceLink: LinkTarget;
};

type DailyOperationsAutomationStatusBucket =
  DailyOperationsAutomationStatus["bucket"];

type DailyOperationsScheduledRunSummary = {
  candidateCount: number;
  completedAt: number;
  cronFamily: string;
  failedCount: number;
  id: string;
  outcome: "applied" | "partial_failure" | "no_candidates";
  processedCount: number;
  skippedCount: number;
  succeededCount: number;
  windowEndAt: number;
  windowStartAt: number;
};

type DailyOperationsCloseSummary = {
  adjustedSalesTotal: number;
  adjustmentCashSettlementTotal: number;
  adjustmentCollectionTotal: number;
  adjustmentNetSettlementTotal: number;
  adjustmentRefundTotal: number;
  carriedOverCashTotal: number;
  carriedOverRegisterCount: number;
  currentDayCashTotal: number;
  currentDayCashTransactionCount: number;
  expenseTotal: number;
  expenseTransactionCount: number;
  itemAdjustmentCount: number;
  netCashVariance: number;
  netCashMovementTotal: number;
  paymentTotals: Array<{
    amount: number;
    method: string;
    transactionCount?: number;
  }>;
  registerVarianceCount: number;
  salesTotal: number;
  transactionCount: number;
};

type DailyOperationsWeekMetric = DailyOperationsCloseSummary & {
  isClosed: boolean;
  isReopened: boolean;
  isSelected: boolean;
  operatingDate: string;
};

const storePulseWindowValidator = v.union(
  v.literal("today"),
  v.literal("this_week"),
  v.literal("this_month"),
  v.literal("all_time"),
);

function operatingDateRange(operatingDate: string) {
  const startAt = Date.parse(`${operatingDate}T00:00:00.000Z`);

  if (!Number.isFinite(startAt)) {
    return { endAt: 0, startAt: 0 };
  }

  return { endAt: startAt + DAY_MS, startAt };
}

function operatingDateRangeForOffset(
  operatingDate: string,
  timezoneOffsetMinutes?: number,
) {
  if (
    typeof timezoneOffsetMinutes !== "number" ||
    !Number.isFinite(timezoneOffsetMinutes)
  ) {
    return operatingDateRange(operatingDate);
  }

  const startAt =
    Date.parse(`${operatingDate}T00:00:00.000Z`) +
    timezoneOffsetMinutes * 60_000;

  if (!Number.isFinite(startAt)) {
    return { endAt: 0, startAt: 0 };
  }

  return { endAt: startAt + DAY_MS, startAt };
}

function shiftOperatingDate(operatingDate: string, offsetDays: number) {
  const range = operatingDateRange(operatingDate);

  return new Date(range.startAt + offsetDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function sundayWeekStartOperatingDate(operatingDate: string) {
  const range = operatingDateRange(operatingDate);
  const date = new Date(range.startAt);
  const dayOfWeek = date.getUTCDay();

  return new Date(range.startAt - dayOfWeek * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function saturdayWeekEndOperatingDate(operatingDate: string) {
  return shiftOperatingDate(sundayWeekStartOperatingDate(operatingDate), 6);
}

function resolveRange(args: {
  endAt?: number;
  operatingDate: string;
  startAt?: number;
}) {
  if (
    typeof args.startAt === "number" &&
    typeof args.endAt === "number" &&
    Number.isFinite(args.startAt) &&
    Number.isFinite(args.endAt) &&
    args.endAt > args.startAt
  ) {
    return { endAt: args.endAt, startAt: args.startAt };
  }

  return operatingDateRange(args.operatingDate);
}

function approvalRequestBelongsToOperationsDay(args: {
  currentTime: number;
  endAt: number;
  request: Pick<Doc<"approvalRequest">, "createdAt">;
  startAt: number;
}) {
  const isCurrentOperatingDay =
    args.currentTime >= args.startAt && args.currentTime < args.endAt;
  const requestIsBeforeDayEnd = args.request.createdAt < args.endAt;

  if (isCurrentOperatingDay) {
    return requestIsBeforeDayEnd;
  }

  return requestIsBeforeDayEnd && args.request.createdAt >= args.startAt;
}

function emptyCloseSummary(): DailyOperationsCloseSummary {
  return {
    adjustedSalesTotal: 0,
    adjustmentCashSettlementTotal: 0,
    adjustmentCollectionTotal: 0,
    adjustmentNetSettlementTotal: 0,
    adjustmentRefundTotal: 0,
    carriedOverCashTotal: 0,
    carriedOverRegisterCount: 0,
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    itemAdjustmentCount: 0,
    netCashVariance: 0,
    netCashMovementTotal: 0,
    paymentTotals: [],
    registerVarianceCount: 0,
    salesTotal: 0,
    transactionCount: 0,
  };
}

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  if (value === 1) return `1 ${singular}`;
  return `${value} ${plural}`;
}

async function buildWeekMetricForDate(
  ctx: Pick<QueryCtx, "db">,
  args: {
    isSelected: boolean;
    operatingDate: string;
    operatingTimezoneOffsetMinutes?: number;
    storeId: Id<"store">;
  },
): Promise<DailyOperationsWeekMetric> {
  const range = operatingDateRangeForOffset(
    args.operatingDate,
    args.operatingTimezoneOffsetMinutes,
  );

  if (!Number.isFinite(range.startAt) || !Number.isFinite(range.endAt)) {
    return {
      ...emptyCloseSummary(),
      isClosed: false,
      isReopened: false,
      isSelected: args.isSelected,
      operatingDate: args.operatingDate,
    };
  }

  const [
    completedTransactions,
    appliedTransactionAdjustments,
    expenseTransactions,
    dailyClose,
  ] = await Promise.all([
    ctx.db
      .query("posTransaction")
      .withIndex("by_storeId_status_completedAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", "completed")
          .gte("completedAt", range.startAt)
          .lt("completedAt", range.endAt),
      )
      .take(MAX_OPERATIONS_QUERY_LIMIT),
    listAppliedTransactionAdjustmentsForDay(ctx, {
      endAt: range.endAt,
      startAt: range.startAt,
      storeId: args.storeId,
    }),
    ctx.db
      .query("expenseTransaction")
      .withIndex("by_storeId_status_completedAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", "completed")
          .gte("completedAt", range.startAt)
          .lt("completedAt", range.endAt),
      )
      .take(MAX_OPERATIONS_QUERY_LIMIT),
    ctx.db
      .query("dailyClose")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", args.storeId).eq("operatingDate", args.operatingDate),
      )
      .take(MAX_OPERATIONS_QUERY_LIMIT),
  ]);
  const currentDailyClose = selectEffectiveDailyClose(dailyClose);
  const isReopened =
    currentDailyClose?.lifecycleStatus === "reopened" ||
    (currentDailyClose?.lifecycleStatus === "superseded" &&
      typeof currentDailyClose.reopenedAt === "number");
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

  return {
    ...emptyCloseSummary(),
    ...adjustmentReportTotals,
    currentDayCashTotal,
    currentDayCashTransactionCount: completedTransactions.filter(
      (transaction) => transactionCashDelta(transaction) > 0,
    ).length,
    expenseTotal: expenseTransactions.reduce(
      (sum, transaction) => sum + transaction.totalValue,
      0,
    ),
    expenseTransactionCount: expenseTransactions.length,
    isClosed:
      currentDailyClose?.status === "completed" &&
      !isReopened,
    isReopened,
    isSelected: args.isSelected,
    operatingDate: args.operatingDate,
    paymentTotals: buildPaymentTotals(completedTransactions),
    salesTotal,
    transactionCount: completedTransactions.length,
  };
}

async function buildWeekMetrics(
  ctx: Pick<QueryCtx, "db">,
  args: {
    operatingDate: string;
    operatingTimezoneOffsetMinutes?: number;
    storeId: Id<"store">;
    weekEndOperatingDate?: string;
  },
) {
  const weekEndOperatingDate = saturdayWeekEndOperatingDate(
    args.weekEndOperatingDate ?? args.operatingDate,
  );
  const operatingDates = Array.from({ length: 7 }, (_, index) =>
    shiftOperatingDate(weekEndOperatingDate, index - 6),
  );

  return Promise.all(
    operatingDates.map((operatingDate) =>
      buildWeekMetricForDate(ctx, {
        isSelected: operatingDate === args.operatingDate,
        operatingDate,
        operatingTimezoneOffsetMinutes: args.operatingTimezoneOffsetMinutes,
        storeId: args.storeId,
      }),
    ),
  );
}

function dailyCloseSortTime(close: {
  _creationTime?: number;
  completedAt?: number;
  createdAt?: number;
  reopenedAt?: number;
  updatedAt?: number;
}) {
  return Math.max(
    close.completedAt ?? 0,
    close.reopenedAt ?? 0,
    close.updatedAt ?? 0,
    close.createdAt ?? 0,
    close._creationTime ?? 0,
  );
}

function latestDailyClose<T extends { _creationTime?: number }>(
  closes: T[],
) {
  return closes
    .slice()
    .sort((left, right) => dailyCloseSortTime(right) - dailyCloseSortTime(left))
    .at(0);
}

function selectEffectiveDailyClose<
  T extends {
    _creationTime?: number;
    completedAt?: number;
    createdAt?: number;
    isCurrent?: boolean;
    lifecycleStatus?: string;
    reopenedAt?: number;
    updatedAt?: number;
  },
>(dailyClose: T[]) {
  return (
    dailyClose.find((close) => close.isCurrent) ??
    latestDailyClose(
      dailyClose.filter((close) => close.lifecycleStatus === "active"),
    ) ??
    latestDailyClose(
      dailyClose.filter((close) => close.lifecycleStatus === "reopened"),
    ) ??
    latestDailyClose(dailyClose) ??
    null
  );
}

function attentionSeverity(item: SourceItem): AttentionSeverity {
  if (item.severity === "blocker") return "critical";
  if (item.severity === "ready") return "info";
  return "warning";
}

function sourceAttentionItem(
  owner: DailyOperationsAttentionItem["owner"],
  item: SourceItem,
): DailyOperationsAttentionItem {
  return {
    id: item.key,
    label: item.title,
    message: item.message,
    owner,
    params: item.link?.params,
    search: item.link?.search,
    severity: attentionSeverity(item),
    source: item.subject,
    to: item.link?.to,
  };
}

function openingNotStartedAttention(args: {
  operatingDate: string;
  storeId: Id<"store">;
}): DailyOperationsAttentionItem {
  return {
    id: `daily_opening:${args.storeId}:${args.operatingDate}:not_started`,
    label: "Opening Handoff not started",
    message: "Start Opening Handoff before running the store day.",
    owner: "daily_opening",
    severity: "warning",
    source: {
      id: `${args.storeId}:${args.operatingDate}`,
      label: `Opening Handoff ${args.operatingDate}`,
      type: "daily_opening",
    },
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
  };
}

async function listOpenQueueSnapshot(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    storeId: Id<"store">;
  },
) {
  const [workItemBatches, pendingApprovalRequests] = await Promise.all([
    Promise.all(
      OPEN_WORK_ITEM_STATUSES.map((status) =>
        ctx.db
          .query("operationalWorkItem")
          .withIndex("by_storeId_status", (q) =>
            q.eq("storeId", args.storeId).eq("status", status),
          )
          .take(MAX_OPERATIONS_LOOKAHEAD_LIMIT),
      ),
    ),
    listPendingApprovalRequestsSnapshot(ctx, args),
  ]);

  const openWorkItems = workItemBatches
    .flatMap((batch) => batch)
    .slice(0, MAX_OPERATIONS_QUERY_LIMIT);
  const hasMoreOpenWorkItems =
    workItemBatches.some(
      (batch) => batch.length > MAX_OPERATIONS_QUERY_LIMIT,
    ) ||
    workItemBatches.reduce((total, batch) => total + batch.length, 0) >
      MAX_OPERATIONS_QUERY_LIMIT;
  const hasMoreApprovalRequests =
    pendingApprovalRequests.hasMoreApprovalRequests;

  return {
    approvalRequests: pendingApprovalRequests.approvalRequests,
    approvalRequestsCountLabel:
      pendingApprovalRequests.approvalRequestsCountLabel,
    hasMoreApprovalRequests,
    hasMoreOpenWorkItems,
    openWorkItems,
    openWorkItemsCountLabel: hasMoreOpenWorkItems
      ? `${MAX_OPERATIONS_QUERY_LIMIT}+`
      : String(openWorkItems.length),
  };
}

async function listPendingApprovalRequestsSnapshot(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    storeId: Id<"store">;
  },
) {
  const pendingApprovalRequests = await ctx.db
    .query("approvalRequest")
    .withIndex("by_storeId_status", (q) =>
      q.eq("storeId", args.storeId).eq("status", "pending"),
    )
    .take(MAX_OPERATIONS_LOOKAHEAD_LIMIT);
  const currentTime = Date.now();
  const dayApprovalRequests = pendingApprovalRequests.filter((request) =>
    approvalRequestBelongsToOperationsDay({
      ...args,
      currentTime,
      request,
    }),
  );
  const approvalRequests = dayApprovalRequests.slice(
    0,
    MAX_OPERATIONS_QUERY_LIMIT,
  );
  const hasMoreApprovalRequests =
    dayApprovalRequests.length > MAX_OPERATIONS_QUERY_LIMIT;

  return {
    approvalRequests,
    approvalRequestsCountLabel: hasMoreApprovalRequests
      ? `${MAX_OPERATIONS_QUERY_LIMIT}+`
      : String(approvalRequests.length),
    hasMoreApprovalRequests,
  };
}

async function listTimelineEvents(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    includeManagerReviewEvidence?: boolean;
    limit?: number;
    startAt: number;
    storeId: Id<"store">;
  },
): Promise<DailyOperationsTimelineEvent[]> {
  if (!args.startAt || !args.endAt) return [];
  const limit = Math.max(
    0,
    Math.min(
      args.limit ?? MAX_OPERATIONS_QUERY_LIMIT,
      MAX_OPERATIONS_QUERY_LIMIT,
    ),
  );

  if (limit === 0) return [];

  const operationalEventLimit =
    limit >= MAX_OPERATIONS_QUERY_LIMIT
      ? MAX_OPERATIONS_QUERY_LIMIT
      : MAX_OPERATIONS_LOOKAHEAD_LIMIT;
  const eventsPromise = ctx.db
    .query("operationalEvent")
    .withIndex("by_storeId_createdAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .gte("createdAt", args.startAt)
        .lt("createdAt", args.endAt),
    )
    .order("desc")
    .take(operationalEventLimit);
  const storePromise = ctx.db.get("store", args.storeId);
  const registerSessionsPromise = listTimelineRegisterSessions(
    ctx,
    args.storeId,
  );
  const pendingRegisterCountsPromise = args.includeManagerReviewEvidence
    ? listPendingRegisterCountTimelineEvents(ctx, args)
    : Promise.resolve([]);
  const terminalNamesPromise = listTerminalNames(ctx, args.storeId);
  const [
    events,
    registerSessions,
    pendingRegisterCountEvents,
    store,
    terminalNamesById,
  ] = await Promise.all([
    eventsPromise,
    registerSessionsPromise,
    pendingRegisterCountsPromise,
    storePromise,
    terminalNamesPromise,
  ]);
  const operationalCloseoutKeys = new Set(
    events
      .map((event) => getOperationalRegisterCloseoutKey(event))
      .filter((key): key is string => key !== null),
  );
  const [operationalTimelineEvents, registerCloseoutTimelineEvents] =
    await Promise.all([
      Promise.all(
        events.map((event) =>
          mapOperationalTimelineEvent(ctx, {
            currency: store?.currency ?? "GHS",
            event,
            terminalNamesById,
          }),
        ),
      ),
      Promise.resolve(
        buildRegisterCloseoutTimelineEvents({
          currency: store?.currency ?? "GHS",
          endAt: args.endAt,
          operationalCloseoutKeys,
          registerSessions,
          startAt: args.startAt,
          terminalNamesById,
        }),
      ),
    ]);

  return [
    ...operationalTimelineEvents.filter(
      (event): event is DailyOperationsTimelineEvent => event !== null,
    ),
    ...registerCloseoutTimelineEvents,
    ...pendingRegisterCountEvents,
  ]
    .sort(compareDailyOperationsTimelineEvents)
    .slice(0, limit);
}

async function listPendingRegisterCountTimelineEvents(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    storeId: Id<"store">;
  },
): Promise<DailyOperationsTimelineEvent[]> {
  if (!args.startAt || !args.endAt) return [];

  const [store, eventBatches] = await Promise.all([
    ctx.db.get("store", args.storeId),
    Promise.all(
      TIMELINE_PENDING_REGISTER_COUNT_STATUSES.map((status) =>
        ctx.db
          .query("posLocalSyncEvent")
          .withIndex("by_store_status", (q) =>
            q.eq("storeId", args.storeId).eq("status", status),
          )
          .order("desc")
          .take(MAX_OPERATIONS_QUERY_LIMIT),
      ),
    ),
  ]);
  const eventsById = new Map<
    Id<"posLocalSyncEvent">,
    Doc<"posLocalSyncEvent">
  >();

  for (const event of eventBatches.flat()) {
    if (
      event.eventType !== "register_closed" ||
      event.occurredAt < args.startAt ||
      event.occurredAt >= args.endAt
    ) {
      continue;
    }

    eventsById.set(event._id, event);
  }

  const events = await Promise.all(
    [...eventsById.values()].map((event) =>
      mapPendingRegisterCountTimelineEvent(ctx, {
        currency: store?.currency ?? "GHS",
        event,
        storeId: args.storeId,
      }),
    ),
  );

  return events.filter(
    (event): event is DailyOperationsTimelineEvent => event !== null,
  );
}

async function mapPendingRegisterCountTimelineEvent(
  ctx: Pick<QueryCtx, "db">,
  args: {
    currency: string;
    event: Doc<"posLocalSyncEvent">;
    storeId: Id<"store">;
  },
): Promise<DailyOperationsTimelineEvent | null> {
  const mapping = await ctx.db
    .query("posLocalSyncMapping")
    .withIndex("by_store_terminal_local", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("terminalId", args.event.terminalId)
        .eq("localRegisterSessionId", args.event.localRegisterSessionId)
        .eq("localIdKind", "registerSession")
        .eq("localId", args.event.localRegisterSessionId),
    )
    .first();

  if (!mapping || mapping.cloudTable !== "registerSession") return null;

  const registerSession = await ctx.db.get(
    "registerSession",
    mapping.cloudId as Id<"registerSession">,
  );

  if (!registerSession) return null;

  const [staffProfile, conflict, terminal] = await Promise.all([
    ctx.db.get("staffProfile", args.event.staffProfileId),
    ctx.db
      .query("posLocalSyncConflict")
      .withIndex("by_store_terminal_localEvent", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("terminalId", args.event.terminalId)
          .eq("localEventId", args.event.localEventId),
      )
      .first(),
    ctx.db.get("posTerminal", args.event.terminalId),
  ]);
  const registerLabel = formatTerminalRegisterLinkLabel({
    registerNumber: registerSession.registerNumber,
    terminalName: terminal?.displayName,
  });
  const countedCash = numberFromRecord(args.event.payload, "countedCash");
  const expectedCash =
    numberFromRecord(conflict?.details, "expectedCash") ??
    registerSession.expectedCash;
  const variance =
    numberFromRecord(conflict?.details, "variance") ??
    (typeof countedCash === "number" ? countedCash - expectedCash : undefined);

  return {
    createdAt: args.event.occurredAt,
    id: `pos_local_sync_register_count:${args.event._id}`,
    message: buildPendingRegisterCountTimelineMessage({
      countedCash,
      currency: args.currency,
      registerLabel,
      staffName: staffProfile?.fullName,
      status: args.event.status,
      variance,
    }),
    registerLink: {
      label: registerLabel,
      params: {
        sessionId: registerSession._id,
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
    },
    subject: {
      id: registerSession._id,
      label: registerLabel,
      type: "register_session",
    },
    type: "register_session_count_submitted",
  };
}

async function mapOperationalTimelineEvent(
  ctx: Pick<QueryCtx, "db">,
  args: {
    currency: string;
    event: {
      _id: Id<"operationalEvent">;
      actorStaffProfileId?: string;
      createdAt: number;
      eventType: string;
      message: string;
      metadata?: Record<string, unknown>;
      onlineOrderId?: Id<"onlineOrder">;
      registerSessionId?: Id<"registerSession">;
      subjectId: string;
      subjectLabel?: string;
      subjectType: string;
    };
    terminalNamesById: Map<Id<"posTerminal">, string>;
  },
): Promise<DailyOperationsTimelineEvent | null> {
  const event = args.event;
  const metadata = event.metadata ?? {};
  if (isDailyOperationsTimelineAuditEvent(event)) {
    return null;
  }
  if (isSaleBackedPendingCheckoutReuseEvent(event.eventType, metadata)) {
    return null;
  }

  const pendingCheckoutItemId =
    typeof metadata.pendingCheckoutItemId === "string"
      ? ctx.db.normalizeId(
          "posPendingCheckoutItem",
          metadata.pendingCheckoutItemId,
        )
      : event.subjectType === "pos_pending_checkout_item"
        ? ctx.db.normalizeId("posPendingCheckoutItem", event.subjectId)
        : null;
  const pendingCheckoutItem = pendingCheckoutItemId
    ? await ctx.db.get("posPendingCheckoutItem", pendingCheckoutItemId)
    : null;
  const isPendingCheckoutLinkReviewEvent =
    event.subjectType === "pos_pending_checkout_item" &&
    event.eventType === "pos_pending_checkout_item_reviewed";
  const linkedPendingCheckoutProductId =
    pendingCheckoutItem?.status === "linked_to_catalog" &&
    !isPendingCheckoutLinkReviewEvent
      ? pendingCheckoutItem.approvedProductId
      : undefined;
  const linkedPendingCheckoutProductSkuId =
    pendingCheckoutItem?.status === "linked_to_catalog" &&
    !isPendingCheckoutLinkReviewEvent
      ? pendingCheckoutItem.approvedProductSkuId
      : undefined;
  const pendingCheckoutReviewProductId =
    isPendingCheckoutLinkReviewEvent &&
    typeof metadata.provisionalProductId === "string"
      ? metadata.provisionalProductId
      : isPendingCheckoutLinkReviewEvent
        ? pendingCheckoutItem?.provisionalProductId
        : undefined;
  const pendingCheckoutReviewProductSkuId =
    isPendingCheckoutLinkReviewEvent &&
    typeof metadata.provisionalProductSkuId === "string"
      ? (metadata.provisionalProductSkuId as Id<"productSku">)
      : isPendingCheckoutLinkReviewEvent
        ? pendingCheckoutItem?.provisionalProductSkuId
        : undefined;
  const productId =
    pendingCheckoutReviewProductId ??
    (typeof metadata.productId === "string"
      ? metadata.productId
      : linkedPendingCheckoutProductId
        ? linkedPendingCheckoutProductId
      : typeof metadata.provisionalProductId === "string"
        ? metadata.provisionalProductId
        : pendingCheckoutItem?.provisionalProductId);
  const productSkuId =
    pendingCheckoutReviewProductSkuId ??
    (typeof metadata.productSkuId === "string"
      ? (metadata.productSkuId as Id<"productSku">)
      : linkedPendingCheckoutProductSkuId
        ? linkedPendingCheckoutProductSkuId
      : typeof metadata.provisionalProductSkuId === "string"
        ? (metadata.provisionalProductSkuId as Id<"productSku">)
        : pendingCheckoutItem?.provisionalProductSkuId);
  const productSku = productSkuId
    ? await ctx.db.get("productSku", productSkuId)
    : null;
  const approvedProductSku =
    isPendingCheckoutLinkReviewEvent &&
    pendingCheckoutItem?.approvedProductSkuId
      ? await ctx.db.get("productSku", pendingCheckoutItem.approvedProductSkuId)
      : null;
  const isRegisterSessionEvent = isRegisterSessionSubjectType(
    event.subjectType,
  );
  const registerSessionId =
    event.registerSessionId ??
    (isRegisterSessionEvent
      ? ctx.db.normalizeId("registerSession", event.subjectId)
      : null);
  const registerSession = registerSessionId
    ? await ctx.db.get("registerSession", registerSessionId)
    : null;
  const actorStaffProfileId =
    typeof event.actorStaffProfileId === "string"
      ? (event.actorStaffProfileId as Id<"staffProfile">)
      : typeof registerSession?.openedByStaffProfileId === "string"
        ? (registerSession.openedByStaffProfileId as Id<"staffProfile">)
        : undefined;
  const actorStaffProfile = actorStaffProfileId
    ? await ctx.db.get("staffProfile", actorStaffProfileId)
    : null;
  const productName =
    typeof metadata.productName === "string"
      ? metadata.productName
      : pendingCheckoutItem?.name ?? event.subjectLabel;
  const productSkuLabel =
    typeof metadata.productSkuLabel === "string"
      ? metadata.productSkuLabel
      : undefined;
  const sku =
    typeof metadata.sku === "string"
      ? metadata.sku
      : (productSku?.sku ?? undefined);
  const isPendingCheckoutItemEvent =
    event.subjectType === "pos_pending_checkout_item" &&
    productSkuId !== undefined;
  const productLinkProductId = productId ?? productSku?.productId;
  const productSkuDisplayLabel =
    productSku?.productName && sku
      ? `${productSku.productName} (${sku})`
      : productSku?.productName || productName;
  const productLinkLabel = isPendingCheckoutItemEvent
    ? productName
    : event.subjectType === "product_sku"
      ? productName
      : productSkuLabel || productSkuDisplayLabel;
  const canLinkProduct =
    event.subjectType === "product_sku" ||
    isPendingCheckoutItemEvent ||
    productSkuId !== undefined;
  const transactionNumber = normalizeTransactionNumber(
    typeof metadata.transactionNumber === "string"
      ? metadata.transactionNumber
      : typeof metadata.receiptNumber === "string"
        ? metadata.receiptNumber
        : extractTransactionNumber(event.subjectLabel, event.message),
  );
  const transactionLink =
    isPosTransactionSubjectType(event.subjectType) && transactionNumber
      ? {
          label: `#${transactionNumber}`,
          params: {
            transactionId: event.subjectId,
          },
          to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
        }
      : undefined;
  const onlineOrderId =
    event.onlineOrderId ??
    (event.subjectType === "online_order"
      ? ctx.db.normalizeId("onlineOrder", event.subjectId)
      : null);
  const onlineOrderLabel =
    event.subjectType === "online_order" ? event.subjectLabel : undefined;
  const onlineOrderLink =
    onlineOrderId && onlineOrderLabel
      ? {
          label: onlineOrderLabel.startsWith("#")
            ? onlineOrderLabel
            : `#${onlineOrderLabel}`,
          matchLabel: onlineOrderLabel,
          params: {
            orderSlug: onlineOrderId,
          },
          to: "/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug",
        }
      : undefined;
  const productLink =
    canLinkProduct && productLinkProductId && productLinkLabel
      ? {
          label: productLinkLabel,
          params: {
            productSlug: productLinkProductId,
          },
          search: {
            ...(sku ? { variant: sku } : {}),
          },
          to: "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug",
        }
      : undefined;
  const approvedProductLink =
    isPendingCheckoutLinkReviewEvent &&
    pendingCheckoutItem?.approvedProductId &&
    pendingCheckoutItem.approvedProductSkuId
      ? {
          label:
            approvedProductSku?.productName ??
            approvedProductSku?.sku ??
            "Approved product",
          params: {
            productSlug: pendingCheckoutItem.approvedProductId,
          },
          search: {
            ...(approvedProductSku?.sku
              ? { variant: approvedProductSku.sku }
              : {}),
          },
          to: "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug",
        }
      : undefined;
  const registerNumber =
    typeof metadata.registerNumber === "string"
      ? metadata.registerNumber
      : registerSession?.registerNumber;
  const terminalName = registerSession?.terminalId
    ? args.terminalNamesById.get(registerSession.terminalId)
    : undefined;
  const registerLabel = isRegisterSessionEvent
    ? formatTerminalRegisterLinkLabel({
        registerNumber: event.subjectLabel ?? registerNumber,
        terminalName,
      })
    : undefined;
  const approvalSubjectLabel = getApprovalTimelineSubjectLabel({
    event,
    metadata,
    registerLabel,
  });
  const openingFloat =
    numberFromRecord(metadata, "openingFloat") ?? registerSession?.openingFloat;
  const openingFloatLabel =
    typeof openingFloat === "number"
      ? formatTimelineAmount(args.currency, openingFloat)
      : undefined;
  const registerLink =
    isRegisterSessionEvent && registerSessionId
      ? {
          label: registerLabel ?? "Register session",
          params: {
            sessionId: registerSessionId,
          },
          to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
        }
      : undefined;

  return {
    ...(approvedProductLink ? { approvedProductLink } : {}),
    createdAt: event.createdAt,
    id: event._id,
    message: normalizeTimelineEventMessage(event.message, {
      actorName: actorStaffProfile?.fullName,
      approvalSubjectLabel,
      currency: args.currency,
      eventType: event.eventType,
      openingFloatLabel,
      registerLabel,
      variance: numberFromRecord(metadata, "variance"),
    }),
    onlineOrderLink,
    productLink,
    registerLink,
    subject: {
      id: event.subjectId,
      label: registerLabel ?? event.subjectLabel,
      type: event.subjectType,
    },
    transactionLink,
    type: event.eventType,
  };
}

function isRegisterSessionSubjectType(subjectType: string) {
  return (
    subjectType === "register_session" || subjectType === "registerSession"
  );
}

function isPosTransactionSubjectType(subjectType: string) {
  return subjectType === "pos_transaction" || subjectType === "posTransaction";
}

function extractTransactionNumber(...values: Array<string | undefined>) {
  for (const value of values) {
    const match = value?.match(/#([A-Za-z0-9][A-Za-z0-9-]*)/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

function normalizeTransactionNumber(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
}

function isDailyOperationsTimelineAuditEvent(event: {
  eventType: string;
  subjectType: string;
}) {
  return (
    event.subjectType === "posRecoveryCredential" ||
    event.eventType.startsWith("pos_recovery_code_")
  );
}

function isSaleBackedPendingCheckoutReuseEvent(
  eventType: string,
  metadata: Record<string, unknown>,
) {
  if (eventType !== "pos_pending_checkout_item_reused") return false;

  return (
    typeof metadata.posTransactionId === "string" ||
    (typeof metadata.transactionCount === "number" &&
      metadata.transactionCount > 0)
  );
}

function normalizeTimelineEventMessage(
  message: string,
  context?: {
    actorName?: string;
    approvalSubjectLabel?: string;
    currency?: string;
    eventType?: string;
    openingFloatLabel?: string;
    registerLabel?: string;
    variance?: number;
  },
) {
  const approvalMessage = normalizeApprovalTimelineEventMessage(context);
  if (approvalMessage) return approvalMessage;

  if (
    context?.eventType === "register_session_opening_float_corrected" ||
    /^Register session opening float corrected\.$/i.test(message)
  ) {
    const registerLabel = context?.registerLabel ?? "Register session";
    const actorName = context?.actorName?.trim();
    return actorName
      ? punctuateTimelineSentence(
          `${registerLabel} opening float corrected by ${actorName}`,
        )
      : `${registerLabel} opening float corrected.`;
  }

  if (context?.eventType === "pos_transaction_void_approval_requested") {
    const actorName = context.actorName?.trim();
    return actorName
      ? message.replace(
          /^Void requested for\b/i,
          `Void requested by ${actorName} for`,
        )
      : message;
  }

  if (/^(?:Offline )?POS register opened\.$/i.test(message)) {
    const registerLabel = context?.registerLabel ?? "POS register";
    const actorName = context?.actorName?.trim();
    const openingFloatPhrase = context?.openingFloatLabel
      ? ` with opening float ${context.openingFloatLabel}`
      : "";
    return actorName
      ? punctuateTimelineSentence(
          `${registerLabel} opened by ${actorName}${openingFloatPhrase}`,
        )
      : punctuateTimelineSentence(
          `${registerLabel} opened${openingFloatPhrase}`,
        );
  }

  if (/^Register session closed with an exact cash match\.$/i.test(message)) {
    return `${context?.registerLabel ?? "Register session"} closed with an exact cash match.`;
  }

  const recordedVarianceMatch = message.match(
    /^Register\s+\S+\s+closeout recorded with a cash variance of (.+)\.$/i,
  );
  if (recordedVarianceMatch?.[1]) {
    return `${context?.registerLabel ?? "Register"} closeout recorded with a cash variance of ${recordedVarianceMatch[1]}.`;
  }

  if (
    /^Register\s+\S+\s+closeout recorded with an exact cash match\.$/i.test(
      message,
    )
  ) {
    return `${context?.registerLabel ?? "Register"} closeout recorded with an exact cash match.`;
  }

  if (
    context?.eventType === "register_session_variance_review_requested" &&
    typeof context.variance === "number" &&
    context.variance !== 0
  ) {
    return `${context.registerLabel ?? "Register session"} closeout recorded with a cash variance of ${formatTimelineAmount(context.currency ?? "GHS", context.variance)}.`;
  }

  if (
    context?.eventType === "register_session_sync_closeout_review_requested"
  ) {
    const amount =
      typeof context.variance === "number" && context.variance !== 0
        ? formatTimelineAmount(context.currency ?? "GHS", context.variance)
        : message.match(
            /closeout submitted with a cash variance of (.+?)\. Review before applying it\.$/i,
          )?.[1];

    if (amount) {
      return `${context.registerLabel ?? "Register"} closeout submitted with a cash variance of ${amount}. Review before applying it.`;
    }
  }

  const varianceMatch = message.match(
    /^Register session closed with a variance of (.+)\.$/i,
  );
  if (varianceMatch?.[1]) {
    const variance =
      typeof context?.variance === "number"
        ? context.variance
        : Number(varianceMatch[1]);
    const formattedVariance = Number.isFinite(variance)
      ? formatTimelineAmount(context?.currency ?? "GHS", variance)
      : varianceMatch[1];

    return `${context?.registerLabel ?? "Register session"} closed with a variance of ${formattedVariance}.`;
  }

  return message.replace(/^Offline POS sale\b/, "Sale");
}

function normalizeApprovalTimelineEventMessage(context?: {
  actorName?: string;
  approvalSubjectLabel?: string;
  eventType?: string;
}) {
  if (!context?.eventType?.startsWith("approval.")) return null;

  const subjectPhrase = context.approvalSubjectLabel
    ? ` for ${context.approvalSubjectLabel}`
    : "";

  if (context.eventType === "approval.manager_granted") {
    const actorPhrase = context.actorName?.trim()
      ? ` by ${context.actorName.trim()}`
      : "";
    return punctuateTimelineSentence(
      `Manager approval granted${actorPhrase}${subjectPhrase}`,
    );
  }

  if (context.eventType === "approval.proof_consumed") {
    return punctuateTimelineSentence(
      `Manager approval applied${subjectPhrase}`,
    );
  }

  return null;
}

function punctuateTimelineSentence(value: string) {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function getApprovalTimelineSubjectLabel(args: {
  event: {
    subjectId: string;
    subjectLabel?: string;
    subjectType: string;
  };
  metadata: Record<string, unknown>;
  registerLabel?: string;
}) {
  if (!isApprovalTimelineSubject(args.event, args.metadata)) return undefined;

  if (args.registerLabel && args.registerLabel !== "Register session") {
    return args.registerLabel;
  }

  if (typeof args.event.subjectLabel === "string") {
    const normalizedLabel = normalizeApprovalSubjectLabel(
      args.event.subjectLabel,
      args.event.subjectType,
      args.metadata,
    );
    if (normalizedLabel) return normalizedLabel;
  }

  if (typeof args.metadata.registerNumber === "string") {
    return formatRegisterSessionLabel(args.metadata.registerNumber);
  }

  return normalizeApprovalSubjectIdFallback(
    args.event.subjectId,
    args.event.subjectType,
    args.metadata,
  );
}

function isApprovalTimelineSubject(
  event: { subjectType: string },
  metadata: Record<string, unknown>,
) {
  return (
    isRegisterSessionSubjectType(event.subjectType) ||
    typeof metadata.registerNumber === "string" ||
    String(metadata.actionKey ?? "").includes("register")
  );
}

function normalizeApprovalSubjectLabel(
  value: string,
  subjectType: string,
  metadata: Record<string, unknown>,
) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (
    isRegisterSessionSubjectType(subjectType) ||
    typeof metadata.registerNumber === "string" ||
    String(metadata.actionKey ?? "").includes("register")
  ) {
    return formatRegisterSessionLabel(trimmed);
  }

  return trimmed;
}

function normalizeApprovalSubjectIdFallback(
  value: string,
  subjectType: string,
  metadata: Record<string, unknown>,
) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (
    isRegisterSessionSubjectType(subjectType) ||
    typeof metadata.registerNumber === "string" ||
    String(metadata.actionKey ?? "").includes("register")
  ) {
    if (/^register\b/i.test(trimmed) || /^\d+$/.test(trimmed)) {
      return formatRegisterSessionLabel(trimmed);
    }

    return undefined;
  }

  return trimmed;
}

async function listTimelineRegisterSessions(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
) {
  const sessionBatches = await Promise.all(
    TIMELINE_REGISTER_SESSION_STATUSES.map((status) =>
      ctx.db
        .query("registerSession")
        .withIndex("by_storeId_status", (q) =>
          q.eq("storeId", storeId).eq("status", status),
        )
        .take(MAX_OPERATIONS_QUERY_LIMIT),
    ),
  );
  const sessionsById = new Map<Id<"registerSession">, Doc<"registerSession">>();

  for (const session of sessionBatches.flat()) {
    sessionsById.set(session._id, session);
  }

  return [...sessionsById.values()];
}

async function listTerminalNames(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
) {
  const terminals = await ctx.db
    .query("posTerminal")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .take(MAX_OPERATIONS_QUERY_LIMIT);

  return new Map(
    terminals.flatMap((terminal) => {
      const name = terminal.displayName.trim();
      return name ? [[terminal._id, name] as const] : [];
    }),
  );
}

function buildRegisterCloseoutTimelineEvents(args: {
  currency: string;
  endAt: number;
  operationalCloseoutKeys: Set<string>;
  registerSessions: Array<Doc<"registerSession">>;
  startAt: number;
  terminalNamesById: Map<Id<"posTerminal">, string>;
}): DailyOperationsTimelineEvent[] {
  return args.registerSessions.flatMap((session) =>
    (session.closeoutRecords ?? [])
      .filter(
        (record) =>
          record.occurredAt >= args.startAt && record.occurredAt < args.endAt,
      )
      .filter(
        (record) =>
          !args.operationalCloseoutKeys.has(
            getRegisterCloseoutKey({
              occurredAt: record.occurredAt,
              registerSessionId: session._id,
              type: record.type,
            }),
          ),
      )
      .map((record) => {
        const label = formatTerminalRegisterLinkLabel({
          registerNumber: session.registerNumber,
          terminalName: session.terminalId
            ? args.terminalNamesById.get(session.terminalId)
            : undefined,
        });
        const eventType =
          record.type === "closed"
            ? "register_session_closed"
            : "register_session_closeout_reopened";

        return {
          createdAt: record.occurredAt,
          id: `register_closeout:${session._id}:${record.type}:${record.occurredAt}`,
          message: buildRegisterCloseoutTimelineMessage({
            currency: args.currency,
            label,
            type: record.type,
            variance: record.variance,
          }),
          registerLink: {
            label,
            params: {
              sessionId: session._id,
            },
            to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
          },
          subject: {
            id: session._id,
            label,
            type: "register_session",
          },
          type: eventType,
        };
      }),
  );
}

function buildRegisterCloseoutTimelineMessage(args: {
  currency: string;
  label: string;
  type: "closed" | "reopened";
  variance?: number;
}) {
  if (args.type === "reopened") {
    return `${args.label} closeout reopened for correction.`;
  }

  if (args.variance && args.variance !== 0) {
    return `${args.label} closeout recorded with a cash variance of ${formatTimelineAmount(args.currency, args.variance)}.`;
  }

  return `${args.label} closeout recorded with an exact cash match.`;
}

function buildPendingRegisterCountTimelineMessage(args: {
  countedCash?: number;
  currency: string;
  registerLabel: string;
  staffName?: string;
  status: Doc<"posLocalSyncEvent">["status"];
  variance?: number;
}) {
  const actor = args.staffName?.trim() || "A POS operator";
  const amount =
    typeof args.countedCash === "number"
      ? ` of ${formatTimelineAmount(args.currency, args.countedCash)}`
      : "";
  const reviewSuffix =
    args.status === "conflicted" && typeof args.variance === "number"
      ? ` Variance ${formatTimelineAmount(args.currency, args.variance)} needs manager review.`
      : args.status === "held"
        ? " Sync is waiting for review."
        : " Sync is pending.";

  return `${actor} submitted ${args.registerLabel} count${amount}.${reviewSuffix}`;
}

function formatTimelineAmount(currency: string, amount: number) {
  const storeCurrency = currency.trim() || "GHS";

  try {
    return currencyFormatter(storeCurrency).format(toDisplayAmount(amount));
  } catch {
    return currencyFormatter("GHS").format(toDisplayAmount(amount));
  }
}

function numberFromRecord(record: unknown, key: string) {
  if (!record || typeof record !== "object") return undefined;

  const value = (record as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function formatRegisterSessionLabel(registerNumber?: string) {
  const trimmed = registerNumber?.trim();

  if (!trimmed) return "Register session";
  if (/^register\b/i.test(trimmed)) return trimmed;
  return `Register ${trimmed}`;
}

function formatTerminalRegisterLinkLabel(args: {
  registerNumber?: string;
  terminalName?: string;
}) {
  const terminalName = args.terminalName?.trim();
  const registerNumber = formatRegisterNumberValue(args.registerNumber);

  if (terminalName && registerNumber) {
    return `${terminalName} / Register ${registerNumber}`;
  }

  return formatRegisterSessionLabel(args.registerNumber);
}

function formatRegisterNumberValue(registerNumber?: string) {
  const trimmed = registerNumber?.trim();
  if (!trimmed) return undefined;

  const withoutPrefix = trimmed.replace(/^register\b\s*/i, "").trim();
  return withoutPrefix || trimmed;
}

function getOperationalRegisterCloseoutKey(event: {
  createdAt: number;
  eventType: string;
  subjectId: string;
  subjectType: string;
}) {
  if (event.subjectType !== "register_session") return null;

  const type =
    event.eventType === "register_session_closed" ||
    event.eventType === "register_session_closeout_approved"
      ? "closed"
      : event.eventType === "register_session_closeout_reopened"
        ? "reopened"
        : null;

  if (!type) return null;

  return getRegisterCloseoutKey({
    occurredAt: event.createdAt,
    registerSessionId: event.subjectId,
    type,
  });
}

function getRegisterCloseoutKey(args: {
  occurredAt: number;
  registerSessionId: string;
  type: "closed" | "reopened";
}) {
  return `${args.registerSessionId}:${args.type}:${getTimelineMinuteBucket(args.occurredAt)}`;
}

function getTimelineMinuteBucket(createdAt: number) {
  return Math.floor(createdAt / 60_000);
}

function compareTimelineEvents(
  left: {
    _id: Id<"operationalEvent">;
    createdAt: number;
  },
  right: {
    _id: Id<"operationalEvent">;
    createdAt: number;
  },
) {
  if (left.createdAt !== right.createdAt)
    return right.createdAt - left.createdAt;
  return String(right._id).localeCompare(String(left._id));
}

function compareDailyOperationsTimelineEvents(
  left: DailyOperationsTimelineEvent,
  right: DailyOperationsTimelineEvent,
) {
  return compareTimelineEvents(
    {
      _id: left.id as Id<"operationalEvent">,
      createdAt: left.createdAt,
    },
    {
      _id: right.id as Id<"operationalEvent">,
      createdAt: right.createdAt,
    },
  );
}

async function getDailyCloseRecordForDate(
  ctx: Pick<QueryCtx, "db">,
  args: {
    operatingDate: string;
    storeId: Id<"store">;
  },
) {
  const dailyClose = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", args.storeId).eq("operatingDate", args.operatingDate),
    )
    .take(MAX_OPERATIONS_QUERY_LIMIT);

  return selectEffectiveDailyClose(dailyClose);
}

async function getDailyOpeningRecordForDate(
  ctx: Pick<QueryCtx, "db">,
  args: {
    operatingDate: string;
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("dailyOpening")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", args.storeId).eq("operatingDate", args.operatingDate),
    )
    .first();
}

function reviewEvidenceForDailyOperations(
  opening: Doc<"dailyOpening"> | null,
): DailyOperationsAutomationStatus["reviewEvidence"] {
  return (opening?.managerReviewEvidence ?? []).map((item) => ({
    id: item.key,
    label: item.title,
    message: item.message,
    source: item.subject,
    sourceLink: item.link,
  }));
}

function compareAutomationRuns(
  left: Doc<"automationRun">,
  right: Doc<"automationRun">,
) {
  return (
    (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt)
  );
}

async function getLatestAutomationRunForAction(
  ctx: Pick<QueryCtx, "db">,
  args: {
    action: string;
    operatingDate: string;
    storeId: Id<"store">;
  },
) {
  const runs = await listAutomationRunsForStoreDayActionWithCtx(ctx, {
    action: args.action,
    domain: "daily_operations",
    operatingDate: args.operatingDate,
    storeId: args.storeId,
  });

  return runs.sort(compareAutomationRuns)[0] ?? null;
}

async function getLatestAppliedAutomationRunForAction(
  ctx: Pick<QueryCtx, "db">,
  args: {
    action: string;
    operatingDate: string;
    storeId: Id<"store">;
  },
) {
  const runs = await listAutomationRunsForStoreDayActionWithCtx(ctx, {
    action: args.action,
    domain: "daily_operations",
    operatingDate: args.operatingDate,
    storeId: args.storeId,
  });

  return (
    runs
      .filter((run) => run.outcome === "applied")
      .sort(compareAutomationRuns)[0] ?? null
  );
}

function automationRunClassification(run: Doc<"automationRun">) {
  return typeof run.decisionEvidence?.classification === "string"
    ? run.decisionEvidence.classification
    : undefined;
}

function automationStatusBucketForRun(
  run: Doc<"automationRun">,
): DailyOperationsAutomationStatusBucket {
  if (run.outcome === "failed") return "failed";
  if (run.outcome === "applied") return "action_taken";

  const classification = automationRunClassification(run);

  if (classification === "outside_completion_window") {
    return "scheduled_later";
  }

  if (run.outcome === "prepared" || classification === "blocked") {
    return "needs_review";
  }

  return "policy_skipped";
}

const AUTOMATION_BUCKET_PRECEDENCE: Record<
  DailyOperationsAutomationStatusBucket,
  number
> = {
  failed: 0,
  action_taken: 1,
  needs_review: 2,
  policy_skipped: 3,
  scheduled_later: 4,
};

function compareAutomationRunsByBucket(
  left: Doc<"automationRun">,
  right: Doc<"automationRun">,
) {
  const bucketDelta =
    AUTOMATION_BUCKET_PRECEDENCE[automationStatusBucketForRun(left)] -
    AUTOMATION_BUCKET_PRECEDENCE[automationStatusBucketForRun(right)];

  if (bucketDelta !== 0) return bucketDelta;

  return compareAutomationRuns(left, right);
}

function isAutomationRun(
  run: Doc<"automationRun"> | null | undefined,
): run is Doc<"automationRun"> {
  return Boolean(run);
}

async function listDailyOperationsAutomationStatuses(
  ctx: Pick<QueryCtx, "db">,
  args: {
    closeCompletion?: {
      actorType?: "human" | "automation";
      automationRunId?: Id<"automationRun">;
    } | null;
    includeManagerReviewEvidence?: boolean;
    operatingDate: string;
    storeId: Id<"store">;
  },
): Promise<DailyOperationsAutomationStatus[]> {
  const [
    openingRun,
    closePrepareRun,
    closeAutoCompleteRun,
    appliedCloseAutoCompleteRun,
    openingRecord,
  ] = await Promise.all([
    getLatestAutomationRunForAction(ctx, {
      action: "opening.auto_start",
      operatingDate: args.operatingDate,
      storeId: args.storeId,
    }),
    getLatestAutomationRunForAction(ctx, {
      action: "eod.prepare",
      operatingDate: args.operatingDate,
      storeId: args.storeId,
    }),
    getLatestAutomationRunForAction(ctx, {
      action: "eod.auto_complete",
      operatingDate: args.operatingDate,
      storeId: args.storeId,
    }),
    getLatestAppliedAutomationRunForAction(ctx, {
      action: "eod.auto_complete",
      operatingDate: args.operatingDate,
      storeId: args.storeId,
    }),
    getDailyOpeningRecordForDate(ctx, args),
  ]);
  const statuses: DailyOperationsAutomationStatus[] = [];
  const completedByAthena = args.closeCompletion?.actorType === "automation";
  const closeRun =
    completedByAthena && appliedCloseAutoCompleteRun
      ? appliedCloseAutoCompleteRun
      : ([closeAutoCompleteRun, closePrepareRun]
          .filter(isAutomationRun)
          .sort(compareAutomationRunsByBucket)[0] ?? null);

  if (
    openingRun &&
    !(
      openingRecord?.status === "started" &&
      automationStatusBucketForRun(openingRun) !== "action_taken"
    )
  ) {
    const reviewEvidence = reviewEvidenceForDailyOperations(openingRecord);

    statuses.push({
      bucket: automationStatusBucketForRun(openingRun),
      id: openingRun._id,
      ...(openingRun.decisionReason
        ? { decisionReason: openingRun.decisionReason }
        : {}),
      lane: "opening",
      occurredAt: openingRun.appliedAt ?? openingRun.updatedAt,
      outcome: openingRun.outcome,
      policyMode: openingRun.policyMode,
      policyVersion: openingRun.policyVersion,
      ...(args.includeManagerReviewEvidence &&
      reviewEvidence &&
      reviewEvidence.length > 0
        ? { reviewEvidence }
        : {}),
      sourceLink: {
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
      },
    });
  }

  if (
    closeRun &&
    !(
      args.closeCompletion &&
      automationStatusBucketForRun(closeRun) !== "action_taken"
    )
  ) {
    statuses.push({
      bucket: automationStatusBucketForRun(closeRun),
      id: closeRun._id,
      ...(args.includeManagerReviewEvidence && closeRun.decisionEvidence
        ? { decisionEvidence: closeRun.decisionEvidence }
        : {}),
      ...(closeRun.decisionReason
        ? { decisionReason: closeRun.decisionReason }
        : {}),
      lane: "close",
      occurredAt: closeRun.appliedAt ?? closeRun.updatedAt,
      outcome: closeRun.outcome,
      policyMode: closeRun.policyMode,
      policyVersion: closeRun.policyVersion,
      sourceLink: {
        search: {
          operatingDate: args.operatingDate,
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
      },
    });
  }

  return statuses.sort((left, right) => {
    return (right.occurredAt ?? 0) - (left.occurredAt ?? 0);
  });
}

function isOperatorVisibleScheduledRun(run: Doc<"scheduledRunLedger">) {
  if (run.scope !== "store" || run.visibility !== "store" || !run.storeId) {
    return false;
  }

  if (run.outcome === "applied" || run.outcome === "partial_failure") {
    return true;
  }

  return (
    run.outcome === "no_candidates" &&
    run.candidateCount === 0 &&
    MEANINGFUL_ZERO_CANDIDATE_CRON_FAMILIES.has(run.cronFamily)
  );
}

async function listDailyOperationsScheduledRunSummaries(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    limit?: number;
    storeId: Id<"store">;
    startAt: number;
  },
): Promise<DailyOperationsScheduledRunSummary[]> {
  const limit = Math.max(
    0,
    Math.min(
      args.limit ?? FULL_SCHEDULED_RUN_SUMMARY_LIMIT,
      FULL_SCHEDULED_RUN_SUMMARY_LIMIT,
    ),
  );

  if (limit === 0) return [];

  const runs = (
    await Promise.all(
      SCHEDULED_RUN_CRON_FAMILIES.map((cronFamily) =>
        ctx.db
          .query("scheduledRunLedger")
          .withIndex("by_storeId_cronFamily_window", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("cronFamily", cronFamily)
              .gte("scheduledWindowStartAt", args.startAt),
          )
          .order("desc")
          .take(limit),
      ),
    )
  ).flat();

  return runs
    .filter(
      (run) =>
        run.scheduledWindowStartAt < args.endAt &&
        isOperatorVisibleScheduledRun(run),
    )
    .sort((left, right) => right.completedAt - left.completedAt)
    .slice(0, limit)
    .map((run) => ({
      candidateCount: run.candidateCount,
      completedAt: run.completedAt,
      cronFamily: run.cronFamily,
      failedCount: run.failedCount,
      id: run._id,
      outcome: run.outcome as DailyOperationsScheduledRunSummary["outcome"],
      processedCount: run.processedCount,
      skippedCount: run.skippedCount,
      succeededCount: run.succeededCount,
      windowEndAt: run.scheduledWindowEndAt,
      windowStartAt: run.scheduledWindowStartAt,
    }));
}

function getCloseItemCounts(items: SourceItem[]) {
  return {
    approvalCount: items.filter((item) => item.category === "approval").length,
    expenseCount: items.filter((item) => item.category === "expense").length,
    posSessionCount: items.filter((item) => item.category === "pos_session")
      .length,
    registerCount: items.filter(
      (item) =>
        item.category === "register_session" ||
        item.subject.type === "register_session",
    ).length,
  };
}

function queueAttentionItems(args: {
  approvalRequests: Array<Doc<"approvalRequest">>;
  openWorkItems: Array<Doc<"operationalWorkItem">>;
}): DailyOperationsAttentionItem[] {
  return [
    ...args.approvalRequests.map((approval) => ({
      id: `approval_request:${approval._id}:pending`,
      label: approval.reason || "Approval pending",
      message: "Resolve the pending approval in Operations.",
      owner: "operations_queue" as const,
      severity: "critical" as const,
      source: {
        id: approval._id,
        label: approval.reason,
        type: "approval_request",
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
    })),
    ...args.openWorkItems.map((workItem) => ({
      id: `operational_work_item:${workItem._id}:${workItem.status}`,
      label: workItem.title,
      message: "Open operational work is waiting in the queue.",
      owner: "operations_queue" as const,
      severity: "warning" as const,
      source: {
        id: workItem._id,
        label: workItem.title,
        type: "operational_work_item",
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
    })),
  ];
}

function lifecycleCopy(status: LifecycleStatus) {
  if (status === "not_opened") {
    return {
      description: "Start Opening Handoff before running the store day.",
      label: "Not opened",
    };
  }

  if (status === "close_blocked") {
    return {
      description: "Resolve close blockers before ending the store day.",
      label: "Close blocked",
    };
  }

  if (status === "ready_to_close") {
    return {
      description:
        "Opening Handoff is complete and the end of day review has no blockers.",
      label: "Ready to close",
    };
  }

  if (status === "closed") {
    return {
      description: "The store day has a saved close summary.",
      label: "Closed",
    };
  }

  if (status === "reopened") {
    return {
      description:
        "The end of day review was reopened. Complete the revised review before treating the store day as closed.",
      label: "Reopened",
    };
  }

  return {
    description:
      "Opening Handoff is complete. Keep open work visible through end of day review.",
    label: "Operating",
  };
}

function primaryAction(status: LifecycleStatus): {
  label: string;
  to: string;
} {
  if (status === "not_opened") {
    return {
      label: "Start Opening Handoff",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
    };
  }

  if (status === "close_blocked") {
    return {
      label: "Review close blockers",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    };
  }

  if (status === "closed") {
    return {
      label: "Review EOD Review",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    };
  }

  if (status === "reopened") {
    return {
      label: "Revise EOD Review",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    };
  }

  return {
    label: "Start EOD Review",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
  };
}

function buildLanes(args: {
  closeBlockerCounts: ReturnType<typeof getCloseItemCounts>;
  closeStatus: string;
  isCloseReopened: boolean;
  isOpeningStarted: boolean;
  openingAttentionCount: number;
  openingStatus: string;
  queueCounts: {
    approvalCount: number;
    approvalCountLabel: string;
    workItemCount: number;
    workItemCountLabel: string;
  };
}): DailyOperationsLane[] {
  const openingStatus: LaneStatus = args.isOpeningStarted
    ? "ready"
    : args.openingStatus === "blocked"
      ? "blocked"
      : args.openingStatus === "needs_attention"
        ? "needs_attention"
        : "ready";
  const closeStatus: LaneStatus =
    args.closeStatus === "blocked"
      ? "blocked"
      : args.closeStatus === "completed"
        ? "closed"
        : args.closeStatus === "needs_review"
          ? "needs_attention"
          : "ready";
  const closeBlockerCount =
    args.closeBlockerCounts.registerCount +
    args.closeBlockerCounts.posSessionCount +
    args.closeBlockerCounts.approvalCount;

  return [
    {
      count: args.openingAttentionCount,
      description: args.isOpeningStarted
        ? "Opening Handoff is complete."
        : args.openingAttentionCount > 0
          ? `${pluralize(args.openingAttentionCount, "opening item")} will be reviewed when Opening Handoff starts.`
          : "Opening Handoff is ready to start.",
      key: "opening",
      label: "Opening Handoff",
      status: openingStatus,
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
    },
    {
      count:
        args.closeStatus === "completed" && !args.isCloseReopened
          ? 0
          : closeBlockerCount,
      description:
        args.closeStatus === "blocked" && args.isCloseReopened
          ? `${pluralize(closeBlockerCount, "blocker")} after reopening.`
          : args.closeStatus === "completed"
            ? "The end of day review is saved for this store day."
            : args.closeStatus === "blocked"
              ? `${pluralize(closeBlockerCount, "blocker")} before close.`
              : "The end of day review is available for review.",
      key: "close",
      label: "EOD Review",
      status: closeStatus,
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    },
    {
      count: args.queueCounts.workItemCount,
      countLabel: args.queueCounts.workItemCountLabel,
      description:
        args.queueCounts.workItemCount > 0
          ? `${args.queueCounts.workItemCountLabel} open item${
              args.queueCounts.workItemCount === 1 ? "" : "s"
            }.`
          : "No open queue work.",
      key: "queue",
      label: "Open work",
      status: args.queueCounts.workItemCount > 0 ? "needs_attention" : "ready",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
    },
    buildApprovalsLane({
      approvalCount: args.queueCounts.approvalCount,
      approvalCountLabel: args.queueCounts.approvalCountLabel,
    }),
    {
      count: args.closeBlockerCounts.registerCount,
      description:
        args.closeBlockerCounts.registerCount > 0
          ? `${pluralize(args.closeBlockerCounts.registerCount, "register")} ${
              args.closeBlockerCounts.registerCount === 1 ? "needs" : "need"
            } attention.`
          : "No register blockers.",
      key: "registers",
      label: "Registers",
      status: args.closeBlockerCounts.registerCount > 0 ? "blocked" : "ready",
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls",
    },
    {
      count: args.closeBlockerCounts.posSessionCount,
      description:
        args.closeBlockerCounts.posSessionCount > 0
          ? `${pluralize(args.closeBlockerCounts.posSessionCount, "POS session")} open or held.`
          : "No unresolved POS sessions.",
      key: "pos_sessions",
      label: "POS sessions",
      status: args.closeBlockerCounts.posSessionCount > 0 ? "blocked" : "ready",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    },
    {
      count: args.closeBlockerCounts.expenseCount,
      description:
        args.closeBlockerCounts.expenseCount > 0
          ? `${pluralize(args.closeBlockerCounts.expenseCount, "expense")} in close review.`
          : "No expense exceptions.",
      key: "expenses",
      label: "Expenses",
      status: "ready",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    },
  ];
}

function buildApprovalsLane(args: {
  approvalCount: number;
  approvalCountLabel: string;
}): DailyOperationsLane {
  return {
    count: args.approvalCount,
    countLabel: args.approvalCountLabel,
    description:
      args.approvalCount > 0
        ? `${args.approvalCountLabel} approval${
            args.approvalCount === 1 ? "" : "s"
          } pending.`
        : "No pending approvals.",
    key: "approvals",
    label: "Approvals",
    status: args.approvalCount > 0 ? "blocked" : "ready",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
  };
}

export async function buildDailyOperationsSnapshotWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt?: number;
    includeAnalyticsDetails?: boolean;
    includeFinancialDetails?: boolean;
    includeManagerReviewEvidence?: boolean;
    includeScheduledRunSummaries?: boolean;
    includeStorePulseDetails?: boolean;
    scheduledRunSummariesLimit?: number;
    operatingDate: string;
    operatingTimezoneOffsetMinutes?: number;
    startAt?: number;
    storeId: Id<"store">;
    storePulseWindow?: DailyOperationsStorePulseWindow;
    timelineLimit?: number;
    timelinePreviewLimit?: number;
    weekEndOperatingDate?: string;
  },
) {
  const includeFinancialDetails = args.includeFinancialDetails ?? true;
  const includeAnalyticsDetails =
    args.includeAnalyticsDetails ?? includeFinancialDetails;
  const includeStorePulseDetails =
    args.includeStorePulseDetails ?? includeAnalyticsDetails;
  const range = resolveRange(args);
  const [
    openingSnapshot,
    closeSnapshot,
    dailyCloseRecord,
    queueCounts,
    scheduledRunSummaries,
    timeline,
    store,
    storePulse,
    weekMetrics,
  ] = await Promise.all([
    buildDailyOpeningSnapshotWithCtx(ctx, args),
    buildDailyCloseSnapshotWithCtx(ctx, args),
    getDailyCloseRecordForDate(ctx, args),
    listOpenQueueSnapshot(ctx, {
      ...range,
      storeId: args.storeId,
    }),
    args.includeScheduledRunSummaries &&
    (args.includeManagerReviewEvidence ?? true)
      ? listDailyOperationsScheduledRunSummaries(ctx, {
          ...range,
          limit: args.scheduledRunSummariesLimit,
          storeId: args.storeId,
        })
      : Promise.resolve([]),
    listTimelineEvents(ctx, {
      ...range,
      includeManagerReviewEvidence: args.includeManagerReviewEvidence ?? true,
      limit: args.timelineLimit,
      storeId: args.storeId,
    }),
    ctx.db.get("store", args.storeId),
    includeStorePulseDetails
      ? getStorePulseSummaryForWindow(ctx as QueryCtx, {
          currentDayEnd: range.endAt - 1,
          currentDayStart: range.startAt,
          currentOperatingDate: args.operatingDate,
          pulseWindow: args.storePulseWindow ?? "today",
          storeId: args.storeId,
        })
      : Promise.resolve(undefined),
    includeAnalyticsDetails ? buildWeekMetrics(ctx, args) : Promise.resolve([]),
  ]);
  const automationStatuses = await listDailyOperationsAutomationStatuses(ctx, {
    ...args,
    closeCompletion: closeSnapshot.completedClose,
  });
  const priorOperatingDate = shiftOperatingDate(args.operatingDate, -1);
  const priorDayMetric = includeAnalyticsDetails
    ? (weekMetrics.find(
        (metric) => metric.operatingDate === priorOperatingDate,
      ) ??
      (await buildWeekMetricForDate(ctx, {
        isSelected: false,
        operatingDate: priorOperatingDate,
        operatingTimezoneOffsetMinutes: args.operatingTimezoneOffsetMinutes,
        storeId: args.storeId,
      })))
    : undefined;
  const visibleTimeline =
    typeof args.timelinePreviewLimit === "number"
      ? timeline.slice(0, args.timelinePreviewLimit)
      : timeline;
  const timelineHasMore =
    typeof args.timelinePreviewLimit === "number"
      ? timeline.length > args.timelinePreviewLimit
      : undefined;

  const isOpeningStarted = openingSnapshot.status === "started";
  const isCloseReopened =
    closeSnapshot.existingClose?.lifecycleStatus === "reopened" ||
    dailyCloseRecord?.lifecycleStatus === "reopened";
  const closeBlockers = closeSnapshot.blockers as SourceItem[];
  const closeReviews = closeSnapshot.reviewItems as SourceItem[];
  const openingAttention = [
    ...(openingSnapshot.blockers as SourceItem[]),
    ...(openingSnapshot.reviewItems as SourceItem[]),
    ...(openingSnapshot.carryForwardItems as SourceItem[]),
  ];
  const attentionItems: DailyOperationsAttentionItem[] = [];

  if (!isOpeningStarted) {
    if (openingSnapshot.status !== "ready") {
      attentionItems.push(openingNotStartedAttention(args));
    }
    attentionItems.push(
      ...openingAttention.map((item) =>
        sourceAttentionItem("daily_opening", item),
      ),
    );
  } else {
    if (
      isCloseReopened &&
      closeSnapshot.status !== "ready" &&
      closeSnapshot.status !== "carry_forward"
    ) {
      attentionItems.push({
        id: `daily_close:${args.storeId}:${args.operatingDate}:reopened`,
        label: "EOD Review reopened",
        message:
          "Complete the revised end of day review before treating the store day as closed.",
        owner: "daily_close",
        severity: "warning",
        source: {
          id:
            closeSnapshot.existingClose?._id ??
            dailyCloseRecord?._id ??
            `${args.storeId}:${args.operatingDate}`,
          label: `EOD Review ${args.operatingDate}`,
          type: "daily_close",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
      });
    }
    attentionItems.push(
      ...closeBlockers.map((item) => sourceAttentionItem("daily_close", item)),
      ...closeReviews.map((item) => sourceAttentionItem("daily_close", item)),
    );
  }
  attentionItems.push(
    ...queueAttentionItems({
      approvalRequests: queueCounts.approvalRequests,
      openWorkItems: queueCounts.openWorkItems,
    }),
  );

  const lifecycleStatus: LifecycleStatus = !isOpeningStarted
    ? "not_opened"
    : closeSnapshot.status === "completed"
      ? "closed"
      : closeSnapshot.blockers.length > 0
        ? "close_blocked"
        : closeSnapshot.status === "ready" ||
            closeSnapshot.status === "carry_forward"
          ? "ready_to_close"
          : isCloseReopened
            ? "reopened"
            : "operating";
  const lifecycle = {
    status: lifecycleStatus,
    ...lifecycleCopy(lifecycleStatus),
  };
  const closeBlockerCounts = getCloseItemCounts(closeBlockers);
  const closeSummary = maybeRedactCloseSummary(
    {
      carriedOverCashTotal: closeSnapshot.summary.carriedOverCashTotal,
      carriedOverRegisterCount: closeSnapshot.summary.carriedOverRegisterCount,
      currentDayCashTotal: closeSnapshot.summary.currentDayCashTotal,
      currentDayCashTransactionCount:
        closeSnapshot.summary.currentDayCashTransactionCount,
      expenseTotal: closeSnapshot.summary.expenseTotal,
      expenseTransactionCount: closeSnapshot.summary.expenseTransactionCount,
      adjustedSalesTotal: closeSnapshot.summary.adjustedSalesTotal,
      adjustmentCashSettlementTotal:
        closeSnapshot.summary.adjustmentCashSettlementTotal,
      adjustmentCollectionTotal:
        closeSnapshot.summary.adjustmentCollectionTotal,
      adjustmentNetSettlementTotal:
        closeSnapshot.summary.adjustmentNetSettlementTotal,
      adjustmentRefundTotal: closeSnapshot.summary.adjustmentRefundTotal,
      itemAdjustmentCount: closeSnapshot.summary.itemAdjustmentCount,
      netCashVariance: closeSnapshot.summary.netCashVariance,
      netCashMovementTotal: closeSnapshot.summary.netCashMovementTotal,
      paymentTotals: closeSnapshot.summary.paymentTotals ?? [],
      registerVarianceCount: closeSnapshot.summary.registerVarianceCount,
      salesTotal: closeSnapshot.summary.salesTotal,
      transactionCount: closeSnapshot.summary.transactionCount,
    },
    includeFinancialDetails,
  );

  return {
    automationStatuses,
    attentionItems,
    completedClose: closeSnapshot.completedClose
      ? {
          ...closeSnapshot.completedClose,
          carryForwardCount: closeSnapshot.readiness?.carryForwardCount ?? 0,
        }
      : closeSnapshot.completedClose,
    closeSummary,
    currency: store?.currency ?? "GHS",
    endAt: range.endAt,
    lanes: buildLanes({
      closeBlockerCounts,
      closeStatus: closeSnapshot.status,
      isCloseReopened,
      isOpeningStarted,
      openingAttentionCount: openingAttention.length,
      openingStatus: openingSnapshot.status,
      queueCounts: {
        approvalCount: queueCounts.approvalRequests.length,
        approvalCountLabel: queueCounts.approvalRequestsCountLabel,
        workItemCount: queueCounts.openWorkItems.length,
        workItemCountLabel: queueCounts.openWorkItemsCountLabel,
      },
    }),
    lifecycle,
    operatingDate: args.operatingDate,
    ...(includeAnalyticsDetails && priorDayMetric ? { priorDayMetric } : {}),
    primaryAction: primaryAction(lifecycleStatus),
    scheduledRunSummaries,
    startAt: range.startAt,
    storeId: args.storeId,
    ...(storePulse ? { storePulse } : {}),
    timeline: visibleTimeline,
    ...(typeof timelineHasMore === "boolean" ? { timelineHasMore } : {}),
    weekMetrics,
  };
}

async function buildCompactDailyOperationsWeekSnapshotsWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt?: number;
    includeManagerReviewEvidence: boolean;
    operatingDate: string;
    operatingTimezoneOffsetMinutes?: number;
    startAt?: number;
    storeId: Id<"store">;
    storePulseWindow?: DailyOperationsStorePulseWindow;
    weekEndOperatingDate?: string;
  },
  weekMetrics: Awaited<
    ReturnType<typeof buildDailyOperationsSnapshotWithCtx>
  >["weekMetrics"],
) {
  const { endAt: _endAt, startAt: _startAt, ...weekSnapshotArgs } = args;

  return Promise.all(
    weekMetrics.map((metric) =>
      buildDailyOperationsSnapshotWithCtx(ctx, {
        ...weekSnapshotArgs,
        includeAnalyticsDetails: false,
        includeFinancialDetails: args.includeManagerReviewEvidence,
        includeManagerReviewEvidence: args.includeManagerReviewEvidence,
        includeScheduledRunSummaries: false,
        operatingDate: metric.operatingDate,
        scheduledRunSummariesLimit: 0,
        timelineLimit: 0,
        timelinePreviewLimit: 0,
      }),
    ),
  );
}

function maybeRedactCloseSummary(
  summary: DailyOperationsCloseSummary,
  includeFinancialDetails: boolean,
) {
  if (includeFinancialDetails) return summary;

  return {
    ...summary,
    adjustedSalesTotal: 0,
    adjustmentCashSettlementTotal: 0,
    adjustmentCollectionTotal: 0,
    adjustmentNetSettlementTotal: 0,
    adjustmentRefundTotal: 0,
    carriedOverCashTotal: 0,
    currentDayCashTotal: 0,
    expenseTotal: 0,
    netCashVariance: 0,
    netCashMovementTotal: 0,
    paymentTotals: [],
    salesTotal: 0,
  } satisfies DailyOperationsCloseSummary;
}

const dailyOperationsSnapshotArgsValidator = {
  endAt: v.optional(v.number()),
  operatingDate: v.string(),
  operatingTimezoneOffsetMinutes: v.optional(v.number()),
  startAt: v.optional(v.number()),
  storeId: v.id("store"),
  storePulseWindow: v.optional(storePulseWindowValidator),
  weekEndOperatingDate: v.optional(v.string()),
};

const dailyOperationsRefreshArgsValidator = {
  ...dailyOperationsSnapshotArgsValidator,
  refreshRequestedAt: v.optional(v.number()),
};

async function authorizeDailyOperationsSnapshot(
  ctx: QueryCtx,
  args: { storeId: Id<"store"> },
) {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    throw new Error("Store not found.");
  }

  const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
  const membership = await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin", "pos_only"],
    failureMessage: "You cannot view daily operations for this store.",
    organizationId: store.organizationId,
    userId: athenaUser._id,
  });

  return {
    includeManagerReviewEvidence: membership.role === "full_admin",
  };
}

export const getDailyOperationsSnapshot = query({
  args: dailyOperationsSnapshotArgsValidator,
  handler: async (ctx, args) => {
    const { includeManagerReviewEvidence } =
      await authorizeDailyOperationsSnapshot(ctx, args);

    return buildDailyOperationsSnapshotWithCtx(ctx, {
      ...args,
      includeAnalyticsDetails: false,
      includeFinancialDetails: includeManagerReviewEvidence,
      includeManagerReviewEvidence,
      includeScheduledRunSummaries: includeManagerReviewEvidence,
      scheduledRunSummariesLimit: COMPACT_SCHEDULED_RUN_SUMMARY_LIMIT,
      timelineLimit: 0,
      timelinePreviewLimit: 0,
    });
  },
});

export const getDailyOperationsDetailSnapshot = query({
  args: {
    ...dailyOperationsSnapshotArgsValidator,
  },
  handler: async (ctx, args) => {
    const { includeManagerReviewEvidence } =
      await authorizeDailyOperationsSnapshot(ctx, args);

    const snapshot = await buildDailyOperationsSnapshotWithCtx(ctx, {
      ...args,
      includeAnalyticsDetails: includeManagerReviewEvidence,
      includeFinancialDetails: includeManagerReviewEvidence,
      includeManagerReviewEvidence,
      includeScheduledRunSummaries: false,
      includeStorePulseDetails: false,
      scheduledRunSummariesLimit: 0,
      timelineLimit: 0,
      timelinePreviewLimit: 0,
    });

    const weekSnapshots = await buildCompactDailyOperationsWeekSnapshotsWithCtx(
      ctx,
      {
        ...args,
        includeManagerReviewEvidence,
      },
      snapshot.weekMetrics,
    );
    return {
      ...snapshot,
      weekSnapshots,
    };
  },
});

export const getDailyOperationsStorePulseSnapshot = query({
  args: dailyOperationsSnapshotArgsValidator,
  handler: async (ctx, args) => {
    const { includeManagerReviewEvidence } =
      await authorizeDailyOperationsSnapshot(ctx, args);
    const range = resolveRange(args);
    const storePulse = includeManagerReviewEvidence
      ? await getStorePulseSummaryForWindow(ctx, {
          currentDayEnd: range.endAt - 1,
          currentDayStart: range.startAt,
          currentOperatingDate: args.operatingDate,
          pulseWindow: args.storePulseWindow ?? "today",
          storeId: args.storeId,
        })
      : null;

    return {
      operatingDate: args.operatingDate,
      storePulse,
    };
  },
});

export const getDailyOperationsStoreRequestsSnapshot = query({
  args: dailyOperationsSnapshotArgsValidator,
  handler: async (ctx, args) => {
    await authorizeDailyOperationsSnapshot(ctx, args);
    const range = resolveRange(args);
    const approvals = await listPendingApprovalRequestsSnapshot(ctx, {
      ...range,
      storeId: args.storeId,
    });

    return {
      approvalsLane: buildApprovalsLane({
        approvalCount: approvals.approvalRequests.length,
        approvalCountLabel: approvals.approvalRequestsCountLabel,
      }),
      operatingDate: args.operatingDate,
    };
  },
});

export const getDailyOperationsAutomationSnapshot = query({
  args: dailyOperationsSnapshotArgsValidator,
  handler: async (ctx, args) => {
    const { includeManagerReviewEvidence } =
      await authorizeDailyOperationsSnapshot(ctx, args);
    const dailyCloseRecord = await getDailyCloseRecordForDate(ctx, args);

    return {
      automationStatuses: await listDailyOperationsAutomationStatuses(ctx, {
        ...args,
        closeCompletion: dailyCloseRecord
          ? {
              actorType: dailyCloseRecord.actorType,
              automationRunId: dailyCloseRecord.automationRunId,
            }
          : null,
        includeManagerReviewEvidence,
      }),
      operatingDate: args.operatingDate,
    };
  },
});

export const getDailyOperationsTodayRefreshSnapshot = query({
  args: dailyOperationsRefreshArgsValidator,
  handler: async (ctx, args) => {
    const { includeManagerReviewEvidence } =
      await authorizeDailyOperationsSnapshot(ctx, args);
    const snapshot = await buildDailyOperationsSnapshotWithCtx(ctx, {
      ...args,
      includeAnalyticsDetails: false,
      includeFinancialDetails: includeManagerReviewEvidence,
      includeManagerReviewEvidence,
      includeScheduledRunSummaries: false,
      includeStorePulseDetails: includeManagerReviewEvidence,
      scheduledRunSummariesLimit: 0,
      timelineLimit: 0,
      timelinePreviewLimit: 0,
    });
    const weekMetric = includeManagerReviewEvidence
      ? await buildWeekMetricForDate(ctx, {
          isSelected: true,
          operatingDate: args.operatingDate,
          operatingTimezoneOffsetMinutes: args.operatingTimezoneOffsetMinutes,
          storeId: args.storeId,
        })
      : null;
    const priorDayMetric = includeManagerReviewEvidence
      ? await buildWeekMetricForDate(ctx, {
          isSelected: false,
          operatingDate: shiftOperatingDate(args.operatingDate, -1),
          operatingTimezoneOffsetMinutes: args.operatingTimezoneOffsetMinutes,
          storeId: args.storeId,
        })
      : null;

    return {
      attentionItems: snapshot.attentionItems,
      closeSummary: snapshot.closeSummary,
      completedClose: snapshot.completedClose ?? null,
      currency: snapshot.currency,
      endAt: snapshot.endAt,
      lanes: snapshot.lanes,
      lifecycle: snapshot.lifecycle,
      operatingDate: snapshot.operatingDate,
      primaryAction: snapshot.primaryAction,
      priorDayMetric,
      refreshedAt: Date.now(),
      refreshRequestedAt: args.refreshRequestedAt ?? null,
      startAt: snapshot.startAt,
      storeId: snapshot.storeId,
      storePulse: snapshot.storePulse ?? null,
      weekMetric,
    };
  },
});

export const getDailyOperationsTimelineSnapshot = query({
  args: dailyOperationsSnapshotArgsValidator,
  handler: async (ctx, args) => {
    const { includeManagerReviewEvidence } =
      await authorizeDailyOperationsSnapshot(ctx, args);
    const range = resolveRange(args);

    return {
      operatingDate: args.operatingDate,
      timeline: await listTimelineEvents(ctx, {
        ...range,
        includeManagerReviewEvidence,
        limit: MAX_OPERATIONS_QUERY_LIMIT,
        storeId: args.storeId,
      }),
    };
  },
});

export const getDailyOperationsTimelinePreviewSnapshot = query({
  args: dailyOperationsSnapshotArgsValidator,
  handler: async (ctx, args) => {
    const { includeManagerReviewEvidence } =
      await authorizeDailyOperationsSnapshot(ctx, args);
    const range = resolveRange(args);
    const timeline = await listTimelineEvents(ctx, {
      ...range,
      includeManagerReviewEvidence,
      limit: COMPACT_OPERATIONS_TIMELINE_LIMIT + 1,
      storeId: args.storeId,
    });

    return {
      operatingDate: args.operatingDate,
      timeline: timeline.slice(0, COMPACT_OPERATIONS_TIMELINE_LIMIT),
      timelineHasMore: timeline.length > COMPACT_OPERATIONS_TIMELINE_LIMIT,
    };
  },
});
