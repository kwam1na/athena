import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import {
  buildDailyCloseExpenseProductEvidence,
  type DailyCloseExpenseProductEvidence,
} from "../operations/dailyClose";
import type {
  ReportWeekAcceptedCorrection,
  ReportWeekLineage,
  ReportWeekTopSkuLeader,
} from "../../shared/reportsContract";
import { stableStringHash } from "./fingerprint";
import { frozenCatalogLabel } from "./weekly";
import { aggregateWeeklyCloseEvidence } from "./weeklyCloseEvidence";

const TARGET_ORGANIZATION_SLUG = "wigclub";
const TARGET_STORE_SLUG = "wigclub";
const TARGET_CYCLE_START = "2026-08-03";
const TARGET_CYCLE_END = "2026-08-09";
const TARGET_SCHEDULED_DATES = [
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-08",
] as const;
const TARGET_CASH_VARIANCE_MINOR = 32_000;
const TARGET_TENDER_VALUE_MINOR = 2_502_500;
const TARGET_TENDER_METHOD_COUNT = 3;
const TARGET_TENDER_USE_COUNT = 99;
const TARGET_EXPENSE_SPEND_MINOR = 70_500;
const TARGET_EXPENSE_QUANTITY = 16;
const TARGET_EXPENSE_SKU_COUNT = 11;
const TARGET_EXPENSE_TRANSACTION_COUNT = 10;
const REPAIR_TRANSACTION_PROBE_LIMIT = 11;
const REPAIR_ITEM_PROBE_LIMIT = 201;
/**
 * Accepted top-sales leaders are a small top-N list. The repair reads at most
 * one SKU plus one product per leader, so an over-long list is refused rather
 * than truncated — a truncated correction would silently drop a leader.
 */
const REPAIR_TOP_SKU_LEADER_LIMIT = 5;

type CorrectionClose = {
  _id: Id<"dailyClose">;
  lifecycleStatus?: string;
  operatingDate: string;
  reportSnapshot?: {
    expenseProductEvidence?: DailyCloseExpenseProductEvidence;
    summary?: Record<string, unknown>;
  };
  status: string;
};

type CandidateInput = {
  accepted: {
    baselineFingerprint: string;
    cycleEndDate: string;
    cycleStartDate: string;
    scheduleLineage: ReportWeekLineage[];
    /**
     * Already-resolved frozen leader identity, in the baseline's own order.
     * Omitted when the baseline retained no leaders at all.
     */
    topSkuLeaders?: ReportWeekTopSkuLeader[];
  };
  appliedAt: number;
  closes: CorrectionClose[];
  days: Array<{
    closeId: Id<"dailyClose">;
    operatingDate: string;
  }>;
  sourceManifestFingerprint: string;
};

export type WigclubWeeklyCorrectionCandidate = {
  baselineFingerprint: string;
  candidateFingerprint: string;
  correction: ReportWeekAcceptedCorrection;
};

function assertTargetFrame(input: CandidateInput) {
  if (
    input.accepted.cycleStartDate !== TARGET_CYCLE_START ||
    input.accepted.cycleEndDate !== TARGET_CYCLE_END
  ) {
    throw new Error("Accepted report is not the sealed Wigclub Aug 3-9 cycle.");
  }
  const lineageDates = input.accepted.scheduleLineage.map(
    (day) => day.localDate,
  );
  const expectedFrame = [...TARGET_SCHEDULED_DATES, TARGET_CYCLE_END];
  if (
    lineageDates.length !== expectedFrame.length ||
    expectedFrame.some((date, index) => lineageDates[index] !== date)
  ) {
    throw new Error("Accepted report does not have the expected seven-date frame.");
  }
  const includedDates = input.accepted.scheduleLineage
    .filter((day) => day.included)
    .map((day) => day.localDate);
  if (
    includedDates.length !== TARGET_SCHEDULED_DATES.length ||
    TARGET_SCHEDULED_DATES.some(
      (date, index) => includedDates[index] !== date,
    )
  ) {
    throw new Error("Accepted report does not have the expected six scheduled dates.");
  }
  if (!input.sourceManifestFingerprint.trim()) {
    throw new Error("Correction source manifest fingerprint is required.");
  }
}

function totalExpenseProductCount(
  evidence: ReturnType<typeof aggregateWeeklyCloseEvidence>["expenses"],
) {
  return evidence.bySpend.length + (evidence.spendRemainder?.productCount ?? 0);
}

