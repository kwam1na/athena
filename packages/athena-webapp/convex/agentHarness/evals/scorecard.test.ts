import { describe, expect, it } from "vitest";

import { aggregateHarnessScorecard } from "./scorecard";

const T0 = Date.parse("2026-08-24T10:00:00.000Z");

function turnReport(runId: string, outcome: string, completionMs: number, firstDeltaMs: number, at = T0) {
  return { runId, kind: "turn_report", at, payload: { outcome, completionMs, firstDeltaMs } };
}

function completeRun(runId: string, denialCode?: string, at = T0) {
  return {
    runId,
    kind: "tool_call_completed",
    at,
    payload: { toolId: "athena.completeRun", outcome: denialCode ? { denial: { code: denialCode } } : { kind: "success" } },
  };
}

describe("aggregateHarnessScorecard", () => {
  it("reports empty inputs as an empty window, not a crash", () => {
    const scorecard = aggregateHarnessScorecard({ traceEvents: [], calls: [], attempts: [], ledgers: [] });
    expect(scorecard.window).toEqual({ from: undefined, to: undefined, turns: 0 });
    expect(scorecard.outcomes).toEqual({});
    expect(scorecard.latencyMs.completion.p50).toBeUndefined();
    expect(scorecard.completeRun).toEqual({ turnsWithRetry: 0, denialsByCode: {} });
  });

  it("counts turns, outcomes, and latency percentiles from turn reports", () => {
    const scorecard = aggregateHarnessScorecard({
      traceEvents: [
        turnReport("r1", "completed", 10_000, 3_000, T0),
        turnReport("r2", "completed", 20_000, 5_000, T0 + 60_000),
        turnReport("r3", "failed", 30_000, 7_000, T0 + 120_000),
      ],
      calls: [],
      attempts: [],
      ledgers: [],
    });
    expect(scorecard.window.turns).toBe(3);
    expect(scorecard.window.from).toBe("2026-08-24T10:00:00.000Z");
    expect(scorecard.window.to).toBe("2026-08-24T10:02:00.000Z");
    expect(scorecard.outcomes).toEqual({ completed: 2, failed: 1 });
    expect(scorecard.latencyMs.completion.p50).toBe(20_000);
    expect(scorecard.latencyMs.completion.max).toBe(30_000);
    expect(scorecard.latencyMs.firstDelta.p50).toBe(5_000);
  });

  it("attributes completeRun retries per run and denial codes across the window", () => {
    const scorecard = aggregateHarnessScorecard({
      traceEvents: [
        completeRun("r1", "tone"),
        completeRun("r1"),
        completeRun("r2"),
        completeRun("r3", "sources_were_read"),
        completeRun("r3", "tone"),
        completeRun("r3"),
      ],
      calls: [],
      attempts: [],
      ledgers: [],
    });
    expect(scorecard.completeRun.turnsWithRetry).toBe(2);
    expect(scorecard.completeRun.denialsByCode).toEqual({ tone: 2, sources_were_read: 1 });
  });

  it("splits capability reads by status and names call denial codes", () => {
    const scorecard = aggregateHarnessScorecard({
      traceEvents: [],
      calls: [
        { capabilityId: "cap_a", status: "succeeded" },
        { capabilityId: "cap_a", status: "partial" },
        { capabilityId: "cap_a", status: "denied", delegation: { refusal: { code: "invalid_arguments" } } },
        { capabilityId: "cap_b", status: "succeeded" },
      ],
      attempts: [{ status: "result_produced" }, { status: "rejected" }],
      ledgers: [],
    });
    expect(scorecard.capabilities.cap_a).toEqual({ reads: 3, succeeded: 1, partial: 1, denied: 1 });
    expect(scorecard.capabilities.cap_b).toEqual({ reads: 1, succeeded: 1, partial: 0, denied: 0 });
    expect(scorecard.callDenialsByCode).toEqual({ invalid_arguments: 1 });
    expect(scorecard.attempts).toEqual({ result_produced: 1, rejected: 1 });
  });

  it("summarizes budget utilization per dimension with the declared limit", () => {
    const scorecard = aggregateHarnessScorecard({
      traceEvents: [],
      calls: [],
      attempts: [],
      ledgers: [
        { charged: { calls: 2, rows: 10 }, limits: { calls: 48, rows: 5_000 } },
        { charged: { calls: 30, rows: 40 }, limits: { calls: 48, rows: 5_000 } },
      ],
    });
    expect(scorecard.budget.calls).toEqual({ p50: 30, p90: 30, max: 30, limit: 48 });
    expect(scorecard.budget.rows.max).toBe(40);
  });
});
