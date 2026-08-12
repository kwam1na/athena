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
  VERIFICATION_VOID_FACT_SCAN,
  VERIFICATION_WEDGE_THRESHOLD,
  VERIFICATION_WEEK_ALLOCATION_PROBE,
  VERIFICATION_WEEK_MIN_INTERVAL_HOURS,
  isReverifyTick,
  isVerificationAlertEmailEnabled,
  runVerificationSweepWithCtx,
  shouldEscalateWedge,
  type VerificationSweepCtx,
} from "./verificationSweep";
import { normalizeReseedCursor, reseedStep, type ReseedCursor } from "./reseed";
import { foldAndReplaceDay } from "./sweeper";
import {
  seedPaymentAllocation,
  seedPosSale,
  seedStore,
  type SeededStore,
} from "./reseedTestSupport";

import { joinKeyComponents } from "../notifications/deliveryPolicy";

const WEEK_INTERVAL_MS = VERIFICATION_WEEK_MIN_INTERVAL_HOURS * 60 * 60 * 1000;

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
  opts?: {
    failQueryWhen?: (args: Record<string, unknown>) => boolean;
    failMutationWhen?: (args: Record<string, unknown>) => boolean;
  },
): VerificationSweepCtx {
  return {
    runQuery: (async (ref: unknown, args: Record<string, unknown>) => {
      if (opts?.failQueryWhen?.(args ?? {})) {
        throw new Error("injected verification failure");
      }

      return (t.query as any)(ref, args);
    }) as VerificationSweepCtx["runQuery"],
    runMutation: (async (ref: unknown, args: Record<string, unknown>) => {
      if (opts?.failMutationWhen?.(args ?? {})) {
        throw new Error("injected mutation failure");
      }

      return (t.mutation as any)(ref, args);
    }) as VerificationSweepCtx["runMutation"],
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

async function notificationIntentsFor(
  t: Harness,
  storeId: Id<"store">,
): Promise<Doc<"notificationIntent">[]> {
  const rows = await t.run(async (ctx: MutationCtx) =>
    ctx.db.query("notificationIntent").withIndex("by_dedupeKey").take(50),
  );
  return rows.filter(
    (row) =>
      row.storeId === storeId &&
      row.kind === "reports.verification_discrepancy",
  );
}

/** The dedupeKey registry.ts derives for this subject — rebuilt here from the
 * RUN ROW so the test proves the sweep wrote the same fingerprint/epoch into
 * the intent payload that it recorded on the row (T1's whole point). */
function expectedDedupeKey(
  storeId: Id<"store">,
  subjectKind: "day" | "week",
  subjectKey: string,
  row: Doc<"reportVerificationRun">,
): string {
  return joinKeyComponents([
    "reports.verification_discrepancy",
    String(storeId),
    subjectKind,
    subjectKey,
    row.unexplainedFingerprint!,
    String(row.reArmEpoch),
    String(row.alertSeq ?? 0),
  ]);
}

/** Insert one void reportFact for the day (the sweep's void-attribution
 * source). Fingerprint/lineId are per-index so a day can carry many. */
async function insertVoidFact(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
  args: { index: number; grossAmountMinor: number; quantity: number },
): Promise<void> {
  await ctx.db.insert("reportFact", {
    storeId,
    sourceDomain: "pos",
    sourceId: `void-${args.index}`,
    lineId: `void-${args.index}`,
    factKind: "void",
    fingerprint: `fp-void-${args.index}`,
    fingerprintVersion: 1,
    occurredAt: Date.parse(`${operatingDate}T10:00:00Z`),
    recordedAt: Date.parse(`${operatingDate}T10:00:00Z`),
    operatingDate,
    currency: "GHS",
    grossAmountMinor: -args.grossAmountMinor,
    netAmountMinor: -args.grossAmountMinor,
    taxAmountMinor: 0,
    discountAmountMinor: 0,
    quantity: -args.quantity,
  });
}

/** Insert one fact the fold EXCLUDES — quarantined, or in a currency other
 * than the store's — the source of the flagged-exclusion magnitude. */
async function insertExcludedFact(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
  args: {
    index: number;
    grossAmountMinor: number;
    quantity: number;
    kind: "quarantined" | "foreign";
  },
): Promise<void> {
  await ctx.db.insert("reportFact", {
    storeId,
    sourceDomain: "pos",
    sourceId: `excluded-${args.index}`,
    lineId: `excluded-${args.index}`,
    factKind: "sale",
    fingerprint: `fp-excluded-${args.index}`,
    fingerprintVersion: 1,
    occurredAt: Date.parse(`${operatingDate}T10:00:00Z`),
    recordedAt: Date.parse(`${operatingDate}T10:00:00Z`),
    operatingDate,
    currency: args.kind === "foreign" ? "USD" : "GHS",
    grossAmountMinor: args.grossAmountMinor,
    netAmountMinor: args.grossAmountMinor,
    taxAmountMinor: 0,
    discountAmountMinor: 0,
    quantity: args.quantity,
    ...(args.kind === "quarantined"
      ? { quarantine: { reason: "fingerprint_mismatch", detectedAt: 0 } }
      : {}),
  });
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

  it("U4 error path — a failing ledger write never fails the sweep's real work", async () => {
    const seeded = await seedStoreWithDay(t, MISMATCH);

    // Every scheduledRunLedger evidence write throws; the tick must still
    // verify the day, upsert the run row, and record the alert transition.
    const result = await runVerificationSweepWithCtx(
      sweepCtx(t, {
        failMutationWhen: (args) => "cronFamily" in args,
      }),
      { now: NOW },
    );

    expect(result.daysVerified).toBeGreaterThanOrEqual(1);
    expect(result.alertTransitions).toBe(1);
    const row = await runRow(t, seeded.storeId, "day", DAY1);
    expect(row?.outcome).toBe("mismatch");

    const ledgerRows = await t.run(async (ctx: MutationCtx) =>
      ctx.db.query("scheduledRunLedger").withIndex("by_runKey").take(10),
    );
    expect(
      ledgerRows.filter((r) => r.cronFamily === "report-verification-sweep"),
    ).toHaveLength(0);
  });

  it("records store-scope and system-scope ledger evidence for the tick", async () => {
    const seeded = await seedStoreWithDay(t, MISMATCH);

    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });

    const rows = await t.run(async (ctx: MutationCtx) =>
      ctx.db.query("scheduledRunLedger").withIndex("by_runKey").take(50),
    );
    const family = rows.filter(
      (row) => row.cronFamily === "report-verification-sweep",
    );
    const storeRow = family.find((row) => row.scope === "store");
    const systemRow = family.find((row) => row.scope === "system");

    expect(storeRow).toBeTruthy();
    expect(storeRow?.storeId).toBe(seeded.storeId);
    expect(storeRow?.succeededCount).toBeGreaterThanOrEqual(1);
    expect(storeRow?.outcome).toBe("applied");
    expect(storeRow?.sourceSubjectType).toBe("reportVerificationRun");

    expect(systemRow).toBeTruthy();
    expect(systemRow?.candidateCount).toBeGreaterThanOrEqual(1);
    expect(systemRow?.snapshotCounts?.daysVerified).toBeGreaterThanOrEqual(1);
  });

  it("re-running the same tick window reuses the ledger run key (idempotent)", async () => {
    await seedStoreWithDay(t, MISMATCH);

    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });
    const afterFirst = await t.run(async (ctx: MutationCtx) =>
      ctx.db.query("scheduledRunLedger").withIndex("by_runKey").take(50),
    );
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW + 1000 });
    const afterSecond = await t.run(async (ctx: MutationCtx) =>
      ctx.db.query("scheduledRunLedger").withIndex("by_runKey").take(50),
    );

    // Same 60-minute window -> upsert, not a second pair of rows...
    expect(afterSecond.length).toBe(afterFirst.length);
    // ...and the SAME rows, patched — an equal count alone would also pass if
    // the second tick had written nothing at all (T4).
    expect(afterSecond.map((row) => row._id).sort()).toEqual(
      afterFirst.map((row) => row._id).sort(),
    );
    const firstStore = afterFirst.find((row) => row.scope === "store")!;
    const secondStore = afterSecond.find((row) => row._id === firstStore._id)!;
    expect(secondStore.updatedAt).toBeGreaterThan(firstStore.updatedAt);
    expect(secondStore.completedAt).toBeGreaterThan(firstStore.completedAt);
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

    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW + 1 });
    // DAY1 itself is untouched. (The tick is not necessarily idle: the
    // bounded forward stall probe drains one never-folded recent date per
    // tick — see VERIFICATION_STALL_PROBE_SLOTS.)
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

    // Quiet: no re-verify of the legacy day while no revision is stamped.
    const firstVerifiedAt = row?.verifiedAt;
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW + 1 });
    expect((await runRow(t, seeded.storeId, "day", DAY1))?.verifiedAt).toBe(
      firstVerifiedAt,
    );

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

    // T5 — the threshold is a real threshold: nothing escalates before it.
    for (let tick = 0; tick < VERIFICATION_WEDGE_THRESHOLD - 1; tick += 1) {
      await runVerificationSweepWithCtx(failing, { now: NOW + tick });
    }
    expect(await operationalEventsFor(t, seeded.storeId)).toHaveLength(0);

    for (
      let tick = VERIFICATION_WEDGE_THRESHOLD - 1;
      tick < VERIFICATION_WEDGE_THRESHOLD + 1;
      tick += 1
    ) {
      await runVerificationSweepWithCtx(failing, { now: NOW + tick });
    }
    // Threshold + 1 incomplete ticks → exactly ONE operational event (the
    // next rung of the ladder is much further out).
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

  it("M1 — a store that stays wedged re-escalates up a ladder instead of going silent", async () => {
    const seeded = await seedStoreWithDay(t);
    const failing = sweepCtx(t, {
      failQueryWhen: (args) => args.operatingDate === DAY1,
    });

    // 24 consecutive incomplete ticks: rung 1 at the threshold, rung 2 at 24.
    for (let tick = 0; tick < 24; tick += 1) {
      await runVerificationSweepWithCtx(failing, { now: NOW + tick });
    }
    expect(await operationalEventsFor(t, seeded.storeId)).toHaveLength(2);
  });

  it("M1 — the escalation ladder is threshold, ~1 day, ~1 week, then weekly", () => {
    expect(shouldEscalateWedge(1)).toBe(false);
    expect(shouldEscalateWedge(VERIFICATION_WEDGE_THRESHOLD)).toBe(true);
    expect(shouldEscalateWedge(VERIFICATION_WEDGE_THRESHOLD + 1)).toBe(false);
    expect(shouldEscalateWedge(24)).toBe(true);
    expect(shouldEscalateWedge(25)).toBe(false);
    expect(shouldEscalateWedge(168)).toBe(true);
    expect(shouldEscalateWedge(168 + 168)).toBe(true);
    expect(shouldEscalateWedge(200)).toBe(false);
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
    // Gate OFF wrote NO intent row — the counter is a proxy; this is the fact.
    expect(await notificationIntentsFor(t, seeded.storeId)).toHaveLength(0);

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

    // T1 — exactly ONE intent, and its dedupeKey carries the SAME fingerprint
    // and epoch the run row recorded. This is the link that could silently
    // break (row epoch N, payload epoch N-1) and nothing else covers it.
    const intents = await notificationIntentsFor(t, seeded.storeId);
    expect(intents).toHaveLength(1);
    const row = (await runRow(t, seeded.storeId, "day", DAY1))!;
    expect(intents[0]!.dedupeKey).toBe(
      expectedDedupeKey(seeded.storeId, "day", DAY1, row),
    );
    expect(intents[0]!.payload.fingerprint).toBe(row.unexplainedFingerprint);
    expect(intents[0]!.payload.reArmEpoch).toBe(row.reArmEpoch);
    expect(intents[0]!.payload.alertSeq).toBe(row.alertSeq);
  });

  it("T2 — a break, a repair, and an identical re-break emit exactly 2 intents differing only in epoch", async () => {
    const seeded = await seedStoreWithDay(t, MISMATCH);
    process.env[REPORTS_VERIFICATION_ALERT_EMAILS_ENV] = String(seeded.storeId);

    // 1. Break.
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });
    // 2. Repair + revision bump → clean, streak cleared, epoch re-armed.
    await patchDay(t, seeded.storeId, DAY1, {
      grossSalesMinor: 0,
      netSalesMinor: 0,
      certifiedFoldRevision: 2,
    });
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW + 1 });
    expect((await runRow(t, seeded.storeId, "day", DAY1))?.outcome).toBe(
      "clean",
    );
    // 3. Re-break to the IDENTICAL numbers → identical fingerprint, new epoch.
    await patchDay(t, seeded.storeId, DAY1, {
      ...MISMATCH,
      certifiedFoldRevision: 3,
    });
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW + 2 });

    const intents = await notificationIntentsFor(t, seeded.storeId);
    expect(intents).toHaveLength(2);
    const keys = intents.map((intent) => intent.dedupeKey);
    expect(new Set(keys).size).toBe(2);
    // Same fingerprint on both; only the epoch component differs.
    expect(intents[0]!.payload.fingerprint).toBe(
      intents[1]!.payload.fingerprint,
    );
    expect(
      new Set(intents.map((intent) => intent.payload.reArmEpoch)).size,
    ).toBe(2);
  });

  it("T2b — an A→B→A oscillation inside ONE streak emits 3 intents distinguished only by alertSeq", async () => {
    // The epoch path (break → repair → re-break) is covered above and would
    // pass without `alertSeq` in the dedupeKey, because the epoch already
    // differs there. THIS is the case alertSeq exists for: the fingerprint
    // returns to a previously-alerted value with NO clean run in between, so
    // the epoch is frozen and (store, subject, fingerprint, epoch) repeats
    // byte-for-byte. Without alertSeq the rail's permanent dedupe drops the
    // third emission while the run row claims an alert went out.
    const seeded = await seedStoreWithDay(t, MISMATCH);
    process.env[REPORTS_VERIFICATION_ALERT_EMAILS_ENV] = String(seeded.storeId);

    // A.
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });
    // B — different wrong numbers, never clean.
    await patchDay(t, seeded.storeId, DAY1, {
      grossSalesMinor: 700,
      netSalesMinor: 700,
      certifiedFoldRevision: 2,
    });
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW + 1 });
    // Back to A — same numbers as the first break, still no clean run.
    await patchDay(t, seeded.storeId, DAY1, {
      ...MISMATCH,
      certifiedFoldRevision: 3,
    });
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW + 2 });

    const intents = (await notificationIntentsFor(t, seeded.storeId)).sort(
      (left, right) => left._creationTime - right._creationTime,
    );
    expect(intents).toHaveLength(3);
    expect(new Set(intents.map((intent) => intent.dedupeKey)).size).toBe(3);

    const [first, , third] = intents;
    // First and third are the SAME discrepancy in the SAME re-arm generation.
    expect(third!.payload.fingerprint).toBe(first!.payload.fingerprint);
    expect(third!.payload.reArmEpoch).toBe(first!.payload.reArmEpoch);
    // The epoch never moved at all — no clean run ever happened.
    expect(
      new Set(intents.map((intent) => intent.payload.reArmEpoch)).size,
    ).toBe(1);
    // ...so alertSeq is the ONLY thing separating their identities.
    expect(intents.map((intent) => intent.payload.alertSeq)).toEqual([1, 2, 3]);
  });

  it("alertSeq survives the round trip through the run row instead of restarting each tick", async () => {
    // `payload.alertSeq === row.alertSeq` is self-consistent and would hold
    // even if the counter reset to 0 on every tick. Assert a concrete value.
    const seeded = await seedStoreWithDay(t, MISMATCH);

    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });
    expect((await runRow(t, seeded.storeId, "day", DAY1))?.alertSeq).toBe(1);

    await patchDay(t, seeded.storeId, DAY1, {
      grossSalesMinor: 700,
      netSalesMinor: 700,
      certifiedFoldRevision: 2,
    });
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW + 1 });
    expect((await runRow(t, seeded.storeId, "day", DAY1))?.alertSeq).toBe(2);
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

    // Advanced materialization, but still inside the minimum interval: gated
    // out. This is the H1 bound — `materializedAt` is re-stamped on every
    // weekly rebuild (~5 minutes for an active store), so the revision alone
    // never bounds weekly cost.
    await seedWeekCurrent(seeded.storeId, NOW + 5);
    const withinInterval = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW + 6,
    });
    expect(withinInterval.weeksVerified).toBe(0);

    // Past the interval AND re-materialized: re-verified.
    const third = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW + WEEK_INTERVAL_MS + 10,
    });
    expect(third.weeksVerified).toBe(1);
  });

  it("bounds weekly cost for a store that re-materializes every tick (H1)", async () => {
    const seeded = await t.run(async (ctx: MutationCtx) => seedStore(ctx));
    allowlist([seeded.storeId]);

    // Simulate the real pipeline: the 5-minute reports sweep re-materializes
    // the week before every hourly verification tick.
    let verified = 0;
    const HOUR = 60 * 60 * 1000;
    for (let tick = 0; tick < 12; tick += 1) {
      const now = NOW + tick * HOUR;
      await seedWeekCurrent(seeded.storeId, now - 60_000);
      const result = await runVerificationSweepWithCtx(sweepCtx(t), { now });
      verified += result.weeksVerified;
    }

    // Ungated this would be 12. Bounded to one per interval: 12h / 6h = 2.
    expect(verified).toBe(Math.floor((12 * HOUR) / WEEK_INTERVAL_MS));
  });

  it("records `truncated` without running a weekly verification over the read budget (H2)", async () => {
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedStore(ctx);
      // One allocation past the pre-flight probe cap, inside the union window.
      for (
        let index = 0;
        index < VERIFICATION_WEEK_ALLOCATION_PROBE + 1;
        index += 1
      ) {
        await seedPaymentAllocation(ctx, store, {
          amount: 1,
          recordedAt: NOW - 60_000 - index * 1_000,
          targetId: `probe-${index}`,
        });
      }
      return store;
    });
    allowlist([seeded.storeId]);
    await seedWeekCurrent(seeded.storeId, NOW - 10);

    const result = await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });

    expect(result.weeksOverBudget).toBe(1);
    expect(result.subjectsErrored).toBe(0);
    const row = await runRow(t, seeded.storeId, "week", "current");
    // Honest could-not-check, never alertable — NOT `error`.
    expect(row?.outcome).toBe("truncated");
    expect(row?.lastAlertedFingerprint).toBeUndefined();
  });
});