/**
 * Seal the fixed production repair candidate from already-bounded source rows.
 * The timestamp is provenance, not candidate identity; apply may re-derive at
 * a later instant without changing the sealed evidence fingerprint.
 */
export function buildWigclubWeeklyCorrectionCandidate(
  input: CandidateInput,
): WigclubWeeklyCorrectionCandidate {
  assertTargetFrame(input);
  if (input.days.length !== TARGET_SCHEDULED_DATES.length) {
    throw new Error("Correction requires exactly six resolved report days.");
  }
  const uniqueCloseIds = new Set(input.days.map((day) => String(day.closeId)));
  if (
    uniqueCloseIds.size !== TARGET_SCHEDULED_DATES.length ||
    input.days.some(
      (day, index) => day.operatingDate !== TARGET_SCHEDULED_DATES[index],
    )
  ) {
    throw new Error("Correction close lineage does not match the sealed cycle.");
  }
  const closeEvidence = aggregateWeeklyCloseEvidence({
    closes: new Map(input.closes.map((close) => [String(close._id), close])),
    days: input.days,
    scheduledDates: TARGET_SCHEDULED_DATES,
  });
  if (
    closeEvidence.cash.coverage.status !== "complete" ||
    closeEvidence.cash.cashVarianceMinor !== TARGET_CASH_VARIANCE_MINOR
  ) {
    throw new Error("Correction cash evidence does not match the sealed census.");
  }
  if (
    closeEvidence.payments.coverage.status !== "complete" ||
    closeEvidence.payments.coveredTenderValueMinor !==
      TARGET_TENDER_VALUE_MINOR ||
    closeEvidence.payments.rows.length !== TARGET_TENDER_METHOD_COUNT ||
    closeEvidence.payments.rows.reduce(
      (total, row) => total + row.tenderUseCount,
      0,
    ) !== TARGET_TENDER_USE_COUNT
  ) {
    throw new Error("Correction payment evidence does not match the sealed census.");
  }
  if (
    closeEvidence.expenses.coverage.status !== "complete" ||
    closeEvidence.expenses.coveredSpendMinor !== TARGET_EXPENSE_SPEND_MINOR ||
    closeEvidence.expenses.coveredQuantity !== TARGET_EXPENSE_QUANTITY ||
    totalExpenseProductCount(closeEvidence.expenses) !==
      TARGET_EXPENSE_SKU_COUNT
  ) {
    throw new Error("Correction expense evidence does not match the sealed census.");
  }
  const scheduleLineage = input.accepted.scheduleLineage.map((day) =>
    day.included ? { ...day, dayClosed: true } : day,
  );
  const topSkuLeaders = input.accepted.topSkuLeaders;
  const fingerprintPayload = {
    baselineFingerprint: input.accepted.baselineFingerprint,
    closeEvidence,
    contractVersion: 1,
    scheduleLineage,
    sourceManifestFingerprint: input.sourceManifestFingerprint,
    topSkuLeaders: topSkuLeaders ?? null,
  };
  const candidateFingerprint = `v1:${stableStringHash(
    JSON.stringify(fingerprintPayload),
  )}`;
  return {
    baselineFingerprint: input.accepted.baselineFingerprint,
    candidateFingerprint,
    correction: {
      contractVersion: 1,
      appliedAt: input.appliedAt,
      candidateFingerprint,
      sourceManifestFingerprint: input.sourceManifestFingerprint,
      scheduleLineage,
      closeEvidence,
      ...(topSkuLeaders ? { topSkuLeaders } : {}),
    },
  };
}

type PatchOnlyCtx = {
  db: {
    patch: (
      table: "reportWeekAccepted",
      id: Id<"reportWeekAccepted">,
      value: { correction: ReportWeekAcceptedCorrection },
    ) => Promise<unknown>;
  };
};

/** Set-once amendment-style storage; no source or notification row is touched. */
export async function applyWeeklyAcceptedCorrection(
  ctx: PatchOnlyCtx,
  accepted: {
    _id: Id<"reportWeekAccepted">;
    correction?: ReportWeekAcceptedCorrection;
  },
  correction: ReportWeekAcceptedCorrection,
) {
  if (accepted.correction) {
    if (
      accepted.correction.candidateFingerprint ===
        correction.candidateFingerprint &&
      accepted.correction.sourceManifestFingerprint ===
        correction.sourceManifestFingerprint
    ) {
      return { outcome: "unchanged" as const };
    }
    throw new Error("Accepted report already has a different correction.");
  }
  await ctx.db.patch("reportWeekAccepted", accepted._id, { correction });
  return { outcome: "applied" as const };
}

