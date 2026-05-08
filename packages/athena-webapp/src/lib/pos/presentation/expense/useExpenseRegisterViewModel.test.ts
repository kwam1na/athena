import { act, renderHook, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import { ok, userError } from "~/shared/commandResult";
import { useExpenseStore } from "@/stores/expenseStore";
import { useExpenseRegisterViewModel } from "./useExpenseRegisterViewModel";

const mockCreateExpenseSession = vi.fn();
const mockUpdateExpenseSession = vi.fn();
const mockHoldExpenseSession = vi.fn();
const mockResumeExpenseSession = vi.fn();
const mockVoidExpenseSession = vi.fn();
const mockReleaseExpenseSessionInventoryHoldsAndDeleteItems = vi.fn();
const mockCompleteExpenseSession = vi.fn();
const mockAddOrUpdateExpenseItem = vi.fn();
const mockRemoveExpenseItem = vi.fn();
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

function buildActiveExpenseSession(
  cartItems: NonNullable<typeof mockActiveSessionQuery>["cartItems"] = [],
  overrides: Partial<NonNullable<typeof mockActiveSessionQuery>> = {},
) {
  return {
    _id: "expense-session-1" as Id<"expenseSession">,
    status: "active" as const,
    expiresAt: Date.now() + 60_000,
    sessionNumber: "EXP-0001",
    updatedAt: 100,
    cartItems,
    ...overrides,
  };
}

function buildExpenseCartItem(
  overrides: Partial<
    NonNullable<typeof mockActiveSessionQuery>["cartItems"][number]
  > = {},
): NonNullable<typeof mockActiveSessionQuery>["cartItems"][number] {
  return {
    _id: "expense-item-1" as Id<"expenseSessionItem">,
    quantity: 1,
    updatedAt: 100,
    productName: "Repair kit",
    productSku: "KIT-1",
    barcode: "1234567890123",
    price: 3600,
    image: null,
    size: "",
    length: null,
    color: "",
    productId: "product-1" as Id<"product">,
    productSkuId: "product-sku-1" as Id<"productSku">,
    ...overrides,
  };
}

function buildProduct(overrides = {}) {
  return {
    id: "product-sku-2",
    name: "Shop towels",
    price: 1200,
    barcode: "9876543210123",
    productId: "product-2" as Id<"product">,
    skuId: "product-sku-2" as Id<"productSku">,
    sku: "TOWEL-1",
    category: "Supplies",
    description: "",
    image: null,
    inStock: true,
    quantityAvailable: 5,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function seedActiveExpenseCart() {
  const store = useExpenseStore.getState();
  store.setCurrentSessionId("expense-session-1" as Id<"expenseSession">);
  store.setSessionExpiresAt(Date.now() + 60_000);
  store.addToCart({
    id: "expense-item-1" as Id<"expenseSessionItem">,
    name: "Repair kit",
    barcode: "1234567890123",
    sku: "KIT-1",
    price: 3600,
    quantity: 1,
    image: null,
    size: "",
    length: null,
    color: "",
    productId: "product-1" as Id<"product">,
    skuId: "product-sku-1" as Id<"productSku">,
  });
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
    mockAddOrUpdateExpenseItem.mockResolvedValue(
      ok({
        itemId: "expense-item-1" as Id<"expenseSessionItem">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockRemoveExpenseItem.mockResolvedValue(
      ok({
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockReleaseExpenseSessionInventoryHoldsAndDeleteItems.mockResolvedValue(
      ok({
        sessionId: "expense-session-1" as Id<"expenseSession">,
      }),
    );
    mockCompleteExpenseSession.mockResolvedValue(
      ok({
        transactionNumber: "EXP-TXN-1",
      }),
    );
    vi.mocked(useMutation).mockImplementation((mutation) => {
      const mutationName = getFunctionName(mutation);
      if (mutationName === "inventory/expenseSessions:createExpenseSession") {
        return mockCreateExpenseSession as never;
      }
      if (mutationName === "inventory/expenseSessions:updateExpenseSession") {
        return mockUpdateExpenseSession as never;
      }
      if (mutationName === "inventory/expenseSessions:holdExpenseSession") {
        return mockHoldExpenseSession as never;
      }
      if (mutationName === "inventory/expenseSessions:resumeExpenseSession") {
        return mockResumeExpenseSession as never;
      }
      if (mutationName === "inventory/expenseSessions:voidExpenseSession") {
        return mockVoidExpenseSession as never;
      }
      if (
        mutationName ===
        "inventory/expenseSessions:releaseExpenseSessionInventoryHoldsAndDeleteItems"
      ) {
        return mockReleaseExpenseSessionInventoryHoldsAndDeleteItems as never;
      }
      if (mutationName === "inventory/expenseSessions:completeExpenseSession") {
        return mockCompleteExpenseSession as never;
      }
      if (
        mutationName ===
        "inventory/expenseSessionItems:addOrUpdateExpenseItem"
      ) {
        return mockAddOrUpdateExpenseItem as never;
      }
      if (mutationName === "inventory/expenseSessionItems:removeExpenseItem") {
        return mockRemoveExpenseItem as never;
      }

      return vi.fn() as never;
    });
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
      expect(mockAddOrUpdateExpenseItem).toHaveBeenCalledTimes(1);
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
      expect(mockAddOrUpdateExpenseItem).toHaveBeenCalledTimes(1);
    });
    expect(useExpenseStore.getState().ui.productSearchQuery).toBe("");

    rerender();
    expect(mockAddOrUpdateExpenseItem).toHaveBeenCalledTimes(1);
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

  it("optimistically adds expense product selections while the server mutation is pending", async () => {
    const pendingAdd = deferred<ReturnType<typeof ok>>();
    mockAddOrUpdateExpenseItem.mockReturnValueOnce(pendingAdd.promise);
    mockActiveSessionQuery = buildActiveExpenseSession();

    const { result, rerender } = renderHook(() => useExpenseRegisterViewModel());

    let addPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPromise = result.current.productEntry.onAddProduct(buildProduct());
    });

    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Shop towels",
          skuId: "product-sku-2",
          quantity: 1,
        }),
      ]),
    );
    expect(result.current.checkout.cartItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skuId: "product-sku-2",
          quantity: 1,
        }),
      ]),
    );

    mockActiveSessionQuery = buildActiveExpenseSession([], {
      updatedAt: 101,
    });
    rerender();
    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skuId: "product-sku-2",
          quantity: 1,
        }),
      ]),
    );

    pendingAdd.resolve(
      ok({
        itemId: "expense-item-2" as Id<"expenseSessionItem">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    await act(async () => {
      await addPromise;
    });

    expect(result.current.cart.items).toEqual([
      expect.objectContaining({
        id: "expense-item-2",
        skuId: "product-sku-2",
        quantity: 1,
      }),
    ]);
    expect(result.current.cart.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "optimistic:product-sku-2",
        }),
      ]),
    );
  });

  it("rolls back optimistic expense product selections when add fails", async () => {
    const pendingAdd = deferred<ReturnType<typeof userError>>();
    mockAddOrUpdateExpenseItem.mockReturnValueOnce(pendingAdd.promise);
    mockActiveSessionQuery = buildActiveExpenseSession();

    const { result } = renderHook(() => useExpenseRegisterViewModel());

    let addPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPromise = result.current.productEntry.onAddProduct(buildProduct());
    });

    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skuId: "product-sku-2",
        }),
      ]),
    );

    pendingAdd.resolve(
      userError({
        code: "conflict",
        message: "Shop towels are no longer available.",
      }),
    );
    await act(async () => {
      await addPromise;
    });

    expect(result.current.cart.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skuId: "product-sku-2",
        }),
      ]),
    );
    expect(result.current.checkout.cartItems).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skuId: "product-sku-2",
        }),
      ]),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Shop towels are no longer available.",
    );
  });

  it("rolls back optimistic expense product selections when the add mutation rejects", async () => {
    const pendingAdd = deferred<ReturnType<typeof ok>>();
    mockAddOrUpdateExpenseItem.mockReturnValueOnce(pendingAdd.promise);
    mockActiveSessionQuery = buildActiveExpenseSession();

    const { result } = renderHook(() => useExpenseRegisterViewModel());

    let addPromise: Promise<boolean> | undefined;
    await act(async () => {
      addPromise = result.current.productEntry.onAddProduct(buildProduct());
    });

    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skuId: "product-sku-2",
        }),
      ]),
    );

    pendingAdd.reject(new Error("network unavailable"));
    await act(async () => {
      await addPromise;
    });

    expect(result.current.cart.items).toEqual([]);
    expect(useExpenseStore.getState().session.isUpdating).toBe(false);
    expect(toast.error).toHaveBeenCalled();
  });

  it("optimistically updates expense cart quantity while the server mutation is pending", async () => {
    const pendingUpdate = deferred<ReturnType<typeof ok>>();
    mockAddOrUpdateExpenseItem.mockReturnValueOnce(pendingUpdate.promise);
    mockActiveSessionQuery = buildActiveExpenseSession([
      buildExpenseCartItem(),
    ]);
    seedActiveExpenseCart();

    const { result } = renderHook(() => useExpenseRegisterViewModel());
    await waitFor(() => {
      expect(result.current.cart.items).toHaveLength(1);
    });

    let updatePromise: Promise<void> | undefined;
    await act(async () => {
      updatePromise = result.current.cart.onUpdateQuantity(
        "expense-item-1" as Id<"expenseSessionItem">,
        2,
      );
    });

    expect(result.current.cart.items[0].quantity).toBe(2);
    expect(result.current.checkout.cartItems[0].quantity).toBe(2);

    pendingUpdate.resolve(
      ok({
        itemId: "expense-item-1" as Id<"expenseSessionItem">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    await act(async () => {
      await updatePromise;
    });
  });

  it("rolls back optimistic expense quantity changes when the update fails", async () => {
    const pendingUpdate = deferred<ReturnType<typeof userError>>();
    mockAddOrUpdateExpenseItem.mockReturnValueOnce(pendingUpdate.promise);
    mockActiveSessionQuery = buildActiveExpenseSession([
      buildExpenseCartItem(),
    ]);
    seedActiveExpenseCart();

    const { result } = renderHook(() => useExpenseRegisterViewModel());
    await waitFor(() => {
      expect(result.current.cart.items).toHaveLength(1);
    });

    let updatePromise: Promise<void> | undefined;
    await act(async () => {
      updatePromise = result.current.cart.onUpdateQuantity(
        "expense-item-1" as Id<"expenseSessionItem">,
        2,
      );
    });

    expect(result.current.cart.items[0].quantity).toBe(2);

    pendingUpdate.resolve(
      userError({
        code: "conflict",
        message: "Only one Repair kit is available.",
      }),
    );
    await act(async () => {
      await updatePromise;
    });

    expect(result.current.cart.items[0].quantity).toBe(1);
    expect(result.current.checkout.cartItems[0].quantity).toBe(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Only one Repair kit is available.",
    );
  });

  it("rolls back optimistic expense quantity changes when the update mutation rejects", async () => {
    const pendingUpdate = deferred<ReturnType<typeof ok>>();
    mockAddOrUpdateExpenseItem.mockReturnValueOnce(pendingUpdate.promise);
    mockActiveSessionQuery = buildActiveExpenseSession([
      buildExpenseCartItem(),
    ]);
    seedActiveExpenseCart();

    const { result } = renderHook(() => useExpenseRegisterViewModel());
    await waitFor(() => {
      expect(result.current.cart.items).toHaveLength(1);
    });

    let updatePromise: Promise<void> | undefined;
    await act(async () => {
      updatePromise = result.current.cart.onUpdateQuantity(
        "expense-item-1" as Id<"expenseSessionItem">,
        2,
      );
    });

    expect(result.current.cart.items[0].quantity).toBe(2);

    pendingUpdate.reject(new Error("network unavailable"));
    await act(async () => {
      await updatePromise;
    });

    expect(result.current.cart.items[0].quantity).toBe(1);
    expect(useExpenseStore.getState().session.isUpdating).toBe(false);
    expect(toast.error).toHaveBeenCalled();
  });

  it("does not start a second expense cart mutation while one is pending", async () => {
    const pendingUpdate = deferred<ReturnType<typeof ok>>();
    mockAddOrUpdateExpenseItem.mockReturnValueOnce(pendingUpdate.promise);
    mockActiveSessionQuery = buildActiveExpenseSession([
      buildExpenseCartItem(),
    ]);
    seedActiveExpenseCart();

    const { result, rerender } = renderHook(() => useExpenseRegisterViewModel());
    await waitFor(() => {
      expect(result.current.cart.items).toHaveLength(1);
    });

    let updatePromise: Promise<void> | undefined;
    await act(async () => {
      updatePromise = result.current.cart.onUpdateQuantity(
        "expense-item-1" as Id<"expenseSessionItem">,
        2,
      );
    });

    expect(result.current.cart.items[0].quantity).toBe(2);

    await act(async () => {
      await result.current.cart.onRemoveItem(
        "expense-item-1" as Id<"expenseSessionItem">,
      );
    });

    expect(mockRemoveExpenseItem).not.toHaveBeenCalled();
    expect(result.current.cart.items[0].quantity).toBe(2);

    mockActiveSessionQuery = buildActiveExpenseSession([buildExpenseCartItem()], {
      updatedAt: 101,
    });
    rerender();
    expect(result.current.cart.items[0].quantity).toBe(2);

    pendingUpdate.resolve(
      ok({
        itemId: "expense-item-1" as Id<"expenseSessionItem">,
        expiresAt: Date.now() + 60_000,
      }),
    );
    await act(async () => {
      await updatePromise;
    });
  });

  it("optimistically removes expense cart items while the server mutation is pending", async () => {
    const pendingRemove = deferred<ReturnType<typeof ok>>();
    mockRemoveExpenseItem.mockReturnValueOnce(pendingRemove.promise);
    mockActiveSessionQuery = buildActiveExpenseSession([
      buildExpenseCartItem(),
    ]);
    seedActiveExpenseCart();

    const { result, rerender } = renderHook(() => useExpenseRegisterViewModel());
    await waitFor(() => {
      expect(result.current.cart.items).toHaveLength(1);
    });

    let removePromise: Promise<void> | undefined;
    await act(async () => {
      removePromise = result.current.cart.onRemoveItem(
        "expense-item-1" as Id<"expenseSessionItem">,
      );
    });

    expect(result.current.cart.items).toHaveLength(0);
    expect(result.current.checkout.cartItems).toHaveLength(0);

    mockActiveSessionQuery = buildActiveExpenseSession([buildExpenseCartItem()], {
      updatedAt: 101,
    });
    rerender();
    expect(result.current.cart.items).toHaveLength(0);
    expect(result.current.checkout.cartItems).toHaveLength(0);

    pendingRemove.resolve(
      ok({
        expiresAt: Date.now() + 60_000,
      }),
    );
    await act(async () => {
      await removePromise;
    });
  });

  it("rolls back optimistic expense cart item removals when remove fails", async () => {
    const pendingRemove = deferred<ReturnType<typeof userError>>();
    mockRemoveExpenseItem.mockReturnValueOnce(pendingRemove.promise);
    mockActiveSessionQuery = buildActiveExpenseSession([
      buildExpenseCartItem(),
    ]);
    seedActiveExpenseCart();

    const { result } = renderHook(() => useExpenseRegisterViewModel());
    await waitFor(() => {
      expect(result.current.cart.items).toHaveLength(1);
    });

    let removePromise: Promise<void> | undefined;
    await act(async () => {
      removePromise = result.current.cart.onRemoveItem(
        "expense-item-1" as Id<"expenseSessionItem">,
      );
    });

    expect(result.current.cart.items).toHaveLength(0);

    pendingRemove.resolve(
      userError({
        code: "conflict",
        message: "Could not remove this expense item.",
      }),
    );
    await act(async () => {
      await removePromise;
    });

    expect(result.current.cart.items).toHaveLength(1);
    expect(result.current.cart.items[0].quantity).toBe(1);
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Could not remove this expense item.",
    );
  });

  it("rolls back optimistic expense cart item removals when remove rejects", async () => {
    const pendingRemove = deferred<ReturnType<typeof ok>>();
    mockRemoveExpenseItem.mockReturnValueOnce(pendingRemove.promise);
    mockActiveSessionQuery = buildActiveExpenseSession([
      buildExpenseCartItem(),
    ]);
    seedActiveExpenseCart();

    const { result } = renderHook(() => useExpenseRegisterViewModel());
    await waitFor(() => {
      expect(result.current.cart.items).toHaveLength(1);
    });

    let removePromise: Promise<void> | undefined;
    await act(async () => {
      removePromise = result.current.cart.onRemoveItem(
        "expense-item-1" as Id<"expenseSessionItem">,
      );
    });

    expect(result.current.cart.items).toHaveLength(0);

    pendingRemove.reject(new Error("network unavailable"));
    await act(async () => {
      await removePromise;
    });

    expect(result.current.cart.items).toHaveLength(1);
    expect(useExpenseStore.getState().session.isUpdating).toBe(false);
    expect(toast.error).toHaveBeenCalled();
  });

  it("optimistically clears expense cart items while bulk removal is pending", async () => {
    const pendingClear = deferred<ReturnType<typeof ok>>();
    mockReleaseExpenseSessionInventoryHoldsAndDeleteItems.mockReturnValueOnce(
      pendingClear.promise,
    );
    mockActiveSessionQuery = buildActiveExpenseSession([
      buildExpenseCartItem(),
    ]);
    seedActiveExpenseCart();

    const { result } = renderHook(() => useExpenseRegisterViewModel());
    await waitFor(() => {
      expect(result.current.cart.items).toHaveLength(1);
    });

    let clearPromise: Promise<void> | undefined;
    await act(async () => {
      clearPromise = result.current.cart.onClearCart();
    });

    expect(result.current.cart.items).toHaveLength(0);
    expect(result.current.checkout.cartItems).toHaveLength(0);

    pendingClear.resolve(
      ok({
        sessionId: "expense-session-1" as Id<"expenseSession">,
      }),
    );
    await act(async () => {
      await clearPromise;
    });
  });

  it("rolls back optimistic expense clear-cart removals when bulk removal fails", async () => {
    const pendingClear = deferred<ReturnType<typeof userError>>();
    mockReleaseExpenseSessionInventoryHoldsAndDeleteItems.mockReturnValueOnce(
      pendingClear.promise,
    );
    mockActiveSessionQuery = buildActiveExpenseSession([
      buildExpenseCartItem(),
    ]);
    seedActiveExpenseCart();

    const { result } = renderHook(() => useExpenseRegisterViewModel());
    await waitFor(() => {
      expect(result.current.cart.items).toHaveLength(1);
    });

    let clearPromise: Promise<void> | undefined;
    await act(async () => {
      clearPromise = result.current.cart.onClearCart();
    });

    expect(result.current.cart.items).toHaveLength(0);

    pendingClear.resolve(
      userError({
        code: "conflict",
        message: "Could not clear this expense cart.",
      }),
    );
    await act(async () => {
      await clearPromise;
    });

    expect(result.current.cart.items).toHaveLength(1);
    expect(result.current.cart.items[0].quantity).toBe(1);
    expect(result.current.checkout.cartItems).toHaveLength(1);
    expect(toast.error).toHaveBeenCalled();
  });

  it("rolls back optimistic expense clear-cart removals when bulk removal rejects", async () => {
    const pendingClear = deferred<{ success: true }>();
    mockReleaseExpenseSessionInventoryHoldsAndDeleteItems.mockReturnValueOnce(
      pendingClear.promise,
    );
    mockActiveSessionQuery = buildActiveExpenseSession([
      buildExpenseCartItem(),
    ]);
    seedActiveExpenseCart();

    const { result } = renderHook(() => useExpenseRegisterViewModel());
    await waitFor(() => {
      expect(result.current.cart.items).toHaveLength(1);
    });

    let clearPromise: Promise<void> | undefined;
    await act(async () => {
      clearPromise = result.current.cart.onClearCart();
    });

    expect(result.current.cart.items).toHaveLength(0);

    pendingClear.reject(new Error("network unavailable"));
    await act(async () => {
      await clearPromise;
    });

    expect(result.current.cart.items).toHaveLength(1);
    expect(useExpenseStore.getState().session.isUpdating).toBe(false);
    expect(toast.error).toHaveBeenCalled();
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
