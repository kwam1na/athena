import { useCallback, useEffect, useMemo, useRef } from "react";
import type { FormEvent } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import type { POSSession } from "~/types";

import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useCartOperations } from "@/hooks/useCartOperations";
import { useCustomerOperations } from "@/hooks/useCustomerOperations";
import { useDebounce } from "@/hooks/useDebounce";
import { useGetTerminal } from "@/hooks/useGetTerminal";
import { useNavigateBack } from "@/hooks/use-navigate-back";
import { usePOSOperations } from "@/hooks/usePOSOperations";
import {
  usePOSActiveSession,
  usePOSStoreSessions,
} from "@/hooks/usePOSSessions";
import {
  usePOSBarcodeSearch,
  usePOSProductIdSearch,
} from "@/hooks/usePOSProducts";
import { useSessionManagement } from "@/hooks/useSessionManagement";
import { useSessionManagerOperations } from "@/hooks/useSessionManagerOperations";
import {
  extractBarcodeFromInput,
  type ExtractResult,
} from "@/lib/pos/barcodeUtils";
import {
  POS_AUTO_ADD_DELAY_MS,
  POS_SEARCH_DEBOUNCE_MS,
} from "@/lib/pos/constants";
import { logger } from "@/lib/logger";
import { usePOSStore } from "@/stores/posStore";

import type { RegisterViewModel } from "./registerUiState";
import {
  buildRegisterHeaderState,
  buildRegisterInfoState,
  getCashierDisplayName,
  getRegisterCustomerInfo,
  isRegisterSessionActive,
} from "./selectors";

