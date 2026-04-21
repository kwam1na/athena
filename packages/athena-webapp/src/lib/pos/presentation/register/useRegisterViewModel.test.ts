import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";

const mockUseQuery = vi.fn();
const mockCreateSession = vi.fn();
const mockHoldSession = vi.fn();
const mockReleaseInventoryHoldsAndDeleteItems = vi.fn();
const mockHandleResumeSession = vi.fn();
const mockHandleHoldCurrentSession = vi.fn();
const mockHandleVoidSession = vi.fn();
const mockTransactionProcessPayment = vi.fn();
const mockTransactionStartNewTransaction = vi.fn();
const mockNavigateBack = vi.fn();
const mockCartOperations = {
  addProduct: vi.fn(),
  addFromBarcode: vi.fn(),
  updateQuantity: vi.fn(),
  removeItem: vi.fn(),
  clearCart: vi.fn(),
};
const mockCustomerOperations = {
  updateCustomerInfo: vi.fn(),
  clearCustomer: vi.fn(),
};

let mockStore: ReturnType<typeof createMockStore>;
let mockActiveStore: { _id: Id<"store">; currency: string } | null;
let mockTerminal:
  | {
      _id: Id<"posTerminal">;
      displayName: string;
    }
  | null;
let mockActiveSession:
  | {
      _id: Id<"posSession">;
      status: "active";
      expiresAt: number;
      sessionNumber: string;
      cartItems: [];
    }
  | null;
let mockHeldSessions:
  | {
      _id: Id<"posSession">;
      sessionNumber: string;
      cartItems: [];
    }[]
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

vi.mock("@/hooks/useCartOperations", () => ({
  useCartOperations: () => mockCartOperations,
}));

vi.mock("@/hooks/useCustomerOperations", () => ({
  useCustomerOperations: () => mockCustomerOperations,
}));

vi.mock("@/hooks/usePOSOperations", () => ({
  usePOSOperations: () => ({
    transaction: {
      processPayment: mockTransactionProcessPayment,
      startNewTransaction: mockTransactionStartNewTransaction,
    },
  }),
}));

vi.mock("@/hooks/useGetTerminal", () => ({
  useGetTerminal: () => mockTerminal,
}));

vi.mock("@/hooks/use-navigate-back", () => ({
  useNavigateBack: () => mockNavigateBack,
}));

vi.mock("@/hooks/usePOSSessions", () => ({
  usePOSActiveSession: () => mockActiveSession,
  usePOSStoreSessions: () => mockHeldSessions,
}));

vi.mock("@/hooks/usePOSProducts", () => ({
  usePOSBarcodeSearch: () => mockBarcodeSearchResult,
  usePOSProductIdSearch: () => mockProductIdSearchResults,
}));

vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: (value: string) => value,
}));

vi.mock("@/hooks/useSessionManagement", () => ({
  useSessionManagement: () => ({
    createSession: mockCreateSession,
    holdSession: mockHoldSession,
    releaseSessionInventoryHoldsAndDeleteItems:
      mockReleaseInventoryHoldsAndDeleteItems,
  }),
}));

vi.mock("@/hooks/useSessionManagerOperations", () => ({
  useSessionManagerOperations: () => ({
    handleResumeSession: mockHandleResumeSession,
    handleHoldCurrentSession: mockHandleHoldCurrentSession,
    handleVoidSession: mockHandleVoidSession,
  }),
}));

vi.mock("@/stores/posStore", () => ({
  usePOSStore: () => mockStore,
}));

