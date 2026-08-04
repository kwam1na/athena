import { describe, expect, it } from "vitest";

import {
  closedUnitsSheetSearch,
  overviewSearchFromWeeklyReturn,
  parseUnitsSheetFocusSearch,
  reportsOverviewSearchSchema,
  reportsWeeklySearchSchema,
  resetUnitsSheetContextSearch,
  unitsSheetFocusSearchValue,
  weeklyReturnSearchFromOverview,
} from "./reportRouteSearch";

const overviewSearch = {
  window: "weekToDate" as const,
  daysStart: "2026-07-01",
  daysEnd: "2026-07-28",
  daysTableStart: "2026-06-01",
  daysTableEnd: "2026-07-31",
  daysPage: 2,
  selectedDay: "2026-07-16",
};

describe("report route search", () => {
  it("keeps the Overview schema unchanged in its shared home", () => {
    expect(reportsOverviewSearchSchema.parse(overviewSearch)).toEqual(
      overviewSearch,
    );
    expect(
      reportsOverviewSearchSchema.parse({ ...overviewSearch, units: true }),
    ).toEqual({ ...overviewSearch, units: true });
  });

  it("maps every supported Overview value into namespaced Weekly return state", () => {
    expect(weeklyReturnSearchFromOverview(overviewSearch)).toEqual({
      overviewWindow: "weekToDate",
      overviewDaysStart: "2026-07-01",
      overviewDaysEnd: "2026-07-28",
      overviewDaysTableStart: "2026-06-01",
      overviewDaysTableEnd: "2026-07-31",
      overviewDaysPage: 2,
      overviewSelectedDay: "2026-07-16",
    });
  });

  it("restores only the validated Overview values from Weekly return state", () => {
    const weeklySearch = reportsWeeklySearchSchema.parse({
      reportId: "week:2026-07-07",
      history: true,
      historyCursor: "cursor-2",
      historyCursorTrail: [null, "cursor-1"],
      units: true,
      ...weeklyReturnSearchFromOverview(overviewSearch),
      ignored: "not part of the route contract",
    });

    expect(overviewSearchFromWeeklyReturn(weeklySearch)).toEqual(
      overviewSearch,
    );
  });

  it("accepts the units sheet continuity keys identically on both routes", () => {
    const sheetState = {
      units: true,
      unitsTab: "granular" as const,
      unitsPage: 4,
      unitsFocus: "sku-61",
      unitsScroll: 640,
    };
    expect(reportsOverviewSearchSchema.parse(sheetState)).toEqual(sheetState);
    expect(reportsWeeklySearchSchema.parse(sheetState)).toEqual(sheetState);
    // The default state serializes nothing beyond the open flag itself.
    expect(reportsOverviewSearchSchema.parse({ units: true })).toEqual({
      units: true,
    });
    expect(reportsWeeklySearchSchema.parse({ units: true })).toEqual({
      units: true,
    });
  });

  it("encodes the focus surface inside the existing one-shot focus token", () => {
    expect(unitsSheetFocusSearchValue("sku-61", "table")).toBe("sku-61");
    expect(unitsSheetFocusSearchValue("sku-61", "chart")).toBe(
      "chart:sku-61",
    );
    expect(parseUnitsSheetFocusSearch("sku-61")).toEqual({
      productSkuId: "sku-61",
      surface: "table",
    });
    expect(parseUnitsSheetFocusSearch("chart:sku-61")).toEqual({
      productSkuId: "sku-61",
      surface: "chart",
    });
    expect(parseUnitsSheetFocusSearch(undefined)).toEqual({
      productSkuId: undefined,
      surface: undefined,
    });
  });

  it("rejects malformed units sheet continuity values on both routes", () => {
    for (const schema of [
      reportsOverviewSearchSchema,
      reportsWeeklySearchSchema,
    ]) {
      // Top movers is the default tab and never serializes.
      expect(() => schema.parse({ unitsTab: "top" })).toThrow();
      expect(() => schema.parse({ unitsPage: 0 })).toThrow();
      expect(() => schema.parse({ unitsPage: 1.5 })).toThrow();
      expect(() => schema.parse({ unitsFocus: "" })).toThrow();
      expect(() => schema.parse({ unitsFocus: "x".repeat(257) })).toThrow();
      expect(() => schema.parse({ unitsScroll: -1 })).toThrow();
      expect(() => schema.parse({ unitsScroll: 12.5 })).toThrow();
    }
  });

  it("keeps period-scoped sheet state out of the weekly<->overview bridges, like `units` itself", () => {
    const withSheetState = {
      ...overviewSearch,
      units: true,
      unitsTab: "granular" as const,
      unitsPage: 4,
      unitsFocus: "sku-61",
      unitsScroll: 640,
    };
    expect(weeklyReturnSearchFromOverview(withSheetState)).toEqual(
      weeklyReturnSearchFromOverview(overviewSearch),
    );
    expect(
      overviewSearchFromWeeklyReturn({
        ...weeklyReturnSearchFromOverview(overviewSearch),
        units: true,
        unitsTab: "granular",
        unitsPage: 4,
        unitsFocus: "sku-61",
        unitsScroll: 640,
      }),
    ).toEqual(overviewSearch);
  });

  it("spells out the sheet-owned cleanup sets used by both routes", () => {
    expect(resetUnitsSheetContextSearch).toEqual({
      unitsTab: undefined,
      unitsPage: undefined,
      unitsFocus: undefined,
      unitsScroll: undefined,
    });
    expect(closedUnitsSheetSearch).toEqual({
      units: undefined,
      ...resetUnitsSheetContextSearch,
    });
  });

  it("returns Overview defaults when no valid return context exists", () => {
    expect(overviewSearchFromWeeklyReturn({})).toEqual({});
    expect(reportsWeeklySearchSchema.parse({ ignored: "unknown" })).toEqual({});
    expect(() =>
      reportsWeeklySearchSchema.parse({ overviewDaysPage: "not-a-page" }),
    ).toThrow();
    expect(() =>
      reportsWeeklySearchSchema.parse({ reportId: "not a report id" }),
    ).toThrow();
    expect(() =>
      reportsWeeklySearchSchema.parse({ historyCursor: "" }),
    ).toThrow();
    expect(() =>
      reportsWeeklySearchSchema.parse({ historyCursor: "x".repeat(2_049) }),
    ).toThrow();
    expect(() =>
      reportsWeeklySearchSchema.parse({ historyCursorTrail: [""] }),
    ).toThrow();
    expect(() =>
      reportsWeeklySearchSchema.parse({
        historyCursorTrail: Array.from({ length: 25 }, () => null),
      }),
    ).toThrow();
  });
});
