export type VerifiedDailyRangeInput = {
  currency: string;
  knownCogsMinor: number;
  netRevenueMinor: number;
  operatingDate: string;
  status: "verified" | "building" | "failed";
  uncoveredMerchandiseRevenueMinor: number;
  unitsSold: number;
};

export function buildCustomRangeProjection(input: {
  days: VerifiedDailyRangeInput[];
  endOperatingDate: string;
  generationId: string;
  metricVersion: number;
  sourceWatermark: number;
  startOperatingDate: string;
  storeId: string;
}) {
  if (input.startOperatingDate > input.endOperatingDate) {
    throw new Error("invalid custom range");
  }
  for (const day of input.days) {
    if (day.status !== "verified") {
      throw new Error("daily projection is not verified");
    }
    if (
      day.operatingDate < input.startOperatingDate ||
      day.operatingDate > input.endOperatingDate
    ) {
      throw new Error("daily projection falls outside requested range");
    }
  }
  const currencies = new Set(input.days.map((day) => day.currency));
  if (currencies.size > 1) {
    throw new Error("mixed currencies cannot be combined");
  }
  const totals = input.days.reduce(
    (result, day) => ({
      knownCogsMinor: result.knownCogsMinor + day.knownCogsMinor,
      netRevenueMinor: result.netRevenueMinor + day.netRevenueMinor,
      uncoveredMerchandiseRevenueMinor:
        result.uncoveredMerchandiseRevenueMinor +
        day.uncoveredMerchandiseRevenueMinor,
      unitsSold: result.unitsSold + day.unitsSold,
    }),
    {
      knownCogsMinor: 0,
      netRevenueMinor: 0,
      uncoveredMerchandiseRevenueMinor: 0,
      unitsSold: 0,
    },
  );
  return {
    currency: input.days[0]?.currency ?? null,
    dayCount: input.days.length,
    endOperatingDate: input.endOperatingDate,
    generationId: input.generationId,
    metricVersion: input.metricVersion,
    sourceWatermark: input.sourceWatermark,
    startOperatingDate: input.startOperatingDate,
    status:
      totals.uncoveredMerchandiseRevenueMinor > 0
        ? ("partial" as const)
        : ("verified" as const),
    storeId: input.storeId,
    ...totals,
  };
}
