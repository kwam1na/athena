import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { emitLandingFunnelEvent } from "@/lib/marketing/landingFunnelClient";

import {
  DEMO_PATH,
  LOGIN_PATH,
  PUBLIC_HOME_PATH,
  WALKTHROUGH_PATH,
} from "@/lib/navigation/appEntryRoutes";

export function PublicLayout({
  children,
  trackFunnelCtas = false,
  hideSecondaryNav = false,
}: {
  children: ReactNode;
  // The marketing landing page presents the demo as its sole CTA and hides the
  // secondary nav; other public pages keep the walkthrough and sign-in links.
  hideSecondaryNav?: boolean;
  trackFunnelCtas?: boolean;
}) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b border-border/70 bg-background/95">
        <nav
          aria-label="Primary navigation"
          className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-layout-2xs px-layout-sm sm:gap-layout-md sm:px-layout-xl"
        >
          <Link
            to={PUBLIC_HOME_PATH}
            className="font-display text-base font-light tracking-[0.18em] text-foreground transition-colors duration-standard ease-standard hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            athena
          </Link>

          <div className="flex items-center gap-layout-2xs sm:gap-layout-sm">
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
              onClick={
                trackFunnelCtas
                  ? () => emitLandingFunnelEvent("demo_cta")
                  : undefined
              }
              className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-md bg-signal px-layout-sm text-sm font-medium text-signal-foreground transition-colors duration-standard ease-standard hover:bg-signal/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-layout-md"
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
