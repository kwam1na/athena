import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildStoreIntradayProjection, checkpointAtOrBefore, exactOperatingDateRemainder, historicalOperatingDates, intradayScheduleKey, nextIntradayScheduleStep, persistedCheckpointAt } from "./storeIntraday";

describe("store intraday projection", () => {
  it("owns its indexed source read and exposes no caller-supplied facts", () => {
    const source = readFileSync(join(import.meta.dirname, "storeIntraday.ts"), "utf8");
    expect(source).toContain('by_generationId_operatingDate_recognitionAt_factId_metric');
    expect(source).toContain('.eq("operatingDate", args.operatingDate)');
    expect(source).toContain('.take(STORE_INTRADAY_REMAINDER_LIMIT + 1)');
    expect(source).toContain('limitingReason: "evidence_truncated"');
    expect(source).not.toMatch(/args:\s*\{[^}]*facts:/s);
  });

  it("does not let older operating dates consume the target remainder budget", () => {
    const rows = [
      ...Array.from({ length: 250 }, () => ({ operatingDate: "2026-07-07" })),
      { operatingDate: "2026-07-08", value: 1 },
    ];
    expect(exactOperatingDateRemainder(rows, "2026-07-08")).toEqual([
      { operatingDate: "2026-07-08", value: 1 },
    ]);
  });

  it("persists a recoverable blocked state instead of leaving overflow scheduled", () => {
    const source = readFileSync(join(import.meta.dirname, "storeIntraday.ts"), "utf8");
    expect(source).toContain('status: "blocked"');
    expect(source).toContain('blockingReason: "evidence_truncated"');
    expect(source).toContain("retryBlockedStoreIntradaySchedule");
    expect(nextIntradayScheduleStep({
      checkpointAt: 0,
      checkpointIntervalMs: 5 * 60_000,
      mode: "historical",
      operatingEndAt: 15 * 60_000,
      sourceActive: false,
    })).toEqual({ nextCheckpointAt: 5 * 60_000, status: "scheduled" });
  });

  it("advances an exact 7.5-minute retry chain through completion", () => {
    const interval = 7.5 * 60_000;
    const end = 30 * 60_000;
    let checkpointAt = persistedCheckpointAt(interval, interval);
    const persisted: number[] = [checkpointAt];
    while (true) {
      const next = nextIntradayScheduleStep({
        checkpointAt,
        checkpointIntervalMs: interval,
        mode: "historical",
        operatingEndAt: end,
        sourceActive: false,
      });
      if (next.status === "complete") break;
      expect(next.nextCheckpointAt).toBeDefined();
      checkpointAt = persistedCheckpointAt(next.nextCheckpointAt!, interval);
      persisted.push(checkpointAt);
    }
    expect(persisted).toEqual([450_000, 900_000, 1_350_000, 1_800_000]);
  });

  it("wakes a verified Reports epoch when historical readiness completes", () => {
    const source = readFileSync(join(import.meta.dirname, "storeIntraday.ts"), "utf8");
    expect(source).toContain("activateVerifiedReportsWorkspaceEpoch");
    expect(source).toContain('epoch?.status === "verified"');
  });

  it("uses stable fifteen-minute checkpoint boundaries", () => {
    const cutoff = Date.parse("2026-07-08T18:37:00.000Z");
    expect(new Date(checkpointAtOrBefore(cutoff)).toISOString()).toBe("2026-07-08T18:30:00.000Z");
  });

  it("deduplicates scheduling identity by generation and operating date", () => {
    expect(intradayScheduleKey("gen-1", "2026-07-08")).toBe(intradayScheduleKey("gen-1", "2026-07-08"));
    expect(intradayScheduleKey("gen-1", "2026-07-08")).not.toBe(intradayScheduleKey("gen-2", "2026-07-08"));
  });

  it("stops a chain at the operating end or source supersession", () => {
    expect(nextIntradayScheduleStep({ checkpointAt: 900_000, mode: "active", operatingEndAt: 1_000_000, sourceActive: true })).toEqual({ status: "complete" });
    expect(nextIntradayScheduleStep({ checkpointAt: 0, mode: "active", operatingEndAt: 9_000_000, sourceActive: false })).toEqual({ status: "superseded" });
    expect(nextIntradayScheduleStep({ checkpointAt: 0, mode: "historical", operatingEndAt: 900_000, sourceActive: false })).toEqual({ nextCheckpointAt: 900_000, status: "scheduled" });
  });

  it("builds bounded historical checkpoint work once per evidence date", () => {
    expect(historicalOperatingDates([
      { operatingDate: "2026-07-07" },
      { operatingDate: "2026-07-07" },
      { operatingDate: "2026-07-08" },
      {},
    ])).toEqual(["2026-07-07", "2026-07-08"]);
  });
  it("includes facts at the cutoff and excludes facts after it", () => {
    const cutoffAt = Date.parse("2026-07-08T18:37:00.000Z");
    const result = buildStoreIntradayProjection({
      checkpointAt: Date.parse("2026-07-08T18:30:00.000Z"),
      currencyCode: "USD",
      currencyMinorUnitScale: 2,
      cutoffAt,
      facts: [
        { cogsKnownMinor: 10, grossRevenueMinor: 25, netRevenueMinor: 25, quantity: 1, recognizedAt: Date.parse("2026-07-08T18:30:00.000Z") },
        { cogsKnownMinor: 40, grossRevenueMinor: 100, netRevenueMinor: 100, quantity: 1, recognizedAt: cutoffAt },
        { cogsKnownMinor: 20, grossRevenueMinor: 50, netRevenueMinor: 50, quantity: 1, recognizedAt: cutoffAt + 1 },
      ],
      generationId: "gen-1",
      operatingDate: "2026-07-08",
      sourceGenerationId: "store-day-1",
      sourceWatermark: cutoffAt,
    });

    expect(result).toMatchObject({
      factCount: 1,
      grossRevenueMinor: 100,
      knownCogsMinor: 40,
      netRevenueMinor: 100,
      status: "complete",
      unitsSold: 1,
    });
  });

  it("fails closed when the bounded remainder exceeds 200 scanned rows", () => {
    expect(() => buildStoreIntradayProjection({
      checkpointAt: 0,
      currencyCode: "USD",
      currencyMinorUnitScale: 2,
      cutoffAt: 1_000,
      facts: Array.from({ length: 201 }, (_, index) => ({
        cogsKnownMinor: 0,
        grossRevenueMinor: 0,
        netRevenueMinor: 0,
        quantity: 0,
        recognizedAt: index,
      })),
      generationId: "gen-1",
      operatingDate: "2026-07-08",
      sourceGenerationId: "store-day-1",
      sourceWatermark: 1_000,
    })).toThrow("evidence_truncated");
  });

  it("keeps unknown cost distinct from legitimate zero cost", () => {
    const result = buildStoreIntradayProjection({
      checkpointAt: 0,
      currencyCode: "USD",
      currencyMinorUnitScale: 2,
      cutoffAt: 100,
      facts: [
        { cogsKnownMinor: 0, grossRevenueMinor: 100, netRevenueMinor: 100, quantity: 1, recognizedAt: 10 },
        { cogsKnownMinor: null, grossRevenueMinor: 200, netRevenueMinor: 200, quantity: 1, recognizedAt: 20 },
      ],
      generationId: "gen-1",
      operatingDate: "2026-07-08",
      sourceGenerationId: "store-day-1",
      sourceWatermark: 100,
    });

    expect(result).toMatchObject({
      knownCogsMinor: 0,
      status: "partial",
      uncoveredRevenueMinor: 200,
    });
  });
});
