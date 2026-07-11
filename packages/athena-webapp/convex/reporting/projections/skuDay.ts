export type SkuDayFact = {
  canonicalSkuId: string;
  cogsKnownMinor: number | null;
  factId: string;
  netRevenueMinor: number;
  originalSkuReference: string;
  quantity: number;
  returnedQuantity: number;
};

export function buildSkuDayProjection(input: {
  activeDays: number;
  facts: SkuDayFact[];
  generationId: string;
  onHandQuantity: number;
  operatingDate: string;
  skuId: string;
  storeId: string;
  scheduleVersionId?: string | null;
  historicalInterpretationPolicyId?: string | null;
  historicalInterpretationPolicyHash?: string | null;
}) {
  const hasSchedule = input.scheduleVersionId != null;
  const hasPolicy = input.historicalInterpretationPolicyId != null;
  if (hasSchedule !== hasPolicy && hasPolicy && !input.historicalInterpretationPolicyHash) {
    throw new Error("Historical policy lineage requires its immutable hash");
  }
  if ((hasSchedule || hasPolicy) && hasSchedule === hasPolicy) {
    throw new Error("SKU-day projection requires exactly one period lineage");
  }
  let netRevenueMinor = 0;
  let knownCogsMinor = 0;
  let netSoldUnits = 0;
  let returnedUnits = 0;
  let hasUnknownCost = false;
  let hasKnownCost = false;

  for (const fact of input.facts) {
    if (fact.canonicalSkuId !== input.skuId) {
      throw new Error("fact canonical SKU does not match projection SKU");
    }
    netRevenueMinor += fact.netRevenueMinor;
    netSoldUnits += fact.quantity - fact.returnedQuantity;
    returnedUnits += fact.returnedQuantity;
    if (fact.cogsKnownMinor === null) {
      hasUnknownCost = true;
    } else {
      hasKnownCost = true;
      knownCogsMinor += fact.cogsKnownMinor;
    }
  }

  const velocitySufficient = input.activeDays >= 7 && netSoldUnits >= 3;
  const averageUnitsPerActiveDay = velocitySufficient
    ? netSoldUnits / input.activeDays
    : null;
  const projectedDaysOfCover =
    averageUnitsPerActiveDay && averageUnitsPerActiveDay > 0
      ? Math.floor(input.onHandQuantity / averageUnitsPerActiveDay)
      : null;

  return {
    averageUnitsPerActiveDay,
    canonicalSkuId: input.skuId,
    costStatus: hasUnknownCost
      ? hasKnownCost
        ? ("partial" as const)
        : ("unknown" as const)
      : ("known" as const),
    evidenceFactIds: input.facts.map((fact) => fact.factId).sort(),
    generationId: input.generationId,
    knownCogsMinor,
    netRevenueMinor,
    netSoldUnits,
    onHandQuantity: input.onHandQuantity,
    operatingDate: input.operatingDate,
    scheduleVersionId: input.scheduleVersionId ?? null,
    historicalInterpretationPolicyId:
      input.historicalInterpretationPolicyId ?? null,
    historicalInterpretationPolicyHash:
      input.historicalInterpretationPolicyHash ?? null,
    originalSkuReferences: Array.from(
      new Set(input.facts.map((fact) => fact.originalSkuReference)),
    ).sort(),
    projectedDaysOfCover,
    returnedUnits,
    storeId: input.storeId,
    velocitySufficient,
  };
}
