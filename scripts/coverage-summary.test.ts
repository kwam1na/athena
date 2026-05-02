import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildCoverageReport,
  parseLcovSummary,
  percentage,
  printCoverageReport,
} from "./coverage-summary";

const tempRoots: string[] = [];

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-coverage-"));
  tempRoots.push(rootDir);
  return rootDir;
}

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

function coverageSummary(metric: { covered: number; total: number }) {
  return JSON.stringify({
    total: {
      lines: { ...metric },
      statements: { ...metric },
      functions: { ...metric },
      branches: { ...metric },
    },
  });
}

async function writePackageSummaries(
  rootDir: string,
  metric: { covered: number; total: number }
) {
  await write(
    "packages/athena-webapp/coverage/coverage-summary.json",
    coverageSummary(metric),
    rootDir
  );
  await write(
    "packages/storefront-webapp/coverage/coverage-summary.json",
    coverageSummary(metric),
    rootDir
  );
}

async function writeRealBaselineSummaries(rootDir: string) {
  await write(
    "packages/athena-webapp/coverage/coverage-summary.json",
    JSON.stringify({
      total: {
        lines: { covered: 36789, total: 99096 },
        statements: { covered: 36789, total: 99096 },
        functions: { covered: 1150, total: 2604 },
        branches: { covered: 4730, total: 6479 },
      },
    }),
    rootDir
  );
  await write(
    "packages/storefront-webapp/coverage/coverage-summary.json",
    JSON.stringify({
      total: {
        lines: { covered: 3071, total: 23048 },
        statements: { covered: 3071, total: 23048 },
        functions: { covered: 100, total: 481 },
        branches: { covered: 371, total: 665 },
      },
    }),
    rootDir
  );
  await write(
    "coverage/root-scripts/lcov.info",
    [
      "SF:scripts/a.ts",
      "FNF:736",
      "FNH:647",
      "LF:12487",
      "LH:7232",
      "end_of_record",
    ].join("\n"),
    rootDir
  );
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("parseLcovSummary", () => {
  it("aggregates Bun LCOV line and function totals", () => {
    const summary = parseLcovSummary([
      "SF:scripts/a.ts",
      "FNF:2",
      "FNH:1",
      "LF:4",
      "LH:3",
      "end_of_record",
      "SF:scripts/b.ts",
      "FNF:3",
      "FNH:3",
      "LF:6",
      "LH:6",
      "end_of_record",
    ].join("\n"));

    expect(summary.lines).toEqual({ covered: 9, total: 10 });
    expect(summary.statements).toEqual({ covered: 9, total: 10 });
    expect(summary.functions).toEqual({ covered: 4, total: 5 });
    expect(summary.branches).toEqual({ covered: 0, total: 0 });
    expect(percentage(summary.branches)).toBe(100);
  });
});

describe("buildCoverageReport", () => {
  it("reads package summaries from the current checkout root", async () => {
    const rootDir = await createFixtureRoot();
    await writePackageSummaries(rootDir, { covered: 100, total: 100 });
    await write(
      "coverage/root-scripts/lcov.info",
      ["SF:scripts/a.ts", "FNF:1", "FNH:1", "LF:10", "LH:10", "end_of_record"].join("\n"),
      rootDir
    );

    const report = buildCoverageReport(rootDir);

    expect(report.failures).toEqual([]);
    expect(report.aggregate.lines).toEqual({ covered: 210, total: 210 });
  });

  it("fails when coverage regresses below the characterized baseline", async () => {
    const rootDir = await createFixtureRoot();
    await writePackageSummaries(rootDir, { covered: 1, total: 100 });
    await write(
      "coverage/root-scripts/lcov.info",
      ["SF:scripts/a.ts", "FNF:1", "FNH:1", "LF:10", "LH:10", "end_of_record"].join("\n"),
      rootDir
    );

    expect(() => printCoverageReport(rootDir, { log: () => {} })).toThrow(
      /Coverage policy failed/
    );
  });

  it("fails when exact coverage regresses but the rounded display value stays the same", async () => {
    const rootDir = await createFixtureRoot();
    await writeRealBaselineSummaries(rootDir);
    await write(
      "packages/storefront-webapp/coverage/coverage-summary.json",
      JSON.stringify({
        total: {
          lines: { covered: 3070, total: 23048 },
          statements: { covered: 3070, total: 23048 },
          functions: { covered: 100, total: 481 },
          branches: { covered: 371, total: 665 },
        },
      }),
      rootDir
    );

    expect(() => printCoverageReport(rootDir, { log: () => {} })).toThrow(
      /storefront-webapp lines coverage 13\.32% is below/
    );
  });
});
