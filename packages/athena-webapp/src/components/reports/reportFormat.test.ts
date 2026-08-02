import { describe, expect, it } from "vitest";

import {
  formatBasisPoints,
  formatOperatingDate,
  formatOperatingDateList,
  formatOptionalMoney,
  formatReportMoney,
  formatReportProfit,
  formatSkuDisplayName,
  formatUnits,
  reportDayStatusPresentation,
  reportProfitHelper,
} from "./reportFormat";

describe("reportFormat", () => {
  it("includes the weekday in report dates", () => {
    expect(formatOperatingDate("2026-07-17")).toBe("Fri, Jul 17, 2026");
  });

  it("names disclosure dates in sentence form without repeating the year", () => {
    expect(formatOperatingDateList([])).toBe("");
    expect(formatOperatingDateList(["2026-08-02"])).toBe("Sun, Aug 2");
    expect(formatOperatingDateList(["2026-08-01", "2026-08-02"])).toBe(
      "Sat, Aug 1 and Sun, Aug 2",
    );
    expect(
      formatOperatingDateList(["2026-07-31", "2026-08-01", "2026-08-02"]),
    ).toBe("Jul 31, Aug 1, and Aug 2");
  });

  it("formats minor-unit money using the store currency", () => {
    expect(formatReportMoney(123456, "USD")).toContain("1,234.56");
  });

  it("puts an em dash in the value slot and the reason in a helper", () => {
    // The reason lives in a helper line, not in the value slot.
    expect(formatReportProfit(null, "USD")).toBe("—");
    expect(reportProfitHelper(null)).toBe("No item cost recorded");
    expect(reportProfitHelper(1234)).toBeUndefined();
  });

  it("formats a non-null gross profit as money", () => {
    expect(formatReportProfit(5050, "USD")).toContain("50.50");
  });

  it("renders '—' only for genuinely null/undefined optional money", () => {
    expect(formatOptionalMoney(null, "USD")).toBe("—");
    expect(formatOptionalMoney(undefined, "USD")).toBe("—");
    expect(formatOptionalMoney(0, "USD")).not.toBe("—");
  });

  it("renders '—' only for genuinely null/undefined units", () => {
    expect(formatUnits(null)).toBe("—");
    expect(formatUnits(undefined)).toBe("—");
    expect(formatUnits(0)).toBe("0");
  });

  it("formats basis points as signed percentages and '—' for null", () => {
    expect(formatBasisPoints(250)).toBe("+2.5%");
    expect(formatBasisPoints(-100)).toBe("-1.0%");
    expect(formatBasisPoints(null)).toBe("—");
    expect(formatBasisPoints(undefined)).toBe("—");
  });

  it("covers every contract day status with a presentation", () => {
    for (const status of [
      "open",
      "provisional",
      "reconciled",
      "amended",
    ] as const) {
      expect(reportDayStatusPresentation(status).label).toBeTruthy();
    }
  });
});

describe("formatSkuDisplayName", () => {
  it("normalizes an operator-entered product name", () => {
    expect(
      formatSkuDisplayName(
        { displayName: "oshe", sku: "6N2Y-JY3-5G6" },
        "sku-1",
      ),
    ).toBe("Oshe");
    expect(
      formatSkuDisplayName(
        { displayName: "DRYER COMB BIG", sku: "6N2Y-AAA-111" },
        "sku-1",
      ),
    ).toBe("Dryer Comb Big");
  });

  it("leaves a SKU-code fallback untouched, preserving its case", () => {
    expect(
      formatSkuDisplayName(
        { displayName: "6N2Y-JY3-5G6", sku: "6N2Y-JY3-5G6" },
        "sku-1",
      ),
    ).toBe("6N2Y-JY3-5G6");
  });

  it("leaves an id fallback untouched", () => {
    expect(
      formatSkuDisplayName(
        { displayName: "kx70hda5jszy", sku: undefined },
        "kx70hda5jszy",
      ),
    ).toBe("kx70hda5jszy");
    expect(formatSkuDisplayName(undefined, "kx70hda5jszy")).toBe(
      "kx70hda5jszy",
    );
  });
});
