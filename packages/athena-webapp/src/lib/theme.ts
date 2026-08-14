import { useEffect, useSyncExternalStore } from "react";

export const ATHENA_THEME_STORAGE_KEY = "athena-theme-mode";
export const ATHENA_DARK_THEME_VARIANT_STORAGE_KEY =
  "athena-dark-theme-variant";
export const ATHENA_SUN_CYCLE_LOCATION_STORAGE_KEY =
  "athena-sun-cycle-location";

export type AthenaThemeMode = "system" | "light" | "dark" | "sun-cycle";
export type AthenaResolvedTheme = "light" | "dark";
export type AthenaDarkThemeVariant = "charcoal" | "classic";

export type SunCycleLocation = {
  latitude: number;
  longitude: number;
};

export type SunCycleThemeState = {
  resolvedTheme: AthenaResolvedTheme;
  nextResolvedTheme: AthenaResolvedTheme;
  nextTransitionAt: number;
};

export type SunCycleRequestResult =
  | { ok: true }
  | {
      ok: false;
      reason: "cancelled" | "permission-denied" | "unavailable";
    };

type ThemeViewTransition = {
  finished?: Promise<void>;
};

type ThemeTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ThemeViewTransition;
};

const THEME_MODES = new Set<AthenaThemeMode>([
  "system",
  "light",
  "dark",
  "sun-cycle",
]);
const DARK_THEME_VARIANTS = new Set<AthenaDarkThemeVariant>([
  "charcoal",
  "classic",
]);
const THEME_CHANGE_EVENT = "athena-theme-change";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";
const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";
const DEFAULT_DARK_THEME_VARIANT: AthenaDarkThemeVariant = "charcoal";
const SUNRISE_SUNSET_ZENITH_DEGREES = 90.833;
const SUN_CYCLE_LOCATION_PRECISION = 100;
const SUN_CYCLE_LOCATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let sunCycleTransitionTimer: ReturnType<typeof setTimeout> | undefined;
let hasInstalledSunCycleLifecycleListeners = false;

function isThemeMode(value: string | null): value is AthenaThemeMode {
  return Boolean(value && THEME_MODES.has(value as AthenaThemeMode));
}

function isDarkThemeVariant(
  value: string | null,
): value is AthenaDarkThemeVariant {
  return Boolean(
    value && DARK_THEME_VARIANTS.has(value as AthenaDarkThemeVariant),
  );
}

function getStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getStoredThemeMode(): AthenaThemeMode {
  const storage = getStorage();
  const storedValue = storage?.getItem(ATHENA_THEME_STORAGE_KEY) ?? null;

  return isThemeMode(storedValue) ? storedValue : "system";
}

function getStoredDarkThemeVariant(): AthenaDarkThemeVariant {
  const storage = getStorage();
  const storedValue =
    storage?.getItem(ATHENA_DARK_THEME_VARIANT_STORAGE_KEY) ?? null;

  return isDarkThemeVariant(storedValue)
    ? storedValue
    : DEFAULT_DARK_THEME_VARIANT;
}

function isSunCycleLocation(value: unknown): value is SunCycleLocation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SunCycleLocation>;
  return (
    typeof candidate.latitude === "number" &&
    Number.isFinite(candidate.latitude) &&
    candidate.latitude >= -90 &&
    candidate.latitude <= 90 &&
    typeof candidate.longitude === "number" &&
    Number.isFinite(candidate.longitude) &&
    candidate.longitude >= -180 &&
    candidate.longitude <= 180
  );
}

function getStoredSunCycleLocation(): SunCycleLocation | null {
  const storedValue = getStorage()?.getItem(
    ATHENA_SUN_CYCLE_LOCATION_STORAGE_KEY,
  );
  if (!storedValue) {
    return null;
  }

  try {
    const parsedValue: unknown = JSON.parse(storedValue);
    return isSunCycleLocation(parsedValue) ? parsedValue : null;
  } catch {
    return null;
  }
}

function getSystemTheme(): AthenaResolvedTheme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.(DARK_MEDIA_QUERY).matches
  ) {
    return "dark";
  }

  return "light";
}

