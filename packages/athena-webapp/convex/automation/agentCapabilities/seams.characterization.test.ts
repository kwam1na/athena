/// <reference types="vite/client" />
/**
 * Characterization of the automation-ledger seam the
 * `automation.dailyOperations` agent resource reshapes (V26-1267, posture:
 * characterization-first).
 *
 * The ledger is evidence, not domain truth: a run records the policy version,
 * mode, outcome, idempotency key, and (for a reviewer) the decision evidence
 * that explains the gate. The agent resource keeps that separation, so the
 * shape of a run and the domain/action keying are pinned here first.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../../schema";
import { listAutomationRunsForStoreDayActionWithCtx } from "../runLedger";
import { CURRENT_OPERATING_DATE, seedDailyOperationsStore } from "../../agentHarness/evals/dailyOperations.fixture";

const modules = import.meta.glob("../../**/*.ts");

describe("automation ledger seam (characterization)", () => {
  it("reads runs by store, operating date, domain, and action", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run((ctx) => seedDailyOperationsStore(ctx));

    const opening = await t.run((ctx) =>
      listAutomationRunsForStoreDayActionWithCtx(ctx, {
        action: "opening.auto_start",
        domain: "daily_operations",
        operatingDate: CURRENT_OPERATING_DATE,
        storeId: fixture.storeId,
      }),
    );
    expect(opening).toHaveLength(1);
    expect(opening[0].outcome).toBe("applied");
    expect(opening[0].policyMode).toBe("enabled");
    expect(opening[0].policyVersion).toBe("opening.v3");
    expect(opening[0].idempotencyKey).toBe(`opening-${CURRENT_OPERATING_DATE}`);
    expect(opening[0].decisionEvidence?.kind).toBe("opening_gate");

    const close = await t.run((ctx) =>
      listAutomationRunsForStoreDayActionWithCtx(ctx, {
        action: "eod.prepare",
        domain: "daily_operations",
        operatingDate: CURRENT_OPERATING_DATE,
        storeId: fixture.storeId,
      }),
    );
    expect(close).toHaveLength(1);
    expect(close[0].outcome).toBe("prepared");
    expect(close[0].decisionReason).toBe("register_variance_open");
    expect(close[0].decisionEvidence?.gates?.[0]).toEqual({
      key: "registers_closed",
      passed: false,
      reason: "one register still open",
    });
  });

  it("returns nothing for an action with no scheduled run on that day", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run((ctx) => seedDailyOperationsStore(ctx));
    const runs = await t.run((ctx) =>
      listAutomationRunsForStoreDayActionWithCtx(ctx, {
        action: "eod.auto_complete",
        domain: "daily_operations",
        operatingDate: CURRENT_OPERATING_DATE,
        storeId: fixture.storeId,
      }),
    );
    expect(runs).toEqual([]);
  });
});
