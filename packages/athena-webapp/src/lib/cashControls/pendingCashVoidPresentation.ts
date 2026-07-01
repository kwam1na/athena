export type PendingCashVoidApprovalInput = {
  cashAffectingCount?: number | null;
  cashAdjustmentCount?: number | null;
  cashAdjustmentDelta?: number | null;
  cashAmount?: number | null;
  items?: Array<{
    cashAmount?: number | null;
  }> | null;
};

export type PendingCashVoidContext = {
  cashAffectingCount: number;
  cashAdjustmentCount: number;
  cashAdjustmentDelta: number;
  cashAmount: number;
  expectedCashAfterApproval?: number;
  expectedCashDelta: number;
};

export function getPendingCashVoidContext(args: {
  expectedCash?: number | null;
  pendingVoidApprovals?: PendingCashVoidApprovalInput | null;
}): PendingCashVoidContext | null {
  const pendingVoidApprovals = args.pendingVoidApprovals;
  const cashAmount = Math.max(0, pendingVoidApprovals?.cashAmount ?? 0);
  const cashAdjustmentDelta = pendingVoidApprovals?.cashAdjustmentDelta ?? 0;
  const cashAdjustmentCount =
    pendingVoidApprovals?.cashAdjustmentCount ??
    (cashAdjustmentDelta !== 0 ? 1 : 0);
  const cashAffectingCount =
    pendingVoidApprovals?.cashAffectingCount ??
    pendingVoidApprovals?.items?.filter(
      (item) => (item.cashAmount ?? 0) > 0,
    ).length ??
    0;
  const expectedCashDelta = cashAdjustmentDelta - cashAmount;

  if (
    cashAmount <= 0 &&
    cashAffectingCount <= 0 &&
    cashAdjustmentDelta === 0
  ) {
    return null;
  }

  return {
    cashAffectingCount,
    cashAdjustmentCount,
    cashAdjustmentDelta,
    cashAmount,
    expectedCashDelta,
    expectedCashAfterApproval:
      typeof args.expectedCash === "number"
        ? Math.max(0, args.expectedCash + expectedCashDelta)
        : undefined,
  };
}

export function formatPendingCashVoidNotice(args: {
  context: PendingCashVoidContext;
  formatAmount: (amount: number) => string;
}) {
  const pendingVoidText =
    args.context.cashAffectingCount === 1
      ? "1 pending cash void"
      : `${args.context.cashAffectingCount} pending cash voids`;
  const adjustmentText =
    args.context.cashAdjustmentCount === 1
      ? "1 pending cash item adjustment"
      : `${args.context.cashAdjustmentCount} pending cash item adjustments`;
  const adjustmentDirection =
    args.context.cashAdjustmentDelta > 0 ? "increasing" : "reducing";
  const parts: string[] = [];

  if (args.context.cashAffectingCount > 0 && args.context.cashAmount > 0) {
    parts.push(
      `${pendingVoidText} totaling ${args.formatAmount(args.context.cashAmount)}`,
    );
  }
  if (args.context.cashAdjustmentCount > 0) {
    parts.push(
      `${adjustmentText} ${adjustmentDirection} cash by ${args.formatAmount(Math.abs(args.context.cashAdjustmentDelta))}`,
    );
  }

  return `After adjustments applies ${parts.join(" and ")}.`;
}
