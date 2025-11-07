import { useEffect, useMemo, useRef } from "react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { FadeIn } from "../common/FadeIn";
import { ComposedPageHeader } from "../common/PageHeader";
import { RegisterActions } from "./RegisterActions";
import { QuickActionsBar } from "./QuickActionsBar";
import { CustomerInfoPanel } from "./CustomerInfoPanel";
import { ProductEntry } from "./ProductEntry";
import { SessionManager } from "./SessionManager";
import { CartItems } from "./CartItems";
import { OrderSummary } from "./OrderSummary";
import { useCartOperations } from "@/hooks/useCartOperations";
import { useCustomerOperations } from "@/hooks/useCustomerOperations";
import { usePOSStore, posSelectors } from "@/stores/posStore";
import { usePOSBarcodeSearch } from "@/hooks/usePOSProducts";
import { useDebounce } from "@/hooks/useDebounce";
import {
  extractBarcodeFromInput,
  type ExtractResult,
} from "@/lib/pos/barcodeUtils";
import { usePOSProductIdSearch } from "@/hooks/usePOSProducts";
import {
  POS_SEARCH_DEBOUNCE_MS,
  POS_AUTO_ADD_DELAY_MS,
} from "@/lib/pos/constants";
import { usePOSActiveSession } from "@/hooks/usePOSSessions";
import { useSessionManagement } from "@/hooks/useSessionManagement";
import { logger } from "@/lib/logger";
import { Button } from "../ui/button";
import { toast } from "sonner";
import { Id } from "~/convex/_generated/dataModel";
import { ScanBarcode, Terminal, XIcon } from "lucide-react";
import { motion } from "framer-motion";
import { useGetTerminal } from "~/src/hooks/useGetTerminal";
import { EmptyState } from "../states/empty/empty-state";
import { Link } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";
import { CashierView } from "./CashierView";

