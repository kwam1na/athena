import { describe, expect, it } from "vitest";
import type { Validator } from "convex/values";
import {
  reportDaySchema,
  reportSkuDaySchema,
  reportOverviewSchema,
  reportPeriodSkuRollupSchema,
  reportRangeResultSchema,
} from "../schemas/reports";
import {
  REPORT_DAY_METRIC_KEYS,
  REPORT_SKU_DAY_METRIC_KEYS,
  REPORT_DAY_STATUSES,
  REPORT_FACT_KINDS,
  REPORT_SOURCE_DOMAINS,
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
});
