import { OrganizationModal } from "@/components/ui/modals/organization-modal";
import { StoreModal } from "@/components/ui/modals/store-modal";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import {
  type Dispatch,
  type CSSProperties,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useState,
} from "react";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from "../components/ui/sidebar";
import { AppSidebar } from "../components/app-sidebar";
import { useAuth } from "../hooks/useAuth";
import { usePermissions } from "../hooks/usePermissions";
import { PermissionsProvider } from "../contexts/PermissionsContext";
import { ShieldCheck, UserCircle } from "lucide-react";
import { AppHeader } from "@/components/Navbar";
import { cn } from "@/lib/utils";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  LOGGED_IN_USER_ID_KEY,
  POS_APP_ACCOUNT_ID_KEY,
} from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import {
  ManagerElevationProvider,
  useManagerElevation,
} from "../contexts/ManagerElevationContext";
import { AppShellFullscreenContext } from "@/contexts/AppShellFullscreenContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type PosLocalEntryContext,
  useLocalPosEntryContext,
} from "@/lib/pos/infrastructure/local/localPosEntryContext";
import {
  type PosTerminalAppSessionRecoveryBlockReason,
  readStoredPosAppAccountId,
  usePosTerminalAppSessionRecovery,
} from "@/lib/pos/infrastructure/terminal/usePosTerminalAppSessionRecovery";
import {
  PosTerminalAppSessionRecoveryProvider,
  toPosTerminalAppSessionRecoveryRuntimeInput,
} from "@/lib/pos/infrastructure/terminal/posTerminalAppSessionRecoveryContext";
import type { PosTerminalRuntimeAppSessionRecoveryInput } from "@/lib/pos/infrastructure/local/terminalRuntimeStatus";

export const Route = createFileRoute("/_authed")({
  component: Layout,
});

const POS_REGISTER_PATH_PATTERN =
  /^\/(?<orgUrlSlug>[^/]+)\/store\/(?<storeUrlSlug>[^/]+)\/pos\/register\/?$/;
const POS_HUB_PATH_PATTERN =
  /^\/(?<orgUrlSlug>[^/]+)\/store\/(?<storeUrlSlug>[^/]+)\/pos(?:\/(?<child>register|sessions|transactions|expense|expense-reports|terminals)(?:\/.*)?)?$/;
const POS_RECOVERY_SHELL_PENDING_STATUSES = new Set([
  "idle",
  "validating",
  "retrying",
]);

function getPosHubRouteParams(pathname?: string) {
  if (!pathname) {
    return null;
  }

  const match = pathname.match(POS_HUB_PATH_PATTERN);
  const groups = match?.groups;

  if (!groups?.orgUrlSlug || !groups.storeUrlSlug) {
    return null;
  }

  return {
    orgUrlSlug: groups.orgUrlSlug,
    storeUrlSlug: groups.storeUrlSlug,
  };
}

function isPosRegisterPath(pathname?: string) {
  return Boolean(pathname && POS_REGISTER_PATH_PATTERN.test(pathname));
}

function getBrowserPathname() {
  return typeof window === "undefined" ? "" : window.location.pathname;
}

function getBrowserPathWithSearch() {
  if (typeof window === "undefined") {
    return "";
  }

  return `${window.location.pathname}${window.location.search}`;
}

function getRedirectPathWithSearch(pathname: string, browserPathWithSearch: string) {
  if (typeof window === "undefined" || window.location.pathname !== pathname) {
    return pathname;
  }

  return browserPathWithSearch;
}

function isUnknownRouterPath(pathname?: string) {
  return !pathname || pathname === "/";
}

function hasStoredLocalSession() {
  if (typeof localStorage === "undefined") {
    return false;
  }

  try {
    return Boolean(
      localStorage.getItem(LOGGED_IN_USER_ID_KEY) ||
        localStorage.getItem(POS_APP_ACCOUNT_ID_KEY),
    );
  } catch {
    return false;
  }
}

function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function AuthedComponent() {
  return (
    <>
      <StoreModal />
      <OrganizationModal />
      <Outlet />
    </>
  );
}

