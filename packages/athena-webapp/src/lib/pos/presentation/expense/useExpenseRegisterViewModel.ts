import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "convex/react";
import { useMutation } from "convex/react";

import { useExpenseActiveSession } from "@/hooks/useExpenseSessions";
import { useExpenseOperations } from "@/hooks/useExpenseOperations";
import { useSessionManagementExpense } from "@/hooks/useSessionManagementExpense";
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
import { runCommand } from "@/lib/errors/runCommand";
import { presentCommandToast } from "@/lib/errors/presentCommandToast";
import { EMPTY_REGISTER_CUSTOMER_INFO } from "@/lib/pos/presentation/register/registerUiState";
import type { RegisterViewModel } from "@/lib/pos/presentation/register/registerUiState";
import type { Id } from "~/convex/_generated/dataModel";
import { formatStaffDisplayNameOrFallback } from "~/shared/staffDisplayName";

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

export function useExpenseRegisterViewModel(): RegisterViewModel {
  const { activeStore } = useGetActiveStore();
  const terminal = useGetTerminal();
  const store = useExpenseStore();
  const navigateBack = useNavigateBack();
  const cart = useExpenseOperations();
  const { createSession, releaseSessionInventoryHoldsAndDeleteItems } =
    useSessionManagementExpense();
  const { voidSession } = useSessionManagementExpense();
  const autoSessionInitialized = useRef(false);
  const loadedSessionKeyRef = useRef<string | null>(null);
  const sessionContextKeyRef = useRef<string | null>(null);
  const exactAddKeyRef = useRef<string | null>(null);
  const completeExpenseSession = useMutation(
    api.inventory.expenseSessions.completeExpenseSession,
  );
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

  const isSessionActive = Boolean(
    activeSessionQuery?.status === "active" &&
    activeSessionQuery.expiresAt &&
    activeSessionQuery.expiresAt > Date.now(),
  );

  const handleCashierAuthenticated = useCallback(
    (staffProfileId: Id<"staffProfile">) => {
      store.setCashier(staffProfileId);
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

      const now = Date.now();
      if (activeSessionQuery.expiresAt && activeSessionQuery.expiresAt < now) {
        logger.warn("[Expense] Active session has expired, clearing state", {
          sessionId: activeSessionQuery._id,
          expiresAt: activeSessionQuery.expiresAt,
          now,
        });
        store.setCurrentSessionId(null);
        store.setActiveSession(null);
        store.clearCashier();
        autoSessionInitialized.current = false;
        loadedSessionKeyRef.current = null;
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
    store.session.currentSessionId,
    store.session.isCreating,
    store.session.isUpdating,
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
          exactAvailability.quantityAvailable > 0,
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

    const previousCartItems = [...store.cart.items];
    cart.clearCart();
    store.setSessionUpdating(true);

    try {
      const result = await releaseSessionInventoryHoldsAndDeleteItems(
        sessionId as Id<"expenseSession">,
      );

      if (result.success) {
        toast.success("Cart cleared");
        return;
      }

      store.replaceCartItems(previousCartItems);
    } catch (error) {
      logger.error("[Expense] Failed to clear cart", error as Error);
      store.replaceCartItems(previousCartItems);
      toast.error("Could not clear this expense cart.");
    } finally {
      store.setSessionUpdating(false);
    }
  }, [
    activeSessionQuery?._id,
    cart,
    releaseSessionInventoryHoldsAndDeleteItems,
    store.session.currentSessionId,
    store.session.isUpdating,
    store,
  ]);

  const handleCompleteExpense = useCallback(async () => {
    const sessionId = activeSessionQuery?._id || store.session.currentSessionId;
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
      const result = await runCommand(() =>
        completeExpenseSession({
          sessionId: sessionId as Id<"expenseSession">,
          notes: store.ui.notes,
          totalValue,
        }),
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return;
      }

      toast.success("Expense recorded successfully");
      store.startNewTransaction();
      resetAutoSessionInitialized();
      store.clearCashier();
    } catch (error) {
      logger.error("[Expense] Failed to complete expense", error as Error);
    } finally {
      store.setTransactionCompleting(false);
    }
  }, [
    activeSessionQuery?._id,
    cart,
    completeExpenseSession,
    store.session.currentSessionId,
    store.cart.items,
    store.cart.total,
    store.ui.notes,
    store,
    resetAutoSessionInitialized,
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
    onAddPayment: () => {},
    onUpdatePayment: () => {},
    onRemovePayment: () => {},
    onClearPayments: () => {},
    onStartNewTransaction: () => {
      store.startNewTransaction();
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
            completedAt: store.transaction.completedTransactionData.completedAt,
            cartItems: store.transaction.completedTransactionData.cartItems,
            subtotal: store.cart.subtotal,
            tax: store.cart.tax,
            total: store.transaction.completedTransactionData.totalValue,
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
