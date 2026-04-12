import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectHarnessRuntimeTrends,
  parseHarnessRuntimeTrendsArgs,
  parseHarnessBehaviorReportLines,
  runHarnessRuntimeTrends,
} from "./harness-runtime-trends";

const tempRoots: string[] = [];

function buildReportLine(report: Record<string, unknown>) {
  return `[harness:behavior:report] ${JSON.stringify(report)}`;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("parseHarnessBehaviorReportLines", () => {
  it("extracts reports and keeps malformed report lines as parse errors", () => {
    const parsed = parseHarnessBehaviorReportLines([
      "noise",
      buildReportLine({
        scenarioName: "sample-runtime-smoke",
        status: "passed",
        totalDurationMs: 1000,
        phaseDurations: [{ phase: "boot", durationMs: 100 }],
        runtimeSignals: [],
        diagnostics: [],
      }),
      "[harness:behavior:report] not-json",
    ]);

    expect(parsed.reports).toHaveLength(1);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.reports[0]?.scenarioName).toBe("sample-runtime-smoke");
    expect(parsed.errors[0]?.lineNumber).toBe(3);
  });
});

describe("collectHarnessRuntimeTrends", () => {
  it("aggregates pass/fail, latency, runtime-signal, and failure-phase trends by scenario", () => {
    const output = collectHarnessRuntimeTrends(
      [
        "noise",
        buildReportLine({
          scenarioName: "sample-runtime-smoke",
          status: "passed",
          totalDurationMs: 1000,
          phaseDurations: [
            { phase: "boot", durationMs: 100 },
            { phase: "readiness", durationMs: 200 },
            { phase: "browser", durationMs: 300 },
            { phase: "runtime", durationMs: 50 },
            { phase: "assertion", durationMs: 100 },
            { phase: "cleanup", durationMs: 250 },
          ],
          runtimeSignals: [
            {
              name: "browser-clicked-signal",
              processId: "sample-app",
              source: "stdout",
              pattern: "RUNTIME_SIGNAL:browser-clicked",
              minMatches: 1,
              maxMatches: null,
              matchCount: 1,
              sampleMatches: ["RUNTIME_SIGNAL:browser-clicked"],
            },
          ],
          diagnostics: [],
        }),
        buildReportLine({
          scenarioName: "sample-runtime-smoke",
          status: "passed",
          totalDurationMs: 2000,
          phaseDurations: [
            { phase: "boot", durationMs: 200 },
            { phase: "readiness", durationMs: 400 },
            { phase: "browser", durationMs: 600 },
            { phase: "runtime", durationMs: 100 },
            { phase: "assertion", durationMs: 200 },
            { phase: "cleanup", durationMs: 500 },
          ],
          runtimeSignals: [
            {
              name: "browser-clicked-signal",
              processId: "sample-app",
              source: "stdout",
              pattern: "RUNTIME_SIGNAL:browser-clicked",
              minMatches: 1,
              maxMatches: null,
              matchCount: 1,
              sampleMatches: ["RUNTIME_SIGNAL:browser-clicked"],
            },
          ],
          diagnostics: [],
        }),
        buildReportLine({
          scenarioName: "sample-runtime-smoke",
          status: "failed",
          totalDurationMs: 3000,
          phaseDurations: [
            { phase: "boot", durationMs: 300 },
            { phase: "readiness", durationMs: 600 },
            { phase: "browser", durationMs: 900 },
            { phase: "runtime", durationMs: 150 },
            { phase: "assertion", durationMs: 300 },
            { phase: "cleanup", durationMs: 750 },
          ],
          runtimeSignals: [
            {
              name: "browser-clicked-signal",
              processId: "sample-app",
              source: "stdout",
              pattern: "RUNTIME_SIGNAL:browser-clicked",
              minMatches: 1,
              maxMatches: null,
              matchCount: 0,
              sampleMatches: [],
            },
            {
              name: "browser-clicked-signal",
              processId: "sample-app",
              source: "stdout",
              pattern: "RUNTIME_SIGNAL:browser-clicked",
              minMatches: 1,
              maxMatches: 1,
              matchCount: 2,
              sampleMatches: ["RUNTIME_SIGNAL:browser-clicked"],
            },
          ],
          diagnostics: [
            {
              type: "runtime-signal-below-minimum",
              message: "missing browser-clicked-signal",
            },
            {
              type: "runtime-signal-above-maximum",
              message: "browser-clicked-signal exceeded max",
            },
          ],
          failure: {
            phase: "assertion",
            details: "Expected signal to be recorded.",
          },
        }),
        buildReportLine({
          scenarioName: "storefront-checkout-bootstrap",
          status: "passed",
          totalDurationMs: 500,
          phaseDurations: [
            { phase: "boot", durationMs: 50 },
            { phase: "readiness", durationMs: 100 },
            { phase: "browser", durationMs: 150 },
            { phase: "runtime", durationMs: 25 },
            { phase: "assertion", durationMs: 50 },
            { phase: "cleanup", durationMs: 125 },
          ],
          runtimeSignals: [],
          diagnostics: [],
        }),
        "[harness:behavior:report] not-json",
      ],
      {
        nowIso: () => "2026-04-12T05:00:00.000Z",
      }
    );

    expect(output.version).toBe("1.0");
    expect(output.summary.reportCount).toBe(4);
    expect(output.summary.parseErrorCount).toBe(1);
    expect(output.summary.scenarioCount).toBe(2);
    expect(output.summary.status).toBe("mixed");
    expect(output.scenarios.map((scenario) => scenario.scenarioName)).toEqual([
      "sample-runtime-smoke",
      "storefront-checkout-bootstrap",
    ]);

    const sampleScenario = output.scenarios[0];
    expect(sampleScenario?.reportCount).toBe(3);
    expect(sampleScenario?.passCount).toBe(2);
    expect(sampleScenario?.failCount).toBe(1);
    expect(sampleScenario?.passRate).toBeCloseTo(2 / 3);
    expect(sampleScenario?.totalDurationMs).toMatchObject({
      minMs: 1000,
      maxMs: 3000,
      p50Ms: 2000,
      p90Ms: 3000,
    });
    expect(
      sampleScenario?.phaseDurations.find((phase) => phase.phase === "boot")
    ).toMatchObject({
      count: 3,
      averageMs: 200,
    });
    expect(sampleScenario?.runtimeSignals).toMatchObject({
      totalCount: 4,
      belowMinCount: 1,
      aboveMaxCount: 1,
      withinBoundsCount: 2,
    });
    expect(sampleScenario?.failurePhases).toEqual([
      { phase: "assertion", count: 1 },
    ]);
    expect(sampleScenario?.diagnostics).toEqual([
      { type: "runtime-signal-above-maximum", count: 1 },
      { type: "runtime-signal-below-minimum", count: 1 },
    ]);
  });

  it("emits regression warnings when thresholds are crossed", () => {
    const output = collectHarnessRuntimeTrends(
      [
        buildReportLine({
          scenarioName: "sample-runtime-smoke",
          status: "passed",
          totalDurationMs: 2000,
          phaseDurations: [{ phase: "boot", durationMs: 100 }],
          runtimeSignals: [],
          diagnostics: [],
        }),
        buildReportLine({
          scenarioName: "sample-runtime-smoke",
          status: "failed",
          totalDurationMs: 3000,
          phaseDurations: [{ phase: "boot", durationMs: 300 }],
          runtimeSignals: [],
          diagnostics: [],
        }),
      ],
      {
        nowIso: () => "2026-04-12T05:00:00.000Z",
        thresholds: {
          maxAverageTotalDurationMs: 1500,
          minPassRate: 0.9,
        },
      }
    );

    expect(output.summary.regressions).toEqual([
      {
        kind: "pass-rate",
        scenarioName: "sample-runtime-smoke",
        severity: "warning",
        observed: 0.5,
        threshold: 0.9,
        message:
          'Scenario "sample-runtime-smoke" pass rate 50% is below the warning threshold 90%.',
      },
      {
        kind: "total-duration",
        scenarioName: "sample-runtime-smoke",
        severity: "warning",
        observed: 2500,
        threshold: 1500,
        message:
          'Scenario "sample-runtime-smoke" average total duration 2500ms exceeds the warning threshold 1500ms.',
      },
    ]);
  });

  it("writes latest and timestamped runtime-trend history snapshots when persistence is enabled", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "athena-harness-runtime-trends-")
    );
    tempRoots.push(rootDir);

    const result = await runHarnessRuntimeTrends(
      rootDir,
      [
        buildReportLine({
          scenarioName: "sample-runtime-smoke",
          status: "passed",
          totalDurationMs: 1000,
          phaseDurations: [{ phase: "boot", durationMs: 100 }],
          runtimeSignals: [],
          diagnostics: [],
        }),
      ],
      {
        nowIso: () => "2026-04-12T05:00:00.000Z",
        persistHistory: true,
      }
    );

    expect(result.outputPath).toBe("artifacts/harness-behavior/trends/latest.json");

    const latest = JSON.parse(
      await readFile(
        path.join(rootDir, "artifacts/harness-behavior/trends/latest.json"),
        "utf8"
      )
    ) as { summary: { reportCount: number } };
    const historySnapshot = JSON.parse(
      await readFile(
        path.join(
          rootDir,
          "artifacts/harness-behavior/trends/history/2026-04-12T05-00-00-000Z.json"
        ),
        "utf8"
      )
    ) as { summary: { reportCount: number } };

    expect(latest.summary.reportCount).toBe(1);
    expect(historySnapshot.summary.reportCount).toBe(1);
  });
});

describe("parseHarnessRuntimeTrendsArgs", () => {
  it("accepts --persist-history", () => {
    expect(parseHarnessRuntimeTrendsArgs(["--persist-history"])).toMatchObject({
      persistHistory: true,
      help: false,
    });
  });
});
