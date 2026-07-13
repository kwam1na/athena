import { OrganizationModal } from "@/components/ui/modals/organization-modal";
import { StoreModal } from "@/components/ui/modals/store-modal";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  type Dispatch,
  type CSSProperties,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useRef,
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
import {
  ArrowUpRight,
  Monitor,
  Moon,
  ShieldCheck,
  Smartphone,
  Sun,
  UserCircle,
} from "lucide-react";
import { AppHeader } from "@/components/Navbar";
import { cn } from "@/lib/utils";
import { useAuthActions } from "@convex-dev/auth/react";
import { LOGGED_IN_USER_ID_KEY, POS_APP_ACCOUNT_ID_KEY } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  ManagerElevationProvider,
  useManagerElevation,
} from "../contexts/ManagerElevationContext";
import { AppShellFullscreenContext } from "@/contexts/AppShellFullscreenContext";
import { PosRemoteAssistRuntimeHost } from "@/components/remote-assist/PosRemoteAssistRuntimeHost";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type PosLocalEntryContext,
  useLocalPosEntryContext,
} from "@/lib/pos/infrastructure/local/localPosEntryContext";
import { useIsMobile } from "@/hooks/use-mobile";
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
import {
  type AthenaThemeMode,
  setAthenaThemeModeWithTransition,
  useAthenaTheme,
} from "@/lib/theme";
import { SharedDemoRuntime } from "@/components/shared-demo/SharedDemoRuntime";
import {
  SharedDemoRestrictedSurface,
} from "@/components/shared-demo/SharedDemoRestrictedSurface";
import { isSharedDemoRestrictedPath } from "@/components/shared-demo/sharedDemoRestrictions";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

const POS_TERMINAL_FULLSCREEN_PATH_PATTERN =
  /^\/(?<orgUrlSlug>[^/]+)\/store\/(?<storeUrlSlug>[^/]+)\/pos\/(?:register|expense)\/?$/;
const POS_HUB_PATH_PATTERN =
  /^\/(?<orgUrlSlug>[^/]+)\/store\/(?<storeUrlSlug>[^/]+)\/pos(?:\/.*)?$/;
const STORE_WORKSPACE_PATH_PATTERN =
  /^\/(?<orgUrlSlug>[^/]+)\/store\/(?<storeUrlSlug>[^/]+)(?:\/.*)?$/;
const POS_RECOVERY_SHELL_PENDING_STATUSES = new Set([
  "idle",
  "validating",
  "retrying",
]);

type AppShellVariant = "classic" | "contained";

const APP_SHELL_VARIANT = "contained" satisfies AppShellVariant;

function getPosHubRouteParams(pathname?: string) {
  return getRouteParamsForPattern(pathname, POS_HUB_PATH_PATTERN);
}

function getStoreWorkspaceRouteParams(pathname?: string) {
  return getRouteParamsForPattern(pathname, STORE_WORKSPACE_PATH_PATTERN);
}

function getRouteParamsForPattern(
  pathname: string | undefined,
  pattern: RegExp,
) {
  if (!pathname) {
    return null;
  }

  const match = pathname.match(pattern);
  const groups = match?.groups;

  if (!groups?.orgUrlSlug || !groups.storeUrlSlug) {
    return null;
  }

  return {
    orgUrlSlug: groups.orgUrlSlug,
    storeUrlSlug: groups.storeUrlSlug,
  };
}

function isPosTerminalFullscreenPath(pathname?: string) {
  return Boolean(
    pathname && POS_TERMINAL_FULLSCREEN_PATH_PATTERN.test(pathname),
  );
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

function getRedirectPathWithSearch(
  pathname: string,
  browserPathWithSearch: string,
) {
  if (typeof window === "undefined" || window.location.pathname !== pathname) {
    return pathname;
  }

  return browserPathWithSearch;
}

function getLoginHref(redirectTo: string) {
  if (!redirectTo) {
    return "/login";
  }

  const params = new URLSearchParams({ redirectTo });
  return `/login?${params.toString()}`;
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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const demoContext = useQuery(api.sharedDemo.public.getContext, {});
  if (demoContext && isSharedDemoRestrictedPath(pathname)) {
    const storeRoot = pathname.match(/^\/[^/]+\/store\/[^/]+/)?.[0];
    return (
      <SharedDemoRestrictedSurface
        homeHref={`${storeRoot ?? ""}/shared-demo`}
      />
    );
  }
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
      action: {
        label: "Sign in to POS",
      },
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
  const actionHref = copy.action
    ? getLoginHref(getBrowserPathWithSearch())
    : null;

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
        {actionHref && copy.action ? (
          <a
            className={cn(buttonVariants({ variant: "workflow" }), "mt-6")}
            href={actionHref}
          >
            <span>{copy.action.label}</span>
            <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
          </a>
        ) : null}
      </div>
    </section>
  );
}

