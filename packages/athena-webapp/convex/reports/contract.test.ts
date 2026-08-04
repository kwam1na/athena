/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Validator } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import {
  reportDaySchema,
  reportSkuDaySchema,
  reportOverviewSchema,
  reportPeriodSkuRollupSchema,
  reportRangeResultSchema,
  reportRangeMovementSkuSchema,
  reportWeekAcceptedSchema,
  reportWeekCurrentSchema,
} from "../schemas/reports";
import {
  REPORT_DAY_METRIC_KEYS,
  REPORT_SKU_DAY_METRIC_KEYS,
  REPORT_DAY_STATUSES,
  REPORT_FACT_KINDS,
  REPORT_SOURCE_DOMAINS,
  REPORT_WEEK_METRIC_KEYS,
  REPORT_WEEK_ROLLOUT_METRIC_KEYS,
  REPORT_MOVEMENT_CONTRACT_VERSION,
  REPORT_MOVEMENT_EMPTY_DAY_REVISION,
  REPORT_MOVEMENT_PAGE_SIZE,
  REPORT_MOVEMENT_RANGE_MAX_DAYS,
  REPORT_MOVEMENT_REQUEST_KEY_PREFIX,
  REPORT_RANGE_MAX_DAYS,
  REPORT_RANGE_MAX_DAYS_BY_KIND,
  REPORT_RANGE_SUMMARY_REQUEST_KEY_PREFIX,
  REPORT_RANGE_TTL_MS,
  REPORTS_FOLD_VERSION,
  addWeekMetrics,
  admissibleMovementDayRevision,
  combineWeekCompleteness,
  computeMovementRequestKey,
  deriveMovementRequestLifecycle,
  movementAbsNetUnitsSortKey,
  movementPageCount,
  movementSourceRowMatchesRevision,
  validateReportRangeRequest,
} from "../../shared/reportsContract";
import type {
  ReportMovementDayRevision,
  ReportWeekCompleteness,
  ReportWeekMetrics,
} from "../../shared/reportsContract";
import { reportFactSchema } from "../schemas/reports/facts";
import { computeRequestKey, requestRangeCore } from "./customRange";
import { stableStringHash } from "./fingerprint";
import { RESEED_PURGE_TABLES } from "./reseed";

/**
 * Contract ↔ schema parity.
 *
 * The legacy reporting layer died in part because the backend materialized
 * metric keys the UI never read (and vice versa) — a silent runtime mismatch.
 * These tests make the metric vocabulary a single source of truth: every
 * metric field the contract declares must exist on the Convex validators
 * with the required optionality, and enum literals must match exactly.
 */

type AnyValidator = Validator<any, any, any> & {
  kind: string;
  fields?: Record<string, AnyValidator>;
  members?: AnyValidator[];
  value?: unknown;
  isOptional: "required" | "optional";
};

function fieldsOf(schema: unknown): Record<string, AnyValidator> {
  const validator = schema as AnyValidator;
  expect(validator.kind).toBe("object");
  return validator.fields!;
}

function unionLiterals(validator: AnyValidator): string[] {
  expect(validator.kind).toBe("union");
  return validator.members!.map((m) => {
    expect(m.kind).toBe("literal");
    return m.value as string;
  });
}