async function uniqueByIndex<T>(rows: Promise<T[]>, message: string) {
  const resolved = await rows;
  if (resolved.length !== 1) throw new Error(message);
  return resolved[0]!;
}

async function reconstructExpenseEvidenceForClose(
  ctx: Pick<QueryCtx, "db">,
  close: Doc<"dailyClose">,
) {
  const metadata = close.reportSnapshot?.closeMetadata;
  if (!metadata) throw new Error("Repair close is missing its frozen window.");
  const transactions = await ctx.db
    .query("expenseTransaction")
    .withIndex("by_storeId_status_completedAt", (q) =>
      q
        .eq("storeId", close.storeId)
        .eq("status", "completed")
        .gte("completedAt", metadata.startAt)
        .lt("completedAt", metadata.endAt),
    )
    .take(REPAIR_TRANSACTION_PROBE_LIMIT);
  if (transactions.length >= REPAIR_TRANSACTION_PROBE_LIMIT) {
    throw new Error("Repair expense transaction probe exceeded its sealed bound.");
  }
  const itemsWithTransactions: Array<{
    item: Doc<"expenseTransactionItem">;
    transaction: Doc<"expenseTransaction">;
  }> = [];
  for (const transaction of transactions) {
    const remaining = REPAIR_ITEM_PROBE_LIMIT - itemsWithTransactions.length;
    const items = await ctx.db
      .query("expenseTransactionItem")
      .withIndex("by_transactionId", (q) =>
        q.eq("transactionId", transaction._id),
      )
      .take(remaining);
    itemsWithTransactions.push(
      ...items.map((item) => ({ item, transaction })),
    );
    if (itemsWithTransactions.length >= REPAIR_ITEM_PROBE_LIMIT) {
      throw new Error("Repair expense item probe exceeded its sealed bound.");
    }
  }
  const evidence = buildDailyCloseExpenseProductEvidence({
    itemsWithTransactions,
    sourceCapReached: false,
    transactionSourceComplete: true,
    transactions,
  });
  if (evidence.status !== "complete") {
    throw new Error(`Repair expense evidence is ${evidence.reason}.`);
  }
  // Per-day authority seam: the reconstructed item spend must equal this
  // close's frozen expense total before any weekly aggregation can run.
  const frozenExpenseTotal = close.reportSnapshot?.summary.expenseTotal;
  if (
    !Number.isSafeInteger(frozenExpenseTotal) ||
    frozenExpenseTotal !== evidence.expenseTotal
  ) {
    throw new Error(
      `Repair date ${close.operatingDate} reconstructed expense spend does not equal its frozen close expense total.`,
    );
  }
  return { evidence, itemsWithTransactions, transactions };
}

/**
 * Rebuild frozen display identity for the retained top-sales leaders.
 *
 * Unlike the acceptance-time freeze, which falls back to the opaque SKU id
 * when the catalog cannot answer, an operator-reviewed production correction
 * fails closed: a leader that cannot be resolved to a real catalog label is
 * refused by name so the operator decides, rather than sealing an id string
 * into a report a manager will read.
 */
async function reconstructTopSkuLeaderIdentity(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
  leaders: readonly {
    productSkuId: Id<"productSku">;
    unitsSold: number;
  }[],
): Promise<ReportWeekTopSkuLeader[] | undefined> {
  // No retained leaders means the section is legitimately absent; nothing is
  // fabricated to fill it.
  if (leaders.length === 0) return undefined;
  if (leaders.length > REPAIR_TOP_SKU_LEADER_LIMIT) {
    throw new Error("Repair top sales leader probe exceeded its sealed bound.");
  }
  const resolved: ReportWeekTopSkuLeader[] = [];
  for (const leader of leaders) {
    const refuse = (reason: string) => {
      throw new Error(
        `Repair top sales leader ${String(leader.productSkuId)} in ${TARGET_CYCLE_START}-${TARGET_CYCLE_END} ${reason}.`,
      );
    };
    const sku = await ctx.db.get("productSku", leader.productSkuId);
    if (!sku || sku.storeId !== storeId) {
      refuse("has no catalog SKU in the sealed store");
    }
    const product = await ctx.db.get("product", sku!.productId);
    const productSku = frozenCatalogLabel(sku!.sku);
    const productName =
      (product?.storeId === storeId
        ? frozenCatalogLabel(product.name)
        : undefined) ?? frozenCatalogLabel(sku!.productName);
    if (!productSku || !productName) {
      refuse("has no resolvable catalog label");
    }
    resolved.push({
      productName: productName!,
      productSku: productSku!,
      productSkuId: leader.productSkuId,
      unitsSold: leader.unitsSold,
    });
  }
  return resolved;
}