function PosTerminalSignInGate({ redirectTo }: { redirectTo: string }) {
  const actionHref = getLoginHref(redirectTo);

  return (
    <section className="flex h-full min-h-0 items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl rounded-lg border border-border bg-surface px-8 py-10 text-center shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">
          POS terminal
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-foreground">
          Sign in required
        </h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">
          Sign in again to continue using this register.
        </p>
        <a
          className={cn(buttonVariants({ variant: "workflow" }), "mt-6")}
          href={actionHref}
        >
          <span>Sign in to POS</span>
          <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
        </a>
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
        <AppShellFullscreenContext.Provider value={{ setFullscreenOverride }}>
          <PosTerminalAppSessionRecoveryProvider
            value={appSessionRecovery ?? null}
          >
            <SidebarProvider className="contents" defaultOpen={false}>
              <main
                className={cn(
                  "flex min-h-0 flex-1 flex-col overflow-hidden bg-background",
                  isFullscreenActive
                    ? "box-border h-svh py-layout-md md:py-8"
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

function UserMenu({
  shellVariant,
  userEmail,
}: {
  shellVariant: AppShellVariant;
  userEmail: string;
}) {
  const navigate = useNavigate();
  const { signOut } = useAuthActions();
  const { hasFullAdminAccess } = usePermissions();
  const { mode, resolvedTheme, systemTheme } = useAthenaTheme();
  const isMobile = useIsMobile();
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

  const nextTheme: AthenaThemeMode =
    mode === "system"
      ? systemTheme === "dark"
        ? "light"
        : "dark"
      : mode === "light"
        ? systemTheme === "dark"
          ? "dark"
          : "system"
        : systemTheme === "dark"
          ? "system"
          : "light";
  const ThemeIcon =
    mode === "system" ? (isMobile ? Smartphone : Monitor) : mode === "dark" ? Moon : Sun;
  const themeToggleLabel =
    mode === "system"
      ? `Using system ${resolvedTheme} theme, switch to ${nextTheme} theme`
      : `Switch to ${nextTheme} theme`;
  const isContainedShell = shellVariant === "contained";
  const containedControlSurface =
    "border border-border/70 bg-background/90 shadow-surface backdrop-blur supports-[backdrop-filter]:bg-background/75";

  return (
    <div className="flex shrink-0 items-center gap-1 sm:gap-layout-xs">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Open account menu for ${userEmail}`}
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center gap-layout-xs px-0 text-sm text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:w-auto sm:min-w-0 sm:px-layout-xs",
              isContainedShell ? `rounded-lg ${containedControlSurface}` : "rounded-md",
            )}
          >
            <UserCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="hidden max-w-[18rem] truncate font-medium sm:block">
              {userEmail}
            </span>
            {activeElevation ? (
              <Badge
                variant="outline"
                size="sm"
                className="hidden max-w-fit shrink-0 gap-1 border-action-workflow-border bg-action-workflow-soft text-action-workflow md:inline-flex"
              >
                <ShieldCheck aria-hidden="true" className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  Elevated session: {activeElevation.displayName}
                </span>
              </Badge>
            ) : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
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
          {!hasFullAdminAccess || isManagerElevated ? (
            <DropdownMenuSeparator />
          ) : null}
          <DropdownMenuItem
            className="gap-layout-xs"
            onSelect={() => void handleSignOut()}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label={themeToggleLabel}
        title={themeToggleLabel}
        className={cn(
          "group flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground transition-[background-color,color,transform] duration-fast ease-standard hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] sm:h-9 sm:w-9",
          isContainedShell ? `rounded-lg ${containedControlSurface}` : "rounded-md",
        )}
        onClick={() => setAthenaThemeModeWithTransition(nextTheme)}
      >
        <ThemeIcon
          aria-hidden="true"
          className="h-4 w-4 transition-transform duration-fast ease-emphasized group-hover:rotate-12 group-active:scale-90"
        />
      </button>
    </div>
  );
}

function TopBar({
  shellVariant,
  userEmail,
}: {
  shellVariant: AppShellVariant;
  userEmail: string;
}) {
  const { state } = useSidebar();
  const isContainedShell = shellVariant === "contained";
  const sidebarColumnWidth =
    state === "collapsed"
      ? "var(--sidebar-width-icon)"
      : "var(--sidebar-width)";

  return (
    <header
      className={cn(
        "relative z-20 box-border flex h-16 shrink-0",
        isContainedShell
          ? "bg-transparent px-layout-xs pt-layout-xs sm:px-layout-sm sm:pt-layout-sm"
          : "border-b border-border/70 bg-background",
      )}
    >
      <div
        className={cn(
          "flex h-full min-w-0 items-center gap-layout-xs",
          isContainedShell
            ? "flex-1 justify-start overflow-hidden px-0 sm:px-layout-sm"
            : "w-auto shrink-0 justify-center px-layout-sm transition-[width] duration-200 ease-linear md:w-[var(--topbar-sidebar-width)]",
          !isContainedShell &&
            state === "expanded" &&
            "md:border-r md:border-sidebar-border",
        )}
        style={
          isContainedShell
            ? undefined
            : ({
                "--topbar-sidebar-width": sidebarColumnWidth,
              } as CSSProperties)
        }
      >
        <SidebarTrigger
          aria-label="Open navigation"
          className="h-10 w-10 shrink-0 md:hidden"
        />
        <div
          className={cn(
            isContainedShell &&
              "min-w-0 overflow-hidden rounded-lg px-layout-xs py-layout-2xs",
          )}
        >
          <AppHeader />
        </div>
      </div>
      <div
        className={cn(
          "flex items-center justify-end",
          isContainedShell
            ? "shrink-0 px-0 sm:px-layout-sm"
            : "min-w-0 flex-1 px-layout-sm md:px-layout-xl",
        )}
      >
        <UserMenu shellVariant={shellVariant} userEmail={userEmail} />
      </div>
    </header>
  );
}

function MobileSidebarRouteDismiss({ routeKey }: { routeKey: string }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const previousRouteKeyRef = useRef(routeKey);

  useEffect(() => {
    if (previousRouteKeyRef.current === routeKey) {
      return;
    }

    previousRouteKeyRef.current = routeKey;

    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, routeKey, setOpenMobile]);

  return null;
}

export default function Layout() {
  const [fullscreenOverride, setFullscreenOverride] = useState<boolean | null>(
    null,
  );
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const routeKey = useRouterState({
    select: (state) =>
      "href" in state.location && typeof state.location.href === "string"
        ? state.location.href
        : state.location.pathname,
  });
  const { isLoading, user } = useAuth();
  const browserPathname = getBrowserPathname();
  const browserPathWithSearch = getBrowserPathWithSearch();
  const routerPosHubParams = getPosHubRouteParams(pathname);
  const browserPosHubParams = getPosHubRouteParams(browserPathname);
  const posRouteParams =
    routerPosHubParams ??
    (isUnknownRouterPath(pathname) ? browserPosHubParams : null);
  const routerStoreWorkspaceParams = getStoreWorkspaceRouteParams(pathname);
  const browserStoreWorkspaceParams =
    getStoreWorkspaceRouteParams(browserPathname);
  const storeRouteParams =
    routerStoreWorkspaceParams ??
    (isUnknownRouterPath(pathname) ? browserStoreWorkspaceParams : null);
  const routeWantsPos = Boolean(posRouteParams);
  const localPosEntryContext = useLocalPosEntryContext({
    routeParams: storeRouteParams ?? undefined,
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
    POS_RECOVERY_SHELL_PENDING_STATUSES.has(
      posTerminalAppSessionRecovery.status,
    );
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
    routeWantsPos && isLoading && isBrowserOffline() && hasStoredLocalSession();
  const routeWantsFullscreen =
    isPosTerminalFullscreenPath(pathname) ||
    (isUnknownRouterPath(pathname) &&
      isPosTerminalFullscreenPath(browserPathname));
  const canRenderSignedInPosRegisterShell =
    Boolean(user) &&
    routeWantsFullscreen &&
    localPosEntryContext.status === "ready" &&
    Boolean(localPosEntryContext.terminalSeed);
  const shouldRenderPosTerminalShell =
    canRenderRehydratingPosShell ||
    isNetworkWaitingPosAppSessionRecovery ||
    canRenderSignedInPosRegisterShell;
  const shouldRenderPosSignInGate = isRecoveredPosAppSession;
  const shouldRenderPendingPosTerminalShell =
    isPendingPosAppSessionRecovery || isClassifyingPosAppSession;
  const shouldMountRemoteAssistRuntime =
    Boolean(user) &&
    localPosEntryContext.status === "ready" &&
    Boolean(localPosEntryContext.terminalSeed);
  const posAppSessionRecoveryRuntimeInput =
    toPosTerminalAppSessionRecoveryRuntimeInput(posTerminalAppSessionRecovery);
  const userEmail =
    user?.email ??
    (shouldRenderPosTerminalShell ||
      shouldRenderPosSignInGate ||
      shouldRenderPendingPosTerminalShell
      ? "POS terminal"
      : "");
  const isFullscreenActive = fullscreenOverride ?? routeWantsFullscreen;
  const authRedirectTo = isUnknownRouterPath(pathname)
    ? browserPathWithSearch
    : getRedirectPathWithSearch(pathname, browserPathWithSearch);

  useEffect(() => {
    if (
      shouldRenderPosTerminalShell ||
      shouldRenderPosSignInGate ||
      shouldRenderPendingPosTerminalShell ||
      isBlockedPosAppSession ||
      isClassifyingPosAppSession
    ) {
      return;
    }

    if (!isLoading && user === null) {
      const loginTarget = routeWantsPos
        ? {
            to: "/login" as const,
            search: {
              redirectTo: authRedirectTo,
            } as never,
          }
        : { to: "/login" as const };
      navigate(loginTarget);
    }
  }, [
    browserPathname,
    browserPathWithSearch,
    authRedirectTo,
    pathname,
    routeWantsPos,
    shouldRenderPosTerminalShell,
    shouldRenderPosSignInGate,
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
    !shouldRenderPosTerminalShell &&
      !shouldRenderPosSignInGate &&
      !shouldRenderPendingPosTerminalShell &&
      !isBlockedPosAppSession &&
      (isLoading || user === null)
  ) {
    return null; // or a loading spinner if you prefer
  }

  if (
    shouldRenderPosTerminalShell ||
    shouldRenderPosSignInGate ||
    shouldRenderPendingPosTerminalShell ||
    isBlockedPosAppSession
  ) {
    return (
      <PosTerminalShell
        appSessionRecovery={posAppSessionRecoveryRuntimeInput}
        isFullscreenActive={isFullscreenActive}
        setFullscreenOverride={setFullscreenOverride}
      >
        <SharedDemoRuntime />
        {shouldMountRemoteAssistRuntime ? (
          <PosRemoteAssistRuntimeHost
            appSessionRecovery={posAppSessionRecoveryRuntimeInput}
            entryContext={localPosEntryContext}
          />
        ) : null}
        {isBlockedPosAppSession ? (
          <PosTerminalBlockedShell
            entryContext={localPosEntryContext}
            recoveryReason={posTerminalAppSessionRecovery.reason}
          />
        ) : shouldRenderPosSignInGate ? (
          <PosTerminalSignInGate redirectTo={authRedirectTo} />
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
        <AppShellFullscreenContext.Provider value={{ setFullscreenOverride }}>
          <SidebarProvider
            className="fixed inset-0 h-svh !min-h-0 flex-col overflow-hidden bg-app-canvas"
          >
            <MobileSidebarRouteDismiss routeKey={routeKey} />
            {isFullscreenActive ? null : (
              <TopBar
                shellVariant={APP_SHELL_VARIANT}
                userEmail={userEmail}
              />
            )}
            {isFullscreenActive ? null : <SharedDemoRuntime />}
            <div
              className={cn(
                "flex !min-h-0 flex-1",
                isFullscreenActive && "h-svh",
              )}
            >
              {isFullscreenActive ? null : (
                <AppSidebar shellVariant={APP_SHELL_VARIANT} />
              )}
              <SidebarInset className="h-full !min-h-0 overflow-hidden">
                <main className="box-border flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent p-layout-md md:p-8">
                  {shouldMountRemoteAssistRuntime ? (
                    <PosRemoteAssistRuntimeHost
                      appSessionRecovery={posAppSessionRecoveryRuntimeInput}
                      entryContext={localPosEntryContext}
                    />
                  ) : null}
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
