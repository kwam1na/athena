import { describe, expect, it } from "vitest";

import { formatScorecard, parseScorecardArgs, SCORECARD_FUNCTION } from "./agent-scorecard";

const SAMPLE = {
  window: { from: "2026-08-24T10:00:00.000Z", to: "2026-08-24T12:00:00.000Z", turns: 40 },
  outcomes: { completed: 38, failed: 2 },
  latencyMs: {
    completion: { p50: 12_000, p90: 26_000, max: 61_000 },
    firstDelta: { p50: 4_500, p90: 8_000, max: 11_000 },
  },
  completeRun: { turnsWithRetry: 3, denialsByCode: { tone: 2, sources_were_read: 1 } },
  capabilities: {
    cap_dailyops_register_sessions: { reads: 20, succeeded: 19, partial: 1, denied: 0 },
    cap_dailyops_day_sales: { reads: 10, succeeded: 6, partial: 4, denied: 0 },
  },
  callDenialsByCode: { invalid_arguments: 1 },
  attempts: { result_produced: 40, rejected: 2 },
  budget: { calls: { p50: 2, p90: 14, max: 30, limit: 48 } },
  profiles: {
    daily_operations: { turns: 38, outcomes: { completed: 37, failed: 1 }, turnsWithRetry: 3 },
    fleet_overview: { turns: 2, outcomes: { completed: 1, failed: 1 }, turnsWithRetry: 0 },
  },
};

describe("parseScorecardArgs", () => {
  it("defaults to 100 turns and human output", () => {
    const parsed = parseScorecardArgs([]);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed).toEqual({ turns: 100, json: false });
  });

  it("accepts --turns and --json, rejects junk", () => {
    const parsed = parseScorecardArgs(["--turns", "50", "--json"]);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed).toEqual({ turns: 50, json: true });
    expect(parseScorecardArgs(["--turns", "zero"])).toHaveProperty("error");
    expect(parseScorecardArgs(["--what"])).toHaveProperty("error");
  });
});

describe("formatScorecard", () => {
  it("names the rates an engineer tunes by, with partial percentages per capability", () => {
    const text = formatScorecard(SAMPLE);
    expect(text).toContain("40 turns");
    expect(text).toContain("completed: 38");
    expect(text).toContain("p50 12.0s");
    expect(text).toContain("retry: 3/40 turns");
    expect(text).toContain("tone: 2");
    expect(text).toContain("cap_dailyops_register_sessions");
    expect(text).toContain("5% partial"); // 1/20
    expect(text).toContain("40% partial"); // 4/10
    expect(text).toContain("rejected: 2");
    expect(text).toContain("calls p90 14/48");
    expect(text).toContain("daily_operations");
    expect(text).toContain("fleet_overview");
  });

  it("degrades to a plain empty note when the window has no turns", () => {
    const text = formatScorecard({
      window: { turns: 0 },
      outcomes: {},
      latencyMs: { completion: {}, firstDelta: {} },
      completeRun: { turnsWithRetry: 0, denialsByCode: {} },
      capabilities: {},
      callDenialsByCode: {},
      attempts: {},
      budget: {},
      profiles: {},
    });
    expect(text).toContain("no turns");
  });
});

describe("wiring", () => {
  it("targets the profile-neutral scorecard query", () => {
    expect(SCORECARD_FUNCTION).toBe("agentHarness/scorecardQuery:describeHarnessScorecard");
  });
});
