/// <reference types="vite/client" />
/**
 * Characterization of the Daily Operations read seams BEFORE they are reshaped
 * into semantic agent resources (V26-1267, posture: characterization-first).
 *
 * These assertions describe what `buildDailyOperationsSnapshotWithCtx` and the
 * helpers behind it return today, including the role projection the surface
 * applies (`includeManagerReviewEvidence` / `includeFinancialDetails`, both
 * derived from `role === "full_admin"` in `authorizeDailyOperationsSnapshot`).
 * They are the baseline the agent ports must not silently diverge from: the
 * ports may present the same facts differently, but the FACTS are pinned here.
 *
 * Note what the current surface does with unauthorized money: it returns ZERO
 * (`maybeRedactCloseSummary`). That is exactly the behaviour the agent surface
 * is required to replace with structural absence, and it is characterized here
 * so the difference is deliberate and visible.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../../schema";
import { buildDailyOperationsSnapshotWithCtx } from "../dailyOperations";
import {
  CURRENT_OPERATING_DATE,
  PRIOR_OPERATING_DATE,
  dayEnd,
  dayStart,
  seedDailyOperationsStore,
} from "../../agentHarness/evals/dailyOperations.fixture";

const modules = import.meta.glob("../../**/*.ts");

const window = {
  startAt: dayStart(CURRENT_OPERATING_DATE),
  endAt: dayEnd(CURRENT_OPERATING_DATE),
};

describe("Daily Operations seams (characterization)", () => {
  it("seeds a store day with lifecycle, queue, timeline, automation, and week metrics", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run((ctx) => seedDailyOperationsStore(ctx));
    const snapshot = await t.run((ctx) =>
      buildDailyOperationsSnapshotWithCtx(ctx, {
        ...window,
        includeAnalyticsDetails: true,
        includeFinancialDetails: true,
        includeManagerReviewEvidence: true,
        includeStorePulseDetails: false,
        operatingDate: CURRENT_OPERATING_DATE,
        storeId: fixture.storeId,
        timelineLimit: 50,
      }),
    );

    // Lifecycle: opening started, close blocked by the open register and the
    // pending variance approval the fixture seeds.
    expect(snapshot.lifecycle.status).toBe("close_blocked");
    expect(snapshot.operatingDate).toBe(CURRENT_OPERATING_DATE);
    expect(snapshot.currency).toBe("GHS");

    // Lanes are the operator-visible summary of every contributing source.
    expect(snapshot.lanes.map((lane) => lane.key).sort()).toEqual(
      ["approvals", "close", "expenses", "opening", "pos_sessions", "queue", "registers"].filter((key) =>
        snapshot.lanes.some((lane) => lane.key === key),
      ),
    );
    const approvalsLane = snapshot.lanes.find((lane) => lane.key === "approvals");
    expect(approvalsLane?.count).toBe(1);
    const queueLane = snapshot.lanes.find((lane) => lane.key === "queue");
    expect(queueLane?.count).toBeGreaterThanOrEqual(1);

    // Attention items carry an owner, a severity, and an opaque-ish source subject.
    expect(snapshot.attentionItems.length).toBeGreaterThan(0);
    for (const item of snapshot.attentionItems) {
      expect(typeof item.id).toBe("string");
      expect(["daily_opening", "daily_close", "operations_queue"]).toContain(item.owner);
      expect(["critical", "warning", "info"]).toContain(item.severity);
      expect(typeof item.source.type).toBe("string");
    }

    // Timeline is event-time ordered, newest first.
    expect(snapshot.timeline.length).toBeGreaterThanOrEqual(2);
    const times = snapshot.timeline.map((event) => event.createdAt);
    expect([...times].sort((left, right) => right - left)).toEqual(times);

    // Automation statuses: one per lane that has a run.
    expect(snapshot.automationStatuses.map((status) => status.lane).sort()).toEqual(["close", "opening"]);
    const closeStatus = snapshot.automationStatuses.find((status) => status.lane === "close");
    expect(closeStatus?.outcome).toBe("prepared");
    expect(closeStatus?.policyVersion).toBe("eod.v5");
    // Manager review evidence is present only because the flag is on.
    expect(closeStatus?.decisionEvidence).toBeDefined();

    // Week metrics: seven days ending Saturday, with the seeded days populated.
    expect(snapshot.weekMetrics).toHaveLength(7);
    const currentMetric = snapshot.weekMetrics.find((metric) => metric.operatingDate === CURRENT_OPERATING_DATE);
    expect(currentMetric?.salesTotal).toBe(95_000);
    expect(currentMetric?.transactionCount).toBe(2);
    expect(currentMetric?.isClosed).toBe(false);
    const priorMetric = snapshot.weekMetrics.find((metric) => metric.operatingDate === PRIOR_OPERATING_DATE);
    expect(priorMetric?.isClosed).toBe(true);

    // Close summary reports money for an authorized reader.
    expect(snapshot.closeSummary.salesTotal).toBe(95_000);
    expect(snapshot.closeSummary.transactionCount).toBe(2);
  });

  it("zeroes financial fields for a POS-only reader instead of omitting them", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run((ctx) => seedDailyOperationsStore(ctx, { role: "pos_only" }));
    const restricted = await t.run((ctx) =>
      buildDailyOperationsSnapshotWithCtx(ctx, {
        ...window,
        includeAnalyticsDetails: false,
        includeFinancialDetails: false,
        includeManagerReviewEvidence: false,
        includeStorePulseDetails: false,
        operatingDate: CURRENT_OPERATING_DATE,
        storeId: fixture.storeId,
        timelineLimit: 50,
      }),
    );

    // The CURRENT surface substitutes zeroes. The agent surface must omit.
    expect(restricted.closeSummary.salesTotal).toBe(0);
    expect(restricted.closeSummary.currentDayCashTotal).toBe(0);
    expect(restricted.closeSummary.paymentTotals).toEqual([]);
    // Counts survive redaction; they are not financial values.
    expect(restricted.closeSummary.transactionCount).toBe(2);
    // Analytics are simply absent for a restricted reader.
    expect(restricted.weekMetrics).toEqual([]);
    expect(restricted.storePulse).toBeUndefined();
    // Manager review evidence is dropped from automation statuses.
    const closeStatus = restricted.automationStatuses.find((status) => status.lane === "close");
    expect(closeStatus?.decisionEvidence).toBeUndefined();
  });

  it("derives the operating window from the arguments it is given, not from store time", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run((ctx) => seedDailyOperationsStore(ctx));
    const snapshot = await t.run((ctx) =>
      buildDailyOperationsSnapshotWithCtx(ctx, {
        includeAnalyticsDetails: false,
        includeFinancialDetails: true,
        includeManagerReviewEvidence: true,
        includeStorePulseDetails: false,
        operatingDate: CURRENT_OPERATING_DATE,
        storeId: fixture.storeId,
        timelineLimit: 0,
      }),
    );
    // With no explicit range the helper falls back to the UTC-midnight day.
    expect(snapshot.startAt).toBe(dayStart(CURRENT_OPERATING_DATE));
    expect(snapshot.endAt).toBe(dayEnd(CURRENT_OPERATING_DATE));
  });
});
