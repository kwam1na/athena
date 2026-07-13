import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { StaffAuthenticationResult } from "@/components/staff-auth/StaffAuthenticationDialog";
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
import {
  buildRegisterUpdateApplyBlockerState,
  EMPTY_REGISTER_CUSTOMER_INFO,
} from "@/lib/pos/presentation/register/registerUiState";
import type { RegisterViewModel } from "@/lib/pos/presentation/register/registerUiState";
import type { Id } from "~/convex/_generated/dataModel";
import { formatStaffDisplayNameOrFallback } from "~/shared/staffDisplayName";
import type { CartItem, Product } from "@/components/pos/types";
import {
  projectExpenseLocalReadModel,
  type ExpenseLocalSessionReadModel,
} from "@/lib/pos/infrastructure/local/expenseReadModel";
import type { PosLocalEventRecord } from "@/lib/pos/application/posLocalStoreTypes";
import { calculateCartTotals } from "@/lib/pos/services/calculationService";

function getCashierDisplayName(staffProfile?: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
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

function createLocalExpenseEventId() {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `local-expense-event-${suffix}`;
}

function localExpenseSessionToStoreSession(
  session: ExpenseLocalSessionReadModel,
) {
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
      pendingCheckoutItemId: item.pendingCheckoutItemId as
        Id<"posPendingCheckoutItem"> | undefined,
      inventoryImportProvisionalSkuId: item.inventoryImportProvisionalSkuId as
        Id<"inventoryImportProvisionalSku"> | undefined,
    })),
  };
}

function localExpenseSessionsToStoreSessions(
  sessions: ExpenseLocalSessionReadModel[],
) {
  return sessions.map(localExpenseSessionToStoreSession);
}

function expenseItemSourceKey(item: object) {
  const inventoryImportProvisionalSkuId =
    "inventoryImportProvisionalSkuId" in item
      ? item.inventoryImportProvisionalSkuId
      : null;
  if (typeof inventoryImportProvisionalSkuId === "string") {
    return `provisional_import:${inventoryImportProvisionalSkuId}`;
  }

  const pendingCheckoutItemId =
    "pendingCheckoutItemId" in item ? item.pendingCheckoutItemId : null;
  if (typeof pendingCheckoutItemId === "string") {
    return `pending_checkout:${pendingCheckoutItemId}`;
  }

  return "trusted_inventory";
}

function isPendingOptimisticExpenseCartItem(item: CartItem) {
  return item.id.toString().startsWith("optimistic:");
}

function sessionItemRepresentsCartItem(
  cartItem: CartItem,
  sessionItem: {
    quantity: number;
    productSkuId?: string;
    pendingCheckoutItemId?: string | null;
    inventoryImportProvisionalSkuId?: string | null;
  },
) {
  return (
    sessionItem.productSkuId === cartItem.skuId &&
    expenseItemSourceKey(sessionItem) === expenseItemSourceKey(cartItem) &&
    sessionItem.quantity >= cartItem.quantity
  );
}

