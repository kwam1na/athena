import { describe, expect, it } from "vitest";
import {
  reconcilePosSourceFacts,
  type PosReconciliationRow,
} from "./posSourceReconciliation";

const row = (
  identity: string,
  amountMinor: number,
  quantity: number,
  lifecycle: PosReconciliationRow["lifecycle"] = "completion",
): PosReconciliationRow => ({
  amountMinor,
  businessEventKey: identity,
  currencyCode: "GHS",
  lifecycle,
  operatingDate: "2026-07-10",
  quantity,
});

describe("POS source-to-fact reconciliation", () => {
  it("accepts exact identity and metric parity", () => {
    expect(
      reconcilePosSourceFacts({
        facts: [row("sale:1", 1_000, 1)],
        source: [row("sale:1", 1_000, 1)],
      }),
    ).toMatchObject({ complete: true, unexplainedCount: 0 });
  });

  it("does not let net-cancelling identity differences hide omissions", () => {
    const result = reconcilePosSourceFacts({
      facts: [row("sale:2", 1_000, 1), row("void:2", -1_000, -1, "void")],
      source: [row("sale:1", 1_000, 1), row("void:1", -1_000, -1, "void")],
    });

    expect(result.complete).toBe(false);
    expect(result.amountDeltaMinor).toBe(0);
    expect(result.quantityDelta).toBe(0);
    expect(result.missingFactKeys).toEqual(["sale:1", "void:1"]);
    expect(result.unexpectedFactKeys).toEqual(["sale:2", "void:2"]);
  });

  it("reports material differences for the same identity", () => {
    const result = reconcilePosSourceFacts({
      facts: [row("sale:1", 900, 2)],
      source: [row("sale:1", 1_000, 1)],
    });

    expect(result.complete).toBe(false);
    expect(result.mismatchedKeys).toEqual(["sale:1"]);
    expect(result.amountDeltaMinor).toBe(-100);
    expect(result.quantityDelta).toBe(1);
  });

  it("rejects duplicate identities on either side", () => {
    expect(() =>
      reconcilePosSourceFacts({
        facts: [row("sale:1", 1_000, 1)],
        source: [row("sale:1", 1_000, 1), row("sale:1", 1_000, 1)],
      }),
    ).toThrow("duplicate POS reconciliation identity");
  });
});
