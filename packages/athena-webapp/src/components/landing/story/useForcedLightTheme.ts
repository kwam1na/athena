import { useEffect } from "react";

// The landing page is staged in the product's light palette, and its
// near-pixel scenes must always match their canvas. While mounted, strip the
// dark theme class from the document root (and keep it stripped if the theme
// system re-applies it), then restore the visitor's theme on unmount.
export function useForcedLightTheme() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const rootElement = document.documentElement;
    const hadDark = rootElement.classList.contains("dark");
    const strip = () => rootElement.classList.remove("dark");
    strip();
    const observer = new MutationObserver(strip);
    observer.observe(rootElement, { attributeFilter: ["class"], attributes: true });
    return () => {
      observer.disconnect();
      if (hadDark) rootElement.classList.add("dark");
    };
  }, []);
}
