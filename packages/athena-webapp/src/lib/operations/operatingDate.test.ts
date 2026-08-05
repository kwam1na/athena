import { afterEach, describe, expect, it } from "vitest";

import {
  getLocalDateFromOperatingDate,
  getLocalOperatingDate,
  getLocalOperatingDateRange,
  getLocalOperatingDateRangeFromSearch,
  getOperatingClockNow,
  getOperatingTimezone,
  setOperatingClockOverride,
  setOperatingTimezoneOverride,
} from "./operatingDate";

afterEach(() => {
  setOperatingClockOverride(null);
  setOperatingTimezoneOverride(null);
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

describe("setOperatingTimezoneOverride", () => {
  // 2026-08-04T23:30Z lands on a different calendar day either side of the
  // date line, so each zone below resolves a genuinely different operating day
  // from the same instant.
  const instant = new Date(Date.UTC(2026, 7, 4, 23, 30));

  it("resolves the operating day in the store's zone, not the browser's", () => {
    setOperatingTimezoneOverride("Africa/Accra");
    expect(getLocalOperatingDate(instant)).toBe("2026-08-04");

    setOperatingTimezoneOverride("Pacific/Kiritimati");
    expect(getLocalOperatingDate(instant)).toBe("2026-08-05");

    setOperatingTimezoneOverride("Pacific/Honolulu");
    expect(getLocalOperatingDate(instant)).toBe("2026-08-04");
  });

  it("spans the store zone's midnight boundaries as epoch millis", () => {
    setOperatingTimezoneOverride("Africa/Accra");
    const range = getLocalOperatingDateRange(instant);

    expect(range.operatingDate).toBe("2026-08-04");
    expect(range.startAt).toBe(Date.UTC(2026, 7, 4));
    expect(range.endAt).toBe(Date.UTC(2026, 7, 5));
    expect(range.startAt).toBeLessThanOrEqual(instant.getTime());
    expect(range.endAt).toBeGreaterThan(instant.getTime());
  });

  it("keeps a zone whose midnight is not a UTC midnight self-consistent", () => {
    setOperatingTimezoneOverride("Pacific/Honolulu");
    const range = getLocalOperatingDateRange(instant);

    expect(range.operatingDate).toBe("2026-08-04");
    // Honolulu is UTC-10 year round, so its day starts at 10:00 UTC.
    expect(range.startAt).toBe(Date.UTC(2026, 7, 4, 10));
    expect(range.endAt).toBe(Date.UTC(2026, 7, 5, 10));
    expect(range.startAt).toBeLessThanOrEqual(instant.getTime());
    expect(range.endAt).toBeGreaterThan(instant.getTime());
  });

  it("resolves a search-supplied day in the store zone", () => {
    setOperatingTimezoneOverride("Africa/Accra");
    const range = getLocalOperatingDateRangeFromSearch("2026-08-04");

    expect(range.operatingDate).toBe("2026-08-04");
    expect(range.startAt).toBe(Date.UTC(2026, 7, 4));
    expect(range.endAt).toBe(Date.UTC(2026, 7, 5));
  });

  it("composes with a pinned clock", () => {
    setOperatingClockOverride(instant);
    setOperatingTimezoneOverride("Pacific/Kiritimati");

    expect(getLocalOperatingDate()).toBe("2026-08-05");
    expect(getLocalOperatingDateRange().operatingDate).toBe("2026-08-05");
  });

  it("restores browser-local derivation when cleared", () => {
    setOperatingTimezoneOverride("Pacific/Kiritimati");
    setOperatingTimezoneOverride(null);

    expect(getOperatingTimezone()).toBeNull();
    expect(getLocalOperatingDate(instant)).toBe(
      new Date(instant.getTime() - instant.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 10),
    );
    expect(getLocalOperatingDateRange(instant)).toEqual({
      endAt: new Date(
        instant.getFullYear(),
        instant.getMonth(),
        instant.getDate() + 1,
      ).getTime(),
      operatingDate: getLocalOperatingDate(instant),
      startAt: new Date(
        instant.getFullYear(),
        instant.getMonth(),
        instant.getDate(),
      ).getTime(),
    });
  });

  it("ignores a zone the runtime cannot resolve", () => {
    setOperatingTimezoneOverride("Not/AZone");

    expect(getOperatingTimezone()).toBeNull();
    expect(getLocalOperatingDate(instant)).toBe(
      new Date(instant.getTime() - instant.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 10),
    );
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