function hasUnrepresentedOptimisticExpenseCartItem(
  cartItems: CartItem[],
  sessionItems: Array<{
    quantity: number;
    productSkuId?: string;
    pendingCheckoutItemId?: string | null;
    inventoryImportProvisionalSkuId?: string | null;
  }>,
) {
  return cartItems.some(
    (cartItem) =>
      isPendingOptimisticExpenseCartItem(cartItem) &&
      !sessionItems.some((sessionItem) =>
        sessionItemRepresentsCartItem(cartItem, sessionItem),
      ),
  );
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
  const cashierStaffProfileId = store.cashier.id;
  const isCashierSignedIn = Boolean(cashierStaffProfileId);
  const navigateBack = useNavigateBack();
  const cart = useExpenseOperations();
  const { createSession, voidSession } = useSessionManagementExpense();
  const setHeldExpenseSessions = useExpenseStore(
    (state) => state.setHeldSessions,
  );
  const { eventAppendToken, expenseLocalGateway, localStore, syncRuntime } =
    useExpenseLocalRuntime({
      staffProfileId: cashierStaffProfileId,
      storeId: store.storeId,
      terminalId: store.terminalId,
    });
  const listLocalExpenseEvents = (
    localStore as {
      listEvents?: typeof localStore.listEvents;
    }
  ).listEvents;
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
  const cashierDisplayName = store.cashier.displayName ?? undefined;

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

  const resetAutoSessionInitialized = useCallback(() => {
    autoSessionInitialized.current = false;
    loadedSessionKeyRef.current = null;
  }, []);

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
          staffProfileId: cashierStaffProfileId,
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
    cashierStaffProfileId,
    store.storeId,
    store.terminalId,
    store.ui.registerNumber,
  ]);

  const isSessionActive = Boolean(
    localExpenseActiveSession || store.session.currentSessionId,
  );
  const visibleCartItems = store.cart.items;
  const visibleCartTotals = useMemo(
    () => calculateCartTotals(visibleCartItems),
    [visibleCartItems],
  );

  const handleCashierAuthenticated = useCallback(
    (result: Id<"staffProfile"> | StaffAuthenticationResult) => {
      if (typeof result === "string") {
        store.setCashier(result as Id<"staffProfile">);
      } else {
        store.setCashier(
          result.staffProfileId,
          getCashierDisplayName(result.staffProfile),
        );
      }
      resetAutoSessionInitialized();
    },
    [resetAutoSessionInitialized, store],
  );

  useEffect(() => {
    const sessionContextKey = [
      activeStore?._id ?? "",
      store.ui.registerNumber,
      cashierStaffProfileId ?? "",
      store.terminalId ?? "",
    ].join("::");

    if (sessionContextKeyRef.current !== sessionContextKey) {
      sessionContextKeyRef.current = sessionContextKey;
      autoSessionInitialized.current = false;
      loadedSessionKeyRef.current = null;
    }
  }, [
    activeStore?._id,
    cashierStaffProfileId,
    store.terminalId,
    store.ui.registerNumber,
  ]);

  useEffect(() => {
    if (!activeStore?._id || !store.storeId) {
      return;
    }

    if (!isCashierSignedIn) {
      return;
    }

    if (!localExpenseReadLoaded) {
      return;
    }

    if (store.transaction.isCompleted) {
      return;
    }

    if (localExpenseActiveSession) {
      if (store.session.isUpdating) {
        logger.debug(
          "[Expense] Keeping local cart while expense command is pending",
          {
            sessionId: localExpenseActiveSession.localExpenseSessionId,
            localItemCount: store.cart.items.length,
          },
        );
        return;
      }

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

      if (
        store.session.currentSessionId ===
          localExpenseActiveSession.localExpenseSessionId &&
        store.cart.items.length > 0 &&
        hasUnrepresentedOptimisticExpenseCartItem(
          store.cart.items,
          localExpenseActiveSession.items,
        )
      ) {
        logger.debug(
          "[Expense] Keeping local cart while local expense session catches up",
          {
            sessionId: localExpenseActiveSession.localExpenseSessionId,
            localItemCount: store.cart.items.length,
          },
        );
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

    if (store.session.currentSessionId) {
      logger.debug("[Expense] Clearing stale local session ID", {
        staleSessionId: store.session.currentSessionId,
      });
      store.setCurrentSessionId(null);
      store.setActiveSession(null);
      loadedSessionKeyRef.current = null;
    }

    if (store.session.isCreating) {
      logger.debug(
        "[Expense] Session creation already in progress, skipping auto-init",
      );
      return;
    }

    logger.info(
      "[Expense] No local active session found, creating new session",
      {
        storeId: activeStore._id,
        registerNumber: store.ui.registerNumber,
        staffProfileId: cashierStaffProfileId,
      },
    );

    createSession(activeStore._id, cashierStaffProfileId || undefined).catch(
      (error) => {
        logger.error("[Expense] Failed to auto-create session", error);
        autoSessionInitialized.current = false;
      },
    );
  }, [
    activeStore?._id,
    cashierStaffProfileId,
    isCashierSignedIn,
    localExpenseActiveSession,
    localExpenseReadLoaded,
    store.session.currentSessionId,
    store.session.isCreating,
    store.session.isUpdating,
    store.transaction.isCompleted,
    createSession,
    store.storeId,
    store,
  ]);

  const registerCatalogRows = useConvexRegisterCatalog({
    refreshMetadataSnapshot: true,
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
        (exactAvailability.availabilityPolicy === "active_provisional_import" ||
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

  const handleAddProduct = useCallback(
    async (product: Product, quantity = 1) => {
      const wasAdded = await cart.addProduct(product, quantity);
      if (wasAdded) {
        store.setProductSearchQuery("");
      }

      return wasAdded;
    },
    [cart, store],
  );

  const handleRemoveCartItem = useCallback(
    async (itemId: Id<"expenseSessionItem">) => {
      return cart.removeItem(itemId);
    },
    [cart],
  );

  const handleUpdateCartQuantity = useCallback(
    async (itemId: Id<"expenseSessionItem">, quantity: number) => {
      return cart.updateQuantity(itemId, quantity);
    },
    [cart],
  );

  const handleClearCart = useCallback(async () => {
    const sessionId = store.session.currentSessionId;
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
  }, [cart, store]);

  const handleCompleteExpense = useCallback(async () => {
    const sessionId = store.session.currentSessionId;
    if (!sessionId) {
      toast.error("No active session");
      return;
    }

    if (visibleCartItems.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    try {
      store.setTransactionCompleting(true);
      const totalValue = visibleCartTotals.total;
      const completedCartItems = visibleCartItems.map((item) => ({ ...item }));
      const notes = store.ui.notes;
      if (!store.storeId || !store.terminalId || !store.cashier.id) {
        toast.error("Terminal or staff details missing");
        return;
      }

      const localExpenseEventId = createLocalExpenseEventId();
      const savedLocally = await expenseLocalGateway.completeExpense({
        storeId: store.storeId,
        terminalId: store.terminalId,
        staffProfileId: store.cashier.id,
        localExpenseSessionId: sessionId as string,
        localExpenseEventId,
        notes,
        subtotal: visibleCartTotals.subtotal,
        tax: visibleCartTotals.tax,
        total: totalValue,
        items: completedCartItems
          .filter(isExpenseProductCartItem)
          .map((item, index) => ({
            localExpenseSessionId: sessionId as string,
            localItemId: `${localExpenseEventId}:line:${index + 1}`,
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
  }, [expenseLocalGateway, store, visibleCartItems, visibleCartTotals]);

  const handleNavigateBack = useCallback(async () => {
    const sessionId = store.session.currentSessionId;

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
  }, [navigateBack, store, voidSession]);

  const handleCheckoutComplete = useCallback(async () => {
    await handleCompleteExpense();
    return store.transaction.isCompleted;
  }, [handleCompleteExpense, store]);

  const handleCashierSignOut = useCallback(async () => {
    if (store.session.currentSessionId) {
      const result = await voidSession();
      if (!result.success) {
        return;
      }
    }

    store.clearCashier();
  }, [voidSession, store]);

  const baseCheckoutProps = {
    payments: [],
    onAddPayment: async () => false,
    onUpdatePayment: async () => false,
    onRemovePayment: async () => false,
    onClearPayments: async () => false,
    onStartNewTransaction: () => {
      store.startNewTransaction();
      resetAutoSessionInitialized();
    },
  };
  const updateApplyBlocker = buildRegisterUpdateApplyBlockerState({
    hasActiveSaleWork: false,
    hasCheckoutMutationInFlight: false,
    hasDrawerTransitionInFlight: false,
    hasLocalRuntimeApplyRisk: false,
  });

  return {
    workflowMode: "expense",
    hasActiveStore: Boolean(activeStore),
    debug: {
      activeStoreSource: activeStore ? "live" : "missing",
      authDialogOpen: Boolean(activeStore && terminal && !isCashierSignedIn),
      cashierPresence: "missing",
      hasLiveActiveStore: Boolean(activeStore),
      localEntryStatus: localExpenseReadLoaded ? "ready" : "loading",
      localStaffAuthorityStatus: isCashierSignedIn ? "ready" : "missing",
      online: typeof navigator === "undefined" ? true : navigator.onLine,
      staffSignedIn: isCashierSignedIn,
      storeId: store.storeId ?? activeStore?._id,
      syncFlow: {
        checkInPublishAttemptedAt:
          syncRuntime?.debug?.checkInPublishAttemptedAt,
        checkInPublishCompletedAt:
          syncRuntime?.debug?.checkInPublishCompletedAt,
        checkInPublishMessage: syncRuntime?.debug?.checkInPublishMessage,
        checkInPublishReason: syncRuntime?.debug?.checkInPublishReason,
        checkInPublishStatus: syncRuntime?.debug?.checkInPublishStatus,
        eventAppendToken,
        failureCount: syncRuntime?.debug?.failureCount,
        failedEventCount: syncRuntime?.debug?.failedEventCount,
        lastBatchEventCount: syncRuntime?.debug?.lastBatchEventCount,
        lastFailure: syncRuntime?.debug?.lastFailure,
        lastHeldEventCount: syncRuntime?.debug?.lastHeldEventCount,
        lastReviewEventCount: syncRuntime?.debug?.lastReviewEventCount,
        lastRuntimeTrigger: syncRuntime?.debug?.lastTrigger ?? "none",
        lastRuntimeTriggerAt: syncRuntime?.debug?.lastTriggerAt,
        lastRuntimeTriggerPriority:
          syncRuntime?.debug?.lastTriggerPriority ?? "normal",
        localOnlyEventCount: syncRuntime?.debug?.localOnlyEventCount,
        mode: syncRuntime?.debug?.mode,
        oldestPendingEventAt: syncRuntime?.debug?.oldestPendingEventAt,
        oldestPendingEventId: syncRuntime?.debug?.oldestPendingEventId,
        oldestPendingEventSequence:
          syncRuntime?.debug?.oldestPendingEventSequence,
        oldestPendingUploadSequence:
          syncRuntime?.debug?.oldestPendingUploadSequence,
        nextPendingUploadSequence:
          syncRuntime?.debug?.nextPendingUploadSequence,
        pendingEventCount: syncRuntime?.pendingEventCount ?? 0,
        pendingUploadEventCount: syncRuntime?.debug?.pendingUploadEventCount,
        reviewEventCount: syncRuntime?.debug?.reviewEventCount,
        schedulerBackoffUntil: syncRuntime?.debug?.schedulerBackoffUntil,
        schedulerRunning: syncRuntime?.debug?.schedulerRunning,
        schedulerScheduled: syncRuntime?.debug?.schedulerScheduled,
        source: syncRuntime ? "runtime" : "none",
        staffProof: isCashierSignedIn ? "present" : "missing",
        status: syncRuntime?.status ?? "synced",
      },
      ...(terminal?._id ? { terminalId: terminal._id } : {}),
      terminalSource: terminal ? "live" : "missing",
    },
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
      cashierSignedIn: isCashierSignedIn,
      cashierCount: isCashierSignedIn ? 1 : 0,
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
      catalogRows: registerCatalogRows ?? [],
      disabled: !terminal || !isCashierSignedIn,
      showProductLookup: true,
      setShowProductLookup: store.setShowProductEntry,
      productSearchQuery: store.ui.productSearchQuery,
      setProductSearchQuery: store.setProductSearchQuery,
      onBarcodeSubmit: handleBarcodeSubmit,
      onAddProduct: handleAddProduct,
      searchResults: entrySearchResults,
      isSearchLoading: isProductEntrySearchLoading,
      isSearchReady: isRegisterCatalogReady,
      canQuickAddProduct: false,
    },
    cart: {
      items: visibleCartItems,
      onUpdateQuantity: (itemId, quantity) =>
        handleUpdateCartQuantity(itemId as Id<"expenseSessionItem">, quantity),
      onRemoveItem: (itemId) =>
        handleRemoveCartItem(itemId as Id<"expenseSessionItem">),
      onClearCart: handleClearCart,
    },
    checkout: {
      cartItems: visibleCartItems,
      registerNumber: store.ui.registerNumber,
      subtotal: visibleCartTotals.subtotal,
      tax: visibleCartTotals.tax,
      total: visibleCartTotals.total,
      ...baseCheckoutProps,
      customerInfo: undefined,
      hasTerminal: Boolean(terminal),
      isTransactionCompleted: store.transaction.isCompleted,
      completedOrderNumber: store.transaction.completedTransactionNumber,
      completedTransactionData: store.transaction.completedTransactionData
        ? {
            paymentMethod: "manual",
            payments: [],
            transactionId:
              store.transaction.completedTransactionData.transactionId,
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
      cashierName: cashierDisplayName ?? "Unassigned",
      onCompleteTransaction: handleCheckoutComplete,
    },
    sessionPanel: null,
    cashierCard: isCashierSignedIn
      ? {
          cashierName: cashierDisplayName ?? "Unassigned",
          onSignOut: handleCashierSignOut,
        }
      : null,
    cashierPresenceRestore: { status: "missing" },
    readinessGuard: null,
    drawerGate: null,
    closeoutControl: null,
    updateApplyBlocker,
    authDialog:
      activeStore && terminal && !isCashierSignedIn
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
