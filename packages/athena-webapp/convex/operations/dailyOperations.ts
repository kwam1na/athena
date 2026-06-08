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

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OPERATIONS_QUERY_LIMIT = 200;
const MAX_OPERATIONS_LOOKAHEAD_LIMIT = MAX_OPERATIONS_QUERY_LIMIT + 1;
const OPEN_WORK_ITEM_STATUSES = ["open", "in_progress"] as const;
const TIMELINE_REGISTER_SESSION_STATUSES = ["closed", "closing"] as const;
const TIMELINE_PENDING_REGISTER_COUNT_STATUSES = [
  "accepted",
  "conflicted",
  "held",
] as const;

type LinkTarget = {
  label?: string;
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
  createdAt: number;
  id: string;
  message: string;
  productLink?: LinkTarget;
  registerLink?: LinkTarget;
  subject: SourceSubject;
  transactionLink?: LinkTarget;
  type: string;
};

type DailyOperationsAutomationStatus = {
  id: string;
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
  sourceLink: LinkTarget;
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
    registerVarianceCount: 0,
    salesTotal: 0,
    transactionCount: 0,
  };
}

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  if (value === 1) return `1 ${singular}`;
  return `${value} ${plural}`;
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
  ] =
    await Promise.all([
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
  const currentDailyClose =
    dailyClose.find((close) => close.isCurrent) ?? dailyClose[0];
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
      currentDailyClose.lifecycleStatus !== "reopened",
    isReopened: currentDailyClose?.lifecycleStatus === "reopened",
    isSelected: args.isSelected,
    operatingDate: args.operatingDate,
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
  storeId: Id<"store">,
) {
  const [workItemBatches, pendingApprovalRequests] = await Promise.all([
    Promise.all(
      OPEN_WORK_ITEM_STATUSES.map((status) =>
        ctx.db
          .query("operationalWorkItem")
          .withIndex("by_storeId_status", (q) =>
            q.eq("storeId", storeId).eq("status", status),
          )
          .take(MAX_OPERATIONS_LOOKAHEAD_LIMIT),
      ),
    ),
    ctx.db
      .query("approvalRequest")
      .withIndex("by_storeId_status", (q) =>
        q.eq("storeId", storeId).eq("status", "pending"),
      )
      .take(MAX_OPERATIONS_LOOKAHEAD_LIMIT),
  ]);

  const openWorkItems = workItemBatches
    .flatMap((batch) => batch)
    .slice(0, MAX_OPERATIONS_QUERY_LIMIT);
  const approvalRequests = pendingApprovalRequests.slice(
    0,
    MAX_OPERATIONS_QUERY_LIMIT,
  );
  const hasMoreOpenWorkItems =
    workItemBatches.some(
      (batch) => batch.length > MAX_OPERATIONS_QUERY_LIMIT,
    ) ||
    workItemBatches.reduce((total, batch) => total + batch.length, 0) >
      MAX_OPERATIONS_QUERY_LIMIT;
  const hasMoreApprovalRequests =
    pendingApprovalRequests.length > MAX_OPERATIONS_QUERY_LIMIT;

  return {
    approvalRequests,
    approvalRequestsCountLabel: hasMoreApprovalRequests
      ? `${MAX_OPERATIONS_QUERY_LIMIT}+`
      : String(approvalRequests.length),
    hasMoreApprovalRequests,
    hasMoreOpenWorkItems,
    openWorkItems,
    openWorkItemsCountLabel: hasMoreOpenWorkItems
      ? `${MAX_OPERATIONS_QUERY_LIMIT}+`
      : String(openWorkItems.length),
  };
}

async function listTimelineEvents(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt: number;
    startAt: number;
    storeId: Id<"store">;
  },
): Promise<DailyOperationsTimelineEvent[]> {
  if (!args.startAt || !args.endAt) return [];

  const eventsPromise = ctx.db
    .query("operationalEvent")
    .withIndex("by_storeId_createdAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .gte("createdAt", args.startAt)
        .lt("createdAt", args.endAt),
    )
    .order("desc")
    .take(MAX_OPERATIONS_QUERY_LIMIT);
  const registerSessionsPromise = listTimelineRegisterSessions(ctx, args.storeId);
  const pendingRegisterCountsPromise = listPendingRegisterCountTimelineEvents(
    ctx,
    args,
  );
  const [events, registerSessions, pendingRegisterCountEvents] = await Promise.all([
    eventsPromise,
    registerSessionsPromise,
    pendingRegisterCountsPromise,
  ]);
  const operationalCloseoutKeys = new Set(
    events
      .map((event) => getOperationalRegisterCloseoutKey(event))
      .filter((key): key is string => key !== null),
  );
  const [operationalTimelineEvents, registerCloseoutTimelineEvents] =
    await Promise.all([
      Promise.all(events.map((event) => mapOperationalTimelineEvent(ctx, event))),
      Promise.resolve(
        buildRegisterCloseoutTimelineEvents({
          endAt: args.endAt,
          operationalCloseoutKeys,
          registerSessions,
          startAt: args.startAt,
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
    .slice(0, MAX_OPERATIONS_QUERY_LIMIT);
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
  const eventsById = new Map<Id<"posLocalSyncEvent">, Doc<"posLocalSyncEvent">>();

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

  const [staffProfile, conflict] = await Promise.all([
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
  ]);
  const registerLabel = formatRegisterSessionLabel(
    registerSession.registerNumber,
  );
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
  event: {
    _id: Id<"operationalEvent">;
    createdAt: number;
    eventType: string;
    message: string;
    metadata?: Record<string, unknown>;
    subjectId: string;
    subjectLabel?: string;
    subjectType: string;
  },
): Promise<DailyOperationsTimelineEvent | null> {
  const metadata = event.metadata ?? {};
  if (isSaleBackedPendingCheckoutReuseEvent(event.eventType, metadata)) {
    return null;
  }

  const productId =
    typeof metadata.productId === "string"
      ? metadata.productId
      : typeof metadata.provisionalProductId === "string"
        ? metadata.provisionalProductId
        : undefined;
  const productSkuId =
    typeof metadata.productSkuId === "string"
      ? (metadata.productSkuId as Id<"productSku">)
      : typeof metadata.provisionalProductSkuId === "string"
        ? (metadata.provisionalProductSkuId as Id<"productSku">)
        : undefined;
  const productSku = productSkuId
    ? await ctx.db.get("productSku", productSkuId)
    : null;
  const productName =
    typeof metadata.productName === "string"
      ? metadata.productName
      : event.subjectLabel;
  const productSkuLabel =
    typeof metadata.productSkuLabel === "string"
      ? metadata.productSkuLabel
      : undefined;
  const sku =
    typeof metadata.sku === "string"
      ? metadata.sku
      : productSku?.sku ?? undefined;
  const isPendingCheckoutItemEvent =
    event.subjectType === "pos_pending_checkout_item" &&
    productSkuId !== undefined;
  const productLinkProductId = productId ?? productSku?.productId;
  const productSkuDisplayLabel =
    productSku?.productName && sku
      ? `${productSku.productName} (${sku})`
      : productSku?.productName || productName;
  const productLinkLabel =
    isPendingCheckoutItemEvent
      ? productName
      : event.subjectType === "product_sku"
        ? productName
        : productSkuLabel || productSkuDisplayLabel;
  const canLinkProduct =
    event.subjectType === "product_sku" ||
    isPendingCheckoutItemEvent ||
    productSkuId !== undefined;
  const transactionNumber =
    typeof metadata.transactionNumber === "string"
      ? metadata.transactionNumber
      : typeof metadata.receiptNumber === "string"
        ? metadata.receiptNumber
        : undefined;
  const transactionLink =
    event.subjectType === "posTransaction" && transactionNumber
      ? {
          label: `#${transactionNumber}`,
          params: {
            transactionId: event.subjectId,
          },
          to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
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
  const registerNumber =
    typeof metadata.registerNumber === "string"
      ? metadata.registerNumber
      : undefined;
  const registerLabel =
    event.subjectType === "register_session"
      ? event.subjectLabel ?? formatRegisterSessionLabel(registerNumber)
      : undefined;
  const registerLink =
    event.subjectType === "register_session"
      ? {
          label: registerLabel ?? "Register session",
          params: {
            sessionId: event.subjectId,
          },
          to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
        }
      : undefined;

  return {
    createdAt: event.createdAt,
    id: event._id,
    message: normalizeTimelineEventMessage(event.message),
    productLink,
    registerLink,
    subject: {
      id: event.subjectId,
      label: event.subjectLabel ?? registerLabel,
      type: event.subjectType,
    },
    transactionLink,
    type: event.eventType,
  };
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

function normalizeTimelineEventMessage(message: string) {
  return message.replace(/^Offline POS sale\b/, "Sale");
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

function buildRegisterCloseoutTimelineEvents(args: {
  endAt: number;
  operationalCloseoutKeys: Set<string>;
  registerSessions: Array<Doc<"registerSession">>;
  startAt: number;
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
        const label = formatRegisterSessionLabel(session.registerNumber);
        const eventType =
          record.type === "closed"
            ? "register_session_closed"
            : "register_session_closeout_reopened";

        return {
          createdAt: record.occurredAt,
          id: `register_closeout:${session._id}:${record.type}:${record.occurredAt}`,
          message: buildRegisterCloseoutTimelineMessage({
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
  label: string;
  type: "closed" | "reopened";
  variance?: number;
}) {
  if (args.type === "reopened") {
    return `${args.label} closeout reopened for correction.`;
  }

  if (args.variance && args.variance !== 0) {
    return `${args.label} closeout recorded with a cash variance of ${args.variance}.`;
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
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatRegisterSessionLabel(registerNumber?: string) {
  const trimmed = registerNumber?.trim();

  if (!trimmed) return "Register session";
  if (/^register\b/i.test(trimmed)) return trimmed;
  return `Register ${trimmed}`;
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

function getTimelineEventPriority(event: {
  eventType: string;
  metadata?: Record<string, unknown>;
}) {
  if (event.eventType === "cycle_count_draft_submitted") return 40;
  if (
    event.eventType === "stock_adjustment_applied" &&
    event.metadata?.adjustmentType === "cycle_count"
  ) {
    return 30;
  }
  if (event.eventType === "cycle_count_draft_updated") return 20;
  if (event.eventType === "cycle_count_draft_created") return 10;
  return 25;
}

function compareTimelineEvents(
  left: {
    _id: Id<"operationalEvent">;
    createdAt: number;
    eventType: string;
    metadata?: Record<string, unknown>;
  },
  right: {
    _id: Id<"operationalEvent">;
    createdAt: number;
    eventType: string;
    metadata?: Record<string, unknown>;
  },
) {
  const leftMinute = getTimelineMinuteBucket(left.createdAt);
  const rightMinute = getTimelineMinuteBucket(right.createdAt);
  if (leftMinute !== rightMinute) return rightMinute - leftMinute;

  const priorityDelta =
    getTimelineEventPriority(right) - getTimelineEventPriority(left);
  if (priorityDelta !== 0) return priorityDelta;

  if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt;
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
      eventType: left.type,
    },
    {
      _id: right.id as Id<"operationalEvent">,
      createdAt: right.createdAt,
      eventType: right.type,
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

  return dailyClose.find((close) => close.isCurrent) ?? dailyClose[0] ?? null;
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

async function listDailyOperationsAutomationStatuses(
  ctx: Pick<QueryCtx, "db">,
  args: {
    operatingDate: string;
    storeId: Id<"store">;
  },
): Promise<DailyOperationsAutomationStatus[]> {
  const [openingRun, closeRun] = await Promise.all([
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
  ]);
  const statuses: DailyOperationsAutomationStatus[] = [];

  if (openingRun) {
    statuses.push({
      id: openingRun._id,
      lane: "opening",
      occurredAt: openingRun.appliedAt ?? openingRun.updatedAt,
      outcome: openingRun.outcome,
      sourceLink: {
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
      },
    });
  }

  if (closeRun) {
    statuses.push({
      id: closeRun._id,
      lane: "close",
      occurredAt: closeRun.appliedAt ?? closeRun.updatedAt,
      outcome: closeRun.outcome,
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
      description: "Opening Handoff is complete and the end of day review has no blockers.",
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
          ? `${pluralize(closeBlockerCount, "close blocker")} must be resolved after reopening the end of day review.`
          : args.closeStatus === "completed"
            ? "The end of day review is saved for this store day."
            : args.closeStatus === "blocked"
              ? `${pluralize(closeBlockerCount, "close blocker")} must be resolved before close.`
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
          ? `${args.queueCounts.workItemCountLabel} open work item${
              args.queueCounts.workItemCount === 1 ? "" : "s"
            } visible in the operations queue.`
          : "No open queue work.",
      key: "queue",
      label: "Open work",
      status: args.queueCounts.workItemCount > 0 ? "needs_attention" : "ready",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
    },
    {
      count: args.queueCounts.approvalCount,
      countLabel: args.queueCounts.approvalCountLabel,
      description:
        args.queueCounts.approvalCount > 0
          ? `${args.queueCounts.approvalCountLabel} approval${
              args.queueCounts.approvalCount === 1 ? "" : "s"
            } pending.`
          : "No pending approvals.",
      key: "approvals",
      label: "Approvals",
      status: args.queueCounts.approvalCount > 0 ? "blocked" : "ready",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
    },
    {
      count: args.closeBlockerCounts.registerCount,
      description:
        args.closeBlockerCounts.registerCount > 0
          ? `${pluralize(args.closeBlockerCounts.registerCount, "register")} need attention before close.`
          : "No register blockers.",
      key: "registers",
      label: "Registers",
      status: args.closeBlockerCounts.registerCount > 0 ? "blocked" : "ready",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    },
    {
      count: args.closeBlockerCounts.posSessionCount,
      description:
        args.closeBlockerCounts.posSessionCount > 0
          ? `${pluralize(args.closeBlockerCounts.posSessionCount, "POS session")} still open or held.`
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
          ? `${pluralize(args.closeBlockerCounts.expenseCount, "expense")} included in the close review.`
          : "No expense exceptions.",
      key: "expenses",
      label: "Expenses",
      status: "ready",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    },
  ];
}

export async function buildDailyOperationsSnapshotWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt?: number;
    operatingDate: string;
    operatingTimezoneOffsetMinutes?: number;
    startAt?: number;
    storeId: Id<"store">;
    weekEndOperatingDate?: string;
  },
) {
  const range = resolveRange(args);
  const [
    openingSnapshot,
    closeSnapshot,
    dailyCloseRecord,
    queueCounts,
    automationStatuses,
    timeline,
    store,
    weekMetrics,
  ] =
    await Promise.all([
      buildDailyOpeningSnapshotWithCtx(ctx, args),
      buildDailyCloseSnapshotWithCtx(ctx, args),
      getDailyCloseRecordForDate(ctx, args),
      listOpenQueueSnapshot(ctx, args.storeId),
      listDailyOperationsAutomationStatuses(ctx, args),
      listTimelineEvents(ctx, { ...range, storeId: args.storeId }),
      ctx.db.get("store", args.storeId),
      buildWeekMetrics(ctx, args),
    ]);

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

  return {
    automationStatuses,
    attentionItems,
    closeSummary: {
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
      registerVarianceCount: closeSnapshot.summary.registerVarianceCount,
      salesTotal: closeSnapshot.summary.salesTotal,
      transactionCount: closeSnapshot.summary.transactionCount,
    } satisfies DailyOperationsCloseSummary,
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
    primaryAction: primaryAction(lifecycleStatus),
    startAt: range.startAt,
    storeId: args.storeId,
    timeline,
    weekMetrics,
  };
}

export const getDailyOperationsSnapshot = query({
  args: {
    endAt: v.optional(v.number()),
    operatingDate: v.string(),
    operatingTimezoneOffsetMinutes: v.optional(v.number()),
    startAt: v.optional(v.number()),
    storeId: v.id("store"),
    weekEndOperatingDate: v.optional(v.string()),
  },
  handler: (ctx, args) => buildDailyOperationsSnapshotWithCtx(ctx, args),
});
