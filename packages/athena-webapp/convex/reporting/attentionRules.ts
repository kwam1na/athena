export const REPORTING_ATTENTION_RULE_VERSION = 2 as const;

export type ReportingAttentionCode =
  | "source_integrity"
  | "missing_cost"
  | "refund_void_correction"
  | "late_inbound"
  | "short_receipt"
  | "missing_inbound_cover"
  | "low_cover"
  | "cash_variance";

export type ReportingAttentionRoute =
  | "terminal_health"
  | "product_edit"
  | "sku_activity"
  | "transactions"
  | "procurement"
  | "cash_controls";

export type ReportingAttentionReason = {
  code: ReportingAttentionCode;
  inputs: Record<string, number | boolean | string | null>;
  limitation: string | null;
  route: ReportingAttentionRoute;
  ruleVersion: typeof REPORTING_ATTENTION_RULE_VERSION;
  threshold: Record<string, number | boolean>;
};

export type ReportingAttentionInput = {
  activeDays: number;
  acceptedCloudLagMs?: number;
  cashVarianceMinor?: number;
  completenessLimitation?: string;
  confirmedInboundQuantity: number;
  expectedInboundAt?: number;
  grossRecognizedSalesMinor: number;
  hasFailedOrReviewActivity?: boolean;
  netSoldUnits: number;
  now: number;
  projectedDaysOfCover?: number | null;
  refundVoidCorrectionCount: number;
  refundVoidCorrectionMinor: number;
  requiredSourceCoverageComplete: boolean;
  shortReceipt?: boolean;
  skuId?: string;
  uncostedEligibleRevenueMinor: number;
  uncostedOnHandQuantity: number;
};

const FIVE_MINUTES_MS = 5 * 60_000;
const MINIMUM_ACTIVE_DAYS = 7;
const MINIMUM_NET_SOLD_UNITS = 3;
const LOW_COVER_DAYS = 7;
const TARGET_INBOUND_COVER_DAYS = 14;
const REFUND_RATE_BASIS_POINTS = 500;
const REFUND_EVENT_COUNT = 3;

const SKU_PRECEDENCE: ReportingAttentionCode[] = [
  "source_integrity",
  "missing_cost",
  "refund_void_correction",
  "late_inbound",
  "short_receipt",
  "missing_inbound_cover",
  "low_cover",
];

function reason(
  code: ReportingAttentionCode,
  route: ReportingAttentionRoute,
  inputs: ReportingAttentionReason["inputs"],
  threshold: ReportingAttentionReason["threshold"],
  limitation: string | null = null,
): ReportingAttentionReason {
  return {
    code,
    inputs,
    limitation,
    route,
    ruleVersion: REPORTING_ATTENTION_RULE_VERSION,
    threshold,
  };
}

