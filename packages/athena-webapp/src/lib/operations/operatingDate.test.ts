import { afterEach, describe, expect, it } from "vitest";

import {
  getLocalDateFromOperatingDate,
  getLocalOperatingDate,
  getLocalOperatingDateRange,
  getLocalOperatingDateRangeFromSearch,
  getOperatingClockNow,
  setOperatingClockOverride,
} from "./operatingDate";

afterEach(() => {
  setOperatingClockOverride(null);
});

describe("getLocalOperatingDate", () => {
  it("formats the local calendar day rather than the UTC day", () => {
    const date = new Date(2026, 4, 14, 13, 30);

    expect(getLocalOperatingDate(date)).toBe("2026-05-14");
  });

  it("stays on the local day near midnight, where the UTC day may differ", () => {
    expect(getLocalOperatingDate(new Date(2026, 4, 14, 0, 5))).toBe("2026-05-14");
    expect(getLocalOperatingDate(new Date(2026, 4, 14, 23, 55))).toBe("2026-05-14");
  });

  it("defaults to now", () => {
    const now = new Date();

    expect(getLocalOperatingDate()).toBe(getLocalOperatingDate(now));
  });
});

describe("getLocalOperatingDateRange", () => {
  it("spans local midnight to the next local midnight", () => {
    const range = getLocalOperatingDateRange(new Date(2026, 4, 14, 13, 30));

    expect(new Date(range.startAt)).toEqual(new Date(2026, 4, 14));
    expect(new Date(range.endAt)).toEqual(new Date(2026, 4, 15));
    expect(range.operatingDate).toBe("2026-05-14");
  });

  it("produces a window that contains the supplied instant", () => {
    const date = new Date(2026, 4, 14, 13, 30);
    const range = getLocalOperatingDateRange(date);

    expect(range.startAt).toBeLessThanOrEqual(date.getTime());
    expect(range.endAt).toBeGreaterThan(date.getTime());
  });
});

describe("getLocalDateFromOperatingDate", () => {
  it("parses a well-formed operating date to local midnight", () => {
    expect(getLocalDateFromOperatingDate("2026-05-14")).toEqual(
      new Date(2026, 4, 14),
    );
  });

  it("rejects malformed input", () => {
    expect(getLocalDateFromOperatingDate("2026-5-14")).toBeUndefined();
    expect(getLocalDateFromOperatingDate("14-05-2026")).toBeUndefined();
    expect(getLocalDateFromOperatingDate("not-a-date")).toBeUndefined();
    expect(getLocalDateFromOperatingDate("")).toBeUndefined();
  });

  it("rejects well-formed dates that do not exist", () => {
    expect(getLocalDateFromOperatingDate("2026-02-30")).toBeUndefined();
    expect(getLocalDateFromOperatingDate("2026-13-01")).toBeUndefined();
  });
});

describe("setOperatingClockOverride", () => {
  it("pins what the helpers treat as today", () => {
    setOperatingClockOverride(new Date(2026, 4, 14, 9, 0));

    expect(getLocalOperatingDate()).toBe("2026-05-14");
    expect(getLocalOperatingDateRange().operatingDate).toBe("2026-05-14");
    expect(getLocalOperatingDateRangeFromSearch().operatingDate).toBe("2026-05-14");
  });

  it("restores the real clock when cleared", () => {
    setOperatingClockOverride(new Date(2026, 4, 14));
    setOperatingClockOverride(null);

    expect(getLocalOperatingDate()).toBe(getLocalOperatingDate(new Date()));
  });

  it("defends against later mutation of the supplied date", () => {
    const pinned = new Date(2026, 4, 14);
    setOperatingClockOverride(pinned);

    pinned.setFullYear(2030);

    expect(getLocalOperatingDate()).toBe("2026-05-14");
  });

  it("does not hand out a mutable reference to the pinned instant", () => {
    setOperatingClockOverride(new Date(2026, 4, 14));

    getOperatingClockNow().setFullYear(2030);

    expect(getLocalOperatingDate()).toBe("2026-05-14");
  });
});

describe("getLocalOperatingDateRangeFromSearch", () => {
  it("uses the supplied operating date when parseable", () => {
    expect(getLocalOperatingDateRangeFromSearch("2026-05-14")).toEqual(
      getLocalOperatingDateRange(new Date(2026, 4, 14)),
    );
  });

  it("falls back to the current day for absent or unusable values", () => {
    const today = getLocalOperatingDate();

    expect(getLocalOperatingDateRangeFromSearch().operatingDate).toBe(today);
    expect(getLocalOperatingDateRangeFromSearch(undefined).operatingDate).toBe(today);
    expect(getLocalOperatingDateRangeFromSearch("2026-02-30").operatingDate).toBe(today);
    expect(getLocalOperatingDateRangeFromSearch(20260514).operatingDate).toBe(today);
  });
});
