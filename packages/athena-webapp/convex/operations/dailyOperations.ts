import { query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { buildDailyCloseSnapshotWithCtx } from "./dailyClose";
import { buildDailyOpeningSnapshotWithCtx } from "./dailyOpening";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OPERATIONS_QUERY_LIMIT = 200;
const MAX_OPERATIONS_LOOKAHEAD_LIMIT = MAX_OPERATIONS_QUERY_LIMIT + 1;
const OPEN_WORK_ITEM_STATUSES = ["open", "in_progress"] as const;

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
  subject: SourceSubject;
  type: string;
};

type DailyOperationsCloseSummary = {
  carriedOverCashTotal: number;
  carriedOverRegisterCount: number;
  currentDayCashTotal: number;
  currentDayCashTransactionCount: number;
  expenseTotal: number;
  expenseTransactionCount: number;
  netCashVariance: number;
  registerVarianceCount: number;
  salesTotal: number;
  transactionCount: number;
};

type DailyOperationsWeekMetric = DailyOperationsCloseSummary & {
  isClosed: boolean;
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
    carriedOverCashTotal: 0,
    carriedOverRegisterCount: 0,
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    netCashVariance: 0,
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
    storeId: Id<"store">;
  },
): Promise<DailyOperationsWeekMetric> {
  const range = operatingDateRange(args.operatingDate);

  if (!Number.isFinite(range.startAt) || !Number.isFinite(range.endAt)) {
    return {
      ...emptyCloseSummary(),
      isClosed: false,
      isSelected: args.isSelected,
      operatingDate: args.operatingDate,
    };
  }

  const [completedTransactions, expenseTransactions, dailyClose] =
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
        .first(),
    ]);

  return {
    ...emptyCloseSummary(),
    currentDayCashTotal: completedTransactions.reduce(
      (sum, transaction) => sum + transactionCashDelta(transaction),
      0,
    ),
    currentDayCashTransactionCount: completedTransactions.filter(
      (transaction) => transactionCashDelta(transaction) > 0,
    ).length,
    expenseTotal: expenseTransactions.reduce(
      (sum, transaction) => sum + transaction.totalValue,
      0,
    ),
    expenseTransactionCount: expenseTransactions.length,
    isClosed: dailyClose?.status === "completed",
    isSelected: args.isSelected,
    operatingDate: args.operatingDate,
    salesTotal: completedTransactions.reduce(
      (sum, transaction) => sum + transaction.total,
      0,
    ),
    transactionCount: completedTransactions.length,
  };
}

async function buildWeekMetrics(
  ctx: Pick<QueryCtx, "db">,
  args: {
    operatingDate: string;
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

  const events = await ctx.db
    .query("operationalEvent")
    .withIndex("by_storeId_createdAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .gte("createdAt", args.startAt)
        .lt("createdAt", args.endAt),
    )
    .order("desc")
    .take(MAX_OPERATIONS_QUERY_LIMIT);

  return events.map((event) => ({
    createdAt: event.createdAt,
    id: event._id,
    message: event.message,
    subject: {
      id: event.subjectId,
      label: event.subjectLabel,
      type: event.subjectType,
    },
    type: event.eventType,
  }));
}

async function getDailyCloseRecordForDate(
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
      description: "Opening Handoff is complete and End-of-Day Review has no blockers.",
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
        "End-of-Day Review was reopened. Complete the revised review before treating the store day as closed.",
      label: "Reopened",
    };
  }

  return {
    description:
      "Opening Handoff is complete. Keep open work visible through End-of-Day Review.",
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
      label: "Review End-of-Day Review",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    };
  }

  if (status === "reopened") {
    return {
      label: "Revise End-of-Day Review",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    };
  }

  return {
    label: "Start End-of-Day Review",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
  };
}