function createMockStore() {
  return {
    cart: {
      items: [
        {
          id: "item-1",
          name: "Body Wave",
          barcode: "1234567890",
          price: 120,
          quantity: 1,
          productId: "product-1",
          skuId: "sku-1",
        },
      ],
      subtotal: 120,
      tax: 0,
      total: 120,
    },
    customer: {
      current: {
        customerId: "customer-1",
        name: "Ama Serwa",
        email: "ama@example.com",
        phone: "555-0100",
      },
    },
    payment: {
      payments: [
        {
          id: "payment-1",
          method: "cash" as const,
          amount: 120,
          timestamp: 1,
        },
      ],
    },
    session: {
      currentSessionId: "session-1",
      activeSession: null,
      isCreating: false,
    },
    transaction: {
      isCompleted: false,
      completedOrderNumber: null,
      completedTransactionData: null,
    },
    cashier: {
      id: "cashier-1" as Id<"cashier"> | null,
      isAuthenticated: true,
    },
    ui: {
      registerNumber: "2",
      showCustomerPanel: true,
      showProductEntry: true,
      productSearchQuery: "",
    },
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    addPayment: vi.fn(),
    updatePayment: vi.fn(),
    removePayment: vi.fn(),
    clearPayments: vi.fn(),
    setStoreId: vi.fn(),
    setTerminalId: vi.fn(),
    loadSessionData: vi.fn(),
    startNewTransaction: vi.fn(),
    setCurrentSessionId: vi.fn(),
    setActiveSession: vi.fn(),
    clearCashier: vi.fn(),
    clearCart: vi.fn(),
    setCashier: vi.fn(),
    setShowCustomerPanel: vi.fn(),
    setShowProductEntry: vi.fn(),
    setProductSearchQuery: vi.fn(),
  };
}

describe("useRegisterViewModel", () => {
  beforeEach(() => {
    mockStore = createMockStore();
    mockActiveStore = {
      _id: "store-1" as Id<"store">,
      currency: "GHS",
    };
    mockTerminal = {
      _id: "terminal-1" as Id<"posTerminal">,
      displayName: "Front Counter",
    };
    mockActiveSession = {
      _id: "session-1" as Id<"posSession">,
      status: "active",
      expiresAt: Date.now() + 60_000,
      sessionNumber: "POS-0001",
      cartItems: [],
    };
    mockHeldSessions = [];
    mockBarcodeSearchResult = null;
    mockProductIdSearchResults = null;
    mockCashier = {
      firstName: "Ama",
      lastName: "Kusi",
    };

    mockUseQuery.mockImplementation(() => mockCashier);
    mockCreateSession.mockReset();
    mockHoldSession.mockReset();
    mockHoldSession.mockResolvedValue({ success: true });
    mockReleaseInventoryHoldsAndDeleteItems.mockReset();
    mockReleaseInventoryHoldsAndDeleteItems.mockResolvedValue({
      success: true,
    });
    mockHandleResumeSession.mockReset();
    mockHandleHoldCurrentSession.mockReset();
    mockHandleHoldCurrentSession.mockResolvedValue({ success: true });
    mockHandleVoidSession.mockReset();
    mockHandleVoidSession.mockResolvedValue({ success: true });
    mockTransactionProcessPayment.mockReset();
    mockTransactionProcessPayment.mockResolvedValue({ success: true });
    mockTransactionStartNewTransaction.mockReset();
    mockNavigateBack.mockReset();
    Object.values(mockCartOperations).forEach((fn) => fn.mockReset());
    Object.values(mockCustomerOperations).forEach((fn) => fn.mockReset());
  });

  it("maps register state into shell-ready props", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    expect(result.current.header.isSessionActive).toBe(true);
    expect(result.current.registerInfo.registerLabel).toBe("Front Counter");
    expect(result.current.checkout.payments).toEqual(
      mockStore.payment.payments,
    );
    expect(result.current.cashierCard?.cashierName).toBe("Ama K.");
    expect(result.current.authDialog?.open).toBe(false);
  });

  it("holds the active POS session before signing the cashier out when items are present", async () => {
    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    await act(async () => {
      await result.current.cashierCard?.onSignOut();
    });

    expect(mockHandleHoldCurrentSession).toHaveBeenCalledWith("Signing out");
    expect(mockHandleVoidSession).not.toHaveBeenCalled();
    expect(mockStore.clearCashier).toHaveBeenCalled();
  });

  it("opens the cashier auth dialog when a terminal exists but no cashier is signed in", async () => {
    mockStore.cashier = {
      id: null as Id<"cashier"> | null,
      isAuthenticated: false,
    };

    const { useRegisterViewModel } = await import("./useRegisterViewModel");
    const { result } = renderHook(() => useRegisterViewModel());

    expect(result.current.authDialog?.open).toBe(true);
    expect(result.current.cashierCard).toBeNull();
  });
});
