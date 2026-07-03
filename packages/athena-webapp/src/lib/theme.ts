import { useEffect, useSyncExternalStore } from "react";

export const ATHENA_THEME_STORAGE_KEY = "athena-theme-mode";
export const ATHENA_DARK_THEME_VARIANT_STORAGE_KEY =
  "athena-dark-theme-variant";

export type AthenaThemeMode = "system" | "light" | "dark";
export type AthenaResolvedTheme = "light" | "dark";
export type AthenaDarkThemeVariant = "charcoal" | "classic";

type ThemeViewTransition = {
  finished?: Promise<void>;
};

type ThemeTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ThemeViewTransition;
};

const THEME_MODES = new Set<AthenaThemeMode>(["system", "light", "dark"]);
const DARK_THEME_VARIANTS = new Set<AthenaDarkThemeVariant>([
  "charcoal",
  "classic",
]);
const THEME_CHANGE_EVENT = "athena-theme-change";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";
const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";
const DEFAULT_DARK_THEME_VARIANT: AthenaDarkThemeVariant = "charcoal";

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

function resolveTheme(mode: AthenaThemeMode): AthenaResolvedTheme {
  return mode === "system" ? getSystemTheme() : mode;
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

export function initializeAthenaTheme() {
  applyTheme(getStoredThemeMode());

  if (typeof window === "undefined") {
    return;
  }

  const mediaQuery = window.matchMedia?.(DARK_MEDIA_QUERY);
  if (!mediaQuery) {
    return;
  }

  const handleSystemThemeChange = () => {
    if (getStoredThemeMode() === "system") {
      applyTheme("system");
      emitThemeChange();
    }
  };

  mediaQuery.addEventListener?.("change", handleSystemThemeChange);
  mediaQuery.addListener?.(handleSystemThemeChange);
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

  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);

  const mediaQuery = window.matchMedia?.(DARK_MEDIA_QUERY);
  const handleSystemThemeChange = () => {
    if (getStoredThemeMode() === "system") {
      applyTheme("system");
      onStoreChange();
    }
  };

  mediaQuery?.addEventListener?.("change", handleSystemThemeChange);
  mediaQuery?.addListener?.(handleSystemThemeChange);

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
    mediaQuery?.removeEventListener?.("change", handleSystemThemeChange);
    mediaQuery?.removeListener?.(handleSystemThemeChange);
  };
}

function getThemeSnapshot() {
  const mode = getStoredThemeMode();
  const resolvedTheme = resolveTheme(mode);
  const darkThemeVariant = getStoredDarkThemeVariant();
  const systemTheme = getSystemTheme();

  return `${mode}:${resolvedTheme}:${darkThemeVariant}:${systemTheme}`;
}

export function useAthenaTheme() {
  const snapshot = useSyncExternalStore(
    subscribeToThemeStore,
    getThemeSnapshot,
    getThemeSnapshot,
  );
  const [mode, resolvedTheme, darkThemeVariant, systemTheme] = snapshot.split(
    ":",
  ) as [
    AthenaThemeMode,
    AthenaResolvedTheme,
    AthenaDarkThemeVariant,
    AthenaResolvedTheme,
  ];

  useEffect(() => {
    applyTheme(mode);
  }, [mode, darkThemeVariant]);

  return {
    mode,
    resolvedTheme,
    darkThemeVariant,
    systemTheme,
    setThemeMode: setAthenaThemeMode,
    setDarkThemeVariant: setAthenaDarkThemeVariant,
  };
}
