import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";

import type { StaffAuthenticationResult } from "@/components/staff-auth/StaffAuthenticationDialog";
import { useExpenseActiveSession } from "@/hooks/useExpenseSessions";
import { useExpenseOperations } from "@/hooks/useExpenseOperations";
import { useSessionManagementExpense } from "@/hooks/useSessionManagementExpense";
import { useExpenseLocalRuntime } from "@/hooks/useExpenseLocalRuntime";
import { useExpenseStore } from "@/stores/expenseStore";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useGetTerminal } from "@/hooks/useGetTerminal";
import { useNavigateBack } from "@/hooks/use-navigate-back";
import {
  useConvexRegisterCatalog,
  useConvexRegisterCatalogAvailability,
} from "@/lib/pos/infrastructure/convex/catalogGateway";
import {
  searchRegisterCatalog,
  type RegisterCatalogSearchResult,
} from "@/lib/pos/presentation/register/catalogSearch";
import {
  mapCatalogRowToProduct,
  normalizeExactInput,
  type RegisterCatalogAvailability,
} from "@/lib/pos/presentation/register/catalogSearchPresentation";
import { useRegisterCatalogIndex } from "@/lib/pos/presentation/register/useRegisterCatalogIndex";
import { logger } from "@/lib/logger";
import { toast } from "sonner";
import { api } from "~/convex/_generated/api";
import { EMPTY_REGISTER_CUSTOMER_INFO } from "@/lib/pos/presentation/register/registerUiState";
import type { RegisterViewModel } from "@/lib/pos/presentation/register/registerUiState";
import type { Id } from "~/convex/_generated/dataModel";
import { formatStaffDisplayNameOrFallback } from "~/shared/staffDisplayName";
import type { CartItem } from "@/components/pos/types";
import {
  projectExpenseLocalReadModel,
  type ExpenseLocalSessionReadModel,
} from "@/lib/pos/infrastructure/local/expenseReadModel";
import type { PosLocalEventRecord } from "@/lib/pos/infrastructure/local/posLocalStore";

function getCashierDisplayName(staffProfile?: {
  firstName?: string;
  lastName?: string;
  fullName?: string;
}) {
  if (!staffProfile) {
    return "Unassigned";
  }

  return formatStaffDisplayNameOrFallback(staffProfile, "Unassigned");
}

function isExpenseProductCartItem(item: CartItem): item is CartItem & {
  productId: Id<"product">;
  skuId: Id<"productSku">;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
} {
  return Boolean(item.productId && item.skuId);
}

function localExpenseSessionToStoreSession(session: ExpenseLocalSessionReadModel) {
  return {
    _id: session.localExpenseSessionId as Id<"expenseSession">,
    expiresAt: null,
    notes: session.notes,
    cartItems: session.items.map((item) => ({
      _id: item.localItemId as Id<"expenseSessionItem">,
      quantity: item.quantity,
      updatedAt: session.updatedAt,
      productName: item.productName,
      productSku: item.productSku,
      barcode: item.barcode,
      price: item.price,
      image: item.image,
      size: item.size,
      length: item.length,
      color: item.color,
      productId: item.productId as Id<"product">,
      productSkuId: item.productSkuId as Id<"productSku">,
      pendingCheckoutItemId:
        item.pendingCheckoutItemId as Id<"posPendingCheckoutItem"> | undefined,
      inventoryImportProvisionalSkuId:
        item.inventoryImportProvisionalSkuId as
          | Id<"inventoryImportProvisionalSku">
          | undefined,
    })),
  };
}

function localExpenseSessionsToStoreSessions(
  sessions: ExpenseLocalSessionReadModel[],
) {
  return sessions.map(localExpenseSessionToStoreSession);
}

function getExpenseSessionLoadKey(
  session: NonNullable<ReturnType<typeof useExpenseActiveSession>>,
) {
  const itemKey = (session.cartItems ?? [])
    .map(
      (item: { _id: string; quantity: number; updatedAt?: number }) =>
        `${item._id}:${item.quantity}:${item.updatedAt ?? ""}`,
    )
    .join("|");

  return [
    session._id,
    session.updatedAt,
    session.expiresAt,
    session.notes ?? "",
    itemKey,
  ].join("::");
}

