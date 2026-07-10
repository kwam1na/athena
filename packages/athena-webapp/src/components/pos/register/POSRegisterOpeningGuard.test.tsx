import { act, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POSRegisterOpeningGuard } from "./POSRegisterOpeningGuard";

const useQueryMock = vi.fn();
const getActiveStoreMock = vi.fn();
const startStoreDayMock = vi.fn();
const authenticateStaffCredentialMock = vi.fn();
const refreshTerminalStaffAuthorityMock = vi.fn();
const useLocalPosEntryContextMock = vi.fn();
const useLocalPosReadinessMock = vi.fn();
const clearIndexedDbPosLocalStoreMock = vi.fn();
const reloadWindowMock = vi.fn();
const replaceStaffAuthoritySnapshotMock = vi.fn();
const writeStoreDayReadinessMock = vi.fn();

vi.mock("@/components/pos/CashierAuthDialog", () => ({
  CashierAuthDialog: ({
    onAuthenticated,
    open,
  }: {
    onAuthenticated: (result: { staffProfileId: string }) => void;
    open: boolean;
  }) =>
    open ? (
      <div role="dialog" aria-label="Sign in required">
        <button
          type="button"
          onClick={() => {
            onAuthenticated({ staffProfileId: "staff-1" });
          }}
        >
          Confirm cashier
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/staff-auth/StaffAuthenticationDialog", () => ({
  StaffAuthenticationDialog: ({
    onAuthenticate,
    onAuthenticated,
    open,
  }: {
    onAuthenticate: (args: {
      pinHash: string;
      username: string;
    }) => Promise<unknown>;
    onAuthenticated: (result: { staffProfileId: string }) => void;
    open: boolean;
  }) =>
    open ? (
      <div role="dialog" aria-label="Confirm staff credentials">
        <button
          type="button"
          onClick={async () => {
            await onAuthenticate({
              pinHash: "hashed-pin",
              username: "frontdesk",
            });
            onAuthenticated({ staffProfileId: "staff-1" });
          }}
        >
          Confirm staff
        </button>
      </div>
    ) : null,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    params,
    to,
  }: {
    children?: React.ReactNode;
    className?: string;
    params?: Record<string, string>;
    to: string;
  }) => {
    const href = to
      .replace("$orgUrlSlug", params?.orgUrlSlug ?? "")
      .replace("$storeUrlSlug", params?.storeUrlSlug ?? "");

    return (
      <a className={className} href={href}>
        {children}
      </a>
    );
  },
  useParams: () => ({
    orgUrlSlug: "wigclub",
    storeUrlSlug: "wigclub",
  }),
}));

vi.mock("@/components/View", () => ({
  default: ({
    children,
    className,
    contentClassName,
    header,
    lockDocumentScroll,
  }: {
    children?: React.ReactNode;
    className?: string;
    contentClassName?: string;
    header?: React.ReactNode;
    lockDocumentScroll?: boolean;
  }) => (
    <div
      className={className}
      data-content-class={contentClassName}
      data-lock-document-scroll={lockDocumentScroll ? "true" : "false"}
      data-testid="view-root"
    >
      {header}
      {children}
    </div>
  ),
}));

vi.mock("@/components/common/FadeIn", () => ({
  FadeIn: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/common/PageHeader", () => ({
  ComposedPageHeader: ({
    leadingContent,
  }: {
    leadingContent?: React.ReactNode;
  }) => <div>{leadingContent}</div>,
}));

vi.mock("convex/react", () => ({
  useMutation: (mutationName: string) => {
    if (mutationName === "authenticateStaffCredential") {
      return authenticateStaffCredentialMock;
    }
    if (mutationName === "refreshTerminalStaffAuthority") {
      return refreshTerminalStaffAuthorityMock;
    }

    return startStoreDayMock;
  },
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => getActiveStoreMock(),
}));

vi.mock("@/lib/pos/infrastructure/local/localPosEntryContext", () => ({
  useLocalPosEntryContext: () => useLocalPosEntryContextMock(),
}));

