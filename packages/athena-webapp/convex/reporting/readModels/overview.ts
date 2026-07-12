import { summarizeMetricRows } from "./reportingReadModels";

export function buildOverviewReadModel(input: {
  comparisonRows: Array<{ knownValue?: number; metric: string }>;
  currentRows: Array<{ knownValue?: number; metric: string }>;
  dailyCloseTrust: unknown[];
}) {
  return {
    comparison: summarizeMetricRows(input.comparisonRows),
    current: summarizeMetricRows(input.currentRows),
    dailyCloseTrust: input.dailyCloseTrust,
  };
}
