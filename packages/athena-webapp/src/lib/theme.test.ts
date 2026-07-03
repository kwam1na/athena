import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ATHENA_DARK_THEME_VARIANT_STORAGE_KEY,
  ATHENA_THEME_STORAGE_KEY,
  initializeAthenaTheme,
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
});