describe("reports contract ↔ schema parity", () => {
  it("reportDay carries every contract day metric field, required", () => {
    const fields = fieldsOf(reportDaySchema);
    for (const key of REPORT_DAY_METRIC_KEYS) {
      expect(fields[key], `reportDay is missing metric field ${key}`)
        .toBeDefined();
      expect(
        fields[key].isOptional,
        `${key} must be required on reportDay`,
      ).toBe("required");
    }
  });

  it("reportSkuDay and rollup carry every contract sku metric field, required", () => {
    for (const schema of [reportSkuDaySchema, reportPeriodSkuRollupSchema]) {
      const fields = fieldsOf(schema);
      for (const key of REPORT_SKU_DAY_METRIC_KEYS) {
        expect(fields[key], `schema is missing metric field ${key}`)
          .toBeDefined();
        expect(fields[key].isOptional).toBe("required");
      }
    }
  });

  it("overview period snapshots carry every day metric field", () => {
    const fields = fieldsOf(reportOverviewSchema);
    for (const period of [
      "today",
      "yesterday",
      "weekToDate",
      "priorWeek",
      "trailing30",
      "priorTrailing30",
      "trailing3Months",
      "priorTrailing3Months",
    ] as const) {
      const snapshot = fieldsOf(fields[period]);
      for (const key of REPORT_DAY_METRIC_KEYS) {
        expect(snapshot[key], `overview.${period} is missing ${key}`)
          .toBeDefined();
      }
      expect(snapshot.dayCount).toBeDefined();
      expect(snapshot.unsettledDayCount).toBeDefined();
    }
  });

  it("range totals carry every day metric field", () => {
    const fields = fieldsOf(reportRangeResultSchema);
    const totals = fieldsOf(fields.totals);
    for (const key of REPORT_DAY_METRIC_KEYS) {
      expect(totals[key], `range totals missing ${key}`).toBeDefined();
    }
  });

  it("day status literals match the contract exactly", () => {
    const fields = fieldsOf(reportDaySchema);
    expect(new Set(unionLiterals(fields.status))).toEqual(
      new Set(REPORT_DAY_STATUSES),
    );
  });

  it("fact kind and source domain literals match the contract exactly", () => {
    const fields = fieldsOf(reportFactSchema);
    expect(new Set(unionLiterals(fields.factKind))).toEqual(
      new Set(REPORT_FACT_KINDS),
    );
    expect(new Set(unionLiterals(fields.sourceDomain))).toEqual(
      new Set(REPORT_SOURCE_DOMAINS),
    );
  });

  it("keeps payment allocation lineage optional for legacy fact compatibility", () => {
    const fields = fieldsOf(reportFactSchema);
    expect(fields.paymentAllocationMinor.isOptional).toBe("optional");
    expect(fields.paymentAllocationCoverage.isOptional).toBe("optional");
  });

  it("keeps knowledge time optional only during the explicit fact migration", () => {
    expect(fieldsOf(reportFactSchema).observedAt.isOptional).toBe("optional");
  });

  it("weekly current and accepted snapshots carry every weekly metric field", () => {
    const currentAvailableSchema = (reportWeekCurrentSchema as AnyValidator)
      .members!.find((member) => member.fields?.included);
    expect(currentAvailableSchema).toBeDefined();
    for (const schema of [currentAvailableSchema!, reportWeekAcceptedSchema]) {
      const fields = fieldsOf(schema);
      for (const snapshotName of ["included", "outsideSchedule"] as const) {
        const snapshot = fieldsOf(fields[snapshotName]);
        for (const key of REPORT_WEEK_METRIC_KEYS) {
          expect(snapshot[key], `${snapshotName} is missing ${key}`).toBeDefined();
          expect(snapshot[key].isOptional).toBe("required");
        }
      }
    }
  });

  it("keeps weekly payment posture optional only during its rollout", () => {
    const currentAvailableSchema = (reportWeekCurrentSchema as AnyValidator)
      .members!.find((member) => member.fields?.included);
    for (const schema of [currentAvailableSchema!, reportWeekAcceptedSchema]) {
      const fields = fieldsOf(schema);
      for (const snapshotName of ["included", "outsideSchedule"] as const) {
        const snapshot = fieldsOf(fields[snapshotName]);
        for (const key of REPORT_WEEK_ROLLOUT_METRIC_KEYS) {
          expect(snapshot[key], `${snapshotName} is missing ${key}`)
            .toBeDefined();
          expect(snapshot[key].isOptional).toBe("optional");
        }
      }
    }
  });

  it("gives the outside-schedule lane its own completeness verdict", () => {
    const fields = fieldsOf(reportWeekAcceptedSchema);
    const completeness = fieldsOf(fields.completeness);
    expect(completeness.outsideSchedule.isOptional).toBe("optional");
    expect(new Set(unionLiterals(completeness.reason))).toEqual(
      new Set(unionLiterals(fieldsOf(completeness.outsideSchedule).reason)),
    );
  });

  it("persists the prior period's outside-schedule lane, optional during rollout", () => {
    for (const schema of [
      reportWeekAcceptedSchema,
      (reportWeekCurrentSchema as AnyValidator).members!.find(
        (member) => member.fields?.included,
      )!,
    ]) {
      const priorPeriod = fieldsOf(fieldsOf(schema).priorPeriod);
      expect(priorPeriod.outsideScheduleValues).toBeDefined();
      expect(priorPeriod.outsideScheduleValues.isOptional).toBe("optional");
      // The prior lane must carry the same metric vocabulary as `values`, or
      // the total-vs-total comparison would be summing unlike shapes.
      const lane = priorPeriod.outsideScheduleValues.members!.find(
        (member) => member.kind === "object",
      )!;
      for (const key of REPORT_WEEK_METRIC_KEYS) {
        expect(lane.fields![key], `prior outside lane is missing ${key}`)
          .toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Total-lane combination — the read-time arithmetic behind the headline. The
// lanes stay stored and separate; these functions are the only place the two
// are ever joined, so unknowns must poison rather than quietly disappear.
// ---------------------------------------------------------------------------

const laneMetrics: ReportWeekMetrics = {
  grossSalesMinor: 1_000,
  netSalesMinor: 900,
  refundsMinor: 100,
  unitsSold: 10,
  unitsReturned: 1,
  uncostedRevenueMinor: 25,
  grossProfitMinor: 300,
  paymentsCollectedMinor: 900,
  paymentsRefundedMinor: 100,
  paymentAllocatedMinor: 800,
  paymentUnsettledMinor: 50,
  paymentAllocationCoverage: "complete",
  paymentAllocationOmittedMinor: 0,
  paymentHasInvalidAllocation: false,
};

describe("addWeekMetrics", () => {
  it("sums every additive lane field", () => {
    expect(
      addWeekMetrics(laneMetrics, { ...laneMetrics, netSalesMinor: 100 }),
    ).toMatchObject({
      grossSalesMinor: 2_000,
      netSalesMinor: 1_000,
      refundsMinor: 200,
      unitsSold: 20,
      unitsReturned: 2,
      uncostedRevenueMinor: 50,
      grossProfitMinor: 600,
      paymentsCollectedMinor: 1_800,
      paymentsRefundedMinor: 200,
      paymentAllocatedMinor: 1_600,
      paymentUnsettledMinor: 100,
    });
  });

  it("poisons merchandise margin when either lane is uncosted", () => {
    expect(
      addWeekMetrics(laneMetrics, {
        ...laneMetrics,
        grossProfitMinor: null,
      }).grossProfitMinor,
    ).toBeNull();
    expect(
      addWeekMetrics({ ...laneMetrics, grossProfitMinor: null }, laneMetrics)
        .grossProfitMinor,
    ).toBeNull();
  });

  it("poisons unsettled payments when either lane is unknown", () => {
    expect(
      addWeekMetrics(laneMetrics, {
        ...laneMetrics,
        paymentUnsettledMinor: null,
      }).paymentUnsettledMinor,
    ).toBeNull();
    expect(
      addWeekMetrics(
        { ...laneMetrics, paymentUnsettledMinor: null },
        laneMetrics,
      ).paymentUnsettledMinor,
    ).toBeNull();
  });

  it("propagates unknown allocation coverage from either lane", () => {
    expect(
      addWeekMetrics(laneMetrics, {
        ...laneMetrics,
        paymentAllocationCoverage: "unknown",
      }).paymentAllocationCoverage,
    ).toBe("unknown");
    expect(
      addWeekMetrics(laneMetrics, laneMetrics).paymentAllocationCoverage,
    ).toBe("complete");
  });

  it("reads both lanes through the rollout normalization", () => {
    // A lane written before the omitted total landed is unknown coverage, not
    // a proven zero — the combined total must inherit that, not erase it.
    const legacy = { ...laneMetrics };
    delete (legacy as Partial<ReportWeekMetrics>).paymentAllocationOmittedMinor;
    delete (legacy as Partial<ReportWeekMetrics>).paymentHasInvalidAllocation;
    const total = addWeekMetrics(legacy, {
      ...laneMetrics,
      paymentAllocationOmittedMinor: 40,
    });
    expect(total.paymentAllocationCoverage).toBe("unknown");
    expect(total.paymentAllocationOmittedMinor).toBe(40);
    expect(total.paymentHasInvalidAllocation).toBe(false);
  });

  it("sums omitted allocation and ORs the invalid-allocation flag", () => {
    const total = addWeekMetrics(
      { ...laneMetrics, paymentAllocationOmittedMinor: 15 },
      {
        ...laneMetrics,
        paymentAllocationOmittedMinor: 25,
        paymentHasInvalidAllocation: true,
      },
    );
    expect(total.paymentAllocationOmittedMinor).toBe(40);
    expect(total.paymentHasInvalidAllocation).toBe(true);
  });
});

describe("combineWeekCompleteness", () => {
  const complete: ReportWeekCompleteness = {
    complete: true,
    reason: "complete",
  };

  it("is complete only when both lanes are complete", () => {
    expect(
      combineWeekCompleteness({
        ...complete,
        outsideSchedule: { complete: true, reason: "complete" },
      }),
    ).toEqual({
      complete: true,
      reason: "complete",
      outsideSchedule: { complete: true, reason: "complete" },
    });
  });

  it("reports the failing lane's reason", () => {
    expect(
      combineWeekCompleteness({
        ...complete,
        outsideSchedule: { complete: false, reason: "mixed_currency" },
      }),
    ).toMatchObject({ complete: false, reason: "mixed_currency" });
    expect(
      combineWeekCompleteness({
        complete: false,
        reason: "fact_cap_exceeded",
        outsideSchedule: { complete: true, reason: "complete" },
      }),
    ).toMatchObject({ complete: false, reason: "fact_cap_exceeded" });
  });

  it("prefers the scheduled lane's reason when both lanes fail", () => {
    expect(
      combineWeekCompleteness({
        complete: false,
        reason: "missing_day_fold",
        outsideSchedule: { complete: false, reason: "mixed_currency" },
      }),
    ).toMatchObject({ complete: false, reason: "missing_day_fold" });
  });

  it("treats an absent outside verdict as no recorded limitation", () => {
    expect(combineWeekCompleteness(complete)).toEqual({
      complete: true,
      reason: "complete",
      outsideSchedule: undefined,
    });
    expect(
      combineWeekCompleteness({
        complete: false,
        reason: "payment_coverage_unknown",
      }),
    ).toMatchObject({ complete: false, reason: "payment_coverage_unknown" });
  });
});

// ---------------------------------------------------------------------------
// U1 — shared range contract and movement schema.
//
// The legacy custom-summary lifecycle is characterized FIRST (kind-absent
// rows must keep their exact pre-widening behavior), then the movement
// additions are pinned: identity separation, revision admissibility, strict
// validation, signed ordering, tenant ownership, public lifecycle honesty,
// and header-free child cleanup.
// ---------------------------------------------------------------------------

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./reports/"),
    loader,
  ]),
);

async function seedStore(ctx: MutationCtx, suffix = "a") {
  const userId = await ctx.db.insert("athenaUser", {
    email: `owner-${suffix}@example.test`,
  });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: `Test Org ${suffix}`,
    slug: `test-org-${suffix}`,
  });
  const storeId = await ctx.db.insert("store", {
    createdByUserId: userId,
    currency: "GHS",
    name: `Test Store ${suffix}`,
    organizationId,
    slug: `test-store-${suffix}`,
  });
  return { userId, organizationId, storeId };
}

async function seedProductSku(
  ctx: MutationCtx,
  storeId: Id<"store">,
  suffix: string,
) {
  const categoryId = await ctx.db.insert("category", {
    name: `Category ${suffix}`,
    slug: `category-${suffix}`,
    storeId,
  });
  const subcategoryId = await ctx.db.insert("subcategory", {
    categoryId,
    name: `Subcategory ${suffix}`,
    slug: `subcategory-${suffix}`,
    storeId,
  });
  const userId = await ctx.db.insert("athenaUser", {
    email: `sku-${suffix}@example.test`,
  });
  const productId = await ctx.db.insert("product", {
    availability: "live" as const,
    categoryId,
    createdByUserId: userId,
    currency: "GHS",
    inventoryCount: 10,
    name: `Product ${suffix}`,
    organizationId: (await ctx.db.get("store", storeId))!.organizationId,
    slug: `product-${suffix}`,
    storeId,
    subcategoryId,
  });
  return ctx.db.insert("productSku", {
    images: [],
    inventoryCount: 10,
    price: 1000,
    productId,
    quantityAvailable: 10,
    storeId,
  });
}

function movementIdentityArgs(
  overrides: Partial<{
    storeId: string;
    startDate: string;
    endDate: string;
    foldVersion: number;
    contractVersion: number;
    revisionVector: ReportMovementDayRevision[];
  }> = {},
) {
  return {
    storeId: "store-1",
    startDate: "2026-07-01",
    endDate: "2026-07-02",
    foldVersion: REPORTS_FOLD_VERSION,
    contractVersion: REPORT_MOVEMENT_CONTRACT_VERSION,
    revisionVector: [
      { operatingDate: "2026-07-01", revision: 7 },
      {
        operatingDate: "2026-07-02",
        revision: REPORT_MOVEMENT_EMPTY_DAY_REVISION,
      },
    ] satisfies ReportMovementDayRevision[],
    ...overrides,
  };
}

describe("U1 compatibility — legacy custom-summary rows keep their behavior", () => {
  it("adds the kind discriminator and every movement field as optional", () => {
    const fields = fieldsOf(reportRangeResultSchema);
    for (const key of [
      "kind",
      "movementPhase",
      "movementContractVersion",
      "movementRevisionVector",
      "movementAttempt",
      "movementEligibleAt",
      "movementFence",
      "movementSourceDayCursor",
      "movementTotals",
      "movementErrorCode",
      "movementCorrelationId",
    ]) {
      expect(fields[key], `reportRangeResult is missing ${key}`).toBeDefined();
      expect(
        fields[key].isOptional,
        `${key} must be optional so kind-absent legacy rows validate`,
      ).toBe("optional");
    }
  });

  it("reuses a kind-absent FAILED row until TTL — the legacy semantics, exactly", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(seedStore);
    const args = { storeId, startDate: "2026-07-01", endDate: "2026-07-10" };
    const requestKey = computeRequestKey(args);

    const failedId = await t.run((ctx) =>
      ctx.db.insert("reportRangeResult", {
        storeId,
        requestKey,
        startDate: args.startDate,
        endDate: args.endDate,
        status: "failed",
        failureReason: "boom",
        requestedAt: Date.now(),
        expiresAt: Date.now() + REPORT_RANGE_TTL_MS,
        foldVersion: REPORTS_FOLD_VERSION,
      }),
    );

    const reused = await t.run((ctx) => requestRangeCore(ctx, args));
    expect(reused.requestKey).toBe(requestKey);

    const rows = await t.run((ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      ctx.db.query("reportRangeResult").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).toBe(failedId);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].kind).toBeUndefined();
  });

  it("replaces a kind-absent failed row only once its TTL has lapsed", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(seedStore);
    const args = { storeId, startDate: "2026-07-01", endDate: "2026-07-10" };
    const requestKey = computeRequestKey(args);

    await t.run((ctx) =>
      ctx.db.insert("reportRangeResult", {
        storeId,
        requestKey,
        startDate: args.startDate,
        endDate: args.endDate,
        status: "failed",
        failureReason: "boom",
        requestedAt: Date.now() - REPORT_RANGE_TTL_MS - 1,
        expiresAt: Date.now() - 1,
        foldVersion: REPORTS_FOLD_VERSION,
      }),
    );

    await t.run((ctx) => requestRangeCore(ctx, args));
    const rows = await t.run((ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      ctx.db.query("reportRangeResult").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
  });

  it("keeps the legacy key shape ('range:' + hash) with no kind input", () => {
    const key = computeRequestKey({
      storeId: "store-1" as Id<"store">,
      startDate: "2026-07-01",
      endDate: "2026-07-10",
    });
    expect(key).toBe(
      `${REPORT_RANGE_SUMMARY_REQUEST_KEY_PREFIX}${stableStringHash(
        JSON.stringify([
          "store-1",
          "2026-07-01",
          "2026-07-10",
          REPORTS_FOLD_VERSION,
        ]),
      )}`,
    );
  });

  it("keeps the summary span limit at 366 while movement is capped at 92", () => {
    expect(REPORT_RANGE_MAX_DAYS_BY_KIND.custom_summary).toBe(
      REPORT_RANGE_MAX_DAYS,
    );
    expect(REPORT_RANGE_MAX_DAYS_BY_KIND.custom_summary).toBe(366);
    expect(REPORT_RANGE_MAX_DAYS_BY_KIND.sku_movement).toBe(
      REPORT_MOVEMENT_RANGE_MAX_DAYS,
    );
    expect(REPORT_RANGE_MAX_DAYS_BY_KIND.sku_movement).toBe(92);
    // Exactly 366 days remains valid for the legacy summary...
    expect(() =>
      validateReportRangeRequest("custom_summary", "2025-01-01", "2026-01-01"),
    ).not.toThrow();
    // ...and 367 remains rejected.
    expect(() =>
      validateReportRangeRequest("custom_summary", "2025-01-01", "2026-01-02"),
    ).toThrow(/maximum is 366 days/);
  });
});

