import { readFileSync } from "node:fs";
import path from "node:path";

const rootDir = "/Users/kwamina/Desktop/athena";
const packages = [
  {
    name: "@athena/webapp",
    summaryPath: path.join(
      rootDir,
      "packages/athena-webapp/coverage/coverage-summary.json"
    ),
  },
  {
    name: "@athena/storefront-webapp",
    summaryPath: path.join(
      rootDir,
      "packages/storefront-webapp/coverage/coverage-summary.json"
    ),
  },
];

const metrics = ["lines", "statements", "functions", "branches"];

const formatMetric = (metric) =>
  `${metric.pct.toFixed(2)}% (${metric.covered}/${metric.total})`;

const aggregate = {
  lines: { covered: 0, total: 0 },
  statements: { covered: 0, total: 0 },
  functions: { covered: 0, total: 0 },
  branches: { covered: 0, total: 0 },
};

const summaries = packages.map(({ name, summaryPath }) => {
  const summary = JSON.parse(readFileSync(summaryPath, "utf8")).total;

  for (const metricName of metrics) {
    aggregate[metricName].covered += summary[metricName].covered;
    aggregate[metricName].total += summary[metricName].total;
  }

  return { name, summary };
});

console.log("Coverage summary");

for (const { name, summary } of summaries) {
  console.log(`\n${name}`);
  for (const metricName of metrics) {
    console.log(
      `${metricName}: ${formatMetric(summary[metricName])}`
    );
  }
}

console.log("\nOverall");
for (const metricName of metrics) {
  const total = aggregate[metricName].total;
  const covered = aggregate[metricName].covered;
  const pct = total === 0 ? 100 : (covered / total) * 100;

  console.log(
    `${metricName}: ${pct.toFixed(2)}% (${covered}/${total})`
  );
}
