/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import schema from "../schema";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { REPORTS_SWEEP_STORE_ALLOWLIST_ENV } from "./sweeper";
import {
  REPORTS_VERIFICATION_ALERT_EMAILS_ENV,
  VERIFICATION_RUNNER_HEALTH_KEY,
  VERIFICATION_WEDGE_THRESHOLD,
  isReverifyTick,
  isVerificationAlertEmailEnabled,
  runVerificationSweepWithCtx,
  type VerificationSweepCtx,
} from "./verificationSweep";
import { seedStore, type SeededStore } from "./reseedTestSupport";

// Normalized so same-directory modules resolve for by-reference internal
// calls (the landingFunnelEvents.test.ts idiom): convex-test roots module
// paths at the `_generated` parent, which flattens "./x" keys otherwise.
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./reports/"),
    loader,
  ]),
);

// A deterministic non-reverify tick instant (12:00 UTC — hour index % 24 = 12).
const NOW = Date.parse("2026-03-10T12:00:00Z");
const DAY1 = "2026-03-05";
const DAY2 = "2026-03-04";

afterEach(() => {
  delete process.env[REPORTS_SWEEP_STORE_ALLOWLIST_ENV];
  delete process.env[REPORTS_VERIFICATION_ALERT_EMAILS_ENV];
});

type Harness = ReturnType<typeof convexTest>;

function allowlist(storeIds: Array<Id<"store">>): void {
  process.env[REPORTS_SWEEP_STORE_ALLOWLIST_ENV] = storeIds.join(",");
}

/**
 * The action-shaped ctx the orchestrator runs against, backed by convex-test.
 * `failQueryWhen` injects a per-subject query failure so containment paths are
 * exercisable without module mocking.
 */
function sweepCtx(
  t: Harness,
  opts?: { failQueryWhen?: (args: Record<string, unknown>) => boolean },
): VerificationSweepCtx {
  return {
    runQuery: (async (ref: unknown, args: Record<string, unknown>) => {
      if (opts?.failQueryWhen?.(args ?? {})) {
        throw new Error("injected verification failure");
      }
       
      return (t.query as any)(ref, args);
    }) as VerificationSweepCtx["runQuery"],
    runMutation: (async (ref: unknown, args: Record<string, unknown>) =>
       
      (t.mutation as any)(ref, args)) as VerificationSweepCtx["runMutation"],
  };
}

/** A settled, internally-consistent zero-activity reconciled day. Against an
 * empty domain the verifier recomputes exact zeros, so this day is CLEAN
 * unless a test tampers with its metrics. */
async function insertReportDay(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
  overrides?: Partial<Doc<"reportDay">>,
): Promise<void> {
  await ctx.db.insert("reportDay", {
    storeId,
    operatingDate,
    currency: "GHS",
    status: "reconciled",
    grossSalesMinor: 0,
    netSalesMinor: 0,
    refundsMinor: 0,
    unitsSold: 0,
    unitsReturned: 0,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 0,
    paymentsCollectedMinor: 0,
    paymentsRefundedMinor: 0,
    paymentAllocatedMinor: 0,
    foldedAt: NOW,
    foldVersion: 1,
    factCount: 0,
    lastFactRecordedAt: 0,
    flags: {
      mixedCurrency: false,
      hasUncostedRevenue: false,
      quarantinedFactCount: 0,
    },
    paymentPosture: {
      collectedMinor: 0,
      refundedMinor: 0,
      allocatedMinor: 0,
      unsettledMinor: 0,
      allocationCoverage: "complete",
      allocationOmittedMinor: 0,
      hasInvalidAllocation: false,
    },
    certifiedFoldRevision: 1,
    ...overrides,
  });
}

async function patchDay(
  t: Harness,
  storeId: Id<"store">,
  operatingDate: string,
  patch: Partial<Doc<"reportDay">>,
): Promise<void> {
  await t.run(async (ctx: MutationCtx) => {
    const day = await ctx.db
      .query("reportDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", storeId).eq("operatingDate", operatingDate),
      )
      .unique();
    if (!day) throw new Error("day missing");
    await ctx.db.patch("reportDay", day._id, patch);
  });
}