describe("U1 identity — summary and movement requests cannot collide", () => {
  it("derives distinct keys for identical store/dates, in either creation order", () => {
    const legacy = computeRequestKey({
      storeId: "store-1" as Id<"store">,
      startDate: "2026-07-01",
      endDate: "2026-07-02",
    });
    const movement = computeMovementRequestKey(
      movementIdentityArgs(),
      stableStringHash,
    );
    // Pure derivations: creation order cannot matter, and the prefixes make
    // collision structurally impossible even under hash collision.
    expect(movement).not.toBe(legacy);
    expect(legacy.startsWith(REPORT_RANGE_SUMMARY_REQUEST_KEY_PREFIX)).toBe(
      true,
    );
    expect(movement.startsWith(REPORT_MOVEMENT_REQUEST_KEY_PREFIX)).toBe(true);
  });

  it("changes the movement key when any included day's revision changes", () => {
    const base = computeMovementRequestKey(
      movementIdentityArgs(),
      stableStringHash,
    );
    const revised = computeMovementRequestKey(
      movementIdentityArgs({
        revisionVector: [
          { operatingDate: "2026-07-01", revision: 8 },
          {
            operatingDate: "2026-07-02",
            revision: REPORT_MOVEMENT_EMPTY_DAY_REVISION,
          },
        ],
      }),
      stableStringHash,
    );
    expect(revised).not.toBe(base);
  });

  it("changes the movement key across contract and fold versions", () => {
    const base = computeMovementRequestKey(
      movementIdentityArgs(),
      stableStringHash,
    );
    expect(
      computeMovementRequestKey(
        movementIdentityArgs({
          contractVersion: REPORT_MOVEMENT_CONTRACT_VERSION + 1,
        }),
        stableStringHash,
      ),
    ).not.toBe(base);
    expect(
      computeMovementRequestKey(
        movementIdentityArgs({ foldVersion: REPORTS_FOLD_VERSION + 1 }),
        stableStringHash,
      ),
    ).not.toBe(base);
  });

  it("distinguishes an empty day from a revision that merely reads alike", () => {
    const emptyDay = computeMovementRequestKey(
      movementIdentityArgs({
        revisionVector: [
          {
            operatingDate: "2026-07-01",
            revision: REPORT_MOVEMENT_EMPTY_DAY_REVISION,
          },
        ],
      }),
      stableStringHash,
    );
    const zeroRevision = computeMovementRequestKey(
      movementIdentityArgs({
        revisionVector: [{ operatingDate: "2026-07-01", revision: 0 }],
      }),
      stableStringHash,
    );
    expect(emptyDay).not.toBe(zeroRevision);
  });
});

