import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ATHENA_DARK_THEME_VARIANT_STORAGE_KEY,
  ATHENA_SUN_CYCLE_LOCATION_STORAGE_KEY,
  ATHENA_THEME_STORAGE_KEY,
  getSunCycleThemeState,
  initializeAthenaTheme,
  requestAthenaSunCycleMode,
  setAthenaDarkThemeVariant,
  setAthenaThemeMode,
  setAthenaThemeModeWithTransition,
} from "./theme";

function installMatchMedia(
  matches: boolean,
  options?: { reducedMotion?: boolean },
) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const darkMediaQuery = {
    matches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn((_event: string, listener: EventListener) => {
      listeners.add(listener as (event: MediaQueryListEvent) => void);
    }),
    removeEventListener: vi.fn((_event: string, listener: EventListener) => {
      listeners.delete(listener as (event: MediaQueryListEvent) => void);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } satisfies MediaQueryList;
  const reducedMotionMediaQuery = {
    ...darkMediaQuery,
    matches: options?.reducedMotion ?? false,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  } satisfies MediaQueryList;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) =>
      query === "(prefers-reduced-motion: reduce)"
        ? reducedMotionMediaQuery
        : darkMediaQuery,
    ),
  });

  return {
    mediaQuery: darkMediaQuery,
    setMatches(nextMatches: boolean) {
      darkMediaQuery.matches = nextMatches;
      listeners.forEach((listener) =>
        listener({ matches: nextMatches } as MediaQueryListEvent),
      );
    },
  };
}

