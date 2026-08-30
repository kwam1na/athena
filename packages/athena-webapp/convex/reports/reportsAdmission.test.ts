/// <reference types="vite/client" />

/**
 * U8 admission contract for `convex/reports/{access,customRange,liveDay,
 * queries,skuMixRange,skuMovementRange}.ts`, `convex/inventory/athenaUser.ts`,
 * and the retirement of the `reports.read` auth bridge in
 * `convex/lib/athenaUserAuth.ts`.
 *
 * Three layers, matching the three things the migration had to preserve:
 *
 * 1. The definitions are valid and say what the retired handler-local guards
 *    used to say (the mapping table: retired call site -> successor).
 * 2. A shared-demo principal is admitted exactly where the closed grant set
 *    allows and denied — recognizably — everywhere else, including across
 *    stores after scope resolution.
 * 3. End to end at the EXPORTED handler, with real identities and no mocked
 *    auth: the reports gate still admits only a single full admin of the
 *    owning organization, an anonymous caller is stopped before any read or
 *    write, and the demo workspace still resolves its own Athena user.
 *
 * Nothing here stubs `requireReportsStoreAccess` or the identity port. The
 * module suites do that so they can be about projections; this suite exists so
 * that at least one place runs the whole chain for real.
 */

import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { validateOperationDefinition } from "../operationAdmission/definitions";
import { validateReadOperationDefinition } from "../operationAdmission/readDefinitions";
import {
  SHARED_DEMO_ALLOWED_CAPABILITIES,
  WEEKLY_REPORT_STORE_ALLOWLIST_ENV,
} from "../platform/capabilityCatalog";
import { REPORT_SKU_PAGE_SIZE } from "../../shared/reportsContract";
import { enqueueReportWork } from "./pipelineWork";
import { SHARED_DEMO_ALLOWED_READ_INTENTS } from "../sharedDemo/policy";
import {
  REPORTS_DEFINITIONS,
  ensureMixRangeOperationDefinition,
  ensureMovementRangeOperationDefinition,
  requestRangeOperationDefinition,
  retryMixRangeOperationDefinition,
  retryMovementRangeOperationDefinition,
} from "../operationAdmission/domains/reports_definitions";
import {
  REPORTS_READ_DEFINITIONS,
  getAuthenticatedUserReadDefinition,
  getUserByIdReadDefinition,
} from "../operationAdmission/domains/reports_readDefinitions";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./reports/"),
    loader,
  ]),
);

const DENIED_ANONYMOUSLY = /Sign in again to continue\./;
const REPORTS_ACCESS_DENIED = "Reports access unavailable.";
const DEMO_DENIED = /demo/i;

/* ------------------------------------------------------------- 1. contract */

