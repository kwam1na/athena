import { describe, expect, it } from "vitest";

import {
  canonicalReportingFactSemanticFingerprint,
  reportingPeriodLineage,
} from "./factFingerprint";

const base = {
  businessEventKey: "pos:tx-1:line-1:sale",
  completeness: "complete",
  factType: "sale",
  occurrenceAt: 100,
  operatingDate: "2026-07-01",
  organizationId: "org-1",
  sourceDomain: "pos",
  storeId: "store-1",
};

describe("reporting fact period lineage", () => {
  it("keeps ordinary Store Schedule lineage backward compatible", () => {
    expect(reportingPeriodLineage({ scheduleVersionId: "schedule-1" })).toEqual({
      kind: "store_schedule",
      id: "schedule-1",
    });
  });

  it("makes historical policy lineage material to the semantic fingerprint", () => {
    const schedule = canonicalReportingFactSemanticFingerprint({
      ...base,
      scheduleVersionId: "schedule-1",
    });
    const policy = canonicalReportingFactSemanticFingerprint({
      ...base,
      historicalInterpretationPolicyId: "policy-1",
      historicalInterpretationPolicyHash: "hash-1",
    });
    const nextPolicy = canonicalReportingFactSemanticFingerprint({
      ...base,
      historicalInterpretationPolicyId: "policy-2",
      historicalInterpretationPolicyHash: "hash-2",
    });

    expect(policy).not.toBe(schedule);
    expect(nextPolicy).not.toBe(policy);
  });

  it("rejects missing, mixed, and unhashed policy lineage", () => {
    expect(() => reportingPeriodLineage({})).toThrow("exactly one");
    expect(() =>
      reportingPeriodLineage({
        scheduleVersionId: "schedule-1",
        historicalInterpretationPolicyId: "policy-1",
        historicalInterpretationPolicyHash: "hash-1",
      }),
    ).toThrow("exactly one");
    expect(() =>
      reportingPeriodLineage({ historicalInterpretationPolicyId: "policy-1" }),
    ).toThrow("immutable hash");
  });
});
