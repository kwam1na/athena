import { useEffect, useRef } from "react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { FadeIn } from "../common/FadeIn";
import { ComposedPageHeader } from "../common/PageHeader";
import { ProductEntry } from "../pos/ProductEntry";
import { CartItems } from "../pos/CartItems";
import { useExpenseOperations } from "@/hooks/useExpenseOperations";
import { useExpenseStore } from "@/stores/expenseStore";
import {
  usePOSBarcodeSearch,
  usePOSProductSearch,
} from "@/hooks/usePOSProducts";
import { useDebounce } from "@/hooks/useDebounce";
import {
  extractBarcodeFromInput,
  type ExtractResult,
} from "@/lib/pos/barcodeUtils";
import {
  POS_SEARCH_DEBOUNCE_MS,
  POS_AUTO_ADD_DELAY_MS,
} from "@/lib/pos/constants";
import { useExpenseActiveSession } from "@/hooks/useExpenseSessions";
import { useSessionManagementExpense } from "@/hooks/useSessionManagementExpense";
import { logger } from "@/lib/logger";
import { toast } from "sonner";
import { Id } from "~/convex/_generated/dataModel";
import { useGetTerminal } from "~/src/hooks/useGetTerminal";
import { CashierAuthDialog } from "../pos/CashierAuthDialog";
import { useNavigateBack } from "~/src/hooks/use-navigate-back";
import { ExpenseCompletion } from "./ExpenseCompletion";
import { useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";

export function ExpenseView() {
  const { activeStore } = useGetActiveStore();
  const cart = useExpenseOperations();
  const store = useExpenseStore();
  const { createSession, releaseSessionInventoryHoldsAndDeleteItems } =
    useSessionManagementExpense();
  const terminal = useGetTerminal();
  const autoSessionInitialized = useRef(false);
  const completeExpenseSession = useMutation(
    api.inventory.expenseSessions.completeExpenseSession
  );

  // Initialize store with active store
  useEffect(() => {
    if (activeStore?._id && store.storeId !== activeStore._id) {
      store.setStoreId(activeStore._id);
    }
  }, [activeStore, store]);

  useEffect(() => {
    if (terminal?._id && store.terminalId !== terminal._id) {
      store.setTerminalId(terminal._id);
    }
  }, [terminal, store]);

  const handleSessionLoaded = (sessionData: any) => {
    store.loadSessionData(sessionData);
  };

  const resetAutoSessionInitialized = () => {
    autoSessionInitialized.current = false;
  };

  const handleNewSession = () => {
    store.startNewTransaction();
    resetAutoSessionInitialized();
  };

  const activeSessionQuery = useExpenseActiveSession(
    activeStore?._id,
    store.terminalId,
    store.cashier.id || undefined,
    store.ui.registerNumber
  );

  const isSessionActive = Boolean(
    activeSessionQuery?.status === "active" &&
      activeSessionQuery.expiresAt &&
      activeSessionQuery.expiresAt > Date.now()
  );

  const handleCashierAuthenticated = (cashierId: Id<"cashier">) => {
    store.setCashier(cashierId);
  };

  // Auto-check for active session or create one on mount
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

    if (activeSessionQuery === undefined) {
      return;
    }

    autoSessionInitialized.current = true;

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
        return;
      }

      logger.info("[Expense] Active session found, loading into store", {
        sessionId: activeSessionQuery._id,
        sessionNumber: activeSessionQuery.sessionNumber,
        itemCount: activeSessionQuery.cartItems?.length || 0,
      });

      handleSessionLoaded(activeSessionQuery);
      return;
    }

    if (activeSessionQuery === null) {
      if (store.session.currentSessionId) {
        logger.debug("[Expense] Clearing stale session ID", {
          staleSessionId: store.session.currentSessionId,
        });
        store.setCurrentSessionId(null);
        store.setActiveSession(null);
        if (store.cashier.isAuthenticated) {
          store.clearCashier();
        }
      }

      if (store.session.isCreating) {
        logger.debug(
          "[Expense] Session creation already in progress, skipping auto-init"
        );
        return;
      }

      logger.info("[Expense] No active session found, creating new session", {
        storeId: activeStore._id,
        registerNumber: store.ui.registerNumber,
        cashierId: store.cashier.id,
      });

      createSession(activeStore._id, store.cashier.id || undefined)
        .then(() => store.startNewTransaction())
        .catch((error) => {
          logger.error("[Expense] Failed to auto-create session", error);
          autoSessionInitialized.current = false;
        });
    }
  }, [
    activeStore?._id,
    store.storeId,
    store.cashier.isAuthenticated,
    store.cashier.id,
    activeSessionQuery,
    createSession,
    store.ui.registerNumber,
    store.session.currentSessionId,
    handleSessionLoaded,
  ]);

  useEffect(() => {
    autoSessionInitialized.current = false;
  }, [activeStore?._id, store.ui.registerNumber]);

  // Extract barcode or product ID from unified search input
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

  const productIdSearchResults = usePOSProductSearch(
    activeStore?._id,
    productIdSearchQuery
  );

  const barcodeSearchQuery =
    extractResult.type === "barcode" ? debouncedValue : "";

  const barcodeSearchResult = usePOSBarcodeSearch(
    activeStore?._id,
    barcodeSearchQuery
  );

  // Auto-add product to cart when match is found
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
      logger.info("[Expense] Auto-adding product from product ID", {
        productId: extractedValue,
        skuId: productIdSearchResults[0].skuId,
        productName: productIdSearchResults[0].name,
        delay: POS_AUTO_ADD_DELAY_MS,
      });
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
        const productToAdd = Array.isArray(barcodeSearchResult)
          ? barcodeSearchResult[0]
          : barcodeSearchResult;

        logger.info("[Expense] Auto-adding product from barcode", {
          barcode: extractedValue,
          productName: productToAdd.name,
          delay: POS_AUTO_ADD_DELAY_MS,
        });
        const timeoutId = setTimeout(async () => {
          await cart.addFromBarcode(extractedValue, barcodeSearchResult);
          store.setProductSearchQuery("");
        }, POS_AUTO_ADD_DELAY_MS);

        return () => clearTimeout(timeoutId);
      }
    }
  }, [
    extractedValue,
    extractResult.type,
    productIdSearchResults,
    barcodeSearchResult,
    cart,
    store,
  ]);

  const handleBarcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store.ui.productSearchQuery.trim()) return;

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
        const productToAdd = Array.isArray(barcodeSearchResult)
          ? barcodeSearchResult[0]
          : barcodeSearchResult;
        await cart.addFromBarcode(extractedValue, barcodeSearchResult);
        store.setProductSearchQuery("");
      }
    }
  };

  const handleClearCart = async () => {
    const sessionId = activeSessionQuery?._id || store.session.currentSessionId;
    if (!sessionId) return;
    const result = await releaseSessionInventoryHoldsAndDeleteItems(
      sessionId as Id<"expenseSession">
    );

    if (result.success) {
      toast.success("Cart cleared");
      cart.clearCart();
    }
  };

  const handleCompleteExpense = async () => {
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
      const result = await completeExpenseSession({
        sessionId: sessionId as Id<"expenseSession">,
        notes: store.ui.notes,
        totalValue,
      });

      if (result.success) {
        store.setTransactionCompleted(true, result.data.transactionNumber, {
          completedAt: new Date(),
          cartItems: store.cart.items,
          totalValue,
          notes: store.ui.notes,
        });
        toast.success("Expense recorded successfully");
        store.clearTransaction();
        store.clearCart();
        store.clearSession();
        store.clearCashier();
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      logger.error("[Expense] Failed to complete expense", error as Error);
      toast.error((error as Error).message);
    } finally {
      store.setTransactionCompleting(false);
    }
  };

  const navigateBackBase = useNavigateBack();
  const { voidSession } = useSessionManagementExpense();

  // Handle navigation back - void session if active
  const handleNavigateBack = async () => {
    const sessionId = activeSessionQuery?._id || store.session.currentSessionId;

    if (sessionId && !store.transaction.isCompleted) {
      try {
        // Void the session
        await voidSession();

        logger.info("[Expense] Voided session on navigate back", { sessionId });
      } catch (error) {
        logger.error(
          "[Expense] Failed to void session on navigate back",
          error as Error
        );
        // Continue with navigation even if void fails
      }
    }

    store.clearCashier();
    navigateBackBase();
  };

  if (!activeStore) {
    return (
      <View
        header={
          <ComposedPageHeader
            leadingContent={
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-lg font-semibold text-gray-900">
                    Expense Products
                  </p>
                </div>
              </div>
            }
          />
        }
      >
        <FadeIn className="container mx-auto h-full w-full p-6">
          <div className="flex items-center justify-center h-64" />
        </FadeIn>
      </View>
    );
  }

  return (
    <View
      header={
        <ComposedPageHeader
          leadingContent={
            <div className="flex items-center gap-3">
              <p className="text-lg font-semibold text-gray-900">
                Expense Products
              </p>
              {isSessionActive && (
                <FadeIn className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse" />
                  <p className="text-sm text-green-600">Active Session</p>
                </FadeIn>
              )}
            </div>
          }
          onNavigateBack={handleNavigateBack}
        />
      }
    >
      <FadeIn className="container mx-auto h-full w-full p-6">
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {!store.transaction.isCompleted && (
              <div className="lg:col-span-2 space-y-16">
                <div className="px-6">
                  <ProductEntry
                    disabled={!terminal}
                    showProductLookup={store.ui.showProductEntry}
                    setShowProductLookup={store.setShowProductEntry}
                    productSearchQuery={store.ui.productSearchQuery}
                    setProductSearchQuery={store.setProductSearchQuery}
                    onBarcodeSubmit={handleBarcodeSubmit}
                    onAddProduct={cart.addProduct}
                    barcodeSearchResult={barcodeSearchResult}
                    productIdSearchResults={productIdSearchResults || undefined}
                  />
                </div>

                <div className="bg-white rounded-lg p-6">
                  <CartItems
                    cartItems={store.cart.items}
                    onUpdateQuantity={(
                      id: Id<"expenseSessionItem"> | Id<"posSessionItem">,
                      quantity: number
                    ) => {
                      cart.updateQuantity(
                        id as Id<"expenseSessionItem">,
                        quantity
                      );
                    }}
                    onRemoveItem={(
                      id: Id<"expenseSessionItem"> | Id<"posSessionItem">
                    ) => {
                      cart.removeItem(id as Id<"expenseSessionItem">);
                    }}
                    clearCart={handleClearCart}
                  />
                </div>
              </div>
            )}

            <div
              className={store.transaction.isCompleted ? "lg:col-span-3" : ""}
            >
              <div className="bg-white rounded-lg p-6 space-y-6">
                <ExpenseCompletion
                  cartItems={store.cart.items}
                  totalValue={store.cart.total}
                  notes={store.ui.notes}
                  onNotesChange={store.setNotes}
                  onComplete={handleCompleteExpense}
                  isCompleting={store.transaction.isCompleting}
                  isCompleted={store.transaction.isCompleted}
                  completedTransactionData={
                    store.transaction.completedTransactionData
                  }
                  onTransactionStateChange={(isCompleted) => {
                    if (!isCompleted) {
                      store.startNewTransaction();
                      autoSessionInitialized.current = false;
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </FadeIn>

      {activeStore?._id && terminal?._id && (
        <CashierAuthDialog
          open={!store.cashier.isAuthenticated}
          storeId={activeStore._id}
          terminalId={terminal._id}
          onAuthenticated={handleCashierAuthenticated}
          onDismiss={handleNavigateBack}
        />
      )}
    </View>
  );
}
