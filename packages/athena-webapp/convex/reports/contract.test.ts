import { describe, expect, it } from "vitest";
import type { Validator } from "convex/values";
import {
  reportDaySchema,
  reportSkuDaySchema,
  reportOverviewSchema,
  reportPeriodSkuRollupSchema,
  reportRangeResultSchema,
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
  addWeekMetrics,
  combineWeekCompleteness,
} from "../../shared/reportsContract";
import type {
  ReportWeekCompleteness,
  ReportWeekMetrics,
} from "../../shared/reportsContract";
import { reportFactSchema } from "../schemas/reports/facts";

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