async function runRow(
  t: Harness,
  storeId: Id<"store">,
  subjectKind: "day" | "week",
  subjectKey: string,
): Promise<Doc<"reportVerificationRun"> | null> {
  return t.run(async (ctx: MutationCtx) =>
    ctx.db
      .query("reportVerificationRun")
      .withIndex("by_store_subject", (q) =>
        q
          .eq("storeId", storeId)
          .eq("subjectKind", subjectKind)
          .eq("subjectKey", subjectKey),
      )
      .unique(),
  );
}

async function operationalEventsFor(
  t: Harness,
  storeId: Id<"store">,
): Promise<Doc<"operationalEvent">[]> {
  return t.run(async (ctx: MutationCtx) =>
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fixture read
    ctx.db
      .query("operationalEvent")
      .withIndex("by_storeId_subject", (q) =>
        q
          .eq("storeId", storeId)
          .eq("subjectType", "report_verification_runner")
          .eq("subjectId", String(storeId)),
      )
      .collect(),
  );
}

async function seedStoreWithDay(
  t: Harness,
  overrides?: Partial<Doc<"reportDay">>,
): Promise<SeededStore> {
  const seeded = await t.run(async (ctx: MutationCtx) => {
    const store = await seedStore(ctx);
    await insertReportDay(ctx, store.storeId, DAY1, overrides);
    return store;
  });
  allowlist([seeded.storeId]);
  return seeded;
}

const MISMATCH = { grossSalesMinor: 500, netSalesMinor: 500 };