vi.mock("@/lib/pos/infrastructure/local/localPosReadiness", () => ({
  useLocalPosReadiness: (...args: unknown[]) =>
    useLocalPosReadinessMock(...args),
}));

vi.mock("@/lib/navigationUtils", () => ({
  reloadWindow: () => reloadWindowMock(),
}));

vi.mock("@/lib/pos/infrastructure/local/posLocalStore", () => ({
  clearIndexedDbPosLocalStore: (...args: unknown[]) =>
    clearIndexedDbPosLocalStoreMock(...args),
  createIndexedDbPosLocalStorageAdapter: vi.fn(() => ({})),
  createPosLocalStore: vi.fn(() => ({
    replaceStaffAuthoritySnapshot: replaceStaffAuthoritySnapshotMock,
    writeStoreDayReadiness: writeStoreDayReadinessMock,
  })),
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    operations: {
      dailyClose: {
        getDailyCloseSnapshot: "getDailyCloseSnapshot",
      },
      dailyOpening: {
        getDailyOpeningSnapshot: "getDailyOpeningSnapshot",
        startStoreDay: "startStoreDay",
      },
      staffCredentials: {
        authenticateStaffCredential: "authenticateStaffCredential",
        refreshTerminalStaffAuthority: "refreshTerminalStaffAuthority",
      },
    },
  },
}));

