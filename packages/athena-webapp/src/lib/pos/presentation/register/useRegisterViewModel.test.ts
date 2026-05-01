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
const mockReopenRegisterSessionCloseout = vi.fn();
const mockCorrectRegisterSessionOpeningFloat = vi.fn();
const mockNavigateBack = vi.fn();

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
        activeRoles?: Array<"manager" | "front_desk" | "stylist" | "technician" | "cashier">;
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
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

    mockUseQuery.mockImplementation(() => mockCashier);
    mockUseMutation.mockReset();
    mockUseMutation.mockImplementation(
      () => (args: Record<string, unknown>) => {
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
    expect(result.current.authDialog?.open).toBe(false);
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
    expect(result.current.drawerGate?.closeoutSubmittedCountedCash).toBe(4_500);
    expect(result.current.drawerGate?.closeoutSubmittedVariance).toBe(-500);
  });

  it("submits closeout from the POS drawer gate with the current cashier", async () => {
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
      result.current.drawerGate?.onCloseoutNotesChange?.("End of shift count");
    });

    expect(result.current.drawerGate?.closeoutDraftVariance).toBe(-200);

    await act(async () => {
      await result.current.drawerGate?.onSubmitCloseout?.();
    });

    expect(mockSubmitRegisterSessionCloseout).toHaveBeenCalledWith({
      actorStaffProfileId: "staff-1",
      actorUserId: "user-1",
      countedCash: 4_800,
      notes: "End of shift count",
      registerSessionId: "drawer-1",
      storeId: "store-1",
    });
    expect(toast.success).toHaveBeenCalledWith("Register session closed");
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
    expect(
      result.current.closeoutControl?.canShowOpeningFloatCorrection,
    ).toBe(true);
    expect(result.current.closeoutControl?.canCorrectOpeningFloat).toBe(true);

    await act(async () => {
      await result.current.sessionPanel?.onStartNewSession();
      result.current.closeoutControl?.onRequestCloseout();
      result.current.closeoutControl?.onRequestOpeningFloatCorrection();
    });

    expect(result.current.drawerGate).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      "Cashier already has an active session on another terminal.",
    );
  });

  it("starts a new active sale after other-terminal sessions have expired", async () => {
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

    await waitFor(() => {
      expect(mockStartSession).toHaveBeenCalledWith({
        storeId: "store-1",
        terminalId: "terminal-1",
        staffProfileId: "staff-1",
        registerNumber: "1",
        registerSessionId: "drawer-1",
      });
    });
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

    expect(
      result.current.closeoutControl?.canShowOpeningFloatCorrection,
    ).toBe(true);
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

    await act(async () => {
      await result.current.drawerGate?.onReopenRegister?.();
    });

    expect(mockReopenRegisterSessionCloseout).toHaveBeenCalledWith({
      actorStaffProfileId: "staff-1",
      actorUserId: "user-1",
      registerSessionId: "drawer-1",
      storeId: "store-1",
    });
    expect(toast.success).toHaveBeenCalledWith("Register reopened.");
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

    act(() => {
      result.current.checkout.onAddPayment("cash", 120);
    });

    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalled();
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

  it("opens the drawer and resumes bootstrap with the bound register session id", async () => {
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

    expect(mockOpenDrawer).toHaveBeenCalledWith({
      storeId: "store-1",
      terminalId: "terminal-1",
      staffProfileId: "staff-1",
      registerNumber: "1",
      openingFloat: 5_000,
      notes: "Opening float ready",
    });
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

    expect(mockStartSession).toHaveBeenCalledWith({
      storeId: "store-1",
      terminalId: "terminal-1",
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "drawer-2",
    });
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
    expect(
      result.current.closeoutControl?.canShowOpeningFloatCorrection,
    ).toBe(false);
    expect(result.current.closeoutControl?.canCorrectOpeningFloat).toBe(false);
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
    mockOpenDrawer.mockResolvedValueOnce(
      userError({
        code: "conflict",
        message: "A register session is already open for this terminal.",
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
      result.current.drawerGate?.onOpeningFloatChange?.("50.00");
    });

    await act(async () => {
      await result.current.drawerGate?.onSubmit?.();
    });

    expect(result.current.drawerGate).not.toBeNull();
    expect(result.current.drawerGate?.errorMessage).toBe(
      "Drawer already open for this register. Return to the active sale or review it in Cash Controls.",
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
    expect(toast.success).not.toHaveBeenCalledWith("Sale cleared.");
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
    expect(toast.success).toHaveBeenCalledWith("Sale cleared.");
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

  it("syncs payment milestones through the checkout-state mutation", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.checkout.onAddPayment("cash", 120);
    });

    expect(mockSyncSessionCheckoutState).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        staffProfileId: "staff-1",
        checkoutStateVersion: expect.any(Number),
        stage: "paymentAdded",
        paymentMethod: "cash",
        amount: 120,
        payments: [
          expect.objectContaining({
            method: "cash",
            amount: 120,
          }),
        ],
      }),
    );
  });

  it("keeps local payment draft state but skips payment sync while drawer recovery is required", async () => {
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

    act(() => {
      result.current.checkout.onAddPayment("cash", 120);
    });

    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ method: "cash", amount: 120 }),
    ]);
    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalled();
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

    act(() => {
      result.current.checkout.onAddPayment("cash", 60);
      result.current.checkout.onAddPayment("card", 60);
    });

    expect(result.current.checkout.payments).toHaveLength(2);
    expect(
      result.current.checkout.payments.map((payment) => payment.method),
    ).toEqual(["cash", "card"]);
    expect(mockSyncSessionCheckoutState).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        checkoutStateVersion: expect.any(Number),
        stage: "paymentAdded",
        payments: [expect.objectContaining({ method: "cash", amount: 60 })],
      }),
    );
    expect(mockSyncSessionCheckoutState).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        checkoutStateVersion: expect.any(Number),
        stage: "paymentAdded",
        payments: [
          expect.objectContaining({ method: "cash", amount: 60 }),
          expect.objectContaining({ method: "card", amount: 60 }),
        ],
      }),
    );
  });

  it("syncs cleared payments when the cart becomes empty after item removal", async () => {
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

    expect(mockSyncSessionCheckoutState).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "paymentsCleared",
        payments: [],
      }),
    );
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

    expect(
      mockReleaseSessionInventoryHoldsAndDeleteItems,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        staffProfileId: "staff-1",
      }),
    );
    expect(toast.success).not.toHaveBeenCalledWith("Sale cleared.");
  });

  it("completes the transaction without a separate checkout-submitted sync round-trip", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated(
        "staff-1" as Id<"staffProfile">,
      );
    });

    act(() => {
      result.current.checkout.onAddPayment("cash", 120);
    });

    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    expect(mockSyncSessionCheckoutState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "checkoutSubmitted",
      }),
    );
    expect(mockCompleteTransaction).toHaveBeenCalled();
  });

  it("keeps the sale editable when completion fails", async () => {
    mockCompleteTransaction.mockResolvedValueOnce(
      userError({
        code: "conflict",
        message: "Open the cash drawer before completing this sale.",
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
      result.current.checkout.onAddPayment("cash", 120);
    });

    let completed = true;
    await act(async () => {
      completed = await result.current.checkout.onCompleteTransaction();
    });

    expect(completed).toBe(false);
    expect(result.current.checkout.isTransactionCompleted).toBe(false);
    expect(result.current.checkout.completedOrderNumber).toBeNull();
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(result.current.checkout.payments).toEqual([
      expect.objectContaining({ method: "cash", amount: 120 }),
    ]);
    expect(result.current.productEntry.disabled).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "Drawer closed. Open the drawer before completing this sale.",
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
