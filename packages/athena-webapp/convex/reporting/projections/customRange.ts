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

export function buildCustomRangeResultFamilies(input: {
  skuRows: Array<{
    categoryId?: string;
    metric: string;
    productId?: string;
    productSkuId: string;
    value: number;
  }>;
}) {
  const overview = new Map<string, number>();
  const sku = new Map<string, number>();
  const rollups = new Map<string, number>();
  for (const row of input.skuRows) {
    overview.set(row.metric, (overview.get(row.metric) ?? 0) + row.value);
    sku.set(`${row.productSkuId}|${row.metric}`, (sku.get(`${row.productSkuId}|${row.metric}`) ?? 0) + row.value);
    for (const [family, id] of [["product_rollup", row.productId], ["category_rollup", row.categoryId]] as const) {
      if (!id) continue;
      const key = `${family}|${id}|${row.metric}`;
      rollups.set(key, (rollups.get(key) ?? 0) + row.value);
    }
  }
  const present = (family: string, values: Map<string, number>) =>
    [...values].map(([resultKey, value]) => ({ family, resultKey, value }));
  return {
    overview: present("overview", overview),
    sku: present("sku", sku),
    rollups: [...rollups].map(([key, value]) => {
      const [family, id, metric] = key.split("|");
      return { family, resultKey: `${id}|${metric}`, value };
    }),
  };
}
