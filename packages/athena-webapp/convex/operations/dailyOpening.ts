import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { commandResultValidator } from "../lib/commandResultValidators";
import { recordOperationalEventWithCtx } from "./operationalEvents";
import { getDailyCloseOpeningContextWithCtx } from "./dailyClose";
import { requireStoreFullAdminAccess } from "../stockOps/access";
import { ok, userError, type CommandResult } from "../../shared/commandResult";

const DAILY_OPENING_QUERY_LIMIT = 200;
const DAILY_OPENING_SUBJECT_TYPE = "daily_opening";
const DAILY_CLOSE_SUBJECT_TYPE = "daily_close";
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OPERATING_DATE_RANGE_MS = 36 * 60 * 60 * 1000;
const TERMINAL_WORK_ITEM_STATUSES = new Set(["completed", "cancelled"]);

type DailyOpeningSeverity = "blocker" | "review" | "carry_forward" | "ready";

type DailyOpeningItem = {
  key: string;
  severity: DailyOpeningSeverity;
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
  metadata?:
    | Array<{
        label: string;
        value: unknown;
      }>
    | Record<string, unknown>;
};

type DailyOpeningReadinessStatus = "blocked" | "needs_attention" | "ready";

type DailyOpeningReadiness = {
  status: DailyOpeningReadinessStatus;
  blockerCount: number;
  reviewCount: number;
  carryForwardCount: number;
  readyCount: number;
};

type DailyOpeningSnapshot = {
  endAt: number;
  operatingDate: string;
  storeId: Id<"store">;
  organizationId: Id<"organization"> | null;
  existingOpening: Doc<"dailyOpening"> | null;
  priorClose: Doc<"dailyClose"> | null;
  status: DailyOpeningReadinessStatus | "started";
  blockers: DailyOpeningItem[];
  reviewItems: DailyOpeningItem[];
  carryForwardItems: DailyOpeningItem[];
  readyItems: DailyOpeningItem[];
  readiness: DailyOpeningReadiness;
  startedOpening:
    | (Doc<"dailyOpening"> & { startedByStaffName?: string | null })
    | null;
  startAt: number;
  sourceSubjects: DailyOpeningItem["subject"][];
  summary: Omit<DailyOpeningReadiness, "status">;
};

type StartStoreDayArgs = {
  acknowledgedItemKeys?: string[];
  actorStaffProfileId?: Id<"staffProfile">;
  actorUserId?: Id<"athenaUser">;
  endAt?: number;
  notes?: string;
  operatingDate: string;
  organizationId?: Id<"organization">;
  startAt?: number;
  storeId: Id<"store">;
};

type StartStoreDayResult = CommandResult<{
  action: "started" | "already_started";
  dailyOpening: Doc<"dailyOpening">;
}>;

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

function isValidOperatingDate(operatingDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(operatingDate)) {
    return false;
  }

  const startAt = Date.parse(`${operatingDate}T00:00:00.000Z`);

  if (!Number.isFinite(startAt)) {
    return false;
  }

  return new Date(startAt).toISOString().slice(0, 10) === operatingDate;
}