function getBlockedPosTerminalShellCopy({
  entryContext,
  recoveryReason,
}: {
  entryContext: PosLocalEntryContext;
  recoveryReason?: PosTerminalAppSessionRecoveryBlockReason | null;
}) {
  if (recoveryReason) {
    return {
      title: "POS terminal recovery unavailable",
      message:
        "This checkout station cannot reopen the register. Sign in again or reconnect this register from POS Settings before using checkout.",
    };
  }

  switch (entryContext.status) {
    case "mismatched_store":
      return {
        title: "POS terminal store mismatch",
        message:
          "This checkout station is connected to a different store register. Reconnect this register from POS Settings before using checkout.",
      };
    case "missing_route":
      return {
        title: "POS route unavailable",
        message:
          "This POS link is missing store details. Open POS from the store workspace or reconnect this register from POS Settings.",
      };
    case "unsupported_schema":
      return {
        title: "POS terminal update needed",
        message:
          "This checkout station's local POS setup needs to be refreshed before checkout can continue.",
      };
    case "ready":
      return {
        title: "POS terminal setup needed",
        message:
          "This checkout station is not connected to a register for this store. Reconnect this register from POS Settings before using checkout.",
      };
    case "missing_seed":
    default:
      return {
        title: "POS terminal setup needed",
        message:
          "This checkout station is not connected to a register for this store. Reconnect this register from POS Settings before using checkout.",
      };
  }
}

function PosTerminalBlockedShell({
  entryContext,
  recoveryReason,
}: {
  entryContext: PosLocalEntryContext;
  recoveryReason?: PosTerminalAppSessionRecoveryBlockReason | null;
}) {
  const copy = getBlockedPosTerminalShellCopy({
    entryContext,
    recoveryReason,
  });

  return (
    <section className="flex h-full min-h-0 items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl rounded-lg border border-border bg-surface px-8 py-10 text-center shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">
          POS terminal
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-foreground">
          {copy.title}
        </h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">
          {copy.message}
        </p>
      </div>
    </section>
  );
}

function PosTerminalRecoveryPendingShell({
  status,
}: {
  status: "idle" | "validating" | "retrying" | "waiting_for_network";
}) {
  const copy =
    status === "waiting_for_network"
      ? {
          title: "POS terminal recovery waiting for network",
          message:
            "Reconnect this checkout station to the network so Athena can validate the register before sales continue.",
        }
      : {
          title: "POS terminal recovery in progress",
          message:
            "Athena is validating this register before checkout reopens. Sales stay paused until recovery is confirmed.",
        };

  return (
    <section className="flex h-full min-h-0 items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl rounded-lg border border-border bg-surface px-8 py-10 text-center shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">
          POS terminal
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-foreground">
          {copy.title}
        </h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">
          {copy.message}
        </p>
      </div>
    </section>
  );
}

function PosTerminalShell({
  children,
  appSessionRecovery,
  isFullscreenActive,
  setFullscreenOverride,
}: {
  children: ReactNode;
  appSessionRecovery?: PosTerminalRuntimeAppSessionRecoveryInput | null;
  isFullscreenActive: boolean;
  setFullscreenOverride: Dispatch<SetStateAction<boolean | null>>;
}) {
  return (
    <PermissionsProvider>
      <ManagerElevationProvider>
        <AppShellFullscreenContext.Provider
          value={{ setFullscreenOverride }}
        >
          <PosTerminalAppSessionRecoveryProvider
            value={appSessionRecovery ?? null}
          >
            <SidebarProvider className="contents" defaultOpen={false}>
              <main
                className={cn(
                  "flex min-h-0 flex-1 flex-col overflow-hidden bg-background",
                  isFullscreenActive
                    ? "h-[calc(100svh-4rem)] p-0"
                    : "h-[calc(100svh-4rem)] p-8",
                )}
              >
                {children}
              </main>
            </SidebarProvider>
          </PosTerminalAppSessionRecoveryProvider>
        </AppShellFullscreenContext.Provider>
      </ManagerElevationProvider>
    </PermissionsProvider>
  );
}