describe("U8 operation definitions", () => {
  it("declares 5 mutations and 19 reads", () => {
    expect(
      REPORTS_DEFINITIONS.map((definition) => definition.kind),
    ).toEqual(Array.from({ length: 5 }, () => "mutation"));
    expect(REPORTS_READ_DEFINITIONS).toHaveLength(19);
    for (const definition of REPORTS_READ_DEFINITIONS) {
      expect(definition.kind).toBe("query");
    }
  });

  it("passes rail definition validation and declares every actor explicitly", () => {
    for (const definition of REPORTS_DEFINITIONS) {
      expect({
        errors: validateOperationDefinition(definition),
        id: definition.operationId,
      }).toEqual({ errors: [], id: definition.operationId });
      expect(definition.actors.normalUser).toBeDefined();
      expect(definition.actors.sharedDemo).toBeDefined();
      expect(definition.actors.public).toBeDefined();
      // storefrontCustomer is not a valid actor on Convex-function kinds.
      expect(definition.actors.storefrontCustomer).toBeUndefined();
    }

    for (const definition of REPORTS_READ_DEFINITIONS) {
      expect({
        errors: validateReadOperationDefinition(definition),
        id: definition.operationId,
      }).toEqual({ errors: [], id: definition.operationId });
      expect(definition.actors.normalUser).toBeDefined();
      expect(definition.actors.sharedDemo).toBeDefined();
      expect(definition.actors.public).toBeDefined();
      expect(definition.actors.storefrontCustomer).toBeUndefined();
    }
  });

  /**
   * RED until the shared-file owner adds `"identity.view"` to
   * `SHARED_DEMO_ALLOWED_READ_INTENTS` (`convex/sharedDemo/policy.ts`), which
   * U8 does not own. `inventory/athenaUser:getAuthenticatedUser` is the demo
   * shell's identity probe: it resolved the demo principal's Athena user
   * before this migration (through the `{ sharedDemoCapability:
   * "reports.read" }` bridge) and must keep doing so, now through the rail.
   * Granting `identity.view` is not a widening — no other read definition in
   * the backend declares that intent — it is the same reach, declared.
   * `sharedDemo/readIntentGrants.test.ts` fails on the same missing line.
   */
  it("never widens shared-demo reach beyond the closed grant sets", () => {
    for (const definition of REPORTS_DEFINITIONS) {
      if (definition.actors.sharedDemo !== "admit") continue;
      expect(SHARED_DEMO_ALLOWED_CAPABILITIES).toContain(
        definition.capability as never,
      );
    }

    for (const definition of REPORTS_READ_DEFINITIONS) {
      if (definition.actors.sharedDemo !== "admit") continue;
      expect(SHARED_DEMO_ALLOWED_READ_INTENTS).toContain(
        definition.access.intent as never,
      );
    }
  });

  it("scopes every reporting read to the store named in its arguments", () => {
    for (const definition of REPORTS_READ_DEFINITIONS) {
      if (definition.access.intent !== "reports.view") continue;
      expect(definition.scope).toEqual({
        kind: "store",
        storeIdArg: "storeId",
      });
      expect(definition.actors.sharedDemo).toBe("admit");
      expect(definition.actors.public).toBe("deny");
    }
  });

  // `public: "admit"` is the one place an operation gives up identity
  // entirely, so the set is enumerated rather than spot-checked.
  it("admits anonymous callers on exactly the identity probe", () => {
    expect(
      REPORTS_READ_DEFINITIONS.filter(
        (definition) => definition.actors.public === "admit",
      ).map((definition) => definition.functionName),
    ).toEqual(["inventory/athenaUser:getAuthenticatedUser"]);

    expect(
      REPORTS_DEFINITIONS.filter(
        (definition) => definition.actors.public === "admit",
      ),
    ).toEqual([]);
  });
});

/**
 * Mapping table: every handler-local guard this unit retired, and the
 * definition field that now carries it.
 */
describe("U8 retired guard successors", () => {
  it.each([
    // requireSharedDemoCapabilityIfApplicable(ctx, "reporting.generate")
    ["skuMixRange:ensureMixRange", ensureMixRangeOperationDefinition],
    ["skuMixRange:retryMixRange", retryMixRangeOperationDefinition],
    [
      "skuMovementRange:ensureMovementRange",
      ensureMovementRangeOperationDefinition,
    ],
    [
      "skuMovementRange:retryMovementRange",
      retryMovementRangeOperationDefinition,
    ],
    // customRange:requestRange had no demo check of its own; it inherited the
    // reports.read gate, which the demo DOES hold. Bringing it under the same
    // generation capability narrows it to match its two siblings.
    ["customRange:requestRange", requestRangeOperationDefinition],
  ])(
    "re-expresses the retired demo capability check on %s",
    (_site, definition) => {
      expect(definition.capability).toBe("reporting.generate");
      expect(definition.actors.sharedDemo).toBe("deny");
      expect(definition.actors.normalUser).toBe("admit");
      expect(definition.actors.public).toBe("deny");
      // No demo actor reaches these, so there is no restore fence to apply
      // and no demo foundation row for them to touch.
      expect(definition.readiness).toEqual({ kind: "none" });
      expect((definition as { target?: unknown }).target).toBeUndefined();
    },
  );

  it("re-expresses requireSharedDemoStoreCapabilityIfApplicable as intent + store scope", () => {
    // The retired call was `(ctx, "reports.read", storeId)`: a closed
    // capability check plus a server-owned store clamp. The successor is the
    // demo-granted `reports.view` intent on a store-scoped read definition,
    // which the shared-demo read adapter clamps to the demo's own store.
    const reportsReads = REPORTS_READ_DEFINITIONS.filter(
      (definition) => definition.access.intent === "reports.view",
    );
    expect(reportsReads).toHaveLength(17);
    expect(SHARED_DEMO_ALLOWED_READ_INTENTS).toContain("reports.view" as never);
  });

  it("re-expresses the reports.read auth bridge as an admitted actor", () => {
    // `getAuthenticatedAthenaUserWithCtx(ctx, { sharedDemoCapability:
    // "reports.read" })` is gone; the demo identity now arrives through the
    // rail, which requires the demo actor to be admitted on this definition.
    expect(getAuthenticatedUserReadDefinition.actors.sharedDemo).toBe("admit");
    expect(getAuthenticatedUserReadDefinition.access.intent).toBe(
      "identity.view",
    );
    // The lookup-by-id sibling gained a gate it never had; it is demo-denied
    // because nothing demo-facing ever called it.
    expect(getUserByIdReadDefinition.actors.sharedDemo).toBe("deny");
    expect(getUserByIdReadDefinition.actors.public).toBe("deny");
  });
});

