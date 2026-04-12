import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  HarnessBehaviorPhase,
  HarnessBehaviorScenarioReport,
} from "./harness-behavior";

const DEFAULT_OUTPUT_PATH = "artifacts/harness-behavior/trends/latest.json";
const CANONICAL_PHASES: HarnessBehaviorPhase[] = [
  "boot",
  "readiness",
  "browser",
  "runtime",
  "assertion",
  "cleanup",
];
const REPORT_LINE_PATTERN = /^\[harness:behavior:report\]\s+(.+)$/;

type HarnessRuntimeTrendSeverity = "warning";
type HarnessRuntimeTrendKind =
  | "pass-rate"
  | "total-duration"
  | "phase-duration";

type HarnessRuntimeTrendThresholds = {
  minPassRate?: number;
  maxAverageTotalDurationMs?: number;
  maxAveragePhaseDurationMs?: Partial<Record<HarnessBehaviorPhase, number>>;
};

type HarnessRuntimeTrendLogger = Pick<Console, "log" | "error">;

type HarnessRuntimeTrendParseError = {
  lineNumber: number;
  message: string;
  rawLine: string;
};

type NumericTrendStats = {
  count: number;
  minMs: number | null;
  maxMs: number | null;
  averageMs: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
};

type HarnessRuntimeTrendPhaseStats = NumericTrendStats & {
  phase: HarnessBehaviorPhase | string;
};

type HarnessRuntimeTrendScenario = {
  scenarioName: string;
  reportCount: number;
  passCount: number;
  failCount: number;
  passRate: number;
  totalDurationMs: NumericTrendStats;
  phaseDurations: HarnessRuntimeTrendPhaseStats[];
  runtimeSignals: {
    totalCount: number;
    belowMinCount: number;
    aboveMaxCount: number;
    withinBoundsCount: number;
  };
  failurePhases: Array<{ phase: string; count: number }>;
  diagnostics: Array<{ type: string; count: number }>;
};

type HarnessRuntimeTrendRegression = {
  kind: HarnessRuntimeTrendKind;
  severity: HarnessRuntimeTrendSeverity;
  scenarioName: string;
  phase?: HarnessBehaviorPhase | string;
  observed: number;
  threshold: number;
  message: string;
};

type HarnessRuntimeTrendsOutput = {
  version: "1.0";
  generatedAt: string;
  parseErrors: HarnessRuntimeTrendParseError[];
  scenarios: HarnessRuntimeTrendScenario[];
  summary: {
    reportCount: number;
    scenarioCount: number;
    passCount: number;
    failCount: number;
    parseErrorCount: number;
    status: "healthy" | "mixed" | "degraded";
    note: string;
    regressions: HarnessRuntimeTrendRegression[];
  };
};

type HarnessRuntimeTrendOptions = {
  nowIso?: () => string;
  thresholds?: HarnessRuntimeTrendThresholds;
  logger?: HarnessRuntimeTrendLogger;
  persistHistory?: boolean;
};

type HarnessRuntimeTrendRunResult = {
  output: HarnessRuntimeTrendsOutput;
  outputPath: string;
};

function toHistoryFileStamp(generatedAt: string) {
  return generatedAt.replaceAll(":", "-").replaceAll(".", "-");
}

function splitInputLines(source: string | readonly string[]) {
  return typeof source === "string"
    ? source.split(/\r?\n/)
    : [...source];
}

function sortUnique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

function isHarnessBehaviorScenarioReport(
  value: unknown
): value is HarnessBehaviorScenarioReport {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as HarnessBehaviorScenarioReport;
  return (
    typeof candidate.scenarioName === "string" &&
    (candidate.status === "passed" || candidate.status === "failed") &&
    typeof candidate.totalDurationMs === "number" &&
    Array.isArray(candidate.phaseDurations) &&
    Array.isArray(candidate.runtimeSignals) &&
    Array.isArray(candidate.diagnostics)
  );
}

export function parseHarnessBehaviorReportLines(source: string | readonly string[]) {
  const lines = splitInputLines(source);
  const reports: HarnessBehaviorScenarioReport[] = [];
  const errors: HarnessRuntimeTrendParseError[] = [];

  lines.forEach((line, index) => {
    const match = line.match(REPORT_LINE_PATTERN);
    if (!match) {
      return;
    }

    const rawJson = match[1] ?? "";
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      if (!isHarnessBehaviorScenarioReport(parsed)) {
        errors.push({
          lineNumber: index + 1,
          message: "Parsed line did not match the harness behavior report schema.",
          rawLine: line,
        });
        return;
      }

      reports.push(parsed);
    } catch (error) {
      errors.push({
        lineNumber: index + 1,
        message:
          error instanceof Error
            ? error.message
            : "Unable to parse harness behavior report JSON.",
        rawLine: line,
      });
    }
  });

  return {
    reports,
    errors,
  };
}