function UserMenu({ userEmail }: { userEmail: string }) {
  const navigate = useNavigate();
  const { signOut } = useAuthActions();
  const { hasFullAdminAccess } = usePermissions();
  const {
    activeElevation,
    endManagerElevation,
    isManagerElevated,
    startManagerElevation,
  } = useManagerElevation();

  const handleSignOut = async () => {
    await signOut();
    localStorage.removeItem(LOGGED_IN_USER_ID_KEY);
    localStorage.removeItem(POS_APP_ACCOUNT_ID_KEY);
    navigate({ to: "/login" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 items-center gap-layout-xs rounded-md px-layout-xs py-layout-2xs text-sm text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <UserCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="max-w-[18rem] truncate font-medium">
            {userEmail}
          </span>
          {activeElevation ? (
            <Badge
              variant="outline"
              size="sm"
              className="max-w-fit shrink-0 border-action-workflow-border bg-action-workflow-soft text-action-workflow gap-1"
            >
              <ShieldCheck aria-hidden="true" className="h-3 w-3 shrink-0" />
              <span className="truncate">
                Elevated session: {activeElevation.displayName}
              </span>
            </Badge>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {isManagerElevated ? (
          <DropdownMenuItem
            className="gap-layout-xs"
            onSelect={() => void endManagerElevation()}
          >
            End manager elevation
          </DropdownMenuItem>
        ) : !hasFullAdminAccess ? (
          <DropdownMenuItem
            className="gap-layout-xs"
            onSelect={startManagerElevation}
          >
            Start manager elevation
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          className="gap-layout-xs"
          onSelect={() => void handleSignOut()}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TopBar({ userEmail }: { userEmail: string }) {
  const { state } = useSidebar();
  const sidebarColumnWidth =
    state === "collapsed"
      ? "var(--sidebar-width-icon)"
      : "var(--sidebar-width)";

  return (
    <header className="relative z-20 flex h-16 shrink-0 border-b border-border/70 bg-background">
      <div
        className={cn(
          "flex h-full w-auto shrink-0 items-center gap-layout-xs px-layout-sm transition-[width] duration-200 ease-linear md:w-[var(--topbar-sidebar-width)] md:px-layout-xl",
          state === "expanded" && "md:border-r md:border-sidebar-border",
        )}
        style={
          {
            "--topbar-sidebar-width": sidebarColumnWidth,
          } as CSSProperties
        }
      >
        <SidebarTrigger
          aria-label="Open navigation"
          className="h-9 w-9 md:hidden"
        />
        <AppHeader />
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end px-layout-sm md:px-layout-xl">
        <UserMenu userEmail={userEmail} />
      </div>
    </header>
  );
}

export default function Layout() {
  const [defaultOpen] = useState<boolean | null>(true);
  const [fullscreenOverride, setFullscreenOverride] = useState<
    boolean | null
  >(null);
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { isLoading, user } = useAuth();
  const browserPathname = getBrowserPathname();
  const browserPathWithSearch = getBrowserPathWithSearch();
  const routerPosHubParams = getPosHubRouteParams(pathname);
  const browserPosHubParams = getPosHubRouteParams(browserPathname);
  const routeParams =
    routerPosHubParams ??
    (isUnknownRouterPath(pathname) ? browserPosHubParams : null);
  const routeWantsPos = Boolean(routeParams);
  const localPosEntryContext = useLocalPosEntryContext({
    routeParams: routeParams ?? undefined,
  });
  const storedAppAccountId = readStoredPosAppAccountId();
  const isAppUserMissing = !isLoading && user === null;
  const posTerminalAppSessionRecovery = usePosTerminalAppSessionRecovery({
    routeIntent: routeWantsPos ? "pos_hub" : null,
    isAppUserMissing,
    localEntryContext: localPosEntryContext,
    storedAppAccountId,
  });
  const hasLocalPosRecoveryTarget =
    routeWantsPos &&
    isAppUserMissing &&
    localPosEntryContext.status === "ready" &&
    Boolean(localPosEntryContext.terminalSeed) &&
    Boolean(storedAppAccountId);
  const isRecoveredPosAppSession =
    routeWantsPos &&
    isAppUserMissing &&
    hasLocalPosRecoveryTarget &&
    posTerminalAppSessionRecovery.status === "recoverable";
  const isNetworkWaitingPosAppSessionRecovery =
    routeWantsPos &&
    isAppUserMissing &&
    hasLocalPosRecoveryTarget &&
    posTerminalAppSessionRecovery.status === "waiting_for_network";
  const isPendingPosAppSessionRecovery =
    routeWantsPos &&
    isAppUserMissing &&
    hasLocalPosRecoveryTarget &&
    POS_RECOVERY_SHELL_PENDING_STATUSES.has(posTerminalAppSessionRecovery.status);
  const isClassifyingPosAppSession =
    routeWantsPos &&
    isAppUserMissing &&
    localPosEntryContext.status === "loading";
  const isBlockedRecovery =
    routeWantsPos &&
    isAppUserMissing &&
    posTerminalAppSessionRecovery.status === "blocked";
  const isBlockedPosAppSession =
    routeWantsPos &&
    isAppUserMissing &&
    (isBlockedRecovery ||
      (!hasLocalPosRecoveryTarget &&
        !isRecoveredPosAppSession &&
        !isPendingPosAppSessionRecovery &&
        !isClassifyingPosAppSession));
  const canRenderRehydratingPosShell =
    routeWantsPos &&
    isLoading &&
    isBrowserOffline() &&
    hasStoredLocalSession();
  const routeWantsFullscreen =
    isPosRegisterPath(pathname) ||
    (isUnknownRouterPath(pathname) && isPosRegisterPath(browserPathname));
  const canRenderSignedInPosRegisterShell =
    Boolean(user) &&
    routeWantsFullscreen &&
    localPosEntryContext.status === "ready" &&
    Boolean(localPosEntryContext.terminalSeed);
  const shouldRenderPosTerminalShell =
    canRenderRehydratingPosShell ||
    isRecoveredPosAppSession ||
    isNetworkWaitingPosAppSessionRecovery ||
    canRenderSignedInPosRegisterShell;
  const shouldRenderPendingPosTerminalShell =
    isPendingPosAppSessionRecovery || isClassifyingPosAppSession;
  const userEmail =
    user?.email ??
    (shouldRenderPosTerminalShell || shouldRenderPendingPosTerminalShell
      ? "POS terminal"
      : "");
  const isFullscreenActive = fullscreenOverride ?? routeWantsFullscreen;

  // useEffect(() => {
  //   // Read the sidebar state from cookies
  //   const cookies = document.cookie.split(";");
  //   const sidebarCookie = cookies.find((cookie) =>
  //     cookie.trim().startsWith("sidebar:state=")
  //   );

  //   if (sidebarCookie) {
  //     const sidebarState = sidebarCookie.split("=")[1];
  //     setDefaultOpen(sidebarState === "true");
  //   } else {
  //     // If no cookie exists, default to true (expanded)
  //     setDefaultOpen(true);
  //   }
  // }, []);

  // Don't render until we've read the cookie
  useEffect(() => {
    if (
      shouldRenderPosTerminalShell ||
      shouldRenderPendingPosTerminalShell ||
      isBlockedPosAppSession ||
      isClassifyingPosAppSession
    ) {
      return;
    }

    if (!isLoading && user === null) {
      const redirectTo = isUnknownRouterPath(pathname)
        ? browserPathWithSearch
        : getRedirectPathWithSearch(pathname, browserPathWithSearch);
      const loginTarget = routeWantsPos
        ? {
            to: "/login" as const,
            search: {
              redirectTo,
            } as never,
          }
        : { to: "/login" as const };
      navigate(loginTarget);
    }
  }, [
    browserPathname,
    browserPathWithSearch,
    pathname,
    routeWantsPos,
    shouldRenderPosTerminalShell,
    shouldRenderPendingPosTerminalShell,
    isBlockedPosAppSession,
    isClassifyingPosAppSession,
    isLoading,
    navigate,
    user,
  ]);

  useEffect(() => {
    setFullscreenOverride(null);
  }, [routeWantsFullscreen]);

  if (
    defaultOpen === null ||
    (!shouldRenderPosTerminalShell &&
      !shouldRenderPendingPosTerminalShell &&
      !isBlockedPosAppSession &&
      (isLoading || user === null))
  ) {
    return null; // or a loading spinner if you prefer
  }

  if (
    shouldRenderPosTerminalShell ||
    shouldRenderPendingPosTerminalShell ||
    isBlockedPosAppSession
  ) {
    return (
      <PosTerminalShell
        appSessionRecovery={toPosTerminalAppSessionRecoveryRuntimeInput(
          posTerminalAppSessionRecovery,
        )}
        isFullscreenActive={isFullscreenActive}
        setFullscreenOverride={setFullscreenOverride}
      >
        {isBlockedPosAppSession ? (
          <PosTerminalBlockedShell
            entryContext={localPosEntryContext}
            recoveryReason={posTerminalAppSessionRecovery.reason}
          />
        ) : shouldRenderPendingPosTerminalShell ? (
          <PosTerminalRecoveryPendingShell
            status={
              posTerminalAppSessionRecovery.status === "idle" ||
              posTerminalAppSessionRecovery.status === "validating" ||
              posTerminalAppSessionRecovery.status === "retrying" ||
              posTerminalAppSessionRecovery.status === "waiting_for_network"
                ? posTerminalAppSessionRecovery.status
                : "validating"
            }
          />
        ) : (
          <Outlet />
        )}
      </PosTerminalShell>
    );
  }

  return (
    <PermissionsProvider>
      <ManagerElevationProvider>
        <AppShellFullscreenContext.Provider
          value={{ setFullscreenOverride }}
        >
          <SidebarProvider
            className="fixed inset-0 h-svh !min-h-0 flex-col overflow-hidden"
            defaultOpen={defaultOpen}
          >
            {isFullscreenActive ? null : <TopBar userEmail={userEmail} />}
            <div
              className={cn(
                "flex !min-h-0 flex-1",
                isFullscreenActive ? "h-svh" : "h-[calc(100svh-4rem)]",
              )}
            >
              <AppSidebar />
              <SidebarInset className="h-full !min-h-0 overflow-hidden">
                <main className="box-border flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent p-layout-md md:p-8">
                  <AuthedComponent />
                </main>
              </SidebarInset>
            </div>
          </SidebarProvider>
        </AppShellFullscreenContext.Provider>
      </ManagerElevationProvider>
    </PermissionsProvider>
  );
}