describe("U1 revision — uncertified source cannot become admissible", () => {
  it("keeps the certified revision optional on both source schemas", () => {
    for (const sourceSchema of [reportDaySchema, reportSkuDaySchema]) {
      const fields = fieldsOf(sourceSchema);
      expect(fields.certifiedFoldRevision).toBeDefined();
      expect(fields.certifiedFoldRevision.isOptional).toBe("optional");
    }
  });

  it("maps an absent day to the explicit empty-day sentinel", () => {
    expect(admissibleMovementDayRevision("2026-07-01", null)).toEqual({
      operatingDate: "2026-07-01",
      revision: REPORT_MOVEMENT_EMPTY_DAY_REVISION,
    });
  });

  it("rejects a folded day with no certified revision (repair pending)", () => {
    expect(
      admissibleMovementDayRevision("2026-07-01", {
        foldVersion: REPORTS_FOLD_VERSION,
      }),
    ).toBeNull();
  });

  it("rejects a day folded under a stale fold version", () => {
    expect(
      admissibleMovementDayRevision("2026-07-01", {
        foldVersion: REPORTS_FOLD_VERSION - 1,
        certifiedFoldRevision: 4,
      }),
    ).toBeNull();
  });

  it("admits a certified current-version day with its revision", () => {
    expect(
      admissibleMovementDayRevision("2026-07-01", {
        foldVersion: REPORTS_FOLD_VERSION,
        certifiedFoldRevision: 4,
      }),
    ).toEqual({ operatingDate: "2026-07-01", revision: 4 });
  });

  it("matches SKU rows only on an exact certified revision", () => {
    expect(
      movementSourceRowMatchesRevision(4, { certifiedFoldRevision: 4 }),
    ).toBe(true);
    expect(
      movementSourceRowMatchesRevision(4, { certifiedFoldRevision: 5 }),
    ).toBe(false);
    expect(movementSourceRowMatchesRevision(4, {})).toBe(false);
    // An empty-sentinel day has no admissible rows at all.
    expect(
      movementSourceRowMatchesRevision(REPORT_MOVEMENT_EMPTY_DAY_REVISION, {
        certifiedFoldRevision: 4,
      }),
    ).toBe(false);
  });
});

