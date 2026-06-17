import { act, renderHook, waitFor } from "@testing-library/react";
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
const mockReleaseExpenseSessionInventoryHoldsAndDeleteItems = vi.fn();
const mockCompleteExpenseSession = vi.fn();
const mockAddOrUpdateExpenseItem = vi.fn();
const mockRemoveExpenseItem = vi.fn();
const mockNavigateBack = vi.fn();
const catalogGatewayMocks = vi.hoisted(() => ({
  useConvexRegisterCatalog: vi.fn(),
  useConvexRegisterCatalogAvailability: vi.fn(),
}));
const localRuntimeMocks = vi.hoisted(() => ({
  addItem: vi.fn(),
  clearCart: vi.fn(),
  completeExpense: vi.fn(),
  holdSession: vi.fn(),
  removeItem: vi.fn(),
  resumeSession: vi.fn(),
  startSession: vi.fn(),
  updateItem: vi.fn(),
  voidSession: vi.fn(),
  listEvents: vi.fn(),
  hasListEvents: { current: false },
  eventAppendToken: { current: 0 },
}));
const loadedSessionIds: string[] = [];
const realLoadSessionData = useExpenseStore.getState().loadSessionData;
type MockRegisterCatalogRow = {
  id: Id<"productSku"> | Id<"inventoryImportProvisionalSku">;
  productSkuId: Id<"productSku">;
  skuId: Id<"productSku">;
  productId: Id<"product">;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
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
  availabilityPolicy?:
    | "trusted_inventory"
    | "active_provisional_import"
    | "pending_checkout";
};
type MockRegisterCatalogAvailabilityRow = {
  productSkuId: Id<"productSku">;
  skuId: Id<"productSku">;
  inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
  inStock: boolean;
  quantityAvailable: number;
  availabilityPolicy?:
    | "trusted_inventory"
    | "active_provisional_import"
    | "pending_checkout";
};
let mockRegisterCatalogRows: MockRegisterCatalogRow[];
let mockRegisterCatalogAvailabilityRows: MockRegisterCatalogAvailabilityRow[] | undefined;
type ExpenseSessionCartItemFixture = {
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
};

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