function prefersReducedMotion() {
  return Boolean(
    typeof window !== "undefined" &&
    window.matchMedia?.(REDUCED_MOTION_MEDIA_QUERY).matches,
  );
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function dayOfYear(year: number, month: number, day: number) {
  const startOfYear = Date.UTC(year, 0, 0);
  const currentDay = Date.UTC(year, month, day);
  return Math.floor((currentDay - startOfYear) / 86_400_000);
}

function solarEventAt(
  year: number,
  month: number,
  day: number,
  location: SunCycleLocation,
  event: "sunrise" | "sunset",
) {
  const longitudeHour = location.longitude / 15;
  const approximateTime =
    dayOfYear(year, month, day) +
    ((event === "sunrise" ? 6 : 18) - longitudeHour) / 24;
  const meanAnomaly = 0.9856 * approximateTime - 3.289;
  const trueLongitude = normalizeDegrees(
    meanAnomaly +
      1.916 * Math.sin(degreesToRadians(meanAnomaly)) +
      0.02 * Math.sin(degreesToRadians(2 * meanAnomaly)) +
      282.634,
  );
  let rightAscension = normalizeDegrees(
    radiansToDegrees(
      Math.atan(0.91764 * Math.tan(degreesToRadians(trueLongitude))),
    ),
  );
  const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
  const rightAscensionQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension =
    (rightAscension + longitudeQuadrant - rightAscensionQuadrant) / 15;

  const sinDeclination = 0.39782 * Math.sin(degreesToRadians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHourAngle =
    (Math.cos(degreesToRadians(SUNRISE_SUNSET_ZENITH_DEGREES)) -
      sinDeclination * Math.sin(degreesToRadians(location.latitude))) /
    (cosDeclination * Math.cos(degreesToRadians(location.latitude)));

  if (cosHourAngle < -1 || cosHourAngle > 1) {
    return null;
  }

  const hourAngleDegrees =
    event === "sunrise"
      ? 360 - radiansToDegrees(Math.acos(cosHourAngle))
      : radiansToDegrees(Math.acos(cosHourAngle));
  const hourAngle = hourAngleDegrees / 15;
  const localMeanTime =
    hourAngle + rightAscension - 0.06571 * approximateTime - 6.622;
  const utcHour = normalizeDegrees((localMeanTime - longitudeHour) * 15) / 15;
  return Date.UTC(year, month, day) + utcHour * 60 * 60 * 1000;
}

function utcCalendarDate(date: Date, dayOffset: number) {
  const utcNoon = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + dayOffset,
      12,
    ),
  );
  return {
    year: utcNoon.getUTCFullYear(),
    month: utcNoon.getUTCMonth(),
    day: utcNoon.getUTCDate(),
  };
}

export function getSunCycleThemeState(
  now: Date,
  location: SunCycleLocation,
): SunCycleThemeState | null {
  const transitions = Array.from(
    { length: 741 },
    (_, index) => index - 370,
  )
    .flatMap((dayOffset) => {
      const date = utcCalendarDate(now, dayOffset);
      return (["sunrise", "sunset"] as const).flatMap((event) => {
        const at = solarEventAt(
          date.year,
          date.month,
          date.day,
          location,
          event,
        );
        return at === null ? [] : [{ at, event }];
      });
    })
    .sort((left, right) => left.at - right.at);

  if (transitions.length === 0) {
    return null;
  }

  const nowTimestamp = now.getTime();
  const daylightIntervals = transitions.flatMap((transition, index) => {
    if (transition.event !== "sunrise") {
      return [];
    }
    const sunset = transitions
      .slice(index + 1)
      .find((candidate) => candidate.event === "sunset");
    return sunset ? [{ sunrise: transition.at, sunset: sunset.at }] : [];
  });
  const activeDaylight = daylightIntervals.find(
    ({ sunrise, sunset }) => sunrise <= nowTimestamp && nowTimestamp < sunset,
  );
  if (activeDaylight) {
    return {
      resolvedTheme: "light",
      nextResolvedTheme: "dark",
      nextTransitionAt: activeDaylight.sunset,
    };
  }

  const nextDaylight = daylightIntervals.find(
    ({ sunrise }) => sunrise > nowTimestamp,
  );
  if (!nextDaylight) {
    return null;
  }

  return {
    resolvedTheme: "dark",
    nextResolvedTheme: "light",
    nextTransitionAt: nextDaylight.sunrise,
  };
}