function safeOperatingDateRange(operatingDate: string) {
  if (!isValidOperatingDate(operatingDate)) {
    return { endAt: 0, startAt: 0 };
  }

  const startAt = Date.parse(`${operatingDate}T00:00:00.000Z`);

  return {
    endAt: startAt + DAY_MS,
    startAt,
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
  const fallbackRange = safeOperatingDateRange(args.operatingDate);

  if (isValidOperatingDateRange(args.startAt, args.endAt)) {
    return { endAt: args.endAt!, startAt: args.startAt! };
  }

  return fallbackRange;
}

async function getStore(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
): Promise<Doc<"store"> | null> {
  return ctx.db.get("store", storeId);
}

async function getDailyOpeningForDate(
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

async function getStartedDailyOpeningForDate(
  ctx: Pick<QueryCtx, "db">,
  args: {
    operatingDate: string;
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("dailyOpening")
    .withIndex("by_storeId_status_operatingDate", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "started")
        .eq("operatingDate", args.operatingDate),
    )
    .first();
}

async function getPriorDailyCloseForOpeningReview(
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
    .take(DAILY_OPENING_QUERY_LIMIT);

  return (
    completedCloses.find(
      (dailyClose) => dailyClose.operatingDate < args.operatingDate,
    ) ?? null
  );
}

function getStaffDisplayName(staffProfile: Doc<"staffProfile"> | null) {
  if (!staffProfile) return null;

  const name =
    staffProfile.fullName ||
    [staffProfile.firstName, staffProfile.lastName].filter(Boolean).join(" ");

  return name || null;
}

async function hydrateStartedOpening(
  ctx: Pick<QueryCtx, "db">,
  opening: Doc<"dailyOpening"> | null,
) {
  if (!opening) return null;

  const staffProfile = opening.actorStaffProfileId
    ? await ctx.db.get("staffProfile", opening.actorStaffProfileId)
    : null;

  return {
    ...opening,
    startedByStaffName: getStaffDisplayName(staffProfile),
  };
}

async function listPendingOpeningBlockerApprovals(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
) {
  const approvals = await ctx.db
    .query("approvalRequest")
    .withIndex("by_storeId_status", (q) =>
      q.eq("storeId", storeId).eq("status", "pending"),
    )
    .take(DAILY_OPENING_QUERY_LIMIT);

  return approvals.filter(
    (approval) =>
      approval.registerSessionId ||
      approval.subjectType === "register_session" ||
      approval.requestType === "variance_review",
  );
}

function pendingApprovalItem(
  approval: Doc<"approvalRequest">,
): DailyOpeningItem {
  const requestLabel = approvalRequestTypeLabel(approval.requestType);
  const note = approval.notes?.trim();
  const context = approvalMetadataEntries(approval);

  return {
    key: `approval_request:${approval._id}:pending`,
    severity: "blocker",
    category: "approval",
    title: `${requestLabel} approval pending`,
    message:
      "A pending register or closeout approval must be resolved before Opening can be acknowledged.",
    subject: {
      type: "approval_request",
      id: approval._id,
      label: note ?? approval.reason,
    },
    link: {
      label: "View approvals",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
    },
    metadata: [
      {
        label: "Request",
        value: requestLabel,
      },
      ...context,
      ...(note
        ? [
            {
              label: "Requester note",
              value: note,
            },
          ]
        : []),
    ],
  };
}

function approvalMetadataEntries(approval: Doc<"approvalRequest">) {
  if (approval.requestType === "payment_method_correction") {
    return compactMetadataEntries([
      {
        label: "Transaction",
        value: getStringMetadata(approval.metadata, "transactionNumber"),
      },
      {
        label: "transactionId",
        value: getStringMetadata(approval.metadata, "transactionId"),
      },
      {
        label: "Current method",
        value: getPaymentMethodMetadata(
          approval.metadata,
          "previousPaymentMethod",
        ),
      },
      {
        label: "Requested method",
        value: getPaymentMethodMetadata(approval.metadata, "paymentMethod"),
      },
      {
        label: "Amount",
        value: getNumberMetadata(approval.metadata, "amount"),
      },
    ]);
  }

  return [];
}

function approvalRequestTypeLabel(requestType: string) {
  if (requestType === "payment_method_correction") {
    return "Payment correction";
  }

  if (requestType === "variance_review") {
    return "Closeout variance";
  }

  if (requestType === "inventory_adjustment_review") {
    return "Stock adjustment";
  }

  return requestType
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function compactMetadataEntries(
  entries: Array<{ label: string; value: unknown }>,
) {
  return entries.filter(
    (entry) =>
      entry.value !== null && entry.value !== undefined && entry.value !== "",
  );
}

function getNumberMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "number" ? value : undefined;
}

function getPaymentMethodMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = getStringMetadata(metadata, key);
  return value ? formatPaymentMethodLabel(value) : undefined;
}

function getStringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatPaymentMethodLabel(method: string) {
  return method
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function missingPriorCloseReviewItem(args: {
  operatingDate: string;
  storeId: Id<"store">;
}): DailyOpeningItem {
  return {
    key: "daily_close:prior:missing",
    severity: "review",
    category: "prior_close",
    title: "Prior EOD Review not found",
    message:
      "No completed end of day review was found for the prior store day. Acknowledge this before starting the store day.",
    subject: {
      type: DAILY_CLOSE_SUBJECT_TYPE,
      id: `${args.storeId}:${args.operatingDate}:prior`,
      label: "Prior EOD Review",
    },
    link: {
      label: "Review EOD Review",
      search: {
        operatingDate: args.operatingDate,
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    },
    metadata: {
      operatingDate: args.operatingDate,
    },
  };
}

function invalidOperatingDateItem(operatingDate: string): DailyOpeningItem {
  return {
    key: "daily_opening:operating_date:invalid",
    severity: "blocker",
    category: "operating_date",
    title: "Invalid operating date",
    message: "Opening requires an operating date in YYYY-MM-DD format.",
    subject: {
      type: DAILY_OPENING_SUBJECT_TYPE,
      id: operatingDate,
    },
  };
}

function missingCarryForwardItem(args: {
  priorClose: Doc<"dailyClose">;
  workItemId: Id<"operationalWorkItem">;
}): DailyOpeningItem {
  return {
    key: `operational_work_item:${args.workItemId}:missing`,
    severity: "blocker",
    category: "carry_forward",
    title: "Carry-forward work is missing",
    message:
      "A carry-forward item referenced by the prior end of day review could not be loaded. Resolve the missing handoff before Opening Handoff can be acknowledged.",
    subject: {
      type: "operational_work_item",
      id: args.workItemId,
      label: "Missing carry-forward work",
    },
    metadata: {
      priorDailyCloseId: args.priorClose._id,
      priorOperatingDate: args.priorClose.operatingDate,
    },
  };
}

function priorCloseReadyItem(priorClose: Doc<"dailyClose">): DailyOpeningItem {
  return {
    key: `daily_close:${priorClose._id}:completed`,
    severity: "ready",
    category: "prior_close",
    title: "Prior EOD Review completed",
    message: "The prior store day has a completed end of day review.",
    subject: {
      type: DAILY_CLOSE_SUBJECT_TYPE,
      id: priorClose._id,
      label: `EOD Review ${priorClose.operatingDate}`,
    },
    link: {
      label: "View EOD Review",
      search: {
        operatingDate: priorClose.operatingDate,
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    },
    metadata: {
      completedAt: priorClose.completedAt,
      operatingDate: priorClose.operatingDate,
    },
  };
}

function priorCloseReopenedItem(priorClose: Doc<"dailyClose">): DailyOpeningItem {
  return {
    key: `daily_close:${priorClose._id}:reopened`,
    severity: "review",
    category: "prior_close",
    title: "Prior EOD Review reopened",
    message:
      "The prior store day was reopened. Complete the revised end of day review before treating the prior close as clean.",
    subject: {
      type: DAILY_CLOSE_SUBJECT_TYPE,
      id: priorClose._id,
      label: `EOD Review ${priorClose.operatingDate}`,
    },
    link: {
      label: "Review EOD Review",
      search: {
        operatingDate: priorClose.operatingDate,
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    },
    metadata: {
      operatingDate: priorClose.operatingDate,
      reopenedAt: priorClose.reopenedAt,
      reopenReason: priorClose.reopenReason,
    },
  };
}

function priorCloseNotesItem(priorClose: Doc<"dailyClose">): DailyOpeningItem | null {
  const notes = trimOptional(priorClose.notes);

  if (!notes) {
    return null;
  }

  return {
    key: `daily_close:${priorClose._id}:notes`,
    severity: "review",
    category: "prior_close",
    title: "Prior EOD Review notes",
    message: "Review the prior end of day review notes before acknowledging Opening Handoff.",
    subject: {
      type: DAILY_CLOSE_SUBJECT_TYPE,
      id: priorClose._id,
      label: `EOD Review ${priorClose.operatingDate}`,
    },
    metadata: {
      notes,
      operatingDate: priorClose.operatingDate,
    },
  };
}

function carryForwardItem(
  workItem: Doc<"operationalWorkItem">,
): DailyOpeningItem {
  return {
    key: `operational_work_item:${workItem._id}:carry_forward`,
    severity: "carry_forward",
    category: "carry_forward",
    title: workItem.title,
    message:
      "This unresolved carry-forward item remains open and must be acknowledged for Opening.",
    subject: {
      type: "operational_work_item",
      id: workItem._id,
      label: workItem.title,
    },
    link: {
      label: "View open work",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
    },
    metadata: {
      priority: workItem.priority,
      status: workItem.status,
      type: workItem.type,
    },
  };
}

function buildReadiness(args: {
  blockers: DailyOpeningItem[];
  carryForwardItems: DailyOpeningItem[];
  readyItems: DailyOpeningItem[];
  reviewItems: DailyOpeningItem[];
}): DailyOpeningReadiness {
  return {
    status:
      args.blockers.length > 0
        ? "blocked"
        : args.reviewItems.length > 0 || args.carryForwardItems.length > 0
          ? "needs_attention"
          : "ready",
    blockerCount: args.blockers.length,
    reviewCount: args.reviewItems.length,
    carryForwardCount: args.carryForwardItems.length,
    readyCount: args.readyItems.length,
  };
}

function uniqueSourceSubjects(items: DailyOpeningItem[]) {
  const subjects = new Map<string, DailyOpeningItem["subject"]>();

  for (const item of items) {
    subjects.set(`${item.subject.type}:${item.subject.id}`, item.subject);
  }

  return Array.from(subjects.values());
}

async function getMissingCarryForwardItems(
  ctx: Pick<QueryCtx, "db">,
  priorClose: Doc<"dailyClose">,
) {
  const carryForwardWorkItems = await Promise.all(
    priorClose.carryForwardWorkItemIds.map(async (workItemId) => ({
      workItem: await ctx.db.get("operationalWorkItem", workItemId),
      workItemId,
    })),
  );

  return carryForwardWorkItems
    .filter(({ workItem }) => !workItem)
    .map(({ workItemId }) => missingCarryForwardItem({ priorClose, workItemId }));
}

async function resolveOpeningActor(
  ctx: MutationCtx,
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    actorUserId?: Id<"athenaUser">;
    storeId: Id<"store">;
  },
) {
  if (args.actorStaffProfileId) {
    const staffProfile = await ctx.db.get("staffProfile", args.actorStaffProfileId);

    if (
      !staffProfile ||
      staffProfile.storeId !== args.storeId ||
      staffProfile.status !== "active"
    ) {
      return userError({
        code: "authorization_failed",
        message: "Active staff access is required to acknowledge Opening.",
      });
    }

    return ok({
      actorStaffProfileId: staffProfile._id,
      actorUserId: args.actorUserId,
    });
  }

  try {
    const { athenaUser } = await requireStoreFullAdminAccess(ctx, args.storeId);
    const staffProfile = await ctx.db
      .query("staffProfile")
      .withIndex("by_storeId_linkedUserId", (q) =>
        q.eq("storeId", args.storeId).eq("linkedUserId", athenaUser._id),
      )
      .first();

    if (!staffProfile || staffProfile.status !== "active") {
      return userError({
        code: "authorization_failed",
        message:
          "A linked active staff profile is required to acknowledge Opening.",
      });
    }

    return ok({
      actorStaffProfileId: staffProfile._id,
      actorUserId: athenaUser._id,
    });
  } catch {
    return userError({
      code: "authorization_failed",
      message: "Full admin access is required to acknowledge Opening.",
    });
  }
}

export async function buildDailyOpeningSnapshotWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    endAt?: number;
    operatingDate: string;
    startAt?: number;
    storeId: Id<"store">;
  },
): Promise<DailyOpeningSnapshot> {
  const store = await getStore(ctx, args.storeId);
  const existingOpening = await getDailyOpeningForDate(ctx, args);
  const startedOpening = await hydrateStartedOpening(ctx, existingOpening);
  const operatingDateRange = resolveOperatingDateRange(args);

  if (!isValidOperatingDate(args.operatingDate)) {
    const blocker = invalidOperatingDateItem(args.operatingDate);

    return {
      endAt: operatingDateRange.endAt,
      operatingDate: args.operatingDate,
      storeId: args.storeId,
      organizationId: store?.organizationId ?? null,
      existingOpening,
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
      startedOpening,
      startAt: operatingDateRange.startAt,
      sourceSubjects: [blocker.subject],
      summary: {
        blockerCount: 1,
        reviewCount: 0,
        carryForwardCount: 0,
        readyCount: 0,
      },
    };
  }

  const [openingContext, pendingApprovals] = await Promise.all([
    getDailyCloseOpeningContextWithCtx(ctx, args),
    listPendingOpeningBlockerApprovals(ctx, args.storeId),
  ]);
  const priorClose =
    openingContext.priorClose ??
    (await getPriorDailyCloseForOpeningReview(ctx, args));

  const blockers: DailyOpeningItem[] = openingContext.priorClose
    ? await getMissingCarryForwardItems(ctx, openingContext.priorClose)
    : [];
  const reviewItems: DailyOpeningItem[] = [];
  const carryForwardItems = openingContext.carryForwardWorkItems
    .filter((workItem) => !TERMINAL_WORK_ITEM_STATUSES.has(workItem.status))
    .map(carryForwardItem);
  const readyItems: DailyOpeningItem[] = [];

  if (priorClose) {
    if (priorClose.lifecycleStatus === "reopened") {
      reviewItems.push(priorCloseReopenedItem(priorClose));
    } else {
      readyItems.push(priorCloseReadyItem(priorClose));
    }

    const notesItem = priorCloseNotesItem(priorClose);

    if (notesItem) {
      reviewItems.push(notesItem);
    }
  } else {
    reviewItems.push(missingPriorCloseReviewItem(args));
  }

  blockers.push(...pendingApprovals.map(pendingApprovalItem));

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

  return {
    endAt: operatingDateRange.endAt,
    operatingDate: args.operatingDate,
    storeId: args.storeId,
    organizationId: store?.organizationId ?? null,
    existingOpening,
    priorClose,
    status: existingOpening ? "started" : readiness.status,
    blockers,
    reviewItems,
    carryForwardItems,
    readyItems,
    readiness,
    startedOpening,
    startAt: operatingDateRange.startAt,
    sourceSubjects: uniqueSourceSubjects(allItems),
    summary: {
      blockerCount: readiness.blockerCount,
      reviewCount: readiness.reviewCount,
      carryForwardCount: readiness.carryForwardCount,
      readyCount: readiness.readyCount,
    },
  };
}

export async function startStoreDayWithCtx(
  ctx: MutationCtx,
  args: StartStoreDayArgs,
): Promise<StartStoreDayResult> {
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
      message: "Opening store does not belong to this organization.",
    });
  }

  const existingOpening = await getStartedDailyOpeningForDate(ctx, args);

  if (existingOpening) {
    return ok({
      action: "already_started",
      dailyOpening: existingOpening,
    });
  }

  const snapshot = await buildDailyOpeningSnapshotWithCtx(ctx, args);

  if (snapshot.blockers.length > 0) {
    return userError({
      code: "precondition_failed",
      message: "Opening cannot be acknowledged while blocker items remain.",
      metadata: {
        blockerCount: snapshot.blockers.length,
      },
    });
  }

  const acknowledgedItemKeys = new Set(args.acknowledgedItemKeys ?? []);
  const requiredAcknowledgementKeys = [
    ...snapshot.reviewItems,
    ...snapshot.carryForwardItems,
  ].map((item) => item.key);
  const unacknowledgedItemKeys = requiredAcknowledgementKeys.filter(
    (key) => !acknowledgedItemKeys.has(key),
  );

  if (unacknowledgedItemKeys.length > 0) {
    return userError({
      code: "precondition_failed",
      message:
        "Opening review and carry-forward items must be acknowledged before start of day.",
      metadata: {
        unacknowledgedItemKeys,
      },
    });
  }

  const actorResult = await resolveOpeningActor(ctx, args);

  if (actorResult.kind !== "ok") {
    return actorResult;
  }

  const { actorStaffProfileId, actorUserId } = actorResult.data;
  const now = Date.now();
  const dailyOpeningId = await ctx.db.insert("dailyOpening", {
    storeId: args.storeId,
    organizationId: store.organizationId,
    operatingDate: args.operatingDate,
    startAt: snapshot.startAt,
    endAt: snapshot.endAt,
    status: "started",
    priorDailyCloseId: snapshot.priorClose?._id,
    readiness: snapshot.readiness,
    sourceSubjects: snapshot.sourceSubjects,
    carryForwardWorkItemIds: snapshot.carryForwardItems.map(
      (item) => item.subject.id as Id<"operationalWorkItem">,
    ),
    acknowledgedItemKeys: args.acknowledgedItemKeys ?? [],
    notes: trimOptional(args.notes),
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    actorUserId,
    actorStaffProfileId,
  });

  const dailyOpening = await ctx.db.get("dailyOpening", dailyOpeningId);

  if (!dailyOpening) {
    return userError({
      code: "unavailable",
      message: "Opening could not be loaded after acknowledgement.",
      retryable: true,
    });
  }

  await recordOperationalEventWithCtx(ctx, {
    storeId: args.storeId,
    organizationId: store.organizationId,
    eventType: "daily_opening_acknowledged",
    subjectType: DAILY_OPENING_SUBJECT_TYPE,
    subjectId: dailyOpening._id,
    subjectLabel: `Opening ${args.operatingDate}`,
    message: `Store day acknowledged for ${args.operatingDate}.`,
    actorUserId,
    actorStaffProfileId,
    metadata: {
      acknowledgedItemKeys: args.acknowledgedItemKeys ?? [],
      endAt: dailyOpening.endAt,
      operatingDate: args.operatingDate,
      priorDailyCloseId: snapshot.priorClose?._id,
      readiness: dailyOpening.readiness,
      startAt: dailyOpening.startAt,
    },
  });

  return ok({
    action: "started",
    dailyOpening,
  });
}

export const getDailyOpeningSnapshot = query({
  args: {
    endAt: v.optional(v.number()),
    operatingDate: v.string(),
    startAt: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: (ctx, args) => buildDailyOpeningSnapshotWithCtx(ctx, args),
});

export const startStoreDay = mutation({
  args: {
    acknowledgedItemKeys: v.optional(v.array(v.string())),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    actorUserId: v.optional(v.id("athenaUser")),
    endAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    operatingDate: v.string(),
    organizationId: v.optional(v.id("organization")),
    startAt: v.optional(v.number()),
    storeId: v.id("store"),
  },
  returns: commandResultValidator(v.any()),
  handler: (ctx, args) => startStoreDayWithCtx(ctx, args),
});