export function useRegisterViewModel(): RegisterViewModel {
  const { activeStore } = useGetActiveStore();
  const cart = useCartOperations();
  const customer = useCustomerOperations();
  const transaction = usePOSOperations();
  const store = usePOSStore();
  const {
    createSession,
    holdSession,
    releaseSessionInventoryHoldsAndDeleteItems,
  } = useSessionManagement();
  const terminal = useGetTerminal();
  const navigateBack = useNavigateBack();
  const autoSessionInitialized = useRef(false);

  useEffect(() => {
    if (activeStore?._id && store.storeId !== activeStore._id) {
      store.setStoreId(activeStore._id);
    }
  }, [activeStore?._id, store]);

  useEffect(() => {
    if (terminal?._id && store.terminalId !== terminal._id) {
      store.setTerminalId(terminal._id);
    }
  }, [terminal?._id, store]);

  const handleSessionLoaded = useCallback(
    (session: POSSession) => {
      store.loadSessionData(session);
    },
    [store],
  );

  const resetAutoSessionInitialized = useCallback(() => {
    autoSessionInitialized.current = false;
  }, []);

  const handleNewSession = useCallback(() => {
    store.startNewTransaction();
    resetAutoSessionInitialized();
  }, [resetAutoSessionInitialized, store]);

  const activeSessionQuery = usePOSActiveSession(
    activeStore?._id,
    store.terminalId,
    store.cashier.id || undefined,
    store.ui.registerNumber,
  );

  const heldSessionsQuery = usePOSStoreSessions(
    activeStore?._id,
    store.terminalId,
    store.cashier.id || undefined,
    "held",
    1,
  );

  const sessionManagerOps = useSessionManagerOperations(
    activeStore?._id || ("" as Id<"store">),
    store.terminalId || ("" as Id<"posTerminal">),
    store.cashier.id || ("" as Id<"cashier">),
    store.ui.registerNumber,
  );

  const cashier = useQuery(
    api.inventory.cashier.getById,
    store.cashier.id ? { id: store.cashier.id } : "skip",
  );

  const isSessionActive = isRegisterSessionActive(activeSessionQuery);

  const handleCashierAuthenticated = useCallback(
    (cashierId: Id<"cashier">) => {
      store.setCashier(cashierId);
    },
    [store],
  );

  const createNewSession = useCallback(() => {
    if (!activeStore?._id) {
      return;
    }

    if (store.session.isCreating) {
      logger.debug(
        "[POS] Session creation already in progress, skipping auto-init",
      );
      return;
    }

    logger.info("[POS] No active or held session found, creating new session", {
      storeId: activeStore._id,
      registerNumber: store.ui.registerNumber,
      cashierId: store.cashier.id,
    });

    createSession(activeStore._id, store.cashier.id || undefined)
      .then(() => store.startNewTransaction())
      .catch((error) => {
        logger.error("[POS] Failed to auto-create session", error);
        autoSessionInitialized.current = false;
      });
  }, [
    activeStore?._id,
    createSession,
    store,
  ]);

  useEffect(() => {
    if (!activeStore?._id || !store.storeId) {
      return;
    }

    if (!store.cashier.isAuthenticated) {
      return;
    }

    if (autoSessionInitialized.current) {
      return;
    }

    if (activeSessionQuery === undefined || heldSessionsQuery === undefined) {
      return;
    }

    autoSessionInitialized.current = true;

    if (activeSessionQuery) {
      if (
        store.session.currentSessionId &&
        store.session.currentSessionId !== activeSessionQuery._id
      ) {
        logger.debug(
          "[POS] Skipping session load - ID mismatch (expecting different session)",
          {
            storeSessionId: store.session.currentSessionId,
            querySessionId: activeSessionQuery._id,
          },
        );
        return;
      }

      const now = Date.now();
      if (activeSessionQuery.expiresAt && activeSessionQuery.expiresAt < now) {
        logger.warn(
          "[POS] Active session has expired, clearing state and cashier",
          {
            sessionId: activeSessionQuery._id,
            expiresAt: activeSessionQuery.expiresAt,
            now,
          },
        );
        store.setCurrentSessionId(null);
        store.setActiveSession(null);
        store.clearCashier();
        autoSessionInitialized.current = false;
        return;
      }

      logger.info("[POS] Active session found, loading into store", {
        sessionId: activeSessionQuery._id,
        sessionNumber: activeSessionQuery.sessionNumber,
        itemCount: activeSessionQuery.cartItems?.length || 0,
      });

      handleSessionLoaded(activeSessionQuery as POSSession);
      return;
    }

    if (activeSessionQuery === null) {
      if (store.session.currentSessionId) {
        logger.debug("[POS] Clearing stale session ID", {
          staleSessionId: store.session.currentSessionId,
        });
        store.setCurrentSessionId(null);
        store.setActiveSession(null);
      }

      const mostRecentHeldSession =
        heldSessionsQuery && heldSessionsQuery.length > 0
          ? heldSessionsQuery[0]
          : null;

      if (
        mostRecentHeldSession &&
        activeStore?._id &&
        store.terminalId &&
        store.cashier.id
      ) {
        logger.info("[POS] Found held session, attempting auto-resume", {
          sessionId: mostRecentHeldSession._id,
          sessionNumber: mostRecentHeldSession.sessionNumber,
          itemCount: mostRecentHeldSession.cartItems?.length || 0,
        });

        sessionManagerOps
          .handleResumeSession(
            mostRecentHeldSession._id,
            store.cashier.id,
            store.terminalId,
            handleSessionLoaded,
          )
          .then((result) => {
            if (result.success) {
              logger.info("[POS] Auto-resumed held session successfully", {
                sessionId: mostRecentHeldSession._id,
              });
              return;
            }

            logger.warn(
              "[POS] Auto-resume failed, falling back to new session",
              {
                sessionId: mostRecentHeldSession._id,
                error: result.error,
              },
            );
            createNewSession();
          })
          .catch((error) => {
            logger.error(
              "[POS] Auto-resume error, falling back to new session",
              {
                sessionId: mostRecentHeldSession._id,
                error,
              },
            );
            createNewSession();
          });
        return;
      }

      createNewSession();
    }
  }, [
    activeSessionQuery,
    activeStore?._id,
    createNewSession,
    handleSessionLoaded,
    heldSessionsQuery,
    sessionManagerOps,
    store,
  ]);

  useEffect(() => {
    autoSessionInitialized.current = false;
  }, [activeStore?._id, store.ui.registerNumber]);

  useEffect(() => {
    if (!activeSessionQuery || !activeSessionQuery.expiresAt) {
      return;
    }

    const now = Date.now();
    const timeUntilExpiry = activeSessionQuery.expiresAt - now;

    if (timeUntilExpiry <= 0) {
      logger.warn("[POS] Session already expired, clearing cashier", {
        sessionId: activeSessionQuery._id,
        expiresAt: activeSessionQuery.expiresAt,
      });
      store.clearCashier();
      store.setCurrentSessionId(null);
      store.setActiveSession(null);
      autoSessionInitialized.current = false;
      return;
    }

    const timeoutId = setTimeout(() => {
      logger.warn("[POS] Session expired, clearing cashier", {
        sessionId: activeSessionQuery._id,
      });
      store.clearCashier();
      store.setCurrentSessionId(null);
      store.setActiveSession(null);
      autoSessionInitialized.current = false;
    }, timeUntilExpiry);

    return () => clearTimeout(timeoutId);
  }, [activeSessionQuery?.expiresAt, activeSessionQuery?._id, store]);

  const extractionCacheRef = useRef<ExtractResult | null>(null);
  const rawExtraction = extractBarcodeFromInput(store.ui.productSearchQuery);
  const shouldReuseCachedProductId =
    rawExtraction.type === "barcode" &&
    extractionCacheRef.current?.type === "productId" &&
    extractionCacheRef.current.value === rawExtraction.value;

  const extractResult = shouldReuseCachedProductId
    ? extractionCacheRef.current!
    : rawExtraction;
  const extractedValue = extractResult.value;

  useEffect(() => {
    if (
      !extractionCacheRef.current ||
      extractionCacheRef.current.type !== extractResult.type ||
      extractionCacheRef.current.value !== extractResult.value
    ) {
      extractionCacheRef.current = extractResult;
    }
  }, [extractResult.type, extractResult.value]);

  const debouncedValue = useDebounce(extractedValue, POS_SEARCH_DEBOUNCE_MS);
  const productIdSearchQuery =
    extractResult.type === "productId" ? debouncedValue : "";
  const productIdSearchResults = usePOSProductIdSearch(
    activeStore?._id,
    productIdSearchQuery,
  );

  const barcodeSearchQuery =
    extractResult.type === "barcode" ? debouncedValue : "";
  const barcodeSearchResult = usePOSBarcodeSearch(
    activeStore?._id,
    barcodeSearchQuery,
  );

  useEffect(() => {
    if (!extractedValue.trim()) {
      return;
    }

    if (
      extractResult.type === "productId" &&
      productIdSearchResults &&
      productIdSearchResults.length === 1 &&
      productIdSearchResults[0].quantityAvailable > 0
    ) {
      const timeoutId = setTimeout(async () => {
        await cart.addProduct(productIdSearchResults[0]);
        store.setProductSearchQuery("");
      }, POS_AUTO_ADD_DELAY_MS);

      return () => clearTimeout(timeoutId);
    }

    if (extractResult.type === "barcode" && barcodeSearchResult) {
      const shouldAutoAdd = Array.isArray(barcodeSearchResult)
        ? barcodeSearchResult.length === 1 &&
          barcodeSearchResult[0]?.quantityAvailable &&
          barcodeSearchResult[0].quantityAvailable > 0
        : true;

      if (shouldAutoAdd) {
        const timeoutId = setTimeout(async () => {
          await cart.addFromBarcode(extractedValue, barcodeSearchResult);
          store.setProductSearchQuery("");
        }, POS_AUTO_ADD_DELAY_MS);

        return () => clearTimeout(timeoutId);
      }
    }
  }, [
    barcodeSearchResult,
    cart,
    extractResult.type,
    extractedValue,
    productIdSearchResults,
    store,
  ]);

  const handleBarcodeSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!store.ui.productSearchQuery.trim()) {
        return;
      }

      if (extractResult.type === "productId" && productIdSearchResults) {
        if (productIdSearchResults.length === 1) {
          await cart.addProduct(productIdSearchResults[0]);
          store.setProductSearchQuery("");
        }
        return;
      }

      if (extractResult.type === "barcode" && barcodeSearchResult) {
        const shouldAutoAdd = Array.isArray(barcodeSearchResult)
          ? barcodeSearchResult.length === 1
          : true;

        if (shouldAutoAdd) {
          await cart.addFromBarcode(extractedValue, barcodeSearchResult);
          store.setProductSearchQuery("");
        }
      } else if (extractResult.type === "barcode" && !barcodeSearchResult) {
        logger.warn("[POS] Barcode not found", {
          barcode: extractedValue,
          storeId: activeStore?._id,
        });
      }
    },
    [
      activeStore?._id,
      barcodeSearchResult,
      cart,
      extractResult.type,
      extractedValue,
      productIdSearchResults,
      store,
    ],
  );

  const handleClearCart = useCallback(async () => {
    const sessionId = activeSessionQuery?._id || store.session.currentSessionId;
    if (!sessionId) {
      return;
    }

    const result = await releaseSessionInventoryHoldsAndDeleteItems(
      sessionId as Id<"posSession">,
    );

    if (result.success) {
      toast.success("Cart cleared");
      cart.clearCart();
    }
  }, [
    activeSessionQuery?._id,
    cart,
    releaseSessionInventoryHoldsAndDeleteItems,
    store.session.currentSessionId,
  ]);

  useEffect(() => {
    if (!store.transaction.isCompleted && store.ui.showProductEntry) {
      const timer = setTimeout(() => {
        const searchInput = document.querySelector(
          'input[placeholder*="Lookup product"]',
        ) as HTMLInputElement | null;
        searchInput?.focus();
      }, 150);

      return () => clearTimeout(timer);
    }
  }, [store.transaction.isCompleted, store.ui.showProductEntry]);

  const handleNavigateBack = useCallback(async () => {
    const sessionId = activeSessionQuery?._id || store.session.currentSessionId;
    if (sessionId && store.cart.items.length > 0) {
      await holdSession();
    }

    store.clearCart();
    store.clearCashier();
    navigateBack();
  }, [
    activeSessionQuery?._id,
    holdSession,
    navigateBack,
    store,
  ]);

  const handleCashierSignOut = useCallback(async () => {
    const session =
      activeSessionQuery || (store.session.activeSession as POSSession | null);

    if (session) {
      if (store.cart.items.length > 0) {
        const holdResult =
          await sessionManagerOps.handleHoldCurrentSession("Signing out");
        if (!holdResult.success) {
          toast.error(holdResult.error);
          return;
        }

        store.clearCashier();
        return;
      }

      const voidResult = await sessionManagerOps.handleVoidSession(
        session._id as Id<"posSession">,
      );
      if (!voidResult.success) {
        toast.error(voidResult.error);
        return;
      }
    }

    store.clearCashier();
  }, [activeSessionQuery, sessionManagerOps, store]);

  const handleCompleteTransaction = useCallback(async () => {
    if (!activeSessionQuery || activeSessionQuery.status !== "active") {
      return false;
    }

    const result = await transaction.transaction.processPayment(
      activeSessionQuery as POSSession,
    );

    return result.success;
  }, [activeSessionQuery, transaction.transaction]);

  const handleStartNewTransaction = useCallback(() => {
    transaction.transaction.startNewTransaction();
    resetAutoSessionInitialized();
  }, [resetAutoSessionInitialized, transaction.transaction]);

  const customerInfo = getRegisterCustomerInfo(store.customer.current);
  const cashierName = getCashierDisplayName(cashier);

  const header = useMemo(
    () =>
      buildRegisterHeaderState({
        isSessionActive,
      }),
    [isSessionActive],
  );

  const registerInfo = useMemo(
    () =>
      buildRegisterInfoState({
        customerName: store.customer.current?.name,
        registerLabel: terminal?.displayName || "No terminal configured",
        hasTerminal: terminal !== null,
      }),
    [store.customer.current?.name, terminal],
  );

  const sessionPanel =
    activeStore?._id && terminal?._id && store.cashier.id
      ? {
          storeId: activeStore._id,
          terminalId: terminal._id,
          cashierId: store.cashier.id,
          registerNumber: store.ui.registerNumber,
          cartItems: store.cart.items,
          customerInfo,
          subtotal: store.cart.subtotal,
          tax: store.cart.tax,
          total: store.cart.total,
          onSessionLoaded: handleSessionLoaded,
          onNewSession: handleNewSession,
          resetAutoSessionInitialized,
        }
      : null;

  const cashierCard =
    activeStore?._id && terminal?._id && store.cashier.id
      ? {
          cashierName,
          onSignOut: handleCashierSignOut,
        }
      : null;

  const authDialog =
    activeStore?._id && terminal?._id
      ? {
          open: !store.cashier.isAuthenticated,
          storeId: activeStore._id,
          terminalId: terminal._id,
          onAuthenticated: handleCashierAuthenticated,
          onDismiss: handleNavigateBack,
        }
      : null;

  return {
    hasActiveStore: Boolean(activeStore),
    header,
    registerInfo,
    customerPanel: {
      isOpen: store.ui.showCustomerPanel,
      onOpenChange: store.setShowCustomerPanel,
      customerInfo,
      setCustomerInfo: (nextCustomer) => {
        if (typeof nextCustomer === "function") {
          customer.updateCustomerInfo(nextCustomer(customerInfo));
          return;
        }

        customer.updateCustomerInfo(nextCustomer);
      },
    },
    productEntry: {
      disabled: !terminal,
      showProductLookup: store.ui.showProductEntry,
      setShowProductLookup: store.setShowProductEntry,
      productSearchQuery: store.ui.productSearchQuery,
      setProductSearchQuery: store.setProductSearchQuery,
      onBarcodeSubmit: handleBarcodeSubmit,
      onAddProduct: cart.addProduct,
      barcodeSearchResult,
      productIdSearchResults,
    },
    cart: {
      items: store.cart.items,
      onUpdateQuantity: (itemId, quantity) =>
        cart.updateQuantity(itemId as Id<"posSessionItem">, quantity),
      onRemoveItem: (itemId) =>
        cart.removeItem(itemId as Id<"posSessionItem">),
      onClearCart: handleClearCart,
    },
    checkout: {
      cartItems: store.cart.items,
      customerInfo: store.customer.current
        ? {
            name: store.customer.current.name,
            email: store.customer.current.email,
            phone: store.customer.current.phone,
          }
        : undefined,
      registerNumber: store.ui.registerNumber,
      subtotal: store.cart.subtotal,
      tax: store.cart.tax,
      total: store.cart.total,
      payments: store.payment.payments,
      hasTerminal: terminal !== null,
      isTransactionCompleted: store.transaction.isCompleted,
      completedOrderNumber: store.transaction.completedOrderNumber,
      completedTransactionData: store.transaction.completedTransactionData,
      cashierName,
      onAddPayment: store.addPayment,
      onUpdatePayment: store.updatePayment,
      onRemovePayment: store.removePayment,
      onClearPayments: store.clearPayments,
      onCompleteTransaction: handleCompleteTransaction,
      onStartNewTransaction: handleStartNewTransaction,
    },
    sessionPanel,
    cashierCard,
    authDialog,
    onNavigateBack: handleNavigateBack,
  };
}
