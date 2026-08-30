/// <reference types="vite/client" />

import { convexTest, type TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { markDirty } from "./marks";
import {
  claimDayWorkWithCtx,
  processDayWorkWithCtx,
  REPORT_DAY_LEASE_MS,
  type ReportDayClaim,
} from "./pipelineDays";
import { dispatchDayWorkWithCtx } from "./pipelineDispatch";
import { recordReadCosts } from "./readCostTestSupport";
import {
  MAX_FACTS_PER_DAY,
  REPORTS_SWEEP_STORE_ALLOWLIST_ENV,
} from "./sweeper";

// Match the registered-function suites (reseed/rangeSnapshotLifecycle): Vite
// emits sibling files as ./... while parent files retain ../..., so normalize
// both to the Convex root before exercising deployed function references.
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./reports/"),
    loader,
  ]),
);
const NOW = Date.parse("2026-08-29T12:00:00.000Z");
const OPERATING_DATE = "2026-08-28";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function seedStore(
  ctx: MutationCtx,
  slug: string,
  mode: "active" | "paused" = "active",
) {
  const userId = await ctx.db.insert("athenaUser", { email: `${slug}@test` });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: slug,
    slug,
  });
  const storeId = await ctx.db.insert("store", {
    createdByUserId: userId,
    organizationId,
    currency: "GHS",
    name: slug,
    slug,
    config: { timezone: "UTC" },
  });
  const controlId = await ctx.db.insert("reportPipelineControl", {
    storeId,
    mode,
    fence: 1,
    sourceWatermark: 0,
  });
  return { storeId, controlId };
}

async function seedFacts(
  ctx: MutationCtx,
  storeId: Id<"store">,
  count: number,
) {
  for (let index = 0; index < count; index += 1) {
    await ctx.db.insert("reportFact", {
      storeId,
      sourceDomain: "pos",
      sourceId: `${storeId}-sale-${index}`,
      lineId: `line-${index}`,
      factKind: "sale",
      fingerprint: `fingerprint-${index}`,
      fingerprintVersion: 2,
      occurredAt: NOW - 1,
      recordedAt: NOW - 1,
      observedAt: NOW - 1,
      operatingDate: OPERATING_DATE,
      currency: "GHS",
      grossAmountMinor: 100,
      netAmountMinor: 100,
      taxAmountMinor: 0,
      discountAmountMinor: 0,
      quantity: 1,
    });
  }
}

async function claimDay(
  t: ReturnType<typeof convexTest>,
  storeId: Id<"store">,
) {
  await t.run((ctx) =>
    markDirty(ctx, storeId, OPERATING_DATE, "late_fact", NOW),
  );
  const claim = await t.run((ctx) => claimDayWorkWithCtx(ctx, storeId, NOW));
  if (!claim) throw new Error("Expected an active fixture day claim");
  return claim;
}

async function readStoreProjection(
  t: TestConvex<typeof schema>,
  storeId: Id<"store">,
) {
  return t.run(async (ctx) => ({
    day: await ctx.db
      .query("reportDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", storeId).eq("operatingDate", OPERATING_DATE),
      )
      .unique(),
    work: await ctx.db
      .query("reportPipelineWork")
      .withIndex("by_storeId_workKey", (q) => q.eq("storeId", storeId))
      .take(20),
    control: await ctx.db
      .query("reportPipelineControl")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .unique(),
  }));
}

