import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Layout from "./-authed-layout";
import { LOGGED_IN_USER_ID_KEY, POS_APP_ACCOUNT_ID_KEY } from "@/lib/constants";
import { useAppShellFullscreenMode } from "@/contexts/AppShellFullscreenContext";
import { ATHENA_THEME_STORAGE_KEY } from "@/lib/theme";

const mocked = vi.hoisted(() => ({
  OutletComponent: null as (() => ReactNode) | null,
  navigate: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  startManagerElevation: vi.fn(),
  endManagerElevation: vi.fn(),
  setOpenMobile: vi.fn(),
  useAuth: vi.fn(),
  useLocalPosEntryContext: vi.fn(),
  useManagerElevation: vi.fn(),
  usePermissions: vi.fn(),
  usePosTerminalAppSessionRecovery: vi.fn(),
  PosRemoteAssistRuntimeHost: vi.fn(
    ({ entryContext }: { entryContext: unknown }) => (
      <div
        data-has-entry-context={String(Boolean(entryContext))}
        data-testid="pos-remote-assist-host"
      />
    ),
  ),
  readStoredPosAppAccountId: vi.fn(),
  SidebarProvider: vi.fn(),
  useSidebar: vi.fn(),
  useRouterState: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  Outlet: () => {
    const OutletComponent = mocked.OutletComponent;
    return OutletComponent ? (
      <OutletComponent />
    ) : (
      <div data-testid="authed-outlet">Authed outlet</div>
    );
  },
  useNavigate: () => mocked.navigate,
  useRouterState: mocked.useRouterState,
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: mocked.useAuth,
}));

vi.mock("@/lib/pos/infrastructure/local/localPosEntryContext", () => ({
  useLocalPosEntryContext: mocked.useLocalPosEntryContext,
}));

vi.mock("@/components/remote-assist/PosRemoteAssistRuntimeHost", () => ({
  PosRemoteAssistRuntimeHost: mocked.PosRemoteAssistRuntimeHost,
}));

vi.mock(
  "@/lib/pos/infrastructure/terminal/usePosTerminalAppSessionRecovery",
  () => ({
    readStoredPosAppAccountId: mocked.readStoredPosAppAccountId,
    usePosTerminalAppSessionRecovery: mocked.usePosTerminalAppSessionRecovery,
  }),
);

vi.mock("../hooks/usePermissions", () => ({
  usePermissions: mocked.usePermissions,
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: mocked.signOut }),
}));

vi.mock("../contexts/PermissionsContext", () => ({
  PermissionsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../contexts/ManagerElevationContext", () => ({
  ManagerElevationProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  useManagerElevation: mocked.useManagerElevation,
}));

vi.mock("../components/ui/sidebar", () => ({
  SidebarProvider: ({
    children,
    ...props
  }: {
    children: ReactNode;
    className?: string;
    defaultOpen?: boolean;
  }) => {
    mocked.SidebarProvider(props);
    return <div data-testid="sidebar-provider">{children}</div>;
  },
  SidebarInset: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <main className={className} data-testid="sidebar-inset">
      {children}
    </main>
  ),
  SidebarTrigger: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
  }) => (
    <button data-testid="sidebar-trigger" type="button" {...props}>
      {children}
    </button>
  ),
  useSidebar: mocked.useSidebar,
}));

vi.mock("../components/app-sidebar", () => ({
  AppSidebar: ({ shellVariant }: { shellVariant?: string }) => (
    <div data-shell-variant={shellVariant} data-testid="app-sidebar">
      Sidebar
    </div>
  ),
}));

vi.mock("@/components/Navbar", () => ({
  AppHeader: () => <div data-testid="app-header">App header</div>,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect?: () => void;
  }) => <button onClick={onSelect}>{children}</button>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuRadioGroup: ({
    children,
    onValueChange,
  }: {
    children: ReactNode;
    onValueChange?: (value: string) => void;
  }) => <div data-on-value-change={Boolean(onValueChange)}>{children}</div>,
  DropdownMenuRadioItem: ({
    children,
    value,
  }: {
    children: ReactNode;
    value: string;
  }) => <button value={value}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/modals/organization-modal", () => ({
  OrganizationModal: () => <div data-testid="organization-modal" />,
}));

vi.mock("@/components/ui/modals/store-modal", () => ({
  StoreModal: () => <div data-testid="store-modal" />,
}));

function FullscreenOutlet() {
  useAppShellFullscreenMode();
  return <div data-testid="fullscreen-outlet">Fullscreen outlet</div>;
}

