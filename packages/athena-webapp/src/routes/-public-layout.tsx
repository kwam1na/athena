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

// A minimal footer that sits pinned beneath the page. The page content scrolls
// as one opaque layer above it (see PublicLayout), so the footer stays hidden
// until the reader reaches the very bottom and the page slides up off it — a
// quiet reveal with no scripting. FOOTER_HEIGHT must match the row height below
// so the page reserves exactly enough room to uncover it.
const FOOTER_HEIGHT = "4rem";

function PublicFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="fixed inset-x-0 bottom-0 z-0 bg-background">
      <div
        className="mx-auto flex w-full max-w-7xl items-center justify-between gap-layout-md px-layout-sm sm:px-layout-xl"
        style={{ height: FOOTER_HEIGHT }}
      >
        <p className="text-xs text-muted-foreground">© {year} Athena</p>
        <nav aria-label="Footer" className="flex items-center gap-layout-md">
          <Link
            to="/privacy"
            className="text-xs font-medium text-muted-foreground transition-colors duration-standard ease-standard hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Privacy
          </Link>
        </nav>
      </div>
    </footer>
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
  // Sticky nav: translucent (blurred) throughout so the hero mesh, page
  // content, and paper grain read faintly through it — with its underline
  // always drawn, firming up a touch once the reader scrolls off the top.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="relative min-h-svh bg-background text-foreground">
      <header
        className={`sticky top-0 z-40 border-b border-border/70 backdrop-blur-md transition-colors duration-standard ease-standard ${scrolled
            ? "bg-background/70 supports-[backdrop-filter]:bg-background/60"
            : "bg-background/40 supports-[backdrop-filter]:bg-background/25"
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
                  Register interest
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

      <PublicFooter />
      {/* The page rides above the footer as one opaque layer and reserves a
          footer-height margin below it, so the footer stays covered until the
          reader scrolls to the end and the page slides up off it. */}
      <div
        className="relative z-10 min-h-[calc(100svh-4rem)] bg-background"
        style={{ marginBottom: FOOTER_HEIGHT }}
      >
        {children}
      </div>
    </div>
  );
}
