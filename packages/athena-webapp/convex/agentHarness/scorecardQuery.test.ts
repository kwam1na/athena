/// <reference types="vite/client" />
/**
 * The scorecard internal query is a thin bounded-read wrapper over the pure
 * aggregation in `scorecard.ts` (which carries the arithmetic suite). It is
 * PROFILE-NEUTRAL on purpose — it reads the kernel tables every surface
 * shares and segments per profile from the grants — so future surfaces get
 * scored without touching it. These cases pin the wiring: it runs against an
 * empty deployment without crashing, returns the aggregate shape, and clamps
 * its read bounds.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { internal } from "../_generated/api";
import schema from "../schema";
import { SCORECARD_MAX_TRACE_EVENTS, SCORECARD_MIN_TRACE_EVENTS, scorecardTraceTake } from "./scorecard";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../") ? path.replace(/^\.\.\//, "./") : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);

describe("describeHarnessScorecard", () => {
  it("returns an empty scorecard against an empty deployment", async () => {
    const t = convexTest(schema, modules);
    const scorecard = await t.query(internal.agentHarness.scorecardQuery.describeHarnessScorecard, {});
    expect(scorecard.window).toEqual({ from: undefined, to: undefined, turns: 0 });
    expect(scorecard.outcomes).toEqual({});
    expect(scorecard.capabilities).toEqual({});
    expect(scorecard.completeRun).toEqual({ turnsWithRetry: 0, denialsByCode: {} });
    expect(scorecard.profiles).toEqual({});
  });

  it("clamps the trace read bound between its floor and ceiling", () => {
    expect(scorecardTraceTake(undefined)).toBeGreaterThanOrEqual(SCORECARD_MIN_TRACE_EVENTS);
    expect(scorecardTraceTake(1)).toBe(SCORECARD_MIN_TRACE_EVENTS);
    expect(scorecardTraceTake(1_000_000)).toBe(SCORECARD_MAX_TRACE_EVENTS);
    expect(scorecardTraceTake(100)).toBeLessThanOrEqual(SCORECARD_MAX_TRACE_EVENTS);
  });
});