function readyLocalPosEntryContext(storeUrlSlug = "wigclub") {
  return {
    status: "ready",
    orgUrlSlug: "wigclub",
    storeUrlSlug,
    storeId: "store-1",
    source: "local",
    terminalSeed: {
      terminalId: "local-terminal-1",
      cloudTerminalId: "terminal-cloud-1",
      syncSecretHash: "secret-hash",
      storeId: "store-1",
      displayName: "Front register",
      provisionedAt: 1_700,
      schemaVersion: 7,
    },
  };
}

function recoveryState(status: string) {
  if (status === "retrying") {
    return { assertion: null, attempt: 1, reason: null, status };
  }

  if (status === "recoverable") {
    return {
      assertion: {
        accountId: "stored-app-user-1",
        issuedAt: 1_700,
        expiresAt: Date.now() + 60_000,
        recoveryAttemptId: "attempt-1",
        routeScope: "pos_hub",
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      },
      reason: null,
      status,
    };
  }

  return { assertion: null, reason: null, status };
}

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

describe("Authed layout", () => {
  beforeEach(() => {
    mocked.OutletComponent = null;
    document.cookie = "sidebar_state=; path=/; max-age=0";
    window.history.replaceState({}, "", "/wigclub/store/wigclub/products");
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    setViewportWidth(1024);
    installMatchMedia(false);
    vi.mocked(window.localStorage.getItem).mockReset();
    vi.mocked(window.localStorage.getItem).mockReturnValue(null);
    mocked.navigate.mockReset();
    mocked.signOut.mockClear();
    mocked.startManagerElevation.mockReset();
    mocked.endManagerElevation.mockReset();
    mocked.setOpenMobile.mockReset();
    mocked.useAuth.mockReset();
    mocked.useLocalPosEntryContext.mockReset();
    mocked.useLocalPosEntryContext.mockReturnValue({ status: "missing_seed" });
    mocked.usePosTerminalAppSessionRecovery.mockReset();
    mocked.usePosTerminalAppSessionRecovery.mockReturnValue(
      recoveryState("idle"),
    );
    mocked.readStoredPosAppAccountId.mockReset();
    mocked.readStoredPosAppAccountId.mockReturnValue("stored-app-user-1");
    mocked.SidebarProvider.mockReset();
    mocked.useSidebar.mockReset();
    mocked.useSidebar.mockReturnValue({
      isMobile: false,
      setOpenMobile: mocked.setOpenMobile,
      state: "expanded",
    });
    mocked.useManagerElevation.mockReturnValue({
      activeElevation: null,
      endManagerElevation: mocked.endManagerElevation,
      isManagerElevated: false,
      startManagerElevation: mocked.startManagerElevation,
    });
    mocked.usePermissions.mockReturnValue({
      hasFullAdminAccess: false,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/products" } }),
    );
  });

  it("stays empty while auth is still loading", () => {
    mocked.useAuth.mockReturnValue({
      user: undefined,
      isLoading: true,
    });

    const { container } = render(<Layout />);

    expect(container).toBeEmptyDOMElement();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("renders the POS shell offline when Convex auth is still reconnecting", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === LOGGED_IN_USER_ID_KEY ? "user-1" : null,
    );
    mocked.useAuth.mockReturnValue({
      user: undefined,
      isLoading: true,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos/register" } }),
    );

    render(<Layout />);

    expect(screen.getByTestId("authed-outlet")).toBeInTheDocument();
    expect(screen.getByTestId("authed-outlet").closest("main")).toHaveClass(
      "h-[calc(100svh-4rem)]",
      "p-0",
      "overflow-hidden",
    );
    expect(screen.getByTestId("sidebar-provider")).toBeInTheDocument();
    expect(mocked.SidebarProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        className: "contents",
        defaultOpen: false,
      }),
    );
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("store-modal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("organization-modal")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /sign out/i }),
    ).not.toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("does not crash when stored POS session state is unavailable during offline auth rehydration", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    vi.mocked(window.localStorage.getItem).mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    mocked.useAuth.mockReturnValue({
      user: undefined,
      isLoading: true,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos/register" } }),
    );

    const { container } = render(<Layout />);

    expect(container).toBeEmptyDOMElement();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("keeps the POS outlet unmounted during online auth rehydration with a local POS session stored", () => {
    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === LOGGED_IN_USER_ID_KEY ? "user-1" : null,
    );
    mocked.useAuth.mockReturnValue({
      user: undefined,
      isLoading: true,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos" } }),
    );

    render(<Layout />);

    expect(screen.queryByTestId("authed-outlet")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("does not treat pending auth-sync loading as POS terminal authority", () => {
    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === LOGGED_IN_USER_ID_KEY || key === POS_APP_ACCOUNT_ID_KEY
        ? "stale-user-1"
        : null,
    );
    mocked.useAuth.mockReturnValue({
      user: undefined,
      isLoading: true,
    });
    mocked.useLocalPosEntryContext.mockReturnValue(readyLocalPosEntryContext());
    mocked.readStoredPosAppAccountId.mockReturnValue("stale-user-1");
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos/register" } }),
    );

    const { container } = render(<Layout />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("authed-outlet")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pos-remote-assist-host")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /pos terminal/i }),
    ).not.toBeInTheDocument();
    expect(mocked.usePosTerminalAppSessionRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        isAppUserMissing: false,
        storedAppAccountId: "stale-user-1",
      }),
    );
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("keeps non-POS routes blocked while offline auth is still loading", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === LOGGED_IN_USER_ID_KEY ? "user-1" : null,
    );
    mocked.useAuth.mockReturnValue({
      user: undefined,
      isLoading: true,
    });

    const { container } = render(<Layout />);

    expect(container).toBeEmptyDOMElement();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("redirects to login instead of rendering the authed shell when the session is gone", async () => {
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });

    const { container } = render(<Layout />);

    expect(container).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(mocked.navigate).toHaveBeenCalledWith({ to: "/login" }),
    );
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
  });

  it("renders a blocked POS shell when Convex auth settles without terminal continuity", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === LOGGED_IN_USER_ID_KEY ? "user-1" : null,
    );
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos/register" } }),
    );

    render(<Layout />);

    expect(
      screen.getByRole("heading", { name: "POS terminal setup needed" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("renders the POS sign-in gate for recoverable app-session drift without generic app chrome", () => {
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue(readyLocalPosEntryContext());
    mocked.usePosTerminalAppSessionRecovery.mockReturnValue(
      recoveryState("recoverable"),
    );
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos/register" } }),
    );

    render(<Layout />);

    expect(screen.queryByTestId("authed-outlet")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sign in required" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sign in again to continue using this register."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Sign in to POS" }),
    ).toHaveAttribute(
      "href",
      "/login?redirectTo=%2Fwigclub%2Fstore%2Fwigclub%2Fpos%2Fregister",
    );
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("store-modal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("organization-modal")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /sign out/i }),
    ).not.toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
    expect(mocked.useLocalPosEntryContext).toHaveBeenCalledWith({
      routeParams: { orgUrlSlug: "wigclub", storeUrlSlug: "wigclub" },
    });
    expect(mocked.usePosTerminalAppSessionRecovery).toHaveBeenCalledWith({
      routeIntent: "pos_hub",
      isAppUserMissing: true,
      localEntryContext: readyLocalPosEntryContext(),
      storedAppAccountId: "stored-app-user-1",
    });
  });

  it("invokes POS hub app-session recovery with local drift context and the stored account id", () => {
    const localEntryContext = readyLocalPosEntryContext();
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue(localEntryContext);
    mocked.usePosTerminalAppSessionRecovery.mockReturnValue(
      recoveryState("validating"),
    );
    mocked.readStoredPosAppAccountId.mockReturnValue("app-account-1");
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos" } }),
    );

    render(<Layout />);

    expect(mocked.readStoredPosAppAccountId).toHaveBeenCalled();
    expect(mocked.usePosTerminalAppSessionRecovery).toHaveBeenCalledWith({
      routeIntent: "pos_hub",
      isAppUserMissing: true,
      localEntryContext,
      storedAppAccountId: "app-account-1",
    });
    expect(screen.queryByTestId("authed-outlet")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "POS terminal recovery in progress",
      }),
    ).toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("uses the browser POS register pathname when the router path is temporarily unknown", () => {
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue(
      readyLocalPosEntryContext("osu"),
    );
    mocked.usePosTerminalAppSessionRecovery.mockReturnValue(
      recoveryState("recoverable"),
    );
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/" } }),
    );
    window.history.replaceState({}, "", "/wigclub/store/osu/pos/register");

    render(<Layout />);

    expect(screen.queryByTestId("authed-outlet")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sign in required" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
    expect(mocked.useLocalPosEntryContext).toHaveBeenCalledWith({
      routeParams: { orgUrlSlug: "wigclub", storeUrlSlug: "osu" },
    });
  });

  it("keeps the POS shell loading while terminal continuity is still being classified", () => {
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue({ status: "loading" });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos/register" } }),
    );

    render(<Layout />);

    expect(screen.queryByTestId("authed-outlet")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "POS terminal recovery in progress",
      }),
    ).toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("keeps recoverable app-session drift from mounting fullscreen outlets before sign-in", () => {
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue(readyLocalPosEntryContext());
    mocked.usePosTerminalAppSessionRecovery.mockReturnValue(
      recoveryState("recoverable"),
    );
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos/register" } }),
    );
    mocked.OutletComponent = FullscreenOutlet;

    render(<Layout />);

    expect(screen.queryByTestId("fullscreen-outlet")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sign in required" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
  });

  it("renders the authed shell once the user is available", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1" },
      isLoading: false,
    });

    render(<Layout />);

    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("app-sidebar")).toHaveAttribute(
      "data-shell-variant",
      "contained",
    );
    expect(mocked.SidebarProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        className:
          "fixed inset-0 h-svh !min-h-0 flex-col overflow-hidden bg-app-canvas",
      }),
    );
    expect(screen.getByTestId("app-header")).toBeInTheDocument();
    expect(screen.getByTestId("app-header").parentElement).toHaveClass(
      "min-w-0",
      "overflow-hidden",
      "rounded-lg",
      "px-layout-xs",
      "py-layout-2xs",
    );
    expect(screen.getByTestId("app-header").parentElement).not.toHaveClass(
      "bg-background/90",
      "border",
    );
    expect(
      screen.getByTestId("app-header").parentElement?.parentElement,
    ).toHaveClass(
      "flex-1",
      "justify-start",
      "overflow-hidden",
      "px-0",
      "sm:px-layout-sm",
    );
    expect(
      screen.getByTestId("app-header").parentElement?.parentElement,
    ).not.toHaveClass(
      "md:w-[var(--topbar-sidebar-width)]",
      "md:px-layout-xl",
      "transition-[width]",
    );
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("store-modal")).toBeInTheDocument();
    expect(screen.getByTestId("organization-modal")).toBeInTheDocument();
    expect(screen.getByTestId("authed-outlet")).toBeInTheDocument();
  });

  it("keeps the contained app header independent of the collapsed sidebar state", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1" },
      isLoading: false,
    });
    mocked.useSidebar.mockReturnValue({
      isMobile: false,
      setOpenMobile: mocked.setOpenMobile,
      state: "collapsed",
    });

    render(<Layout />);

    const headerCell = screen.getByTestId("app-header").parentElement
      ?.parentElement as HTMLElement;

    expect(headerCell).toHaveClass("min-w-0", "flex-1", "justify-start");
    expect(headerCell).not.toHaveClass("w-auto", "shrink-0");
    expect(headerCell).not.toHaveClass(
      "md:w-[var(--topbar-sidebar-width)]",
      "transition-[width]",
    );
    expect(headerCell.style.getPropertyValue("--topbar-sidebar-width")).toBe(
      "",
    );
  });

  it("keeps the Remote Assist runtime mounted on non-POS store workspace routes when a terminal seed is ready", () => {
    const localEntryContext = readyLocalPosEntryContext();
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue(localEntryContext);
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({
        location: {
          pathname: "/wigclub/store/wigclub/operations/open-work",
        },
      }),
    );

    render(<Layout />);

    expect(screen.getByTestId("pos-remote-assist-host")).toBeInTheDocument();
    expect(mocked.PosRemoteAssistRuntimeHost).toHaveBeenCalledWith(
      expect.objectContaining({
        entryContext: localEntryContext,
      }),
      expect.anything(),
    );
    expect(mocked.useLocalPosEntryContext).toHaveBeenCalledWith({
      routeParams: { orgUrlSlug: "wigclub", storeUrlSlug: "wigclub" },
    });
  });

  it("does not mount the Remote Assist runtime on non-terminal browser sessions", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue({ status: "missing_seed" });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({
        location: {
          pathname: "/wigclub/store/wigclub/operations/open-work",
        },
      }),
    );

    render(<Layout />);

    expect(
      screen.queryByTestId("pos-remote-assist-host"),
    ).not.toBeInTheDocument();
  });

  it("does not dismiss the mobile sidebar on the initial authed shell render", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1" },
      isLoading: false,
    });
    mocked.useSidebar.mockReturnValue({
      isMobile: true,
      setOpenMobile: mocked.setOpenMobile,
      state: "expanded",
    });

    render(<Layout />);

    expect(mocked.setOpenMobile).not.toHaveBeenCalled();
  });

  it("dismisses the mobile sidebar after the route changes", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1" },
      isLoading: false,
    });
    mocked.useSidebar.mockReturnValue({
      isMobile: true,
      setOpenMobile: mocked.setOpenMobile,
      state: "expanded",
    });
    let pathname = "/wigclub/store/wigclub/products";
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname } }),
    );

    const { rerender } = render(<Layout />);
    expect(mocked.setOpenMobile).not.toHaveBeenCalled();

    pathname = "/wigclub/store/wigclub/operations";
    rerender(<Layout />);

    expect(mocked.setOpenMobile).toHaveBeenCalledWith(false);
  });

  it("leaves the desktop sidebar state alone after the route changes", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1" },
      isLoading: false,
    });
    mocked.useSidebar.mockReturnValue({
      isMobile: false,
      setOpenMobile: mocked.setOpenMobile,
      state: "expanded",
    });
    let pathname = "/wigclub/store/wigclub/products";
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname } }),
    );

    const { rerender } = render(<Layout />);

    pathname = "/wigclub/store/wigclub/operations";
    rerender(<Layout />);

    expect(mocked.setOpenMobile).not.toHaveBeenCalled();
  });

  it("mounts the signed-in POS register through the POS-only shell when a terminal seed is ready", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "cashier@example.com" },
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue(readyLocalPosEntryContext());
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos/register" } }),
    );

    render(<Layout />);

    expect(screen.getByTestId("authed-outlet")).toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("store-modal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("organization-modal")).not.toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("mounts the signed-in POS expense register through the POS-only shell when a terminal seed is ready", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "cashier@example.com" },
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue(readyLocalPosEntryContext());
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos/expense" } }),
    );

    render(<Layout />);

    expect(screen.getByTestId("authed-outlet")).toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("store-modal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("organization-modal")).not.toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ["/wigclub/store/wigclub/pos", "POS hub"],
    ["/wigclub/store/wigclub/pos/register", "POS register child"],
    ["/wigclub/store/wigclub/pos/sessions", "POS sessions child"],
    ["/wigclub/store/wigclub/pos/expense", "POS expense child"],
    ["/wigclub/store/wigclub/pos/expense-reports", "POS expense reports child"],
    [
      "/wigclub/store/wigclub/pos/transactions/transaction-1",
      "POS transaction child",
    ],
    ["/wigclub/store/wigclub/pos/terminals", "POS terminal health child"],
    [
      "/wigclub/store/wigclub/pos/terminals/terminal-1",
      "POS terminal health detail child",
    ],
  ])(
    "renders the POS sign-in gate for recoverable app-session drift on the %s route",
    (pathname) => {
      mocked.useAuth.mockReturnValue({
        user: null,
        isLoading: false,
      });
      mocked.useLocalPosEntryContext.mockReturnValue(
        readyLocalPosEntryContext(),
      );
      mocked.usePosTerminalAppSessionRecovery.mockReturnValue(
        recoveryState("recoverable"),
      );
      mocked.useRouterState.mockImplementation(({ select }) =>
        select({ location: { pathname } }),
      );

      render(<Layout />);

      expect(screen.queryByTestId("authed-outlet")).not.toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Sign in required" }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
      expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /sign out/i }),
      ).not.toBeInTheDocument();
      expect(mocked.navigate).not.toHaveBeenCalled();
      expect(mocked.useLocalPosEntryContext).toHaveBeenCalledWith({
        routeParams: { orgUrlSlug: "wigclub", storeUrlSlug: "wigclub" },
      });
    },
  );

  it.each(["idle", "validating", "retrying"])(
    "keeps POS mutations paused while app-session recovery is %s",
    (status) => {
      mocked.useAuth.mockReturnValue({
        user: null,
        isLoading: false,
      });
      mocked.useLocalPosEntryContext.mockReturnValue(
        readyLocalPosEntryContext(),
      );
      mocked.usePosTerminalAppSessionRecovery.mockReturnValue(
        recoveryState(status),
      );
      mocked.useRouterState.mockImplementation(({ select }) =>
        select({
          location: { pathname: "/wigclub/store/wigclub/pos/register" },
        }),
      );

      render(<Layout />);

      expect(screen.queryByTestId("authed-outlet")).not.toBeInTheDocument();
      expect(
        screen.getByRole("heading", {
          name: "POS terminal recovery in progress",
        }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
      expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
      expect(mocked.navigate).not.toHaveBeenCalled();
    },
  );

  it("renders the POS shell while app-session recovery waits for network with local continuity evidence", () => {
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue(readyLocalPosEntryContext());
    mocked.usePosTerminalAppSessionRecovery.mockReturnValue(
      recoveryState("waiting_for_network"),
    );
    mocked.readStoredPosAppAccountId.mockReturnValue("stored-app-user-1");
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos/register" } }),
    );

    render(<Layout />);

    expect(screen.getByTestId("authed-outlet")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "POS terminal recovery waiting for network",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ["/wigclub/store/wigclub/products", "Products"],
    ["/wigclub/store/wigclub/services", "Services"],
    ["/wigclub/store/wigclub/operations", "Operations"],
    ["/wigclub/store/wigclub/cash-controls", "Cash Controls"],
    ["/wigclub/admin", "Admin"],
    ["/wigclub/store/wigclub/settings", "Store Settings"],
  ])(
    "redirects %s when the app session is gone even if a POS terminal seed exists",
    async (pathname) => {
      mocked.useAuth.mockReturnValue({
        user: null,
        isLoading: false,
      });
      mocked.useLocalPosEntryContext.mockReturnValue(
        readyLocalPosEntryContext(),
      );
      mocked.useRouterState.mockImplementation(({ select }) =>
        select({ location: { pathname } }),
      );

      const { container } = render(<Layout />);

      expect(container).toBeEmptyDOMElement();
      await waitFor(() =>
        expect(mocked.navigate).toHaveBeenCalledWith({ to: "/login" }),
      );
    },
  );

  it("redirects signed-out POS routes to login with the original POS path", async () => {
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue(readyLocalPosEntryContext());
    mocked.usePosTerminalAppSessionRecovery.mockReturnValue(
      recoveryState("not_recoverable"),
    );
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({
        location: { pathname: "/wigclub/store/wigclub/pos/register" },
      }),
    );

    const { container } = render(<Layout />);

    expect(container).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(mocked.navigate).toHaveBeenCalledWith({
        to: "/login",
        search: { redirectTo: "/wigclub/store/wigclub/pos/register" },
      }),
    );
  });

  it("keeps query parameters for signed-out POS redirects on matched router paths", async () => {
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue(readyLocalPosEntryContext());
    mocked.usePosTerminalAppSessionRecovery.mockReturnValue(
      recoveryState("not_recoverable"),
    );
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({
        location: { pathname: "/wigclub/store/wigclub/pos/register" },
      }),
    );
    window.history.replaceState(
      {},
      "",
      "/wigclub/store/wigclub/pos/register?drawer=front",
    );

    const { container } = render(<Layout />);

    expect(container).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(mocked.navigate).toHaveBeenCalledWith({
        to: "/login",
        search: {
          redirectTo: "/wigclub/store/wigclub/pos/register?drawer=front",
        },
      }),
    );
  });

  it("uses the browser pathname for signed-out POS redirects while the router path is unknown", async () => {
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue(readyLocalPosEntryContext());
    mocked.usePosTerminalAppSessionRecovery.mockReturnValue(
      recoveryState("not_recoverable"),
    );
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/" } }),
    );
    window.history.replaceState(
      {},
      "",
      "/wigclub/store/wigclub/pos/register?drawer=front",
    );

    const { container } = render(<Layout />);

    expect(container).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(mocked.navigate).toHaveBeenCalledWith({
        to: "/login",
        search: {
          redirectTo: "/wigclub/store/wigclub/pos/register?drawer=front",
        },
      }),
    );
  });

  it("renders a safe blocked POS shell when terminal continuity is not recoverable", () => {
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue({ status: "missing_seed" });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos/register" } }),
    );

    render(<Layout />);

    expect(
      screen.getByRole("heading", { name: "POS terminal setup needed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This checkout station is not connected to a register for this store. Reconnect this register from POS Settings before using checkout.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("renders safe blocked POS shell copy when app-session recovery is blocked", () => {
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue(readyLocalPosEntryContext());
    mocked.usePosTerminalAppSessionRecovery.mockReturnValue({
      assertion: null,
      reason: "terminal_revoked",
      status: "blocked",
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos/register" } }),
    );
    window.history.replaceState(
      {},
      "",
      "/wigclub/store/wigclub/pos/register?drawer=front",
    );

    render(<Layout />);

    expect(
      screen.getByRole("heading", {
        name: "POS terminal recovery unavailable",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This checkout station cannot reopen the register. Sign in again or reconnect this register from POS Settings before using checkout.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Sign in to POS" }),
    ).toHaveAttribute(
      "href",
      "/login?redirectTo=%2Fwigclub%2Fstore%2Fwigclub%2Fpos%2Fregister%3Fdrawer%3Dfront",
    );
    expect(screen.queryByText(/terminal_revoked/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("does not expose raw backend details in a blocked POS shell", () => {
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });
    mocked.useLocalPosEntryContext.mockReturnValue({
      status: "unsupported_schema",
      message: "[CONVEX] raw backend details that should never be rendered",
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos/register" } }),
    );

    render(<Layout />);

    expect(
      screen.getByRole("heading", { name: "POS terminal update needed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This checkout station's local POS setup needs to be refreshed before checkout can continue.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\[CONVEX\]/)).not.toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("signs out from the user menu", async () => {
    const user = userEvent.setup();

    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "kwami.nuh@gmail.com" },
      isLoading: false,
    });

    render(<Layout />);

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(mocked.signOut).toHaveBeenCalled());
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(
      LOGGED_IN_USER_ID_KEY,
    );
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(
      POS_APP_ACCOUNT_ID_KEY,
    );
    expect(mocked.navigate).toHaveBeenCalledWith({ to: "/login" });
  });

  it("places an icon-only theme toggle after the account menu", async () => {
    const user = userEvent.setup();

    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === ATHENA_THEME_STORAGE_KEY ? "light" : null,
    );
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });

    render(<Layout />);

    expect(
      screen.queryByRole("button", { name: "Light" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Dark" }),
    ).not.toBeInTheDocument();

    const accountMenuButton = screen.getByRole("button", {
      name: "Open account menu for operator@example.com",
    });
    const themeToggleButton = screen.getByRole("button", {
      name: "Switch to system theme",
    });

    expect(accountMenuButton).toHaveClass(
      "h-10",
      "w-10",
      "sm:h-9",
      "sm:w-auto",
      "rounded-lg",
      "border",
      "shadow-surface",
    );
    expect(themeToggleButton).toHaveClass(
      "h-10",
      "w-10",
      "sm:h-9",
      "sm:w-9",
      "rounded-lg",
      "border",
      "shadow-surface",
    );
    expect(themeToggleButton.parentElement).not.toHaveClass("border");
    expect(
      accountMenuButton.compareDocumentPosition(themeToggleButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(themeToggleButton.querySelector(".lucide-sun")).not.toBeNull();

    await user.click(themeToggleButton);
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(
      ATHENA_THEME_STORAGE_KEY,
    );
  });

  it("cycles theme modes through system, light, and dark based on the device theme", async () => {
    const user = userEvent.setup();

    installMatchMedia(true);
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });

    render(<Layout />);

    const themeToggleButton = screen.getByRole("button", {
      name: "Using system dark theme, switch to light theme",
    });

    await waitFor(() =>
      expect(themeToggleButton.querySelector(".lucide-monitor")).not.toBeNull(),
    );

    await user.click(themeToggleButton);

    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      ATHENA_THEME_STORAGE_KEY,
      "light",
    );

    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === ATHENA_THEME_STORAGE_KEY ? "light" : null,
    );
    await act(async () => {
      window.dispatchEvent(new Event("athena-theme-change"));
    });

    const lightToggleButton = await screen.findByRole("button", {
      name: "Switch to dark theme",
    });
    expect(lightToggleButton.querySelector(".lucide-sun")).not.toBeNull();

    await user.click(lightToggleButton);

    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      ATHENA_THEME_STORAGE_KEY,
      "dark",
    );

    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === ATHENA_THEME_STORAGE_KEY ? "dark" : null,
    );
    await act(async () => {
      window.dispatchEvent(new Event("athena-theme-change"));
    });

    const darkToggleButton = await screen.findByRole("button", {
      name: "Switch to system theme",
    });
    expect(darkToggleButton.querySelector(".lucide-moon")).not.toBeNull();

    await user.click(darkToggleButton);

    expect(window.localStorage.removeItem).toHaveBeenCalledWith(
      ATHENA_THEME_STORAGE_KEY,
    );
  });

  it("shows the phone icon for system theme on mobile viewports", async () => {
    setViewportWidth(390);
    installMatchMedia(false);
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });

    render(<Layout />);

    const themeToggleButton = screen.getByRole("button", {
      name: "Using system light theme, switch to dark theme",
    });

    await waitFor(() =>
      expect(themeToggleButton.querySelector(".lucide-smartphone")).not.toBeNull(),
    );
  });

  it("keeps the account email visible while manager elevation is active", async () => {
    const user = userEvent.setup();
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    mocked.useManagerElevation.mockReturnValue({
      activeElevation: {
        displayName: "Adjoa Mensah",
        startedAt: 123,
        staffProfileId: "staff-manager-1",
      },
      endManagerElevation: mocked.endManagerElevation,
      isManagerElevated: true,
      startManagerElevation: mocked.startManagerElevation,
    });

    render(<Layout />);

    expect(screen.getByText("operator@example.com")).toBeInTheDocument();
    expect(
      screen.getByText("Elevated session: Adjoa Mensah"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /end manager elevation/i }),
    );

    expect(mocked.endManagerElevation).toHaveBeenCalled();
  });

  it("starts manager elevation from the user menu", async () => {
    const user = userEvent.setup();
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });

    render(<Layout />);

    await user.click(
      screen.getByRole("button", { name: /start manager elevation/i }),
    );

    expect(mocked.startManagerElevation).toHaveBeenCalled();
  });

  it("hides manager elevation start for full-admin accounts", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "admin@example.com" },
      isLoading: false,
    });
    mocked.usePermissions.mockReturnValue({
      hasFullAdminAccess: true,
    });

    render(<Layout />);

    expect(
      screen.queryByRole("button", { name: /start manager elevation/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
  });

  it.each([
    ["/wigclub/store/wigclub/pos/register", "POS register"],
    ["/wigclub/store/wigclub/pos/expense", "POS expense register"],
  ])("starts fullscreen when the %s route becomes active", (pathname) => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({
        location: { pathname },
      }),
    );

    render(<Layout />);

    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(screen.getByTestId("authed-outlet").closest("main")).toHaveClass(
      "box-border",
      "h-full",
      "overflow-hidden",
    );
  });

  it.each([
    ["/wigclub/store/wigclub/pos/register", "POS register"],
    ["/wigclub/store/wigclub/pos/expense", "POS expense register"],
  ])(
    "starts fullscreen from the browser pathname on first %s render",
    (browserPathname) => {
      mocked.useAuth.mockReturnValue({
        user: { _id: "user-1", email: "operator@example.com" },
        isLoading: false,
      });
      mocked.useRouterState.mockImplementation(({ select }) =>
        select({ location: { pathname: "/" } }),
      );
      window.history.replaceState({}, "", browserPathname);

      render(<Layout />);

      expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
      expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    },
  );

  it("toggles the mounted register flow with F", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({
        location: { pathname: "/wigclub/store/wigclub/pos/register" },
      }),
    );
    mocked.OutletComponent = FullscreenOutlet;

    render(<Layout />);

    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "f" });

    expect(screen.getByTestId("app-header")).toBeInTheDocument();
    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "F" });

    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
  });

  it("uses the route default again after toggling away and returning to the register flow", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    let pathname = "/wigclub/store/wigclub/pos/register";
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname } }),
    );
    mocked.OutletComponent = FullscreenOutlet;

    const { rerender } = render(<Layout />);

    fireEvent.keyDown(document, { key: "f" });
    expect(screen.getByTestId("app-header")).toBeInTheDocument();

    pathname = "/wigclub/store/wigclub/pos";
    rerender(<Layout />);
    expect(screen.getByTestId("app-header")).toBeInTheDocument();

    pathname = "/wigclub/store/wigclub/pos/register";
    rerender(<Layout />);
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
  });

  it("shows the global nav after leaving the register flow even if the browser pathname is stale", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos" } }),
    );
    window.history.replaceState({}, "", "/wigclub/store/wigclub/pos/register");

    render(<Layout />);

    expect(screen.getByTestId("app-header")).toBeInTheDocument();
  });

  it("keeps F available for typing while the register flow is mounted", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({
        location: { pathname: "/wigclub/store/wigclub/pos/register" },
      }),
    );
    mocked.OutletComponent = FullscreenOutlet;

    render(<Layout />);

    const input = document.createElement("input");
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: "f" });

    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();

    input.remove();
  });

  it("does not toggle fullscreen outside the register flow without a mounted fullscreen outlet", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });

    render(<Layout />);

    fireEvent.keyDown(document, { key: "f" });

    expect(screen.getByTestId("app-header")).toBeInTheDocument();
  });
});