function getStoredSunCycleThemeState(now = new Date()) {
  const location = getStoredSunCycleLocation();
  return location ? getSunCycleThemeState(now, location) : null;
}

function resolveTheme(mode: AthenaThemeMode): AthenaResolvedTheme {
  if (mode === "system") {
    return getSystemTheme();
  }
  if (mode === "sun-cycle") {
    return getStoredSunCycleThemeState()?.resolvedTheme ?? getSystemTheme();
  }
  return mode;
}

function applyTheme(
  mode: AthenaThemeMode,
  darkThemeVariant = getStoredDarkThemeVariant(),
) {
  if (typeof document === "undefined") {
    return;
  }

  const resolvedTheme = resolveTheme(mode);
  const root = document.documentElement;

  root.classList.toggle("dark", resolvedTheme === "dark");
  root.dataset.theme = resolvedTheme;
  root.dataset.themeMode = mode;
  if (resolvedTheme === "dark") {
    root.dataset.themeVariant = darkThemeVariant;
  } else {
    delete root.dataset.themeVariant;
  }
  root.style.colorScheme = resolvedTheme;
}

function emitThemeChange() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function scheduleSunCycleTransition() {
  if (sunCycleTransitionTimer) {
    clearTimeout(sunCycleTransitionTimer);
    sunCycleTransitionTimer = undefined;
  }

  if (getStoredThemeMode() !== "sun-cycle") {
    return;
  }

  const state = getStoredSunCycleThemeState();
  if (!state) {
    return;
  }

  const delay = Math.min(
    Math.max(state.nextTransitionAt - Date.now() + 50, 0),
    2_147_483_647,
  );
  sunCycleTransitionTimer = setTimeout(() => {
    applyTheme("sun-cycle");
    emitThemeChange();
    scheduleSunCycleTransition();
  }, delay);
}

function refreshSunCycleTheme() {
  if (getStoredThemeMode() !== "sun-cycle") {
    return;
  }
  applyTheme("sun-cycle");
  emitThemeChange();
  scheduleSunCycleTransition();
}

export function initializeAthenaTheme() {
  applyTheme(getStoredThemeMode());
  scheduleSunCycleTransition();

  if (typeof window === "undefined") {
    return;
  }

  const mediaQuery = window.matchMedia?.(DARK_MEDIA_QUERY);
  if (!mediaQuery) {
    return;
  }

  const handleSystemThemeChange = () => {
    const mode = getStoredThemeMode();
    if (
      mode === "system" ||
      (mode === "sun-cycle" && !getStoredSunCycleThemeState())
    ) {
      applyTheme(mode);
      emitThemeChange();
    }
  };

  mediaQuery.addEventListener?.("change", handleSystemThemeChange);
  mediaQuery.addListener?.(handleSystemThemeChange);

  if (!hasInstalledSunCycleLifecycleListeners) {
    window.addEventListener("focus", refreshSunCycleTheme);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        refreshSunCycleTheme();
      }
    });
    hasInstalledSunCycleLifecycleListeners = true;
  }
}

export function setAthenaThemeMode(mode: AthenaThemeMode) {
  const storage = getStorage();

  if (mode === "system") {
    storage?.removeItem(ATHENA_THEME_STORAGE_KEY);
  } else {
    storage?.setItem(ATHENA_THEME_STORAGE_KEY, mode);
  }

  applyTheme(mode);
  emitThemeChange();
  scheduleSunCycleTransition();
}

function roundedCoordinate(value: number) {
  const rounded =
    Math.round(value * SUN_CYCLE_LOCATION_PRECISION) /
    SUN_CYCLE_LOCATION_PRECISION;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export async function requestAthenaSunCycleMode(
  signal?: AbortSignal,
): Promise<SunCycleRequestResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { ok: false, reason: "unavailable" };
  }

  const result = await new Promise<
    | { ok: true; location: SunCycleLocation }
    | { ok: false; reason: "permission-denied" | "unavailable" }
  >((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const location = {
          latitude: roundedCoordinate(coords.latitude),
          longitude: roundedCoordinate(coords.longitude),
        };
        resolve(
          isSunCycleLocation(location)
            ? { ok: true, location }
            : { ok: false, reason: "unavailable" },
        );
      },
      (error) =>
        resolve({
          ok: false,
          reason: error.code === 1 ? "permission-denied" : "unavailable",
        }),
      {
        enableHighAccuracy: false,
        maximumAge: SUN_CYCLE_LOCATION_MAX_AGE_MS,
        timeout: 10_000,
      },
    );
  });

  if (!result.ok) {
    return result;
  }
  if (signal?.aborted) {
    return { ok: false, reason: "cancelled" };
  }
  if (!getSunCycleThemeState(new Date(), result.location)) {
    return { ok: false, reason: "unavailable" };
  }

  const storage = getStorage();
  if (!storage) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    storage.setItem(
      ATHENA_SUN_CYCLE_LOCATION_STORAGE_KEY,
      JSON.stringify(result.location),
    );
    setAthenaThemeModeWithTransition("sun-cycle");
  } catch {
    try {
      storage.removeItem(ATHENA_SUN_CYCLE_LOCATION_STORAGE_KEY);
    } catch {
      // Storage can remain unavailable; the prior appearance is still active.
    }
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true };
}