export function POSRegisterView() {
  const { activeStore } = useGetActiveStore();

  // Use focused hooks for specific concerns
  const cart = useCartOperations();
  const customer = useCustomerOperations();
  const store = usePOSStore();
  const { createSession, releaseSessionInventoryHoldsAndDeleteItems } =
    useSessionManagement();

  const terminal = useGetTerminal();

  // Track if we've already attempted auto-session initialization
  const autoSessionInitialized = useRef(false);

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

  // Handle session loading from SessionManager
  const handleSessionLoaded = (sessionData: any) => {
    console.log("sessionData received", sessionData);
    store.loadSessionData(sessionData);
  };

  // Handle new session from SessionManager
  const handleNewSession = () => {
    store.startNewTransaction();
    // Reset flag so auto-session check will run again for new transaction
    autoSessionInitialized.current = false;
  };

  // Query for active session for this store/register
  const activeSessionQuery = usePOSActiveSession(
    activeStore?._id,
    store.terminalId,
    undefined, // cashierId - could be passed if available from auth context
    store.ui.registerNumber
  );

  // Auto-check for active session or create one on mount
  useEffect(() => {
    // Skip if no store is set yet or terminal is not registered
    if (!activeStore?._id || !store.storeId) {
      return;
    }

    // Prevent multiple initialization attempts
    if (autoSessionInitialized.current) {
      return;
    }

    // Wait for query to finish loading
    if (activeSessionQuery === undefined) {
      console.log("still loading - wait");
      // Still loading - wait
      return;
    }

    // Mark as initialized to prevent duplicate attempts
    autoSessionInitialized.current = true;

    // If an active session exists, load it into the store
    if (activeSessionQuery) {
      // If we already have a session ID in the store, only load if it matches
      // This prevents loading a different/stale session during transitions
      if (
        store.session.currentSessionId &&
        store.session.currentSessionId !== activeSessionQuery._id
      ) {
        logger.debug(
          "[POS] Skipping session load - ID mismatch (expecting different session)",
          {
            storeSessionId: store.session.currentSessionId,
            querySessionId: activeSessionQuery._id,
          }
        );
        return;
      }

      // Check if session has expired
      const now = Date.now();
      if (activeSessionQuery.expiresAt && activeSessionQuery.expiresAt < now) {
        logger.warn("[POS] Active session has expired, clearing state", {
          sessionId: activeSessionQuery._id,
          expiresAt: activeSessionQuery.expiresAt,
          now,
        });
        // Clear stale session ID
        store.setCurrentSessionId(null);
        store.setActiveSession(null);
        // Reset flag so we can create a new session
        autoSessionInitialized.current = false;
        return;
      }

      logger.info("[POS] Active session found, loading into store", {
        sessionId: activeSessionQuery._id,
        sessionNumber: activeSessionQuery.sessionNumber,
        itemCount: activeSessionQuery.cartItems?.length || 0,
      });

      handleSessionLoaded(activeSessionQuery);
      return;
    }

    // No active session found - clear any stale session ID and auto-create one
    if (activeSessionQuery === null) {
      // Clear any stale session ID from store (query is null, so store ID is stale)
      if (store.session.currentSessionId) {
        logger.debug("[POS] Clearing stale session ID", {
          staleSessionId: store.session.currentSessionId,
        });
        store.setCurrentSessionId(null);
        store.setActiveSession(null);
      }

      // Prevent creating if session is already being created
      if (store.session.isCreating) {
        logger.debug(
          "[POS] Session creation already in progress, skipping auto-init"
        );
        return;
      }

      logger.info("[POS] No active session found, creating new session", {
        storeId: activeStore._id,
        registerNumber: store.ui.registerNumber,
      });

      createSession(activeStore._id).catch((error) => {
        logger.error("[POS] Failed to auto-create session", error);
        // Error toast already shown by createSession
        // Reset flag so we can retry
        autoSessionInitialized.current = false;
      });
    }
  }, [
    activeStore?._id,
    store.storeId,
    activeSessionQuery,
    createSession,
    store.ui.registerNumber,
    store.session.currentSessionId,
    handleSessionLoaded,
  ]);

  // Reset auto-session flag when store or register changes
  useEffect(() => {
    autoSessionInitialized.current = false;
  }, [activeStore?._id, store.ui.registerNumber]);

  // Sync currentSessionId with activeSessionQuery to prevent stale IDs
  useEffect(() => {
    if (activeSessionQuery === undefined) {
      // Still loading, wait
      return;
    }

    if (activeSessionQuery === null) {
      // No active session - clear store ID if it exists
      if (store.session.currentSessionId) {
        logger.debug(
          "[POS] Syncing: Clearing stale session ID (no active session)",
          {
            staleSessionId: store.session.currentSessionId,
          }
        );
        // store.setCurrentSessionId(null);
        // store.setActiveSession(null);
      }
      return;
    }
  }, [activeSessionQuery, store]);

  // Extract barcode or product ID from unified search input (handles both URLs and plain barcodes)
  const extractionCacheRef = useRef<ExtractResult | null>(null);
  const rawExtraction = extractBarcodeFromInput(store.ui.productSearchQuery);
  const shouldReuseCachedProductId =
    rawExtraction.type === "barcode" &&
    extractionCacheRef.current?.type === "productId" &&
    extractionCacheRef.current.value === rawExtraction.value;

  const extractResult = shouldReuseCachedProductId
    ? extractionCacheRef.current!
    : rawExtraction;
  const extractionSource = shouldReuseCachedProductId ? "cached" : "raw";
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

  // Log extraction result for debugging
  useEffect(() => {
    if (store.ui.productSearchQuery.trim()) {
      logger.debug("[POS] Extracted value from input", {
        input: store.ui.productSearchQuery,
        extractedValue,
        type: extractResult.type,
        isUrl: store.ui.productSearchQuery !== extractedValue,
        source: extractionSource,
      });
    }
  }, [
    store.ui.productSearchQuery,
    extractedValue,
    extractResult.type,
    extractionSource,
  ]);

  // Auto-replace URL with extracted value in the input field
  useEffect(() => {
    if (store.ui.productSearchQuery.trim()) {
      // If the extracted value is different from the input (meaning we parsed a URL),
      // replace the input with just the extracted value
      if (
        extractResult.type === "barcode" &&
        extractedValue !== store.ui.productSearchQuery
      ) {
        logger.debug("[POS] Replacing URL input with extracted value", {
          originalInput: store.ui.productSearchQuery,
          extractedValue,
          type: extractResult.type,
        });
        store.setProductSearchQuery(extractedValue);
      }
    }
  }, [store.ui.productSearchQuery, extractedValue, store, extractResult.type]);

  // Debounce the extracted value to prevent flickering "no product found" UI while user types
  const debouncedValue = useDebounce(extractedValue, POS_SEARCH_DEBOUNCE_MS);

  // Log debounced value changes
  useEffect(() => {
    if (debouncedValue !== extractedValue) {
      logger.debug("[POS] Debouncing search value", {
        originalValue: extractedValue,
        debouncedValue,
        type: extractResult.type,
        source: extractionSource,
      });
    }
  }, [debouncedValue, extractedValue, extractResult.type, extractionSource]);

  // Get product ID search results (array of SKUs)
  const productIdSearchQuery =
    extractResult.type === "productId" ? debouncedValue : "";
  const productIdSearchResults = usePOSProductIdSearch(
    activeStore?._id,
    productIdSearchQuery
  );

  // Log product ID search
  useEffect(() => {
    if (extractResult.type === "productId" && productIdSearchQuery) {
      logger.debug("[POS] Product ID search triggered", {
        productId: productIdSearchQuery,
        storeId: activeStore?._id,
        resultsCount: productIdSearchResults?.length ?? 0,
        isLoading: productIdSearchResults === undefined,
      });
    }
  }, [
    extractResult.type,
    productIdSearchQuery,
    activeStore?._id,
    productIdSearchResults,
  ]);

  // Get barcode search result (single product or null)
  const barcodeSearchQuery =
    extractResult.type === "barcode" ? debouncedValue : "";
  const barcodeSearchResult = usePOSBarcodeSearch(
    activeStore?._id,
    barcodeSearchQuery
  );

  // Log barcode search
  useEffect(() => {
    if (extractResult.type === "barcode" && barcodeSearchQuery) {
      logger.debug("[POS] Barcode search triggered", {
        barcode: barcodeSearchQuery,
        storeId: activeStore?._id,
        found:
          barcodeSearchResult !== null && barcodeSearchResult !== undefined,
        isLoading: barcodeSearchResult === undefined,
      });
    }
  }, [
    extractResult.type,
    barcodeSearchQuery,
    activeStore?._id,
    barcodeSearchResult,
  ]);

  // Auto-add product to cart when match is found
  // Uses a delay to allow search completion and user verification before adding
  useEffect(() => {
    if (!extractedValue.trim()) {
      return;
    }

    // For product ID: auto-add if only one SKU available
    if (
      extractResult.type === "productId" &&
      productIdSearchResults &&
      productIdSearchResults.length === 1
    ) {
      logger.info("[POS] Auto-adding product from product ID", {
        productId: extractedValue,
        skuId: productIdSearchResults[0].skuId,
        productName: productIdSearchResults[0].name,
        delay: POS_AUTO_ADD_DELAY_MS,
      });
      const timeoutId = setTimeout(async () => {
        logger.debug("[POS] Executing auto-add product (product ID)", {
          productId: extractedValue,
          skuId: productIdSearchResults[0].skuId,
        });
        await cart.addProduct(productIdSearchResults[0]);
        store.setProductSearchQuery("");
      }, POS_AUTO_ADD_DELAY_MS);

      return () => clearTimeout(timeoutId);
    }

    // For barcode: auto-add if result found (existing behavior)
    if (extractResult.type === "barcode" && barcodeSearchResult) {
      logger.info("[POS] Auto-adding product from barcode", {
        barcode: extractedValue,
        productName: barcodeSearchResult.name,
        delay: POS_AUTO_ADD_DELAY_MS,
      });
      const timeoutId = setTimeout(async () => {
        logger.debug("[POS] Executing auto-add product (barcode)", {
          barcode: extractedValue,
        });
        await cart.addFromBarcode(extractedValue, barcodeSearchResult);
        store.setProductSearchQuery("");
      }, POS_AUTO_ADD_DELAY_MS);

      return () => clearTimeout(timeoutId);
    }
  }, [
    extractedValue,
    extractResult.type,
    productIdSearchResults,
    barcodeSearchResult,
    cart,
    store,
  ]);

  // Handle barcode/URL submission from unified search input
  const handleBarcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store.ui.productSearchQuery.trim()) return;

    logger.debug("[POS] Handling barcode/URL submission", {
      input: store.ui.productSearchQuery,
      extractedValue,
      type: extractResult.type,
      source: extractionSource,
    });

    // For product ID: if single SKU, add it; otherwise let user select from results
    if (extractResult.type === "productId" && productIdSearchResults) {
      if (productIdSearchResults.length === 1) {
        logger.info("[POS] Adding product from product ID (manual submit)", {
          productId: extractedValue,
          skuId: productIdSearchResults[0].skuId,
          productName: productIdSearchResults[0].name,
        });
        await cart.addProduct(productIdSearchResults[0]);
        store.setProductSearchQuery("");
      } else {
        logger.debug("[POS] Multiple SKUs found, showing selection", {
          productId: extractedValue,
          skuCount: productIdSearchResults.length,
        });
      }
      // If multiple SKUs, they'll be shown in search results for user to select
      return;
    }

    // For barcode: add directly if found
    if (extractResult.type === "barcode" && barcodeSearchResult) {
      logger.info("[POS] Adding product from barcode (manual submit)", {
        barcode: extractedValue,
        productName: barcodeSearchResult.name,
      });
      await cart.addFromBarcode(extractedValue, barcodeSearchResult);
      store.setProductSearchQuery("");
    } else if (extractResult.type === "barcode" && !barcodeSearchResult) {
      logger.warn("[POS] Barcode not found", {
        barcode: extractedValue,
        storeId: activeStore?._id,
      });
    }
  };

  const handleClearCart = async () => {
    const sessionId = activeSessionQuery?._id || store.session.currentSessionId;
    if (!sessionId) return;
    const result = await releaseSessionInventoryHoldsAndDeleteItems(
      sessionId as Id<"posSession">
    );

    if (result.success) {
      toast.success("Cart cleared");
      cart.clearCart();
    }
  };

  if (terminal === null) {
    return (
      <View
        header={
          <ComposedPageHeader
            leadingContent={
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-lg font-semibold text-gray-900">POS</p>
                </div>
              </div>
            }
          />
        }
      >
        <FadeIn className="container mx-auto h-full w-full p-6">
          <div className="flex items-center justify-center min-h-[60vh] w-full">
            <EmptyState
              title="Terminal not registered"
              icon={<ScanBarcode className="w-16 h-16 text-muted-foreground" />}
              cta={
                <Button variant={"outline"}>
                  <Link
                    params={(params) => ({
                      ...params,
                      orgUrlSlug: params.orgUrlSlug!,
                      storeUrlSlug: params.storeUrlSlug!,
                    })}
                    search={{
                      o: getOrigin(),
                    }}
                    to="/$orgUrlSlug/store/$storeUrlSlug/pos/settings"
                  >
                    Register Terminal
                  </Link>
                </Button>
              }
            />
          </div>
        </FadeIn>
      </View>
    );
  }

  if (!activeStore) {
    return (
      <View
        header={
          <ComposedPageHeader
            leadingContent={
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-lg font-semibold text-gray-900">POS</p>
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
              <p className="text-lg font-semibold text-gray-900">POS</p>
              {activeSessionQuery && (
                <FadeIn className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse" />
                  <p className="text-sm text-green-600">Active Session</p>
                </FadeIn>
              )}
            </div>
          }
          trailingContent={
            !store.transaction.isCompleted ? (
              <div className="flex items-center gap-4">
                {/* Quick Actions Section */}
                <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg border">
                  <QuickActionsBar
                    showCustomerInfo={store.ui.showCustomerPanel}
                    setShowCustomerInfo={store.setShowCustomerPanel}
                  />
                </div>

                {/* Session Management Section */}
                {terminal && (
                  <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg border">
                    <SessionManager
                      key={`session-manager-${store.session.currentSessionId || "no-session"}-${store.session.activeSession?.sessionNumber || "empty"}`}
                      storeId={activeStore._id}
                      terminalId={terminal._id}
                      registerNumber={store.ui.registerNumber}
                      cartItems={store.cart.items}
                      customerInfo={
                        store.customer.current || {
                          customerId: undefined,
                          name: "",
                          email: "",
                          phone: "",
                        }
                      }
                      subtotal={store.cart.subtotal}
                      tax={store.cart.tax}
                      total={store.cart.total}
                      onSessionLoaded={handleSessionLoaded}
                      onNewSession={handleNewSession}
                    />
                  </div>
                )}

                {/* Register Info Section */}
                <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg border">
                  <RegisterActions
                    customerName={store.customer.current?.name}
                    registerNumber={terminal?.displayName || "No terminal"}
                  />
                </div>
              </div>
            ) : undefined
          }
        />
      }
    >
      <FadeIn className="container mx-auto h-full w-full p-6">
        <div className="space-y-6">
          {/* Customer Information Panel */}
          {!store.transaction.isCompleted && (
            <CustomerInfoPanel
              isOpen={store.ui.showCustomerPanel}
              onOpenChange={store.setShowCustomerPanel}
              customerInfo={
                store.customer.current || {
                  customerId: undefined,
                  name: "",
                  email: "",
                  phone: "",
                }
              }
              setCustomerInfo={(info) => {
                if (typeof info === "function") {
                  // Handle setter function by applying it to current state
                  const currentInfo = store.customer.current || {
                    customerId: undefined,
                    name: "",
                    email: "",
                    phone: "",
                  };
                  const newInfo = info(currentInfo);
                  // Use updateCustomerInfo to avoid closing the panel
                  customer.updateCustomerInfo(newInfo);
                } else {
                  // Handle direct value - use updateCustomerInfo to avoid closing panel
                  customer.updateCustomerInfo(info);
                }
              }}
            />
          )}

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Panel - Product Entry */}
            {!store.transaction.isCompleted && (
              <div className="lg:col-span-2 space-y-56">
                {/* Product Entry Section */}
                <div className="px-6">
                  <ProductEntry
                    barcodeInput=""
                    setBarcodeInput={() => {}}
                    isScanning={store.ui.isScanning}
                    setIsScanning={store.setIsScanning}
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

                {/* Cart Items Section */}
                <div className="bg-white rounded-lg p-6">
                  <CartItems
                    cartItems={store.cart.items}
                    onUpdateQuantity={cart.updateQuantity}
                    onRemoveItem={cart.removeItem}
                    clearCart={handleClearCart}
                  />
                </div>
              </div>
            )}

            {/* Right Panel - Order Summary & Payment */}
            <div
              className={store.transaction.isCompleted ? "lg:col-span-3" : ""}
            >
              <div className="bg-white rounded-lg p-6 space-y-6">
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {store.transaction.isCompleted && "Transaction Complete"}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {store.transaction.isCompleted &&
                      "Transaction has been processed successfully"}
                  </p>
                </div>
                <OrderSummary
                  cartItems={store.cart.items}
                  onClearCart={cart.clearCart}
                  onClearCustomer={customer.clearCustomer}
                  customerId={store.customer.current?.customerId}
                  customerInfo={
                    store.customer.current
                      ? {
                          name: store.customer.current.name,
                          email: store.customer.current.email,
                          phone: store.customer.current.phone,
                        }
                      : undefined
                  }
                  registerNumber={store.ui.registerNumber}
                  currentSessionId={store.session.currentSessionId}
                  onTransactionStateChange={(isCompleted) => {
                    if (!isCompleted) {
                      // Start new transaction when clearing completed state
                      store.startNewTransaction();
                      // Reset flag so auto-session check will run again
                      autoSessionInitialized.current = false;
                    }
                  }}
                />

                <CashierView />
              </div>
            </div>
          </div>
        </div>
      </FadeIn>
    </View>
  );
}
