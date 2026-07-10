import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  decideStableCatchUp,
  reconciliationCurrencySegmentKey,
  reconcileRebuildSnapshot,
  stableRebuildWatermark,
} from "./rebuild";

describe("reporting projection rebuild", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "rebuild.ts"),
    "utf8",
  );

  it("uses mutation-time frozen watermarks and bounded continuation", () => {
    expect(source).toContain('withIndex("by_storeId"');
    expect(source).toContain('.gt("_creationTime", run.frozenWatermark!)');
    expect(source).toContain('.lte("_creationTime", run.frozenWatermark!)');
    expect(source).not.toContain('withIndex("by_storeId_createdAt"');
    expect(source).not.toContain('withIndex("by_storeId_acceptedAt"');
    expect(source).toContain("PROJECTION_REBUILD_PAGE_SIZE = 20");
    expect(source).toContain("projection_rebuild_catching_up");
    expect(source).toContain("stableWatermark");
    expect(source).toContain("source_incomplete");
    expect(stableRebuildWatermark(500)).toBe(499);
    expect(source).toContain('invariant: "source_watermark_advanced"');
    expect(source).toContain("currencyForFactMetric(");
    expect(source).toContain("recordProjectionRebuildFailure");
  });

  it("never activates a candidate from the rebuild processor", () => {
    expect(source).not.toContain('status: "active"');
    expect(source).not.toContain(
      'ctx.db.insert("reportingProjectionActivation"',
    );
  });

  it("verifies exact canonical, candidate, and compatible active parity", () => {
    expect(
      reconcileRebuildSnapshot({
        active: [segment("candidate-1", 1_000)],
        candidate: [segment("candidate-1", 1_000)],
        candidateGenerationId: "candidate-1",
        evidence: [evidence("candidate-1")],
        expected: [segment("candidate-1", 1_000)],
      }),
    ).toEqual({ discrepancies: [], status: "verified" });
  });

  it("persists named source-to-projection and incremental drift", () => {
    const result = reconcileRebuildSnapshot({
      active: [segment("candidate-1", 900)],
      candidate: [segment("candidate-1", 950)],
      candidateGenerationId: "candidate-1",
      evidence: [evidence("candidate-1")],
      expected: [segment("candidate-1", 1_000)],
    });

    expect(result.status).toBe("failed");
    expect(result.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actual: 950,
          expected: 1_000,
          invariant: "source_to_projection",
          unexplainedDifference: -50,
        }),
        expect.objectContaining({
          actual: 950,
          expected: 900,
          invariant: "incremental_to_rebuild",
          unexplainedDifference: 50,
        }),
      ]),
    );
  });

  it("detects active segments missing from the rebuilt candidate", () => {
    const result = reconcileRebuildSnapshot({
      active: [segment("active-1", 500)],
      candidate: [],
      candidateGenerationId: "candidate-1",
      evidence: [],
      expected: [],
    });

    expect(result.discrepancies).toContainEqual(
      expect.objectContaining({
        actual: 0,
        expected: 500,
        invariant: "incremental_to_rebuild",
      }),
    );
  });

  it("compares active and candidate values within each currency segment", () => {
    const result = reconcileRebuildSnapshot({
      active: [
        segment("active-1", 700, "GHS"),
        segment("active-1", 300, "USD"),
      ],
      candidate: [
        segment("candidate-1", 300, "GHS"),
        segment("candidate-1", 700, "USD"),
      ],
      candidateGenerationId: "candidate-1",
      evidence: [],
      expected: [],
    });

    expect(
      result.discrepancies.filter(
        (row) => row.invariant === "incremental_to_rebuild",
      ),
    ).toHaveLength(2);
  });

  it("restarts catch-up when facts arrive beyond the frozen watermark", () => {
    expect(
      decideStableCatchUp({
        currentWatermark: 500,
        laterAcceptedAt: 501,
        nextWatermark: 600,
      }),
    ).toEqual({ nextPeriodStart: 500, nextWatermark: 600, restart: true });
    expect(
      decideStableCatchUp({
        currentWatermark: 500,
        laterAcceptedAt: null,
        nextWatermark: 600,
      }),
    ).toEqual({ restart: false });
  });

  it("fails duplicate candidate evidence without double-counting expectations", () => {
    const result = reconcileRebuildSnapshot({
      candidate: [segment("candidate-1", 1_000)],
      candidateGenerationId: "candidate-1",
      evidence: [evidence("candidate-1"), evidence("candidate-1")],
      expected: [segment("candidate-1", 1_000)],
    });

    expect(result.discrepancies).toContainEqual(
      expect.objectContaining({
        actual: 2,
        expected: 1,
        invariant: "duplicate_projection_evidence",
      }),
    );
  });

  it("fails mixed currency instead of summing unlike segments", () => {
    const result = reconcileRebuildSnapshot({
      candidate: [segment("candidate-1", 1_000, "GHS")],
      candidateGenerationId: "candidate-1",
      evidence: [evidence("candidate-1")],
      expected: [
        segment("candidate-1", 1_000, "GHS"),
        segment("candidate-1", 500, "USD"),
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.discrepancies).toContainEqual(
      expect.objectContaining({ invariant: "mixed_currency" }),
    );
  });

  it("fails monetary segments without an explicit currency", () => {
    const result = reconcileRebuildSnapshot({
      candidate: [segment("candidate-1", 1_000, null)],
      candidateGenerationId: "candidate-1",
      evidence: [evidence("candidate-1")],
      expected: [segment("candidate-1", 1_000, null)],
    });

    expect(result.discrepancies).toContainEqual(
      expect.objectContaining({ invariant: "currency_missing" }),
    );
  });

  it("segments reconciliation by currency and minor-unit convention", () => {
    expect(reconciliationCurrencySegmentKey("GHS", 2)).toBe("GHS@2");
    expect(reconciliationCurrencySegmentKey("GHS", 3)).toBe("GHS@3");
    expect(reconciliationCurrencySegmentKey("GHS")).toBe("GHS@unknown");
    expect(reconciliationCurrencySegmentKey()).toBe("__none__");
  });

  it("isolates candidate rows and evidence from other generations", () => {
    expect(
      reconcileRebuildSnapshot({
        candidate: [
          segment("candidate-1", 1_000),
          segment("other-candidate", 99_999),
        ],
        candidateGenerationId: "candidate-1",
        evidence: [
          evidence("candidate-1"),
          evidence("other-candidate"),
          evidence("other-candidate"),
        ],
        expected: [segment("candidate-1", 1_000)],
      }),
    ).toEqual({ discrepancies: [], status: "verified" });
  });
});

function segment(
  generationId: string,
  value: number,
  currencyCode: string | null = "GHS",
) {
  return {
    currencyCode,
    generationId,
    logicalKey: "2026-07-09|gross_sales",
    metric: "gross_sales",
    rowCount: 1,
    value,
  };
}

function evidence(generationId: string) {
  return { factId: "fact-1", generationId, metric: "gross_sales" };
}