describe("verification sweep — day selection and outcomes", () => {
  let t: Harness;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("records a mismatch run row with streak=1 and the alert transition", async () => {
    const seeded = await seedStoreWithDay(t, MISMATCH);

    const result = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW,
    });

    expect(result.daysVerified).toBeGreaterThanOrEqual(1);
    const row = await runRow(t, seeded.storeId, "day", DAY1);
    expect(row).not.toBeNull();
    expect(row?.outcome).toBe("mismatch");
    expect(row?.streakCount).toBe(1);
    expect(row?.unexplainedFingerprint).toBeTruthy();
    // Alert TRANSITION recorded even though email is gated off.
    expect(row?.lastAlertedFingerprint).toBe(row?.unexplainedFingerprint);
    expect(row?.unexplainedDifferences.length).toBeGreaterThan(0);
    expect(row?.verifiedCertifiedFoldRevision).toBe(1);
    expect(result.alertTransitions).toBe(1);
    expect(result.emitsWouldFire).toBe(0);
  });

  it("clean re-verify after a revision bump clears the streak and re-arms", async () => {
    const seeded = await seedStoreWithDay(t, MISMATCH);
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });

    // Repair: metrics back to source truth, refold stamps a new revision.
    await patchDay(t, seeded.storeId, DAY1, {
      grossSalesMinor: 0,
      netSalesMinor: 0,
      certifiedFoldRevision: 2,
    });
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW + 1 });

    const row = await runRow(t, seeded.storeId, "day", DAY1);
    expect(row?.outcome).toBe("clean");
    expect(row?.streakCount).toBe(0);
    expect(row?.unexplainedFingerprint).toBeUndefined();
    expect(row?.lastAlertedFingerprint).toBeUndefined();
    expect(row?.reArmEpoch).toBe(1);
    expect(row?.verifiedCertifiedFoldRevision).toBe(2);
  });

  it("skips open days, dirty-marked days, and mid-reseed stores", async () => {
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedStore(ctx);
      await insertReportDay(ctx, store.storeId, DAY1, { status: "open" });
      await insertReportDay(ctx, store.storeId, DAY2, MISMATCH);
      await ctx.db.insert("reportDirtyDay", {
        storeId: store.storeId,
        operatingDate: DAY2,
        reason: "late_fact",
        markedAt: NOW,
      });
      return store;
    });
    allowlist([seeded.storeId]);

    const result = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW,
    });
    expect(await runRow(t, seeded.storeId, "day", DAY1)).toBeNull();
    expect(await runRow(t, seeded.storeId, "day", DAY2)).toBeNull();
    expect(result.daysDeferred).toBeGreaterThanOrEqual(1);

    // Mid-reseed: the store is skipped wholesale, even for other days.
    await t.run(async (ctx: MutationCtx) => {
      await ctx.db.patch("store", seeded.storeId, {
        reportingReseedStartedAt: NOW,
      });
      const mark = await ctx.db
        .query("reportDirtyDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", seeded.storeId).eq("operatingDate", DAY2),
        )
        .unique();
      if (mark) await ctx.db.delete("reportDirtyDay", mark._id);
    });
    const reseedResult = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW + 1,
    });
    expect(reseedResult.storesSkippedReseeding).toBe(1);
    expect(reseedResult.daysVerified).toBe(0);
    expect(await runRow(t, seeded.storeId, "day", DAY2)).toBeNull();
  });

  it("does not re-verify a day already verified at the current revision", async () => {
    const seeded = await seedStoreWithDay(t);
    const first = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW,
    });
    expect(first.daysVerified).toBeGreaterThanOrEqual(1);
    const firstRow = await runRow(t, seeded.storeId, "day", DAY1);

    const second = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW + 1,
    });
    expect(second.daysVerified).toBe(0);
    const secondRow = await runRow(t, seeded.storeId, "day", DAY1);
    expect(secondRow?.verifiedAt).toBe(firstRow?.verifiedAt);
  });

  it("verifies a settled legacy day (no certifiedFoldRevision) exactly once, then again when a revision lands", async () => {
    const seeded = await seedStoreWithDay(t, {
      certifiedFoldRevision: undefined,
    });
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });
    let row = await runRow(t, seeded.storeId, "day", DAY1);
    expect(row?.outcome).toBe("clean");
    expect(row?.verifiedCertifiedFoldRevision).toBeUndefined();

    // Quiet: no re-verify while no revision is stamped.
    const second = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW + 1,
    });
    expect(second.daysVerified).toBe(0);

    // A stamped revision re-selects the legacy day.
    await patchDay(t, seeded.storeId, DAY1, { certifiedFoldRevision: 5 });
    const third = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW + 2,
    });
    expect(third.daysVerified).toBeGreaterThanOrEqual(1);
    row = await runRow(t, seeded.storeId, "day", DAY1);
    expect(row?.verifiedCertifiedFoldRevision).toBe(5);
  });

  it("verifies a missing-and-quiet day, defers a missing day with a pending mark", async () => {
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedStore(ctx);
      // Anchor day exists; DAY2 has no reportDay row at all.
      await insertReportDay(ctx, store.storeId, DAY1);
      // 2026-03-03 is missing AND dirty-marked: deferred, not verified.
      await ctx.db.insert("reportDirtyDay", {
        storeId: store.storeId,
        operatingDate: "2026-03-03",
        reason: "late_fact",
        markedAt: NOW,
      });
      return store;
    });
    allowlist([seeded.storeId]);

    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });

    const missingQuiet = await runRow(t, seeded.storeId, "day", DAY2);
    expect(missingQuiet).not.toBeNull();
    expect(missingQuiet?.outcome).toBe("clean");
    expect(missingQuiet?.verifiedCertifiedFoldRevision).toBeUndefined();
    expect(await runRow(t, seeded.storeId, "day", "2026-03-03")).toBeNull();
  });

  it("never touches a store outside the allowlist", async () => {
    const [allowed, excluded] = await t.run(async (ctx: MutationCtx) => {
      const a = await seedStore(ctx);
      // Second store needs distinct slugs; seedStore is fixed, so build a
      // minimal second store by hand.
      const userId = await ctx.db.insert("athenaUser", {
        email: "other@example.test",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "Other",
        slug: "other",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: userId,
        currency: "GHS",
        name: "Other Store",
        organizationId,
        slug: "other-store",
      });
      await insertReportDay(ctx, a.storeId, DAY1, MISMATCH);
      await insertReportDay(ctx, storeId, DAY1, MISMATCH);
      return [a.storeId, storeId] as const;
    });
    allowlist([allowed]);

    const result = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW,
    });
    expect(result.storesScanned).toBe(1);
    expect(await runRow(t, allowed, "day", DAY1)).not.toBeNull();
    expect(await runRow(t, excluded, "day", DAY1)).toBeNull();
  });
});

