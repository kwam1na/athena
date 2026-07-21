import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { emitLandingFunnelEvent } from "@/lib/marketing/landingFunnelClient";
import { setAthenaThemeModeWithTransition, useAthenaTheme } from "@/lib/theme";

import {
  DEMO_PATH,
  LOGIN_PATH,
  PUBLIC_HOME_PATH,
  WALKTHROUGH_PATH,
} from "@/lib/navigation/appEntryRoutes";

// A light/dark switch for public pages that support both themes. Flips the
// resolved theme (with a view transition) and persists it, matching the app's
// own theme control.
function ThemeToggle() {
  const { resolvedTheme } = useAthenaTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() =>
        setAthenaThemeModeWithTransition(isDark ? "light" : "dark")
      }
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition-colors duration-standard ease-standard hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {isDark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}

export function PublicLayout({
  children,
  trackFunnelCtas = false,
  hideSecondaryNav = false,
  showThemeToggle = false,
}: {
  children: ReactNode;
  // The marketing landing page presents the demo as its sole CTA and hides the
  // secondary nav; other public pages keep the walkthrough and sign-in links.
  hideSecondaryNav?: boolean;
  // Renders a light/dark toggle in the nav for pages staged in both themes.
  showThemeToggle?: boolean;
  trackFunnelCtas?: boolean;
}) {
  // Sticky nav: solid at the top, translucent (blurred) once the reader
  // scrolls, so the page's content and paper grain read faintly through it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header
        className={`sticky top-0 z-40 border-b border-border/70 transition-colors duration-standard ease-standard ${
          scrolled
            ? "bg-background/70 backdrop-blur-md supports-[backdrop-filter]:bg-background/60"
            : "bg-background"
        }`}
      >
        <nav
          aria-label="Primary navigation"
          className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-layout-2xs px-layout-sm sm:gap-layout-md sm:px-layout-xl"
        >
          <Link
            to={PUBLIC_HOME_PATH}
            className="font-display text-base font-light tracking-[0.18em] text-foreground transition-colors duration-standard ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            athena
          </Link>

          <div className="flex items-center gap-layout-2xs sm:gap-layout-sm">
            {showThemeToggle ? <ThemeToggle /> : null}
            {hideSecondaryNav ? null : (
              <>
                <Link
                  to={WALKTHROUGH_PATH}
                  onClick={
                    trackFunnelCtas
                      ? () => emitLandingFunnelEvent("walkthrough_cta")
                      : undefined
                  }
                  className="hidden min-h-11 items-center justify-center whitespace-nowrap rounded-md px-layout-2xs text-sm font-medium text-muted-foreground transition-colors duration-standard ease-standard hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:inline-flex sm:px-layout-sm"
                >
                  Request a walkthrough
                </Link>
                <Link
                  to={LOGIN_PATH}
                  className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-md px-layout-2xs text-sm font-medium text-muted-foreground transition-colors duration-standard ease-standard hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-layout-sm"
                >
                  Sign in
                </Link>
              </>
            )}
            <Link
              to={DEMO_PATH}
              target="_blank"
              rel="noopener noreferrer"
              onClick={
                trackFunnelCtas
                  ? () => emitLandingFunnelEvent("demo_cta")
                  : undefined
              }
              className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-md bg-primary px-layout-sm text-sm font-medium text-primary-foreground transition-colors duration-standard ease-standard hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-layout-md"
            >
              Try the demo
            </Link>
          </div>
        </nav>
      </header>

      {children}
    </div>
  );
}
