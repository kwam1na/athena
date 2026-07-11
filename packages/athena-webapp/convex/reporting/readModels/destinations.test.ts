import { describe, expect, it } from "vitest";

import { reportingDestination } from "./destinations";

describe("reporting destinations", () => {
  it("maps supported evidence to typed application destinations", () => {
    expect(reportingDestination({ sourceType: "pos_transaction", sourceId: "tx-1" })).toEqual({
      kind: "transaction",
      targetId: "tx-1",
    });
    expect(reportingDestination({ sourceType: "sku_activity", sourceId: "sku-1" })).toEqual({
      kind: "sku_activity",
      targetId: "sku-1",
    });
  });

  it("makes unsupported and unauthorized targets browser-indistinguishable", () => {
    expect(reportingDestination({ sourceType: "unknown", sourceId: "secret" })).toEqual({ kind: "unavailable" });
    expect(reportingDestination({ authorized: false, sourceType: "pos_transaction", sourceId: "tx-1" })).toEqual({ kind: "unavailable" });
  });
});