describe("verification sweep — containment, wedge escalation, alert gating", () => {
  let t: Harness;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("records error for a failing subject without killing the tick", async () => {
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedStore(ctx);
      await insertReportDay(ctx, store.storeId, DAY1);
      await insertReportDay(ctx, store.storeId, DAY2, MISMATCH);
      return store;
    });
    allowlist([seeded.storeId]);

    const result = await runVerificationSweepWithCtx(
      sweepCtx(t, {
        failQueryWhen: (args) => args.operatingDate === DAY1,
      }),
      { now: NOW },
    );

    const errored = await runRow(t, seeded.storeId, "day", DAY1);
    expect(errored?.outcome).toBe("error");
    expect(result.subjectsErrored).toBe(1);
    // The failing subject did not stop DAY2 from verifying.
    const other = await runRow(t, seeded.storeId, "day", DAY2);
    expect(other?.outcome).toBe("mismatch");
  });

  it("an errored subject is re-selected on the next tick", async () => {
    const seeded = await seedStoreWithDay(t);
    await runVerificationSweepWithCtx(
      sweepCtx(t, { failQueryWhen: (args) => args.operatingDate === DAY1 }),
      { now: NOW },
    );
    expect((await runRow(t, seeded.storeId, "day", DAY1))?.outcome).toBe(
      "error",
    );

    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW + 1 });
    expect((await runRow(t, seeded.storeId, "day", DAY1))?.outcome).toBe(
      "clean",
    );
  });

  it("escalates a wedged store exactly once per streak and re-arms on success", async () => {
    const seeded = await seedStoreWithDay(t);
    const failing = sweepCtx(t, {
      failQueryWhen: (args) => args.operatingDate === DAY1,
    });

    for (let tick = 0; tick < VERIFICATION_WEDGE_THRESHOLD + 1; tick += 1) {
      await runVerificationSweepWithCtx(failing, { now: NOW + tick });
    }
    // Threshold + 1 incomplete ticks → exactly ONE operational event.
    expect(await operationalEventsFor(t, seeded.storeId)).toHaveLength(1);

    // A complete tick re-arms the runner-health streak.
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW + 100 });
    const health = await runRow(
      t,
      seeded.storeId,
      "week",
      VERIFICATION_RUNNER_HEALTH_KEY,
    );
    expect(health?.streakCount).toBe(0);

    // A fresh wedge streak escalates AGAIN (new epoch → new event).
    await patchDay(t, seeded.storeId, DAY1, { certifiedFoldRevision: 9 });
    for (let tick = 0; tick < VERIFICATION_WEDGE_THRESHOLD; tick += 1) {
      await runVerificationSweepWithCtx(failing, { now: NOW + 200 + tick });
    }
    expect(await operationalEventsFor(t, seeded.storeId)).toHaveLength(2);
  });

  it("email gate OFF records the transition without an emit; ON reports an emit would fire", async () => {
    const seeded = await seedStoreWithDay(t, MISMATCH);

    const gatedOff = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW,
    });
    expect(gatedOff.alertTransitions).toBe(1);
    expect(gatedOff.emitsWouldFire).toBe(0);
    expect(
      (await runRow(t, seeded.storeId, "day", DAY1))?.lastAlertedFingerprint,
    ).toBeTruthy();

    // Enable for this store; a NEW fingerprint must trip the gated path.
    process.env[REPORTS_VERIFICATION_ALERT_EMAILS_ENV] = String(seeded.storeId);
    await patchDay(t, seeded.storeId, DAY1, {
      grossSalesMinor: 700,
      netSalesMinor: 700,
      certifiedFoldRevision: 2,
    });
    const gatedOn = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW + 1,
    });
    expect(gatedOn.alertTransitions).toBe(1);
    expect(gatedOn.emitsWouldFire).toBe(1);
  });

  it("a persistent identical mismatch alerts once; a changed fingerprint alerts a second time", async () => {
    const seeded = await seedStoreWithDay(t, MISMATCH);
    const first = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW,
    });
    expect(first.alertTransitions).toBe(1);
    const firstFingerprint = (await runRow(t, seeded.storeId, "day", DAY1))
      ?.unexplainedFingerprint;

    // Same wrong numbers, refolded: revision advances, fingerprint identical.
    await patchDay(t, seeded.storeId, DAY1, { certifiedFoldRevision: 2 });
    const second = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW + 1,
    });
    expect(second.alertTransitions).toBe(0);
    const row = await runRow(t, seeded.storeId, "day", DAY1);
    expect(row?.streakCount).toBe(2);
    expect(row?.unexplainedFingerprint).toBe(firstFingerprint);

    // Different wrong numbers: new fingerprint → second alert transition.
    await patchDay(t, seeded.storeId, DAY1, {
      grossSalesMinor: 900,
      netSalesMinor: 900,
      certifiedFoldRevision: 3,
    });
    const third = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW + 2,
    });
    expect(third.alertTransitions).toBe(1);
    const changed = await runRow(t, seeded.storeId, "day", DAY1);
    expect(changed?.unexplainedFingerprint).not.toBe(firstFingerprint);
    expect(changed?.lastAlertedFingerprint).toBe(
      changed?.unexplainedFingerprint,
    );
  });
});