/* ------------------------------------------------------ 3. exported handler */

async function seedWorld(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    async function organizationWithStore(slug: string) {
      const athenaUserId = await ctx.db.insert("athenaUser", {
        email: `${slug}@test`,
        normalizedEmail: `${slug}@test`,
      });
      const authUserId = await ctx.db.insert("users", {
        email: `${slug}@test`,
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: athenaUserId,
        name: slug,
        slug,
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: athenaUserId,
        currency: "GHS",
        name: slug,
        organizationId,
        slug,
      });
      await ctx.db.insert("organizationMember", {
        organizationId,
        role: "full_admin",
        userId: athenaUserId,
      });
      return { athenaUserId, authUserId, organizationId, storeId };
    }

    const operator = await organizationWithStore("operator");
    const demo = await organizationWithStore("demo");
    await ctx.db.insert("sharedDemoPrincipal", {
      admissionExpiresAt: Date.now() + 3_600_000,
      athenaUserId: demo.athenaUserId,
      authUserId: demo.authUserId,
      organizationId: demo.organizationId,
      storeId: demo.storeId,
      updatedAt: Date.now(),
    });

    // A member of the operator organization who is NOT a full admin: the
    // reports gate must keep rejecting them even though admission succeeds.
    const posOnlyUserId = await ctx.db.insert("athenaUser", {
      email: "pos-only@test",
      normalizedEmail: "pos-only@test",
    });
    const posOnlyAuthUserId = await ctx.db.insert("users", {
      email: "pos-only@test",
    });
    await ctx.db.insert("organizationMember", {
      organizationId: operator.organizationId,
      role: "pos_only",
      userId: posOnlyUserId,
    });

    return { demo, operator, posOnly: { authUserId: posOnlyAuthUserId } };
  });
}

function as(t: ReturnType<typeof convexTest>, authUserId: Id<"users">) {
  return t.withIdentity({ subject: `${authUserId}|session` });
}

const recoverySkuMetrics = {
  grossSalesMinor: 100,
  netSalesMinor: 100,
  refundsMinor: 0,
  unitsSold: 1,
  unitsReturned: 0,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 40,
};

