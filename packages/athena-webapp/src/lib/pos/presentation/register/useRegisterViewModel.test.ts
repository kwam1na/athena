import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";

const mockUseQuery = vi.fn();
const mockStartSession = vi.fn();
const mockAddItem = vi.fn();
const mockHoldSession = vi.fn();
const mockCompleteTransaction = vi.fn();
const mockResumeSession = vi.fn();
const mockVoidSession = vi.fn();
const mockUpdateSession = vi.fn();
const mockSyncSessionCheckoutState = vi.fn();
const mockReleaseSessionInventoryHoldsAndDeleteItems = vi.fn();
const mockRemoveItem = vi.fn();
const mockNavigateBack = vi.fn();

let mockActiveStore: { _id: Id<"store">; currency: string } | null;
let mockTerminal:
  | {
      _id: Id<"posTerminal">;
      displayName: string;
    }
  | null
  | undefined;
let mockRegisterState:
  | {
      phase: "requiresCashier" | "readyToStart" | "resumable" | "active";
      terminal: { _id: string; displayName: string } | null;
      cashier: { _id: string; firstName: string; lastName: string } | null;
      activeSession: { _id: string; sessionNumber: string } | null;
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
      customer:
        | {
            _id: Id<"posCustomer">;
            name: string;
            email?: string;
            phone?: string;
          }
        | null;
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

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
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
  }),
}));

vi.mock("@/lib/pos/infrastructure/convex/commandGateway", () => ({
  useConvexCommandGateway: () => ({
    startSession: mockStartSession,
    addItem: mockAddItem,
    holdSession: mockHoldSession,
    completeTransaction: mockCompleteTransaction,
  }),
}));

