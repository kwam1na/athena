import { describe, expect, it } from "vitest";

import { assertReportingRunTransition, buildReportingRun } from "./runLedger";

describe("reporting run ledger", () => {
  it("builds auditable human and automation runs", () => {
    expect(
      buildReportingRun({
        actorKind: "human",
        actorUserId: "user-1",
        createdAt: 100,
        domain: "reporting",
        factContractVersion: 1,
        metricContractVersion: 1,
        operation: "custom_range",
        organizationId: "org-1",
        projectionContractVersion: 1,
        runType: "custom_range",
        storeId: "store-1",
      }),
    ).toMatchObject({
      actorKind: "human",
      failedCount: 0,
      processedCount: 0,
      status: "pending",
    });
  });

  it("allows pause/resume/retry but rejects terminal reopening", () => {
    expect(() => assertReportingRunTransition("running", "paused")).not.toThrow();
    expect(() => assertReportingRunTransition("paused", "running")).not.toThrow();
    expect(() => assertReportingRunTransition("failed", "running")).not.toThrow();
    expect(() => assertReportingRunTransition("completed", "running")).toThrow(
      "Invalid reporting run transition",
    );
  });
});
