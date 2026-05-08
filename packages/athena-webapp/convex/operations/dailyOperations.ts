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

function operatingDateRange(operatingDate: string) {
  const startAt = Date.parse(`${operatingDate}T00:00:00.000Z`);

  if (!Number.isFinite(startAt)) {
    return { endAt: 0, startAt: 0 };
  }

  return { endAt: startAt + DAY_MS, startAt };
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

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  if (value === 1) return `1 ${singular}`;
  return `${value} ${plural}`;
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

  return {
    label: "Start End-of-Day Review",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
  };
}

function buildLanes(args: {
  closeBlockerCounts: ReturnType<typeof getCloseItemCounts>;
  closeStatus: string;
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
    args.closeStatus === "completed"
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
        args.closeStatus === "completed"
          ? 0
          : args.closeBlockerCounts.registerCount +
            args.closeBlockerCounts.posSessionCount +
            args.closeBlockerCounts.approvalCount,
      description:
        args.closeStatus === "completed"
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
  },
) {
  const range = resolveRange(args);
  const [openingSnapshot, closeSnapshot, queueCounts, timeline, store] =
    await Promise.all([
      buildDailyOpeningSnapshotWithCtx(ctx, args),
      buildDailyCloseSnapshotWithCtx(ctx, args),
      listOpenQueueSnapshot(ctx, args.storeId),
      listTimelineEvents(ctx, { ...range, storeId: args.storeId }),
      ctx.db.get("store", args.storeId),
    ]);

  const isOpeningStarted = openingSnapshot.status === "started";
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
  };
}

export const getDailyOperationsSnapshot = query({
  args: {
    endAt: v.optional(v.number()),
    operatingDate: v.string(),
    startAt: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: (ctx, args) => buildDailyOperationsSnapshotWithCtx(ctx, args),
});
