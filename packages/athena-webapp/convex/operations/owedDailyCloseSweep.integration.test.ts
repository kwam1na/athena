/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./operations/"),
    loader,
  ]),
);

// Fixed instant so operating-date arithmetic is deterministic: 2026-07-25.
const NOW = Date.parse("2026-07-25T03:30:00.000Z");

async function seedStore(
  t: ReturnType<typeof convexTest>,
  options: { paused?: boolean; mode?: "enabled" | "disabled" } = {},
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("athenaUser", {
      email: "owner@example.com",
    });
    const organizationId = await ctx.db.insert("organization", {
      name: "Test Org",
      slug: "test-org",
      createdByUserId: userId,
    });
    const storeId = await ctx.db.insert("store", {
      name: "Test Store",
      organizationId,
      slug: "test-store",
      currency: "GHS",
      createdByUserId: userId,
    });

    await ctx.db.insert("automationPolicy", {
      action: "eod.auto_complete",
      createdAt: NOW,
      domain: "daily_operations",
      mode: options.mode ?? "enabled",
      operatingTimezoneOffsetMinutes: 0,
      organizationId,
      paused: options.paused ?? false,
      policyVersion: "daily-operations.v1",
      storeId,
      updatedAt: NOW,
    } as never);

    return { organizationId, storeId };
  });
}

async function seedCompletedClose(
  t: ReturnType<typeof convexTest>,
  args: {
    storeId: Id<"store">;
    organizationId: Id<"organization">;
    operatingDate: string;
  },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("dailyClose", {
      storeId: args.storeId,
      organizationId: args.organizationId,
      operatingDate: args.operatingDate,
      status: "completed",
      lifecycleStatus: "active",
      isCurrent: false,
      readiness: {
        status: "ready",
        blockerCount: 0,
        reviewCount: 0,
        carryForwardCount: 0,
        readyCount: 0,
      },
      summary: {},
      sourceSubjects: [],
      carryForwardWorkItemIds: [],
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: NOW,
    } as never);
  });
}

const WINDOW = [
  "2026-07-18",
  "2026-07-19",
  "2026-07-20",
  "2026-07-21",
  "2026-07-22",
  "2026-07-23",
  "2026-07-24",
];

