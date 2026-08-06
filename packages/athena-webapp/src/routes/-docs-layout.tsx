import { useEffect } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, BookOpenText, FileChartColumn, Moon, ScrollText, Sun } from "lucide-react";

import { DocsScrollToTop } from "@/components/docs/DocsScrollToTop";
import { DocsTexture } from "@/components/docs/DocsTexture";
import { FadeIn } from "@/components/common/FadeIn";
import Spinner from "@/components/ui/spinner";
import { DocsOriginProvider } from "./-docs-origin";
import { useAuth } from "@/hooks/useAuth";
import { listDeliveryReports, listSolutionDocs } from "@/lib/docs/content";
import { LOGIN_PATH } from "@/lib/navigation/appEntryRoutes";
import { useAthenaTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

function DocsThemeToggle() {
  const { resolvedTheme, setThemeMode } = useAthenaTheme();
  const nextTheme = resolvedTheme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      aria-label={`Switch to ${nextTheme} theme`}
      onClick={() => setThemeMode(nextTheme)}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-card text-muted-foreground transition-colors hover:text-foreground"
    >
      {resolvedTheme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}

const NAV_LINK_CLASS =
  "flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground";

const NAV_LINK_ACTIVE = {
  className: cn(NAV_LINK_CLASS, "bg-primary-soft font-medium text-primary"),
};

function DocsNav() {
  const solutionCount = listSolutionDocs().length;
  const reportCount = listDeliveryReports().length;

  return (
    <nav aria-label="Documentation" className="flex flex-col gap-1.5">
      <Link
        to="/docs"
        activeOptions={{ exact: true }}
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE}
      >
        <BookOpenText className="h-4 w-4 shrink-0" />
        Overview
      </Link>
      <Link
        to="/docs/solutions"
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE}
      >
        <ScrollText className="h-4 w-4 shrink-0" />
        Solution docs
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {solutionCount}
        </span>
      </Link>
      <Link
        to="/docs/reports"
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE}
      >
        <FileChartColumn className="h-4 w-4 shrink-0" />
        Delivery reports
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {reportCount}
        </span>
      </Link>
    </nav>
  );
}

/**
 * The docs corpus includes security and infrastructure writeups, so the whole
 * section sits behind the same signed-in gate as the app shell.
 */
function DocsAuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && user === null) {
      navigate({ to: LOGIN_PATH });
    }
  }, [isLoading, user, navigate]);

  if (isLoading || user === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  return <>{children}</>;
}

export function DocsLayout() {
  // Keying the fade on the pathname replays it on every page change. Search
  // params are excluded on purpose: filtering the solutions list should not
  // flash the results it is filtering.
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <DocsAuthGate>
      <DocsOriginProvider>
      <div className="relative min-h-screen bg-background text-foreground">
        <DocsTexture />
        <header className="sticky top-0 z-20 border-b border-border/70 bg-background/90 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
            <Link
              to="/"
              aria-label="Back to Athena"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <Link to="/docs" className="flex items-baseline gap-2">
              <span className="font-display text-base font-medium">Athena</span>
              <span className="text-sm text-muted-foreground">Docs</span>
            </Link>
            <div className="ml-auto">
              <DocsThemeToggle />
            </div>
          </div>
        </header>

        <div className="relative z-10 mx-auto flex w-full max-w-7xl gap-10 px-4 py-10 sm:px-6 sm:py-14">
          <aside className="hidden w-56 shrink-0 md:block">
            <div className="sticky top-[6rem]">
              <DocsNav />
            </div>
          </aside>
          <main className="min-w-0 flex-1">
            <div className="mb-8 border-b border-border/70 pb-6 md:hidden">
              <DocsNav />
            </div>
            <FadeIn key={pathname}>
              <Outlet />
            </FadeIn>
          </main>
        </div>

        <DocsScrollToTop />
      </div>
      </DocsOriginProvider>
    </DocsAuthGate>
  );
}
