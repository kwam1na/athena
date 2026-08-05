import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getLocalOperatingDate,
  getOperatingTimezone,
  setOperatingClockOverride,
  setOperatingTimezoneOverride,
} from "@/lib/operations/operatingDate";
import {
  msUntilNextOperatingDate,
  useSharedDemoOperatingClock,
  useStoreOperatingDate,
} from "./useStoreOperatingClock";

afterEach(() => {
  setOperatingClockOverride(null);
  setOperatingTimezoneOverride(null);
  vi.useRealTimers();
});

describe("msUntilNextOperatingDate", () => {
  it("measures the gap to the store zone's next midnight", () => {
    setOperatingTimezoneOverride("Africa/Accra");
    const now = new Date(Date.UTC(2026, 7, 4, 21, 30));

    expect(msUntilNextOperatingDate(now)).toBe(2.5 * 60 * 60 * 1000);
  });

  it("measures against the browser day when no store zone is in force", () => {
    const now = new Date(2026, 7, 4, 21, 30);
    const nextMidnight = new Date(2026, 7, 5).getTime();

    expect(msUntilNextOperatingDate(now)).toBe(nextMidnight - now.getTime());
  });

  it("never schedules a non-positive delay", () => {
    setOperatingTimezoneOverride("Africa/Accra");
    // Exactly midnight: the window containing it ends a full day later, but a
    // clock that has drifted past the boundary must still make progress.
    expect(msUntilNextOperatingDate(new Date(Date.UTC(2026, 7, 5)))).toBeGreaterThan(0);
  });
});

describe("useSharedDemoOperatingClock", () => {
  it("applies the store zone before the first paint, not after an effect", () => {
    let seenDuringRender: string | null = "unset";
    renderHook(() => {
      useSharedDemoOperatingClock("Pacific/Kiritimati");
      seenDuringRender = getOperatingTimezone();
    });

    expect(seenDuringRender).toBe("Pacific/Kiritimati");
  });

  it("releases the override when the demo shell unmounts", () => {
    const { unmount } = renderHook(() =>
      useSharedDemoOperatingClock("Pacific/Kiritimati"),
    );
    unmount();

    expect(getOperatingTimezone()).toBeNull();
  });

  it("leaves a real store on browser-local derivation", () => {
    renderHook(() => useSharedDemoOperatingClock(undefined));

    expect(getOperatingTimezone()).toBeNull();
  });
});

describe("useStoreOperatingDate", () => {
  it("rolls to the next day when the store's midnight passes", () => {
    vi.useFakeTimers();
    setOperatingTimezoneOverride("Africa/Accra");
    setOperatingClockOverride(new Date(Date.UTC(2026, 7, 4, 23, 0)));

    const { result } = renderHook(() => useStoreOperatingDate());
    expect(result.current).toBe("2026-08-04");

    act(() => {
      setOperatingClockOverride(new Date(Date.UTC(2026, 7, 5, 0, 1)));
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(result.current).toBe("2026-08-05");
  });

  it("starts from the day currently in force", () => {
    setOperatingTimezoneOverride("Pacific/Kiritimati");
    setOperatingClockOverride(new Date(Date.UTC(2026, 7, 4, 23, 30)));

    const { result } = renderHook(() => useStoreOperatingDate());

    expect(result.current).toBe("2026-08-05");
    expect(result.current).toBe(getLocalOperatingDate());
  });
});
