import { describe, expect, it, vi } from "vitest";

import {
  OWED_DAILY_CLOSE_LOOKBACK_DAYS,
  OWED_DAILY_CLOSE_MAX_PER_SWEEP,
  dailyCloseSweepResultSettled,
  selectRotatingOwedDailyCloseAttempt,
  runOwedDailyCloseSweepWithCtx,
  selectOwedDailyCloseDates,
} from "./owedDailyCloseSweep";

const AS_OF = "2026-07-25";

/** Every date the lookback window covers, oldest first. */
function fullWindow() {
  return [
    "2026-07-18",
    "2026-07-19",
    "2026-07-20",
    "2026-07-21",
    "2026-07-22",
    "2026-07-23",
    "2026-07-24",
  ];
}

describe("owed daily close selection", () => {
  it("persists continuation with one derived now before a store failure", async () => {
    const derivedNow = Date.parse("2026-07-25T00:30:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(derivedNow);
    const scheduled: Array<Record<string, unknown>> = [];
    const ctx = {
      runQuery: async () => ({
        candidates: [
          {
            asOfOperatingDate: AS_OF,
            attempt: ["2026-07-21"],
            owed: ["2026-07-21"],
            stale: ["2026-07-21"],
            storeId: "store-first",
          },
        ],
        continueCursor: "tail-cursor",
        isDone: false,
      }),
      runMutation: async () => {
        throw new Error("first store failed");
      },
      scheduler: {
        runAfter: async (_delay: number, _reference: unknown, args: unknown) => {
          scheduled.push(args as Record<string, unknown>);
          return "scheduled-id";
        },
      },
    };

    await expect(
      runOwedDailyCloseSweepWithCtx(ctx as never, { mode: "apply" }),
    ).rejects.toThrow("first store failed");
    expect(scheduled).toEqual([
      {
        cursor: "tail-cursor",
        mode: "apply",
        now: derivedNow,
      },
    ]);
    vi.restoreAllMocks();
  });
  it.each([
    ["hourly", 1],
    ["two-hourly", 2],
  ] as const)(
    "covers backlog lengths 4-7 at the real %s cadence",
    (_, cadenceHours) => {
      for (let backlogLength = 4; backlogLength <= 7; backlogLength += 1) {
        const owed = fullWindow().slice(0, backlogLength);
        const attempted = new Set<string>();
        for (let run = 0; run < backlogLength; run += 1) {
          for (const date of selectRotatingOwedDailyCloseAttempt({
            asOfOperatingDate: AS_OF,
            now:
              Date.parse(`${AS_OF}T00:30:00.000Z`) +
              run * cadenceHours * 60 * 60_000,
            owed,
          })) {
            attempted.add(date);
          }
        }
        expect([...attempted].sort()).toEqual(owed);
      }
    },
  );
  it("treats an applied historic close as settled in the same sweep", () => {
    expect(dailyCloseSweepResultSettled({ action: "applied" })).toBe(true);
    expect(dailyCloseSweepResultSettled({ action: "already_completed" })).toBe(
      true,
    );
    expect(dailyCloseSweepResultSettled({ action: "quarantined" })).toBe(false);
  });
  it("owes nothing when every day in the window is closed", () => {
    expect(
      selectOwedDailyCloseDates({
        asOfOperatingDate: AS_OF,
        completedOperatingDates: fullWindow(),
      }),
    ).toEqual({ owed: [], attempt: [], stale: [] });
  });

  it("finds the one day that missed its window", () => {
    // The production case: 2026-07-24 skipped every eligibility run because a
    // wedged sync held its register close, then became eligible too late.
    const result = selectOwedDailyCloseDates({
      asOfOperatingDate: AS_OF,
      completedOperatingDates: fullWindow().filter(
        (date) => date !== "2026-07-24",
      ),
    });

    expect(result.owed).toEqual(["2026-07-24"]);
    expect(result.attempt).toEqual(["2026-07-24"]);
    // One day old is well inside the transient-blocker band.
    expect(result.stale).toEqual([]);
  });

  it("never owes a close for the day still in progress", () => {
    // Today is excluded outright: a day mid-trade is not owed a close.
    const result = selectOwedDailyCloseDates({
      asOfOperatingDate: AS_OF,
      completedOperatingDates: [],
    });

    expect(result.owed).not.toContain(AS_OF);
    expect(result.owed).toHaveLength(OWED_DAILY_CLOSE_LOOKBACK_DAYS);
    expect(result.owed[0]).toBe("2026-07-18");
    expect(result.owed.at(-1)).toBe("2026-07-24");
  });

  it("does not reach past the lookback window", () => {
    const result = selectOwedDailyCloseDates({
      asOfOperatingDate: AS_OF,
      completedOperatingDates: [],
    });

    expect(result.owed).not.toContain("2026-07-17");
  });

  it("drains a backlog oldest-first in bounded slices", () => {
    const result = selectOwedDailyCloseDates({
      asOfOperatingDate: AS_OF,
      completedOperatingDates: [],
    });

    expect(result.attempt).toHaveLength(OWED_DAILY_CLOSE_MAX_PER_SWEEP);
    expect(result.attempt).toEqual([
      "2026-07-18",
      "2026-07-19",
      "2026-07-20",
    ]);
  });

  it("escalates only the days past the staleness threshold", () => {
    const result = selectOwedDailyCloseDates({
      asOfOperatingDate: AS_OF,
      completedOperatingDates: fullWindow().filter(
        (date) => date !== "2026-07-21" && date !== "2026-07-24",
      ),
    });

    expect(result.owed).toEqual(["2026-07-21", "2026-07-24"]);
    // 07-21 is four days old and clearly stuck; 07-24 is a day old and still
    // within the band where a transient blocker is expected to clear.
    expect(result.stale).toEqual(["2026-07-21"]);
  });

  it("treats a day exactly at the threshold as stale", () => {
    const result = selectOwedDailyCloseDates({
      asOfOperatingDate: AS_OF,
      completedOperatingDates: [],
      staleAfterDays: 2,
    });

    expect(result.stale).toContain("2026-07-23");
    expect(result.stale).not.toContain("2026-07-24");
  });

  it("honors explicit bounds", () => {
    const result = selectOwedDailyCloseDates({
      asOfOperatingDate: AS_OF,
      completedOperatingDates: [],
      lookbackDays: 2,
      maxPerSweep: 1,
    });

    expect(result.owed).toEqual(["2026-07-23", "2026-07-24"]);
    expect(result.attempt).toEqual(["2026-07-23"]);
  });

  it("selects nothing for a malformed operating date", () => {
    expect(
      selectOwedDailyCloseDates({
        asOfOperatingDate: "not-a-date",
        completedOperatingDates: [],
      }),
    ).toEqual({ owed: [], attempt: [], stale: [] });
  });

  it("selects nothing when bounds are degenerate", () => {
    expect(
      selectOwedDailyCloseDates({
        asOfOperatingDate: AS_OF,
        completedOperatingDates: [],
        lookbackDays: 0,
      }),
    ).toEqual({ owed: [], attempt: [], stale: [] });
  });

  it("crosses a month boundary correctly", () => {
    const result = selectOwedDailyCloseDates({
      asOfOperatingDate: "2026-08-02",
      completedOperatingDates: [],
      lookbackDays: 3,
    });

    expect(result.owed).toEqual(["2026-07-30", "2026-07-31", "2026-08-01"]);
  });
});