describe("useRegisterViewModel", () => {
  beforeEach(() => {
    mockActiveStore = {
      _id: "store-1" as Id<"store">,
      currency: "GHS",
    };
    mockTerminal = {
      _id: "terminal-1" as Id<"posTerminal">,
      displayName: "Front Counter",
    };
    mockRegisterState = {
      phase: "active",
      terminal: { _id: "terminal-1", displayName: "Front Counter" },
      cashier: { _id: "cashier-1", firstName: "Ama", lastName: "Kusi" },
      activeSession: { _id: "session-1", sessionNumber: "POS-0001" },
      resumableSession: null,
    };
    mockActiveSession = {
      _id: "session-1" as Id<"posSession">,
      status: "active",
      expiresAt: Date.now() + 60_000,
      sessionNumber: "POS-0001",
      updatedAt: Date.now(),
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
      },
    };
    mockHeldSessions = [];
    mockBarcodeSearchResult = null;
    mockProductIdSearchResults = null;
    mockCashier = {
      firstName: "Ama",
      lastName: "Kusi",
    };

    mockUseQuery.mockImplementation(() => mockCashier);
    mockStartSession.mockReset();
    mockStartSession.mockResolvedValue({
      success: true,
      data: {
        sessionId: "session-2" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      },
    });
    mockAddItem.mockReset();
    mockAddItem.mockResolvedValue({
      success: true,
      data: {
        itemId: "item-2" as Id<"posSessionItem">,
        expiresAt: Date.now() + 60_000,
      },
    });
    mockHoldSession.mockReset();
    mockHoldSession.mockResolvedValue({
      success: true,
      data: {
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      },
    });
    mockCompleteTransaction.mockReset();
    mockCompleteTransaction.mockResolvedValue({
      success: true,
      data: {
        sessionId: "session-1" as Id<"posSession">,
        transactionNumber: "TXN-0001",
      },
    });
    mockResumeSession.mockReset();
    mockResumeSession.mockResolvedValue({
      success: true,
      data: {
        sessionId: "session-2" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      },
    });
    mockVoidSession.mockReset();
    mockVoidSession.mockResolvedValue({
      success: true,
      data: {
        sessionId: "session-1" as Id<"posSession">,
      },
    });
    mockUpdateSession.mockReset();
    mockUpdateSession.mockResolvedValue({
      sessionId: "session-1" as Id<"posSession">,
      expiresAt: Date.now() + 60_000,
    });
    mockSyncSessionCheckoutState.mockReset();
    mockSyncSessionCheckoutState.mockResolvedValue({
      success: true,
      data: {
        sessionId: "session-1" as Id<"posSession">,
        expiresAt: Date.now() + 60_000,
      },
    });
    mockReleaseSessionInventoryHoldsAndDeleteItems.mockReset();
    mockReleaseSessionInventoryHoldsAndDeleteItems.mockResolvedValue({
      success: true,
      data: {
        sessionId: "session-1" as Id<"posSession">,
      },
    });
    mockRemoveItem.mockReset();
    mockRemoveItem.mockResolvedValue({
      success: true,
      data: {
        expiresAt: Date.now() + 60_000,
      },
    });
    mockNavigateBack.mockReset();
  });

  it("maps register state into shell-ready props without the legacy store", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated("cashier-1" as Id<"cashier">);
    });

    expect(result.current.header.isSessionActive).toBe(true);
    expect(result.current.registerInfo.registerLabel).toBe("Front Counter");
    expect(result.current.checkout.payments).toEqual([]);
    expect(result.current.checkout.total).toBe(120);
    expect(result.current.customerPanel.customerInfo.name).toBe("Ama Serwa");
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(result.current.authDialog?.open).toBe(false);
  });

  it("holds the active POS session before signing the cashier out when session data is present", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated("cashier-1" as Id<"cashier">);
    });

    await act(async () => {
      await result.current.cashierCard?.onSignOut();
    });

    expect(mockUpdateSession).toHaveBeenCalled();
    expect(mockHoldSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      cashierId: "cashier-1",
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

  it("does not void an empty active session when navigating away", async () => {
    mockActiveSession = {
      ...mockActiveSession!,
      cartItems: [],
      customer: null,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated("cashier-1" as Id<"cashier">);
    });

    await act(async () => {
      await result.current.onNavigateBack();
    });

    expect(mockHoldSession).not.toHaveBeenCalled();
    expect(mockVoidSession).not.toHaveBeenCalled();
    expect(mockNavigateBack).toHaveBeenCalled();
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
      result.current.authDialog?.onAuthenticated("cashier-1" as Id<"cashier">);
    });

    await act(async () => {
      await result.current.sessionPanel?.onResumeSession(
        "session-2" as Id<"posSession">,
      );
    });

    expect(mockVoidSession).not.toHaveBeenCalled();
    expect(mockResumeSession).toHaveBeenCalledWith({
      sessionId: "session-2",
      cashierId: "cashier-1",
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
      result.current.authDialog?.onAuthenticated("cashier-1" as Id<"cashier">);
    });

    expect(result.current.sessionPanel?.canHoldSession).toBe(false);

    await act(async () => {
      await result.current.onNavigateBack();
    });

    expect(mockHoldSession).not.toHaveBeenCalled();
    expect(mockNavigateBack).toHaveBeenCalled();
  });

  it("does not require the legacy register store or orchestration hooks", () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(currentDir, "useRegisterViewModel.ts"), "utf8");

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
      result.current.authDialog?.onAuthenticated("cashier-1" as Id<"cashier">);
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
      result.current.authDialog?.onAuthenticated("cashier-1" as Id<"cashier">);
    });

    act(() => {
      result.current.checkout.onAddPayment("cash", 120);
    });

    expect(mockSyncSessionCheckoutState).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        cashierId: "cashier-1",
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

  it("keeps back-to-back payment additions in sync with the latest checkout state", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated("cashier-1" as Id<"cashier">);
    });

    act(() => {
      result.current.checkout.onAddPayment("cash", 60);
      result.current.checkout.onAddPayment("card", 60);
    });

    expect(result.current.checkout.payments).toHaveLength(2);
    expect(result.current.checkout.payments.map((payment) => payment.method)).toEqual([
      "cash",
      "card",
    ]);
    expect(mockSyncSessionCheckoutState).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stage: "paymentAdded",
        payments: [expect.objectContaining({ method: "cash", amount: 60 })],
      }),
    );
    expect(mockSyncSessionCheckoutState).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        stage: "paymentAdded",
        payments: [
          expect.objectContaining({ method: "cash", amount: 60 }),
          expect.objectContaining({ method: "card", amount: 60 }),
        ],
      }),
    );
  });

  it("records checkout submission before completing the transaction", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated("cashier-1" as Id<"cashier">);
    });

    act(() => {
      result.current.checkout.onAddPayment("cash", 120);
    });

    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    expect(mockSyncSessionCheckoutState).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        cashierId: "cashier-1",
        stage: "checkoutSubmitted",
      }),
    );
    expect(mockCompleteTransaction).toHaveBeenCalled();
  });

  it("commits customer changes through the session update path", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      result.current.authDialog?.onAuthenticated("cashier-1" as Id<"cashier">);
    });

    await act(async () => {
      await result.current.customerPanel.onCustomerCommitted({
        customerId: "customer-2" as Id<"posCustomer">,
        name: "Efua Mensah",
        email: "efua@example.com",
        phone: "555-2222",
      });
    });

    expect(mockUpdateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        cashierId: "cashier-1",
        customerId: "customer-2",
        customerInfo: {
          name: "Efua Mensah",
          email: "efua@example.com",
          phone: "555-2222",
        },
      }),
    );
  });
});
