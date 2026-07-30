import type { Doc, Id } from "../../_generated/dataModel";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DST_BOUNDARY_DRIFT_MS = 60 * 60 * 1000;
const MIN_LOCAL_DAY_MS = DAY_MS - MAX_DST_BOUNDARY_DRIFT_MS;
const MAX_LOCAL_DAY_MS = DAY_MS + MAX_DST_BOUNDARY_DRIFT_MS;

const FROZEN_SOURCE_REQUIREMENTS = {
  expense_transaction: {
    readMode: "by_storeId_status_completedAt",
    status: "completed",
  },
  pos_transaction: {
    readMode: "by_storeId_status_completedAt",
    status: "completed",
  },
  pos_transaction_adjustment: {
    readMode: "by_storeId_status_appliedAt",
    status: "applied",
  },
} as const;

export type DailyOperationsCloseSummary = {
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

export type DailyOperationsAdjustmentPaymentTotal = {
  amount: number;
  method: string;
  transactionCount: number;
};

export type DailyOperationsWeekMetric = DailyOperationsCloseSummary & {
  adjustmentPaymentTotals: DailyOperationsAdjustmentPaymentTotal[];
  isClosed: boolean;
  isReopened: boolean;
  isSelected: boolean;
  operatingDate: string;
};

export function emptyCloseSummary(): DailyOperationsCloseSummary {
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

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function exactStatuses(value: unknown, expectedStatus: string) {
  return (
    Array.isArray(value) && value.length === 1 && value[0] === expectedStatus
  );
}

function matchesRequestedOperatingRange(args: {
  actualEndAt: unknown;
  actualStartAt: unknown;
  expectedEndAt: number;
  expectedStartAt: number;
}) {
  if (
    typeof args.actualStartAt !== "number" ||
    !Number.isFinite(args.actualStartAt) ||
    typeof args.actualEndAt !== "number" ||
    !Number.isFinite(args.actualEndAt)
  ) {
    return false;
  }

  const duration = args.actualEndAt - args.actualStartAt;
  return (
    duration >= MIN_LOCAL_DAY_MS &&
    duration <= MAX_LOCAL_DAY_MS &&
    Math.abs(args.actualStartAt - args.expectedStartAt) <=
      MAX_DST_BOUNDARY_DRIFT_MS &&
    Math.abs(args.actualEndAt - args.expectedEndAt) <= MAX_DST_BOUNDARY_DRIFT_MS
  );
}

type FrozenFinancialSourceCounts = {
  appliedAdjustmentCount: number;
  completedTransactionCount: number;
  expenseTransactionCount: number;
};

function frozenFinancialSourceCounts(args: {
  closeMetadata: Record<string, unknown>;
  sourceCompleteness: Record<string, unknown> | null;
}): FrozenFinancialSourceCounts | null {
  if (
    !args.sourceCompleteness ||
    args.sourceCompleteness.complete !== true ||
    !Array.isArray(args.sourceCompleteness.entries)
  ) {
    return null;
  }

  const completenessEntries: Record<string, unknown>[] = [];
  for (const value of args.sourceCompleteness.entries) {
    const entry = recordValue(value);
    if (!entry || entry.complete !== true) return null;
    completenessEntries.push(entry);
  }
  const counts: Partial<FrozenFinancialSourceCounts> = {};

  for (const [source, requirement] of Object.entries(
    FROZEN_SOURCE_REQUIREMENTS,
  )) {
    const matchingEntries = completenessEntries.filter(
      (entry) =>
        entry.source === source &&
        Array.isArray(entry.statuses) &&
        entry.statuses.includes(requirement.status),
    );
    if (matchingEntries.length !== 1) return null;
    const entry = matchingEntries[0];
    const range = recordValue(entry?.range);

    if (
      !entry ||
      entry.readMode !== requirement.readMode ||
      !Number.isFinite(entry.recordCount) ||
      Number(entry.recordCount) < 0 ||
      !Number.isInteger(entry.recordCount) ||
      !Number.isInteger(entry.limit) ||
      Number(entry.limit) <= 0 ||
      Number(entry.recordCount) >= Number(entry.limit) ||
      !range ||
      range.startAt !== args.closeMetadata.startAt ||
      range.endAt !== args.closeMetadata.endAt ||
      !exactStatuses(entry.statuses, requirement.status)
    ) {
      return null;
    }

    if (source === "pos_transaction") {
      counts.completedTransactionCount = Number(entry.recordCount);
    } else if (source === "pos_transaction_adjustment") {
      counts.appliedAdjustmentCount = Number(entry.recordCount);
    } else {
      counts.expenseTransactionCount = Number(entry.recordCount);
    }
  }

  return typeof counts.appliedAdjustmentCount === "number" &&
    typeof counts.completedTransactionCount === "number" &&
    typeof counts.expenseTransactionCount === "number"
    ? (counts as FrozenFinancialSourceCounts)
    : null;
}

export function closeCandidateOperatingRange(args: {
  candidates: Array<Doc<"dailyClose">>;
  expectedEndAt: number;
  expectedStartAt: number;
  operatingDate: string;
  storeId: Id<"store">;
}) {
  const ranges = new Map<string, { endAt: number; startAt: number }>();

  for (const candidate of args.candidates) {
    const reportSnapshot = recordValue(candidate.reportSnapshot);
    const closeMetadata = recordValue(reportSnapshot?.closeMetadata);
    const sourceCompleteness = recordValue(reportSnapshot?.sourceCompleteness);
    if (
      reportSnapshot?.snapshotContractVersion !== 2 ||
      !closeMetadata ||
      closeMetadata.storeId !== args.storeId ||
      closeMetadata.operatingDate !== args.operatingDate ||
      !matchesRequestedOperatingRange({
        actualEndAt: closeMetadata.endAt,
        actualStartAt: closeMetadata.startAt,
        expectedEndAt: args.expectedEndAt,
        expectedStartAt: args.expectedStartAt,
      }) ||
      !frozenFinancialSourceCounts({
        closeMetadata,
        sourceCompleteness,
      })
    ) {
      continue;
    }

    const range = {
      endAt: closeMetadata.endAt as number,
      startAt: closeMetadata.startAt as number,
    };
    ranges.set(`${range.startAt}:${range.endAt}`, range);
  }

  return ranges.size === 1 ? [...ranges.values()][0] : null;
}

function normalizeFrozenPaymentTotals(value: unknown) {
  if (!Array.isArray(value)) return null;
  const normalized: DailyOperationsAdjustmentPaymentTotal[] = [];
  const methods = new Set<string>();

  for (const candidate of value) {
    const paymentTotal = recordValue(candidate);
    if (
      !paymentTotal ||
      typeof paymentTotal.method !== "string" ||
      paymentTotal.method.trim().length === 0 ||
      typeof paymentTotal.amount !== "number" ||
      !Number.isFinite(paymentTotal.amount) ||
      typeof paymentTotal.transactionCount !== "number" ||
      !Number.isInteger(paymentTotal.transactionCount) ||
      paymentTotal.transactionCount < 0 ||
      methods.has(paymentTotal.method)
    ) {
      return null;
    }

    methods.add(paymentTotal.method);
    normalized.push({
      amount: paymentTotal.amount,
      method: paymentTotal.method,
      transactionCount: paymentTotal.transactionCount,
    });
  }

  return normalized;
}

function usableFrozenWeekSummary(args: {
  close: Doc<"dailyClose">;
  endAt: number;
  operatingDate: string;
  startAt: number;
  storeId: Id<"store">;
}):
  | (DailyOperationsCloseSummary & {
      adjustmentPaymentTotals: DailyOperationsAdjustmentPaymentTotal[];
    })
  | null {
  const reportSnapshot = recordValue(args.close.reportSnapshot);
  const closeMetadata = recordValue(reportSnapshot?.closeMetadata);
  const sourceCompleteness = recordValue(reportSnapshot?.sourceCompleteness);
  const summary = recordValue(reportSnapshot?.summary);

  const sourceCounts =
    closeMetadata &&
    frozenFinancialSourceCounts({
      closeMetadata,
      sourceCompleteness,
    });

  if (
    reportSnapshot?.snapshotContractVersion !== 2 ||
    !closeMetadata ||
    closeMetadata.storeId !== args.storeId ||
    closeMetadata.operatingDate !== args.operatingDate ||
    !matchesRequestedOperatingRange({
      actualEndAt: closeMetadata.endAt,
      actualStartAt: closeMetadata.startAt,
      expectedEndAt: args.endAt,
      expectedStartAt: args.startAt,
    }) ||
    !sourceCounts ||
    !summary
  ) {
    return null;
  }

  const requiredNumberFields = [
    "adjustedSalesTotal",
    "adjustmentCashSettlementTotal",
    "adjustmentCollectionTotal",
    "adjustmentNetSettlementTotal",
    "adjustmentRefundTotal",
    "currentDayCashTotal",
    "currentDayCashTransactionCount",
    "expenseTotal",
    "expenseTransactionCount",
    "itemAdjustmentCount",
    "netCashMovementTotal",
    "salesTotal",
    "transactionCount",
  ] as const;
  const requiredCountFields = [
    "currentDayCashTransactionCount",
    "expenseTransactionCount",
    "itemAdjustmentCount",
    "transactionCount",
  ] as const;
  const values = Object.fromEntries(
    requiredNumberFields.map((field) => [field, finiteNumber(summary, field)]),
  ) as Record<(typeof requiredNumberFields)[number], number | null>;
  const adjustmentPaymentTotals = normalizeFrozenPaymentTotals(
    summary.adjustmentPaymentTotals,
  );
  const paymentTotals = normalizeFrozenPaymentTotals(summary.paymentTotals);

  if (
    requiredNumberFields.some((field) => values[field] === null) ||
    requiredCountFields.some((field) => {
      const value = values[field];
      return value === null || !Number.isInteger(value) || value < 0;
    }) ||
    values.transactionCount !== sourceCounts.completedTransactionCount ||
    values.expenseTransactionCount !== sourceCounts.expenseTransactionCount ||
    values.itemAdjustmentCount !== sourceCounts.appliedAdjustmentCount ||
    values.currentDayCashTransactionCount! >
      sourceCounts.completedTransactionCount ||
    paymentTotals?.some(
      (total) =>
        total.transactionCount > sourceCounts.completedTransactionCount,
    ) ||
    adjustmentPaymentTotals?.some(
      (total) => total.transactionCount > sourceCounts.appliedAdjustmentCount,
    ) ||
    !adjustmentPaymentTotals ||
    !paymentTotals
  ) {
    return null;
  }

  return {
    ...emptyCloseSummary(),
    adjustedSalesTotal: values.adjustedSalesTotal!,
    adjustmentCashSettlementTotal: values.adjustmentCashSettlementTotal!,
    adjustmentCollectionTotal: values.adjustmentCollectionTotal!,
    adjustmentNetSettlementTotal: values.adjustmentNetSettlementTotal!,
    adjustmentPaymentTotals,
    adjustmentRefundTotal: values.adjustmentRefundTotal!,
    currentDayCashTotal: values.currentDayCashTotal!,
    currentDayCashTransactionCount: values.currentDayCashTransactionCount!,
    expenseTotal: values.expenseTotal!,
    expenseTransactionCount: values.expenseTransactionCount!,
    itemAdjustmentCount: values.itemAdjustmentCount!,
    netCashMovementTotal: values.netCashMovementTotal!,
    paymentTotals,
    salesTotal: values.salesTotal!,
    transactionCount: values.transactionCount!,
  };
}

function sameDailyCloseId(
  left: Id<"dailyClose"> | undefined,
  right: Id<"dailyClose"> | undefined,
) {
  return left !== undefined && right !== undefined && left === right;
}

function resolveFrozenDailyCloseAuthority(
  candidates: Array<Doc<"dailyClose">>,
) {
  const candidatesById = new Map(
    candidates.map((candidate) => [candidate._id, candidate]),
  );
  let revisionGraphIsConsistent = true;

  for (const candidate of candidates) {
    const successorId = candidate.supersededByDailyCloseId;
    const predecessorId =
      candidate.supersedesDailyCloseId ?? candidate.reopenedFromDailyCloseId;

    if (
      (candidate.supersedesDailyCloseId !== undefined ||
        candidate.reopenedFromDailyCloseId !== undefined) &&
      !sameDailyCloseId(
        candidate.supersedesDailyCloseId,
        candidate.reopenedFromDailyCloseId,
      )
    ) {
      revisionGraphIsConsistent = false;
      break;
    }

    if (successorId) {
      const successor = candidatesById.get(successorId);
      if (
        !successor ||
        successor.storeId !== candidate.storeId ||
        successor.operatingDate !== candidate.operatingDate ||
        !sameDailyCloseId(successor.supersedesDailyCloseId, candidate._id) ||
        !sameDailyCloseId(successor.reopenedFromDailyCloseId, candidate._id) ||
        candidate.lifecycleStatus === "active" ||
        (successor.status === "open"
          ? candidate.lifecycleStatus !== "reopened"
          : candidate.lifecycleStatus !== "superseded")
      ) {
        revisionGraphIsConsistent = false;
        break;
      }
    }

    if (predecessorId) {
      const predecessor = candidatesById.get(predecessorId);
      if (
        !predecessor ||
        predecessor.storeId !== candidate.storeId ||
        predecessor.operatingDate !== candidate.operatingDate ||
        !sameDailyCloseId(predecessor.supersededByDailyCloseId, candidate._id)
      ) {
        revisionGraphIsConsistent = false;
        break;
      }
    }
  }

  if (!revisionGraphIsConsistent) return null;

  const terminalCandidates = candidates.filter(
    (candidate) =>
      candidate.supersededByDailyCloseId === undefined &&
      (candidate.lifecycleStatus === undefined ||
        candidate.lifecycleStatus === "active"),
  );

  if (terminalCandidates.length !== 1) return null;

  const terminalCandidate = terminalCandidates[0];
  const chainCandidateIds = new Set<Id<"dailyClose">>();
  let chainCandidate: Doc<"dailyClose"> | undefined = terminalCandidate;

  while (chainCandidate) {
    if (chainCandidateIds.has(chainCandidate._id)) return null;
    chainCandidateIds.add(chainCandidate._id);
    const predecessorId: Id<"dailyClose"> | undefined =
      chainCandidate.supersedesDailyCloseId ??
      chainCandidate.reopenedFromDailyCloseId;
    chainCandidate = predecessorId
      ? candidatesById.get(predecessorId)
      : undefined;
  }

  if (chainCandidateIds.size !== candidates.length) return null;

  return terminalCandidate.status === "completed" ? terminalCandidate : null;
}

export function frozenWeekMetricForDate(args: {
  candidates: Array<Doc<"dailyClose">>;
  endAt: number;
  isSelected: boolean;
  operatingDate: string;
  startAt: number;
  storeId: Id<"store">;
}): DailyOperationsWeekMetric | null {
  const close = resolveFrozenDailyCloseAuthority(args.candidates);
  if (!close) return null;
  const summary = usableFrozenWeekSummary({
    close,
    operatingDate: args.operatingDate,
    startAt: args.startAt,
    endAt: args.endAt,
    storeId: args.storeId,
  });
  if (!summary) return null;

  return {
    ...summary,
    isClosed: true,
    isReopened: false,
    isSelected: args.isSelected,
    operatingDate: args.operatingDate,
  };
}