describe("Athena theme runtime", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-mode");
    document.documentElement.removeAttribute("data-theme-variant");
    document.documentElement.style.colorScheme = "";
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: undefined,
    });
  });

  it("defaults to the system theme without storing an override", () => {
    installMatchMedia(true);

    initializeAthenaTheme();

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeMode).toBe("system");
    expect(document.documentElement.dataset.themeVariant).toBe("charcoal");
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    expect(window.localStorage.removeItem).not.toHaveBeenCalled();
  });

  it("persists an explicit light override over a dark system preference", () => {
    installMatchMedia(true);

    initializeAthenaTheme();
    setAthenaThemeMode("light");

    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(document.documentElement.dataset.themeVariant).toBeUndefined();
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      ATHENA_THEME_STORAGE_KEY,
      "light",
    );
  });

  it("persists the selected dark palette while the resolved theme is dark", () => {
    installMatchMedia(true);

    initializeAthenaTheme();
    setAthenaDarkThemeVariant("classic");

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.dataset.themeVariant).toBe("classic");
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      ATHENA_DARK_THEME_VARIANT_STORAGE_KEY,
      "classic",
    );
  });

  it("keeps the selected dark palette ready while light mode is active", () => {
    installMatchMedia(false);

    initializeAthenaTheme();
    setAthenaThemeMode("light");
    setAthenaDarkThemeVariant("classic");

    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.dataset.themeVariant).toBeUndefined();

    vi.spyOn(window.localStorage, "getItem").mockImplementation((key) =>
      key === ATHENA_DARK_THEME_VARIANT_STORAGE_KEY ? "classic" : null,
    );

    setAthenaThemeMode("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.dataset.themeVariant).toBe("classic");
  });

  it("returns to system tracking when the override is cleared", () => {
    const systemTheme = installMatchMedia(false);

    setAthenaThemeMode("dark");
    expect(document.documentElement).toHaveClass("dark");

    setAthenaThemeMode("system");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(
      ATHENA_THEME_STORAGE_KEY,
    );

    initializeAthenaTheme();
    systemTheme.setMatches(true);
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.dataset.themeMode).toBe("system");
  });

  it("uses a view transition when explicitly toggling themes with motion allowed", () => {
    installMatchMedia(false);
    const startViewTransition = vi.fn(function (
      this: Document,
      callback: () => void,
    ) {
      expect(this).toBe(document);
      callback();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    setAthenaThemeModeWithTransition("dark");

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      ATHENA_THEME_STORAGE_KEY,
      "dark",
    );
  });

  it("skips view transitions when reduced motion is requested", () => {
    installMatchMedia(false, { reducedMotion: true });
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    setAthenaThemeModeWithTransition("dark");

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(document.documentElement).toHaveClass("dark");
  });

  it("resolves daylight and the next sunset from a coarse device location", () => {
    const state = getSunCycleThemeState(new Date("2026-08-13T12:00:00.000Z"), {
      latitude: 0,
      longitude: 0,
    });

    expect(state?.resolvedTheme).toBe("light");
    expect(state?.nextResolvedTheme).toBe("dark");
    expect(state?.nextTransitionAt).toBeGreaterThan(
      new Date("2026-08-13T17:00:00.000Z").getTime(),
    );
    expect(state?.nextTransitionAt).toBeLessThan(
      new Date("2026-08-13T20:00:00.000Z").getTime(),
    );
  });

  it("resolves darkness after sunset and points to the next sunrise", () => {
    const state = getSunCycleThemeState(new Date("2026-08-13T23:00:00.000Z"), {
      latitude: 0,
      longitude: 0,
    });

    expect(state?.resolvedTheme).toBe("dark");
    expect(state?.nextResolvedTheme).toBe("light");
    expect(state?.nextTransitionAt).toBeGreaterThan(
      new Date("2026-08-14T05:00:00.000Z").getTime(),
    );
    expect(state?.nextTransitionAt).toBeLessThan(
      new Date("2026-08-14T08:00:00.000Z").getTime(),
    );
  });

  it("uses the granted location even when the browser calendar day differs", () => {
    const state = getSunCycleThemeState(new Date("2026-08-14T03:00:00.000Z"), {
      latitude: 35.68,
      longitude: 139.69,
    });

    expect(state?.resolvedTheme).toBe("light");
    expect(state?.nextResolvedTheme).toBe("dark");
    expect(state?.nextTransitionAt).toBeGreaterThan(
      new Date("2026-08-14T08:00:00.000Z").getTime(),
    );
    expect(state?.nextTransitionAt).toBeLessThan(
      new Date("2026-08-14T11:00:00.000Z").getTime(),
    );
  });

  it("recalculates the appearance when focus resumes after a solar transition", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-08-13T12:00:00.000Z");
      vi.setSystemTime(now);
      installMatchMedia(false);
      window.localStorage.setItem(
        ATHENA_SUN_CYCLE_LOCATION_STORAGE_KEY,
        JSON.stringify({ latitude: 0, longitude: 0 }),
      );
      vi.mocked(window.localStorage.getItem).mockImplementation((key) => {
        if (key === ATHENA_THEME_STORAGE_KEY) return "sun-cycle";
        if (key === ATHENA_SUN_CYCLE_LOCATION_STORAGE_KEY) {
          return JSON.stringify({ latitude: 0, longitude: 0 });
        }
        return null;
      });

      initializeAthenaTheme();
      const state = getSunCycleThemeState(now, {
        latitude: 0,
        longitude: 0,
      });

      expect(document.documentElement.dataset.theme).toBe("light");
      expect(state).not.toBeNull();
      vi.setSystemTime(state!.nextTransitionAt + 100);
      window.dispatchEvent(new Event("focus"));
      expect(document.documentElement.dataset.theme).toBe("dark");
    } finally {
      vi.useRealTimers();
    }
  });

  it("requests location at selection time and stores only coarse coordinates", async () => {
    installMatchMedia(false);
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 5.603717, longitude: -0.186964 },
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });

    const result = await requestAthenaSunCycleMode();

    expect(result).toEqual({ ok: true });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      ATHENA_SUN_CYCLE_LOCATION_STORAGE_KEY,
      JSON.stringify({ latitude: 5.6, longitude: -0.19 }),
    );
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      ATHENA_THEME_STORAGE_KEY,
      "sun-cycle",
    );
  });

  it("keeps the current appearance when location access is denied", async () => {
    installMatchMedia(false);
    setAthenaThemeMode("dark");
    vi.mocked(window.localStorage.setItem).mockClear();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn(
          (_success: PositionCallback, error: PositionErrorCallback) =>
            error({ code: 1 } as GeolocationPositionError),
        ),
      },
    });

    const result = await requestAthenaSunCycleMode();

    expect(result).toEqual({ ok: false, reason: "permission-denied" });
    expect(window.localStorage.setItem).not.toHaveBeenCalledWith(
      ATHENA_THEME_STORAGE_KEY,
      "sun-cycle",
    );
    expect(document.documentElement).toHaveClass("dark");
  });

  it("keeps the current appearance when local storage is unavailable", async () => {
    installMatchMedia(false);
    setAthenaThemeMode("light");
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) =>
          success({
            coords: { latitude: 5.6, longitude: -0.19 },
          } as GeolocationPosition),
      },
    });
    vi.mocked(window.localStorage.setItem).mockImplementationOnce(() => {
      throw new DOMException("Storage unavailable", "QuotaExceededError");
    });

    await expect(requestAthenaSunCycleMode()).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(document.documentElement.dataset.themeMode).toBe("light");
  });
});
