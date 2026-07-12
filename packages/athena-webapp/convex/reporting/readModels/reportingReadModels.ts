export type ReportingAggregateRow = {
  categoryId?: string;
  productId?: string;
  productSkuId: string;
  metric: string;
  value: number;
};

export function summarizeMetricRows(
  rows: Array<{ knownValue?: number; metric: string }>,
) {
  return Object.fromEntries(
    rows.map((row) => [row.metric, row.knownValue ?? null]),
  ) as Record<string, number | null>;
}

export function buildReportingRollups(rows: ReportingAggregateRow[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    for (const [dimension, dimensionId] of [
      ["category", row.categoryId],
      ["product", row.productId],
    ] as const) {
      if (!dimensionId) continue;
      const key = `${dimension}|${dimensionId}|${row.metric}`;
      totals.set(key, (totals.get(key) ?? 0) + row.value);
    }
  }
  return [...totals.entries()]
    .map(([key, value]) => {
      const [dimension, dimensionId, metric] = key.split("|");
      return { dimension, dimensionId, metric, value };
    })
    .sort((a, b) =>
      `${a.dimension}|${a.dimensionId}|${a.metric}`.localeCompare(
        `${b.dimension}|${b.dimensionId}|${b.metric}`,
      ),
    );
}

export function buildReportingFacets(
  rows: Array<{ classifications: string[]; productSkuId: string }>,
) {
  const facets: Record<string, number> = { all: rows.length };
  for (const row of rows) {
    for (const classification of new Set(row.classifications)) {
      facets[classification] = (facets[classification] ?? 0) + 1;
    }
  }
  return facets;
}

export function buildCursorContextKey(input: {
  contractVersions: string;
  filter: string;
  generationIds: string[];
  pageKind: string;
  period: string;
  sort: string;
  stableWatermarks: number[];
  storeId: string;
}) {
  return [
    input.storeId,
    input.pageKind,
    input.period,
    input.filter,
    input.sort,
    input.contractVersions,
    [...input.generationIds].sort().join(","),
    [...input.stableWatermarks].sort((a, b) => a - b).join(","),
  ].join("|");
}

type ReportingCursorEnvelope = {
  contextKey: string;
  cursor: string;
  version: 1;
};

export function encodeReportingCursor(input: ReportingCursorEnvelope) {
  return encodeURIComponent(JSON.stringify(input));
}

export function decodeReportingCursor(
  encoded: string,
  expectedContextKey: string,
) {
  let envelope: ReportingCursorEnvelope;
  try {
    envelope = JSON.parse(decodeURIComponent(encoded)) as ReportingCursorEnvelope;
  } catch {
    throw new Error("Reports page cursor is invalid");
  }
  if (
    envelope.version !== 1 ||
    typeof envelope.cursor !== "string" ||
    envelope.contextKey !== expectedContextKey
  ) {
    throw new Error("Reports page cursor does not match this report view");
  }
  return envelope.cursor;
}

export function classifySkuSummary(input: {
  activeDays: number;
  marginBasisPoints?: number;
  netRevenueMinor: number;
  netSoldUnits: number;
  projectedDaysOfCover?: number;
}) {
  const classifications: string[] = [];
  if (input.activeDays >= 7 && input.netSoldUnits >= 3) {
    classifications.push("fast_mover");
  } else if (input.netSoldUnits <= 0) {
    classifications.push("nonmoving");
  } else {
    classifications.push("slow_mover");
  }
  if (input.projectedDaysOfCover !== undefined && input.projectedDaysOfCover <= 7) {
    classifications.push("low_cover");
  }
  if (input.netRevenueMinor > 0 && (input.marginBasisPoints ?? Infinity) < 2_000) {
    classifications.push("high_revenue_low_margin");
  }
  return classifications;
}
