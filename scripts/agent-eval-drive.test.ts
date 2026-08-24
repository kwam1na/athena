import { describe, expect, it } from "vitest";

import {
  EVAL_SCENARIOS,
  evaluateScenario,
  parseDriveArgs,
  summarizeTrace,
  type EvalTurnContext,
} from "./agent-eval-drive";
import { DAILY_OPERATIONS_PROFILE } from "../packages/athena-webapp/convex/agentHarness/profiles/dailyOperations";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");

function context(overrides: Partial<EvalTurnContext>): EvalTurnContext {
  return {
    answer: {
      outcome: "answer",
      narrative: "Sales were GH₵10,123 across 6 sales on 2026-08-24; register 06's drawer is still open.",
      citations: [{ citationRef: "citation:v1.1.1.deadbeef" }],
    },
    calls: [
      { capability: "cap_dailyops_day_sales", status: "succeeded" },
      { capability: "cap_dailyops_register_sessions", status: "succeeded" },
      { capability: "cap_dailyops_store_day", status: "succeeded" },
      { capability: "cap_dailyops_automation", status: "succeeded" },
    ],
    attempts: [{ sequence: 1, status: "result_produced" }],
    toneDenials: 0,
    completeRunCalls: 1,
    ...overrides,
  };
}

function scenario(id: string) {
  const found = EVAL_SCENARIOS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no scenario ${id}`);
  return found;
}

describe("suite coverage", () => {
  it("drives every evaluation scenario the profile declares", () => {
    const suiteIds = new Set(EVAL_SCENARIOS.map((candidate) => candidate.id));
    for (const declared of DAILY_OPERATIONS_PROFILE.evaluation.scenarios) {
      expect(suiteIds, `profile scenario ${declared.id} has no drive coverage`).toContain(declared.id);
    }
  });
});

describe("parseDriveArgs", () => {
  it("requires the target triple and defaults the rest", () => {
    const missing = parseDriveArgs(["--org", "wigclub"], NOW);
    expect(missing).toHaveProperty("error");
    const parsed = parseDriveArgs(["--org", "wigclub", "--store", "wigclub", "--operator", "a@b.c"], NOW);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.operatingDate).toBe("2026-08-24");
    expect(parsed.scenarioIds).toEqual(EVAL_SCENARIOS.map((candidate) => candidate.id));
    expect(parsed.tag.startsWith("eval-")).toBe(true);
  });

  it("rejects an unknown scenario id by name", () => {
    const parsed = parseDriveArgs(
      ["--org", "o", "--store", "s", "--operator", "a@b.c", "--scenario", "nope"],
      NOW,
    );
    expect(parsed).toMatchObject({ error: expect.stringContaining('"nope"') });
  });
});

describe("summarizeTrace", () => {
  it("counts completeRun calls, tone denials, and lifts turn-report timings", () => {
    const summary = summarizeTrace([
      { kind: "tool_call_completed", payload: { toolId: "athena.completeRun", outcome: { denial: { code: "tone" } } } },
      { kind: "tool_call_completed", payload: { toolId: "athena.completeRun", outcome: { kind: "success" } } },
      { kind: "turn_report", payload: { completionMs: 12_000, firstDeltaMs: 4_000 } },
    ]);
    expect(summary).toEqual({ toneDenials: 1, completeRunCalls: 2, completionMs: 12_000, firstDeltaMs: 4_000 });
  });
});

describe("scenario checks", () => {
  it("passes a healthy cross-package answer and fails a narrow one", () => {
    expect(evaluateScenario(scenario("cross_package_readiness"), context({})).pass).toBe(true);
    const narrow = evaluateScenario(
      scenario("cross_package_readiness"),
      context({ calls: [{ capability: "cap_dailyops_day_sales", status: "succeeded" }] }),
    );
    expect(narrow.pass).toBe(false);
  });

  it("flags the capitulation shape: no_usable_sources over released reads", () => {
    const verdict = evaluateScenario(
      scenario("ambiguous_referent"),
      context({ answer: { outcome: "no_usable_sources", narrative: "I could not read any store data.", citations: [] } }),
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.issues.some((issue) => issue.message.includes("capitulation"))).toBe(true);
  });

  it("accepts needs_clarification for the ambiguous referent, and a dated answer with only a soft note", () => {
    const clarified = evaluateScenario(
      scenario("ambiguous_referent"),
      context({
        answer: { outcome: "needs_clarification", narrative: "Which Wednesday do you mean — 2026-08-19?", citations: [] },
        calls: [],
      }),
    );
    expect(clarified.pass).toBe(true);
    const dated = evaluateScenario(scenario("ambiguous_referent"), context({}));
    expect(dated.pass).toBe(true);
    expect(dated.issues.some((issue) => issue.severity === "soft")).toBe(true);
    const undated = evaluateScenario(
      scenario("ambiguous_referent"),
      context({ answer: { outcome: "answer", narrative: "Sales were fine.", citations: [{ citationRef: "c" }] } }),
    );
    expect(undated.pass).toBe(false);
  });

  it("fails an answer that leaks an opaque identifier", () => {
    const verdict = evaluateScenario(
      scenario("deep_week_variance"),
      context({
        answer: {
          outcome: "answer",
          narrative: "Largest variance on resource:register session.8d5c0a4d9a7e78365b5c876b9c4525d1.",
          citations: [{ citationRef: "c" }],
        },
      }),
    );
    expect(verdict.pass).toBe(false);
  });

  it("fails the week-variance scenario when every register read is partial (pre-fix shape)", () => {
    const verdict = evaluateScenario(
      scenario("deep_week_variance"),
      context({
        calls: [
          { capability: "cap_dailyops_register_sessions", status: "partial" },
          { capability: "cap_dailyops_register_sessions", status: "partial" },
        ],
      }),
    );
    expect(verdict.pass).toBe(false);
  });

  it("fails an empty-day answer that admits no absence", () => {
    const verdict = evaluateScenario(
      scenario("partial_no_data_day"),
      context({ answer: { outcome: "answer", narrative: "Revenue was strong all day.", citations: [{ citationRef: "c" }] } }),
    );
    expect(verdict.pass).toBe(false);
  });

  it("fails citation_resolution when the first citation does not resolve", () => {
    const verdict = evaluateScenario(scenario("citation_resolution"), context({ citationResolved: false }));
    expect(verdict.pass).toBe(false);
    expect(evaluateScenario(scenario("citation_resolution"), context({ citationResolved: true })).pass).toBe(true);
  });
});
