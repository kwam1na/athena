import { describe, expect, it } from "vitest";

import {
  overviewSearchFromWeeklyReturn,
  reportsOverviewSearchSchema,
  reportsWeeklySearchSchema,
  reportsWeeklyReturnFromState,
  weeklyOwnerReturnState,
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
      ...weeklyReturnSearchFromOverview(overviewSearch),
      ignored: "not part of the route contract",
    });

    expect(overviewSearchFromWeeklyReturn(weeklySearch)).toEqual(
      overviewSearch,
    );
  });

  it("preserves only validated Weekly selection in owner workflow history", () => {
    expect(
      weeklyOwnerReturnState({
        reportId: "week:2026-07-07",
        history: true,
        historyCursor: "cursor-2",
        historyCursorTrail: [null, "cursor-1"],
      }),
    ).toEqual({
      reportsWeeklyReturn: {
        reportId: "week:2026-07-07",
        history: true,
        historyCursor: "cursor-2",
        historyCursorTrail: [null, "cursor-1"],
      },
    });
  });

  it("restores validated active and historical Weekly selections", () => {
    expect(
      reportsWeeklyReturnFromState({
        reportsWeeklyReturn: {
          reportId: "week:2026-07-07",
          history: true,
          ignored: "discarded",
        },
      }),
    ).toEqual({ reportId: "week:2026-07-07", history: true });
    expect(
      reportsWeeklyReturnFromState({
        reportsWeeklyReturn: {
          history: true,
          overviewWindow: "weekToDate",
          ignored: "discarded",
        },
      }),
    ).toEqual({ history: true, overviewWindow: "weekToDate" });
    expect(
      reportsWeeklyReturnFromState({ reportsWeeklyReturn: {} }),
    ).toEqual({});
    expect(
      reportsWeeklyReturnFromState({
        reportsWeeklyReturn: { reportId: "not-a-week" },
      }),
    ).toBeNull();
    expect(reportsWeeklyReturnFromState({})).toBeNull();
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