describe("verification sweep — weekly lane", () => {
  let t: Harness;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  async function seedWeekCurrent(
    storeId: Id<"store">,
    materializedAt: number,
  ): Promise<void> {
    await t.run(async (ctx: MutationCtx) => {
      const existing = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
      if (existing) {
        await ctx.db.patch("reportWeekCurrent", existing._id, {
          materializedAt,
        });
        return;
      }
      await ctx.db.insert("reportWeekCurrent", {
        storeId,
        availability: "unavailable",
        unavailableReason: "no_scheduled_dates",
        lifecyclePosture: "materializing",
        amendmentPosture: "none",
        materializedAt,
      });
    });
  }

  it("verifies the current week once per materialization, re-verifying when materializedAt advances", async () => {
    const seeded = await t.run(async (ctx: MutationCtx) => seedStore(ctx));
    allowlist([seeded.storeId]);
    await seedWeekCurrent(seeded.storeId, NOW - 10);

    const first = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW,
    });
    expect(first.weeksVerified).toBe(1);
    const row = await runRow(t, seeded.storeId, "week", "current");
    // Expected unavailable reason on a store with no schedule: record-only.
    expect(row?.outcome).toBe("unavailable");
    expect(row?.lastAlertedFingerprint).toBeUndefined();
    expect(row?.verifiedCertifiedFoldRevision).toBe(NOW - 10);

    // Unchanged materialization: gated out.
    const second = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW + 1,
    });
    expect(second.weeksVerified).toBe(0);

    // Advanced materialization: re-verified.
    await seedWeekCurrent(seeded.storeId, NOW + 5);
    const third = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW + 6,
    });
    expect(third.weeksVerified).toBe(1);
  });
});

describe("verification sweep — pure helpers", () => {
  it("isReverifyTick is deterministic on the UTC hour index", () => {
    expect(isReverifyTick(Date.parse("2026-03-10T00:30:00Z"))).toBe(true);
    expect(isReverifyTick(Date.parse("2026-03-10T12:00:00Z"))).toBe(false);
    expect(isReverifyTick(Date.parse("2026-03-11T00:00:00Z"))).toBe(true);
  });

  it("email gate is fail-closed and per-store", () => {
    delete process.env[REPORTS_VERIFICATION_ALERT_EMAILS_ENV];
    expect(isVerificationAlertEmailEnabled("s1")).toBe(false);
    process.env[REPORTS_VERIFICATION_ALERT_EMAILS_ENV] = "s1, s2";
    expect(isVerificationAlertEmailEnabled("s1")).toBe(true);
    expect(isVerificationAlertEmailEnabled("s3")).toBe(false);
    delete process.env[REPORTS_VERIFICATION_ALERT_EMAILS_ENV];
  });

  it("re-verify lane re-checks the most recent settled days on a reverify tick", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedStoreWithDay(t);
    const reverifyNow = Date.parse("2026-03-10T00:15:00Z");
    expect(isReverifyTick(reverifyNow)).toBe(true);

    // First pass verifies at revision 1.
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });
    const before = await runRow(t, seeded.storeId, "day", DAY1);

    // Revision unchanged — a plain tick would skip, a reverify tick must not.
    const result = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: reverifyNow,
    });
    expect(result.daysVerified).toBeGreaterThanOrEqual(1);
    const after = await runRow(t, seeded.storeId, "day", DAY1);
    expect(after?.verifiedAt).not.toBe(before?.verifiedAt);
    delete process.env[REPORTS_SWEEP_STORE_ALLOWLIST_ENV];
  });
});