async function seedRecoveryPeriods(
  t: TestConvex<typeof schema>,
  operator: Awaited<ReturnType<typeof seedWorld>>["operator"],
) {
  return t.run(async (ctx) => {
    const { storeId, organizationId, athenaUserId } = operator;
    const categoryId = await ctx.db.insert("category", {
      storeId, name: "Recovery", slug: "recovery",
    });
    const subcategoryId = await ctx.db.insert("subcategory", {
      storeId, categoryId, name: "Recovery", slug: "recovery",
    });
    const productId = await ctx.db.insert("product", {
      storeId, organizationId, createdByUserId: athenaUserId,
      categoryId, subcategoryId, name: "Recovery", slug: "recovery",
      currency: "GHS", availability: "live", inventoryCount: 0,
    });
    const skuIds: Id<"productSku">[] = [];
    for (let index = 0; index <= REPORT_SKU_PAGE_SIZE; index++) {
      skuIds.push(await ctx.db.insert("productSku", {
        storeId, productId, sku: `RECOVERY-${index}`, images: [],
        price: 100, inventoryCount: 0, quantityAvailable: 0,
      }));
    }
    const legacyId = await ctx.db.insert("reportPeriodSkuRollup", {
      storeId, periodKey: "m:2026-07", productSkuId: skuIds[0]!,
      ...recoverySkuMetrics, revenueSortKey: -100, unitsSortKey: -1,
    });
    for (const epoch of ["before-rebuild", "after-rebuild"]) {
      await ctx.db.insert("reportRollupEpoch", {
        storeId, epoch, createdAt: 1, backfillCursor: null, backfillComplete: true,
      });
      for (const productSkuId of skuIds) {
        await ctx.db.insert("reportEpochSkuRollup", {
          storeId, epoch, periodKey: "m:2026-07", productSkuId,
          ...recoverySkuMetrics, knownProfitMinor: 40, unknownProfitDays: 0,
          contributingDays: 1, revenueSortKey: -100, unitsSortKey: -1,
        });
      }
    }
    await ctx.db.insert("reportDay", {
      storeId, operatingDate: "2026-07-27", currency: "GHS", status: "reconciled",
      ...recoverySkuMetrics,
      grossSalesMinor: skuIds.length * 100, netSalesMinor: skuIds.length * 100,
      unitsSold: skuIds.length, grossProfitMinor: skuIds.length * 40,
      paymentsCollectedMinor: skuIds.length * 100, paymentsRefundedMinor: 0,
      paymentAllocatedMinor: skuIds.length * 100, transactionCount: skuIds.length,
      foldVersion: 1, factCount: skuIds.length, lastFactRecordedAt: 1,
      flags: { mixedCurrency: false, hasUncostedRevenue: false, quarantinedFactCount: 0 },
    });
    return { legacyId, skuIds };
  });
}

async function seedRecoveryWeekly(
  t: TestConvex<typeof schema>,
  operator: Awaited<ReturnType<typeof seedWorld>>["operator"],
  accepted: boolean,
) {
  vi.stubEnv(WEEKLY_REPORT_STORE_ALLOWLIST_ENV, String(operator.storeId));
  return t.run(async (ctx) => {
    const { storeId, organizationId } = operator;
    const verification = {
      status: "complete" as const, missingCount: 0, startedAt: 1, completedAt: 1,
    };
    await ctx.db.patch("store", storeId, {
      weeklyObservedAtVerification: verification,
      weeklyReportingCycleAnchorVerification: verification,
    });
    const closeId = await ctx.db.insert("dailyClose", {
      storeId, organizationId, operatingDate: "2026-08-02", status: "completed",
      isCurrent: true,
      readiness: { status: "ready", blockerCount: 0, reviewCount: 0, carryForwardCount: 0, readyCount: 1 },
      summary: {}, sourceSubjects: [], carryForwardWorkItemIds: [],
      createdAt: 1, updatedAt: 1, completedAt: 1,
    });
    const metrics = {
      ...recoverySkuMetrics, paymentsCollectedMinor: 100, paymentsRefundedMinor: 0,
      paymentAllocatedMinor: 100, paymentUnsettledMinor: 0,
      paymentAllocationCoverage: "complete" as const,
    };
    const frame = {
      storeId, cycleStartDate: "2026-07-27", cycleEndDate: "2026-08-02",
      currency: "GHS", metricVersion: 1, included: metrics, outsideSchedule: metrics,
      completeness: { complete: true, reason: "complete" as const },
      scheduleLineage: [{
        localDate: "2026-07-27", included: true, scheduleVersionId: null,
        dayStatus: "reconciled" as const, dayAvailable: true, activityPosture: "recorded" as const,
      }],
      amendmentPosture: "none" as const,
    };
    const acceptedId = await ctx.db.insert("reportWeekAccepted", {
      ...frame, acceptedAt: 1000, cutoffObservedAt: 900, closeId,
      baselineFingerprint: "recovery-baseline", lifecyclePosture: "accepted",
    });
    const currentId = await ctx.db.insert("reportWeekCurrent", {
      ...frame, materializedAt: 1100, lifecyclePosture: accepted ? "accepted" : "live",
      ...(accepted ? { acceptedBaselineId: acceptedId } : {}),
    });
    const controlId = await ctx.db.insert("reportPipelineControl", {
      storeId, mode: "active", hasActivated: true, fence: 1, sourceWatermark: 1,
      activeRollupEpoch: "before-rebuild",
    });
    await enqueueReportWork(ctx, { storeId, kind: "current" }, 1);
    const dirtyId = await ctx.db.insert("reportDirtyDay", {
      storeId, operatingDate: "2026-07-27", reason: "late_fact", markedAt: 1,
    });
    return { acceptedId, currentId, controlId, dirtyId };
  });
}

