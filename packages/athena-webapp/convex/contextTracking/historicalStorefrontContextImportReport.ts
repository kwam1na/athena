import {
  buildHistoricalStorefrontContextImportRunKey,
  planHistoricalStorefrontContextImport,
  type HistoricalStorefrontImportInput,
  type HistoricalStorefrontImportReport,
} from "./historicalStorefrontContextImport";

export function buildHistoricalStorefrontContextImportReport(
  input: Omit<HistoricalStorefrontImportInput, "mode" | "importRunId"> & {
    importRunId?: string;
  },
): HistoricalStorefrontImportReport {
  return planHistoricalStorefrontContextImport({
    ...input,
    mode: "dry_run",
    importRunId:
      input.importRunId ??
      buildHistoricalStorefrontContextImportRunKey({
        storeId: String(input.storeId),
        windowStartAt: input.windowStartAt,
        windowEndAt: input.windowEndAt,
      }),
  }).report;
}