export function evaluateAttention(input: ReportingAttentionInput) {
  const reasons: ReportingAttentionReason[] = [];
  const storeReasons: ReportingAttentionReason[] = [];
  const sourceIntegrity =
    !input.requiredSourceCoverageComplete ||
    (input.acceptedCloudLagMs ?? 0) > FIVE_MINUTES_MS ||
    input.hasFailedOrReviewActivity === true;

  if (sourceIntegrity) {
    reasons.push(
      reason(
        "source_integrity",
        "terminal_health",
        {
          acceptedCloudLagMs: input.acceptedCloudLagMs ?? 0,
          hasFailedOrReviewActivity: input.hasFailedOrReviewActivity ?? false,
          requiredSourceCoverageComplete:
            input.requiredSourceCoverageComplete,
        },
        {
          acceptedCloudLagMs: FIVE_MINUTES_MS,
          requiredSourceCoverageComplete: true,
        },
        "Unified metrics cannot be certified while a required source is stale or incomplete.",
      ),
    );
  }

  if (
    input.uncostedOnHandQuantity > 0 ||
    input.uncostedEligibleRevenueMinor > 0
  ) {
    reasons.push(
      reason(
        "missing_cost",
        "product_edit",
        {
          skuId: input.skuId ?? null,
          uncostedEligibleRevenueMinor: input.uncostedEligibleRevenueMinor,
          uncostedOnHandQuantity: input.uncostedOnHandQuantity,
        },
        { uncostedQuantityOrRevenueGreaterThan: 0 },
        "Profit and inventory value remain partial until cost evidence is confirmed.",
      ),
    );
  }

  const refundRateBasisPoints =
    input.grossRecognizedSalesMinor > 0
      ? Math.floor(
          (Math.abs(input.refundVoidCorrectionMinor) * 10_000) /
            input.grossRecognizedSalesMinor,
        )
      : 0;
  if (
    (input.requiredSourceCoverageComplete &&
      refundRateBasisPoints >= REFUND_RATE_BASIS_POINTS) ||
    input.refundVoidCorrectionCount >= REFUND_EVENT_COUNT
  ) {
    reasons.push(
      reason(
        "refund_void_correction",
        "transactions",
        {
          eventCount: input.refundVoidCorrectionCount,
          grossRecognizedSalesMinor: input.grossRecognizedSalesMinor,
          refundRateBasisPoints,
          valueMinor: input.refundVoidCorrectionMinor,
        },
        {
          eventCount: REFUND_EVENT_COUNT,
          refundRateBasisPoints: REFUND_RATE_BASIS_POINTS,
        },
        input.completenessLimitation ?? null,
      ),
    );
  }

  if (
    input.expectedInboundAt !== undefined &&
    input.expectedInboundAt < input.now &&
    input.confirmedInboundQuantity > 0
  ) {
    reasons.push(
      reason(
        "late_inbound",
        "procurement",
        {
          confirmedInboundQuantity: input.confirmedInboundQuantity,
          expectedInboundAt: input.expectedInboundAt,
          now: input.now,
        },
        { expectedBeforeNow: true },
        input.completenessLimitation ?? null,
      ),
    );
  }

  if (input.shortReceipt) {
    reasons.push(
      reason(
        "short_receipt",
        "procurement",
        { shortReceipt: true },
        { completedBelowConfirmedQuantity: true },
        input.completenessLimitation ?? null,
      ),
    );
  }

  const hasVelocityEvidence =
    input.activeDays >= MINIMUM_ACTIVE_DAYS &&
    input.netSoldUnits >= MINIMUM_NET_SOLD_UNITS;
  const isLowCover =
    input.requiredSourceCoverageComplete &&
    hasVelocityEvidence &&
    input.projectedDaysOfCover !== undefined &&
    input.projectedDaysOfCover !== null &&
    input.projectedDaysOfCover <= LOW_COVER_DAYS;
  const unitsPerActiveDay =
    input.activeDays > 0 ? input.netSoldUnits / input.activeDays : 0;
  const targetInboundQuantity = Math.ceil(
    unitsPerActiveDay * TARGET_INBOUND_COVER_DAYS,
  );

  if (
    isLowCover &&
    input.confirmedInboundQuantity < targetInboundQuantity
  ) {
    reasons.push(
      reason(
        "missing_inbound_cover",
        "procurement",
        {
          confirmedInboundQuantity: input.confirmedInboundQuantity,
          targetInboundQuantity,
        },
        { targetInboundCoverDays: TARGET_INBOUND_COVER_DAYS },
      ),
    );
  }

  if (isLowCover) {
    reasons.push(
      reason(
        "low_cover",
        "procurement",
        {
          activeDays: input.activeDays,
          netSoldUnits: input.netSoldUnits,
          projectedDaysOfCover: input.projectedDaysOfCover ?? null,
        },
        {
          activeDays: MINIMUM_ACTIVE_DAYS,
          daysOfCover: LOW_COVER_DAYS,
          netSoldUnits: MINIMUM_NET_SOLD_UNITS,
        },
      ),
    );
  }

  if ((input.cashVarianceMinor ?? 0) !== 0) {
    storeReasons.push(
      reason(
        "cash_variance",
        "cash_controls",
        { cashVarianceMinor: input.cashVarianceMinor ?? 0 },
        { unresolvedNonzeroVariance: true },
        input.completenessLimitation ?? null,
      ),
    );
  }

  reasons.sort(
    (left, right) =>
      SKU_PRECEDENCE.indexOf(left.code) - SKU_PRECEDENCE.indexOf(right.code),
  );

  return {
    primaryReason: reasons[0]?.code ?? null,
    reasons,
    storeReasons,
  };
}