describe("exported reporting recovery freshness", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps never-activated shadow legacy reads but withholds them during post-activation shadow recovery", async () => {
    const t = convexTest(schema, modules);
    const { operator } = await seedWorld(t);
    const { legacyId } = await seedRecoveryPeriods(t, operator);
    const admin = as(t, operator.authUserId);
    const args = { storeId: operator.storeId, periodKey: "m:2026-07", sortBy: "revenue" as const };
    const controlId = await t.run((ctx) => ctx.db.insert("reportPipelineControl", {
      storeId: operator.storeId, mode: "shadow", fence: 1, sourceWatermark: 0,
    }));
    const legacy = await admin.query(api.reports.queries.listPeriodSkus, args);
    expect(legacy.status).toBe("ready");
    expect(legacy.rows).toHaveLength(1);
    expect(legacy.rows[0]?.netSalesMinor).toBe(100);
    const storedLegacy = await t.run((ctx) => ctx.db.get("reportPeriodSkuRollup", legacyId));

    await t.run((ctx) => ctx.db.patch("reportPipelineControl", controlId, { hasActivated: true }));
    expect(await admin.query(api.reports.queries.listPeriodSkus, args)).toEqual({
      status: "pending", reason: "projection_pending", rows: [], continueCursor: null,
    });
    expect(await t.run((ctx) => ctx.db.get("reportPeriodSkuRollup", legacyId))).toEqual(storedLegacy);
  });

  it("keeps an issued epoch cursor pending throughout recovery and restarts it only after reactivation", async () => {
    const t = convexTest(schema, modules);
    const { operator } = await seedWorld(t);
    await seedRecoveryPeriods(t, operator);
    const admin = as(t, operator.authUserId);
    const args = { storeId: operator.storeId, periodKey: "m:2026-07", sortBy: "revenue" as const };
    const controlId = await t.run((ctx) => ctx.db.insert("reportPipelineControl", {
      storeId: operator.storeId, mode: "active", hasActivated: true,
      activeRollupEpoch: "before-rebuild", fence: 1, sourceWatermark: 1,
    }));
    const firstPage = await admin.query(api.reports.queries.listPeriodSkus, args);
    expect(firstPage.status).toBe("ready");
    expect(firstPage.continueCursor).toBeTruthy();
    const cursor = firstPage.continueCursor!;
    for (const mode of ["paused", "shadow"] as const) {
      await t.run((ctx) => ctx.db.patch("reportPipelineControl", controlId, {
        mode, activeRollupEpoch: undefined, fence: 2,
      }));
      expect(await admin.query(api.reports.queries.listPeriodSkus, { ...args, cursor })).toEqual({
        status: "pending", reason: "projection_pending", rows: [], continueCursor: null,
      });
    }
    await t.run((ctx) => ctx.db.patch("reportPipelineControl", controlId, {
      mode: "active", activeRollupEpoch: "after-rebuild", fence: 3,
    }));
    expect(await admin.query(api.reports.queries.listPeriodSkus, { ...args, cursor })).toEqual({
      status: "restart", reason: "period_changed", rows: [], continueCursor: null,
    });
    expect(await admin.query(api.reports.queries.listPeriodSkus, args)).toMatchObject({ status: "ready" });
  });

  it.each([
    { mode: "paused" as const, hasActivated: true, activeRollupEpoch: undefined },
    { mode: "shadow" as const, hasActivated: true, activeRollupEpoch: undefined },
    { mode: "shadow" as const, hasActivated: undefined, activeRollupEpoch: "legacy-active" },
  ])("does not certify weekly projections during $mode recovery (history=$hasActivated, epoch=$activeRollupEpoch)", async (recovery) => {
    for (const accepted of [false, true]) {
      const t = convexTest(schema, modules);
      const { operator } = await seedWorld(t);
      const seeded = await seedRecoveryWeekly(t, operator, accepted);
      const admin = as(t, operator.authUserId);
      const args = { storeId: operator.storeId };
      const storedBaseline = await t.run((ctx) => ctx.db.get("reportWeekAccepted", seeded.acceptedId));
      const assertPending = async () => {
        const briefing = await admin.query(api.reports.queries.getActiveWeeklyBriefing, args);
        expect(briefing.status).toBe("available");
        if (briefing.status !== "available") throw new Error("Expected admitted weekly briefing");
        expect.soft(briefing.current.completeness).toEqual({ complete: false, reason: "missing_day_fold" });
        expect.soft(briefing.current.totalCompleteness).toEqual({ complete: false, reason: "missing_day_fold" });
        expect.soft(briefing.current.amendmentPosture).toBe(accepted ? "pending_recompute" : "none");
        expect.soft(briefing.current.lifecyclePosture).toBe(accepted ? "accepted" : "materializing");
        expect(briefing.current.included).toEqual(storedBaseline?.included);
        expect(briefing.acceptedBaseline?.amendmentPosture ?? null).toBe(accepted ? "none" : null);
        if (accepted) {
          expect(briefing.acceptedBaseline).toMatchObject({
            included: storedBaseline?.included, completeness: { complete: true }, cutoffObservedAt: 900,
          });
        }
        const history = await admin.query(api.reports.queries.listAcceptedWeeklyHistory, {
          ...args, paginationOpts: { cursor: null, numItems: 10 },
        });
        const detail = await admin.query(api.reports.queries.getAcceptedWeeklyDetail, {
          ...args, reportId: "week:2026-07-27",
        });
        expect(history.page).toHaveLength(1);
        expect(history.page[0]).toEqual(detail);
        expect.soft(detail).toMatchObject({
          amendmentPosture: "pending_recompute", included: storedBaseline?.included,
          completeness: { complete: true }, cutoffObservedAt: 900,
        });
        expect(await t.run((ctx) => ctx.db.get("reportWeekAccepted", seeded.acceptedId))).toEqual(storedBaseline);
      };
      await assertPending(); // Active + exact dirty/current work already worked.
      await t.run((ctx) => ctx.db.patch("reportPipelineControl", seeded.controlId, recovery));
      await assertPending();
      // Purging the transient queue is not proof that recovery has completed.
      await t.run(async (ctx) => {
        await ctx.db.delete("reportDirtyDay", seeded.dirtyId);
        const work = await ctx.db.query("reportPipelineWork").withIndex("by_storeId_kind_createdAt", (q) =>
          q.eq("storeId", operator.storeId).eq("kind", "current")).unique();
        if (work) await ctx.db.delete("reportPipelineWork", work._id);
      });
      await assertPending();
      await t.run((ctx) => ctx.db.patch("reportPipelineControl", seeded.controlId, {
        mode: "active", hasActivated: true, activeRollupEpoch: "after-rebuild",
      }));
      expect(await admin.query(api.reports.queries.getActiveWeeklyBriefing, args)).toMatchObject({
        status: "available", current: { completeness: { complete: true }, amendmentPosture: "none" },
      });
      expect(await admin.query(api.reports.queries.getAcceptedWeeklyDetail, {
        ...args, reportId: "week:2026-07-27",
      })).toMatchObject({ amendmentPosture: "none" });
    }
  });

  it("preserves weekly legacy completeness in never-activated shadow mode", async () => {
    const t = convexTest(schema, modules);
    const { operator } = await seedWorld(t);
    const { controlId } = await seedRecoveryWeekly(t, operator, true);
    await t.run((ctx) => ctx.db.patch("reportPipelineControl", controlId, {
      mode: "shadow", hasActivated: undefined, activeRollupEpoch: undefined,
    }));
    const admin = as(t, operator.authUserId);
    expect(await admin.query(api.reports.queries.getActiveWeeklyBriefing, { storeId: operator.storeId })).toMatchObject({
      status: "available", current: { completeness: { complete: true }, amendmentPosture: "none" },
    });
    expect(await admin.query(api.reports.queries.getAcceptedWeeklyDetail, {
      storeId: operator.storeId, reportId: "week:2026-07-27",
    })).toMatchObject({ amendmentPosture: "none" });
  });
});