describe("POSRegisterOpeningGuard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 9, 12));
    vi.clearAllMocks();
    startStoreDayMock.mockResolvedValue({
      data: { action: "started" },
      kind: "ok",
    });
    writeStoreDayReadinessMock.mockResolvedValue({
      ok: true,
      value: {
        storeId: "store-1",
        operatingDate: "2026-05-09",
        status: "started",
        source: "local",
        updatedAt: new Date(2026, 4, 9, 12).getTime(),
      },
    });
    authenticateStaffCredentialMock.mockResolvedValue({
      data: {
        activeRoles: ["cashier"],
        staffProfile: { fullName: "Ama Mensah" },
        staffProfileId: "staff-1",
      },
      kind: "ok",
    });
    refreshTerminalStaffAuthorityMock.mockResolvedValue({
      data: [],
      kind: "ok",
    });
    clearIndexedDbPosLocalStoreMock.mockResolvedValue({
      ok: true,
      value: null,
    });
    reloadWindowMock.mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    replaceStaffAuthoritySnapshotMock.mockResolvedValue({
      ok: true,
      value: [],
    });
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
      },
      isLoadingStores: false,
    });
    useLocalPosEntryContextMock.mockReturnValue({
      status: "ready",
      orgUrlSlug: "wigclub",
      storeUrlSlug: "wigclub",
      storeId: "store-1",
      terminalSeed: null,
      source: "live",
    });
    useLocalPosReadinessMock.mockReturnValue({
      status: "ready",
      source: "live",
      storeDayStatus: "started",
    });
    useQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "getDailyOpeningSnapshot") {
        return { status: "started" };
      }

      if (queryName === "getDailyCloseSnapshot") {
        return { status: "ready" };
      }

      return undefined;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the register when the store day has started", () => {
    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.getByText("Register workspace")).toBeInTheDocument();
    expect(useQueryMock).toHaveBeenCalledWith(
      "getDailyOpeningSnapshot",
      expect.objectContaining({
        operatingDate: "2026-05-09",
        storeId: "store-1",
      }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(
      "getDailyCloseSnapshot",
      expect.objectContaining({
        operatingDate: "2026-05-09",
        storeId: "store-1",
      }),
    );
  });

  it("shows the POS shell while local readiness is loading", () => {
    useLocalPosReadinessMock.mockReturnValue({
      status: "loading",
      diagnostics: {
        stage: "reading_local_store",
        stateKey: "store-1:2026-05-09:no-terminal",
      },
    });
    useQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "getDailyOpeningSnapshot") {
        return { status: "started" };
      }

      if (queryName === "getDailyCloseSnapshot") {
        return undefined;
      }

      return undefined;
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.queryByText("Register workspace")).not.toBeInTheDocument();
    expect(screen.getByTestId("view-root")).toHaveClass("bg-transparent");
    expect(screen.getByTestId("view-root")).toHaveAttribute(
      "data-lock-document-scroll",
      "false",
    );
    expect(screen.getByTestId("view-root")).toHaveAttribute(
      "data-content-class",
      expect.stringContaining("bg-surface"),
    );
    expect(screen.getByText("POS")).toBeInTheDocument();
    expect(screen.getByText("Checking this register")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Athena is confirming the store day and local register state before checkout opens.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Day close")).toBeInTheDocument();
    expect(
      screen.getByText("Checking whether the day is already closed."),
    ).toBeInTheDocument();
    expect(screen.getByText("Local register state")).toBeInTheDocument();
    expect(
      screen.getByText("Reading saved register state on this device."),
    ).toBeInTheDocument();
  });

  it("shows terminal recovery when the local register read times out", () => {
    useLocalPosReadinessMock.mockReturnValue({
      status: "blocked",
      reason: "local_store_unavailable",
      message:
        "Local register state could not be read in time. Clear and reprovision this terminal before continuing.",
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.queryByText("Register workspace")).not.toBeInTheDocument();
    expect(screen.getByText("POS setup required")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Local register state could not be read in time. Clear and reprovision this terminal before continuing.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear and reprovision terminal" }),
    ).toBeInTheDocument();
  });

  it("shows a blocked state when the store day has not started", () => {
    useQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "getDailyOpeningSnapshot") {
        return { status: "ready" };
      }

      if (queryName === "getDailyCloseSnapshot") {
        return { status: "ready" };
      }

      return undefined;
    });
    useLocalPosReadinessMock.mockReturnValue({
      status: "blocked",
      reason: "not_started",
      message:
        "Store day not started. Complete Opening Handoff before starting sales.",
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.queryByText("Register workspace")).not.toBeInTheDocument();
    expect(screen.getByTestId("view-root")).toHaveClass("bg-transparent");
    expect(screen.getByText("Store day not started")).toBeInTheDocument();
    expect(
      screen.getByText("Start the store day to begin POS sales."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start day/i })).toBeEnabled();
    expect(
      screen.getByRole("link", { name: /Opening Handoff/i }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/wigclub/operations/opening",
    );
  });

  it("refreshes terminal staff authority while online so credentials are available offline", async () => {
    useLocalPosEntryContextMock.mockReturnValue({
      status: "ready",
      orgUrlSlug: "wigclub",
      storeUrlSlug: "wigclub",
      storeId: "store-1",
      terminalSeed: {
        cloudTerminalId: "terminal-cloud-1",
        displayName: "Front register",
        provisionedAt: 1_778_000_000_000,
        schemaVersion: 1,
        storeId: "store-1",
        syncSecretHash: "secret-hash",
        terminalId: "terminal-1",
      },
      source: "live",
    });
    refreshTerminalStaffAuthorityMock.mockResolvedValue({
      data: [
        {
          activeRoles: ["cashier"],
          credentialId: "credential-1",
          credentialVersion: 1,
          displayName: "Ama Mensah",
          expiresAt: Date.now() + 10_000,
          issuedAt: Date.now(),
          organizationId: "org-1",
          refreshedAt: Date.now(),
          staffProfileId: "staff-1",
          status: "active",
          storeId: "store-1",
          terminalId: "terminal-cloud-1",
          username: "frontdesk",
          verifier: {
            algorithm: "PBKDF2-SHA256",
            hash: "hash",
            iterations: 120000,
            salt: "salt",
            version: 1,
          },
        },
      ],
      kind: "ok",
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refreshTerminalStaffAuthorityMock).toHaveBeenCalledWith({
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
    });
    expect(replaceStaffAuthoritySnapshotMock).toHaveBeenCalledWith({
      records: [
        expect.objectContaining({
          staffProfileId: "staff-1",
          username: "frontdesk",
        }),
      ],
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
    });
  });

  it("authenticates staff and starts the store day from the POS gate when opening is ready", async () => {
    useQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "getDailyOpeningSnapshot") {
        return { status: "ready" };
      }

      if (queryName === "getDailyCloseSnapshot") {
        return { status: "ready" };
      }

      return undefined;
    });
    useLocalPosReadinessMock.mockReturnValue({
      status: "blocked",
      reason: "not_started",
      message:
        "Store day not started. Complete Opening Handoff before starting sales.",
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start day/i }));
      await Promise.resolve();
    });

    expect(
      screen.getByRole("dialog", { name: "Confirm staff credentials" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Confirm staff/i }));
      await Promise.resolve();
    });

    expect(authenticateStaffCredentialMock).toHaveBeenCalledWith({
      allowedRoles: ["cashier", "manager"],
      pinHash: "hashed-pin",
      storeId: "store-1",
      username: "frontdesk",
    });
    expect(startStoreDayMock).toHaveBeenCalledWith({
      actorStaffProfileId: "staff-1",
      endAt: new Date(2026, 4, 10).getTime(),
      operatingDate: "2026-05-09",
      startAt: new Date(2026, 4, 9).getTime(),
      storeId: "store-1",
    });
  });

  it("starts the store day locally when Opening Handoff needs review so sales can continue", async () => {
    useQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "getDailyOpeningSnapshot") {
        return { status: "needs_attention" };
      }

      if (queryName === "getDailyCloseSnapshot") {
        return { status: "ready" };
      }

      return undefined;
    });
    useLocalPosReadinessMock.mockReturnValue({
      status: "blocked",
      reason: "not_started",
      canStartLocally: true,
      message:
        "Store day not started. Complete Opening Handoff before starting sales.",
    });
    useLocalPosEntryContextMock.mockReturnValue({
      status: "ready",
      orgUrlSlug: "wigclub",
      storeUrlSlug: "wigclub",
      storeId: "store-1",
      terminalSeed: {
        cloudTerminalId: "terminal-cloud-1",
        displayName: "Front register",
        provisionedAt: 1_778_000_000_000,
        schemaVersion: 1,
        storeId: "store-1",
        syncSecretHash: "secret-hash",
        terminalId: "terminal-1",
      },
      source: "local",
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.getByRole("button", { name: /Start day/i })).toBeEnabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start day/i }));
      await Promise.resolve();
    });

    expect(
      screen.getByRole("dialog", { name: "Sign in required" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Confirm cashier/i }));
      await Promise.resolve();
    });

    expect(writeStoreDayReadinessMock).toHaveBeenCalledWith({
      storeId: "store-1",
      operatingDate: "2026-05-09",
      status: "started",
      source: "local",
      updatedAt: new Date(2026, 4, 9, 12).getTime(),
    });
    expect(startStoreDayMock).not.toHaveBeenCalled();
    expect(screen.getByText("Register workspace")).toBeInTheDocument();
  });

  it("directs the operator to EOD Review when the store day is closed", () => {
    useQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "getDailyOpeningSnapshot") {
        return { status: "started" };
      }

      if (queryName === "getDailyCloseSnapshot") {
        return { status: "completed" };
      }

      return undefined;
    });
    useLocalPosReadinessMock.mockReturnValue({
      status: "blocked",
      reason: "closed",
      message:
        "Store day closed. Reopen the end of day review before entering POS.",
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.queryByText("Register workspace")).not.toBeInTheDocument();
    expect(screen.getByText("Store day closed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The end of day review has already closed this operating day. Reopen the day from the end of day review before entering POS.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /EOD Review/i }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/wigclub/operations/daily-close",
    );
  });

  it("allows POS when the active close was reopened and Opening Handoff is started", () => {
    useQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "getDailyOpeningSnapshot") {
        return { status: "started" };
      }

      if (queryName === "getDailyCloseSnapshot") {
        return {
          existingClose: { lifecycleStatus: "reopened" },
          status: "completed",
        };
      }

      return undefined;
    });
    useLocalPosReadinessMock.mockReturnValue({
      status: "ready",
      source: "live",
      storeDayStatus: "reopened",
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.getByText("Register workspace")).toBeInTheDocument();
    expect(screen.queryByText("Store day closed")).not.toBeInTheDocument();
  });

  it("renders the register from local readiness before the opening snapshot resolves", () => {
    useQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "getDailyCloseSnapshot") {
        return { status: "ready" };
      }

      return undefined;
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.getByText("Register workspace")).toBeInTheDocument();
  });

  it("renders the register from local readiness before the close snapshot resolves", () => {
    useQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "getDailyOpeningSnapshot") {
        return { status: "started" };
      }

      return undefined;
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.getByText("Register workspace")).toBeInTheDocument();
  });

  it("keeps a reloaded register route open from local entry context while live state rehydrates", () => {
    getActiveStoreMock.mockReturnValue({
      activeStore: null,
      isLoadingStores: false,
    });
    useLocalPosEntryContextMock.mockReturnValue({
      status: "ready",
      orgUrlSlug: "wigclub",
      storeUrlSlug: "wigclub",
      storeId: "store-from-local-seed",
      terminalSeed: {
        registeredAt: 1_778_000_000_000,
        registeredByUserId: "user-1",
        storeId: "store-from-local-seed",
        terminalId: "terminal-1",
      },
      source: "local",
    });
    useQueryMock.mockReturnValue(undefined);
    useLocalPosReadinessMock.mockImplementation((input) => {
      expect(input).toMatchObject({
        closeSnapshot: undefined,
        entryContext: {
          source: "local",
          status: "ready",
          storeId: "store-from-local-seed",
        },
        openingSnapshot: undefined,
        operatingDate: "2026-05-09",
      });

      return {
        status: "ready",
        source: "local",
        storeDayStatus: "started",
      };
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.getByText("Register workspace")).toBeInTheDocument();
    expect(useQueryMock).toHaveBeenCalledWith(
      "getDailyOpeningSnapshot",
      expect.objectContaining({
        operatingDate: "2026-05-09",
        storeId: "store-from-local-seed",
      }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(
      "getDailyCloseSnapshot",
      expect.objectContaining({
        operatingDate: "2026-05-09",
        storeId: "store-from-local-seed",
      }),
    );
  });

  it("clears local POS state from setup-required guidance", async () => {
    useLocalPosReadinessMock.mockReturnValue({
      status: "blocked",
      reason: "missing_seed",
      message: "POS setup required. Connect this terminal before starting sales.",
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.queryByText("Register workspace")).not.toBeInTheDocument();
    expect(screen.getByText("POS setup required")).toBeInTheDocument();
    expect(
      screen.getByText("POS setup required. Connect this terminal before starting sales."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear and reprovision terminal" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Clear and reprovision terminal" }),
    );

    await act(async () => {});

    expect(clearIndexedDbPosLocalStoreMock).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(
      "Local POS state cleared. Reopening terminal setup.",
    );
    expect(reloadWindowMock).toHaveBeenCalledTimes(1);
  });

  it("keeps setup-required guidance on-screen when local POS state cannot be cleared", async () => {
    clearIndexedDbPosLocalStoreMock.mockResolvedValue({
      ok: false,
      error: {
        code: "write_failed",
        message: "POS local state has sale records that may not be synced.",
      },
    });
    useLocalPosReadinessMock.mockReturnValue({
      status: "blocked",
      reason: "missing_seed",
      message: "POS setup required. Connect this terminal before starting sales.",
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Clear and reprovision terminal" }),
    );

    await act(async () => {});

    expect(clearIndexedDbPosLocalStoreMock).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "POS local state has sale records that may not be synced.",
    );
    expect(reloadWindowMock).not.toHaveBeenCalled();
    expect(screen.getByText("POS setup required")).toBeInTheDocument();
  });

  it("lets the register shell handle local drawer closeout recovery", () => {
    useLocalPosReadinessMock.mockReturnValue({
      status: "blocked",
      reason: "local_closeout",
      message:
        "Drawer closeout started. Reopen the drawer before starting sales.",
    });

    render(
      <POSRegisterOpeningGuard>
        <div>Register workspace</div>
      </POSRegisterOpeningGuard>,
    );

    expect(screen.getByText("Register workspace")).toBeInTheDocument();
    expect(screen.queryByText("POS setup required")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Drawer closeout started. Reopen the drawer before starting sales.",
      ),
    ).not.toBeInTheDocument();
  });
});