describe("U1 validation — movement uses the strict calendar check", () => {
  it("rejects calendar-impossible and malformed labels the loose span check misses", () => {
    // "2026-02-30" survives Date-arithmetic span checks (it rolls over) but
    // is not a real operating day.
    expect(() =>
      validateReportRangeRequest("sku_movement", "2026-02-30", "2026-03-01"),
    ).toThrow(/Invalid startDate/);
    expect(() =>
      validateReportRangeRequest("sku_movement", "2026-07-01", "2026-7-2"),
    ).toThrow(/Invalid endDate/);
    expect(() =>
      validateReportRangeRequest("sku_movement", "not-a-date", "2026-07-01"),
    ).toThrow(/Invalid startDate/);
  });

  it("rejects a reversed range", () => {
    expect(() =>
      validateReportRangeRequest("sku_movement", "2026-07-10", "2026-07-01"),
    ).toThrow(/startDate must be on or before endDate/);
  });

  it("accepts exactly 92 inclusive days and rejects 93", () => {
    // 2026-04-01 .. 2026-07-01 inclusive is exactly 92 days.
    expect(() =>
      validateReportRangeRequest("sku_movement", "2026-04-01", "2026-07-01"),
    ).not.toThrow();
    expect(() =>
      validateReportRangeRequest("sku_movement", "2026-04-01", "2026-07-02"),
    ).toThrow(/maximum is 92 days/);
  });
});

