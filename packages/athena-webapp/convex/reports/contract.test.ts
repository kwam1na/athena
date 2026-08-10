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
  unitsPerTransaction,
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
  REPORT_DRILLDOWN_RANGE_MAX_DAYS,
  REPORT_SKU_MIX_SYNC_MAX_DAYS,
  REPORT_SKU_MIX_SYNC_ROW_BUDGET,
  skuMixSyncRowProbe,
  REPORT_TRAILING_SIX_MONTHS_MAX_DAYS,
  REPORTS_FOLD_VERSION,
  trailingSixMonthsStart,
  trailingThreeMonthsStart,
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
  element?: AnyValidator;
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
      "trailing6Months",
      "priorTrailing6Months",
    ] as const) {
      const snapshot = fieldsOf(fields[period]);
      for (const key of REPORT_DAY_METRIC_KEYS) {
        expect(snapshot[key], `overview.${period} is missing ${key}`)
          .toBeDefined();
      }
      expect(snapshot.dayCount).toBeDefined();
      expect(snapshot.unsettledDayCount).toBeDefined();
      expect(snapshot.transactionCount).toBeDefined();
      expect(snapshot.transactionCount.isOptional).toBe("optional");
      expect(snapshot.transactionCoveredDayCount).toBeDefined();
      expect(snapshot.transactionCoveredDayCount.isOptional).toBe("optional");
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

  it("keeps legacy weekly day-closed lineage readable during projection refresh", () => {
    for (const schema of [
      reportWeekAcceptedSchema,
      (reportWeekCurrentSchema as AnyValidator).members!.find(
        (member) => member.fields?.included,
      )!,
    ]) {
      const lineage = fieldsOf(schema).scheduleLineage;
      expect(lineage.kind).toBe("array");
      const row = fieldsOf(lineage.element);
      expect(row.dayClosed).toBeDefined();
      expect(row.dayClosed.isOptional).toBe("optional");
    }
  });

  it("shares one optional close-evidence contract and bounds accepted correction", () => {
    const current = (reportWeekCurrentSchema as AnyValidator).members!.find(
      (member) => member.fields?.included,
    )!;
    for (const schema of [current, reportWeekAcceptedSchema]) {
      const closeEvidence = fieldsOf(schema).closeEvidence;
      expect(closeEvidence.isOptional).toBe("optional");
      const evidence = fieldsOf(closeEvidence);
      expect(Object.keys(evidence).sort()).toEqual([
        "cash",
        "expenses",
        "payments",
        "transactions",
      ]);
      expect(evidence.transactions.isOptional).toBe("optional");
      expect(Object.keys(fieldsOf(evidence.transactions)).sort()).toEqual([
        "coverage",
        "transactionCount",
      ]);
      expect(Object.keys(fieldsOf(fieldsOf(evidence.cash).coverage)).sort()).toEqual(
        ["scheduledDayCount", "status", "usableDayCount"],
      );
    }

    const correction = fieldsOf(reportWeekAcceptedSchema).correction;
    expect(correction.isOptional).toBe("optional");
    expect(Object.keys(fieldsOf(correction)).sort()).toEqual([
      "appliedAt",
      "candidateFingerprint",
      "closeEvidence",
      "contractVersion",
      "scheduleLineage",
      "sourceManifestFingerprint",
      "topSkuLeaders",
    ]);
    // Optional so corrections applied before the field landed — and sealed
    // weeks whose baseline retained no leaders — stay contract-safe.
    const correctedLeaders = fieldsOf(correction).topSkuLeaders;
    expect(correctedLeaders.isOptional).toBe("optional");
    // A correction only ever seals fully resolved identity; unlike the
    // acceptance-time shape, its labels are never optional.
    expect(Object.keys(fieldsOf(correctedLeaders.element!)).sort()).toEqual([
      "productName",
      "productSku",
      "productSkuId",
      "unitsSold",
    ]);
    for (const key of ["productName", "productSku"]) {
      expect(fieldsOf(correctedLeaders.element!)[key].isOptional).toBe(
        "required",
      );
    }
    const leader = fieldsOf(reportWeekAcceptedSchema).topSkuLeaders.element!;
    expect(fieldsOf(leader).productName.isOptional).toBe("optional");
    expect(fieldsOf(leader).productSku.isOptional).toBe("optional");
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

  it("keeps the summary span limit at 366 while movement serves the 184-day drill-down ceiling", () => {
    expect(REPORT_RANGE_MAX_DAYS_BY_KIND.custom_summary).toBe(
      REPORT_RANGE_MAX_DAYS,
    );
    expect(REPORT_RANGE_MAX_DAYS_BY_KIND.custom_summary).toBe(366);
    expect(REPORT_RANGE_MAX_DAYS_BY_KIND.sku_movement).toBe(
      REPORT_MOVEMENT_RANGE_MAX_DAYS,
    );
    // U7 deliberately widened movement from its 92-day rollout ceiling to the
    // shared drill-down ceiling — the per-day resumable design serves the span.
    expect(REPORT_RANGE_MAX_DAYS_BY_KIND.sku_movement).toBe(184);
    expect(REPORT_MOVEMENT_RANGE_MAX_DAYS).toBe(
      REPORT_DRILLDOWN_RANGE_MAX_DAYS,
    );
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

  it("accepts exactly 184 inclusive days and rejects 185", () => {
    // U7 widened movement to the drill-down ceiling.
    // 2026-01-01 .. 2026-07-03 inclusive is exactly 184 days.
    expect(() =>
      validateReportRangeRequest("sku_movement", "2026-01-01", "2026-07-03"),
    ).not.toThrow();
    expect(() =>
      validateReportRangeRequest("sku_movement", "2026-01-01", "2026-07-04"),
    ).toThrow(/maximum is 184 days/);
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
    // The only array the header may carry is the bounded (≤184-entry)
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

/**
 * U1 (trailing six months) — period vocabulary and named ceilings.
 *
 * These constants are DECLARED in U1 and applied by later units; the tests
 * pin the calendar math and the 184-day arithmetic so no later unit can
 * "simplify" the ceiling to 183 or drift a surface's future limit.
 */
describe("U1 six-month vocabulary and named ceilings", () => {
  function inclusiveDays(startDate: string, endDate: string): number {
    return (
      Math.floor(
        (Date.parse(`${endDate}T00:00:00.000Z`) -
          Date.parse(`${startDate}T00:00:00.000Z`)) /
          86_400_000,
      ) + 1
    );
  }

  it("returns the first of the month five months back, mirroring the three-month helper's alignment", () => {
    // Same-year anchor.
    expect(trailingSixMonthsStart("2026-08-15")).toBe("2026-03-01");
    // Anchor on the first of a month still spans six calendar months.
    expect(trailingSixMonthsStart("2026-08-01")).toBe("2026-03-01");
    // Year boundary.
    expect(trailingSixMonthsStart("2026-01-31")).toBe("2025-08-01");
    expect(trailingSixMonthsStart("2026-02-28")).toBe("2025-09-01");
    // Leap-day anchor.
    expect(trailingSixMonthsStart("2024-02-29")).toBe("2023-09-01");
    // Window containing a leap February.
    expect(trailingSixMonthsStart("2024-07-31")).toBe("2024-02-01");
    // Alignment parity: both helpers agree on the month-start convention —
    // the three-month start is always inside the six-month window and both
    // land on the first of a month.
    for (const anchor of ["2026-08-15", "2026-01-31", "2024-02-29"]) {
      expect(trailingSixMonthsStart(anchor) <= trailingThreeMonthsStart(anchor)).toBe(true);
      expect(trailingSixMonthsStart(anchor).endsWith("-01")).toBe(true);
      expect(trailingThreeMonthsStart(anchor).endsWith("-01")).toBe(true);
    }
  });

  it("caps the calendar-aligned window at exactly 184 inclusive days — never 183, never 185", () => {
    // The four longest six-calendar-month runs (documented at the constant).
    const longestWindowEnds = [
      "2026-08-31", // Mar–Aug
      "2026-10-31", // May–Oct
      "2026-12-31", // Jul–Dec
      "2027-01-31", // Aug–Jan
    ];
    for (const endDate of longestWindowEnds) {
      const span = inclusiveDays(trailingSixMonthsStart(endDate), endDate);
      expect(span).toBe(184);
      expect(span).toBe(REPORT_TRAILING_SIX_MONTHS_MAX_DAYS);
    }

    // Exhaustive: no anchor in a leap-year-spanning sweep produces a window
    // wider than the named maximum, and 184 is actually attained (so a 183
    // "simplification" would reject real windows).
    let widest = 0;
    for (
      let t = Date.parse("2023-01-01T00:00:00.000Z");
      t <= Date.parse("2027-12-31T00:00:00.000Z");
      t += 86_400_000
    ) {
      const anchor = new Date(t).toISOString().slice(0, 10);
      const span = inclusiveDays(trailingSixMonthsStart(anchor), anchor);
      expect(span).toBeLessThanOrEqual(REPORT_TRAILING_SIX_MONTHS_MAX_DAYS);
      widest = Math.max(widest, span);
    }
    expect(widest).toBe(184);

    // A 185-day span exceeds the named maximum.
    expect(inclusiveDays("2026-03-01", "2026-09-01")).toBe(185);
    expect(185 > REPORT_TRAILING_SIX_MONTHS_MAX_DAYS).toBe(true);
  });

  it("applies the per-surface ceilings at their shipped U7 values", () => {
    // The general drill-down ceiling is the six-month maximum itself.
    expect(REPORT_DRILLDOWN_RANGE_MAX_DAYS).toBe(184);
    expect(REPORT_DRILLDOWN_RANGE_MAX_DAYS).toBe(
      REPORT_TRAILING_SIX_MONTHS_MAX_DAYS,
    );

    // Mix sync-path threshold: 2 days x 2,000 fold-capped reportSkuDay rows
    // per day = 4,000 rows, strictly under the 5,000-row synchronous cap.
    expect(REPORT_SKU_MIX_SYNC_MAX_DAYS).toBe(2);
    expect(REPORT_SKU_MIX_SYNC_MAX_DAYS * 2_000).toBeLessThan(5_000);

    // The kinded ceiling record declares exactly the shipped kinds at their
    // shipped values — U4 added sku_mix at the full six-month ceiling, and
    // U7 deliberately raised sku_movement from its 92-day rollout ceiling to
    // the same 184-day drill-down ceiling (the preset's final surface).
    expect(REPORT_RANGE_MAX_DAYS_BY_KIND).toEqual({
      custom_summary: 366,
      sku_movement: 184,
      sku_mix: 184,
    });
  });
});

describe("skuMixSyncRowProbe", () => {
  const day = (operatingDate: string, skuDayRowCount?: number) => ({
    operatingDate,
    ...(skuDayRowCount === undefined ? {} : { skuDayRowCount }),
  });
  const probe = (
    rows: { operatingDate: string; skuDayRowCount?: number }[],
    range?: Partial<{
      coverageEndDate: string;
      coverageStartDate: string;
      endDate: string;
      startDate: string;
    }>,
  ) =>
    skuMixSyncRowProbe({
      coverageEndDate: "2026-07-05",
      coverageStartDate: "2026-07-01",
      endDate: "2026-07-05",
      rows,
      startDate: "2026-07-01",
      ...range,
    });

  it("sums the folded row counts across the range", () => {
    expect(
      probe([day("2026-07-01", 30), day("2026-07-03", 12), day("2026-07-05", 8)]),
    ).toBe(50);
  });

  it("keeps the budget strictly under the reader's fail-closed cap", () => {
    // The gap is the whole point: the probe sizes rows folded a moment before
    // the read, so it must leave room for a concurrent fold to add some.
    expect(REPORT_SKU_MIX_SYNC_ROW_BUDGET).toBeLessThan(5_000);
  });

  it("counts an absent day as zero — reportDay is sparse", () => {
    // No document means no activity means no reportSkuDay rows. Treating a
    // gap as unknown would make quiet ranges — the cheapest ones — unprovable.
    expect(probe([day("2026-07-02", 5)])).toBe(5);
    expect(probe([])).toBe(0);
  });

  it("ignores rows outside the requested range", () => {
    // The days rail loads a superset of the mix selection, so this is the
    // normal case, not an edge one.
    expect(
      probe([day("2026-07-01", 100), day("2026-07-03", 7)], {
        endDate: "2026-07-04",
        startDate: "2026-07-02",
      }),
    ).toBe(7);
  });

  it("is indeterminate when a day in range predates the count", () => {
    expect(probe([day("2026-07-01", 30), day("2026-07-03")])).toBeUndefined();
  });

  it("is determinate when the uncounted day falls outside the range", () => {
    expect(
      probe([day("2026-07-01"), day("2026-07-04", 9)], {
        coverageStartDate: "2026-07-01",
        endDate: "2026-07-05",
        startDate: "2026-07-03",
      }),
    ).toBe(9);
  });

  it("is indeterminate when coverage is narrower than the range", () => {
    // Row presence cannot prove the reader looked: a range extending past the
    // loaded window would otherwise sum to a confident understatement.
    expect(
      probe([day("2026-07-01", 4)], {
        coverageEndDate: "2026-07-03",
        endDate: "2026-07-05",
      }),
    ).toBeUndefined();
    expect(
      probe([day("2026-07-05", 4)], {
        coverageStartDate: "2026-07-03",
        startDate: "2026-07-01",
      }),
    ).toBeUndefined();
  });

  it("accepts coverage wider than the range", () => {
    expect(
      probe([day("2026-07-03", 6)], {
        coverageEndDate: "2026-08-01",
        coverageStartDate: "2026-06-01",
      }),
    ).toBe(6);
  });
});

describe("unitsPerTransaction", () => {
  // The metric spans a seam: units are folded from facts the instant a sale
  // lands, while the transaction count is settled only by a register close.
  // Dividing across that seam overstates the basket, so it is withheld.
  const base = {
    dayCount: 3,
    transactionCoveredDayCount: 3,
    transactionCount: 20,
    unitsSold: 50,
  };

  it("divides when every day in the window is closed", () => {
    expect(unitsPerTransaction(base)).toBe(2.5);
  });

  it("withholds when a day in the window has no close", () => {
    // The shape that matters: a week in progress. Units include today; the
    // transaction count cannot. 50/12 = 4.2 would be a fabricated basket.
    expect(
      unitsPerTransaction({ ...base, transactionCoveredDayCount: 2 }),
    ).toBeNull();
  });

  it("withholds on an open single day rather than reporting today's units", () => {
    expect(
      unitsPerTransaction({
        dayCount: 1,
        transactionCoveredDayCount: 0,
        transactionCount: 0,
        unitsSold: 25,
      }),
    ).toBeNull();
  });

  it("withholds when the fields are absent, never treating unknown as zero", () => {
    // A snapshot written before the fields existed knows nothing; it must not
    // divide by an implied zero or report a confident basket of its own.
    expect(
      unitsPerTransaction({ dayCount: 3, unitsSold: 50 }),
    ).toBeNull();
    expect(
      unitsPerTransaction({
        dayCount: 3,
        transactionCount: 20,
        unitsSold: 50,
      }),
    ).toBeNull();
  });

  it("withholds rather than dividing by zero on a closed day with no sales", () => {
    expect(
      unitsPerTransaction({
        dayCount: 1,
        transactionCoveredDayCount: 1,
        transactionCount: 0,
        unitsSold: 0,
      }),
    ).toBeNull();
  });
});
