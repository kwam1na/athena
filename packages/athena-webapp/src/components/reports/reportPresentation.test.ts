import { describe, expect, it } from "vitest";

import {
  formatMinorUnits,
  getReportStatusKind,
  getReportStatusPresentation,
} from "./reportPresentation";

describe("report presentation", () => {
  it("formats stored minor units without guessing from locale", () => {
    expect(
      formatMinorUnits({
        amountMinor: 12345,
        currency: "USD",
        minorUnitScale: 2,
      }),
    ).toBe("$123.45");
    expect(
      formatMinorUnits({
        amountMinor: 12345,
        currency: "JPY",
        minorUnitScale: 0,
      }),
    ).toBe("¥12,345");
  });

  it("keeps valid zero distinct from unavailable reporting", () => {
    expect(getReportStatusPresentation({ kind: "complete" }).title).toBe(
      "Reports are current",
    );
    expect(getReportStatusPresentation({ kind: "pre_cutover" }).title).toBe(
      "Reporting starts here",
    );
    expect(getReportStatusPresentation({ kind: "failed" }).title).toBe(
      "Reports are temporarily unavailable",
    );
  });

  it("uses metric-specific calm copy for limited states", () => {
    expect(
      getReportStatusPresentation({ kind: "uncosted_partial" }).description,
    ).toMatch(/cost coverage/i);
    expect(
      getReportStatusPresentation({ kind: "stale_last_good" }).description,
    ).toMatch(/last verified/i);
    expect(
      getReportStatusPresentation({ kind: "unsynchronized" }).description,
    ).toMatch(/still syncing/i);
    expect(
      getReportStatusPresentation({ kind: "mixed_currency" }).description,
    ).toMatch(/currency/i);
  });

  it("prioritizes aggregate trust limitations consistently", () => {
    expect(
      getReportStatusKind({
        completeness: "partial",
        limitingReason: "mixed_currency",
        status: "verified",
      }),
    ).toBe("mixed_currency");
    expect(
      getReportStatusKind({
        completeness: "complete",
        inventoryLimitingReason: "generation_incompatible",
        status: "verified",
      }),
    ).toBe("unsynchronized");
    expect(
      getReportStatusKind({ completeness: "stale", status: "active" }),
    ).toBe("stale_last_good");
    expect(getReportStatusKind({ status: "unavailable" })).toBe("failed");
  });
});
