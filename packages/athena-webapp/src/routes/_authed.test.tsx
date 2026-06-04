import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Layout from "./_authed";
import {
  LOGGED_IN_USER_ID_KEY,
  POS_APP_ACCOUNT_ID_KEY,
} from "@/lib/constants";
import { useAppShellFullscreenMode } from "@/contexts/AppShellFullscreenContext";

const mocked = vi.hoisted(() => ({
  OutletComponent: null as (() => ReactNode) | null,
  navigate: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  startManagerElevation: vi.fn(),
  endManagerElevation: vi.fn(),
  useAuth: vi.fn(),
  useLocalPosEntryContext: vi.fn(),
  useManagerElevation: vi.fn(),
  usePermissions: vi.fn(),
  usePosTerminalAppSessionRecovery: vi.fn(),
  readStoredPosAppAccountId: vi.fn(),
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

vi.mock(
  "@/lib/pos/infrastructure/terminal/usePosTerminalAppSessionRecovery",
  () => ({
    readStoredPosAppAccountId: mocked.readStoredPosAppAccountId,
    usePosTerminalAppSessionRecovery:
      mocked.usePosTerminalAppSessionRecovery,
  }),
);

vi.mock("../hooks/usePermissions", () => ({
  usePermissions: mocked.usePermissions,
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: mocked.signOut }),
}));

vi.mock("../contexts/PermissionsContext", () => ({
  PermissionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../contexts/ManagerElevationContext", () => ({
  ManagerElevationProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  useManagerElevation: mocked.useManagerElevation,
}));

vi.mock("../components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  SidebarInset: ({ children }: { children: ReactNode }) => <>{children}</>,
  SidebarTrigger: () => null,
  useSidebar: () => ({ state: "expanded" }),
}));

vi.mock("../components/app-sidebar", () => ({
  AppSidebar: () => <div data-testid="app-sidebar">Sidebar</div>,
}));

vi.mock("@/components/Navbar", () => ({
  AppHeader: () => <div data-testid="app-header">App header</div>,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect?: () => void;
  }) => <button onClick={onSelect}>{children}</button>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

describe("Authed layout", () => {
  beforeEach(() => {
    mocked.OutletComponent = null;
    window.history.replaceState({}, "", "/wigclub/store/wigclub/products");
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    vi.mocked(window.localStorage.getItem).mockReset();
    vi.mocked(window.localStorage.getItem).mockReturnValue(null);
    mocked.navigate.mockReset();
    mocked.signOut.mockClear();
    mocked.startManagerElevation.mockReset();
    mocked.endManagerElevation.mockReset();
    mocked.useAuth.mockReset();
    mocked.useLocalPosEntryContext.mockReset();
    mocked.useLocalPosEntryContext.mockReturnValue({ status: "missing_seed" });
    mocked.usePosTerminalAppSessionRecovery.mockReset();
    mocked.usePosTerminalAppSessionRecovery.mockReturnValue(
      recoveryState("idle"),
    );
    mocked.readStoredPosAppAccountId.mockReset();
    mocked.readStoredPosAppAccountId.mockReturnValue("stored-app-user-1");
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
    await waitFor(() => expect(mocked.navigate).toHaveBeenCalledWith({ to: "/login" }));
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

  it("renders the POS register shell for recoverable app-session drift without generic app chrome", () => {
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

    expect(screen.getByTestId("authed-outlet")).toBeInTheDocument();
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

    expect(screen.getByTestId("authed-outlet")).toBeInTheDocument();
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

  it("keeps the recoverable POS register child compatible with fullscreen outlets", () => {
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

    expect(screen.getByTestId("fullscreen-outlet")).toBeInTheDocument();
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
    expect(screen.getByTestId("app-header")).toBeInTheDocument();
    expect(screen.getByTestId("store-modal")).toBeInTheDocument();
    expect(screen.getByTestId("organization-modal")).toBeInTheDocument();
    expect(screen.getByTestId("authed-outlet")).toBeInTheDocument();
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
    "renders the POS shell for recoverable app-session drift on the %s route",
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

      expect(screen.getByTestId("authed-outlet")).toBeInTheDocument();
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

  it.each(["idle", "validating", "retrying", "waiting_for_network"])(
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
        select({ location: { pathname: "/wigclub/store/wigclub/pos/register" } }),
      );

      render(<Layout />);

      expect(screen.queryByTestId("authed-outlet")).not.toBeInTheDocument();
      expect(
        screen.getByRole("heading", {
          name:
            status === "waiting_for_network"
              ? "POS terminal recovery waiting for network"
              : "POS terminal recovery in progress",
        }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
      expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
      expect(mocked.navigate).not.toHaveBeenCalled();
    },
  );

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
      LOGGED_IN_USER_ID_KEY
    );
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(
      POS_APP_ACCOUNT_ID_KEY,
    );
    expect(mocked.navigate).toHaveBeenCalledWith({ to: "/login" });
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
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("starts fullscreen when the POS register route becomes active", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({
        location: { pathname: "/wigclub/store/wigclub/pos/register" },
      }),
    );

    render(<Layout />);

    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
  });

  it("starts fullscreen from the browser pathname on first register render", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/" } }),
    );
    window.history.replaceState({}, "", "/wigclub/store/wigclub/pos/register");

    render(<Layout />);

    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
  });

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

    fireEvent.keyDown(document, { key: "f" });

    expect(screen.getByTestId("app-header")).toBeInTheDocument();
    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "F" });

    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
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