describe("U1 direction — signed net movement with an absolute sort measure", () => {
  it("ranks -24 ahead of +18 while both keep their signs", () => {
    // Ascending index order on the negated absolute value: -24 first.
    expect(movementAbsNetUnitsSortKey(-24)).toBeLessThan(
      movementAbsNetUnitsSortKey(18),
    );
    // The sort measure is direction-blind...
    expect(movementAbsNetUnitsSortKey(-24)).toBe(movementAbsNetUnitsSortKey(24));
    // ...and the schema stores the signed value separately from the key.
    const fields = fieldsOf(reportRangeMovementSkuSchema);
    expect(fields.netUnits.isOptional).toBe("required");
    expect(fields.absNetUnitsSortKey.isOptional).toBe("required");
  });

  it("keeps a fully-cancelled SKU representable at net zero", () => {
    expect(movementAbsNetUnitsSortKey(0)).toBe(0);
  });
});

describe("U1 ownership — stores cannot address one another's movement data", () => {
  it("derives distinct movement keys for equivalent ranges on two stores", () => {
    const a = computeMovementRequestKey(
      movementIdentityArgs({ storeId: "store-a" }),
      stableStringHash,
    );
    const b = computeMovementRequestKey(
      movementIdentityArgs({ storeId: "store-b" }),
      stableStringHash,
    );
    expect(a).not.toBe(b);
  });

  it("store-prefixed child indexes return only the owning store's rows", async () => {
    const t = convexTest(schema, modules);
    const { storeId: storeA } = await t.run((ctx) => seedStore(ctx, "a"));
    const { storeId: storeB } = await t.run((ctx) => seedStore(ctx, "b"));
    const skuA = await t.run((ctx) => seedProductSku(ctx, storeA, "own-a"));
    const skuB = await t.run((ctx) => seedProductSku(ctx, storeB, "own-b"));

    const headerFor = (storeId: Id<"store">, requestKey: string) => ({
      storeId,
      requestKey,
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      status: "pending" as const,
      kind: "sku_movement" as const,
      movementPhase: "queued" as const,
      requestedAt: Date.now(),
      expiresAt: Date.now() + REPORT_RANGE_TTL_MS,
      foldVersion: REPORTS_FOLD_VERSION,
    });

    const { headerA, headerB } = await t.run(async (ctx) => ({
      headerA: await ctx.db.insert(
        "reportRangeResult",
        headerFor(storeA, "movement:a"),
      ),
      headerB: await ctx.db.insert(
        "reportRangeResult",
        headerFor(storeB, "movement:b"),
      ),
    }));

    await t.run(async (ctx) => {
      await ctx.db.insert("reportRangeMovementSku", {
        storeId: storeA,
        rangeResultId: headerA,
        productSkuId: skuA,
        unitsSold: 10,
        unitsReturned: 2,
        netUnits: 8,
        absNetUnitsSortKey: movementAbsNetUnitsSortKey(8),
        expiresAt: Date.now() + REPORT_RANGE_TTL_MS,
      });
      await ctx.db.insert("reportRangeMovementSku", {
        storeId: storeB,
        rangeResultId: headerB,
        productSkuId: skuB,
        unitsSold: 5,
        unitsReturned: 30,
        netUnits: -25,
        absNetUnitsSortKey: movementAbsNetUnitsSortKey(-25),
        expiresAt: Date.now() + REPORT_RANGE_TTL_MS,
      });
    });

    // Store A addressing its own header sees only its own child.
    const ownRows = await t.run((ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      ctx.db
        .query("reportRangeMovementSku")
        .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
          q.eq("storeId", storeA).eq("rangeResultId", headerA),
        )
        .collect(),
    );
    expect(ownRows).toHaveLength(1);
    expect(ownRows[0].productSkuId).toBe(skuA);
    expect(ownRows[0].netUnits).toBe(8);

    // Store A substituting store B's header id gets nothing — the store
    // prefix binds every lookup to the authorized tenant.
    const substituted = await t.run((ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      ctx.db
        .query("reportRangeMovementSku")
        .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
          q.eq("storeId", storeA).eq("rangeResultId", headerB),
        )
        .collect(),
    );
    expect(substituted).toHaveLength(0);
  });
});