describe("U8 exported handler admission", () => {
  beforeEach(() => {
    // The shared-demo adapter is fail-closed on configuration: without these
    // the demo principal is a `demo_disabled` denial rather than an actor.
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "dev");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("denies an anonymous caller on every reporting surface, before any read or write", async () => {
    const t = convexTest(schema, modules);
    const { operator } = await seedWorld(t);

    await expect(
      t.query(api.reports.queries.getOverview, { storeId: operator.storeId }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);
    await expect(
      t.query(api.reports.liveDay.listLiveSkuStock, {
        storeId: operator.storeId,
      }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);
    await expect(
      t.mutation(api.reports.customRange.requestRange, {
        storeId: operator.storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);
    await expect(
      t.mutation(api.reports.skuMixRange.ensureMixRange, {
        storeId: operator.storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);

    // Terminal: the denied write left nothing behind.
    await expect(
      t.run((ctx) =>
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read
        ctx.db.query("reportRangeResult").collect(),
      ),
    ).resolves.toEqual([]);
  });

  it("keeps normal-user outcomes unchanged for a full admin of the owning organization", async () => {
    const t = convexTest(schema, modules);
    const { operator } = await seedWorld(t);
    const admin = as(t, operator.authUserId);

    // A store with no overview singleton reads as "nothing here", which is
    // the domain answer rather than a denial.
    await expect(
      admin.query(api.reports.queries.getOverview, {
        storeId: operator.storeId,
      }),
    ).resolves.toBeNull();
    await expect(
      admin.query(api.reports.liveDay.listLiveSkuStock, {
        storeId: operator.storeId,
      }),
    ).resolves.toEqual([]);

    const requested = await admin.mutation(
      api.reports.customRange.requestRange,
      {
        storeId: operator.storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      },
    );
    expect(requested.requestKey).toMatch(/^range:/);
    await expect(
      admin.query(api.reports.queries.getRangeResult, {
        storeId: operator.storeId,
        requestKey: requested.requestKey,
      }),
    ).resolves.toMatchObject({ status: "pending" });
  });

  it("still applies the full-admin reports gate to an admitted normal user", async () => {
    const t = convexTest(schema, modules);
    const { operator, posOnly } = await seedWorld(t);
    const member = as(t, posOnly.authUserId);

    // Admitted by the rail (a real Athena identity), rejected by the gate —
    // with the same opaque message it always used.
    await expect(
      member.query(api.reports.queries.getOverview, {
        storeId: operator.storeId,
      }),
    ).rejects.toThrow(REPORTS_ACCESS_DENIED);
    await expect(
      member.mutation(api.reports.customRange.requestRange, {
        storeId: operator.storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      }),
    ).rejects.toThrow(REPORTS_ACCESS_DENIED);
  });

  it("keeps a foreign store indistinguishable from a missing one for a normal user", async () => {
    const t = convexTest(schema, modules);
    const { demo, operator } = await seedWorld(t);

    await expect(
      as(t, operator.authUserId).query(api.reports.queries.getOverview, {
        storeId: demo.storeId,
      }),
    ).rejects.toThrow(REPORTS_ACCESS_DENIED);
  });

  it("lets a shared-demo visitor read its own store's reports", async () => {
    const t = convexTest(schema, modules);
    const { demo } = await seedWorld(t);
    const visitor = as(t, demo.authUserId);

    await expect(
      visitor.query(api.reports.liveDay.getLiveOperatingDay, {
        operatingDate: "2026-07-15",
        storeId: demo.storeId,
      }),
    ).resolves.toEqual({ day: null, operatingDate: "2026-07-15", skus: [] });
    await expect(
      visitor.query(api.reports.queries.getOverview, { storeId: demo.storeId }),
    ).resolves.toBeNull();
  });

  it("denies a shared-demo visitor another store's reports after scope resolution", async () => {
    const t = convexTest(schema, modules);
    const { demo, operator } = await seedWorld(t);

    await expect(
      as(t, demo.authUserId).query(api.reports.queries.getOverview, {
        storeId: operator.storeId,
      }),
    ).rejects.toThrow(DEMO_DENIED);
  });

  it("denies a shared-demo visitor every range generation, including customRange", async () => {
    const t = convexTest(schema, modules);
    const { demo } = await seedWorld(t);
    const visitor = as(t, demo.authUserId);

    await expect(
      visitor.mutation(api.reports.customRange.requestRange, {
        storeId: demo.storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      }),
    ).rejects.toThrow(DEMO_DENIED);
    await expect(
      visitor.mutation(api.reports.skuMixRange.ensureMixRange, {
        storeId: demo.storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      }),
    ).rejects.toThrow(DEMO_DENIED);
    await expect(
      visitor.mutation(api.reports.skuMovementRange.ensureMovementRange, {
        storeId: demo.storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      }),
    ).rejects.toThrow(DEMO_DENIED);

    await expect(
      t.run((ctx) =>
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read
        ctx.db.query("reportRangeResult").collect(),
      ),
    ).resolves.toEqual([]);
  });

  it("resolves the identity probe for anonymous, normal, and demo callers", async () => {
    const t = convexTest(schema, modules);
    const { demo, operator } = await seedWorld(t);

    // Anonymous: admitted (this is a pre-auth probe) and answers "nobody"
    // rather than throwing, which is what the sign-in handoff depends on.
    await expect(
      t.query(api.inventory.athenaUser.getAuthenticatedUser, {}),
    ).resolves.toBeNull();

    await expect(
      as(t, operator.authUserId).query(
        api.inventory.athenaUser.getAuthenticatedUser,
        {},
      ),
    ).resolves.toMatchObject({ _id: operator.athenaUserId });

    // The retired bridge's whole job: a demo principal resolving to the demo
    // organization's Athena user, now through the admitted actor instead.
    await expect(
      as(t, demo.authUserId).query(
        api.inventory.athenaUser.getAuthenticatedUser,
        {},
      ),
    ).resolves.toMatchObject({ _id: demo.athenaUserId });
  });

  it("closes the ungated athenaUser lookup to anonymous and demo callers", async () => {
    const t = convexTest(schema, modules);
    const { demo, operator } = await seedWorld(t);

    await expect(
      t.query(api.inventory.athenaUser.getUserById, {
        id: operator.athenaUserId,
      }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);
    await expect(
      as(t, demo.authUserId).query(api.inventory.athenaUser.getUserById, {
        id: operator.athenaUserId,
      }),
    ).rejects.toThrow(DEMO_DENIED);
    await expect(
      as(t, operator.authUserId).query(api.inventory.athenaUser.getUserById, {
        id: operator.athenaUserId,
      }),
    ).resolves.toMatchObject({ _id: operator.athenaUserId });
  });
});
