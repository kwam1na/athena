import { useEffect, useSyncExternalStore } from "react";

export const ATHENA_THEME_STORAGE_KEY = "athena-theme-mode";

export type AthenaThemeMode = "system" | "light" | "dark";
export type AthenaResolvedTheme = "light" | "dark";

const THEME_MODES = new Set<AthenaThemeMode>(["system", "light", "dark"]);
const THEME_CHANGE_EVENT = "athena-theme-change";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

function isThemeMode(value: string | null): value is AthenaThemeMode {
  return Boolean(value && THEME_MODES.has(value as AthenaThemeMode));
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

function getSystemTheme(): AthenaResolvedTheme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.(DARK_MEDIA_QUERY).matches
  ) {
    return "dark";
  }

  return "light";
}

function resolveTheme(mode: AthenaThemeMode): AthenaResolvedTheme {
  return mode === "system" ? getSystemTheme() : mode;
}

function applyTheme(mode: AthenaThemeMode) {
  if (typeof document === "undefined") {
    return;
  }

  const resolvedTheme = resolveTheme(mode);
  const root = document.documentElement;

  root.classList.toggle("dark", resolvedTheme === "dark");
  root.dataset.theme = resolvedTheme;
  root.dataset.themeMode = mode;
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

  return `${mode}:${resolvedTheme}`;
}

export function useAthenaTheme() {
  const snapshot = useSyncExternalStore(
    subscribeToThemeStore,
    getThemeSnapshot,
    getThemeSnapshot,
  );
  const [mode, resolvedTheme] = snapshot.split(":") as [
    AthenaThemeMode,
    AthenaResolvedTheme,
  ];

  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  return {
    mode,
    resolvedTheme,
    setThemeMode: setAthenaThemeMode,
  };
}