describe("owed daily close sweep", () => {
  it("finds the day that missed its eligibility window", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(t);
    for (const operatingDate of WINDOW.filter((d) => d !== "2026-07-24")) {
      await seedCompletedClose(t, { operatingDate, organizationId, storeId });
    }

    const candidates = await t.query(
      internal.operations.owedDailyCloseSweep.listOwedDailyCloseCandidates,
      { now: NOW },
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      asOfOperatingDate: "2026-07-25",
      owed: ["2026-07-24"],
      attempt: ["2026-07-24"],
      stale: [],
    });
  });

  it("ignores a store whose days are all closed", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(t);
    for (const operatingDate of WINDOW) {
      await seedCompletedClose(t, { operatingDate, organizationId, storeId });
    }

    expect(
      await t.query(
        internal.operations.owedDailyCloseSweep.listOwedDailyCloseCandidates,
        { now: NOW },
      ),
    ).toEqual([]);
  });

  it("ignores a paused policy", async () => {
    const t = convexTest(schema, modules);
    await seedStore(t, { paused: true });

    expect(
      await t.query(
        internal.operations.owedDailyCloseSweep.listOwedDailyCloseCandidates,
        { now: NOW },
      ),
    ).toEqual([]);
  });

  it("does not count a superseded close as settling the day", async () => {
    // A superseded record is history, not a completed close; treating it as
    // one would leave the day silently open forever.
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(t);
    for (const operatingDate of WINDOW) {
      await seedCompletedClose(t, { operatingDate, organizationId, storeId });
    }
    await t.run(async (ctx) => {
      const close = await ctx.db
        .query("dailyClose")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-22"),
        )
        .unique();
      await ctx.db.patch("dailyClose", close!._id, {
        lifecycleStatus: "superseded",
      });
    });

    const candidates = await t.query(
      internal.operations.owedDailyCloseSweep.listOwedDailyCloseCandidates,
      { now: NOW },
    );
    expect(candidates[0]?.owed).toEqual(["2026-07-22"]);
  });

  it("escalates a stale owed day to an operational event", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(t);
    // Only 07-21 is missing: four days old, well past the staleness threshold.
    for (const operatingDate of WINDOW.filter((d) => d !== "2026-07-21")) {
      await seedCompletedClose(t, { operatingDate, organizationId, storeId });
    }

    const result = await t.action(
      internal.operations.owedDailyCloseSweep.runOwedDailyCloseSweep,
      { mode: "apply", now: NOW },
    );

    expect(result.escalations).toEqual([
      { operatingDate: "2026-07-21", storeId },
    ]);
    // The sweep delegated to the historic close path before escalating; the
    // day stayed open because that path judged it ineligible, not because the
    // sweep skipped it.
    expect(result.results).toEqual([
      expect.objectContaining({ operatingDate: "2026-07-21", storeId }),
    ]);
    expect(result.scannedStoreCount).toBe(1);

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("operationalEvent")
        .withIndex("by_storeId_subject", (q) =>
          q
            .eq("storeId", storeId)
            .eq("subjectType", "daily_close")
            .eq("subjectId", "2026-07-21"),
        )
        .take(2),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorType: "automation",
      eventType: "daily_close.owed_stale",
      reason: "daily_close_owed_stale",
    });
    expect(events[0]?.metadata).toMatchObject({ ageInDays: 4 });

    const intents = await t.run(async (ctx) =>
      ctx.db
        .query("notificationIntent")
        .withIndex("by_dedupeKey", (q) =>
          q.eq("dedupeKey", `eod.stale_daily_close:${storeId}:2026-07-21`),
        )
        .take(2),
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      category: "eod",
      kind: "eod.stale_daily_close",
      payload: {
        ageInDays: 4,
        operatingDate: "2026-07-21",
        storeId,
      },
      status: "pending",
    });
  });

  it("escalates a stuck day only once across repeated sweeps", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(t);
    for (const operatingDate of WINDOW.filter((d) => d !== "2026-07-21")) {
      await seedCompletedClose(t, { operatingDate, organizationId, storeId });
    }

    await t.action(
      internal.operations.owedDailyCloseSweep.runOwedDailyCloseSweep,
      { mode: "apply", now: NOW },
    );
    await t.action(
      internal.operations.owedDailyCloseSweep.runOwedDailyCloseSweep,
      { mode: "apply", now: NOW },
    );

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("operationalEvent")
        .withIndex("by_storeId_subject", (q) =>
          q
            .eq("storeId", storeId)
            .eq("subjectType", "daily_close")
            .eq("subjectId", "2026-07-21"),
        )
        .take(2),
    );
    expect(events).toHaveLength(1);

    const intents = await t.run(async (ctx) =>
      ctx.db
        .query("notificationIntent")
        .withIndex("by_dedupeKey", (q) =>
          q.eq("dedupeKey", `eod.stale_daily_close:${storeId}:2026-07-21`),
        )
        .take(2),
    );
    expect(intents).toHaveLength(1);
  });

  it("does not escalate a recently owed day", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(t);
    for (const operatingDate of WINDOW.filter((d) => d !== "2026-07-24")) {
      await seedCompletedClose(t, { operatingDate, organizationId, storeId });
    }

    const result = await t.action(
      internal.operations.owedDailyCloseSweep.runOwedDailyCloseSweep,
      { mode: "apply", now: NOW },
    );

    expect(result.escalations).toEqual([]);
    const events = await t.run(async (ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fixture
      ctx.db.query("operationalEvent").collect(),
    );
    expect(events).toEqual([]);
  });
});
