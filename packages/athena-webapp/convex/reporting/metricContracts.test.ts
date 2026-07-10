import { describe, expect, it } from "vitest";

import {
  getMetricContract,
  validateFactContractVersion,
  validateMetricContractVersion,
} from "./metricContracts";

describe("reporting metric contracts", () => {
  it("names the definition and unknown-data policy for a supported metric", () => {
    expect(getMetricContract("net_sales", 1)).toMatchObject({
      metric: "net_sales",
      version: 1,
      recognition: "owning_financial_effect",
      unknownData: "withhold_when_required_source_is_incomplete",
    });
  });

  it("rejects unknown fact and metric versions", () => {
    expect(() => validateFactContractVersion(99)).toThrow(
      "Unsupported reporting fact contract version.",
    );
    expect(() => validateMetricContractVersion("net_sales", 99)).toThrow(
      "Unsupported reporting metric contract version.",
    );
  });

  it("owns returns, uncovered revenue, procurement, and inventory consumption", () => {
    for (const metric of [
      "units_returned",
      "uncosted_revenue",
      "purchase_commitment_units",
      "purchase_commitment_value",
      "inventory_consumed_units",
      "inventory_consumed_value",
    ] as const) {
      expect(getMetricContract(metric, 1)).toMatchObject({
        metric,
        version: 1,
      });
    }
  });

  it("versions settlement metrics independently from revenue", () => {
    for (const metric of [
      "payments_collected",
      "payments_refunded",
      "payments_reversed",
      "payment_allocated",
    ] as const) {
      expect(getMetricContract(metric, 1)).toMatchObject({
        exclusion: expect.stringMatching(/Revenue|revenue/),
        metric,
        requiredSourceDomains: ["payments"],
        signHandling: "signed_effect",
        version: 1,
      });
    }
  });
});