describe("U1 lifecycle — partial state can never read as completed", () => {
  const completedHeader = {
    movementPhase: "completed" as const,
    movementTotals: {
      unitsSold: 40,
      unitsReturned: 16,
      netUnits: 24,
      skuCount: 146,
    },
    computedAt: 1_700_000_000_000,
  };

  it("exposes a completed snapshot with totals and page count", () => {
    expect(deriveMovementRequestLifecycle(completedHeader)).toEqual({
      state: "completed",
      totals: completedHeader.movementTotals,
      completedAt: completedHeader.computedAt,
      pageCount: 8, // ceil(146 / 20)
    });
    expect(movementPageCount(146)).toBe(
      Math.ceil(146 / REPORT_MOVEMENT_PAGE_SIZE),
    );
  });

  it("keeps aggregating/ranking headers pending even with partial totals", () => {
    for (const movementPhase of [
      "queued",
      "aggregating",
      "ranking",
      "retry_wait",
      "cleaning",
    ] as const) {
      expect(
        deriveMovementRequestLifecycle({
          ...completedHeader,
          movementPhase,
        }),
      ).toEqual({ state: "queued_pending" });
    }
  });

  it("refuses to complete a completed-phase header missing totals or time", () => {
    expect(
      deriveMovementRequestLifecycle({
        ...completedHeader,
        movementTotals: undefined,
      }),
    ).toEqual({ state: "queued_pending" });
    expect(
      deriveMovementRequestLifecycle({
        ...completedHeader,
        computedAt: undefined,
      }),
    ).toEqual({ state: "queued_pending" });
  });

  it("sanitizes terminal errors to a code and correlation id only", () => {
    const lifecycle = deriveMovementRequestLifecycle({
      movementPhase: "terminal_error",
      movementErrorCode: "movement_worker_defect",
      movementCorrelationId: "corr-1234",
    });
    expect(lifecycle).toEqual({
      state: "terminal_error",
      errorCode: "movement_worker_defect",
      correlationId: "corr-1234",
    });
    // Internal detail never crosses: the public shape has no exception text,
    // cursor, or fence fields even if a caller passed a wider header.
    const widenedHeader = {
      movementPhase: "terminal_error",
      movementErrorCode: "movement_worker_defect",
      movementCorrelationId: "corr-1234",
      failureReason: "TypeError: secret internal detail",
      movementSourceDayCursor: "2026-07-03",
      movementFence: 9,
    } as Parameters<typeof deriveMovementRequestLifecycle>[0];
    const widened = deriveMovementRequestLifecycle(widenedHeader);
    expect(Object.keys(widened).sort()).toEqual([
      "correlationId",
      "errorCode",
      "state",
    ]);
  });

  it("keeps a terminal-error header without sanitized metadata pending", () => {
    expect(
      deriveMovementRequestLifecycle({ movementPhase: "terminal_error" }),
    ).toEqual({ state: "queued_pending" });
  });
});

