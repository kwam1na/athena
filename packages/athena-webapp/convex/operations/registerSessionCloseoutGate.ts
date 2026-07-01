export const DEFAULT_VARIANCE_APPROVAL_THRESHOLD = 5000;

export type CashControlsConfig = {
  requireManagerSignoffForAnyVariance: boolean;
  requireManagerSignoffForOvers: boolean;
  requireManagerSignoffForShorts: boolean;
  varianceApprovalThreshold: number;
};

export type RegisterSessionCloseoutReview = {
  hasVariance: boolean;
  reason?: string;
  requiresApproval: boolean;
  variance: number;
};

export type RegisterSessionCloseoutReviewFacts = {
  countedCash: number;
  expectedCash: number;
  localEventId: string;
  localRegisterSessionId?: string;
  notes?: string;
  terminalId: string;
  variance: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

export function getCashControlsConfig(store?: {
  config?: unknown;
} | null): CashControlsConfig {
  const operations = asRecord(asRecord(store?.config).operations);
  const cashControls = asRecord(operations.cashControls);
  const threshold = asNumber(cashControls.varianceApprovalThreshold);

  return {
    requireManagerSignoffForAnyVariance:
      asBoolean(cashControls.requireManagerSignoffForAnyVariance) ?? false,
    requireManagerSignoffForOvers:
      asBoolean(cashControls.requireManagerSignoffForOvers) ?? false,
    requireManagerSignoffForShorts:
      asBoolean(cashControls.requireManagerSignoffForShorts) ?? false,
    varianceApprovalThreshold: Math.max(
      0,
      threshold ?? DEFAULT_VARIANCE_APPROVAL_THRESHOLD,
    ),
  };
}

export function buildRegisterSessionCloseoutReview(args: {
  countedCash: number;
  expectedCash: number;
  config: CashControlsConfig;
}): RegisterSessionCloseoutReview {
  const roundedVariance = Math.round(args.countedCash - args.expectedCash);
  const variance = Object.is(roundedVariance, -0) ? 0 : roundedVariance;
  const hasVariance = variance !== 0;
  const isOver = variance > 0;
  const isShort = variance < 0;
  const exceedsThreshold =
    Math.abs(variance) > args.config.varianceApprovalThreshold;
  const requiresApproval =
    (hasVariance && args.config.requireManagerSignoffForAnyVariance) ||
    (isOver && args.config.requireManagerSignoffForOvers) ||
    (isShort && args.config.requireManagerSignoffForShorts) ||
    exceedsThreshold;

  if (!requiresApproval) {
    return {
      hasVariance,
      reason: undefined,
      requiresApproval: false,
      variance,
    };
  }

  if (exceedsThreshold) {
    return {
      hasVariance,
      reason: `Variance of ${variance} exceeded the closeout approval threshold.`,
      requiresApproval: true,
      variance,
    };
  }

  if (args.config.requireManagerSignoffForAnyVariance) {
    return {
      hasVariance,
      reason: `Manager signoff is required for any register variance (${variance}).`,
      requiresApproval: true,
      variance,
    };
  }

  return {
    hasVariance,
    reason: isOver
      ? `Manager signoff is required for register overages (${variance}).`
      : `Manager signoff is required for register shortages (${variance}).`,
    requiresApproval: true,
    variance,
  };
}

export function areRegisterSessionCloseoutReviewFactsEquivalent(
  metadata: unknown,
  facts: RegisterSessionCloseoutReviewFacts,
) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }

  const record = metadata as Record<string, unknown>;
  return (
    record.countedCash === facts.countedCash &&
    record.expectedCash === facts.expectedCash &&
    record.variance === facts.variance &&
    record.notes === facts.notes &&
    record.localEventId === facts.localEventId &&
    record.localRegisterSessionId === facts.localRegisterSessionId &&
    record.terminalId === facts.terminalId
  );
}