describe("verification sweep — void attribution, stalls, and honest evidence", () => {
  let t: Harness;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("T3 — attributes a 2x-void delta to the void sign convention, never alerting", async () => {
    // The fold ADDS void amounts where the verifier subtracts them, so a day
    // whose voids total R/U reads exactly 2R / 2U high against an empty
    // domain. That exact-delta identity is the only defensible signal.
    const VOID_REVENUE = 3_500;
    const VOID_UNITS = 2;
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedStore(ctx);
      await insertReportDay(ctx, store.storeId, DAY1, {
        grossSalesMinor: 2 * VOID_REVENUE,
        netSalesMinor: 2 * VOID_REVENUE,
        unitsSold: 2 * VOID_UNITS,
      });
      await insertVoidFact(ctx, store.storeId, DAY1, {
        index: 0,
        grossAmountMinor: VOID_REVENUE,
        quantity: VOID_UNITS,
      });
      return store;
    });
    allowlist([seeded.storeId]);

    const result = await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });

    const row = await runRow(t, seeded.storeId, "day", DAY1);
    expect(row?.outcome).toBe("mismatch");
    expect(row?.unexplainedDifferences).toEqual([]);
    expect(row?.explainedDifferences.length).toBeGreaterThan(0);
    expect(
      row?.explainedDifferences.every(
        (difference) => difference.classification === "void_sign_convention",
      ),
    ).toBe(true);
    expect(result.alertTransitions).toBe(0);
    expect(row?.unexplainedFingerprint).toBeUndefined();
  });

  it("T3 — a day over the void fact scan cap supplies NO attribution", async () => {
    const VOID_REVENUE = 1;
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedStore(ctx);
      await insertReportDay(ctx, store.storeId, DAY1, {
        grossSalesMinor: 2 * (VERIFICATION_VOID_FACT_SCAN + 1) * VOID_REVENUE,
        netSalesMinor: 2 * (VERIFICATION_VOID_FACT_SCAN + 1) * VOID_REVENUE,
      });
      for (let index = 0; index <= VERIFICATION_VOID_FACT_SCAN; index += 1) {
        await insertVoidFact(ctx, store.storeId, DAY1, {
          index,
          grossAmountMinor: VOID_REVENUE,
          quantity: 0,
        });
      }
      return store;
    });
    allowlist([seeded.storeId]);

    const result = await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });

    const row = await runRow(t, seeded.storeId, "day", DAY1);
    expect(row?.outcome).toBe("mismatch");
    // No attribution beats a truncated (wrong) one: the differences stay
    // unexplained and the subject alerts.
    expect(row?.unexplainedDifferences.length).toBeGreaterThan(0);
    expect(result.alertTransitions).toBe(1);
  });

  it("T3b — a quarantined fact explains a delta WITHIN its own magnitude and nothing beyond it", async () => {
    // The fold drops quarantined/foreign-currency facts; the verifier has no
    // quarantine visibility and counts them. The flag alone must not license
    // an arbitrary delta, so the sweep sources the excluded facts' own worth
    // and the classifier bounds the explanation by it. Without the sweep
    // supplying that magnitude the classifier explains NOTHING and this day
    // alerts.
    const EXCLUDED = 6_000;
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedStore(ctx);
      await insertReportDay(ctx, store.storeId, DAY1, {
        grossSalesMinor: EXCLUDED,
        netSalesMinor: EXCLUDED,
        flags: {
          mixedCurrency: false,
          hasUncostedRevenue: false,
          quarantinedFactCount: 1,
        },
      });
      await insertExcludedFact(ctx, store.storeId, DAY1, {
        index: 0,
        grossAmountMinor: EXCLUDED,
        quantity: 0,
        kind: "quarantined",
      });
      return store;
    });
    allowlist([seeded.storeId]);

    const result = await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });
    const row = await runRow(t, seeded.storeId, "day", DAY1);
    expect(row?.outcome).toBe("mismatch");
    expect(row?.unexplainedDifferences).toEqual([]);
    expect(
      row?.explainedDifferences.every(
        (difference) => difference.classification === "flagged_exclusions",
      ),
    ).toBe(true);
    expect(result.alertTransitions).toBe(0);

    // Same single quarantined fact, a fold defect an order of magnitude past
    // its worth: the flag no longer covers it and the day alerts.
    await patchDay(t, seeded.storeId, DAY1, {
      grossSalesMinor: EXCLUDED * 100,
      netSalesMinor: EXCLUDED * 100,
      certifiedFoldRevision: 2,
    });
    const escalated = await runVerificationSweepWithCtx(sweepCtx(t), {
      now: NOW + 1,
    });
    const alerted = await runRow(t, seeded.storeId, "day", DAY1);
    expect(alerted?.unexplainedDifferences.length).toBeGreaterThan(0);
    expect(escalated.alertTransitions).toBe(1);
  });

  it("T3b — a foreign-currency fact is sourced the same way as a quarantined one", async () => {
    const EXCLUDED_UNITS = 4;
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedStore(ctx);
      await insertReportDay(ctx, store.storeId, DAY1, {
        unitsSold: EXCLUDED_UNITS,
        flags: {
          mixedCurrency: true,
          hasUncostedRevenue: false,
          quarantinedFactCount: 0,
        },
      });
      await insertExcludedFact(ctx, store.storeId, DAY1, {
        index: 0,
        grossAmountMinor: 0,
        quantity: EXCLUDED_UNITS,
        kind: "foreign",
      });
      return store;
    });
    allowlist([seeded.storeId]);

    const result = await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });
    const row = await runRow(t, seeded.storeId, "day", DAY1);
    expect(row?.outcome).toBe("mismatch");
    expect(row?.unexplainedDifferences).toEqual([]);
    expect(result.alertTransitions).toBe(0);
  });

  it("T3b — a day over the fact scan cap supplies NO flagged attribution either", async () => {
    // Fail-closed, exactly like the void path: a partial sum is a lower bound
    // and a lower bound used as an explanation ceiling would bless defects.
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedStore(ctx);
      await insertReportDay(ctx, store.storeId, DAY1, {
        grossSalesMinor: VERIFICATION_VOID_FACT_SCAN + 1,
        netSalesMinor: VERIFICATION_VOID_FACT_SCAN + 1,
        flags: {
          mixedCurrency: false,
          hasUncostedRevenue: false,
          quarantinedFactCount: VERIFICATION_VOID_FACT_SCAN + 1,
        },
      });
      for (let index = 0; index <= VERIFICATION_VOID_FACT_SCAN; index += 1) {
        await insertExcludedFact(ctx, store.storeId, DAY1, {
          index,
          grossAmountMinor: 1,
          quantity: 0,
          kind: "quarantined",
        });
      }
      return store;
    });
    allowlist([seeded.storeId]);

    const result = await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });
    const row = await runRow(t, seeded.storeId, "day", DAY1);
    expect(row?.outcome).toBe("mismatch");
    expect(row?.unexplainedDifferences.length).toBeGreaterThan(0);
    expect(result.alertTransitions).toBe(1);
  });

  it("C3 — a stalled fold surfaces as a missing recent day, not silence", async () => {
    // Folding stopped on DAY1; the backwards-only probe would re-derive the
    // same anchor forever and report clean.
    const seeded = await seedStoreWithDay(t);
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });

    // The newest settled date (yesterday, store-local) has no reportDay row.
    const yesterday = "2026-03-09";
    const probed = await runRow(t, seeded.storeId, "day", yesterday);
    expect(probed).not.toBeNull();
    // Quiet store: honest clean. The point is that the date was LOOKED AT —
    // real source activity on it would produce metric differences here.
    expect(probed?.outcome).toBe("clean");
  });

  it("M2 — permanently failing recent days cannot starve the rest of the lookback", async () => {
    const dates = ["2026-03-05", "2026-03-04", "2026-03-03", "2026-03-02"];
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedStore(ctx);
      for (const date of dates) await insertReportDay(ctx, store.storeId, date);
      await insertReportDay(ctx, store.storeId, "2026-03-01");
      return store;
    });
    allowlist([seeded.storeId]);

    // Poison the four most recent days for the first tick.
    const failing = sweepCtx(t, {
      failQueryWhen: (args) => dates.includes(args.operatingDate as string),
    });
    await runVerificationSweepWithCtx(failing, { now: NOW });

    // Keep them failing forever; the oldest day must still get verified.
    for (let tick = 1; tick <= 4; tick += 1) {
      await runVerificationSweepWithCtx(failing, { now: NOW + tick });
    }
    expect(await runRow(t, seeded.storeId, "day", "2026-03-01")).not.toBeNull();
    // And the error rows rotate through the single reserved slot rather than
    // one row monopolising it.
    const errored = await Promise.all(
      dates.map((date) => runRow(t, seeded.storeId, "day", date)),
    );
    expect(errored.filter((row) => row?.outcome === "error").length).toBe(4);
  });

  it("M2 — the single error slot is spent on the OLDEST-verified error row each tick", async () => {
    // The cap is proven above; this proves the ROTATION. Four error rows all
    // stamped at tick 0 would satisfy the cap assertion under any ordering —
    // only watching WHICH row gets re-touched each tick can catch a
    // newest-first (or unsorted) error pool that starves the others.
    // Three, so tick 0 fits them all inside the per-store budget alongside
    // the forward stall probe's slot and every row starts equally stale.
    const dates = ["2026-03-05", "2026-03-04", "2026-03-03"];
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedStore(ctx);
      for (const date of dates) await insertReportDay(ctx, store.storeId, date);
      return store;
    });
    allowlist([seeded.storeId]);
    const failing = sweepCtx(t, {
      failQueryWhen: (args) => dates.includes(args.operatingDate as string),
    });

    // Tick 0 fills all four slots, so every row carries the SAME verifiedAt.
    await runVerificationSweepWithCtx(failing, { now: NOW });

    async function verifiedAts(): Promise<Map<string, number>> {
      const rows = await Promise.all(
        dates.map((date) => runRow(t, seeded.storeId, "day", date)),
      );
      return new Map(
        rows.map((row, index) => [dates[index]!, row!.verifiedAt]),
      );
    }
    const start = await verifiedAts();
    expect(new Set(start.values()).size).toBe(1);

    const touchedOrder: string[] = [];
    for (let tick = 1; tick <= 3; tick += 1) {
      const before = await verifiedAts();
      await runVerificationSweepWithCtx(failing, { now: NOW + tick });
      const after = await verifiedAts();
      const touched = dates.filter(
        (date) => after.get(date) !== before.get(date),
      );
      // Exactly one error subject per tick (the slot cap), and it is one of
      // the least-recently-verified rows.
      expect(touched).toHaveLength(1);
      const oldest = Math.min(...before.values());
      expect(before.get(touched[0]!)).toBe(oldest);
      touchedOrder.push(touched[0]!);
    }
    // Over three ticks every failing subject gets its turn — the property the
    // rotation exists for.
    expect(new Set(touchedOrder).size).toBe(3);
  });

  it("C3 — a caught-up store produces no stall-probe subject at all", async () => {
    // The probe walks back from yesterday and breaks at the first date <=
    // anchor. This store's anchor is today's OPEN row, so the walk breaks on
    // iteration 0 and never reaches 2026-03-07 — a date that is missing, is
    // inside VERIFICATION_STALL_PROBE_DAYS of yesterday, and is NOT reachable
    // as an ordinary candidate (the backwards missing-day probe only covers
    // 03-09/03-08, both of which exist). Drop the `break` and 03-07 becomes a
    // stall subject; keep it and a healthy store pays no extra reads.
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedStore(ctx);
      await insertReportDay(ctx, store.storeId, "2026-03-10", {
        status: "open",
      });
      for (const date of ["2026-03-09", "2026-03-08", "2026-03-06"]) {
        await insertReportDay(ctx, store.storeId, date);
      }
      return store;
    });
    allowlist([seeded.storeId]);

    const selection = await t.query(
      internal.reports.verificationSweep.selectVerificationDaySubjects,
      { storeId: seeded.storeId, reVerify: false, now: NOW },
    );
    expect(selection.dates).not.toContain("2026-03-07");
    // Every selected subject is a real folded day: no probe date at all.
    expect(selection.dates.sort()).toEqual([
      "2026-03-06",
      "2026-03-08",
      "2026-03-09",
    ]);

    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });
    expect(await runRow(t, seeded.storeId, "day", "2026-03-07")).toBeNull();
  });

  it("M3 — a crashed selection records a FAILED ledger row, not a successful one", async () => {
    const seeded = await seedStoreWithDay(t, MISMATCH);

    const result = await runVerificationSweepWithCtx(
      sweepCtx(t, {
        // Both selection queries take `reVerify`/`now`; fail the day one.
        failQueryWhen: (args) => "reVerify" in args,
      }),
      { now: NOW },
    );
    expect(result.subjectsErrored).toBeGreaterThanOrEqual(1);
    expect(result.storesIncomplete).toBe(1);

    const rows = await t.run(async (ctx: MutationCtx) =>
      ctx.db.query("scheduledRunLedger").withIndex("by_runKey").take(50),
    );
    const family = rows.filter(
      (row) => row.cronFamily === "report-verification-sweep",
    );
    const storeRow = family.find((row) => row.scope === "store")!;
    const systemRow = family.find((row) => row.scope === "system")!;
    expect(storeRow.failedCount).toBeGreaterThanOrEqual(1);
    expect(storeRow.outcome).not.toBe("applied");
    expect(storeRow.outcome).not.toBe("no_candidates");
    // The system row must not claim every store succeeded.
    expect(systemRow.failedCount).toBe(1);
    expect(systemRow.succeededCount).toBe(0);
  });

  it("C1 — a partial run keeps the streak's tracked field list instead of wiping it", async () => {
    const seeded = await seedStoreWithDay(t, MISMATCH);
    await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });
    const broken = await runRow(t, seeded.storeId, "day", DAY1);
    const trackedFields = broken!.unexplainedDifferences.map((d) => d.field);
    expect(trackedFields.length).toBeGreaterThan(0);

    // A carry-forward run (here: `error`, which neither clears nor alerts).
    await patchDay(t, seeded.storeId, DAY1, { certifiedFoldRevision: 2 });
    await runVerificationSweepWithCtx(
      sweepCtx(t, { failQueryWhen: (args) => args.operatingDate === DAY1 }),
      { now: NOW + 1 },
    );

    const carried = await runRow(t, seeded.storeId, "day", DAY1);
    expect(carried?.outcome).toBe("error");
    // The fingerprint survived, so the FIELD LIST behind it must survive too —
    // otherwise the next tick confirms cleanliness vacuously.
    expect(carried?.unexplainedFingerprint).toBe(
      broken?.unexplainedFingerprint,
    );
    expect(carried?.unexplainedDifferences.map((d) => d.field)).toEqual(
      trackedFields,
    );
  });

  it("T6 — reports clean for a store with REAL activity that folded correctly", async () => {
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedStore(ctx);
      await seedPosSale(ctx, store, {
        completedAt: Date.parse(`${DAY1}T10:00:00Z`),
        lines: [{ quantity: 2, unitPrice: 5_000 }],
        tax: 500,
        transactionNumber: "T-1",
      });
      await seedPaymentAllocation(ctx, store, {
        amount: 10_500,
        recordedAt: Date.parse(`${DAY1}T13:00:00Z`),
        targetId: "T-1",
      });
      return store;
    });
    // Build the fold the way production does: reseed facts, fold the dirty
    // days, drain the marks.
    let cursor: ReseedCursor = normalizeReseedCursor(undefined);
    for (let step = 0; step < 300; step += 1) {
      const progress = await t.run(async (ctx: MutationCtx) =>
        reseedStep(ctx, seeded.storeId, cursor),
      );
      if (progress.cursor === null) break;
      cursor = progress.cursor;
    }
    await t.run(async (ctx: MutationCtx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fixture read
      const marks = await ctx.db
        .query("reportDirtyDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", seeded.storeId),
        )
        .collect();
      for (const mark of marks) {
        await foldAndReplaceDay(ctx, seeded.storeId, mark.operatingDate, NOW);
        await ctx.db.delete("reportDirtyDay", mark._id);
      }
    });
    allowlist([seeded.storeId]);

    const result = await runVerificationSweepWithCtx(sweepCtx(t), { now: NOW });

    expect(result.daysVerified).toBeGreaterThanOrEqual(1);
    // No false positive on a genuinely-folded day of real sales.
    expect(result.alertTransitions).toBe(0);
    const row = await runRow(t, seeded.storeId, "day", DAY1);
    expect(row).not.toBeNull();
    expect(row?.unexplainedDifferences).toEqual([]);
    expect(["clean", "partial"]).toContain(row?.outcome);
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
