import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import { ok, userError } from "~/shared/commandResult";

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockStartSession = vi.fn();
const mockAddItem = vi.fn();
const mockHoldSession = vi.fn();
const mockCompleteTransaction = vi.fn();
const mockOpenDrawer = vi.fn();
const mockResumeSession = vi.fn();
const mockVoidSession = vi.fn();
const mockUpdateSession = vi.fn();
const mockSyncSessionCheckoutState = vi.fn();
const mockReleaseSessionInventoryHoldsAndDeleteItems = vi.fn();
const mockRemoveItem = vi.fn();
const mockBindSessionToRegisterSession = vi.fn();
const mockSubmitRegisterSessionCloseout = vi.fn();
const mockAuthenticateStaffCredentialForApproval = vi.fn();
const mockReopenRegisterSessionCloseout = vi.fn();
const mockCorrectRegisterSessionOpeningFloat = vi.fn();
const mockNavigateBack = vi.fn();
const mockUsePosLocalSyncRuntimeStatus = vi.fn();
const mockAppendLocalEvent = vi.fn();
const mockListLocalEvents = vi.fn();
const mockReadProvisionedTerminalSeed = vi.fn();
const mockGetStaffAuthorityReadiness = vi.fn();
const mockMarkLocalEventsSynced = vi.fn();
const mockWriteLocalCloudMapping = vi.fn();

let mockActiveStore: { _id: Id<"store">; currency: string } | null;
let mockTerminal:
  | {
      _id: Id<"posTerminal">;
      displayName: string;
      registerNumber?: string;
    }
  | null
  | undefined;
let mockRegisterState:
  | {
      phase: "requiresCashier" | "readyToStart" | "resumable" | "active";
      terminal: { _id: string; displayName: string } | null;
      cashier: {
        _id: string;
        firstName: string;
        lastName: string;
        activeRoles?: Array<
          "manager" | "front_desk" | "stylist" | "technician" | "cashier"
        >;
      } | null;
      activeRegisterSession: {
        _id: string;
        status: "open" | "active" | "closing" | "closed";
        terminalId?: string;
        registerNumber?: string;
        openingFloat: number;
        expectedCash: number;
        countedCash?: number;
        managerApprovalRequestId?: Id<"approvalRequest">;
        openedAt: number;
        notes?: string;
        variance?: number;
        workflowTraceId?: string;
      } | null;
      activeSession: { _id: string; sessionNumber: string } | null;
      activeSessionConflict?: {
        kind: "activeOnOtherTerminal";
        message: string;
        terminalId?: string;
      } | null;
      resumableSession: { _id: string; sessionNumber: string } | null;
    }
  | undefined;
let mockActiveSession:
  | {
      _id: Id<"posSession">;
      status: "active";
      expiresAt: number;
      sessionNumber: string;
      updatedAt: number;
      registerSessionId?: Id<"registerSession">;
      cartItems: Array<{
        id: Id<"posSessionItem">;
        name: string;
        barcode: string;
        price: number;
        quantity: number;
        productId: Id<"product">;
        skuId: Id<"productSku">;
      }>;
      payments?: Array<{
        method: "cash" | "card" | "mobile_money";
        amount: number;
        timestamp: number;
      }>;
      localSyncStatus?: {
        description?: string;
        label?: string;
        onRetrySync?: () => void;
        pendingEventCount?: number;
        reconciliationItems?: Array<{
          summary?: string;
          type?: string;
        }>;
        status:
          | "synced"
          | "syncing"
          | "pending_sync"
          | "locally_closed_pending_sync"
          | "needs_review";
      };
      customer: {
        _id: Id<"posCustomer">;
        name: string;
        email?: string;
        phone?: string;
        customerProfileId?: Id<"customerProfile">;
      } | null;
    }
  | null
  | undefined;
let mockHeldSessions:
  | Array<{
      _id: Id<"posSession">;
      expiresAt: number;
      sessionNumber: string;
      updatedAt: number;
      cartItems: [];
      customer: null;
    }>
  | undefined;
let mockBarcodeSearchResult: null;
let mockProductIdSearchResults: [] | null;
let mockCashier: { firstName: string; lastName: string } | null;
let mockUser: { _id: Id<"athenaUser"> } | null;
let mockRegisterCatalogRows: Array<{
  id: Id<"productSku">;
  productSkuId: Id<"productSku">;
  skuId: Id<"productSku">;
  productId: Id<"product">;
  name: string;
  sku: string;
  barcode: string;
  price: number;
  category: string;
  description: string;
  image: string | null;
  size: string;
  length: number | null;
  color: string;
  areProcessingFeesAbsorbed: boolean;
}>;
let mockRegisterCatalogAvailabilityRows: Array<{
  productSkuId: Id<"productSku">;
  skuId: Id<"productSku">;
  inStock: boolean;
  quantityAvailable: number;
}>;

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({
    orgUrlSlug: "wigclub",
    storeUrlSlug: "wigclub",
  }),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: mockActiveStore,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockUser,
  }),
}));

vi.mock("@/hooks/useGetTerminal", () => ({
  useGetTerminal: () => mockTerminal,
}));

vi.mock("@/hooks/use-navigate-back", () => ({
  useNavigateBack: () => mockNavigateBack,
}));

vi.mock("@/hooks/usePOSProducts", () => ({
  usePOSBarcodeSearch: () => mockBarcodeSearchResult,
  usePOSProductIdSearch: () => mockProductIdSearchResults,
}));

vi.mock("@/lib/pos/infrastructure/convex/catalogGateway", () => ({
  useConvexRegisterCatalog: () => mockRegisterCatalogRows,
  useConvexRegisterCatalogAvailability: () =>
    mockRegisterCatalogAvailabilityRows,
}));

vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: (value: string) => value,
}));

vi.mock("@/lib/pos/infrastructure/convex/registerGateway", () => ({
  useConvexRegisterState: () => mockRegisterState,
}));

vi.mock("@/lib/pos/infrastructure/convex/sessionGateway", () => ({
  useConvexActiveSession: () => mockActiveSession,
  useConvexHeldSessions: () => mockHeldSessions,
  useConvexSessionActions: () => ({
    resumeSession: mockResumeSession,
    voidSession: mockVoidSession,
    updateSession: mockUpdateSession,
    syncSessionCheckoutState: mockSyncSessionCheckoutState,
    releaseSessionInventoryHoldsAndDeleteItems:
      mockReleaseSessionInventoryHoldsAndDeleteItems,
    removeItem: mockRemoveItem,
    bindSessionToRegisterSession: mockBindSessionToRegisterSession,
  }),
}));

vi.mock("@/lib/pos/infrastructure/convex/commandGateway", () => ({
  useConvexCommandGateway: () => ({
    startSession: mockStartSession,
    addItem: mockAddItem,
    holdSession: mockHoldSession,
    completeTransaction: mockCompleteTransaction,
    openDrawer: mockOpenDrawer,
  }),
}));

vi.mock("@/lib/pos/infrastructure/local/usePosLocalSyncRuntime", () => ({
  usePosLocalSyncRuntimeStatus: (...args: unknown[]) =>
    mockUsePosLocalSyncRuntimeStatus(...args),
}));

