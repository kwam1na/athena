import { useEffect } from "react";

import { useAthenaTheme } from "@/lib/theme";

// The landing supports both light and dark, but its near-pixel scenes and the
// captured product shots are all staged in the *charcoal* dark variant. So
// while the landing is mounted we honor the visitor's light/dark preference
// while pinning the dark variant to charcoal — then restore whatever variant
// they had on unmount. Returns the resolved theme (for swapping shot assets)
// and the mode setter (for the in-page toggle).
export function useLandingTheme() {
  const { resolvedTheme, setThemeMode } = useAthenaTheme();

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const previousVariant = root.dataset.themeVariant;

    // Force charcoal whenever the root is dark, and keep it forced if the
    // theme system re-applies a different variant while we're mounted.
    const pin = () => {
      if (
        root.classList.contains("dark") &&
        root.dataset.themeVariant !== "charcoal"
      ) {
        root.dataset.themeVariant = "charcoal";
      }
    };
    pin();
    const observer = new MutationObserver(pin);
    observer.observe(root, {
      attributeFilter: ["class", "data-theme-variant"],
      attributes: true,
    });

    return () => {
      observer.disconnect();
      if (previousVariant) {
        root.dataset.themeVariant = previousVariant;
      } else if (root.classList.contains("dark")) {
        delete root.dataset.themeVariant;
      }
    };
  }, []);

  return { resolvedTheme, setThemeMode };
}