describe("U1 cleanup — children are index-addressed and reseed-purged", () => {
  it("stores no child ids or unbounded arrays on the header", () => {
    const fields = fieldsOf(reportRangeResultSchema);
    // The only array the header may carry is the bounded (≤92-entry)
    // revision vector; per-SKU results live exclusively in the child table.
    const arrayFields = Object.entries(fields)
      .filter(([, validator]) => validator.kind === "array")
      .map(([name]) => name)
      .sort();
    expect(arrayFields).toEqual(["movementRevisionVector", "topSkus"]);
    expect(fields.movementSkuIds).toBeUndefined();
  });

  it("registers the child table for reseed purge, before its header", () => {
    const tables = RESEED_PURGE_TABLES as readonly string[];
    expect(tables).toContain("reportRangeMovementSku");
    expect(tables.indexOf("reportRangeMovementSku")).toBeLessThan(
      tables.indexOf("reportRangeResult"),
    );
  });

  it("finds expired children directly through their own expiry index", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run((ctx) => seedStore(ctx, "exp"));
    const sku = await t.run((ctx) => seedProductSku(ctx, storeId, "exp"));
    const now = Date.now();

    const headerId = await t.run((ctx) =>
      ctx.db.insert("reportRangeResult", {
        storeId,
        requestKey: "movement:exp",
        startDate: "2026-07-01",
        endDate: "2026-07-02",
        status: "pending",
        kind: "sku_movement",
        movementPhase: "completed",
        requestedAt: now - REPORT_RANGE_TTL_MS - 10,
        expiresAt: now - 10,
        foldVersion: REPORTS_FOLD_VERSION,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("reportRangeMovementSku", {
        storeId,
        rangeResultId: headerId,
        productSkuId: sku,
        unitsSold: 3,
        unitsReturned: 3,
        netUnits: 0,
        absNetUnitsSortKey: movementAbsNetUnitsSortKey(0),
        rank: 1,
        expiresAt: now - 10,
      }),
    );

    // Cleanup can find eligible children WITHOUT loading their header first.
    const eligible = await t.run((ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      ctx.db
        .query("reportRangeMovementSku")
        .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
        .collect(),
    );
    expect(eligible).toHaveLength(1);
    expect(eligible[0].rangeResultId).toBe(headerId);
  });
});