vi.mock("@/hooks/useExpenseLocalRuntime", () => ({
  useExpenseLocalRuntime: () => ({
    expenseLocalGateway: localRuntimeMocks,
    eventAppendToken: localRuntimeMocks.eventAppendToken.current,
    localStore: localRuntimeMocks.hasListEvents.current
      ? {
          listEvents: localRuntimeMocks.listEvents,
        }
      : {},
    noteEventAppended: () => {
      localRuntimeMocks.eventAppendToken.current += 1;
    },
    syncRuntime: null,
  }),
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

function buildExpenseCartItem(
  overrides: Partial<ExpenseSessionCartItemFixture> = {},
): ExpenseSessionCartItemFixture {
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

function seedActiveExpenseCart(
  item: ExpenseSessionCartItemFixture = buildExpenseCartItem(),
) {
  const store = useExpenseStore.getState();
  store.setCurrentSessionId("expense-session-1" as Id<"expenseSession">);
  store.setSessionExpiresAt(Date.now() + 60_000);
  store.addToCart({
    id: item._id,
    name: item.productName ?? "Repair kit",
    barcode: item.barcode ?? "1234567890123",
    sku: item.productSku ?? "KIT-1",
    price: item.price ?? 3600,
    quantity: item.quantity,
    image: item.image ?? null,
    size: item.size ?? "",
    length: item.length ?? null,
    color: item.color ?? "",
    productId: item.productId ?? ("product-1" as Id<"product">),
    skuId: item.productSkuId ?? ("product-sku-1" as Id<"productSku">),
  });
  enableLocalExpenseEventReplay();
  localRuntimeMocks.listEvents.mockResolvedValue({
    ok: true,
    value: [
      {
        localEventId: "expense-started-1",
        sequence: 1,
        type: "expense.session_started",
        terminalId: "terminal-1",
        storeId: "store-1",
        staffProfileId: "staff-1",
        createdAt: 100,
        payload: {
          localExpenseSessionId: "expense-session-1",
        },
        sync: { status: "pending" },
      },
      {
        localEventId: item._id,
        sequence: 2,
        type: "expense.item_added",
        terminalId: "terminal-1",
        storeId: "store-1",
        staffProfileId: "staff-1",
        createdAt: item.updatedAt,
        payload: {
          localExpenseSessionId: "expense-session-1",
          localItemId: item._id,
          productId: item.productId ?? "product-1",
          productSkuId: item.productSkuId ?? "product-sku-1",
          productName: item.productName ?? "Repair kit",
          productSku: item.productSku ?? "KIT-1",
          barcode: item.barcode ?? "1234567890123",
          price: item.price ?? 3600,
          quantity: item.quantity,
          image: item.image ?? null,
          size: item.size ?? "",
          length: item.length ?? null,
          color: item.color ?? "",
        },
        sync: { status: "pending" },
      },
    ],
  });
}

function enableLocalExpenseEventReplay() {
  localRuntimeMocks.hasListEvents.current = true;
}

function bumpLocalExpenseEventReplay() {
  localRuntimeMocks.eventAppendToken.current += 1;
}

describe("useExpenseRegisterViewModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadedSessionIds.length = 0;
    useExpenseStore.getState().resetAll();
    useExpenseStore.setState({ loadSessionData: realLoadSessionData });
    useExpenseStore.getState().setCashier("staff-1" as Id<"staffProfile">);
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
        useExpenseStore
          .getState()
          .setCurrentSessionId("expense-session-1" as Id<"expenseSession">);
      }

      return {
        kind: "ok",
        data: {
          sessionId: "expense-session-1" as Id<"expenseSession">,
          expiresAt: Date.now() + 60_000,
        },
      };
    });
    localRuntimeMocks.startSession.mockImplementation(async () => {
      const result = await mockCreateExpenseSession();
      if (result.kind !== "ok") return result;
      return ok({
        localExpenseSessionId: result.data.sessionId,
        status: "active" as const,
        startedAt: Date.now(),
      });
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
        sessionId: "expense-session-1" as Id<"expenseSession">,
        transactionId: "expense-transaction-1" as Id<"expenseTransaction">,
        transactionNumber: "EXP-TXN-1",
        completedAt: new Date("2026-05-20T10:00:00.000Z").getTime(),
      }),
    );
    localRuntimeMocks.addItem.mockImplementation(async (input) => {
      const result = await mockAddOrUpdateExpenseItem(input);
      return result.kind === "ok";
    });
    localRuntimeMocks.updateItem.mockImplementation(async (input) => {
      const result = await mockAddOrUpdateExpenseItem(input);
      return result.kind === "ok";
    });
    localRuntimeMocks.removeItem.mockImplementation(async (input) => {
      const result = await mockRemoveExpenseItem(input);
      return result.kind === "ok";
    });
    localRuntimeMocks.clearCart.mockImplementation(async (input) => {
      const result =
        await mockReleaseExpenseSessionInventoryHoldsAndDeleteItems(input);
      return result.kind === "ok";
    });
    localRuntimeMocks.completeExpense.mockImplementation(async (input) => {
      const result = await mockCompleteExpenseSession(input);
      return result.kind === "ok";
    });
    localRuntimeMocks.holdSession.mockResolvedValue(true);
    localRuntimeMocks.resumeSession.mockResolvedValue(true);
    localRuntimeMocks.voidSession.mockResolvedValue(true);
    localRuntimeMocks.hasListEvents.current = false;
    localRuntimeMocks.eventAppendToken.current = 0;
    localRuntimeMocks.listEvents.mockResolvedValue({
      ok: true,
      value: [],
    });
  });

  it("does not auto-create duplicate sessions while the active-session query is still empty", async () => {
    const { result, rerender } = renderHook(() => useExpenseRegisterViewModel());

    await waitFor(() => {
      expect(mockCreateExpenseSession).toHaveBeenCalledTimes(1);
      expect(result.current.header.isSessionActive).toBe(true);
    });

    rerender();

    await waitFor(() => {
      expect(mockCreateExpenseSession).toHaveBeenCalledTimes(1);
    });
    expect(toast.success).not.toHaveBeenCalledWith(
      "New expense session created",
    );
  });

  it("keeps expense lookup enabled when cashier identity is present but the legacy auth flag drifted", async () => {
    useExpenseStore.setState({
      cashier: {
        id: "staff-1" as Id<"staffProfile">,
        isAuthenticated: false,
        displayName: null,
      },
    });

    const { result } = renderHook(() => useExpenseRegisterViewModel());

    expect(result.current.authDialog).toBeNull();
    expect(result.current.cashierCard).not.toBeNull();
    expect(result.current.onboarding?.cashierSignedIn).toBe(true);
    expect(result.current.productEntry.disabled).toBe(false);

    await waitFor(() => {
      expect(mockCreateExpenseSession).toHaveBeenCalledTimes(1);
    });
  });

  it("does not toast when voiding an expense session on cashier sign out", async () => {
    const { result } = renderHook(() => useExpenseRegisterViewModel());

    await waitFor(() => {
      expect(result.current.header.isSessionActive).toBe(true);
    });

    vi.mocked(toast.success).mockClear();

    await act(async () => {
      await result.current.cashierCard?.onSignOut();
    });

    expect(localRuntimeMocks.voidSession).toHaveBeenCalledWith(
      expect.objectContaining({
        localExpenseSessionId: "expense-session-1",
      }),
    );
    expect(toast.success).not.toHaveBeenCalledWith("Session voided");
  });

  it("keeps expense lookup enabled for a signed-in cashier while replacing a stale session", async () => {
    useExpenseStore
      .getState()
      .setCurrentSessionId("stale-expense-session" as Id<"expenseSession">);

    const { result } = renderHook(() => useExpenseRegisterViewModel());

    await waitFor(() => {
      expect(mockCreateExpenseSession).toHaveBeenCalledTimes(1);
    });
    expect(useExpenseStore.getState().cashier.isAuthenticated).toBe(true);
    expect(result.current.productEntry.disabled).toBe(false);
  });

  it("loads an unchanged local active session only once", async () => {
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
    enableLocalExpenseEventReplay();
    localRuntimeMocks.listEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "expense-started-1",
          sequence: 1,
          type: "expense.session_started",
          terminalId: "terminal-1",
          storeId: "store-1",
          staffProfileId: "staff-1",
          createdAt: 100,
          payload: {
            localExpenseSessionId: "expense-session-1",
          },
          sync: { status: "pending" },
        },
      ],
    });

    const { rerender } = renderHook(() => useExpenseRegisterViewModel());

    await waitFor(() => {
      expect(loadedSessionIds).toEqual(["expense-session-1"]);
    });

    rerender();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadedSessionIds).toEqual(["expense-session-1"]);
  });

  it("rehydrates an active local expense session before creating a new session", async () => {
    enableLocalExpenseEventReplay();
    localRuntimeMocks.listEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "expense-started-1",
          sequence: 1,
          type: "expense.session_started",
          terminalId: "terminal-1",
          storeId: "store-1",
          staffProfileId: "staff-1",
          createdAt: 100,
          payload: {
            localExpenseSessionId: "local-expense-session-1",
          },
          sync: { status: "pending" },
        },
        {
          localEventId: "expense-item-1",
          sequence: 2,
          type: "expense.item_added",
          terminalId: "terminal-1",
          storeId: "store-1",
          staffProfileId: "staff-1",
          createdAt: 110,
          payload: {
            localExpenseSessionId: "local-expense-session-1",
            localItemId: "local-expense-line-1",
            productId: "product-1",
            productSkuId: "product-sku-1",
            productName: "Repair kit",
            productSku: "KIT-1",
            quantity: 1,
            price: 3600,
          },
          sync: { status: "pending" },
        },
      ],
    });

    const { result } = renderHook(() => useExpenseRegisterViewModel());

    await waitFor(() => {
      expect(result.current.header.isSessionActive).toBe(true);
      expect(useExpenseStore.getState().session.currentSessionId).toBe(
        "local-expense-session-1",
      );
      expect(useExpenseStore.getState().cart.items).toEqual([
        expect.objectContaining({
          id: "local-expense-line-1",
          name: "Repair kit",
          quantity: 1,
        }),
      ]);
    });
    expect(mockCreateExpenseSession).not.toHaveBeenCalled();
  });

  it("rehydrates held local expense sessions without expiring old sessions", async () => {
    enableLocalExpenseEventReplay();
    localRuntimeMocks.listEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "expense-started-old",
          sequence: 1,
          type: "expense.session_started",
          terminalId: "terminal-1",
          storeId: "store-1",
          staffProfileId: "staff-1",
          createdAt: 1,
          payload: {
            localExpenseSessionId: "local-expense-held-1",
          },
          sync: { status: "pending" },
        },
        {
          localEventId: "expense-held-old",
          sequence: 2,
          type: "expense.held",
          terminalId: "terminal-1",
          storeId: "store-1",
          staffProfileId: "staff-1",
          createdAt: 2,
          payload: {
            localExpenseSessionId: "local-expense-held-1",
            reason: "waiting_on_receipt",
          },
          sync: { status: "pending" },
        },
      ],
    });

    renderHook(() => useExpenseRegisterViewModel());

    await waitFor(() => {
      expect(useExpenseStore.getState().session.heldSessions).toEqual([
        expect.objectContaining({
          _id: "local-expense-held-1",
        }),
      ]);
    });
  });

  it("ignores local expense events outside the current terminal scope", async () => {
    enableLocalExpenseEventReplay();
    localRuntimeMocks.listEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "foreign-expense-started",
          sequence: 1,
          type: "expense.session_started",
          terminalId: "other-terminal",
          storeId: "store-1",
          staffProfileId: "staff-1",
          createdAt: 100,
          payload: {
            localExpenseSessionId: "foreign-expense-session",
          },
          sync: { status: "pending" },
        },
      ],
    });

    renderHook(() => useExpenseRegisterViewModel());

    await waitFor(() => {
      expect(mockCreateExpenseSession).toHaveBeenCalled();
    });
    expect(useExpenseStore.getState().session.currentSessionId).not.toBe(
      "foreign-expense-session",
    );
  });

  it("identifies the cashier auth dialog as an expense session sign-in", () => {
    useExpenseStore.getState().clearCashier();

    const { result } = renderHook(() => useExpenseRegisterViewModel());

    expect(result.current.authDialog?.workflowMode).toBe("expense");
  });

  it("uses the local register catalog index for text and exact expense search", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow(),
    ];

    const { result } = renderHook(() => useExpenseRegisterViewModel());

    await waitFor(() => {
      expect(mockCreateExpenseSession).toHaveBeenCalledTimes(1);
    });

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
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = undefined;

    const { result, rerender } = renderHook(() =>
      useExpenseRegisterViewModel(),
    );

    await waitFor(() => {
      expect(mockCreateExpenseSession).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("1234567890123");
    });

    expect(result.current.productEntry.searchResults).toEqual([
      expect.objectContaining({
        availabilityMessage:
          "Availability not ready. Reconnect or refresh this terminal before selling this item.",
        availabilityStatus: "unknown",
        skuId: "product-sku-1",
        inStock: false,
        quantityAvailable: undefined,
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow(),
    ];
    rerender();

    await waitFor(() => {
      expect(mockAddOrUpdateExpenseItem).toHaveBeenCalledTimes(1);
    });
    expect(useExpenseStore.getState().ui.productSearchQuery).toBe("");
  });

  it("shows ambiguous exact product matches without auto-adding", async () => {
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

    await waitFor(() => {
      expect(mockCreateExpenseSession).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.productEntry.setProductSearchQuery("product-1");
    });

    expect(result.current.productEntry.searchResults).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockAddOrUpdateExpenseItem).not.toHaveBeenCalled();
  });

  it("auto-adds a single available exact expense match once", async () => {
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

  it("auto-adds exact trusted inventory matches with zero available quantity", async () => {
    mockRegisterCatalogRows = [buildRegisterCatalogRow()];
    mockRegisterCatalogAvailabilityRows = [
      buildRegisterCatalogAvailabilityRow({
        availabilityPolicy: "trusted_inventory",
        inStock: false,
        quantityAvailable: 0,
      }),
    ];

    const { result } = renderHook(() => useExpenseRegisterViewModel());

    act(() => {
      result.current.productEntry.setProductSearchQuery("KIT-1");
    });

    await waitFor(() => {
      expect(mockAddOrUpdateExpenseItem).toHaveBeenCalledWith(
        expect.objectContaining({
          productSkuId: "product-sku-1",
          quantity: 1,
        }),
      );
    });
    expect(useExpenseStore.getState().ui.productSearchQuery).toBe("");
  });

  it.each([
    {
      availabilityPolicy: "active_provisional_import" as const,
      expectedPayload: {
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
      },
      rowOverrides: {
        id: "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
        inventoryImportProvisionalSkuId:
          "provisional-import-sku-1" as Id<"inventoryImportProvisionalSku">,
        availabilityPolicy: "active_provisional_import" as const,
      },
    },
    {
      availabilityPolicy: "pending_checkout" as const,
      expectedPayload: {
        pendingCheckoutItemId:
          "pending-checkout-1" as Id<"posPendingCheckoutItem">,
      },
      rowOverrides: {
        pendingCheckoutItemId:
          "pending-checkout-1" as Id<"posPendingCheckoutItem">,
        availabilityPolicy: "pending_checkout" as const,
      },
    },
  ])(
    "auto-adds exact $availabilityPolicy expense matches with zero trusted quantity",
    async ({ availabilityPolicy, expectedPayload, rowOverrides }) => {
      mockRegisterCatalogRows = [
        buildRegisterCatalogRow({
          ...rowOverrides,
          sku: "EXCEPTION-1",
          barcode: "000111222333",
        }),
      ];
      mockRegisterCatalogAvailabilityRows = [
        buildRegisterCatalogAvailabilityRow({
          ...expectedPayload,
          availabilityPolicy,
          inStock: true,
          quantityAvailable: 0,
        }),
      ];

      const { result } = renderHook(() => useExpenseRegisterViewModel());

      act(() => {
        result.current.productEntry.setProductSearchQuery("EXCEPTION-1");
      });

      await waitFor(() => {
        expect(mockAddOrUpdateExpenseItem).toHaveBeenCalledWith(
          expect.objectContaining({
            productSkuId: "product-sku-1",
            quantity: 1,
            ...expectedPayload,
          }),
        );
      });
      expect(useExpenseStore.getState().ui.productSearchQuery).toBe("");
    },
  );

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
        id: "optimistic:product-sku-2:trusted_inventory",
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

  it("adds the selected product quantity to the expense cart", async () => {
    const { result } = renderHook(() => useExpenseRegisterViewModel());

    await act(async () => {
      await result.current.productEntry.onAddProduct(buildProduct(), 3);
    });

    expect(result.current.cart.items).toEqual([
      expect.objectContaining({
        skuId: "product-sku-2",
        quantity: 3,
      }),
    ]);
    expect(mockAddOrUpdateExpenseItem).toHaveBeenCalledWith(
      expect.objectContaining({
        productSkuId: "product-sku-2",
        quantity: 3,
      }),
    );
  });

  it("keeps optimistic expense items when local replay is still session-only", async () => {
    enableLocalExpenseEventReplay();
    localRuntimeMocks.listEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "expense-started-1",
          sequence: 1,
          type: "expense.session_started",
          terminalId: "terminal-1",
          storeId: "store-1",
          staffProfileId: "staff-1",
          createdAt: 100,
          payload: {
            localExpenseSessionId: "local-expense-session-1",
          },
          sync: { status: "pending" },
        },
      ],
    });

    const { result, rerender } = renderHook(() => useExpenseRegisterViewModel());

    await waitFor(() => {
      expect(useExpenseStore.getState().session.currentSessionId).toBe(
        "local-expense-session-1",
      );
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct(buildProduct());
    });

    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skuId: "product-sku-2",
          quantity: 1,
        }),
      ]),
    );

    const replayCallsBefore = localRuntimeMocks.listEvents.mock.calls.length;
    bumpLocalExpenseEventReplay();
    rerender();

    await waitFor(() => {
      expect(localRuntimeMocks.listEvents.mock.calls.length).toBeGreaterThan(
        replayCallsBefore,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.cart.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skuId: "product-sku-2",
          quantity: 1,
        }),
      ]),
    );
  });

  it("keeps optimistic expense items when local replay is missing only the new item", async () => {
    enableLocalExpenseEventReplay();
    localRuntimeMocks.listEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "expense-started-1",
          sequence: 1,
          type: "expense.session_started",
          terminalId: "terminal-1",
          storeId: "store-1",
          staffProfileId: "staff-1",
          createdAt: 100,
          payload: {
            localExpenseSessionId: "local-expense-session-1",
          },
          sync: { status: "pending" },
        },
      ],
    });

    const { result, rerender } = renderHook(() => useExpenseRegisterViewModel());

    await waitFor(() => {
      expect(useExpenseStore.getState().session.currentSessionId).toBe(
        "local-expense-session-1",
      );
    });

    await act(async () => {
      await result.current.productEntry.onAddProduct(buildProduct());
    });

    localRuntimeMocks.listEvents.mockResolvedValue({
      ok: true,
      value: [
        {
          localEventId: "expense-started-1",
          sequence: 1,
          type: "expense.session_started",
          terminalId: "terminal-1",
          storeId: "store-1",
          staffProfileId: "staff-1",
          createdAt: 100,
          payload: {
            localExpenseSessionId: "local-expense-session-1",
          },
          sync: { status: "pending" },
        },
        {
          localEventId: "expense-existing-item-1",
          sequence: 2,
          type: "expense.item_added",
          terminalId: "terminal-1",
          storeId: "store-1",
          staffProfileId: "staff-1",
          localExpenseSessionId: "local-expense-session-1",
          createdAt: 101,
          payload: {
            localExpenseSessionId: "local-expense-session-1",
            localItemId: "expense-existing-item-1",
            productId: "product-1",
            productSkuId: "product-sku-1",
            productSku: "KIT-1",
            productName: "Repair kit",
            price: 3600,
            quantity: 1,
          },
          sync: { status: "pending" },
        },
      ],
    });
    bumpLocalExpenseEventReplay();
    rerender();

    await waitFor(() => {
      expect(result.current.cart.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            skuId: "product-sku-2",
            quantity: 1,
          }),
        ]),
      );
    });
  });

  it("rolls back optimistic expense product selections when add fails", async () => {
    const pendingAdd = deferred<ReturnType<typeof userError>>();
    mockAddOrUpdateExpenseItem.mockReturnValueOnce(pendingAdd.promise);

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
    expect(toast.error).not.toHaveBeenCalledWith(
      "Shop towels are no longer available.",
    );
  });

  it("rolls back optimistic expense product selections when the add mutation rejects", async () => {
    const pendingAdd = deferred<ReturnType<typeof ok>>();
    mockAddOrUpdateExpenseItem.mockReturnValueOnce(pendingAdd.promise);

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
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("optimistically updates expense cart quantity while the server mutation is pending", async () => {
    const pendingUpdate = deferred<ReturnType<typeof ok>>();
    mockAddOrUpdateExpenseItem.mockReturnValueOnce(pendingUpdate.promise);
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
    expect(toast.error).not.toHaveBeenCalledWith(
      "Only one Repair kit is available.",
    );
  });

  it("rolls back optimistic expense quantity changes when the update mutation rejects", async () => {
    const pendingUpdate = deferred<ReturnType<typeof ok>>();
    mockAddOrUpdateExpenseItem.mockReturnValueOnce(pendingUpdate.promise);
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
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not start a second expense cart mutation while one is pending", async () => {
    const pendingUpdate = deferred<ReturnType<typeof ok>>();
    mockAddOrUpdateExpenseItem.mockReturnValueOnce(pendingUpdate.promise);
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

  it("does not keep a second optimistic cart overlay after the store cart is empty", async () => {
    const { result } = renderHook(() => useExpenseRegisterViewModel());

    await act(async () => {
      await result.current.productEntry.onAddProduct(buildProduct());
    });

    await act(async () => {
      useExpenseStore.getState().replaceCartItems([]);
    });

    expect(result.current.cart.items).toHaveLength(0);
    expect(result.current.checkout.cartItems).toHaveLength(0);
  });

  it("rolls back optimistic expense cart item removals when remove fails", async () => {
    const pendingRemove = deferred<ReturnType<typeof userError>>();
    mockRemoveExpenseItem.mockReturnValueOnce(pendingRemove.promise);
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
    expect(toast.error).not.toHaveBeenCalledWith(
      "Could not remove this expense item.",
    );
  });

  it("rolls back optimistic expense cart item removals when remove rejects", async () => {
    const pendingRemove = deferred<ReturnType<typeof ok>>();
    mockRemoveExpenseItem.mockReturnValueOnce(pendingRemove.promise);
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
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("optimistically clears expense cart items while bulk removal is pending", async () => {
    const pendingClear = deferred<ReturnType<typeof ok>>();
    mockReleaseExpenseSessionInventoryHoldsAndDeleteItems.mockReturnValueOnce(
      pendingClear.promise,
    );
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

  it("preserves completed expense data after completing a session", async () => {
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
    expect(toast.success).not.toHaveBeenCalledWith(
      "Expense recorded successfully",
    );
    expect(state.cart.items).toEqual([]);
    expect(state.cart.total).toBe(0);
    expect(state.session.currentSessionId).toBeNull();
    expect(state.session.activeSession).toBeNull();
    expect(state.session.expiresAt).toBeNull();
    expect(state.transaction.isCompleted).toBe(true);
    expect(state.transaction.completedTransactionNumber).toMatch(
      /^local-expense-event-/,
    );
    expect(state.transaction.completedTransactionData).toMatchObject({
      transactionId: expect.stringMatching(/^local-expense-event-/),
      cartItems: [
        expect.objectContaining({
          name: "Repair kit",
          quantity: 1,
        }),
      ],
      totalValue: 3600,
      notes: "Damaged item",
    });
    expect(state.cashier.isAuthenticated).toBe(true);
    expect(state.ui.notes).toBe("Damaged item");
  });

  it("starts the next expense without signing out the current cashier", async () => {
    const { result, rerender } = renderHook(() => useExpenseRegisterViewModel());

    act(() => {
      useExpenseStore.getState().setTransactionCompleted(true, "EXP-1001", {
        transactionId: "expense-transaction-1" as Id<"expenseTransaction">,
        completedAt: new Date("2026-06-17T12:00:00Z"),
        cartItems: [
          {
            id: "expense-item-1" as Id<"expenseSessionItem">,
            name: "Repair kit",
            barcode: "123",
            sku: "KIT-1",
            price: 3600,
            quantity: 1,
            productId: "product-1" as Id<"product">,
            skuId: "product-sku-1" as Id<"productSku">,
          },
        ],
        totalValue: 3600,
      });
    });
    rerender();

    await act(async () => {
      result.current.checkout.onStartNewTransaction();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(localRuntimeMocks.startSession).toHaveBeenCalled();
    });

    const state = useExpenseStore.getState();
    expect(state.transaction.isCompleted).toBe(false);
    expect(state.cashier.id).toBe("staff-1");
    expect(state.cashier.isAuthenticated).toBe(true);
  });

  it("records completion against the local store session", async () => {
    const { result, rerender } = renderHook(() => useExpenseRegisterViewModel());

    act(() => {
      useExpenseStore
        .getState()
        .setCurrentSessionId("local-expense-session-1" as Id<"expenseSession">);
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

    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    expect(localRuntimeMocks.completeExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        localExpenseSessionId: "local-expense-session-1",
        localExpenseEventId: expect.stringMatching(/^local-expense-event-/),
        items: [
          expect.objectContaining({
            localItemId: expect.stringMatching(
              /^local-expense-event-.+:line:1$/,
            ),
          }),
        ],
      }),
    );
  });

  it("keeps the active expense intact when local completion append fails", async () => {
    localRuntimeMocks.completeExpense.mockResolvedValueOnce(false);

    const { result, rerender } = renderHook(() => useExpenseRegisterViewModel());

    act(() => {
      useExpenseStore
        .getState()
        .setCurrentSessionId("expense-session-1" as Id<"expenseSession">);
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

    await act(async () => {
      await result.current.checkout.onCompleteTransaction();
    });

    const state = useExpenseStore.getState();
    expect(toast.error).toHaveBeenCalledWith(
      "Could not record this expense locally.",
    );
    expect(state.transaction.isCompleted).toBe(false);
    expect(state.session.currentSessionId).toBe("expense-session-1");
    expect(state.cart.items).toHaveLength(1);
  });
});