describe("reports dispatch and transaction isolation", () => {
  it("dispatches allowed legacy days despite 61 foreign day marks, 11 foreign week marks, and ineligible allowlisted stores", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const foreign = await seedStore(ctx, "foreign-day-backlog");
      const blockedDays: Id<"reportDirtyDay">[] = [];
      for (let index = 0; index < 61; index += 1) {
        blockedDays.push(
          await ctx.db.insert("reportDirtyDay", {
            storeId: foreign.storeId,
            operatingDate: new Date(Date.UTC(2026, 0, index + 1))
              .toISOString()
              .slice(0, 10),
            markedAt: NOW - 10_000 + index,
            reason: "write_failure",
          }),
        );
      }
      const blockedWeeks: Id<"reportDirtyWeek">[] = [];
      for (let index = 0; index < 11; index += 1) {
        const blocked = await seedStore(ctx, `foreign-week-${index}`);
        blockedWeeks.push(
          await ctx.db.insert("reportDirtyWeek", {
            storeId: blocked.storeId,
            markedAt: NOW - 10_000 + index,
            reason: "write_failure",
          }),
        );
      }
      const first = await seedStore(ctx, "allowed-first");
      const second = await seedStore(ctx, "allowed-second");
      const paused = await seedStore(ctx, "allowed-paused", "paused");
      const reseeding = await seedStore(ctx, "allowed-reseeding");
      await ctx.db.patch("store", reseeding.storeId, {
        reportingReseedStartedAt: NOW,
      });
      const legacyIds = new Map<string, Id<"reportDirtyDay">>();
      for (const store of [first, second, paused, reseeding]) {
        legacyIds.set(
          String(store.storeId),
          await ctx.db.insert("reportDirtyDay", {
            storeId: store.storeId,
            operatingDate: OPERATING_DATE,
            markedAt: NOW - 1,
            reason: "late_fact",
            // Deliberately no eligibleAt, generation, or dispatchFence: migrated
            // legacy work must be eligible without needing a fresh source write.
          }),
        );
        await markDirty(ctx, store.storeId, "2026-08-29", "day_open", NOW);
      }
      return {
        first,
        second,
        paused,
        reseeding,
        blockedDays,
        blockedWeeks,
        legacyIds: [...legacyIds],
      };
    });
    const allowlisted = [
      fixture.first,
      fixture.second,
      fixture.paused,
      fixture.reseeding,
    ];
    vi.stubEnv(
      REPORTS_SWEEP_STORE_ALLOWLIST_ENV,
      allowlisted.map((row) => row.storeId).join(","),
    );

    const dispatch = async (now: number) =>
      t.run(async (ctx) => {
        const recorder = recordReadCosts(ctx);
        const claims: ReportDayClaim[] = [];
        // Only the scheduling port is fake. Selection, cursor, allowlist/control
        // admission, legacy eligibility and lease writes use the real database.
        // This deliberately does not claim to prove durable scheduler delivery.
        const runAfter: MutationCtx["scheduler"]["runAfter"] = async (
          _delay,
          _reference,
          ...args
        ) => {
          claims.push(args[0] as ReportDayClaim);
          return "fake-scheduled-id" as Id<"_scheduled_functions">;
        };
        const scheduled = await dispatchDayWorkWithCtx(
          {
            ...recorder.ctx,
            scheduler: { ...ctx.scheduler, runAfter },
          },
          now,
        );
        return { scheduled, claims, cost: recorder.snapshot() };
      });
    const first = await dispatch(NOW);
    expect(first.scheduled).toBe(2);
    expect(new Set(first.claims.map((claim) => claim.storeId))).toEqual(
      new Set([fixture.first.storeId, fixture.second.storeId]),
    );
    const legacyIds = new Map(fixture.legacyIds);
    for (const claim of first.claims) {
      expect(claim).toMatchObject({
        markId: legacyIds.get(String(claim.storeId)),
        operatingDate: OPERATING_DATE,
        generation: 0,
        dispatchFence: 1,
      });
      const mark = await t.run((ctx) =>
        ctx.db.get("reportDirtyDay", claim.markId),
      );
      expect(mark).toMatchObject({
        claimedAt: NOW,
        eligibleAt: NOW + REPORT_DAY_LEASE_MS,
      });
    }
    expect(first.cost.byTable.reportDirtyDay.returnedDocuments).toBe(2);
    expect(first.cost.byTable.reportDirtyWeek).toBeUndefined();
    expect(first.cost.byTable.reportFact).toBeUndefined();
    expect(first.cost.byTable.dailyClose).toBeUndefined();
    const second = await dispatch(NOW + 1);
    expect(second.scheduled).toBe(2);
    expect(second.claims.map((claim) => claim.operatingDate)).toEqual([
      "2026-08-29",
      "2026-08-29",
    ]);
    expect((await dispatch(NOW + 2)).scheduled).toBe(0);
    await t.run(async (ctx) => {
      for (const id of fixture.blockedDays) {
        const row = await ctx.db.get("reportDirtyDay", id);
        expect(row).not.toBeNull();
        expect(row?.claimedAt).toBeUndefined();
      }
      for (const id of fixture.blockedWeeks)
        expect(await ctx.db.get("reportDirtyWeek", id)).not.toBeNull();
    });
  });

  it.each([
    "control-fence",
    "paused",
    "shadow",
    "reseed",
    "allowlist",
  ] as const)(
    "defers a claimed day after a %s transition without changing projections or losing its mark",
    async (transition) => {
      const t = convexTest(schema, modules);
      const store = await t.run((ctx) =>
        seedStore(ctx, `transition-${transition}`),
      );
      vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(store.storeId));
      const claim = await claimDay(t, store.storeId);
      if (transition === "allowlist")
        vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, "");
      else
        await t.run(async (ctx) => {
          if (transition === "control-fence")
            await ctx.db.patch("reportPipelineControl", store.controlId, {
              fence: 2,
            });
          else if (transition === "reseed")
            await ctx.db.patch("store", store.storeId, {
              reportingReseedStartedAt: NOW + 1,
            });
          else
            await ctx.db.patch("reportPipelineControl", store.controlId, {
              mode: transition,
            });
        });
      expect(
        await t.run((ctx) => processDayWorkWithCtx(ctx, claim, NOW + 1)),
      ).toBe("deferred");
      const projection = await readStoreProjection(t, store.storeId);
      expect(projection.day).toBeNull();
      expect(projection.work).toEqual([]);
      expect(projection.control?.sourceWatermark).toBe(0);
      expect(
        await t.run((ctx) => ctx.db.get("reportDirtyDay", claim.markId)),
      ).toMatchObject({
        generation: claim.generation,
        dispatchFence: claim.dispatchFence,
      });
    },
  );

  it("rolls back a real partial fold and first handoff on an injected second-handoff failure, then records failure separately", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW + 1);
    const t = convexTest(schema, modules);
    const { healthy, failing } = await t.run(async (ctx) => {
      const healthy = await seedStore(ctx, "committed-store");
      const failing = await seedStore(ctx, "handoff-failure-store");
      await seedFacts(ctx, healthy.storeId, 1);
      await seedFacts(ctx, failing.storeId, 1);
      return { healthy, failing };
    });
    vi.stubEnv(
      REPORTS_SWEEP_STORE_ALLOWLIST_ENV,
      `${healthy.storeId},${failing.storeId}`,
    );
    const healthyClaim = await claimDay(t, healthy.storeId);
    expect(
      await t.run((ctx) => processDayWorkWithCtx(ctx, healthyClaim, NOW + 1)),
    ).toBe("applied");
    const committed = await readStoreProjection(t, healthy.storeId);
    expect(committed.day?.netSalesMinor).toBe(100);
    const failingClaim = await claimDay(t, failing.storeId);
    const reached = { folded: false, firstHandoff: false };
    await expect(
      t.run(async (ctx) => {
        const db = new Proxy(ctx.db, {
          get(target, property) {
            const original: unknown = Reflect.get(target, property);
            if (typeof original !== "function") return original;
            if (property !== "insert") return original.bind(target);
            return async (...args: unknown[]) => {
              const value = args[1] as { kind?: string };
              if (args[0] === "reportPipelineWork" && value.kind === "resolve-week-date") {
                const day = await ctx.db
                  .query("reportDay")
                  .withIndex("by_storeId_operatingDate", (q) =>
                    q
                      .eq("storeId", failing.storeId)
                      .eq("operatingDate", OPERATING_DATE),
                  )
                  .unique();
                const first = await ctx.db
                  .query("reportPipelineWork")
                  .withIndex("by_storeId_kind_eligibleAt", (q) =>
                    q
                      .eq("storeId", failing.storeId)
                      .eq("kind", "rollup"),
                  )
                  .first();
                reached.folded = day?.netSalesMinor === 100;
                reached.firstHandoff = first !== null;
                throw new Error("injected_second_handoff_failure");
              }
              return Reflect.apply(original, target, args);
            };
          },
        });
        await processDayWorkWithCtx({ ...ctx, db }, failingClaim, NOW + 1);
      }),
    ).rejects.toThrow("injected_second_handoff_failure");
    expect(reached).toEqual({ folded: true, firstHandoff: true });
    const rolledBack = await readStoreProjection(t, failing.storeId);
    expect(rolledBack.day).toBeNull();
    expect(rolledBack.work).toEqual([]);
    expect(rolledBack.control?.sourceWatermark).toBe(0);
    expect(
      await t.run((ctx) => ctx.db.get("reportDirtyDay", failingClaim.markId)),
    ).toMatchObject({ claimedAt: NOW });
    expect(
      await t.mutation(
        makeFunctionReference<
          "mutation",
          ReportDayClaim & { code: "unexpected_failure" }
        >("reports/pipelineDays:recordDayFailure"),
        { ...failingClaim, code: "unexpected_failure" },
      ),
    ).toBe("applied");
    expect(
      await t.run((ctx) => ctx.db.get("reportDirtyDay", failingClaim.markId)),
    ).toMatchObject({
      attempts: 1,
      lastFailure: "unexpected_failure",
      eligibleAt: NOW + 1 + 5_000,
    });
    expect(await readStoreProjection(t, healthy.storeId)).toEqual(committed);
    // convex-test models rollback on a thrown t.run mutation. This is a local
    // transaction contract proof, not a raced production-serializability test.
  });

  it("classifies a real cap-plus-one fact failure through the action and preserves another store's committed fold", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW + 1);
    const t = convexTest(schema, modules);
    const { healthy, overCap } = await t.run(async (ctx) => {
      const healthy = await seedStore(ctx, "action-success");
      const overCap = await seedStore(ctx, "action-capacity");
      await seedFacts(ctx, healthy.storeId, 1);
      await seedFacts(ctx, overCap.storeId, MAX_FACTS_PER_DAY + 1);
      return { healthy, overCap };
    });
    vi.stubEnv(
      REPORTS_SWEEP_STORE_ALLOWLIST_ENV,
      `${healthy.storeId},${overCap.storeId}`,
    );
    const healthyClaim = await claimDay(t, healthy.storeId);
    const failingClaim = await claimDay(t, overCap.storeId);
    const runDay = makeFunctionReference<"action", ReportDayClaim>(
      "reports/pipelineDays:runDay",
    );
    await t.action(runDay, healthyClaim);
    const committed = await readStoreProjection(t, healthy.storeId);
    expect(committed.day?.netSalesMinor).toBe(100);
    expect(committed.control?.sourceWatermark).toBe(1);
    expect(
      await t.run((ctx) => ctx.db.get("reportDirtyDay", healthyClaim.markId)),
    ).toBeNull();
    await t.action(runDay, failingClaim);
    const failedMark = await t.run((ctx) =>
      ctx.db.get("reportDirtyDay", failingClaim.markId),
    );
    expect(failedMark).toMatchObject({
      attempts: 1,
      lastFailure: "capacity_exceeded",
      eligibleAt: NOW + 1 + 5_000,
    });
    expect(failedMark?.claimedAt).toBeUndefined();
    const incomplete = await readStoreProjection(t, overCap.storeId);
    expect(incomplete.day).toBeNull();
    expect(incomplete.work).toEqual([]);
    expect(incomplete.control?.sourceWatermark).toBe(0);
    expect(await readStoreProjection(t, healthy.storeId)).toEqual(committed);
  });
});
