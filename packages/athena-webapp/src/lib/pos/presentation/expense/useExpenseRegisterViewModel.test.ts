import { act, renderHook, waitFor } from "@testing-library/react";
import { useMutation, useQuery } from "convex/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import { useExpenseStore } from "@/stores/expenseStore";
import { useExpenseRegisterViewModel } from "./useExpenseRegisterViewModel";

const mockCreateExpenseSession = vi.fn();
const mockNavigateBack = vi.fn();
const catalogGatewayMocks = vi.hoisted(() => ({
  useConvexRegisterCatalog: vi.fn(),
  useConvexRegisterCatalogAvailability: vi.fn(),
}));
const loadedSessionIds: string[] = [];
type MockRegisterCatalogRow = {
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
};
type MockRegisterCatalogAvailabilityRow = {
  productSkuId: Id<"productSku">;
  skuId: Id<"productSku">;
  inStock: boolean;
  quantityAvailable: number;
};
let mockRegisterCatalogRows: MockRegisterCatalogRow[];
let mockRegisterCatalogAvailabilityRows: MockRegisterCatalogAvailabilityRow[] | undefined;
let mockActiveSessionQuery: {
  _id: Id<"expenseSession">;
  status: "active";
  expiresAt: number;
  sessionNumber: string;
  updatedAt: number;
  notes?: string;
  cartItems: Array<{
    _id: Id<"expenseSessionItem">;
    quantity: number;
    updatedAt: number;
    productName?: string;
    productSku?: string;
    barcode?: string;
    price?: number;
    image?: string | null;
    size?: string;
    length?: number | null;
    color?: string;
    productId?: Id<"product">;
    productSkuId?: Id<"productSku">;
  }>;
} | null;

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: {
      _id: "store-1" as Id<"store">,
      currency: "GHS",
    },
  }),
}));

vi.mock("@/hooks/useGetTerminal", () => ({
  useGetTerminal: () => ({
    _id: "terminal-1" as Id<"posTerminal">,
    displayName: "Front Counter",
    registerNumber: "1",
  }),
}));

vi.mock("@/hooks/use-navigate-back", () => ({
  useNavigateBack: () => mockNavigateBack,
}));

vi.mock("@/lib/pos/infrastructure/convex/catalogGateway", () => ({
  useConvexRegisterCatalog: catalogGatewayMocks.useConvexRegisterCatalog,
  useConvexRegisterCatalogAvailability:
    catalogGatewayMocks.useConvexRegisterCatalogAvailability,
}));