function percentile(sortedValues: number[], percentileValue: number) {
  if (sortedValues.length === 0) {
    return null;
  }

  const clampedPercentile = Math.min(Math.max(percentileValue, 0), 1);
  const index = Math.ceil(clampedPercentile * sortedValues.length) - 1;
  const safeIndex = Math.min(Math.max(index, 0), sortedValues.length - 1);
  return sortedValues[safeIndex] ?? null;
}

function buildNumericTrendStats(values: number[]): NumericTrendStats {
  if (values.length === 0) {
    return {
      count: 0,
      minMs: null,
      maxMs: null,
      averageMs: null,
      p50Ms: null,
      p90Ms: null,
    };
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const total = sortedValues.reduce((sum, value) => sum + value, 0);

  return {
    count: sortedValues.length,
    minMs: sortedValues[0] ?? null,
    maxMs: sortedValues[sortedValues.length - 1] ?? null,
    averageMs: total / sortedValues.length,
    p50Ms: percentile(sortedValues, 0.5),
    p90Ms: percentile(sortedValues, 0.9),
  };
}

function sortCountEntries(entries: Map<string, number>) {
  return [...entries.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatMs(value: number) {
  return `${Math.round(value)}ms`;
}

function buildScenarioTrend(
  scenarioName: string,
  reports: HarnessBehaviorScenarioReport[]
): HarnessRuntimeTrendScenario {
  const totalDurationSamples = reports.map((report) => report.totalDurationMs);
  const totalDurationMs = buildNumericTrendStats(totalDurationSamples);
  const passCount = reports.filter((report) => report.status === "passed").length;
  const failCount = reports.length - passCount;

  const phaseNames = sortUnique([
    ...CANONICAL_PHASES,
    ...reports.flatMap((report) =>
      report.phaseDurations.map((phaseDuration) => phaseDuration.phase)
    ),
  ]);

  const phaseDurations = phaseNames.map((phaseName) => {
    const samples = reports.flatMap((report) =>
      report.phaseDurations
        .filter((phaseDuration) => phaseDuration.phase === phaseName)
        .map((phaseDuration) => phaseDuration.durationMs)
    );

    return {
      phase: phaseName,
      ...buildNumericTrendStats(samples),
    };
  });

  let totalRuntimeSignals = 0;
  let belowMinCount = 0;
  let aboveMaxCount = 0;
  let withinBoundsCount = 0;
  const failurePhases = new Map<string, number>();
  const diagnostics = new Map<string, number>();

  for (const report of reports) {
    if (report.failure?.phase) {
      failurePhases.set(
        report.failure.phase,
        (failurePhases.get(report.failure.phase) ?? 0) + 1
      );
    }

    for (const diagnostic of report.diagnostics) {
      diagnostics.set(
        diagnostic.type,
        (diagnostics.get(diagnostic.type) ?? 0) + 1
      );
    }

    for (const signal of report.runtimeSignals) {
      totalRuntimeSignals += 1;
      if (signal.matchCount < signal.minMatches) {
        belowMinCount += 1;
        continue;
      }

      if (
        signal.maxMatches !== null &&
        signal.maxMatches !== undefined &&
        signal.matchCount > signal.maxMatches
      ) {
        aboveMaxCount += 1;
        continue;
      }

      withinBoundsCount += 1;
    }
  }

  return {
    scenarioName,
    reportCount: reports.length,
    passCount,
    failCount,
    passRate: reports.length === 0 ? 0 : passCount / reports.length,
    totalDurationMs,
    phaseDurations,
    runtimeSignals: {
      totalCount: totalRuntimeSignals,
      belowMinCount,
      aboveMaxCount,
      withinBoundsCount,
    },
    failurePhases: sortCountEntries(failurePhases).map(({ key, count }) => ({
      phase: key,
      count,
    })),
    diagnostics: sortCountEntries(diagnostics).map(({ key, count }) => ({
      type: key,
      count,
    })),
  };
}

function buildRegressionWarnings(
  scenario: HarnessRuntimeTrendScenario,
  thresholds: HarnessRuntimeTrendThresholds | undefined
) {
  const regressions: HarnessRuntimeTrendRegression[] = [];

  if (
    thresholds?.minPassRate !== undefined &&
    scenario.passRate < thresholds.minPassRate
  ) {
    regressions.push({
      kind: "pass-rate",
      severity: "warning",
      scenarioName: scenario.scenarioName,
      observed: scenario.passRate,
      threshold: thresholds.minPassRate,
      message: `Scenario "${scenario.scenarioName}" pass rate ${formatPercent(
        scenario.passRate
      )} is below the warning threshold ${formatPercent(
        thresholds.minPassRate
      )}.`,
    });
  }

  if (
    thresholds?.maxAverageTotalDurationMs !== undefined &&
    scenario.totalDurationMs.averageMs !== null &&
    scenario.totalDurationMs.averageMs > thresholds.maxAverageTotalDurationMs
  ) {
    regressions.push({
      kind: "total-duration",
      severity: "warning",
      scenarioName: scenario.scenarioName,
      observed: scenario.totalDurationMs.averageMs,
      threshold: thresholds.maxAverageTotalDurationMs,
      message: `Scenario "${scenario.scenarioName}" average total duration ${formatMs(
        scenario.totalDurationMs.averageMs
      )} exceeds the warning threshold ${formatMs(
        thresholds.maxAverageTotalDurationMs
      )}.`,
    });
  }

  for (const [phaseName, threshold] of Object.entries(
    thresholds?.maxAveragePhaseDurationMs ?? {}
  )) {
    const phaseStats = scenario.phaseDurations.find(
      (phaseDuration) => phaseDuration.phase === phaseName
    );
    if (
      threshold !== undefined &&
      phaseStats?.averageMs !== null &&
      phaseStats?.averageMs !== undefined &&
      phaseStats.averageMs > threshold
    ) {
      regressions.push({
        kind: "phase-duration",
        severity: "warning",
        scenarioName: scenario.scenarioName,
        phase: phaseName,
        observed: phaseStats.averageMs,
        threshold,
        message: `Scenario "${scenario.scenarioName}" ${phaseName} phase average ${formatMs(
          phaseStats.averageMs
        )} exceeds the warning threshold ${formatMs(threshold)}.`,
      });
    }
  }

  return regressions;
}

function buildRuntimeTrendOutput(
  reports: HarnessBehaviorScenarioReport[],
  parseErrors: HarnessRuntimeTrendParseError[],
  options: HarnessRuntimeTrendOptions = {}
): HarnessRuntimeTrendsOutput {
  const generatedAt = options.nowIso?.() ?? new Date().toISOString();
  const thresholds = options.thresholds;
  const scenarioMap = new Map<string, HarnessBehaviorScenarioReport[]>();

  for (const report of reports) {
    const existingReports = scenarioMap.get(report.scenarioName);
    if (existingReports) {
      existingReports.push(report);
      continue;
    }

    scenarioMap.set(report.scenarioName, [report]);
  }

  const scenarios = sortUnique([...scenarioMap.keys()]).map((scenarioName) =>
    buildScenarioTrend(scenarioName, scenarioMap.get(scenarioName) ?? [])
  );

  const regressions = scenarios.flatMap((scenario) =>
    buildRegressionWarnings(scenario, thresholds)
  );
  const passCount = scenarios.reduce(
    (count, scenario) => count + scenario.passCount,
    0
  );
  const failCount = scenarios.reduce(
    (count, scenario) => count + scenario.failCount,
    0
  );
  const noteParts: string[] = [];
  noteParts.push(`${reports.length} parsed reports across ${scenarios.length} scenarios.`);
  noteParts.push(`${parseErrors.length} parse errors.`);
  noteParts.push(`${regressions.length} regression warnings.`);

  let status: HarnessRuntimeTrendsOutput["summary"]["status"] = "healthy";
  if (reports.length === 0 && parseErrors.length > 0) {
    status = "degraded";
  } else if (parseErrors.length > 0 || regressions.length > 0) {
    status = "mixed";
  }

  return {
    version: "1.0",
    generatedAt,
    parseErrors,
    scenarios,
    summary: {
      reportCount: reports.length,
      scenarioCount: scenarios.length,
      passCount,
      failCount,
      parseErrorCount: parseErrors.length,
      status,
      note: noteParts.join(" "),
      regressions,
    },
  };
}

export function collectHarnessRuntimeTrends(
  source: string | readonly string[],
  options: HarnessRuntimeTrendOptions = {}
) {
  const { reports, errors } = parseHarnessBehaviorReportLines(source);
  return buildRuntimeTrendOutput(reports, errors, options);
}

export async function runHarnessRuntimeTrends(
  rootDir: string,
  source: string | readonly string[],
  options: HarnessRuntimeTrendOptions & { outputPath?: string } = {}
): Promise<HarnessRuntimeTrendRunResult> {
  const output = collectHarnessRuntimeTrends(source, options);
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT_PATH;
  const absoluteOutputPath = path.join(rootDir, outputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(output, null, 2)}\n`);

  if (options.persistHistory) {
    const absoluteHistoryPath = path.join(
      rootDir,
      path.dirname(outputPath),
      "history",
      `${toHistoryFileStamp(output.generatedAt)}.json`
    );
    await mkdir(path.dirname(absoluteHistoryPath), { recursive: true });
    await writeFile(absoluteHistoryPath, `${JSON.stringify(output, null, 2)}\n`);
  }

  return {
    output,
    outputPath,
  };
}

if (import.meta.main) {
  const input = await new Response(Bun.stdin).text();
  const result = await runHarnessRuntimeTrends(process.cwd(), input);
  console.log(JSON.stringify(result.output, null, 2));
}
