import { describe, expect, it } from "vitest";

import { reportsWeeklySearchSchema } from "./weekly";

describe("reports weekly route search", () => {
  it("owns historical selection separately from Overview return context", () => {
    expect(
      reportsWeeklySearchSchema.parse({
        reportId: "week:2026-07-06",
        history: true,
        units: true,
        overviewWindow: "trailing30",
      }),
    ).toEqual({
      reportId: "week:2026-07-06",
      history: true,
      units: true,
      overviewWindow: "trailing30",
    });
  });

  it("carries the units sheet continuity keys and omits their defaults", () => {
    const sheetState = {
      units: true,
      unitsTab: "granular" as const,
      unitsPage: 4,
      unitsFocus: "sku-61",
      unitsScroll: 640,
    };
    expect(reportsWeeklySearchSchema.parse(sheetState)).toEqual(sheetState);
    expect(reportsWeeklySearchSchema.parse({ units: true })).toEqual({
      units: true,
    });
    expect(() =>
      reportsWeeklySearchSchema.parse({ unitsTab: "top" }),
    ).toThrow();
    expect(() => reportsWeeklySearchSchema.parse({ unitsPage: 0 })).toThrow();
    expect(() =>
      reportsWeeklySearchSchema.parse({ unitsScroll: -10 }),
    ).toThrow();
  });
});