vi.mock("@/lib/pos/infrastructure/local/posLocalStore", () => ({
  createIndexedDbPosLocalStorageAdapter: vi.fn(() => ({})),
  createPosLocalStore: vi.fn(() => ({
    appendEvent: mockAppendLocalEvent,
    attachStaffProofTokenToPendingEvents: vi.fn(async () => ({
      ok: true,
      value: 0,
    })),
    getStaffAuthorityReadiness: mockGetStaffAuthorityReadiness,
    listEvents: mockListLocalEvents,
    listEventsForUpload: mockListLocalEvents,
    readProvisionedTerminalSeed: mockReadProvisionedTerminalSeed,
    markEventsSynced: mockMarkLocalEventsSynced,
    writeLocalCloudMapping: mockWriteLocalCloudMapping,
  })),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function buildRegisterCatalogRow(
  overrides: Partial<(typeof mockRegisterCatalogRows)[number]> = {},
): (typeof mockRegisterCatalogRows)[number] {
  return {
    id: "sku-2" as Id<"productSku">,
    productSkuId: "sku-2" as Id<"productSku">,
    skuId: "sku-2" as Id<"productSku">,
    productId: "product-2" as Id<"product">,
    name: "Deep Wave",
    sku: "DW-18",
    barcode: "1234567890123",
    price: 10_000,
    category: "Hair",
    description: "Deep wave bundle",
    image: null,
    size: "18",
    length: 18,
    color: "natural",
    areProcessingFeesAbsorbed: false,
    ...overrides,
  };
}

function buildRegisterCatalogAvailabilityRow(
  overrides: Partial<(typeof mockRegisterCatalogAvailabilityRows)[number]> = {},
): (typeof mockRegisterCatalogAvailabilityRows)[number] {
  return {
    productSkuId: "sku-2" as Id<"productSku">,
    skuId: "sku-2" as Id<"productSku">,
    inStock: true,
    quantityAvailable: 5,
    ...overrides,
  };
}

describe("useRegisterViewModel", () => {
  beforeEach(() => {
    mockActiveStore = {
      _id: "store-1" as Id<"store">,
      currency: "GHS",
    };
    mockTerminal = {
      _id: "terminal-1" as Id<"posTerminal">,
      displayName: "Front Counter",
      registerNumber: "1",
    };
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
        notes: "Ready",
        workflowTraceId: "register_session:drawer-1",
      },
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = {
      _id: "session-1" as Id<"posSession">,
      status: "active",
      expiresAt: Date.now() + 60_000,
      sessionNumber: "POS-0001",
      updatedAt: Date.now(),
      registerSessionId: "drawer-1" as Id<"registerSession">,
      cartItems: [
        {
          id: "item-1" as Id<"posSessionItem">,
          name: "Body Wave",
          barcode: "1234567890",
          price: 120,
          quantity: 1,
          productId: "product-1" as Id<"product">,
          skuId: "sku-1" as Id<"productSku">,
        },
      ],
      customer: {
        _id: "customer-1" as Id<"posCustomer">,
        name: "Ama Serwa",
        email: "ama@example.com",
        phone: "555-0100",
        customerProfileId: "profile-1" as Id<"customerProfile">,
      },
    };
    mockHeldSessions = [];
    mockBarcodeSearchResult = null;
    mockProductIdSearchResults = null;
    mockCashier = {
      firstName: "Ama",
      lastName: "Kusi",
    };
    mockUser = {
      _id: "user-1" as Id<"athenaUser">,
    };
    mockRegisterCatalogRows = [];
    mockRegisterCatalogAvailabilityRows = [];
    localStorage.clear();

    mockUseQuery.mockImplementation(() => mockCashier);
    mockUsePosLocalSyncRuntimeStatus.mockReset();
    mockUsePosLocalSyncRuntimeStatus.mockReturnValue(null);
    mockAppendLocalEvent.mockReset();
    mockAppendLocalEvent.mockResolvedValue({
      ok: true,
      value: { localEventId: "local-event-1" },
    });
    mockListLocalEvents.mockReset();
    mockListLocalEvents.mockResolvedValue({ ok: true, value: [] });
    mockReadProvisionedTerminalSeed.mockReset();
    mockReadProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: {
        cloudTerminalId: "terminal-1",
        displayName: "Front Counter",
        provisionedAt: 1,
        schemaVersion: 1,
        syncSecretHash: "sync-secret-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
    });
    mockGetStaffAuthorityReadiness.mockReset();
    mockGetStaffAuthorityReadiness.mockResolvedValue({
      ok: true,
      value: "ready",
    });
    mockMarkLocalEventsSynced.mockReset();
    mockMarkLocalEventsSynced.mockResolvedValue({ ok: true, value: [] });
    mockWriteLocalCloudMapping.mockReset();
    mockWriteLocalCloudMapping.mockResolvedValue({ ok: true, value: {} });
    (globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB =
      {} as IDBFactory;
    mockUseMutation.mockReset();
    mockUseMutation.mockImplementation(
      () => (args: Record<string, unknown>) => {
        if ("actionKey" in args) {
          return mockAuthenticateStaffCredentialForApproval(args);
        }
        if ("countedCash" in args) {
          return mockSubmitRegisterSessionCloseout(args);
        }
        if ("correctedOpeningFloat" in args) {
          return mockCorrectRegisterSessionOpeningFloat(args);
        }
        return mockReopenRegisterSessionCloseout(args);
      },
    );
    mockSubmitRegisterSessionCloseout.mockReset();
    mockSubmitRegisterSessionCloseout.mockResolvedValue(
      ok({
        action: "closed",
      }),
    );
    mockAuthenticateStaffCredentialForApproval.mockReset();
    mockAuthenticateStaffCredentialForApproval.mockResolvedValue(
      ok({
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "staff-1" as Id<"staffProfile">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockReopenRegisterSessionCloseout.mockReset();
    mockReopenRegisterSessionCloseout.mockResolvedValue(
      ok({
        action: "reopened",
      }),
    );
    mockCorrectRegisterSessionOpeningFloat.mockReset();
    mockCorrectRegisterSessionOpeningFloat.mockResolvedValue(
      ok({
        action: "corrected",
      }),
    );
    mockStartSession.mockReset();
    mockStartSession.mockResolvedValue(
      ok({
        sessionId: "session-2" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockAddItem.mockReset();
    mockAddItem.mockResolvedValue(
      ok({
        itemId: "item-2" as Id<"posSessionItem">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockHoldSession.mockReset();
    mockHoldSession.mockResolvedValue(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockCompleteTransaction.mockReset();
    mockCompleteTransaction.mockResolvedValue(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        transactionNumber: "TXN-0001",
      }),
    );
    mockOpenDrawer.mockReset();
    mockOpenDrawer.mockResolvedValue(
      ok({
        _id: "drawer-2" as Id<"registerSession">,
        status: "open",
        terminalId: "terminal-1" as Id<"posTerminal">,
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
        notes: "Opening float ready",
        workflowTraceId: "register_session:drawer-2",
      }),
    );
    mockResumeSession.mockReset();
    mockResumeSession.mockResolvedValue(
      ok({
        sessionId: "session-2" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockVoidSession.mockReset();
    mockVoidSession.mockResolvedValue(
      ok({
        sessionId: "session-1" as Id<"posSession">,
      }),
    );
    mockUpdateSession.mockReset();
    mockUpdateSession.mockResolvedValue(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockSyncSessionCheckoutState.mockReset();
    mockSyncSessionCheckoutState.mockResolvedValue(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockReleaseSessionInventoryHoldsAndDeleteItems.mockReset();
    mockReleaseSessionInventoryHoldsAndDeleteItems.mockResolvedValue(
      ok({
        sessionId: "session-1" as Id<"posSession">,
      }),
    );
    mockRemoveItem.mockReset();
    mockRemoveItem.mockResolvedValue(
      ok({
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockBindSessionToRegisterSession.mockReset();
    mockBindSessionToRegisterSession.mockResolvedValue(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockNavigateBack.mockReset();
  });

  it("maps register state into shell-ready props without the legacy store", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.header.isSessionActive).toBe(true);
    expect(result.current.registerInfo.registerLabel).toBe("Front Counter");
    expect(result.current.checkout.payments).toEqual([]);
    expect(result.current.checkout.total).toBe(120);
    expect(result.current.sessionPanel?.canClearSale).toBe(true);
    expect(result.current.customerPanel.customerInfo.name).toBe("Ama Serwa");
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(result.current.productEntry.canQuickAddProduct).toBe(true);
    expect(result.current.authDialog?.open).toBe(false);
    expect(result.current.syncStatus?.status).toBe("synced");
  });

  it("maps local pending-sync status into POS presentation state", async () => {
    const onRetrySync = vi.fn();
    mockActiveSession = {
      ...mockActiveSession!,
      localSyncStatus: {
        status: "pending_sync",
        pendingEventCount: 3,
        onRetrySync,
      },
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.syncStatus).toEqual(
      expect.objectContaining({
        description:
          "Register activity is saved locally and will sync when ready.",
        label: "Pending sync",
        pendingEventCount: 3,
        status: "pending_sync",
        tone: "warning",
      }),
    );

    act(() => {
      result.current.syncStatus?.onRetrySync?.();
    });

    expect(onRetrySync).toHaveBeenCalled();
  });

  it("uses pending status from the local-first runtime before Convex session state", async () => {
    const onRetrySync = vi.fn();
    mockUsePosLocalSyncRuntimeStatus.mockReturnValue({
      status: "pending",
      pendingEventCount: 2,
      onRetrySync,
    });
    mockActiveSession = {
      ...mockActiveSession!,
      localSyncStatus: {
        status: "synced",
      },
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(mockUsePosLocalSyncRuntimeStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
    expect(result.current.syncStatus).toEqual(
      expect.objectContaining({
        label: "Pending sync",
        pendingEventCount: 2,
        status: "pending_sync",
        tone: "warning",
      }),
    );

    act(() => {
      result.current.syncStatus?.onRetrySync?.();
    });

    expect(onRetrySync).toHaveBeenCalled();
  });

  it("maps local reconciliation exceptions without blocking the retry callback", async () => {
    const onRetrySync = vi.fn();
    mockActiveSession = {
      ...mockActiveSession!,
      localSyncStatus: {
        status: "needs_review",
        reconciliationItems: [
          {
            summary: "Payment record needs manager review.",
            type: "payment_conflict",
          },
        ],
        onRetrySync,
      },
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.syncStatus).toEqual(
      expect.objectContaining({
        label: "Needs review",
        reconciliationItems: [
          {
            summary: "Payment record needs manager review.",
            type: "payment_conflict",
          },
        ],
        status: "needs_review",
        tone: "danger",
      }),
    );

    act(() => {
      result.current.syncStatus?.onRetrySync?.();
    });

    expect(onRetrySync).toHaveBeenCalled();
  });

  it("holds the active POS session before signing the cashier out when session data is present", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.cashierCard?.onSignOut();
    });

    expect(mockUpdateSession).toHaveBeenCalled();
    expect(mockHoldSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      staffProfileId: "staff-1",
      reason: "Signing out",
    });
    expect(result.current.authDialog?.open).toBe(true);
  });

  it("opens the cashier auth dialog when a terminal exists but no cashier is signed in", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    expect(result.current.authDialog?.open).toBe(true);
    expect(result.current.cashierCard).toBeNull();
  });

  it("uses the local POS entry seed as store authority when the live active store is unavailable", async () => {
    mockActiveStore = null;
    mockRegisterState = undefined;
    mockActiveSession = null;
    mockTerminal = {
      _id: "terminal-1" as Id<"posTerminal">,
      displayName: "Front Counter",
      registerNumber: "1",
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await waitFor(() =>
      expect(result.current.debug?.localEntryStatus).toBe("ready"),
    );

    expect(result.current.hasActiveStore).toBe(true);
    expect(result.current.authDialog).toEqual(
      expect.objectContaining({
        open: true,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
    expect(result.current.debug).toEqual(
      expect.objectContaining({
        activeStoreSource: "local",
        hasLiveActiveStore: false,
        localEntryStatus: "ready",
      }),
    );
  });

  it("uses the short-lived local POS staff proof for local events", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());
    const expiresAt = Date.now() + 60_000;

    expect(result.current.authDialog?.open).toBe(true);
    expect(result.current.authDialog?.onAuthenticated).toBeTypeOf("function");

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt,
          token: "staff-proof-token",
        },
      });
    });

    expect(result.current.authDialog?.open).toBe(false);

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        staffProfileId: "staff-1",
        type: "cart.item_added",
      }),
    );
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        staffProofToken: expect.any(String),
      }),
    );
  });

  it("does not trust persisted local POS staff proof as cashier sign-in", async () => {
    localStorage.setItem(
      "athena.pos.localStaffProof.store-1.terminal-1",
      JSON.stringify({
        expiresAt: Date.now() + 60_000,
        staffProfileId: "staff-1",
        token: "forged-proof-token",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    expect(result.current.authDialog?.open).toBe(true);
    expect(result.current.cashierCard).toBeNull();

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "real-proof-token",
        },
      });
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        staffProfileId: "staff-1",
        type: "cart.item_added",
      }),
    );
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        staffProofToken: expect.any(String),
      }),
    );
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        staffProofToken: "forged-proof-token",
      }),
    );
  });

  it("leaves onboarding once terminal and cashier access are configured", async () => {
    mockUseQuery.mockImplementation(() => [
      {
        credentialStatus: "active",
        primaryRole: "cashier",
        roles: ["cashier"],
        status: "active",
      },
    ]);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    expect(result.current.authDialog?.open).toBe(true);
    expect(result.current.onboarding).toEqual({
      shouldShow: false,
      terminalReady: true,
      cashierSetupReady: true,
      cashierSignedIn: false,
      cashierCount: 1,
      nextStep: "ready",
    });
  });

  it("does not flash onboarding while cashier access is still loading", async () => {
    mockUseQuery.mockImplementation(() => undefined);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    expect(result.current.authDialog?.open).toBe(true);
    expect(result.current.onboarding).toEqual({
      shouldShow: false,
      terminalReady: true,
      cashierSetupReady: true,
      cashierSignedIn: false,
      cashierCount: 0,
      nextStep: "ready",
    });
  });

  it("does not flash terminal onboarding while terminal lookup is still loading", async () => {
    mockTerminal = undefined;
    mockUseQuery.mockImplementation(() => [
      {
        credentialStatus: "active",
        primaryRole: "cashier",
        roles: ["cashier"],
        status: "active",
      },
    ]);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    expect(result.current.authDialog).toBeNull();
    expect(result.current.onboarding).toEqual({
      shouldShow: false,
      terminalReady: false,
      cashierSetupReady: true,
      cashierSignedIn: false,
      cashierCount: 1,
      nextStep: "ready",
    });
  });

  it("holds bootstrap on a missing drawer and exposes the drawer gate", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("initialSetup");
    expect(result.current.drawerGate?.errorMessage).toBeNull();
    expect(result.current.checkout.registerNumber).toBe("1");
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("uses offline authenticated manager roles for drawer access", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: null,
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          fullName: "Offline Manager",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("initialSetup");
    expect(result.current.drawerGate?.canOpenDrawer).toBe(true);
    expect(result.current.cashierCard?.cashierName).toBe("Offline Manager");
  });

  it("holds bootstrap on a closing drawer and exposes the closeout-blocked gate", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closing",
        countedCash: 4_500,
        managerApprovalRequestId: "approval-1" as Id<"approvalRequest">,
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
        variance: -500,
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("closeoutBlocked");
    expect(result.current.drawerGate?.registerNumber).toBe("1");
    expect(result.current.productEntry.disabled).toBe(true);
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockOpenDrawer).not.toHaveBeenCalled();
    expect(result.current.drawerGate).not.toHaveProperty("onSubmit");
    expect(result.current.drawerGate?.onSubmitCloseout).toEqual(
      expect.any(Function),
    );
    expect(result.current.drawerGate?.expectedCash).toBe(5_000);
    expect(result.current.drawerGate?.hasPendingCloseoutApproval).toBe(true);
    expect(result.current.drawerGate?.canOpenCashControls).toBe(true);
    expect(result.current.drawerGate?.cashControlsRegisterSessionId).toBe(
      "drawer-1",
    );
    expect(result.current.drawerGate?.closeoutSubmittedCountedCash).toBe(4_500);
    expect(result.current.drawerGate?.closeoutSubmittedVariance).toBe(-500);
  });

  it("submits closeout from the POS drawer gate with the current cashier", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closing",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.drawerGate?.onCloseoutCountedCashChange?.("48.00");
      result.current.drawerGate?.onCloseoutNotesChange?.("End of shift count");
    });

    expect(result.current.drawerGate?.closeoutDraftVariance).toBe(-200);

    await act(async () => {
      await result.current.drawerGate?.onSubmitCloseout?.();
    });

    expect(mockSubmitRegisterSessionCloseout).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "register.closeout_started",
          localRegisterSessionId: "drawer-1",
          payload: expect.objectContaining({
            countedCash: 4_800,
            notes: "End of shift count",
          }),
        }),
      ),
    );
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "Register session closed locally. It will sync when ready.",
    );
  });

  it("keeps the POS drawer gate open when local closeout persistence fails", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closing",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "register.closeout_started"
        ? {
            ok: false,
            error: { message: "POS local store could not write the local event." },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.drawerGate?.onCloseoutCountedCashChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmitCloseout?.();
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.closeout_started",
        localRegisterSessionId: "drawer-1",
        staffProfileId: "staff-1",
        payload: expect.objectContaining({
          countedCash: 5_000,
          notes: null,
        }),
      }),
    );
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
    expect(result.current.drawerGate?.errorMessage).toBe(
      "Unable to save this closeout locally.",
    );
  });

  it("requires closeout notes for POS closeout variance", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closing",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.drawerGate?.onCloseoutCountedCashChange?.("48.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmitCloseout?.();
    });

    expect(mockSubmitRegisterSessionCloseout).not.toHaveBeenCalled();
    expect(result.current.drawerGate?.errorMessage).toBe(
      "Closeout notes required. Add notes before submitting a count with variance.",
    );
  });

  it("records closeout locally without waiting for a server approval response", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closing",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.drawerGate?.onCloseoutCountedCashChange?.("48.00");
      result.current.drawerGate?.onCloseoutNotesChange?.("End of shift count");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmitCloseout?.();
    });

    expect(mockSubmitRegisterSessionCloseout).not.toHaveBeenCalled();
    expect(result.current.commandApprovalDialog).toBeNull();
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.closeout_started",
        localRegisterSessionId: "drawer-1",
        payload: expect.objectContaining({
          countedCash: 4_800,
          notes: "End of shift count",
        }),
      }),
    );
  });

  it("opens the closeout drawer gate from an active empty register", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.closeoutControl?.canCloseout).toBe(true);

    act(() => {
      result.current.closeoutControl?.onRequestCloseout();
    });

    expect(result.current.drawerGate?.mode).toBe("closeoutBlocked");
    expect(result.current.drawerGate?.expectedCash).toBe(5_000);
    expect(result.current.drawerGate?.closeoutSecondaryActionLabel).toBe(
      "Return to sale",
    );
    expect(result.current.productEntry.disabled).toBe(true);
  });

  it("routes register actions through the active-terminal conflict gate", async () => {
    mockActiveSession = null;
    mockRegisterState = {
      ...mockRegisterState!,
      activeSession: null,
      activeSessionConflict: {
        kind: "activeOnOtherTerminal",
        message: "A session is active for this cashier on a different terminal",
        terminalId: "terminal-2",
      },
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.sessionPanel?.hasExpiredSession).toBe(false);
    expect(result.current.sessionPanel?.disableNewSession).toBe(false);
    expect(result.current.closeoutControl?.canCloseout).toBe(true);
    expect(result.current.closeoutControl?.canShowOpeningFloatCorrection).toBe(
      true,
    );
    expect(result.current.closeoutControl?.canCorrectOpeningFloat).toBe(true);

    await act(async () => {
      await result.current.sessionPanel?.onStartNewSession();
      result.current.closeoutControl?.onRequestCloseout();
      result.current.closeoutControl?.onRequestOpeningFloatCorrection();
    });

    expect(result.current.drawerGate).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      "Cashier already has an active session on another terminal",
    );
  });

  it("leaves a ready register idle after other-terminal sessions have expired", async () => {
    mockActiveSession = null;
    mockRegisterState = {
      ...mockRegisterState!,
      phase: "readyToStart",
      activeSession: null,
      activeSessionConflict: null,
    };
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.started" }),
    );
    expect(result.current.sessionPanel?.hasExpiredSession).toBe(false);
  });

  it("corrects the opening float from the active POS register", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.closeoutControl?.canShowOpeningFloatCorrection).toBe(
      true,
    );
    expect(result.current.closeoutControl?.canCorrectOpeningFloat).toBe(true);

    act(() => {
      result.current.closeoutControl?.onRequestOpeningFloatCorrection();
    });

    expect(result.current.drawerGate?.mode).toBe("openingFloatCorrection");
    expect(result.current.drawerGate?.currentOpeningFloat).toBe(5_000);
    expect(result.current.drawerGate?.correctedOpeningFloat).toBe("50");
    expect(result.current.productEntry.disabled).toBe(true);

    act(() => {
      result.current.drawerGate?.onCorrectedOpeningFloatChange?.("45.00");
      result.current.drawerGate?.onCorrectionReasonChange?.("Cashier typo");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmitOpeningFloatCorrection?.();
    });

    expect(mockCorrectRegisterSessionOpeningFloat).toHaveBeenCalledWith({
      actorStaffProfileId: "staff-1",
      actorUserId: "user-1",
      approvalProofId: undefined,
      correctedOpeningFloat: 4_500,
      reason: "Cashier typo",
      registerSessionId: "drawer-1",
      storeId: "store-1",
    });
    expect(toast.success).toHaveBeenCalledWith("Opening float corrected");
  });

  it("opens manager re-auth when opening float correction requires approval", async () => {
    mockCorrectRegisterSessionOpeningFloat
      .mockResolvedValueOnce({
        kind: "approval_required",
        approval: {
          action: {
            key: "cash_controls.register_session.correct_opening_float",
            label: "Correct opening float",
          },
          copy: {
            title: "Manager approval required",
            message:
              "Authorization is needed from a manager to correct this register opening float.",
            primaryActionLabel: "Approve correction",
            secondaryActionLabel: "Cancel",
          },
          reason:
            "Manager approval is required to correct the register opening float.",
          requiredRole: "manager",
          resolutionModes: [{ kind: "inline_manager_proof" }],
          selfApproval: "allowed",
          subject: {
            id: "drawer-1",
            label: "1",
            type: "register_session",
          },
        },
      })
      .mockResolvedValueOnce(
        ok({
          action: "corrected",
        }),
      );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.closeoutControl?.onRequestOpeningFloatCorrection();
    });

    act(() => {
      result.current.drawerGate?.onCorrectedOpeningFloatChange?.("45.00");
      result.current.drawerGate?.onCorrectionReasonChange?.("Cashier typo");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmitOpeningFloatCorrection?.();
    });

    expect(result.current.drawerGate?.errorMessage).toBeNull();
    expect(result.current.commandApprovalDialog?.open).toBe(true);
    expect(result.current.commandApprovalDialog?.approval?.action.key).toBe(
      "cash_controls.register_session.correct_opening_float",
    );

    await act(async () => {
      const approval = result.current.commandApprovalDialog!.approval!;
      await result.current.commandApprovalDialog?.onApproved({
        approval,
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "staff-1" as Id<"staffProfile">,
        expiresAt: Date.now() + 60_000,
      });
    });

    expect(mockCorrectRegisterSessionOpeningFloat).toHaveBeenLastCalledWith({
      actorStaffProfileId: "staff-1",
      actorUserId: "user-1",
      approvalProofId: "proof-1",
      correctedOpeningFloat: 4_500,
      reason: "Cashier typo",
      registerSessionId: "drawer-1",
      storeId: "store-1",
    });
    expect(toast.success).toHaveBeenCalledWith("Opening float corrected");
  });

  it("reopens a closing register session from the POS drawer gate", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closing",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.drawerGate?.onReopenRegister?.();
    });

    expect(mockReopenRegisterSessionCloseout).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "register.reopened",
          localRegisterSessionId: "drawer-1",
        }),
      ),
    );
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "Register reopened locally. It will sync when ready.",
    );
  });

  it("does not expose local register reopen to non-manager cashiers", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["cashier"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closing",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.drawerGate?.mode).toBe("closeoutBlocked");
    expect(result.current.drawerGate?.onReopenRegister).toBeUndefined();
    expect(result.current.productEntry.disabled).toBe(true);
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "register.reopened" }),
    );
  });

  it("keeps closeout blocked when local register reopen persistence fails", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closing",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "register.reopened"
        ? {
            ok: false,
            error: { message: "POS local store could not write the local event." },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.drawerGate?.onReopenRegister?.();
    });

    expect(result.current.drawerGate?.mode).toBe("closeoutBlocked");
    expect(result.current.productEntry.disabled).toBe(true);
    expect(result.current.drawerGate?.errorMessage).toBe(
      "Unable to save this reopen locally.",
    );
    expect(toast.success).not.toHaveBeenCalledWith(
      "Register reopened locally. It will sync when ready.",
    );
  });

  it("gates an active POS session without a register assignment while preserving the sale", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: undefined,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("recovery");
    expect(result.current.productEntry.disabled).toBe(true);
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.customerPanel.customerInfo.name).toBe("Ama Serwa");
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockResumeSession).not.toHaveBeenCalled();
  });

  it("gates an active POS session assigned to a closing drawer with closeout guidance", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "closing",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("closeoutBlocked");
    expect(result.current.drawerGate?.isRecovery).toBe(true);
    expect(result.current.productEntry.disabled).toBe(true);
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockBindSessionToRegisterSession).not.toHaveBeenCalled();
    expect(mockOpenDrawer).not.toHaveBeenCalled();
    expect(result.current.drawerGate).not.toHaveProperty("onSubmit");
    expect(result.current.drawerGate?.onSubmitCloseout).toEqual(
      expect.any(Function),
    );
  });

  it("gates an active POS session assigned to a different open drawer", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-2",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: "drawer-1" as Id<"registerSession">,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("recovery");
    expect(result.current.drawerGate?.errorMessage).toBe(
      "Sale assigned to a different drawer. Open that drawer before continuing.",
    );
    expect(result.current.productEntry.disabled).toBe(true);
    expect(mockBindSessionToRegisterSession).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    expect(result.current.checkout.payments).toEqual([]);
    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        "[POS] Skipped checkout persistence while drawer recovery is required",
      ),
    );
    consoleWarn.mockRestore();
  });

  it("does not add products through direct handlers while an active session lacks drawer assignment", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: undefined,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        name: "Deep Wave",
        price: 100,
        barcode: "123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "SKU-2",
        quantityAvailable: 5,
      } as never);
    });

    expect(mockAddItem).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Drawer closed. Open the drawer before adding items.",
    );
  });

  it("records pending local session and cart events after starting a sale", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session.started",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: expect.stringMatching(/^local-pos-session-/),
        }),
      ),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: expect.stringMatching(/^local-pos-session-/),
        payload: expect.objectContaining({
          localItemId: expect.stringMatching(/^local-item-/),
          productSkuId: "sku-2",
          quantity: 1,
        }),
      }),
    );
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockWriteLocalCloudMapping).not.toHaveBeenCalled();
  });

  it("durably clears an empty local sale when voiding it", async () => {
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-session",
          schemaVersion: 1,
          sequence: 2,
          type: "session.started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: {
            localPosSessionId: "local-pos-session-1",
            registerSessionId: "drawer-1",
          },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
      ],
    });
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await waitFor(() =>
      expect(result.current.sessionPanel?.activeSessionNumber).toBe(
        "Local sale",
      ),
    );
    expect(result.current.checkout.cartItems).toEqual([]);

    mockAppendLocalEvent.mockClear();
    await act(async () => {
      await result.current.sessionPanel?.onVoidCurrentSession();
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.cleared",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "local-pos-session-1",
      }),
    );

    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        ...(await mockListLocalEvents()).value,
        {
          localEventId: "local-event-clear",
          schemaVersion: 1,
          sequence: 3,
          type: "cart.cleared",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: { localPosSessionId: "local-pos-session-1" },
          createdAt: 1_002,
          sync: { status: "pending" },
        },
      ],
    });
    const { projectLocalRegisterReadModel } = await import(
      "../../infrastructure/local/registerReadModel"
    );
    const replayed = projectLocalRegisterReadModel({
      events: (await mockListLocalEvents()).value,
      isOnline: true,
      terminalSeed: null,
    });
    expect(replayed.activeSale).toBeNull();
    expect(mockVoidSession).not.toHaveBeenCalled();
  });

  it("seeds the active cloud drawer before explicitly starting a new local sale", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: { firstName: "Ama", lastName: "Kusi" },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    await act(async () => {
      await result.current.sessionPanel?.onStartNewSession();
    });

    expect(mockAppendLocalEvent.mock.calls.map(([event]) => event.type)).toEqual(
      ["register.opened", "session.started"],
    );
    expect(mockAppendLocalEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "register.opened",
        localRegisterSessionId: "drawer-1",
        staffProofToken: "staff-proof-token",
      }),
    );
    expect(mockAppendLocalEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "session.started",
        localRegisterSessionId: "drawer-1",
      }),
    );
  });

  it("adds an exact in-stock catalog match once from local register search", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow(),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("1234567890123");
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "cart.item_added",
          payload: expect.objectContaining({
            productId: "product-2",
            productSkuId: "sku-2",
            productSku: "DW-18",
            barcode: "1234567890123",
            productName: "Deep Wave",
            quantity: 1,
          }),
        }),
      ),
    );
    expect(mockAddItem).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.productEntry.onBarcodeSubmit({
        preventDefault: vi.fn(),
      } as never);
    });

    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event?.type === "cart.item_added",
      ),
    ).toHaveLength(1);
  });

  it("does not repeat exact barcode auto-add after the local write completes", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
    };
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({ quantityAvailable: 1 }),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("1234567890123");
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "cart.item_added" }),
      ),
    );
    expect(result.current.cart.items).toEqual([
      expect.objectContaining({
        name: "Deep Wave",
        quantity: 1,
        skuId: "sku-2",
      }),
    ]);

    rerender();

    expect(
      mockAppendLocalEvent.mock.calls.filter(
        ([event]) => event?.type === "cart.item_added",
      ),
    ).toHaveLength(1);
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("keeps out-of-stock exact catalog matches visible without auto-adding", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        inStock: false,
        quantityAvailable: 0,
      }),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("DW-18");
    });

    expect(result.current.productEntry.searchResults).toHaveLength(1);
    expect(result.current.productEntry.searchResults[0]).toEqual(
      expect.objectContaining({
        skuId: "sku-2",
        inStock: false,
        quantityAvailable: 0,
      }),
    );
    expect(mockAddItem).not.toHaveBeenCalled();
  });
  it("keeps exact catalog matches visible but not addable while availability is unknown", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("1234567890123");
    });

    expect(result.current.productEntry.searchResults).toHaveLength(1);
    expect(result.current.productEntry.searchResults[0]).toEqual(
      expect.objectContaining({
        skuId: "sku-2",
        inStock: false,
        quantityAvailable: 0,
      }),
    );

    await act(async () => {
      await result.current.productEntry.onBarcodeSubmit({
        preventDefault: vi.fn(),
      } as never);
    });

    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("adds an exact in-stock SKU match on submit without auto-adding first", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow(),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("DW-18");
    });

    expect(result.current.productEntry.searchResults).toHaveLength(1);
    expect(mockAddItem).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.productEntry.onBarcodeSubmit({
        preventDefault: vi.fn(),
      } as never);
    });

    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        payload: expect.objectContaining({
          productId: "product-2",
          productSkuId: "sku-2",
          productSku: "DW-18",
        }),
      }),
    );
  });

  it("shows product-id variants from local catalog without auto-adding", async () => {
    mockRegisterCatalogRows = [
      buildRegisterCatalogRow(),
      buildRegisterCatalogRow({
        id: "sku-3" as Id<"productSku">,
        productSkuId: "sku-3" as Id<"productSku">,
        skuId: "sku-3" as Id<"productSku">,
        sku: "DW-20",
        barcode: "9876543210123",
        length: 20,
      }),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("product-2");
    });

    expect(result.current.productEntry.searchResults).toHaveLength(2);
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("keeps local search result order stable when availability changes", async () => {
    mockRegisterCatalogRows = [
      buildRegisterCatalogRow(),
      buildRegisterCatalogRow({
        id: "sku-3" as Id<"productSku">,
        productSkuId: "sku-3" as Id<"productSku">,
        skuId: "sku-3" as Id<"productSku">,
        sku: "DW-20",
        barcode: "9876543210123",
        length: 20,
      }),
    ];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        inStock: false,
        quantityAvailable: 0,
      }),
      buildRegisterCatalogAvailabilityRow({
        productSkuId: "sku-3" as Id<"productSku">,
        skuId: "sku-3" as Id<"productSku">,
        inStock: true,
        quantityAvailable: 8,
      }),
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("product-2");
    });

    expect(
      result.current.productEntry.searchResults.map((product) => ({
        skuId: product.skuId,
        quantityAvailable: product.quantityAvailable,
      })),
    ).toEqual([
      { skuId: "sku-2", quantityAvailable: 0 },
      { skuId: "sku-3", quantityAvailable: 8 },
    ]);

    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        quantityAvailable: 2,
      }),
      buildRegisterCatalogAvailabilityRow({
        productSkuId: "sku-3" as Id<"productSku">,
        skuId: "sku-3" as Id<"productSku">,
        inStock: false,
        quantityAvailable: 0,
      }),
    ];

    rerender();

    expect(
      result.current.productEntry.searchResults.map((product) => ({
        skuId: product.skuId,
        quantityAvailable: product.quantityAvailable,
      })),
    ).toEqual([
      { skuId: "sku-2", quantityAvailable: 2 },
      { skuId: "sku-3", quantityAvailable: 0 },
    ]);
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("pauses resumable-session auto-resume while no active drawer exists", async () => {
    mockRegisterState = {
      phase: "resumable",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: { _id: "session-2", sessionNumber: "POS-0002" },
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.mode).toBe("recovery");
    expect(mockResumeSession).not.toHaveBeenCalled();
  });

  it("opens the drawer locally and waits for an explicit sale start", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
      result.current.drawerGate?.onNotesChange?.("Opening float ready");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(mockOpenDrawer).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.opened",
        localRegisterSessionId: expect.stringMatching(
          /^local-register-terminal-1-/,
        ),
        payload: expect.objectContaining({
          openingFloat: 5_000,
          notes: "Opening float ready",
        }),
      }),
    );
    expect(mockStartSession).not.toHaveBeenCalled();

    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-2",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };

    await act(async () => {
      rerender();
    });

    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("marks drawer opening unavailable for non-manager cashier sign-ins", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        activeRoles: ["cashier"],
        firstName: "Ama",
        lastName: "Kusi",
      },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.drawerGate?.mode).toBe("initialSetup");
    expect(result.current.drawerGate?.canOpenDrawer).toBe(false);
    expect(result.current.drawerGate?.canOpenCashControls).toBe(false);
    expect(result.current.closeoutControl?.canShowOpeningFloatCorrection).toBe(
      false,
    );
    expect(result.current.closeoutControl?.canCorrectOpeningFloat).toBe(false);
    expect(result.current.productEntry.canQuickAddProduct).toBe(false);
  });

  it("binds a preserved active POS session after drawer recovery without clearing checkout state", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: undefined,
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    mockRegisterState = {
      ...mockRegisterState,
      activeRegisterSession: {
        _id: "drawer-2",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
    };

    await act(async () => {
      rerender();
    });

    expect(mockBindSessionToRegisterSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      staffProfileId: "staff-1",
      registerSessionId: "drawer-2",
    });
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ method: "cash", amount: 120 }),
    ]);
    expect(result.current.customerPanel.customerInfo.name).toBe("Ama Serwa");
  });

  it("keeps a preserved sale gated when drawer recovery binding fails", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: undefined,
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
    };
    mockBindSessionToRegisterSession.mockResolvedValueOnce(
      userError({
        code: "conflict",
        message: "This sale is already bound to another drawer.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    mockRegisterState = {
      ...mockRegisterState,
      activeRegisterSession: {
        _id: "drawer-2",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
    };

    await act(async () => {
      rerender();
    });

    await waitFor(() => {
      expect(result.current.drawerGate?.errorMessage).toBe(
        "This sale is already bound to another drawer.",
      );
    });
    expect(result.current.drawerGate?.mode).toBe("recovery");
    expect(result.current.productEntry.disabled).toBe(true);
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ method: "cash", amount: 120 }),
    ]);
    expect(result.current.customerPanel.customerInfo.name).toBe("Ama Serwa");
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("keeps the operator on the drawer gate when opening the drawer fails", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "register.opened"
        ? {
            ok: false,
            error: { message: "POS local store could not write the local event." },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.errorMessage).toBe(
      "Unable to save this drawer opening locally.",
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("opens the drawer locally even if the old cloud drawer command would fail", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockOpenDrawer.mockRejectedValueOnce(
      new Error(
        "Uncaught Error: A register session is already open for this register number.",
      ),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(result.current.drawerGate).toBeNull();
    expect(mockOpenDrawer).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.opened",
        localRegisterSessionId: expect.stringMatching(
          /^local-register-terminal-1-/,
        ),
      }),
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("validates the drawer opening float before sending an open-drawer command", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(result.current.drawerGate?.errorMessage).toBe(
      "Opening float required. Enter an amount greater than 0.",
    );
    expect(mockOpenDrawer).not.toHaveBeenCalled();
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("records a pending local drawer-open event after opening the drawer", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "register.opened",
          localRegisterSessionId: expect.stringMatching(
            /^local-register-terminal-1-/,
          ),
          payload: expect.objectContaining({
            openingFloat: 5_000,
          }),
        }),
      ),
    );
    expect(mockWriteLocalCloudMapping).not.toHaveBeenCalled();
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
  });

  it("requires a provisioned local sync seed before opening the drawer locally", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockReadProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: null,
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(result.current.drawerGate?.errorMessage).toBe(
      "Terminal setup required. Register this terminal before opening the drawer.",
    );
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "register.opened" }),
    );
  });

  it("requires a provisioned local sync seed before changing checkout state", async () => {
    mockReadProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: null,
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let added = true;
    await act(async () => {
      added = await result.current.checkout.onAddPayment("cash", 120);
    });
    let completed = true;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(added).toBe(false);
    expect(completed).toBe(false);
    expect(result.current.checkout.payments).toEqual([]);
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.payments_updated" }),
    );
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "transaction.completed" }),
    );
  });

  it("seeds an existing cloud drawer into the local log before starting a local sale", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [buildRegisterCatalogAvailabilityRow()];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.opened",
        localRegisterSessionId: "drawer-1",
        staffProofToken: "staff-proof-token",
      }),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.started",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: expect.stringMatching(/^local-pos-session-/),
      }),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        localRegisterSessionId: "drawer-1",
      }),
    );
  });

  it("seeds an existing cloud active sale before accepting local cart writes", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      _id: "session-1" as Id<"posSession">,
      cartItems: [],
      registerSessionId: "drawer-1" as Id<"registerSession">,
    };
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [buildRegisterCatalogAvailabilityRow()];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 100);
    });
    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    const localEvents = mockAppendLocalEvent.mock.calls.map(
      ([event]) => event,
    );
    const eventTypes = localEvents.map((event) => event.type);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "register.opened",
        "session.started",
        "cart.item_added",
        "session.payments_updated",
        "transaction.completed",
      ]),
    );
    expect(eventTypes.indexOf("register.opened")).toBeLessThan(
      eventTypes.indexOf("cart.item_added"),
    );
    expect(eventTypes.indexOf("session.started")).toBeLessThan(
      eventTypes.indexOf("cart.item_added"),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.started",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
      }),
    );
    for (const event of localEvents.filter(
      (candidate) =>
        candidate.type === "session.started" ||
        candidate.type === "cart.item_added" ||
        candidate.type === "session.payments_updated" ||
        candidate.type === "transaction.completed",
    )) {
      expect(event.localPosSessionId).toBe("session-1");
    }
  });

  it("completes cloud-backed local cart changes with existing cloud cart lines", async () => {
    const localEvents: Array<Record<string, unknown>> = [];
    mockAppendLocalEvent.mockImplementation(
      async (input: Record<string, unknown>) => {
        localEvents.push({
          localEventId: `local-event-${localEvents.length + 1}`,
          schemaVersion: 1,
          sequence: localEvents.length + 1,
          createdAt: 1_000 + localEvents.length + 1,
          sync: { status: "pending" },
          ...input,
        });
        return {
          ok: true,
          value: { localEventId: `local-event-${localEvents.length}` },
        };
      },
    );
    mockListLocalEvents.mockImplementation(() =>
      Promise.resolve({ ok: true, value: localEvents }),
    );
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      _id: "session-1" as Id<"posSession">,
      cartItems: [
        {
          id: "item-1" as Id<"posSessionItem">,
          name: "Body Wave",
          barcode: "BW-1",
          price: 120,
          quantity: 1,
          productId: "product-1" as Id<"product">,
          skuId: "sku-1" as Id<"productSku">,
        },
      ],
      registerSessionId: "drawer-1" as Id<"registerSession">,
    };
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [buildRegisterCatalogAvailabilityRow()];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 220);
    });

    let completed = false;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(completed).toBe(true);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "transaction.completed",
        localPosSessionId: "session-1",
        payload: expect.objectContaining({
          subtotal: 220,
          total: 220,
          items: expect.arrayContaining([
            expect.objectContaining({
              localItemId: "item-1",
              productSkuId: "sku-1",
              price: 120,
              quantity: 1,
            }),
            expect.objectContaining({
              localItemId: expect.stringMatching(/^local-item-/),
              productSkuId: "sku-2",
              price: 100,
              quantity: 1,
            }),
          ]),
        }),
      }),
    );
  });

  it("durably clears a cloud-backed sale that has local-first events", async () => {
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-session",
          schemaVersion: 1,
          sequence: 2,
          type: "session.started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          staffProfileId: "staff-1",
          payload: {
            localPosSessionId: "session-1",
            registerSessionId: "drawer-1",
          },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-cart",
          schemaVersion: 1,
          sequence: 3,
          type: "cart.item_added",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          staffProfileId: "staff-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            productName: "Body Wave",
            productSku: "BW-12",
            quantity: 1,
            price: 120,
          },
          createdAt: 1_002,
          sync: { status: "pending" },
        },
      ],
    });
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      activeSessionConflict: null,
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      _id: "session-1" as Id<"posSession">,
      cartItems: [],
      registerSessionId: "drawer-1" as Id<"registerSession">,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await waitFor(() =>
      expect(result.current.sessionPanel?.activeSessionNumber).toBe(
        "Local sale",
      ),
    );

    mockAppendLocalEvent.mockClear();
    await act(async () => {
      await result.current.sessionPanel?.onVoidCurrentSession();
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.cleared",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
      }),
    );
    expect(mockVoidSession).not.toHaveBeenCalled();
    expect(result.current.sessionPanel?.activeSessionNumber).toBeNull();
    expect(result.current.sessionPanel?.disableNewSession).toBe(false);
  });

  it("lets a pending local drawer open build an offline cart without cloud drawer or session ids", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockOpenDrawer.mockResolvedValueOnce(
      userError({
        code: "unavailable",
        message: "Connection unavailable.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
      result.current.drawerGate?.onNotesChange?.("Opening float ready");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "register.opened",
          localRegisterSessionId: expect.stringMatching(
            /^local-register-terminal-1-/,
          ),
          staffProofToken: "staff-proof-token",
          payload: expect.objectContaining({
            openingFloat: 5_000,
            notes: "Opening float ready",
          }),
        }),
      ),
    );
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "Drawer opening saved locally. It will sync when ready.",
    );
    expect(toast.success).not.toHaveBeenCalledWith("Drawer open");
    await waitFor(() => expect(result.current.drawerGate).toBeNull());
    expect(result.current.productEntry.disabled).toBe(false);
    expect(result.current.syncStatus).toEqual(
      expect.objectContaining({
        status: "pending_sync",
        label: "Pending sync",
      }),
    );
    expect(mockStartSession).not.toHaveBeenCalled();

    let added = false;
    await act(async () => {
      added = await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(added).toBe(true);
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Deep Wave",
          skuId: "sku-2",
          quantity: 1,
        }),
      ]),
    );
    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session.started",
          localRegisterSessionId: expect.stringMatching(
            /^local-register-terminal-1-/,
          ),
          localPosSessionId: expect.stringMatching(/^local-pos-session-/),
        }),
      ),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        localRegisterSessionId: expect.stringMatching(
          /^local-register-terminal-1-/,
        ),
        localPosSessionId: expect.stringMatching(/^local-pos-session-/),
      }),
    );

    await act(async () => {
      await result.current.cart.onUpdateQuantity(
        "optimistic:sku-2" as Id<"posSessionItem">,
        2,
      );
    });
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skuId: "sku-2",
          quantity: 2,
        }),
      ]),
    );

    await act(async () => {
      await result.current.cart.onRemoveItem(
        "optimistic:sku-2" as Id<"posSessionItem">,
      );
    });
    expect(mockRemoveItem).not.toHaveBeenCalled();
    expect(result.current.cart.items).toEqual([]);

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });
    await act(async () => {
      await result.current.cart.onClearCart();
    });
    expect(mockReleaseSessionInventoryHoldsAndDeleteItems).not.toHaveBeenCalled();
    expect(result.current.cart.items).toEqual([]);

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    await act(async () => {
      await result.current.cart.onUpdateQuantity(
        "optimistic:sku-2" as Id<"posSessionItem">,
        2,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 200);
    });
    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session.payments_updated",
          localPosSessionId: expect.stringMatching(/^local-pos-session-/),
          payload: expect.objectContaining({
            payments: [expect.objectContaining({ method: "cash", amount: 200 })],
            stage: "paymentAdded",
          }),
        }),
      ),
    );

    let completed = false;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(completed).toBe(true);
    expect(mockUpdateSession).not.toHaveBeenCalled();
    expect(mockCompleteTransaction).not.toHaveBeenCalled();
    expect(result.current.checkout.completedOrderNumber).toMatch(
      /^local-txn-/,
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "transaction.completed",
        localRegisterSessionId: expect.stringMatching(
          /^local-register-terminal-1-/,
        ),
        localPosSessionId: expect.stringMatching(/^local-pos-session-/),
        localTransactionId: expect.stringMatching(/^local-txn-/),
        staffProofToken: "staff-proof-token",
        payload: expect.objectContaining({
          total: 200,
          items: [
            expect.objectContaining({
              localItemId: "optimistic:sku-2",
              productSkuId: "sku-2",
              price: 100,
              quantity: 2,
            }),
          ],
          payments: [expect.objectContaining({ method: "cash", amount: 200 })],
        }),
      }),
    );
  });

  it("replays a persisted local register sale and payment draft into the active UI", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-1",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-2",
          schemaVersion: 1,
          sequence: 2,
          type: "session.started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: { localPosSessionId: "local-pos-session-1" },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-3",
          schemaVersion: 1,
          sequence: 3,
          type: "cart.item_added",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-2",
            productSkuId: "sku-2",
            productSku: "DW-18",
            productName: "Deep Wave",
            price: 100,
            quantity: 2,
          },
          createdAt: 1_002,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-4",
          schemaVersion: 1,
          sequence: 4,
          type: "session.payments_updated",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: {
            localPosSessionId: "local-pos-session-1",
            payments: [{ method: "cash", amount: 200, timestamp: 1_003 }],
            stage: "paymentAdded",
          },
          createdAt: 1_003,
          sync: { status: "pending" },
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await waitFor(() =>
      expect(result.current.checkout.cartItems).toEqual([
        expect.objectContaining({
          name: "Deep Wave",
          skuId: "sku-2",
          quantity: 2,
        }),
      ]),
    );
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ method: "cash", amount: 200 }),
    ]);
    expect(result.current.closeoutControl?.canCloseout).toBe(false);
  });

  it("clears stale local register state when the local event log cannot be read", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-1",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-2",
          schemaVersion: 1,
          sequence: 2,
          type: "session.started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: { localPosSessionId: "local-pos-session-1" },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-3",
          schemaVersion: 1,
          sequence: 3,
          type: "cart.item_added",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-2",
            productSkuId: "sku-2",
            productSku: "DW-18",
            productName: "Deep Wave",
            price: 100,
            quantity: 2,
          },
          createdAt: 1_002,
          sync: { status: "pending" },
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await waitFor(() =>
      expect(result.current.checkout.cartItems).toEqual([
        expect.objectContaining({ name: "Deep Wave", quantity: 2 }),
      ]),
    );

    mockListLocalEvents.mockResolvedValue({
      ok: false,
      error: { message: "IndexedDB unavailable" },
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 10_000);
    });

    await waitFor(() => expect(result.current.checkout.cartItems).toEqual([]));
    expect(result.current.checkout.payments).toEqual([]);
  });

  it("keeps a locally closed register blocked until it is reopened", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: {
        _id: "staff-1",
        firstName: "Ama",
        lastName: "Kusi",
        activeRoles: ["manager"],
      },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-1",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-2",
          schemaVersion: 1,
          sequence: 2,
          type: "register.closeout_started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "local-register-1",
          staffProfileId: "staff-1",
          payload: {
            countedCash: 5_000,
            notes: null,
          },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await waitFor(() =>
      expect(result.current.drawerGate?.mode).toBe("closeoutBlocked"),
    );
    expect(result.current.productEntry.disabled).toBe(true);
    expect(result.current.closeoutControl?.canCloseout).toBe(false);
    expect(result.current.drawerGate?.onReopenRegister).toBeTypeOf("function");
  });

  it("lets a locally opened empty drawer enter the local closeout flow", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });
    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });
    await waitFor(() =>
      expect(result.current.closeoutControl?.canCloseout).toBe(true),
    );

    act(() => {
      result.current.closeoutControl?.onRequestCloseout();
    });
    act(() => {
      result.current.drawerGate?.onCloseoutCountedCashChange?.("50.00");
    });
    await act(async () => {
      await result.current.drawerGate?.onSubmitCloseout?.();
    });

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register.closeout_started",
        localRegisterSessionId: expect.stringMatching(
          /^local-register-terminal-1-/,
        ),
        staffProofToken: "staff-proof-token",
        payload: expect.objectContaining({ countedCash: 5_000 }),
      }),
    );
  });

  it("keeps a local sale active instead of claiming an unsupported local hold", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });
    act(() => {
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });
    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });
    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    await act(async () => {
      await result.current.sessionPanel?.onHoldCurrentSession();
    });

    expect(mockHoldSession).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.held" }),
    );
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(toast.error).toHaveBeenCalledWith(
      "Complete or clear this local sale before leaving the register.",
    );
    expect(toast.success).not.toHaveBeenCalledWith("Sale placed on hold");
  });

  it("voids an empty active session when navigating away/unmounting", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      customer: null,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, unmount } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.onNavigateBack();
    });

    await act(async () => {
      unmount();
    });

    expect(mockHoldSession).not.toHaveBeenCalled();
    expect(mockVoidSession).toHaveBeenCalledWith({
      sessionId: "session-1" as Id<"posSession">,
    });
    expect(mockNavigateBack).toHaveBeenCalled();
  });

  it("does not show the sale-cleared toast when voiding an empty sale", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      customer: null,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.sessionPanel?.onVoidCurrentSession();
    });

    expect(mockVoidSession).toHaveBeenCalledWith({
      sessionId: "session-1" as Id<"posSession">,
    });
    expect(toast.success).not.toHaveBeenCalledWith("Sale cleared");
  });

  it("shows the sale-cleared toast when voiding a sale with cart items", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.sessionPanel?.onVoidCurrentSession();
    });

    expect(mockVoidSession).toHaveBeenCalledWith({
      sessionId: "session-1" as Id<"posSession">,
    });
    expect(toast.success).toHaveBeenCalledWith("Sale cleared");
  });

  it("orders session-panel local clear after pending payment writes", async () => {
    mockActiveSession = null;
    mockRegisterState = {
      ...mockRegisterState!,
      activeSession: null,
    };
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-session",
          schemaVersion: 1,
          sequence: 2,
          type: "session.started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: { localPosSessionId: "local-pos-session-1" },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-cart",
          schemaVersion: 1,
          sequence: 3,
          type: "cart.item_added",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "local-pos-session-1",
          staffProfileId: "staff-1",
          payload: {
            localItemId: "item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            productName: "Body Wave",
            productSku: "BW-1",
            price: 120,
            quantity: 1,
          },
          createdAt: 1_002,
          sync: { status: "pending" },
        },
      ],
    });
    const pendingPaymentUpdate = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) => {
      if (input.type === "session.payments_updated") {
        return pendingPaymentUpdate.promise;
      }
      return Promise.resolve({
        ok: true,
        value: { localEventId: "local-clear-event-1" },
      });
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });
    await waitFor(() => expect(result.current.checkout.cartItems).toHaveLength(1));

    let addPaymentPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPaymentPromise = result.current.checkout.onAddPayment("cash", 120);
    });

    let clearPromise: Promise<void> | undefined;
    await act(async () => {
      clearPromise = result.current.sessionPanel?.onVoidCurrentSession();
    });

    pendingPaymentUpdate.resolve({
      ok: true,
      value: { localEventId: "local-payment-event-1" },
    });
    await act(async () => {
      await addPaymentPromise;
      await clearPromise;
    });

    expect(mockAppendLocalEvent.mock.calls.map(([event]) => event.type)).toEqual(
      ["session.payments_updated", "cart.cleared"],
    );
    expect(result.current.checkout.payments).toEqual([]);
    expect(result.current.checkout.cartItems).toEqual([]);
  });

  it("does not void an empty active session before resuming a held one", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      customer: null,
    };
    mockHeldSessions = [
      {
        _id: "session-2" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
        sessionNumber: "POS-0002",
        updatedAt: Date.now(),
        cartItems: [],
        customer: null,
      },
    ];

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.sessionPanel?.onResumeSession(
        "session-2" as Id<"posSession">,
      );
    });

    expect(mockVoidSession).not.toHaveBeenCalled();
    expect(mockResumeSession).toHaveBeenCalledWith({
      sessionId: "session-2",
      staffProfileId: "staff-1",
      terminalId: "terminal-1",
    });
  });

  it("does not treat customer-only drafts as holdable sessions", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      customer: {
        _id: "customer-1" as Id<"posCustomer">,
        name: "Ama Serwa",
        email: "ama@example.com",
        phone: "555-0100",
      },
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.sessionPanel?.canHoldSession).toBe(false);
    expect(result.current.sessionPanel?.canClearSale).toBe(true);

    await act(async () => {
      await result.current.onNavigateBack();
    });

    expect(mockHoldSession).not.toHaveBeenCalled();
    expect(mockVoidSession).toHaveBeenCalledWith({
      sessionId: "session-1" as Id<"posSession">,
    });
    expect(mockNavigateBack).toHaveBeenCalled();
  });

  it("does not expose clear sale for an empty active session", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      payments: [],
      customer: null,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    expect(result.current.sessionPanel?.canHoldSession).toBe(false);
    expect(result.current.sessionPanel?.canClearSale).toBe(false);
  });

  it("does not require the legacy register store or orchestration hooks", () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(currentDir, "useRegisterViewModel.ts"),
      "utf8",
    );

    expect(source).not.toContain("usePOSStore");
    expect(source).not.toContain("useCartOperations");
    expect(source).not.toContain("useCustomerOperations");
    expect(source).not.toContain("usePOSOperations");
    expect(source).not.toContain("usePOSSessions");
    expect(source).not.toContain("useSessionManagement");
    expect(source).not.toContain("useSessionManagerOperations");
    expect(source).not.toContain("usePOSProductSearch");
    expect(source).not.toContain("usePOSBarcodeSearch");
    expect(source).not.toContain("usePOSProductIdSearch");
  });

  it("refuses quantity updates for malformed cart items that are missing sku metadata", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [
        {
          ...mockActiveSession!.cartItems[0],
          skuId: undefined,
        } as never,
      ],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.cart.onUpdateQuantity(
        "item-1" as Id<"posSessionItem">,
        2,
      );
    });

    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("optimistically updates cart quantity while the server mutation is pending", async () => {
    let resolveAddItem: (value: ReturnType<typeof ok>) => void = () => {};
    mockAddItem.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAddItem = resolve as typeof resolveAddItem;
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let updatePromise: Promise<void> | undefined;
    await act(async () => {
      updatePromise = result.current.cart.onUpdateQuantity(
        "item-1" as Id<"posSessionItem">,
        2,
      );
    });

    expect(result.current.cart.items[0].quantity).toBe(2);
    expect(result.current.checkout.cartItems[0].quantity).toBe(2);

    resolveAddItem(
      ok({
        itemId: "item-1" as Id<"posSessionItem">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    await act(async () => {
      await updatePromise;
    });
  });

  it("optimistically adds product selections while the local write is pending", async () => {
    const pendingAppend = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) =>
      input.type === "cart.item_added"
        ? pendingAppend.promise
        : Promise.resolve({
            ok: true,
            value: { localEventId: "local-seed-event-1" },
          }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let addPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPromise = result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Deep Wave",
          skuId: "sku-2",
          quantity: 1,
        }),
      ]),
    );
    expect(result.current.checkout.cartItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Deep Wave",
          skuId: "sku-2",
          quantity: 1,
        }),
      ]),
    );

    pendingAppend.resolve({ ok: true, value: { localEventId: "local-event-1" } });
    await act(async () => {
      await addPromise;
    });
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
        payload: expect.objectContaining({
          localItemId: expect.stringMatching(/^local-item-/),
          productSkuId: "sku-2",
          quantity: 1,
        }),
      }),
    );
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
  });

  it("optimistically increments existing product selections while the local write is pending", async () => {
    const pendingAppend = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) =>
      input.type === "cart.item_added"
        ? pendingAppend.promise
        : Promise.resolve({
            ok: true,
            value: { localEventId: "local-seed-event-1" },
          }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let addPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPromise = result.current.productEntry.onAddProduct({
        id: "sku-1",
        name: "Body Wave",
        price: 120,
        barcode: "1234567890",
        productId: "product-1" as Id<"product">,
        skuId: "sku-1" as Id<"productSku">,
        sku: "BW-12",
        category: "Hair",
        description: "Body wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(result.current.cart.items[0].quantity).toBe(2);
    expect(result.current.checkout.cartItems[0].quantity).toBe(2);

    pendingAppend.resolve({ ok: true, value: { localEventId: "local-event-1" } });
    await act(async () => {
      await addPromise;
    });
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("rolls back optimistic quantity changes when the local write fails", async () => {
    const pendingAppend = deferred<{
      ok: false;
      error: { message: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) =>
      input.type === "cart.item_added"
        ? pendingAppend.promise
        : Promise.resolve({
            ok: true,
            value: { localEventId: "local-seed-event-1" },
          }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let updatePromise: Promise<void> | undefined;
    await act(async () => {
      updatePromise = result.current.cart.onUpdateQuantity(
        "item-1" as Id<"posSessionItem">,
        2,
      );
    });

    expect(result.current.cart.items[0].quantity).toBe(2);

    pendingAppend.resolve({
      ok: false,
      error: { message: "POS local store could not write the local event." },
    });
    await act(async () => {
      await updatePromise;
    });

    expect(result.current.cart.items[0].quantity).toBe(1);
    expect(result.current.checkout.cartItems[0].quantity).toBe(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to save this cart update locally.",
    );
  });

  it("rolls back optimistic product selections when the local write fails", async () => {
    const pendingAppend = deferred<{
      ok: false;
      error: { message: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) =>
      input.type === "cart.item_added"
        ? pendingAppend.promise
        : Promise.resolve({
            ok: true,
            value: { localEventId: "local-seed-event-1" },
          }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let addPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPromise = result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Deep Wave",
          skuId: "sku-2",
        }),
      ]),
    );

    pendingAppend.resolve({
      ok: false,
      error: { message: "POS local store could not write the local event." },
    });
    await act(async () => {
      await addPromise;
    });

    expect(result.current.cart.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skuId: "sku-2",
        }),
      ]),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to save this item locally.",
    );
  });

  it("keeps an optimistic cart item and records a pending local cart event", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    let added = false;
    await act(async () => {
      added = await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(added).toBe(true);
    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Deep Wave",
          skuId: "sku-2",
          quantity: 1,
        }),
      ]),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
      }),
    );
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalledWith("Connection unavailable.");
    expect(toast.success).toHaveBeenCalledWith(
      "Item added to local sale. Complete the sale to sync it.",
    );
  });

  it("snapshots optimistic cart items into a pending local sale on completion", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    await act(async () => {
      await result.current.cart.onUpdateQuantity(
        "optimistic:sku-2" as Id<"posSessionItem">,
        2,
      );
    });
    await act(async () => {
      result.current.customerPanel.setCustomerInfo({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
      await result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
    });
    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 10_000);
    });
    await waitFor(() =>
      expect(result.current.checkout.payments).toEqual([
        expect.objectContaining({ method: "cash", amount: 10_000 }),
      ]),
    );

    let completed = false;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(completed).toBe(true);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cart.item_added",
      }),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "transaction.completed",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
        staffProofToken: "staff-proof-token",
        payload: expect.objectContaining({
          customerEmail: "efua@example.com",
          customerName: "Efua Mensah",
          customerPhone: "555-2222",
          customerProfileId: "profile-2",
          items: expect.arrayContaining([
            expect.objectContaining({
              localItemId: "optimistic:sku-2",
              productSkuId: "sku-2",
              price: 100,
              quantity: 2,
            }),
          ]),
          payments: [expect.objectContaining({ method: "cash", amount: 10_000 })],
        }),
      }),
    );
  });

  it("does not claim a local cart add when the sale session cannot be saved locally", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;
    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "session.started"
        ? {
            ok: false,
            error: { message: "POS local store could not write the local event." },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    let added = true;
    await act(async () => {
      added = await result.current.productEntry.onAddProduct({
        id: "sku-2",
        name: "Deep Wave",
        price: 100,
        barcode: "1234567890123",
        productId: "product-2" as Id<"product">,
        skuId: "sku-2" as Id<"productSku">,
        sku: "DW-18",
        category: "Hair",
        description: "Deep wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(added).toBe(false);
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.started" }),
    );
    expect(result.current.cart.items).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to save this sale locally. Try again.",
    );
  });

  it("rolls back optimistic existing product selections when the local write fails", async () => {
    const pendingAppend = deferred<{
      ok: false;
      error: { message: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) =>
      input.type === "cart.item_added"
        ? pendingAppend.promise
        : Promise.resolve({
            ok: true,
            value: { localEventId: "local-seed-event-1" },
          }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let addPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPromise = result.current.productEntry.onAddProduct({
        id: "sku-1",
        name: "Body Wave",
        price: 120,
        barcode: "1234567890",
        productId: "product-1" as Id<"product">,
        skuId: "sku-1" as Id<"productSku">,
        sku: "BW-12",
        category: "Hair",
        description: "Body wave bundle",
        image: null,
        inStock: true,
        quantityAvailable: 5,
      });
    });

    expect(result.current.cart.items[0].quantity).toBe(2);

    pendingAppend.resolve({
      ok: false,
      error: { message: "POS local store could not write the local event." },
    });
    await act(async () => {
      await addPromise;
    });

    expect(result.current.cart.items[0].quantity).toBe(1);
    expect(result.current.checkout.cartItems[0].quantity).toBe(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to save this item locally.",
    );
  });

  it("keeps remove-to-zero changes visible when the local write fails", async () => {
    const pendingAppend = deferred<{
      ok: false;
      error: { message: string };
    }>();
    mockAppendLocalEvent.mockReturnValueOnce(pendingAppend.promise);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let removePromise: Promise<void> | undefined;
    await act(async () => {
      removePromise = result.current.cart.onUpdateQuantity(
        "item-1" as Id<"posSessionItem">,
        0,
      );
    });

    expect(result.current.cart.items).toHaveLength(1);
    expect(result.current.checkout.cartItems).toHaveLength(1);

    pendingAppend.resolve({
      ok: false,
      error: { message: "POS local store could not write the local event." },
    });
    await act(async () => {
      await removePromise;
    });

    expect(result.current.cart.items).toHaveLength(1);
    expect(result.current.cart.items[0].quantity).toBe(1);
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to save this cart update locally.",
    );
  });

  it("keeps cart item removals visible until the local write is durable", async () => {
    const pendingAppend = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockReturnValueOnce(pendingAppend.promise);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let removePromise: Promise<void> | undefined;
    await act(async () => {
      removePromise = result.current.cart.onRemoveItem(
        "item-1" as Id<"posSessionItem">,
      );
    });

    expect(result.current.cart.items).toHaveLength(1);
    expect(result.current.checkout.cartItems).toHaveLength(1);

    pendingAppend.resolve({ ok: true, value: { localEventId: "local-event-1" } });
    await act(async () => {
      await removePromise;
    });
    expect(result.current.cart.items).toHaveLength(0);
    expect(result.current.checkout.cartItems).toHaveLength(0);
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });

  it("does not complete with an empty refreshed local cart after a pending removal settles", async () => {
    const pendingRemove = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    const localEvents: unknown[] = [
      {
        localEventId: "local-event-open",
        schemaVersion: 1,
        sequence: 1,
        type: "register.opened",
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "drawer-1",
        staffProfileId: "staff-1",
        payload: {
          localRegisterSessionId: "drawer-1",
          openingFloat: 5_000,
          expectedCash: 5_000,
        },
        createdAt: 1_000,
        sync: { status: "pending" },
      },
      {
        localEventId: "local-event-session",
        schemaVersion: 1,
        sequence: 2,
        type: "session.started",
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
        staffProfileId: "staff-1",
        payload: { localPosSessionId: "session-1" },
        createdAt: 1_001,
        sync: { status: "pending" },
      },
    ];
    mockAppendLocalEvent.mockImplementation((input: Record<string, unknown>) => {
      localEvents.push({
        localEventId: `local-event-${localEvents.length + 1}`,
        schemaVersion: 1,
        sequence: localEvents.length + 1,
        createdAt: 1_000 + localEvents.length + 1,
        sync: { status: "pending" },
        ...input,
      });
      if (
        input.type === "cart.item_added"
      ) {
        return pendingRemove.promise;
      }
      return Promise.resolve({
        ok: true,
        value: { localEventId: `local-event-${localEvents.length}` },
      });
    });
    mockListLocalEvents.mockImplementation(() =>
      Promise.resolve({ ok: true, value: localEvents }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated({
        staffProfileId: "staff-1" as Id<"staffProfile">,
        staffProfile: {
          firstName: "Ama",
          lastName: "Kusi",
        },
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "staff-proof-token",
        },
      });
    });

    let removePromise: Promise<void> | undefined;
    await act(async () => {
      removePromise = result.current.cart.onRemoveItem(
        "item-1" as Id<"posSessionItem">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    let completePromise: Promise<boolean> | undefined;
    let completed = true;
    await act(async () => {
      completePromise = result.current.checkout
        .onCompleteTransaction()
        .then((value) => {
          completed = value;
          return value;
        });
    });

    pendingRemove.resolve({
      ok: true,
      value: { localEventId: "local-remove-event-1" },
    });
    await act(async () => {
      await removePromise;
      await completePromise;
    });

    expect(completed).toBe(false);
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "transaction.completed" }),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Add an item before completing the sale.",
    );
  });

  it("keeps cart item removals visible when the local write fails", async () => {
    const pendingAppend = deferred<{
      ok: false;
      error: { message: string };
    }>();
    mockAppendLocalEvent.mockReturnValueOnce(pendingAppend.promise);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let removePromise: Promise<void> | undefined;
    await act(async () => {
      removePromise = result.current.cart.onRemoveItem(
        "item-1" as Id<"posSessionItem">,
      );
    });

    expect(result.current.cart.items).toHaveLength(1);

    pendingAppend.resolve({
      ok: false,
      error: { message: "POS local store could not write the local event." },
    });
    await act(async () => {
      await removePromise;
    });

    expect(result.current.cart.items).toHaveLength(1);
    expect(result.current.cart.items[0].quantity).toBe(1);
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to save this cart update locally.",
    );
  });

  it("keeps cart items visible until the local clear write is durable", async () => {
    const pendingAppend = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockReturnValueOnce(pendingAppend.promise);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let clearPromise: Promise<void> | undefined;
    await act(async () => {
      clearPromise = result.current.cart.onClearCart();
    });

    expect(result.current.cart.items).toHaveLength(1);
    expect(result.current.checkout.cartItems).toHaveLength(1);

    pendingAppend.resolve({ ok: true, value: { localEventId: "local-event-1" } });
    await act(async () => {
      await clearPromise;
    });

    expect(result.current.cart.items).toHaveLength(0);
    expect(result.current.checkout.cartItems).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledWith("Sale cleared");
  });

  it("rolls back optimistic clear-cart removals when a local removal write fails", async () => {
    const pendingAppend = deferred<{
      ok: false;
      error: { message: string };
    }>();
    mockAppendLocalEvent.mockReturnValueOnce(pendingAppend.promise);

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let clearPromise: Promise<void> | undefined;
    await act(async () => {
      clearPromise = result.current.cart.onClearCart();
    });

    expect(result.current.cart.items).toHaveLength(1);

    pendingAppend.resolve({
      ok: false,
      error: { message: "POS local store could not write the local event." },
    });
    await act(async () => {
      await clearPromise;
    });

    expect(result.current.cart.items).toHaveLength(1);
    expect(result.current.cart.items[0].quantity).toBe(1);
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to save this cart update locally.",
    );
  });

  it("saves payment milestones locally for the normal online register path", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });
    const localPaymentId = result.current.checkout.payments[0]?.id;

    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.payments_updated",
        localPosSessionId: "session-1",
        staffProfileId: "staff-1",
        payload: expect.objectContaining({
          checkoutStateVersion: expect.any(Number),
          stage: "paymentAdded",
          paymentMethod: "cash",
          amount: 120,
          payments: [
            expect.objectContaining({
              localPaymentId,
              method: "cash",
              amount: 120,
            }),
          ],
        }),
      }),
    );
    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalled();
  });

  it("does not present a payment draft until the local event is durable", async () => {
    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "session.payments_updated"
        ? {
            ok: false,
            error: { message: "POS local store could not write the local event." },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    expect(result.current.checkout.payments).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to save this payment locally.",
    );

    let completed = true;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(completed).toBe(false);
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "transaction.completed" }),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Payment required. Add payment before completing the sale.",
    );
  });

  it("saves payment edits, removals, and manual clears locally before updating UI state", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 60);
    });
    const paymentId = result.current.checkout.payments[0].id;

    await act(async () => {
      await result.current.checkout.onUpdatePayment(paymentId, 80);
    });

    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ amount: 80, method: "cash" }),
    ]);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.payments_updated",
        payload: expect.objectContaining({
          amount: 80,
          paymentMethod: "cash",
          previousAmount: 60,
          stage: "paymentUpdated",
        }),
      }),
    );

    await act(async () => {
      await result.current.checkout.onRemovePayment(paymentId);
    });

    expect(result.current.checkout.payments).toEqual([]);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.payments_updated",
        payload: expect.objectContaining({
          amount: 80,
          paymentMethod: "cash",
          payments: [],
          stage: "paymentRemoved",
        }),
      }),
    );

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 40);
      await result.current.checkout.onClearPayments();
    });

    expect(result.current.checkout.payments).toEqual([]);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.payments_updated",
        payload: expect.objectContaining({
          payments: [],
          stage: "paymentsCleared",
        }),
      }),
    );
  });

  it("keeps payment edit state unchanged when local update persistence fails", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 60);
    });
    const paymentId = result.current.checkout.payments[0].id;

    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "session.payments_updated"
        ? {
            ok: false,
            error: { message: "POS local store could not write the local event." },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    let updated = true;
    await act(async () => {
      updated = await result.current.checkout.onUpdatePayment(paymentId, 80);
    });

    expect(updated).toBe(false);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ amount: 60, method: "cash" }),
    ]);
  });

  it("keeps same-method payment totals unchanged when the second local write fails", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 60);
    });
    const firstPaymentId = result.current.checkout.payments[0].id;

    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "session.payments_updated"
        ? {
            ok: false,
            error: { message: "POS local store could not write the local event." },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    let added = true;
    await act(async () => {
      added = await result.current.checkout.onAddPayment("cash", 40);
    });

    expect(added).toBe(false);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({
        id: firstPaymentId,
        amount: 60,
        method: "cash",
      }),
    ]);
  });

  it("waits for queued payment edits before completing a local sale", async () => {
    const pendingPaymentUpdate = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) => {
      if (input.type === "session.payments_updated") {
        return pendingPaymentUpdate.promise;
      }
      return Promise.resolve({
        ok: true,
        value: { localEventId: "local-event-1" },
      });
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let addPaymentPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPaymentPromise = result.current.checkout.onAddPayment("cash", 120);
    });
    expect(result.current.checkout.payments).toEqual([]);

    let completed: boolean | undefined;
    let completePromise: Promise<void> | undefined;
    await act(async () => {
      completePromise = result.current.checkout
        .onCompleteTransaction()
        .then((result) => {
          completed = result;
        });
    });

    pendingPaymentUpdate.resolve({
      ok: true,
      value: { localEventId: "local-payment-event-1" },
    });
    await act(async () => {
      await addPaymentPromise;
      await completePromise;
    });

    expect(completed).toBe(true);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "transaction.completed",
        payload: expect.objectContaining({
          payments: [
            expect.objectContaining({
              amount: 120,
              method: "cash",
            }),
          ],
        }),
      }),
    );
  });

  it("rejects payment edits that start while a local completion is in progress", async () => {
    const pendingCompletion = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) => {
      if (input.type === "transaction.completed") {
        return pendingCompletion.promise;
      }
      return Promise.resolve({
        ok: true,
        value: { localEventId: "local-event-1" },
      });
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });
    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });
    const paymentId = result.current.checkout.payments[0].id;

    let completePromise: Promise<boolean> | undefined;
    await act(async () => {
      completePromise = result.current.checkout.onCompleteTransaction();
    });

    let updated = true;
    await act(async () => {
      updated = await result.current.checkout.onUpdatePayment(paymentId, 80);
    });

    pendingCompletion.resolve({
      ok: true,
      value: { localEventId: "local-completion-event-1" },
    });
    await act(async () => {
      await completePromise;
    });

    expect(updated).toBe(false);
    expect(mockAppendLocalEvent.mock.calls.map(([event]) => event.type)).toEqual(
      ["session.payments_updated", "transaction.completed"],
    );
  });

  it("orders clear sale after pending payment writes and blocks later payment edits", async () => {
    const pendingPaymentUpdate = deferred<{
      ok: true;
      value: { localEventId: string };
    }>();
    mockAppendLocalEvent.mockImplementation((input: { type: string }) => {
      if (input.type === "session.payments_updated") {
        return pendingPaymentUpdate.promise;
      }
      return Promise.resolve({
        ok: true,
        value: { localEventId: "local-event-1" },
      });
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let addPaymentPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPaymentPromise = result.current.checkout.onAddPayment("cash", 120);
    });

    let clearPromise: Promise<void> | undefined;
    await act(async () => {
      clearPromise = result.current.cart.onClearCart();
    });

    let addedDuringClear = true;
    await act(async () => {
      addedDuringClear = await result.current.checkout.onAddPayment("card", 80);
    });

    pendingPaymentUpdate.resolve({
      ok: true,
      value: { localEventId: "local-payment-event-1" },
    });
    await act(async () => {
      await addPaymentPromise;
      await clearPromise;
    });

    expect(addedDuringClear).toBe(false);
    expect(mockAppendLocalEvent.mock.calls.map(([event]) => event.type)).toEqual(
      ["session.payments_updated", "cart.cleared"],
    );
    expect(result.current.checkout.payments).toEqual([]);
    expect(result.current.checkout.cartItems).toEqual([]);
  });

  it("keeps local payment draft state but skips payment sync while drawer recovery is required", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: undefined,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    expect(result.current.checkout.payments).toEqual([]);
    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        "[POS] Skipped checkout persistence while drawer recovery is required",
      ),
    );
    consoleWarn.mockRestore();
  });

  it("blocks cart mutation handlers while drawer recovery is required", async () => {
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: null,
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      ...mockActiveSession!,
      registerSessionId: undefined,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.cart.onUpdateQuantity(
        "item-1" as Id<"posSessionItem">,
        2,
      );
      await result.current.cart.onRemoveItem("item-1" as Id<"posSessionItem">);
      await result.current.cart.onClearCart();
    });

    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockRemoveItem).not.toHaveBeenCalled();
    expect(
      mockReleaseSessionInventoryHoldsAndDeleteItems,
    ).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Drawer closed. Open the drawer before updating this sale.",
    );
  });

  it("keeps back-to-back payment additions in sync with the latest checkout state", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 60);
      await result.current.checkout.onAddPayment("card", 60);
    });

    expect(result.current.checkout.payments).toHaveLength(2);
    expect(
      result.current.checkout.payments.map((payment) => payment.method),
    ).toEqual(["cash", "card"]);
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.payments_updated",
        payload: expect.objectContaining({
          checkoutStateVersion: expect.any(Number),
          stage: "paymentAdded",
          payments: [expect.objectContaining({ method: "cash", amount: 60 })],
        }),
      }),
    );
    expect(mockAppendLocalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.payments_updated",
        payload: expect.objectContaining({
          checkoutStateVersion: expect.any(Number),
          stage: "paymentAdded",
          payments: [
            expect.objectContaining({ method: "cash", amount: 60 }),
            expect.objectContaining({ method: "card", amount: 60 }),
          ],
        }),
      }),
    );
    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalled();
  });

  it("saves cleared payments locally when the cart becomes empty after item removal", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
    };

    await act(async () => {
      rerender();
    });

    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session.payments_updated",
          payload: expect.objectContaining({
            stage: "paymentsCleared",
            payments: [],
          }),
        }),
      ),
    );
    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalled();
    expect(result.current.checkout.payments).toEqual([]);
  });

  it("does not show the sale-cleared toast when clearing an already-empty cart", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.cart.onClearCart();
    });

    expect(mockReleaseSessionInventoryHoldsAndDeleteItems).not.toHaveBeenCalled();
    expect(mockAppendLocalEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "cart.item_added" }),
    );
    expect(toast.success).not.toHaveBeenCalledWith("Sale cleared");
  });

  it("completes the transaction without a separate checkout-submitted sync round-trip", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });
    const localPaymentId = result.current.checkout.payments[0]?.id;

    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "checkoutSubmitted",
      }),
    );
    expect(mockCompleteTransaction).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "transaction.completed",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          payload: expect.objectContaining({
            receiptNumber: expect.stringMatching(/^local-txn-/),
            items: [
              expect.objectContaining({
                localItemId: "item-1",
                productSkuId: "sku-1",
                quantity: 1,
                price: 120,
              }),
            ],
            payments: [
              expect.objectContaining({
                localPaymentId,
                method: "cash",
                amount: 120,
              }),
            ],
          }),
        }),
      ),
    );
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
  });

  it("records a pending local sale when cloud completion fails", async () => {
    mockCompleteTransaction.mockResolvedValueOnce(
      userError({
        code: "unavailable",
        message: "Connection unavailable.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    let completed = true;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(completed).toBe(true);
    expect(result.current.checkout.isTransactionCompleted).toBe(true);
    expect(result.current.checkout.completedOrderNumber).toMatch(/^local-txn-/);
    await waitFor(() =>
      expect(mockAppendLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "transaction.completed",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          staffProfileId: "staff-1",
          payload: expect.objectContaining({
            items: [expect.objectContaining({ localItemId: "item-1" })],
            payments: [expect.objectContaining({ method: "cash", amount: 120 })],
          }),
        }),
      ),
    );
    expect(mockMarkLocalEventsSynced).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "Sale completed locally. It will sync when ready.",
    );
  });

  it("does not resurrect a cloud-backed sale after completing it locally", async () => {
    mockCompleteTransaction.mockResolvedValueOnce(
      userError({
        code: "unavailable",
        message: "Connection unavailable.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    act(() => {
      result.current.checkout.onStartNewTransaction();
    });

    await waitFor(() => expect(result.current.checkout.cartItems).toEqual([]));
    expect(result.current.checkout.total).toBe(0);
    expect(result.current.sessionPanel?.activeSessionNumber).toBeNull();
  });

  it("does not resurrect a cloud-backed sale after a reload replays local completion", async () => {
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-session",
          schemaVersion: 1,
          sequence: 2,
          type: "session.started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          staffProfileId: "staff-1",
          payload: { localPosSessionId: "session-1" },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-complete",
          schemaVersion: 1,
          sequence: 3,
          type: "transaction.completed",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          localTransactionId: "local-txn-1",
          staffProfileId: "staff-1",
          payload: {
            localPosSessionId: "session-1",
            localTransactionId: "local-txn-1",
            receiptNumber: "local-txn-1",
            subtotal: 120,
            tax: 0,
            total: 120,
            items: [
              {
                localItemId: "item-1",
                productId: "product-1",
                productSkuId: "sku-1",
                productSku: "",
                productName: "Body Wave",
                price: 120,
                quantity: 1,
              },
            ],
            payments: [{ method: "cash", amount: 120, timestamp: 1_002 }],
          },
          createdAt: 1_002,
          sync: { status: "pending" },
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await waitFor(() => expect(result.current.checkout.cartItems).toEqual([]));
    expect(result.current.checkout.total).toBe(0);
    expect(result.current.sessionPanel?.activeSessionNumber).toBeNull();
  });

  it("does not resurrect a cloud-backed sale after a reload replays local clear", async () => {
    mockListLocalEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "local-event-open",
          schemaVersion: 1,
          sequence: 1,
          type: "register.opened",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          staffProfileId: "staff-1",
          payload: {
            localRegisterSessionId: "drawer-1",
            openingFloat: 5_000,
            expectedCash: 5_000,
          },
          createdAt: 1_000,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-session",
          schemaVersion: 1,
          sequence: 2,
          type: "session.started",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          staffProfileId: "staff-1",
          payload: { localPosSessionId: "session-1" },
          createdAt: 1_001,
          sync: { status: "pending" },
        },
        {
          localEventId: "local-event-clear",
          schemaVersion: 1,
          sequence: 3,
          type: "cart.cleared",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          staffProfileId: "staff-1",
          payload: { localPosSessionId: "session-1" },
          createdAt: 1_002,
          sync: { status: "pending" },
        },
      ],
    });

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await waitFor(() => expect(result.current.checkout.cartItems).toEqual([]));
    expect(result.current.checkout.total).toBe(0);
    expect(result.current.sessionPanel?.activeSessionNumber).toBeNull();
    expect(result.current.sessionPanel?.disableNewSession).toBe(false);
  });

  it("does not complete the sale when the local transaction write fails", async () => {
    mockAppendLocalEvent.mockImplementation(async (input: { type: string }) =>
      input.type === "transaction.completed"
        ? {
            ok: false,
            error: { message: "POS local store could not write the local event." },
          }
        : { ok: true, value: { localEventId: "local-event-1" } },
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.checkout.onAddPayment("cash", 120);
    });

    let completed = true;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(completed).toBe(false);
    expect(result.current.checkout.isTransactionCompleted).toBe(false);
    expect(result.current.checkout.completedOrderNumber).toBeNull();
    expect(result.current.checkout.completedTransactionData).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      "Unable to save this sale locally.",
    );
  });

  it("keeps draft state when holding the current sale fails", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      payments: [{ method: "card", amount: 120, timestamp: 1_000 }],
    };
    mockHoldSession.mockResolvedValueOnce(
      userError({
        code: "conflict",
        message: "Unable to hold this sale right now.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("body wave");
    });

    await act(async () => {
      await result.current.sessionPanel?.onHoldCurrentSession();
    });

    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ method: "card", amount: 120 }),
    ]);
    expect(result.current.customerPanel.customerInfo.name).toBe("Ama Serwa");
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(result.current.productEntry.productSearchQuery).toBe("body wave");
    expect(toast.success).not.toHaveBeenCalledWith("Sale placed on hold.");
  });

  it("keeps draft state and does not start a new sale when auto-hold fails", async () => {
    mockHoldSession.mockResolvedValueOnce(
      userError({
        code: "conflict",
        message: "Unable to hold this sale right now.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.sessionPanel?.onStartNewSession();
    });

    expect(mockStartSession).not.toHaveBeenCalled();
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.customerPanel.customerInfo.name).toBe("Ama Serwa");
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
  });

  it("keeps draft state and does not resume another sale when auto-hold fails", async () => {
    mockHeldSessions = [
      {
        _id: "session-2" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
        sessionNumber: "POS-0002",
        updatedAt: Date.now(),
        cartItems: [],
        customer: null,
      },
    ];
    mockHoldSession.mockResolvedValueOnce(
      userError({
        code: "conflict",
        message: "Unable to hold this sale right now.",
      }),
    );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.sessionPanel?.onResumeSession(
        "session-2" as Id<"posSession">,
      );
    });

    expect(mockResumeSession).not.toHaveBeenCalled();
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.customerPanel.customerInfo.name).toBe("Ama Serwa");
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
  });

  it("commits customer changes through the session update path", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      await result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
    });

    expect(mockUpdateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        staffProfileId: "staff-1",
        customerProfileId: "profile-2",
        customerInfo: {
          name: "Efua Mensah",
          email: "efua@example.com",
          phone: "555-2222",
        },
      }),
    );
  });

  it("commits profile-backed customer attribution through the session update path without resetting sale state", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("deep wave");
    });

    await act(async () => {
      result.current.customerPanel.setCustomerInfo({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
      await result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
    });

    expect(mockUpdateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        staffProfileId: "staff-1",
        customerProfileId: "profile-2",
        customerInfo: {
          name: "Efua Mensah",
          email: "efua@example.com",
          phone: "555-2222",
        },
      }),
    );
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ method: "cash", amount: 120 }),
    ]);
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(result.current.productEntry.productSearchQuery).toBe("deep wave");
    expect(result.current.checkout.isTransactionCompleted).toBe(false);
  });

  it("serializes rapid customer attribution commits so the latest operator action persists last", async () => {
    const firstUpdate = deferred<ReturnType<typeof ok>>();
    mockUpdateSession
      .mockReset()
      .mockImplementationOnce(() => firstUpdate.promise)
      .mockResolvedValue(
        ok({
          sessionId: "session-1" as Id<"posSession">,
          expiresAt: Date.now() + 60_000,
        }),
      );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let firstCommit!: Promise<void>;
    let secondCommit!: Promise<void>;
    await act(async () => {
      firstCommit = result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
      secondCommit = result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-3" as Id<"customerProfile">,
        name: "Kofi Boateng",
        email: "kofi@example.com",
        phone: "555-3333",
      });
      await Promise.resolve();
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    expect(mockUpdateSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        customerProfileId: "profile-2",
      }),
    );

    firstUpdate.resolve(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );

    await act(async () => {
      await Promise.all([firstCommit, secondCommit]);
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(2);
    expect(mockUpdateSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        customerProfileId: "profile-3",
      }),
    );
  });

  it("does not continue queued customer attribution commits after the register view unmounts", async () => {
    const firstUpdate = deferred<ReturnType<typeof ok>>();
    mockUpdateSession
      .mockReset()
      .mockImplementationOnce(() => firstUpdate.promise)
      .mockResolvedValue(
        ok({
          sessionId: "session-1" as Id<"posSession">,
          expiresAt: Date.now() + 60_000,
        }),
      );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, unmount } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let firstCommit!: Promise<void>;
    let secondCommit!: Promise<void>;
    await act(async () => {
      firstCommit = result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
      secondCommit = result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-3" as Id<"customerProfile">,
        name: "Kofi Boateng",
        email: "kofi@example.com",
        phone: "555-3333",
      });
      await Promise.resolve();
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(1);

    unmount();
    firstUpdate.resolve(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );

    await act(async () => {
      await Promise.all([firstCommit, secondCommit]);
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
  });

  it("does not apply queued customer attribution commits to the previous active session", async () => {
    const firstUpdate = deferred<ReturnType<typeof ok>>();
    mockUpdateSession
      .mockReset()
      .mockImplementationOnce(() => firstUpdate.promise)
      .mockResolvedValue(
        ok({
          sessionId: "session-2" as Id<"posSession">,
          expiresAt: Date.now() + 60_000,
        }),
      );

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result, rerender } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    let firstCommit!: Promise<void>;
    await act(async () => {
      firstCommit = result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
      await Promise.resolve();
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    expect(mockUpdateSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionId: "session-1",
        customerProfileId: "profile-2",
      }),
    );

    mockActiveSession = {
      ...mockActiveSession!,
      _id: "session-2" as Id<"posSession">,
      sessionNumber: "SES-002",
    };

    await act(async () => {
      rerender();
    });

    let secondCommit!: Promise<void>;
    await act(async () => {
      secondCommit = result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-3" as Id<"customerProfile">,
        name: "Kofi Boateng",
        email: "kofi@example.com",
        phone: "555-3333",
      });
      await Promise.resolve();
    });

    firstUpdate.resolve(
      ok({
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      }),
    );

    await act(async () => {
      await Promise.all([firstCommit, secondCommit]);
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(2);
    expect(mockUpdateSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionId: "session-2",
        customerProfileId: "profile-3",
      }),
    );
    expect(mockUpdateSession).not.toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        customerProfileId: "profile-3",
      }),
    );
  });

  it("commits name-only attribution as sale-only customer info without customer ids", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      result.current.customerPanel.setCustomerInfo({
        name: "Walk In Buyer",
        email: "",
        phone: "",
      });
      await result.current.customerPanel.onCustomerCommitted({
        name: "Walk In Buyer",
        email: "",
        phone: "",
      });
    });

    expect(mockUpdateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        staffProfileId: "staff-1",
        customerProfileId: undefined,
        customerInfo: {
          name: "Walk In Buyer",
          email: undefined,
          phone: undefined,
        },
      }),
    );
  });

  it("clears persisted attribution while preserving active sale state", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      payments: [{ method: "card", amount: 120, timestamp: 1_000 }],
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("body wave");
    });

    await act(async () => {
      result.current.customerPanel.setCustomerInfo({
        name: "",
        email: "",
        phone: "",
      });
      await result.current.customerPanel.onCustomerCommitted({
        name: "",
        email: "",
        phone: "",
      });
    });

    expect(mockUpdateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        staffProfileId: "staff-1",
        customerProfileId: undefined,
        customerInfo: undefined,
      }),
    );
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ method: "card", amount: 120 }),
    ]);
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(result.current.productEntry.productSearchQuery).toBe("body wave");
    expect(result.current.drawerGate).toBeNull();
    expect(result.current.checkout.isTransactionCompleted).toBe(false);
  });

  it("updates local customer attribution without session mutation when no active session exists", async () => {
    mockRegisterState = {
      phase: "readyToStart",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "staff-1", firstName: "Ama", lastName: "Kusi" },
      activeRegisterSession: {
        _id: "drawer-1",
        status: "open",
        terminalId: "terminal-1",
        registerNumber: "1",
        openingFloat: 5_000,
        expectedCash: 5_000,
        openedAt: Date.now(),
      },
      activeSession: null,
      resumableSession: null,
    };
    mockActiveSession = null;

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    await act(async () => {
      result.current.customerPanel.setCustomerInfo({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
      await result.current.customerPanel.onCustomerCommitted({
        customerProfileId: "profile-2" as Id<"customerProfile">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
    });

    expect(result.current.customerPanel.customerInfo).toEqual({
      customerProfileId: "profile-2",
      name: "Efua Mensah",
      email: "efua@example.com",
      phone: "555-2222",
    });
    expect(mockUpdateSession).not.toHaveBeenCalled();
  });
});