function isScopedExpenseLocalEvent(
  event: PosLocalEventRecord,
  scope: {
    registerNumber?: string;
    staffProfileId?: string | null;
    storeId?: string | null;
    terminalId?: string | null;
  },
) {
  if (!event.type.startsWith("expense.")) return false;
  if (scope.storeId && event.storeId !== scope.storeId) return false;
  if (scope.terminalId && event.terminalId !== scope.terminalId) return false;
  if (
    scope.staffProfileId &&
    event.staffProfileId &&
    event.staffProfileId !== scope.staffProfileId
  ) {
    return false;
  }
  if (
    scope.registerNumber &&
    event.registerNumber &&
    event.registerNumber !== scope.registerNumber
  ) {
    return false;
  }
  return true;
}

export function useExpenseRegisterViewModel(): RegisterViewModel {
  const { activeStore } = useGetActiveStore();
  const terminal = useGetTerminal();
  const store = useExpenseStore();
  const navigateBack = useNavigateBack();
  const cart = useExpenseOperations();
  const { createSession } = useSessionManagementExpense();
  const { voidSession } = useSessionManagementExpense();
  const setHeldExpenseSessions = useExpenseStore(
    (state) => state.setHeldSessions,
  );
  const { eventAppendToken, expenseLocalGateway, localStore } =
    useExpenseLocalRuntime({
    staffProfileId: store.cashier.id,
    storeId: store.storeId,
    terminalId: store.terminalId,
  });
  const listLocalExpenseEvents = (localStore as {
    listEvents?: typeof localStore.listEvents;
  }).listEvents;
  const [localExpenseReadState, setLocalExpenseReadState] = useState<{
    activeSession: ExpenseLocalSessionReadModel | null;
    loaded: boolean;
  }>({
    activeSession: null,
    loaded: false,
  });
  const localExpenseActiveSession = localExpenseReadState.activeSession;
  const localExpenseReadLoaded = localExpenseReadState.loaded;
  const autoSessionInitialized = useRef(false);
  const loadedSessionKeyRef = useRef<string | null>(null);
  const sessionContextKeyRef = useRef<string | null>(null);
  const exactAddKeyRef = useRef<string | null>(null);
  const staffProfile = useQuery(
    api.operations.staffProfiles.getStaffProfileById,
    store.cashier.id
      ? {
          staffProfileId: store.cashier.id,
        }
      : "skip",
  );

  const handleSetStoreId = useCallback(() => {
    if (!activeStore?._id || store.storeId === activeStore._id) {
      return;
    }

    store.setStoreId(activeStore._id);
  }, [activeStore?._id, store]);

  const handleSetTerminalId = useCallback(() => {
    if (!terminal?._id || store.terminalId === terminal._id) {
      return;
    }

    store.setTerminalId(terminal._id);
  }, [terminal?._id, store]);

  useEffect(() => {
    handleSetStoreId();
  }, [handleSetStoreId]);

  useEffect(() => {
    handleSetTerminalId();
  }, [handleSetTerminalId]);

  const handleSessionLoaded = useCallback(
    (sessionData: NonNullable<ReturnType<typeof useExpenseActiveSession>>) => {
      store.loadSessionData(sessionData);
    },
    [store],
  );

  const resetAutoSessionInitialized = useCallback(() => {
    autoSessionInitialized.current = false;
    loadedSessionKeyRef.current = null;
  }, []);

  const activeSessionQuery = useExpenseActiveSession(
    activeStore?._id,
    store.terminalId,
    store.cashier.id || undefined,
    store.ui.registerNumber,
  );

  useEffect(() => {
    if (typeof listLocalExpenseEvents !== "function") {
      setLocalExpenseReadState({ activeSession: null, loaded: true });
      setHeldExpenseSessions([]);
      return;
    }

    let cancelled = false;
    setLocalExpenseReadState((current) => ({
      ...current,
      loaded: false,
    }));
    void listLocalExpenseEvents().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLocalExpenseReadState({ activeSession: null, loaded: true });
        setHeldExpenseSessions([]);
        return;
      }
      const scopedEvents = result.value.filter((event) =>
        isScopedExpenseLocalEvent(event, {
          registerNumber: store.ui.registerNumber,
          staffProfileId: store.cashier.id,
          storeId: store.storeId,
          terminalId: store.terminalId,
        }),
      );
      const readModel = projectExpenseLocalReadModel({
        events: scopedEvents,
      });
      setLocalExpenseReadState({
        activeSession: readModel.activeSession,
        loaded: true,
      });
      setHeldExpenseSessions(
        localExpenseSessionsToStoreSessions(readModel.heldSessions),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    eventAppendToken,
    listLocalExpenseEvents,
    setHeldExpenseSessions,
    store.cashier.id,
    store.storeId,
    store.terminalId,
    store.ui.registerNumber,
  ]);

  const isSessionActive = Boolean(activeSessionQuery?.status === "active");

  const handleCashierAuthenticated = useCallback(
    (result: Id<"staffProfile"> | StaffAuthenticationResult) => {
      store.setCashier(
        typeof result === "string"
          ? (result as Id<"staffProfile">)
          : result.staffProfileId,
      );
      resetAutoSessionInitialized();
    },
    [resetAutoSessionInitialized, store],
  );

  useEffect(() => {
    const sessionContextKey = [
      activeStore?._id ?? "",
      store.ui.registerNumber,
      store.cashier.id ?? "",
      store.terminalId ?? "",
    ].join("::");

    if (sessionContextKeyRef.current !== sessionContextKey) {
      sessionContextKeyRef.current = sessionContextKey;
      autoSessionInitialized.current = false;
      loadedSessionKeyRef.current = null;
    }
  }, [
    activeStore?._id,
    store.cashier.id,
    store.terminalId,
    store.ui.registerNumber,
  ]);

  useEffect(() => {
    if (!activeStore?._id || !store.storeId) {
      return;
    }

    if (!store.cashier.isAuthenticated) {
      return;
    }

    if (activeSessionQuery === undefined) {
      return;
    }

    if (!localExpenseReadLoaded) {
      return;
    }

    if (store.transaction.isCompleted) {
      return;
    }

    if (activeSessionQuery) {
      if (
        store.session.currentSessionId &&
        store.session.currentSessionId !== activeSessionQuery._id
      ) {
        logger.debug("[Expense] Skipping session load - ID mismatch", {
          storeSessionId: store.session.currentSessionId,
          querySessionId: activeSessionQuery._id,
        });
        return;
      }

      if (store.session.isUpdating) {
        return;
      }

      if (
        store.session.currentSessionId === activeSessionQuery._id &&
        store.cart.items.length > 0 &&
        (activeSessionQuery.cartItems?.length ?? 0) === 0
      ) {
        logger.debug(
          "[Expense] Keeping local cart while cloud expense session catches up",
          {
            sessionId: activeSessionQuery._id,
            localItemCount: store.cart.items.length,
          },
        );
        return;
      }

      const sessionLoadKey = getExpenseSessionLoadKey(activeSessionQuery);
      if (loadedSessionKeyRef.current === sessionLoadKey) {
        return;
      }
      loadedSessionKeyRef.current = sessionLoadKey;

      logger.info("[Expense] Active session found, loading into store", {
        sessionId: activeSessionQuery._id,
        sessionNumber: activeSessionQuery.sessionNumber,
        itemCount: activeSessionQuery.cartItems?.length || 0,
      });

      handleSessionLoaded(activeSessionQuery);
      return;
    }

    if (localExpenseActiveSession) {
      if (
        store.session.currentSessionId &&
        store.session.currentSessionId !==
          localExpenseActiveSession.localExpenseSessionId
      ) {
        return;
      }

      const sessionLoadKey = [
        localExpenseActiveSession.localExpenseSessionId,
        localExpenseActiveSession.updatedAt,
        localExpenseActiveSession.notes ?? "",
        localExpenseActiveSession.items
          .map((item) => `${item.localItemId}:${item.quantity}`)
          .join("|"),
      ].join("::");
      if (loadedSessionKeyRef.current === sessionLoadKey) {
        return;
      }
      loadedSessionKeyRef.current = sessionLoadKey;

      logger.info("[Expense] Local active session found, loading into store", {
        sessionId: localExpenseActiveSession.localExpenseSessionId,
        itemCount: localExpenseActiveSession.items.length,
      });
      store.loadSessionData(
        localExpenseSessionToStoreSession(localExpenseActiveSession),
      );
      return;
    }

    if (autoSessionInitialized.current) {
      return;
    }

    autoSessionInitialized.current = true;

    if (activeSessionQuery === null) {
      if (store.session.currentSessionId) {
        logger.debug("[Expense] Clearing stale session ID", {
          staleSessionId: store.session.currentSessionId,
        });
        store.setCurrentSessionId(null);
        store.setActiveSession(null);
        loadedSessionKeyRef.current = null;
        if (store.cashier.isAuthenticated) {
          store.clearCashier();
        }
      }

      if (store.session.isCreating) {
        logger.debug(
          "[Expense] Session creation already in progress, skipping auto-init",
        );
        return;
      }

      logger.info("[Expense] No active session found, creating new session", {
        storeId: activeStore._id,
        registerNumber: store.ui.registerNumber,
        staffProfileId: store.cashier.id,
      });

      createSession(activeStore._id, store.cashier.id || undefined).catch(
        (error) => {
          logger.error("[Expense] Failed to auto-create session", error);
          autoSessionInitialized.current = false;
        },
      );
    }
  }, [
    activeStore?._id,
    store.cashier.id,
    store.cashier.isAuthenticated,
    activeSessionQuery,
    localExpenseActiveSession,
    localExpenseReadLoaded,
    store.session.currentSessionId,
    store.session.isCreating,
    store.session.isUpdating,
    store.transaction.isCompleted,
    createSession,
    handleSessionLoaded,
    store.storeId,
    store,
  ]);

  const registerCatalogRows = useConvexRegisterCatalog({
    storeId: activeStore?._id,
  });
  const registerCatalogIndex = useRegisterCatalogIndex(registerCatalogRows);
  const registerMetadataSearchState = useMemo(
    () =>
      searchRegisterCatalog(registerCatalogIndex, store.ui.productSearchQuery),
    [registerCatalogIndex, store.ui.productSearchQuery],
  );
  const registerAvailabilityProductSkuIds = useMemo(
    () =>
      registerMetadataSearchState.results.map(
        (row) => row.productSkuId as Id<"productSku">,
      ),
    [registerMetadataSearchState.results],
  );
  const registerCatalogAvailabilityRows = useConvexRegisterCatalogAvailability({
    storeId: activeStore?._id,
    productSkuIds: registerAvailabilityProductSkuIds,
  });
  const registerCatalogAvailabilityBySkuId = useMemo(() => {
    const rows = registerCatalogAvailabilityRows ?? [];

    return new Map<string, RegisterCatalogAvailability>(
      rows.map((row) => [row.productSkuId, row]),
    );
  }, [registerCatalogAvailabilityRows]);
  const registerSearchState = useMemo<RegisterCatalogSearchResult>(() => {
    if (registerMetadataSearchState.intent !== "exact") {
      return registerMetadataSearchState;
    }

    const exactAvailability = registerMetadataSearchState.exactMatch
      ? registerCatalogAvailabilityBySkuId.get(
          registerMetadataSearchState.exactMatch.productSkuId,
        )
      : undefined;

    return {
      ...registerMetadataSearchState,
      canAutoAdd: Boolean(
        registerMetadataSearchState.exactMatch &&
          exactAvailability &&
          (exactAvailability.availabilityPolicy ===
            "active_provisional_import" ||
            exactAvailability.availabilityPolicy === "pending_checkout" ||
            exactAvailability.quantityAvailable >= 0),
      ),
    };
  }, [registerCatalogAvailabilityBySkuId, registerMetadataSearchState]);
  const entrySearchResults = useMemo(
    () =>
      registerSearchState.results.map((row) =>
        mapCatalogRowToProduct(
          row,
          registerCatalogAvailabilityBySkuId.get(row.productSkuId),
        ),
      ),
    [registerCatalogAvailabilityBySkuId, registerSearchState.results],
  );
  const exactSearchProduct = registerSearchState.exactMatch
    ? mapCatalogRowToProduct(
        registerSearchState.exactMatch,
        registerCatalogAvailabilityBySkuId.get(
          registerSearchState.exactMatch.productSkuId,
        ),
      )
    : null;
  const isRegisterCatalogReady = registerCatalogRows !== undefined;
  const isProductEntrySearchLoading =
    store.ui.productSearchQuery.trim().length > 0 && !isRegisterCatalogReady;

  const addExactSearchProductOnce = useCallback(async () => {
    if (!exactSearchProduct || !registerSearchState.canAutoAdd) {
      return false;
    }

    const exactAddKey = [
      normalizeExactInput(registerSearchState.query),
      exactSearchProduct.skuId,
    ].join(":");
    if (exactAddKeyRef.current === exactAddKey) {
      return true;
    }

    exactAddKeyRef.current = exactAddKey;
    const wasAdded = await cart.addProduct(exactSearchProduct);
    if (!wasAdded) {
      exactAddKeyRef.current = null;
      return false;
    }

    store.setProductSearchQuery("");
    return true;
  }, [cart, exactSearchProduct, registerSearchState, store]);

  useEffect(() => {
    if (!store.ui.productSearchQuery.trim()) {
      exactAddKeyRef.current = null;
      return;
    }

    if (
      registerSearchState.intent === "exact" &&
      registerSearchState.canAutoAdd
    ) {
      void addExactSearchProductOnce();
    }
  }, [
    addExactSearchProductOnce,
    registerSearchState,
    store.ui.productSearchQuery,
  ]);

  const handleBarcodeSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!store.ui.productSearchQuery.trim()) {
        return;
      }

      if (registerSearchState.intent === "exact") {
        await addExactSearchProductOnce();
        return;
      }
    },
    [addExactSearchProductOnce, registerSearchState.intent, store],
  );

  const handleClearCart = useCallback(async () => {
    const sessionId = activeSessionQuery?._id || store.session.currentSessionId;
    if (!sessionId) {
      return;
    }

    if (store.session.isUpdating) {
      return;
    }

    const cleared = await cart.clearCart();
    if (cleared) {
      toast.success("Cart cleared");
    } else {
      toast.error("Could not clear this expense cart.");
    }
  }, [activeSessionQuery?._id, cart, store]);

  const handleCompleteExpense = useCallback(async () => {
    const sessionId =
      store.session.currentSessionId ||
      (activeSessionQuery?._id === store.session.currentSessionId
        ? activeSessionQuery._id
        : null);
    if (!sessionId) {
      toast.error("No active session");
      return;
    }

    if (store.cart.items.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    try {
      store.setTransactionCompleting(true);
      const totalValue = store.cart.total;
      const completedCartItems = store.cart.items.map((item) => ({ ...item }));
      const notes = store.ui.notes;
      if (!store.storeId || !store.terminalId || !store.cashier.id) {
        toast.error("Terminal or staff details missing");
        return;
      }

      const localExpenseEventId = `local-expense-event-${Date.now()}`;
      const savedLocally = await expenseLocalGateway.completeExpense({
        storeId: store.storeId,
        terminalId: store.terminalId,
        staffProfileId: store.cashier.id,
        localExpenseSessionId: sessionId as string,
        localExpenseEventId,
        notes,
        subtotal: store.cart.subtotal,
        tax: store.cart.tax,
        total: totalValue,
        items: completedCartItems.filter(isExpenseProductCartItem).map((item) => ({
          localExpenseSessionId: sessionId as string,
          localItemId: item.id as string,
          productId: item.productId,
          productSkuId: item.skuId,
          pendingCheckoutItemId: item.pendingCheckoutItemId,
          inventoryImportProvisionalSkuId:
            item.inventoryImportProvisionalSkuId,
          productSku: item.sku || "",
          barcode: item.barcode || undefined,
          productName: item.name,
          price: item.price,
          quantity: item.quantity,
          image: item.image || undefined,
          size: item.size || undefined,
          length: item.length || undefined,
          color: item.color,
        })),
      });

      if (!savedLocally) {
        toast.error("Could not record this expense locally.");
        return;
      }

      toast.success("Expense recorded successfully");
      store.setTransactionCompleted(true, localExpenseEventId, {
        transactionId: localExpenseEventId as Id<"expenseTransaction">,
        completedAt: new Date(),
        cartItems: completedCartItems,
        totalValue,
        notes,
      });
      store.clearCart();
      store.clearSession();
    } catch (error) {
      logger.error("[Expense] Failed to complete expense", error as Error);
    } finally {
      store.setTransactionCompleting(false);
    }
  }, [
    activeSessionQuery?._id,
    expenseLocalGateway,
    store,
  ]);

  const handleNavigateBack = useCallback(async () => {
    const sessionId = activeSessionQuery?._id || store.session.currentSessionId;

    if (sessionId && !store.transaction.isCompleted) {
      try {
        await voidSession();
        logger.info("[Expense] Voided session on navigate back", { sessionId });
      } catch (error) {
        logger.error(
          "[Expense] Failed to void session on navigate back",
          error as Error,
        );
      }
    }

    store.clearCashier();
    await navigateBack();
  }, [activeSessionQuery?._id, navigateBack, store, voidSession]);

  const handleCheckoutComplete = useCallback(async () => {
    await handleCompleteExpense();
    return store.transaction.isCompleted;
  }, [handleCompleteExpense, store]);

  const handleCashierSignOut = useCallback(async () => {
    if (activeSessionQuery) {
      const result = await voidSession();
      if (!result.success) {
        return;
      }
    }

    store.clearCashier();
  }, [activeSessionQuery, voidSession, store]);

  const baseCheckoutProps = {
    payments: [],
    onAddPayment: async () => false,
    onUpdatePayment: async () => false,
    onRemovePayment: async () => false,
    onClearPayments: async () => false,
    onStartNewTransaction: () => {
      store.startNewTransaction();
      store.clearCashier();
      resetAutoSessionInitialized();
    },
  };

  return {
    workflowMode: "expense",
    hasActiveStore: Boolean(activeStore),
    header: {
      title: "Expense Products",
      isSessionActive,
    },
    registerInfo: {
      customerName: undefined,
      registerLabel: store.ui.registerNumber
        ? `Register ${store.ui.registerNumber}`
        : "Expense Register",
      hasTerminal: Boolean(terminal),
    },
    onboarding: {
      shouldShow: false,
      terminalReady: Boolean(terminal),
      cashierSetupReady: true,
      cashierSignedIn: store.cashier.isAuthenticated,
      cashierCount: store.cashier.isAuthenticated ? 1 : 0,
      nextStep: "ready",
    },
    customerPanel: {
      isOpen: false,
      onOpenChange: () => {},
      customerInfo: EMPTY_REGISTER_CUSTOMER_INFO,
      onCustomerCommitted: async () => Promise.resolve(),
      setCustomerInfo: () => {},
    },
    productEntry: {
      disabled: !terminal || !store.cashier.isAuthenticated,
      showProductLookup: true,
      setShowProductLookup: store.setShowProductEntry,
      productSearchQuery: store.ui.productSearchQuery,
      setProductSearchQuery: store.setProductSearchQuery,
      onBarcodeSubmit: handleBarcodeSubmit,
      onAddProduct: async (product) => {
        const wasAdded = await cart.addProduct(product);
        if (wasAdded) {
          store.setProductSearchQuery("");
        }
        return wasAdded;
      },
      searchResults: entrySearchResults,
      isSearchLoading: isProductEntrySearchLoading,
      isSearchReady: isRegisterCatalogReady,
      canQuickAddProduct: false,
    },
    cart: {
      items: store.cart.items,
      onUpdateQuantity: (itemId, quantity) =>
        cart.updateQuantity(itemId as Id<"expenseSessionItem">, quantity),
      onRemoveItem: (itemId) =>
        cart.removeItem(itemId as Id<"expenseSessionItem">),
      onClearCart: handleClearCart,
    },
    checkout: {
      cartItems: store.cart.items,
      registerNumber: store.ui.registerNumber,
      subtotal: store.cart.subtotal,
      tax: store.cart.tax,
      total: store.cart.total,
      ...baseCheckoutProps,
      customerInfo: undefined,
      hasTerminal: Boolean(terminal),
      isTransactionCompleted: store.transaction.isCompleted,
      completedOrderNumber: store.transaction.completedTransactionNumber,
      completedTransactionData: store.transaction.completedTransactionData
        ? {
            paymentMethod: "manual",
            payments: [],
            transactionId: store.transaction.completedTransactionData.transactionId,
            completedAt: store.transaction.completedTransactionData.completedAt,
            cartItems: store.transaction.completedTransactionData.cartItems,
            subtotal: store.transaction.completedTransactionData.totalValue,
            tax: 0,
            total: store.transaction.completedTransactionData.totalValue,
            notes: store.transaction.completedTransactionData.notes,
            customerInfo: {
              name: "",
              email: "",
              phone: "",
            },
          }
        : null,
      cashierName: getCashierDisplayName(staffProfile ?? undefined),
      onCompleteTransaction: handleCheckoutComplete,
    },
    sessionPanel: null,
    cashierCard: {
      cashierName: getCashierDisplayName(staffProfile ?? undefined),
      onSignOut: handleCashierSignOut,
    },
    cashierPresenceRestore: { status: "missing" },
    drawerGate: null,
    closeoutControl: null,
    authDialog:
      activeStore && terminal && !store.cashier.isAuthenticated
        ? {
            open: true,
            storeId: activeStore._id,
            terminalId: terminal._id,
            workflowMode: "expense",
            onAuthenticated: handleCashierAuthenticated,
            onDismiss: handleNavigateBack,
          }
        : null,
    commandApprovalDialog: null,
    onNavigateBack: handleNavigateBack,
  };
}