async function readWigclubCorrectionCandidate(
  ctx: Pick<QueryCtx, "db">,
  appliedAt: number,
) {
  const organization = await uniqueByIndex(
    ctx.db
      .query("organization")
      .withIndex("by_slug", (q) => q.eq("slug", TARGET_ORGANIZATION_SLUG))
      .take(2),
    "Sealed Wigclub organization lookup was not unique.",
  );
  const store = await uniqueByIndex(
    ctx.db
      .query("store")
      .withIndex("by_organizationId_slug", (q) =>
        q
          .eq("organizationId", organization._id)
          .eq("slug", TARGET_STORE_SLUG),
      )
      .take(2),
    "Sealed Wigclub store lookup was not unique.",
  );
  const accepted = await uniqueByIndex(
    ctx.db
      .query("reportWeekAccepted")
      .withIndex("by_storeId_cycleStartDate", (q) =>
        q
          .eq("storeId", store._id)
          .eq("cycleStartDate", TARGET_CYCLE_START),
      )
      .take(2),
    "Sealed accepted weekly report lookup was not unique.",
  );
  const reportDays = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q
        .eq("storeId", store._id)
        .gte("operatingDate", TARGET_CYCLE_START)
        .lte("operatingDate", TARGET_CYCLE_END),
    )
    .take(8);
  const scheduledDays = TARGET_SCHEDULED_DATES.map((operatingDate) => {
    const matches = reportDays.filter(
      (day) => day.operatingDate === operatingDate && day.closeId,
    );
    if (matches.length !== 1) {
      throw new Error(`Repair date ${operatingDate} has no unique close lineage.`);
    }
    return {
      closeId: matches[0]!.closeId!,
      operatingDate,
      reportDayId: matches[0]!._id,
    };
  });
  const closes: CorrectionClose[] = [];
  const manifest: unknown[] = [];
  const dailyReconciliation: Array<{
    cashVarianceMinor: number | null;
    expenseItemCount: number;
    expenseSpendMinor: number;
    expenseTransactionCount: number;
    operatingDate: string;
    paymentTenderUseCount: number;
    paymentValueMinor: number;
  }> = [];
  let transactionCount = 0;
  for (const day of scheduledDays) {
    const close = await ctx.db.get("dailyClose", day.closeId);
    if (
      !close ||
      close.storeId !== store._id ||
      close.operatingDate !== day.operatingDate ||
      close.status !== "completed" ||
      close.lifecycleStatus === "reopened" ||
      close.lifecycleStatus === "superseded"
    ) {
      throw new Error(`Repair date ${day.operatingDate} has invalid close evidence.`);
    }
    const reconstructed = await reconstructExpenseEvidenceForClose(ctx, close);
    transactionCount += reconstructed.transactions.length;
    const paymentTotals = Array.isArray(close.reportSnapshot?.summary.paymentTotals)
      ? (close.reportSnapshot.summary.paymentTotals as Array<
          Record<string, unknown>
        >)
      : [];
    dailyReconciliation.push({
      cashVarianceMinor: Number.isSafeInteger(
        close.reportSnapshot?.summary.netCashVariance,
      )
        ? (close.reportSnapshot?.summary.netCashVariance as number)
        : null,
      expenseItemCount: reconstructed.evidence.sourceItemCount,
      expenseSpendMinor: reconstructed.evidence.expenseTotal,
      expenseTransactionCount: reconstructed.evidence.sourceTransactionCount,
      operatingDate: day.operatingDate,
      paymentTenderUseCount: paymentTotals.reduce(
        (total, row) =>
          total +
          (Number.isSafeInteger(row.transactionCount)
            ? (row.transactionCount as number)
            : 0),
        0,
      ),
      paymentValueMinor: paymentTotals.reduce(
        (total, row) =>
          total + (Number.isSafeInteger(row.amount) ? (row.amount as number) : 0),
        0,
      ),
    });
    closes.push({
      ...close,
      reportSnapshot: {
        ...close.reportSnapshot,
        expenseProductEvidence: reconstructed.evidence,
      },
    });
    manifest.push({
      closeId: close._id,
      operatingDate: day.operatingDate,
      reportDayId: day.reportDayId,
      summary: close.reportSnapshot?.summary,
      transactions: reconstructed.transactions.map((transaction) => ({
        completedAt: transaction.completedAt,
        id: transaction._id,
        status: transaction.status,
        totalValue: transaction.totalValue,
      })),
      items: reconstructed.itemsWithTransactions.map(({ item }) => ({
        costPrice: item.costPrice,
        id: item._id,
        productName: item.productName,
        productSku: item.productSku,
        productSkuId: item.productSkuId,
        quantity: item.quantity,
        transactionId: item.transactionId,
      })),
    });
  }
  if (transactionCount !== TARGET_EXPENSE_TRANSACTION_COUNT) {
    throw new Error(
      `Repair expense report census does not match production evidence (expected ${TARGET_EXPENSE_TRANSACTION_COUNT}, found ${transactionCount}).`,
    );
  }
  const topSkuLeaders = await reconstructTopSkuLeaderIdentity(
    ctx,
    store._id,
    accepted.topSkuLeaders ?? [],
  );
  const sourceManifestFingerprint = `v1:${stableStringHash(
    JSON.stringify({
      acceptedId: accepted._id,
      baselineFingerprint: accepted.baselineFingerprint,
      manifest,
      storeId: store._id,
      topSkuLeaders: topSkuLeaders ?? null,
    }),
  )}`;
  const candidate = buildWigclubWeeklyCorrectionCandidate({
    accepted: {
      baselineFingerprint: accepted.baselineFingerprint,
      cycleEndDate: accepted.cycleEndDate,
      cycleStartDate: accepted.cycleStartDate,
      scheduleLineage: accepted.scheduleLineage,
      topSkuLeaders,
    },
    appliedAt,
    closes,
    days: scheduledDays,
    sourceManifestFingerprint,
  });
  const notificationIntents = await ctx.db
    .query("notificationIntent")
    .withIndex("by_dedupeKey", (q) =>
      q.eq(
        "dedupeKey",
        `eod.weekly_manager_report:${String(accepted._id)}`,
      ),
    )
    .take(2);
  const notificationDeliveries = notificationIntents[0]
    ? await ctx.db
        .query("notificationDelivery")
        .withIndex("by_intentId", (q) =>
          q.eq("intentId", notificationIntents[0]!._id),
        )
        .take(25)
    : [];
  return {
    accepted,
    candidate,
    dailyReconciliation,
    notificationState: {
      deliveryCount: notificationDeliveries.length,
      deliveryStatuses: notificationDeliveries.map((row) => row.status),
      intentCount: notificationIntents.length,
      intentStatuses: notificationIntents.map((row) => row.status),
    },
    organization,
    scheduledDays,
    store,
  };
}

