import { readFileSync } from "node:fs";
import path from "node:path";

type MetricName = "lines" | "statements" | "functions" | "branches";

type MetricCoverage = {
  covered: number;
  total: number;
};

type CoverageSummary = Record<MetricName, MetricCoverage>;

type JsonCoverageMetric = MetricCoverage & {
  skipped?: number;
  pct?: number;
};

type JsonCoverageSummary = {
  total: Record<MetricName, JsonCoverageMetric>;
};

type CoverageSource =
  | {
      kind: "vitest-json";
      name: string;
      summaryPath: string;
      minimumPercent: Record<MetricName, number>;
    }
  | {
      kind: "bun-lcov";
      name: string;
      lcovPath: string;
      minimumPercent: Partial<Record<MetricName, number>>;
    };

const METRICS: MetricName[] = ["lines", "statements", "functions", "branches"];

export const COVERAGE_TARGET_PERCENT = 100;

export const COVERAGE_SOURCES: CoverageSource[] = [
  {
    kind: "vitest-json",
    name: "@athena/webapp",
    summaryPath: "packages/athena-webapp/coverage/coverage-summary.json",
    minimumPercent: {
      lines: (36789 / 99096) * 100,
      statements: (36789 / 99096) * 100,
      functions: (1150 / 2604) * 100,
      branches: (4730 / 6479) * 100,
    },
  },
  {
    kind: "vitest-json",
    name: "@athena/storefront-webapp",
    summaryPath: "packages/storefront-webapp/coverage/coverage-summary.json",
    minimumPercent: {
      lines: (3071 / 23048) * 100,
      statements: (3071 / 23048) * 100,
      functions: (100 / 481) * 100,
      branches: (371 / 665) * 100,
    },
  },
  {
    kind: "bun-lcov",
    name: "repo scripts",
    lcovPath: "coverage/root-scripts/lcov.info",
    minimumPercent: {
      lines: (7471 / 12935) * 100,
      statements: (7471 / 12935) * 100,
      functions: (672 / 763) * 100,
    },
  },
];

export function percentage(metric: MetricCoverage) {
  return metric.total === 0 ? 100 : (metric.covered / metric.total) * 100;
}

function emptySummary(): CoverageSummary {
  return {
    lines: { covered: 0, total: 0 },
    statements: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
  };
}

function toCoverageSummary(summary: JsonCoverageSummary): CoverageSummary {
  return {
    lines: pickMetric(summary, "lines"),
    statements: pickMetric(summary, "statements"),
    functions: pickMetric(summary, "functions"),
    branches: pickMetric(summary, "branches"),
  };
}

function pickMetric(summary: JsonCoverageSummary, metricName: MetricName) {
  const metric = summary.total[metricName];
  return {
    covered: metric.covered,
    total: metric.total,
  };
}

export function readVitestJsonSummary(summaryPath: string): CoverageSummary {
  return toCoverageSummary(JSON.parse(readFileSync(summaryPath, "utf8")));
}

export function parseLcovSummary(lcovContents: string): CoverageSummary {
  const summary = emptySummary();

  for (const line of lcovContents.split("\n")) {
    const [key, value] = line.split(":");
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      continue;
    }

    if (key === "LF") {
      summary.lines.total += numericValue;
      summary.statements.total += numericValue;
    } else if (key === "LH") {
      summary.lines.covered += numericValue;
      summary.statements.covered += numericValue;
    } else if (key === "FNF") {
      summary.functions.total += numericValue;
    } else if (key === "FNH") {
      summary.functions.covered += numericValue;
    } else if (key === "BRF") {
      summary.branches.total += numericValue;
    } else if (key === "BRH") {
      summary.branches.covered += numericValue;
    }
  }

  return summary;
}

function addToAggregate(aggregate: CoverageSummary, summary: CoverageSummary) {
  for (const metricName of METRICS) {
    aggregate[metricName].covered += summary[metricName].covered;
    aggregate[metricName].total += summary[metricName].total;
  }
}

function formatMetric(metric: MetricCoverage) {
  return `${percentage(metric).toFixed(2)}% (${metric.covered}/${metric.total})`;
}

function resolveSourceSummary(rootDir: string, source: CoverageSource) {
  if (source.kind === "vitest-json") {
    return readVitestJsonSummary(path.join(rootDir, source.summaryPath));
  }

  return parseLcovSummary(readFileSync(path.join(rootDir, source.lcovPath), "utf8"));
}

function checkSourceThresholds(source: CoverageSource, summary: CoverageSummary) {
  const failures: string[] = [];

  for (const metricName of METRICS) {
    const minimum = source.minimumPercent[metricName];
    if (minimum === undefined) {
      continue;
    }

    const actual = percentage(summary[metricName]);
    if (actual < minimum) {
      failures.push(
        `${source.name} ${metricName} coverage ${actual.toFixed(2)}% is below the current baseline ${minimum.toFixed(2)}%.`
      );
    }
  }

  return failures;
}

export function buildCoverageReport(rootDir: string) {
  const aggregate = emptySummary();
  const sourceReports = COVERAGE_SOURCES.map((source) => {
    const summary = resolveSourceSummary(rootDir, source);
    addToAggregate(aggregate, summary);
    return {
      name: source.name,
      summary,
      failures: checkSourceThresholds(source, summary),
    };
  });

  return {
    aggregate,
    sourceReports,
    failures: sourceReports.flatMap((sourceReport) => sourceReport.failures),
  };
}

export function printCoverageReport(rootDir: string, logger: Pick<Console, "log"> = console) {
  const report = buildCoverageReport(rootDir);

  logger.log("Coverage policy summary");
  logger.log(`Target policy: ${COVERAGE_TARGET_PERCENT}% coverage across lines, statements, functions, and branches.`);
  logger.log("Current gate: no regression below the characterized baseline while the repo closes the gap to 100%.");

  for (const { name, summary } of report.sourceReports) {
    logger.log(`\n${name}`);
    for (const metricName of METRICS) {
      logger.log(`${metricName}: ${formatMetric(summary[metricName])}`);
    }
  }

  logger.log("\nOverall");
  for (const metricName of METRICS) {
    logger.log(`${metricName}: ${formatMetric(report.aggregate[metricName])}`);
  }

  if (report.failures.length > 0) {
    throw new Error(`Coverage policy failed:\n${report.failures.join("\n")}`);
  }

  return report;
}

if (import.meta.main) {
  try {
    printCoverageReport(process.cwd());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