vi.mock("@/hooks/usePOSProducts", () => ({
  usePOSBarcodeSearch: () => {
    throw new Error("Expense register search must use the local catalog index");
  },
  usePOSProductSearch: () => {
    throw new Error("Expense register search must use the local catalog index");
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function buildRegisterCatalogRow(
  overrides: Partial<MockRegisterCatalogRow> = {},
): MockRegisterCatalogRow {
  return {
    id: "product-sku-1" as Id<"productSku">,
    productSkuId: "product-sku-1" as Id<"productSku">,
    skuId: "product-sku-1" as Id<"productSku">,
    productId: "product-1" as Id<"product">,
    name: "Repair kit",
    sku: "KIT-1",
    barcode: "1234567890123",
    price: 3600,
    category: "Supplies",
    description: "",
    image: null,
    size: "",
    length: null,
    color: "",
    areProcessingFeesAbsorbed: false,
    ...overrides,
  };
}

function buildRegisterCatalogAvailabilityRow(
  overrides: Partial<MockRegisterCatalogAvailabilityRow> = {},
): MockRegisterCatalogAvailabilityRow {
  return {
    productSkuId: "product-sku-1" as Id<"productSku">,
    skuId: "product-sku-1" as Id<"productSku">,
    inStock: true,
    quantityAvailable: 3,
    ...overrides,
  };
}

describe("useExpenseRegisterViewModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadedSessionIds.length = 0;
    useExpenseStore.getState().resetAll();
    useExpenseStore.getState().setCashier("staff-1" as Id<"staffProfile">);
    mockActiveSessionQuery = null;
    mockRegisterCatalogRows = [];
    mockRegisterCatalogAvailabilityRows = [];
    catalogGatewayMocks.useConvexRegisterCatalog.mockImplementation(
      () => mockRegisterCatalogRows,
    );
    catalogGatewayMocks.useConvexRegisterCatalogAvailability.mockImplementation(
      () => mockRegisterCatalogAvailabilityRows,
    );

    mockCreateExpenseSession.mockImplementation(async () => {
      const callCount = mockCreateExpenseSession.mock.calls.length;
      if (callCount >= 2) {
        mockActiveSessionQuery = {
          _id: "expense-session-1" as Id<"expenseSession">,
          status: "active",
          expiresAt: Date.now() + 60_000,
          sessionNumber: "EXP-0001",
          updatedAt: 100,
          cartItems: [],
        };
      }

      return {
        kind: "ok",
        data: {
          sessionId: "expense-session-1" as Id<"expenseSession">,
          expiresAt: Date.now() + 60_000,
        },
      };
    });
    vi.mocked(useMutation).mockReturnValue(mockCreateExpenseSession as never);
    vi.mocked(useQuery).mockImplementation(() => mockActiveSessionQuery);
  });

  it("does not auto-create duplicate sessions while the active-session query is still empty", async () => {
    const { rerender } = renderHook(() => useExpenseRegisterViewModel());

    await waitFor(() => {
      expect(mockCreateExpenseSession).toHaveBeenCalledTimes(1);
    });

    rerender();

    await waitFor(() => {
      expect(mockCreateExpenseSession).toHaveBeenCalledTimes(1);
    });
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("New expense session created");
  });

  it("loads an unchanged active session only once", async () => {
    useExpenseStore.setState((state) => ({
      ...state,
      loadSessionData: (session: { _id: Id<"expenseSession"> }) => {
        loadedSessionIds.push(session._id);
        useExpenseStore.setState((currentState) => ({
          ...currentState,
          session: {
            ...currentState.session,
            currentSessionId: session._id,
          },
        }));
      },
    }));
    mockActiveSessionQuery = {
      _id: "expense-session-1" as Id<"expenseSession">,
      status: "active",
      expiresAt: Date.now() + 60_000,
      sessionNumber: "EXP-0001",
      updatedAt: 100,
      cartItems: [],
    };

    const { rerender } = renderHook(() => useExpenseRegisterViewModel());

    await waitFor(() => {
      expect(loadedSessionIds).toEqual(["expense-session-1"]);
    });

    rerender();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadedSessionIds).toEqual(["expense-session-1"]);
  });

  it("identifies the cashier auth dialog as an expense session sign-in", () => {
    useExpenseStore.getState().clearCashier();

    const { result } = renderHook(() => useExpenseRegisterViewModel());

    expect(result.current.authDialog?.workflowMode).toBe("expense");
  });

  it("uses the local register catalog index for text and exact expense search", () => {
    mockActiveSessionQuery = {
      _id: "expense-session-1" as Id<"expenseSession">,
      status: "active",
      expiresAt: Date.now() + 60_000,
      sessionNumber: "EXP-0001",
      updatedAt: 100,
      cartItems: [],
    };
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow(),
    ];

    const { result } = renderHook(() => useExpenseRegisterViewModel());

    act(() => {
      result.current.productEntry.setProductSearchQuery("repair");
    });

    expect(result.current.productEntry.searchResults).toEqual([
      expect.objectContaining({
        name: "Repair kit",
        skuId: "product-sku-1",
        quantityAvailable: 3,
      }),
    ]);
    expect(catalogGatewayMocks.useConvexRegisterCatalog).toHaveBeenCalledWith({
      storeId: "store-1",
    });
    expect(
      catalogGatewayMocks.useConvexRegisterCatalogAvailability,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        storeId: "store-1",
        productSkuIds: ["product-sku-1"],
      }),
    );

    expect(result.current.productEntry.isSearchReady).toBe(true);
    expect(result.current.drawerGate).toBeNull();
  });

  it("keeps exact matches visible without auto-adding until availability loads", async () => {
    mockActiveSessionQuery = {
      _id: "expense-session-1" as Id<"expenseSession">,
      status: "active",
      expiresAt: Date.now() + 60_000,
      sessionNumber: "EXP-0001",
      updatedAt: 100,
      cartItems: [],
    };
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = undefined;

    const { result, rerender } = renderHook(() =>
      useExpenseRegisterViewModel(),
    );

    act(() => {
      result.current.productEntry.setProductSearchQuery("1234567890123");
    });

    expect(result.current.productEntry.searchResults).toEqual([
      expect.objectContaining({
        skuId: "product-sku-1",
        inStock: false,
        quantityAvailable: 0,
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockCreateExpenseSession).not.toHaveBeenCalled();

    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow(),
    ];
    rerender();

    await waitFor(() => {
      expect(mockCreateExpenseSession).toHaveBeenCalledTimes(1);
    });
    expect(useExpenseStore.getState().ui.productSearchQuery).toBe("");
  });

  it("keeps out-of-stock exact matches visible without auto-adding", async () => {
    mockActiveSessionQuery = {
      _id: "expense-session-1" as Id<"expenseSession">,
      status: "active",
      expiresAt: Date.now() + 60_000,
      sessionNumber: "EXP-0001",
      updatedAt: 100,
      cartItems: [],
    };
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        inStock: false,
        quantityAvailable: 0,
      }),
    ];

    const { result } = renderHook(() => useExpenseRegisterViewModel());

    act(() => {
      result.current.productEntry.setProductSearchQuery("KIT-1");
    });

    expect(result.current.productEntry.searchResults).toEqual([
      expect.objectContaining({
        skuId: "product-sku-1",
        inStock: false,
        quantityAvailable: 0,
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockCreateExpenseSession).not.toHaveBeenCalled();
  });

  it("shows ambiguous exact product matches without auto-adding", async () => {
    mockActiveSessionQuery = {
      _id: "expense-session-1" as Id<"expenseSession">,
      status: "active",
      expiresAt: Date.now() + 60_000,
      sessionNumber: "EXP-0001",
      updatedAt: 100,
      cartItems: [],
    };
    mockRegisterCatalogRows = [
      buildRegisterCatalogRow(),
      buildRegisterCatalogRow({
        id: "product-sku-2" as Id<"productSku">,
        productSkuId: "product-sku-2" as Id<"productSku">,
        skuId: "product-sku-2" as Id<"productSku">,
        sku: "KIT-2",
        barcode: "9876543210123",
      }),
    ];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow(),
      buildRegisterCatalogAvailabilityRow({
        productSkuId: "product-sku-2" as Id<"productSku">,
        skuId: "product-sku-2" as Id<"productSku">,
      }),
    ];

    const { result } = renderHook(() => useExpenseRegisterViewModel());

    act(() => {
      result.current.productEntry.setProductSearchQuery("product-1");
    });

    expect(result.current.productEntry.searchResults).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockCreateExpenseSession).not.toHaveBeenCalled();
  });

  it("auto-adds a single available exact expense match once", async () => {
    mockActiveSessionQuery = {
      _id: "expense-session-1" as Id<"expenseSession">,
      status: "active",
      expiresAt: Date.now() + 60_000,
      sessionNumber: "EXP-0001",
      updatedAt: 100,
      cartItems: [],
    };
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow(),
    ];

    const { result, rerender } = renderHook(() =>
      useExpenseRegisterViewModel(),
    );

    act(() => {
      result.current.productEntry.setProductSearchQuery("1234567890123");
    });

    await waitFor(() => {
      expect(mockCreateExpenseSession).toHaveBeenCalledTimes(1);
    });
    expect(useExpenseStore.getState().ui.productSearchQuery).toBe("");

    rerender();
    expect(mockCreateExpenseSession).toHaveBeenCalledTimes(1);
  });

  it("does not depend on legacy POS product search hooks", () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(currentDir, "useExpenseRegisterViewModel.ts"),
      "utf8",
    );

    expect(source).not.toContain("usePOSProductSearch");
    expect(source).not.toContain("usePOSBarcodeSearch");
  });

  it("clears expense totals and transaction state after completing a session", async () => {
    mockActiveSessionQuery = {
      _id: "expense-session-1" as Id<"expenseSession">,
      status: "active",
      expiresAt: Date.now() + 60_000,
      sessionNumber: "EXP-0001",
      updatedAt: 100,
      notes: "Damaged item",
      cartItems: [],
    };

    const { result, rerender } = renderHook(() => useExpenseRegisterViewModel());

    act(() => {
      useExpenseStore
        .getState()
        .setCurrentSessionId("expense-session-1" as Id<"expenseSession">);
      useExpenseStore.getState().setSessionExpiresAt(Date.now() + 60_000);
      useExpenseStore.getState().setNotes("Damaged item");
      useExpenseStore.getState().addToCart({
        id: "expense-item-1" as Id<"expenseSessionItem">,
        name: "Repair kit",
        barcode: "123",
        sku: "KIT-1",
        price: 3600,
        quantity: 1,
        image: null,
        productId: "product-1" as Id<"product">,
        skuId: "product-sku-1" as Id<"productSku">,
      });
    });
    rerender();

    expect(useExpenseStore.getState().cart.total).toBeGreaterThan(0);

    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    const state = useExpenseStore.getState();
    expect(toast.success).toHaveBeenCalledWith("Expense recorded successfully");
    expect(state.cart.items).toEqual([]);
    expect(state.cart.total).toBe(0);
    expect(state.session.currentSessionId).toBeNull();
    expect(state.session.activeSession).toBeNull();
    expect(state.session.expiresAt).toBeNull();
    expect(state.transaction.isCompleted).toBe(false);
    expect(state.transaction.completedTransactionData).toBeNull();
    expect(state.cashier.isAuthenticated).toBe(false);
    expect(state.ui.notes).toBe("");
  });
});