export const previewWigclubAug3WeeklyCorrection = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const result = await readWigclubCorrectionCandidate(ctx, Date.now());
    return {
      baselineFingerprint: result.candidate.baselineFingerprint,
      candidateFingerprint: result.candidate.candidateFingerprint,
      correction: result.candidate.correction,
      dailyReconciliation: result.dailyReconciliation,
      notificationState: result.notificationState,
      target: {
        acceptedWeekId: result.accepted._id,
        closeIds: result.scheduledDays.map((day) => day.closeId),
        organizationId: result.organization._id,
        storeId: result.store._id,
      },
      warning:
        "Expense products are reconstructed from retained transaction items because these legacy closes predate frozen product evidence.",
    };
  },
});

export const applyWigclubAug3WeeklyCorrection = internalMutation({
  args: {
    baselineFingerprint: v.string(),
    candidateFingerprint: v.string(),
  },
  returns: v.any(),
  handler: async (ctx: MutationCtx, args) => {
    const result = await readWigclubCorrectionCandidate(ctx, Date.now());
    if (result.candidate.baselineFingerprint !== args.baselineFingerprint) {
      throw new Error("Accepted baseline fingerprint drifted after preview.");
    }
    if (result.candidate.candidateFingerprint !== args.candidateFingerprint) {
      throw new Error("Correction candidate fingerprint drifted after preview.");
    }
    return applyWeeklyAcceptedCorrection(
      ctx,
      result.accepted,
      result.candidate.correction,
    );
  },
});