export function setAthenaDarkThemeVariant(variant: AthenaDarkThemeVariant) {
  const storage = getStorage();

  storage?.setItem(ATHENA_DARK_THEME_VARIANT_STORAGE_KEY, variant);
  applyTheme(getStoredThemeMode(), variant);
  emitThemeChange();
}

export function setAthenaThemeModeWithTransition(mode: AthenaThemeMode) {
  if (typeof document === "undefined" || prefersReducedMotion()) {
    setAthenaThemeMode(mode);
    return;
  }

  const transitionDocument = document as ThemeTransitionDocument;

  if (!transitionDocument.startViewTransition) {
    setAthenaThemeMode(mode);
    return;
  }

  const transition = transitionDocument.startViewTransition(() =>
    setAthenaThemeMode(mode),
  );
  void transition.finished?.catch(() => {});
}

function subscribeToThemeStore(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorageChange = () => {
    applyTheme(getStoredThemeMode());
    scheduleSunCycleTransition();
    onStoreChange();
  };

  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", handleStorageChange);

  const mediaQuery = window.matchMedia?.(DARK_MEDIA_QUERY);
  const handleSystemThemeChange = () => {
    const mode = getStoredThemeMode();
    if (
      mode === "system" ||
      (mode === "sun-cycle" && !getStoredSunCycleThemeState())
    ) {
      applyTheme(mode);
      onStoreChange();
    }
  };

  mediaQuery?.addEventListener?.("change", handleSystemThemeChange);
  mediaQuery?.addListener?.(handleSystemThemeChange);

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", handleStorageChange);
    mediaQuery?.removeEventListener?.("change", handleSystemThemeChange);
    mediaQuery?.removeListener?.(handleSystemThemeChange);
  };
}

function getThemeSnapshot() {
  const mode = getStoredThemeMode();
  const resolvedTheme = resolveTheme(mode);
  const darkThemeVariant = getStoredDarkThemeVariant();
  const systemTheme = getSystemTheme();
  const sunCycle = mode === "sun-cycle" ? getStoredSunCycleThemeState() : null;

  return `${mode}:${resolvedTheme}:${darkThemeVariant}:${systemTheme}:${sunCycle?.nextResolvedTheme ?? ""}:${sunCycle?.nextTransitionAt ?? ""}`;
}

export function useAthenaTheme() {
  const snapshot = useSyncExternalStore(
    subscribeToThemeStore,
    getThemeSnapshot,
    getThemeSnapshot,
  );
  const [
    mode,
    resolvedTheme,
    darkThemeVariant,
    systemTheme,
    nextResolvedTheme,
    nextTransitionAt,
  ] = snapshot.split(":") as [
    AthenaThemeMode,
    AthenaResolvedTheme,
    AthenaDarkThemeVariant,
    AthenaResolvedTheme,
    AthenaResolvedTheme | "",
    string,
  ];

  useEffect(() => {
    applyTheme(mode);
  }, [mode, darkThemeVariant]);

  return {
    mode,
    resolvedTheme,
    darkThemeVariant,
    systemTheme,
    sunCycle:
      mode === "sun-cycle" && nextResolvedTheme && nextTransitionAt
        ? {
            nextResolvedTheme,
            nextTransitionAt: Number(nextTransitionAt),
          }
        : null,
    setThemeMode: setAthenaThemeMode,
    setDarkThemeVariant: setAthenaDarkThemeVariant,
  };
}
