import { describe, expect, it } from "vitest";
import { buildDailyCloseTrustSummary } from "./dailyCloseTrust";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Daily Close trust summary", () => {
  it("is materialized by the production Daily Close projection path", () => {
    const source = readFileSync(join(import.meta.dirname, "dailyClose.ts"), "utf8");
    expect(source).toContain("materializeDailyCloseTrustWithCtx");
    expect(source).toContain("await refreshDailyCloseTrust");
  });
  it("uses canonical metrics and exposes close deltas only as trust evidence", () => {
    expect(buildDailyCloseTrustSummary({
      acceptedCloseVersion: 2, completeness: "complete", operatingDate: "2026-07-10",
      postCloseDeficitAdjustmentDeltaMinor: 0, postCloseNetSalesDeltaMinor: 25,
      postCloseRefundsDeltaMinor: 0,
    })).toEqual({
      acceptedCloseVersion: 2, completeness: "complete", hasPostCloseActivity: true,
      operatingDate: "2026-07-10", postCloseDeficitAdjustmentDeltaMinor: 0,
      postCloseNetSalesDeltaMinor: 25, postCloseRefundsDeltaMinor: 0,
    });
  });
});
