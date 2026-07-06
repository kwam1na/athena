import type { AutomationDecisionEvidence } from "../../automation/runLedger";

const EOD_AUTO_COMPLETE_LOW_RISK_REVIEW_CATEGORIES = new Set([
  "cash_variance",
  "voided_sale",
]);

type EodAutoCompletePolicy = {
  cleanDayAutoCompleteEnabled: boolean;
  maxAbsoluteCashVariance: number;
  maxVoidedSaleCount: number;
  maxVoidedSaleTotal: number;
};

type AutomationScheduleEvidence = {
  closedAt?: number;
  evaluationAt?: number;
  openedAt?: number;
  scheduleVersion?: string;
  source: "canonical_schedule" | "compatibility_policy";
  storeScheduleId?: string;
};

type DailyCloseAutomationItem = {
  category: string;
  key: string;
  metadata?: Record<string, unknown>;
};

type DailyCloseAutomationSnapshot = {
  blockers: DailyCloseAutomationItem[];
  carryForwardItems: DailyCloseAutomationItem[];
  readiness: {
    blockerCount: number;
    carryForwardCount: number;
    reviewCount: number;
  };
  reviewItems: DailyCloseAutomationItem[];
  summary: {
    netCashVariance: number;
    voidedTransactionCount: number;
  };
};

function numberFromMetadata(
  record: Record<string, unknown> | undefined,
  key: string,
) {
  const value = record?.[key];

  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function buildEodAutomationDecisionEvidence(args: {
  automationScheduleEvidence?: AutomationScheduleEvidence;
  classification: string;
  eligible: boolean;
  policy: EodAutoCompletePolicy;
  snapshot: DailyCloseAutomationSnapshot;
}): AutomationDecisionEvidence {
  const voidedSaleTotal = args.snapshot.reviewItems
    .filter((item) => item.category === "voided_sale")
    .reduce((sum, item) => sum + numberFromMetadata(item.metadata, "total"), 0);
  const disqualifyingCategories = Array.from(
    new Set([
      ...args.snapshot.blockers.map((item) => item.category),
      ...args.snapshot.reviewItems
        .map((item) => item.category)
        .filter(
          (category) =>
            !EOD_AUTO_COMPLETE_LOW_RISK_REVIEW_CATEGORIES.has(category),
        ),
    ]),
  ).sort();

  return {
    kind: "eod_auto_complete",
    classification: args.classification,
    eligible: args.eligible,
    observed: {
      absoluteCashVariance: Math.abs(args.snapshot.summary.netCashVariance),
      blockerCount: args.snapshot.readiness.blockerCount,
      carryForwardCount: args.snapshot.readiness.carryForwardCount,
      carryForwardItemKeys: args.snapshot.carryForwardItems.map(
        (item) => item.key,
      ),
      carryForwardPreserved:
        args.snapshot.carryForwardItems.length > 0 ||
        args.snapshot.readiness.carryForwardCount > 0,
      disqualifyingCategories,
      reviewCount: args.snapshot.readiness.reviewCount,
      ...(args.automationScheduleEvidence
        ? {
            scheduleEvidenceSource: args.automationScheduleEvidence.source,
            ...(args.automationScheduleEvidence.storeScheduleId
              ? {
                  storeScheduleId:
                    args.automationScheduleEvidence.storeScheduleId,
                }
              : {}),
            ...(args.automationScheduleEvidence.scheduleVersion
              ? {
                  scheduleVersion:
                    args.automationScheduleEvidence.scheduleVersion,
                }
              : {}),
            ...(typeof args.automationScheduleEvidence.openedAt === "number"
              ? { scheduleOpenedAt: args.automationScheduleEvidence.openedAt }
              : {}),
            ...(typeof args.automationScheduleEvidence.closedAt === "number"
              ? { scheduleClosedAt: args.automationScheduleEvidence.closedAt }
              : {}),
            ...(typeof args.automationScheduleEvidence.evaluationAt === "number"
              ? {
                  scheduleEvaluationAt:
                    args.automationScheduleEvidence.evaluationAt,
                }
              : {}),
          }
        : {}),
      voidedSaleCount: args.snapshot.summary.voidedTransactionCount,
      voidedSaleTotal,
    },
    policy: {
      cleanDayAutoCompleteEnabled: args.policy.cleanDayAutoCompleteEnabled,
      maxAbsoluteCashVariance: args.policy.maxAbsoluteCashVariance,
      maxVoidedSaleCount: args.policy.maxVoidedSaleCount,
      maxVoidedSaleTotal: args.policy.maxVoidedSaleTotal,
    },
  };
}

export function validateEodAutomationPolicyForSnapshot(args: {
  policy: EodAutoCompletePolicy;
  reviewedItemKeys: Set<string>;
  snapshot: DailyCloseAutomationSnapshot;
}):
  | null
  | {
      classification: string;
      message: string;
      metadata: Record<string, unknown>;
    } {
  const unsupportedReviewCategories = Array.from(
    new Set(
      args.snapshot.reviewItems
        .map((item) => item.category)
        .filter(
          (category) =>
            !EOD_AUTO_COMPLETE_LOW_RISK_REVIEW_CATEGORIES.has(category),
        ),
    ),
  );
  const disqualifyingCategories = Array.from(
    new Set([
      ...args.snapshot.blockers.map((item) => item.category),
      ...unsupportedReviewCategories,
    ]),
  ).sort();

  if (disqualifyingCategories.length > 0) {
    return {
      classification: "blocked",
      message:
        "EOD Review automation cannot complete while blockers or unsupported review evidence remain.",
      metadata: { disqualifyingCategories },
    };
  }

  if (args.snapshot.reviewItems.length === 0) {
    return args.policy.cleanDayAutoCompleteEnabled
      ? null
      : {
          classification: "clean_day",
          message:
            "EOD Review automation cannot complete clean days while clean-day auto-complete is disabled.",
          metadata: { cleanDayAutoCompleteEnabled: false },
        };
  }

  const unreviewedItemKeys = args.snapshot.reviewItems
    .map((item) => item.key)
    .filter((key) => !args.reviewedItemKeys.has(key));

  if (unreviewedItemKeys.length > 0) {
    return {
      classification: "review_unreviewed",
      message:
        "EOD Review automation cannot complete while review items are unreviewed by policy.",
      metadata: {
        reviewItemCount: args.snapshot.reviewItems.length,
        unreviewedItemKeys,
      },
    };
  }

  const absoluteCashVariance = Math.abs(args.snapshot.summary.netCashVariance);
  const voidedSaleTotal = args.snapshot.reviewItems
    .filter((item) => item.category === "voided_sale")
    .reduce((sum, item) => sum + numberFromMetadata(item.metadata, "total"), 0);
  const thresholdFailures = [
    absoluteCashVariance > args.policy.maxAbsoluteCashVariance
      ? "absolute_cash_variance"
      : null,
    args.snapshot.summary.voidedTransactionCount >
    args.policy.maxVoidedSaleCount
      ? "voided_sale_count"
      : null,
    voidedSaleTotal > args.policy.maxVoidedSaleTotal
      ? "voided_sale_total"
      : null,
  ].filter(Boolean);

  return thresholdFailures.length === 0
    ? null
    : {
        classification: "review_threshold_exceeded",
        message:
          "EOD Review automation cannot complete while review evidence exceeds policy thresholds.",
        metadata: {
          absoluteCashVariance,
          thresholdFailures,
          voidedSaleCount: args.snapshot.summary.voidedTransactionCount,
          voidedSaleTotal,
        },
      };
}