function buildLanes(args: {
  closeBlockerCounts: ReturnType<typeof getCloseItemCounts>;
  closeStatus: string;
  isCloseReopened: boolean;
  isOpeningStarted: boolean;
  openingAttentionCount: number;
  queueCounts: {
    approvalCount: number;
    approvalCountLabel: string;
    workItemCount: number;
    workItemCountLabel: string;
  };
}): DailyOperationsLane[] {
  const openingStatus: LaneStatus = args.isOpeningStarted
    ? "ready"
    : "needs_attention";
  const closeStatus: LaneStatus =
    args.isCloseReopened
      ? "needs_attention"
      : args.closeStatus === "completed"
      ? "closed"
      : args.closeStatus === "blocked"
        ? "blocked"
        : args.closeStatus === "needs_review"
          ? "needs_attention"
          : "ready";

  return [
    {
      count: args.openingAttentionCount,
      description: args.isOpeningStarted
        ? "Opening Handoff is complete."
        : "Opening Handoff still needs operator acknowledgement.",
      key: "opening",
      label: "Opening Handoff",
      status: openingStatus,
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
    },
    {
      count:
        args.closeStatus === "completed" && !args.isCloseReopened
          ? 0
          : args.closeBlockerCounts.registerCount +
            args.closeBlockerCounts.posSessionCount +
            args.closeBlockerCounts.approvalCount,
      description:
        args.isCloseReopened
          ? "End-of-Day Review was reopened and needs a revised close."
          : args.closeStatus === "completed"
          ? "End-of-Day Review is saved for this store day."
          : args.closeStatus === "blocked"
            ? "End-of-Day Review has blockers to resolve."
            : "End-of-Day Review is available for review.",
      key: "close",
      label: "End-of-Day Review",
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
          ? `${pluralize(args.closeBlockerCounts.registerCount, "register")} needs attention before close.`
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
    timeline,
    store,
    weekMetrics,
  ] =
    await Promise.all([
      buildDailyOpeningSnapshotWithCtx(ctx, args),
      buildDailyCloseSnapshotWithCtx(ctx, args),
      getDailyCloseRecordForDate(ctx, args),
      listOpenQueueSnapshot(ctx, args.storeId),
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
    attentionItems.push(openingNotStartedAttention(args));
    attentionItems.push(
      ...openingAttention.map((item) =>
        sourceAttentionItem("daily_opening", item),
      ),
    );
  } else {
    if (isCloseReopened) {
      attentionItems.push({
        id: `daily_close:${args.storeId}:${args.operatingDate}:reopened`,
        label: "End-of-Day Review reopened",
        message:
          "Complete the revised End-of-Day Review before treating the store day as closed.",
        owner: "daily_close",
        severity: "warning",
        source: {
          id:
            closeSnapshot.existingClose?._id ??
            dailyCloseRecord?._id ??
            `${args.storeId}:${args.operatingDate}`,
          label: `End-of-Day Review ${args.operatingDate}`,
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
    : isCloseReopened
      ? "reopened"
      : closeSnapshot.status === "completed"
      ? "closed"
      : closeSnapshot.blockers.length > 0
        ? "close_blocked"
        : closeSnapshot.status === "ready" ||
            closeSnapshot.status === "carry_forward"
          ? "ready_to_close"
          : "operating";
  const lifecycle = {
    status: lifecycleStatus,
    ...lifecycleCopy(lifecycleStatus),
  };
  const closeBlockerCounts = getCloseItemCounts(closeBlockers);

  return {
    attentionItems,
    closeSummary: {
      carriedOverCashTotal: closeSnapshot.summary.carriedOverCashTotal,
      carriedOverRegisterCount: closeSnapshot.summary.carriedOverRegisterCount,
      currentDayCashTotal: closeSnapshot.summary.currentDayCashTotal,
      currentDayCashTransactionCount:
        closeSnapshot.summary.currentDayCashTransactionCount,
      expenseTotal: closeSnapshot.summary.expenseTotal,
      expenseTransactionCount: closeSnapshot.summary.expenseTransactionCount,
      netCashVariance: closeSnapshot.summary.netCashVariance,
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
    startAt: v.optional(v.number()),
    storeId: v.id("store"),
    weekEndOperatingDate: v.optional(v.string()),
  },
  handler: (ctx, args) => buildDailyOperationsSnapshotWithCtx(ctx, args),
});
