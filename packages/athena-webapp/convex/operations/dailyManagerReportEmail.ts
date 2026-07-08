import { v } from "convex/values";
import {
  action,
  internalAction,
  internalQuery,
  type ActionCtx,
  type QueryCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { toDisplayAmount } from "../lib/currency";
import { currencyFormatter } from "../utils";
import { sendDailyManagerReportEmail } from "../mailersend";
import { ADMIN_EMAILS } from "../constants/email";
import { buildDailyCloseSnapshotWithCtx } from "./dailyClose";
import type {
  DailyManagerReportItem,
  DailyManagerReportMetric,
  DailyManagerReportPaymentTotal,
  DailyManagerReportProps,
} from "../emails/DailyManagerReport";

type DailyCloseReportItem = {
  category: string;
  message: string;
  metadata?: Record<string, unknown>;
  severity: "blocker" | "review" | "carry_forward" | "ready";
  title: string;
};

type DailyCloseReportSnapshot = {
  closeMetadata: {
    actorType?: "human" | "automation";
    automationDecisionReason?: string;
    completedAt: number;
    endAt?: number;
    operatingDate: string;
    startAt?: number;
    notes?: string;
  };
  carryForwardItems: DailyCloseReportItem[];
  readiness: {
    blockerCount: number;
    carryForwardCount: number;
    readyCount: number;
    reviewCount: number;
    status: "blocked" | "needs_review" | "ready";
  };
  reviewedItems: DailyCloseReportItem[];
  summary: Record<string, unknown>;
};

type DailyManagerReportPayload = DailyManagerReportProps & {
  dailyCloseId?: Id<"dailyClose">;
  operatingDateValue: string;
};

type SentDailyManagerReport = {
  dailyCloseId?: Id<"dailyClose">;
  operatingDate: string;
  recipientEmail: string;
  status: number;
  storeName: string;
};

type RegisterCashPositionSummary = {
  closedRegisterSessionCount: number;
  countedCashTotal: number;
  expectedCashTotal: number;
  netCashVariance: number;
  registerCount: number;
  registerVarianceCount: number;
};

type DailyManagerReportSendStatus = "applied" | "prepared";
type PreparedDailyCloseSnapshot = Awaited<
  ReturnType<typeof buildDailyCloseSnapshotWithCtx>
>;

const REGISTER_SESSION_EMAIL_SOURCE_LIMIT = 1000;

export const getMostRecentDailyManagerReportPayload = internalQuery({
  args: {
    storeId: v.optional(v.id("store")),
    storeSlug: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<DailyManagerReportPayload> => {
    const store = await resolveStore(ctx, args);
    const dailyClose = await ctx.db
      .query("dailyClose")
      .withIndex("by_storeId_status_operatingDate", (q) =>
        q.eq("storeId", store._id).eq("status", "completed"),
      )
      .order("desc")
      .filter((q) => q.neq(q.field("reportSnapshot"), undefined))
      .first();

    if (!dailyClose?.reportSnapshot) {
      throw new Error("No completed EOD report with a snapshot was found.");
    }

    const completedBy = dailyClose.completedByStaffProfileId
      ? await resolveStaffName(ctx, dailyClose.completedByStaffProfileId)
      : null;
    const snapshot = dailyClose.reportSnapshot as DailyCloseReportSnapshot;
    const cashPositionSummary = await buildRegisterCashPositionSummary(ctx, {
      endAt: snapshot.closeMetadata.endAt,
      operatingDate: snapshot.closeMetadata.operatingDate,
      startAt: snapshot.closeMetadata.startAt,
      storeId: store._id,
    });

    return buildDailyManagerReportPayload({
      cashPositionSummary,
      dailyClose,
      completedBy: completedBy ?? "Athena",
      store,
    });
  },
});

export const getDailyManagerReportPayloadsForDateRange = internalQuery({
  args: {
    endOperatingDate: v.string(),
    startOperatingDate: v.string(),
    storeId: v.optional(v.id("store")),
    storeSlug: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<DailyManagerReportPayload[]> => {
    const store = await resolveStore(ctx, args);
    const dailyCloses = await ctx.db
      .query("dailyClose")
      .withIndex("by_storeId_status_operatingDate", (q) =>
        q
          .eq("storeId", store._id)
          .eq("status", "completed")
          .gte("operatingDate", args.startOperatingDate)
          .lte("operatingDate", args.endOperatingDate),
      )
      .order("asc")
      .take(14);
    const dailyClosesWithSnapshots = dailyCloses.filter(
      (dailyClose) =>
        dailyClose.reportSnapshot &&
        (dailyClose.lifecycleStatus === undefined ||
          dailyClose.lifecycleStatus === "active"),
    );
    const completedByNames = await Promise.all(
      dailyClosesWithSnapshots.map((dailyClose) =>
        dailyClose.completedByStaffProfileId
          ? resolveStaffName(ctx, dailyClose.completedByStaffProfileId)
          : Promise.resolve(null),
      ),
    );
    const cashPositionSummaries = await Promise.all(
      dailyClosesWithSnapshots.map((dailyClose) => {
        const snapshot = dailyClose.reportSnapshot as DailyCloseReportSnapshot;

        return buildRegisterCashPositionSummary(ctx, {
          endAt: snapshot.closeMetadata.endAt,
          operatingDate: snapshot.closeMetadata.operatingDate,
          startAt: snapshot.closeMetadata.startAt,
          storeId: store._id,
        });
      }),
    );

    return dailyClosesWithSnapshots.map((dailyClose, index) =>
      buildDailyManagerReportPayload({
        cashPositionSummary: cashPositionSummaries[index],
        dailyClose,
        completedBy: completedByNames[index] ?? "Athena",
        store,
      }),
    );
  },
});

export const getPreparedDailyManagerReportPayloadForDate = internalQuery({
  args: {
    operatingDate: v.string(),
    preparedAt: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: async (ctx, args): Promise<DailyManagerReportPayload> => {
    const store = await resolveStore(ctx, { storeId: args.storeId });
    const snapshot = await buildDailyCloseSnapshotWithCtx(ctx, {
      operatingDate: args.operatingDate,
      storeId: args.storeId,
    });
    const cashPositionSummary = await buildRegisterCashPositionSummary(ctx, {
      endAt: snapshot.endAt,
      operatingDate: snapshot.operatingDate,
      startAt: snapshot.startAt,
      storeId: store._id,
    });

    return buildPreparedDailyManagerReportPayload({
      cashPositionSummary,
      preparedAt: args.preparedAt,
      snapshot,
      store,
    });
  },
});

export const sendMostRecentDailyManagerReport = action({
  args: {
    recipientEmail: v.string(),
    recipientName: v.optional(v.string()),
    storeId: v.optional(v.id("store")),
    storeSlug: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SentDailyManagerReport> => {
    const report: DailyManagerReportPayload = await ctx.runQuery(
      internal.operations.dailyManagerReportEmail
        .getMostRecentDailyManagerReportPayload,
      {
        storeId: args.storeId,
        storeSlug: args.storeSlug,
      },
    );
    const response = await sendDailyManagerReportEmail({
      ...report,
      recipientEmail: args.recipientEmail,
      recipientName: args.recipientName,
      subject: `${report.storeName} daily report - ${report.operatingDate}`,
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return {
      dailyCloseId: report.dailyCloseId,
      operatingDate: report.operatingDateValue,
      recipientEmail: args.recipientEmail,
      status: response.status,
      storeName: report.storeName,
    };
  },
});

export const sendDailyManagerReportsForDateRange = action({
  args: {
    endOperatingDate: v.string(),
    recipientEmail: v.string(),
    recipientName: v.optional(v.string()),
    startOperatingDate: v.string(),
    storeId: v.optional(v.id("store")),
    storeSlug: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SentDailyManagerReport[]> => {
    const reports: DailyManagerReportPayload[] = await ctx.runQuery(
      internal.operations.dailyManagerReportEmail
        .getDailyManagerReportPayloadsForDateRange,
      {
        endOperatingDate: args.endOperatingDate,
        startOperatingDate: args.startOperatingDate,
        storeId: args.storeId,
        storeSlug: args.storeSlug,
      },
    );
    const sentReports: SentDailyManagerReport[] = [];

    for (const report of reports) {
      const response = await sendDailyManagerReportEmail({
        ...report,
        recipientEmail: args.recipientEmail,
        recipientName: args.recipientName,
        subject: `${report.storeName} daily report - ${report.operatingDate}`,
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      sentReports.push({
        dailyCloseId: report.dailyCloseId,
        operatingDate: report.operatingDateValue,
        recipientEmail: args.recipientEmail,
        status: response.status,
        storeName: report.storeName,
      });
    }

    return sentReports;
  },
});

export async function sendDailyManagerReportToAdminsForDateWithCtx(
  ctx: Pick<ActionCtx, "runQuery">,
  args: {
    operatingDate: string;
    preparedAt?: number;
    status?: DailyManagerReportSendStatus;
    storeId: Id<"store">;
  },
): Promise<SentDailyManagerReport[]> {
  const status = args.status ?? "applied";
  const report =
    status === "prepared"
      ? await ctx.runQuery(
          internal.operations.dailyManagerReportEmail
            .getPreparedDailyManagerReportPayloadForDate,
          {
            operatingDate: args.operatingDate,
            preparedAt: args.preparedAt,
            storeId: args.storeId,
          },
        )
      : (
          await ctx.runQuery(
            internal.operations.dailyManagerReportEmail
              .getDailyManagerReportPayloadsForDateRange,
            {
              endOperatingDate: args.operatingDate,
              startOperatingDate: args.operatingDate,
              storeId: args.storeId,
            },
          )
        )[0];

  if (!report) return [];

  const sentReports: SentDailyManagerReport[] = [];

  for (const recipient of ADMIN_EMAILS) {
    const response = await sendDailyManagerReportEmail({
      ...report,
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      subject: `${report.storeName} daily report - ${report.operatingDate}`,
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    sentReports.push({
      dailyCloseId: report.dailyCloseId,
      operatingDate: report.operatingDateValue,
      recipientEmail: recipient.email,
      status: response.status,
      storeName: report.storeName,
    });
  }

  return sentReports;
}

export const sendDailyManagerReportToAdminsForDate = internalAction({
  args: {
    operatingDate: v.string(),
    preparedAt: v.optional(v.number()),
    status: v.optional(v.union(v.literal("applied"), v.literal("prepared"))),
    storeId: v.id("store"),
  },
  handler: (ctx, args) =>
    sendDailyManagerReportToAdminsForDateWithCtx(ctx, args),
});

async function resolveStore(
  ctx: QueryCtx,
  args: { storeId?: Id<"store">; storeSlug?: string },
) {
  if (args.storeId) {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      throw new Error("Store not found.");
    }
    return store;
  }

  const storeSlug = args.storeSlug ?? "wigclub";
  const stores = await ctx.db.query("store").take(100);
  const store = stores.find((candidate) => candidate.slug === storeSlug);
  if (!store) {
    throw new Error(`Store ${storeSlug} not found.`);
  }
  return store;
}

async function resolveStaffName(
  ctx: QueryCtx,
  staffProfileId: Id<"staffProfile">,
) {
  const staffProfile = await ctx.db.get("staffProfile", staffProfileId);
  return staffProfile?.fullName ?? null;
}

function buildDailyManagerReportPayload(args: {
  cashPositionSummary?: RegisterCashPositionSummary;
  completedBy: string;
  dailyClose: Doc<"dailyClose">;
  store: Doc<"store">;
}): DailyManagerReportPayload {
  const snapshot = args.dailyClose.reportSnapshot as DailyCloseReportSnapshot;
  const storeCurrency = normalizeCurrency(args.store.currency);
  const money = moneyFormatter(storeCurrency);
  const summary = {
    ...snapshot.summary,
    ...(args.cashPositionSummary ?? {}),
  };
  const operatingDate = snapshot.closeMetadata.operatingDate;
  const reportUrl = `${resolveAppUrl()}/${args.store.slug}/store/${args.store.slug}/operations/daily-close?operatingDate=${encodeURIComponent(operatingDate)}`;
  return {
    dailyCloseId: args.dailyClose._id,
    operatingDateValue: operatingDate,
    storeName: args.store.name,
    operatingDate: formatOperatingDate(operatingDate),
    completedAt: formatCompletedAt(snapshot.closeMetadata.completedAt),
    completedBy: args.completedBy,
    storeCurrency,
    status: "applied",
    statusLabel:
      snapshot.closeMetadata.actorType === "automation"
        ? undefined
        : "Reviewed items",
    statusSummary:
      snapshot.closeMetadata.actorType === "automation"
        ? undefined
        : "The day closed after required items were reviewed.",
    reportUrl,
    reviewedItems: buildReviewedItems(snapshot, money),
    carryForwardItems: buildCarryForwardItems(snapshot),
    blockers: buildBlockers(snapshot),
    summaryMetrics: buildSummaryMetrics(summary, money),
    cashMetrics: buildCashMetrics(summary, money),
    paymentTotals: buildPaymentTotals(summary, money),
    notes: snapshot.closeMetadata.notes ?? args.dailyClose.notes,
  };
}

function buildPreparedDailyManagerReportPayload(args: {
  cashPositionSummary?: RegisterCashPositionSummary;
  preparedAt?: number;
  snapshot: PreparedDailyCloseSnapshot;
  store: Doc<"store">;
}): DailyManagerReportPayload {
  const storeCurrency = normalizeCurrency(args.store.currency);
  const money = moneyFormatter(storeCurrency);
  const summary = {
    ...args.snapshot.summary,
    ...(args.cashPositionSummary ?? {}),
  };
  const reportUrl = `${resolveAppUrl()}/${args.store.slug}/store/${args.store.slug}/operations/daily-close?operatingDate=${encodeURIComponent(args.snapshot.operatingDate)}`;

  return {
    operatingDateValue: args.snapshot.operatingDate,
    storeName: args.store.name,
    operatingDate: formatOperatingDate(args.snapshot.operatingDate),
    completedAt: formatCompletedAt(args.preparedAt ?? Date.now()),
    completedBy: "Athena",
    storeCurrency,
    status: "prepared",
    reportUrl,
    reviewedItems: buildPreparedReviewItems(args.snapshot),
    carryForwardItems: buildPreparedCarryForwardItems(args.snapshot),
    blockers: buildPreparedBlockers(args.snapshot),
    summaryMetrics: buildSummaryMetrics(summary, money),
    cashMetrics: buildCashMetrics(summary, money),
    paymentTotals: buildPaymentTotals(summary, money),
    notes: "EOD Review is waiting for manager review.",
  };
}

async function buildRegisterCashPositionSummary(
  ctx: QueryCtx,
  args: {
    endAt?: number;
    operatingDate: string;
    startAt?: number;
    storeId: Id<"store">;
  },
): Promise<RegisterCashPositionSummary> {
  const [
    openedDateSessions,
    closeoutDateSessions,
    missingCloseoutDateSessions,
  ] = await Promise.all([
    ctx.db
      .query("registerSession")
      .withIndex("by_storeId_status_openedOperatingDate", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", "closed")
          .eq("openedOperatingDate", args.operatingDate),
      )
      .take(REGISTER_SESSION_EMAIL_SOURCE_LIMIT),
    ctx.db
      .query("registerSession")
      .withIndex("by_storeId_status_closeoutOperatingDate", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", "closed")
          .eq("closeoutOperatingDate", args.operatingDate),
      )
      .take(REGISTER_SESSION_EMAIL_SOURCE_LIMIT),
    ctx.db
      .query("registerSession")
      .withIndex("by_storeId_status_closeoutOperatingDate", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", "closed")
          .eq("closeoutOperatingDate", undefined),
      )
      .take(REGISTER_SESSION_EMAIL_SOURCE_LIMIT),
  ]);
  const sessionsById = new Map<Id<"registerSession">, Doc<"registerSession">>();

  [...openedDateSessions, ...closeoutDateSessions].forEach((session) =>
    sessionsById.set(session._id, session),
  );

  if (typeof args.startAt === "number" && typeof args.endAt === "number") {
    missingCloseoutDateSessions
      .filter(
        (session) =>
          !session.closeoutOperatingDate &&
          typeof session.closedAt === "number" &&
          session.closedAt >= args.startAt! &&
          session.closedAt < args.endAt!,
      )
      .forEach((session) => sessionsById.set(session._id, session));
  }

  const sessions = Array.from(sessionsById.values());

  return {
    closedRegisterSessionCount: sessions.length,
    countedCashTotal: sessions.reduce(
      (sum, session) =>
        sum +
        (typeof session.countedCash === "number"
          ? session.countedCash
          : session.expectedCash + (session.variance ?? 0)),
      0,
    ),
    expectedCashTotal: sessions.reduce(
      (sum, session) => sum + session.expectedCash,
      0,
    ),
    netCashVariance: sessions.reduce(
      (sum, session) => sum + (session.variance ?? 0),
      0,
    ),
    registerCount: sessions.length,
    registerVarianceCount: sessions.filter((session) =>
      Boolean(session.variance),
    ).length,
  };
}

function buildReviewedItems(
  snapshot: DailyCloseReportSnapshot,
  money: (amount: number) => string,
): DailyManagerReportItem[] {
  const summary = snapshot.summary;
  const items: DailyManagerReportItem[] = [];
  const netCashVariance = numberFromSummary(summary, "netCashVariance");
  const registerVarianceCount = numberFromSummary(
    summary,
    "registerVarianceCount",
  );

  if (registerVarianceCount > 0 || netCashVariance !== 0) {
    const expected = numberFromSummary(summary, "expectedCashTotal");
    const counted = numberFromSummaryWithFallback(
      summary,
      "countedCashTotal",
      expected + netCashVariance,
    );
    const varianceLabel =
      netCashVariance < 0 ? "Short" : netCashVariance > 0 ? "Over" : "Variance";

    items.push({
      title: "Cash variance",
      message: `${registerVarianceCount} register variance${registerVarianceCount === 1 ? "" : "s"} reviewed.`,
      metrics: [
        { label: "Expected", value: money(expected) },
        { label: "Counted", value: money(counted) },
        { label: varianceLabel, value: money(Math.abs(netCashVariance)) },
      ],
      meta: "Reviewed during close",
      tone: netCashVariance === 0 ? "neutral" : "warning",
    });
  }

  const otherReviewedItems = snapshot.reviewedItems.filter(
    (item) => item.category !== "cash_variance" && !/void/i.test(item.title),
  );

  return [
    ...items,
    ...otherReviewedItems.map((item) => ({
      title: item.title,
      message: item.message,
      meta: "Reviewed during close",
      tone: "neutral" as const,
    })),
  ];
}

function buildPreparedReviewItems(
  snapshot: PreparedDailyCloseSnapshot,
): DailyManagerReportItem[] {
  return snapshot.reviewItems.map((item) => ({
    title: item.title,
    message: item.message,
    meta: "Needs manager review",
    tone: "warning" as const,
  }));
}

function buildCarryForwardItems(
  snapshot: DailyCloseReportSnapshot,
): DailyManagerReportItem[] {
  const count =
    snapshot.readiness.carryForwardCount || snapshot.carryForwardItems.length;

  return Array.from({ length: count }, (_, index) => ({
    title: index === 0 ? "Opening handoff" : `Carry-forward ${index + 1}`,
    message: `${count} carry-forward item${count === 1 ? "" : "s"}`,
    tone: "warning" as const,
  }));
}

function buildPreparedCarryForwardItems(
  snapshot: PreparedDailyCloseSnapshot,
): DailyManagerReportItem[] {
  return snapshot.carryForwardItems.map((item) => ({
    title: item.title,
    message: item.message,
    meta: "Carries forward after review",
    tone: "warning" as const,
  }));
}

function buildBlockers(
  snapshot: DailyCloseReportSnapshot,
): DailyManagerReportItem[] {
  if (snapshot.readiness.status !== "blocked") return [];

  return snapshot.reviewedItems
    .filter((item) => item.severity === "blocker")
    .map((item) => ({
      title: item.title,
      message: item.message,
      tone: "danger" as const,
    }));
}

function buildPreparedBlockers(
  snapshot: PreparedDailyCloseSnapshot,
): DailyManagerReportItem[] {
  return snapshot.blockers.map((item) => ({
    title: item.title,
    message: item.message,
    tone: "danger" as const,
  }));
}

function buildPaymentTotals(
  summary: Record<string, unknown>,
  money: (amount: number) => string,
): DailyManagerReportPaymentTotal[] {
  const paymentTotals = summary.paymentTotals;

  if (!Array.isArray(paymentTotals)) return [];

  return paymentTotals.filter(isPaymentTotal).map((paymentTotal) => ({
    method: formatPaymentMethod(paymentTotal.method),
    amount: money(paymentTotal.amount),
    transactionCount: paymentTotal.transactionCount,
  }));
}

export function buildSummaryMetrics(
  summary: Record<string, unknown>,
  money: (amount: number) => string,
): DailyManagerReportMetric[] {
  const voidedTransactionCount = numberFromSummary(
    summary,
    "voidedTransactionCount",
  );

  return [
    {
      label: "Sales",
      value: money(numberFromSummary(summary, "salesTotal")),
      detail: countLabel(
        numberFromSummary(summary, "transactionCount"),
        "transaction",
      ),
    },
    {
      label: "Expenses",
      value: money(numberFromSummary(summary, "expenseTotal")),
      detail: countLabel(
        numberFromSummary(summary, "expenseTransactionCount"),
        "report",
      ),
    },
    ...(voidedTransactionCount > 0
      ? [
          {
            label: "Voids",
            value: String(voidedTransactionCount),
          },
        ]
      : []),
  ];
}

export function buildCashMetrics(
  summary: Record<string, unknown>,
  money: (amount: number) => string,
): DailyManagerReportMetric[] {
  const expectedCash = numberFromSummary(summary, "expectedCashTotal");
  const netCashVariance = numberFromSummary(summary, "netCashVariance");
  const countedCash = numberFromSummaryWithFallback(
    summary,
    "countedCashTotal",
    expectedCash + netCashVariance,
  );

  return [
    {
      label: "Expected cash",
      value: money(expectedCash),
    },
    {
      label: "Counted cash",
      value: money(countedCash),
    },
    {
      label: "Net variance",
      value: money(netCashVariance),
    },
  ];
}

function isPaymentTotal(value: unknown): value is {
  amount: number;
  method: string;
  transactionCount?: number;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { amount?: unknown }).amount === "number" &&
    typeof (value as { method?: unknown }).method === "string"
  );
}

function moneyFormatter(currency: string) {
  const formatter = currencyFormatter(currency);

  return (amount: number) => formatter.format(toDisplayAmount(amount));
}

function numberFromSummary(summary: Record<string, unknown>, key: string) {
  const value = summary[key];
  return typeof value === "number" ? value : 0;
}

function numberFromSummaryWithFallback(
  summary: Record<string, unknown>,
  key: string,
  fallback: number,
) {
  const value = summary[key];
  return typeof value === "number" ? value : fallback;
}

function countLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function normalizeCurrency(currency?: string) {
  return currency?.trim().toUpperCase() || "GHS";
}

function formatPaymentMethod(method: string) {
  return method
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatOperatingDate(operatingDate: string) {
  const parsed = new Date(`${operatingDate}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) return operatingDate;

  return parsed.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
  });
}

function formatCompletedAt(completedAt: number) {
  return new Date(completedAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Accra",
  });
}

export function resolveAppUrl() {
  const explicitAthenaUrl =
    process.env.ATHENA_BASE_URL ?? process.env.ATHENA_APP_URL;

  if (explicitAthenaUrl?.trim()) {
    return trimTrailingSlash(explicitAthenaUrl);
  }

  if (process.env.STAGE === "prod") return "https://athena.wigclub.store";

  return "http://localhost:5173";
}

function trimTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}
