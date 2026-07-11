export type DailyProjectionFact = {
  channel: string;
  cogsKnownMinor: number | null;
  currency: string;
  eligibleMerchandiseRevenueMinor: number;
  factId: string;
  grossRevenueMinor: number;
  netRevenueMinor: number;
  quantity: number;
  recognizedAt: number;
  returnedQuantity: number;
};

export type DailyProjectionInput = {
  factVersion: number;
  facts: DailyProjectionFact[];
  generationId: string;
  metricVersion: number;
  operatingDate: string;
  scheduleVersionId: string | null;
  historicalInterpretationPolicyId?: string | null;
  historicalInterpretationPolicyHash?: string | null;
  sourceWatermark: number;
  storeId: string;
};

type CurrencySegment = {
  currency: string;
  eligibleMerchandiseRevenueMinor: number;
  grossRevenueMinor: number;
  knownCogsMinor: number;
  netRevenueMinor: number;
  uncoveredMerchandiseRevenueMinor: number;
};

function integer(value: number, name: string) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer`);
  }
  return value;
}

export function buildDailyProjection(input: DailyProjectionInput) {
  const hasSchedule = input.scheduleVersionId !== null;
  const hasPolicy = input.historicalInterpretationPolicyId != null;
  if (hasSchedule === hasPolicy) {
    throw new Error("Daily projection requires exactly one period lineage");
  }
  if (hasPolicy && !input.historicalInterpretationPolicyHash) {
    throw new Error("Historical policy lineage requires its immutable hash");
  }
  const segments = new Map<string, CurrencySegment>();
  let unitsSold = 0;
  let unitsReturned = 0;
  let lastRecognizedAt = 0;

  for (const fact of input.facts) {
    const segment = segments.get(fact.currency) ?? {
      currency: fact.currency,
      eligibleMerchandiseRevenueMinor: 0,
      grossRevenueMinor: 0,
      knownCogsMinor: 0,
      netRevenueMinor: 0,
      uncoveredMerchandiseRevenueMinor: 0,
    };
    segment.grossRevenueMinor = integer(
      segment.grossRevenueMinor + fact.grossRevenueMinor,
      "gross revenue",
    );
    segment.netRevenueMinor = integer(
      segment.netRevenueMinor + fact.netRevenueMinor,
      "net revenue",
    );
    segment.eligibleMerchandiseRevenueMinor = integer(
      segment.eligibleMerchandiseRevenueMinor +
        fact.eligibleMerchandiseRevenueMinor,
      "eligible merchandise revenue",
    );
    if (fact.cogsKnownMinor === null) {
      segment.uncoveredMerchandiseRevenueMinor = integer(
        segment.uncoveredMerchandiseRevenueMinor +
          fact.eligibleMerchandiseRevenueMinor,
        "uncovered merchandise revenue",
      );
    } else {
      segment.knownCogsMinor = integer(
        segment.knownCogsMinor + fact.cogsKnownMinor,
        "known COGS",
      );
    }
    segments.set(fact.currency, segment);
    unitsSold = integer(unitsSold + fact.quantity, "units sold");
    unitsReturned = integer(
      unitsReturned + fact.returnedQuantity,
      "units returned",
    );
    lastRecognizedAt = Math.max(lastRecognizedAt, fact.recognizedAt);
  }

  const currencySegments = Array.from(segments.values()).sort((left, right) =>
    left.currency.localeCompare(right.currency),
  );
  const oneCurrency = currencySegments.length <= 1;
  const segment = oneCurrency ? currencySegments[0] : undefined;
  const eligibleRevenue = segment?.eligibleMerchandiseRevenueMinor ?? 0;
  const uncoveredRevenue = segment?.uncoveredMerchandiseRevenueMinor ?? 0;
  const coveredRevenue = eligibleRevenue - uncoveredRevenue;
  const knownCogs = segment?.knownCogsMinor ?? 0;

  return {
    costCoverageBasisPoints:
      oneCurrency && eligibleRevenue > 0
        ? Math.floor((coveredRevenue * 10_000) / eligibleRevenue)
        : oneCurrency
          ? 10_000
          : null,
    currency: oneCurrency ? (segment?.currency ?? null) : null,
    currencySegments,
    factCount: input.facts.length,
    factVersion: input.factVersion,
    generationId: input.generationId,
    grossRevenueMinor: oneCurrency ? (segment?.grossRevenueMinor ?? 0) : null,
    knownCogsMinor: oneCurrency ? knownCogs : null,
    knownGrossProfitMinor: oneCurrency ? coveredRevenue - knownCogs : null,
    lastRecognizedAt,
    metricVersion: input.metricVersion,
    netRevenueMinor: oneCurrency ? (segment?.netRevenueMinor ?? 0) : null,
    operatingDate: input.operatingDate,
    scheduleVersionId: input.scheduleVersionId,
    historicalInterpretationPolicyId:
      input.historicalInterpretationPolicyId ?? null,
    historicalInterpretationPolicyHash:
      input.historicalInterpretationPolicyHash ?? null,
    sourceWatermark: input.sourceWatermark,
    status: !oneCurrency
      ? ("incompatible" as const)
      : uncoveredRevenue > 0
        ? ("partial" as const)
        : ("complete" as const),
    storeId: input.storeId,
    uncoveredMerchandiseRevenueMinor: oneCurrency ? uncoveredRevenue : null,
    unitsReturned,
    unitsSold,
  };
}
