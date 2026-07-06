import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

const DAILY_CLOSE_QUERY_LIMIT = 200;

type DailyCloseRange = { endAt: number; startAt: number };

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

type DailyCloseSourceRead<T> = {
  rows: T[];
  completeness: DailyCloseSourceCompletenessEntry;
};

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

export type AppliedTransactionAdjustment =
  PosTransactionAdjustmentReportRow & {
    appliedAt: number;
    signedSalesDelta: number;
    signedSettlementAmount: number;
    transactionId: string;
  };

type AdjustmentPaymentTotal = {
  method: string;
  amount: number;
  transactionCount: number;
};

type AdjustmentReportTotals = {
  adjustedSalesTotal: number;
  adjustmentCashSettlementTotal: number;
  adjustmentCollectionTotal: number;
  adjustmentNetSettlementTotal: number;
  adjustmentPaymentTotals: AdjustmentPaymentTotal[];
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

export async function readAppliedTransactionAdjustmentsForDay(
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
