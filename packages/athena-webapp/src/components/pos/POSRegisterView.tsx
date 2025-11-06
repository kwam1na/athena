import { useEffect, useRef } from "react";
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
import { extractBarcodeFromInput } from "@/lib/pos/barcodeUtils";
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
import { XIcon } from "lucide-react";

export function POSRegisterView() {
  const { activeStore } = useGetActiveStore();

  // Use focused hooks for specific concerns
  const cart = useCartOperations();
  const customer = useCustomerOperations();
  const store = usePOSStore();
  const { createSession, releaseSessionInventoryHoldsAndDeleteItems } =
    useSessionManagement();

  // Compute total quantity once (total items across all SKUs)
  const totalCartQuantity = posSelectors.getCartItemCount(store);

  // Track if we've already attempted auto-session initialization
  const autoSessionInitialized = useRef(false);

  // Initialize store with active store
  useEffect(() => {
    if (activeStore?._id && store.storeId !== activeStore._id) {
      store.setStoreId(activeStore._id);
    }
  }, [activeStore, store]);

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
    undefined, // cashierId - could be passed if available from auth context
    store.ui.registerNumber
  );

  // Auto-check for active session or create one on mount
  useEffect(() => {
    // Skip if no store is set yet
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

  // Auto-replace URL with extracted barcode in the input field
  useEffect(() => {
    if (store.ui.productSearchQuery.trim()) {
      const extractedBarcode = extractBarcodeFromInput(
        store.ui.productSearchQuery
      );
      // If the extracted barcode is different from the input (meaning we parsed a URL),
      // replace the input with just the barcode
      if (extractedBarcode !== store.ui.productSearchQuery) {
        store.setProductSearchQuery(extractedBarcode);
      }
    }
  }, [store.ui.productSearchQuery, store]);

  // Extract barcode from unified search input (handles both URLs and plain barcodes)
  const actualBarcode = extractBarcodeFromInput(store.ui.productSearchQuery);

  // Debounce the barcode to prevent flickering "no product found" UI while user types
  const debouncedBarcode = useDebounce(actualBarcode, POS_SEARCH_DEBOUNCE_MS);

  // Get barcode search result using debounced barcode
  const barcodeSearchResult = usePOSBarcodeSearch(
    activeStore?._id,
    debouncedBarcode
  );

  // Auto-add product to cart when barcode match is found
  // Uses a delay to allow search completion and user verification before adding
  useEffect(() => {
    if (!actualBarcode.trim() || !barcodeSearchResult) {
      return;
    }

    const timeoutId = setTimeout(async () => {
      await cart.addFromBarcode(actualBarcode, barcodeSearchResult);
      store.setProductSearchQuery("");
    }, POS_AUTO_ADD_DELAY_MS);

    // Cleanup: cancel timeout if barcode changes before delay completes
    return () => clearTimeout(timeoutId);
  }, [actualBarcode, barcodeSearchResult, cart, store]);

  // Handle barcode/URL submission from unified search input
  const handleBarcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store.ui.productSearchQuery.trim()) return;

    if (barcodeSearchResult) {
      await cart.addFromBarcode(actualBarcode, barcodeSearchResult);
      store.setProductSearchQuery("");
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

  if (!activeStore) {
    return (
      <View
        header={
          <ComposedPageHeader
            leadingContent={
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-lg font-semibold text-gray-900">
                    POS Register
                  </p>
                </div>
              </div>
            }
          />
        }
      >
        <FadeIn className="container mx-auto h-full w-full p-6">
          <div className="flex items-center justify-center h-64">
            {/* <p className="text-gray-500">No active store found</p> */}
          </div>
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
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse" />
                  <p className="text-sm text-green-600">Active Session</p>
                </div>
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
                <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg border">
                  <SessionManager
                    key={`session-manager-${store.session.currentSessionId || "no-session"}-${store.session.activeSession?.sessionNumber || "empty"}`}
                    storeId={activeStore._id}
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

                {/* Register Info Section */}
                <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg border">
                  <RegisterActions
                    customerName={store.customer.current?.name}
                    registerNumber={store.ui.registerNumber}
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
              <div className="lg:col-span-2 space-y-6">
                {/* Product Entry Section */}
                <div className="p-6">
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
                  />
                </div>

                {/* Cart Items Section */}
                <div className="bg-white rounded-lg p-6">
                  <div className="mb-4 flex items-center justify-between">
                    {/* <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        Cart Items
                      </h3>
                    </div> */}
                    {cart.cartItems.length > 0 && (
                      <Button
                        variant="outline"
                        onClick={handleClearCart}
                        className="ml-auto hover:bg-red-50 hover:text-red-500"
                        // disabled={!activeSessionQuery}
                      >
                        <XIcon className="w-4 h-4" />
                        Clear Items
                      </Button>
                    )}
                  </div>
                  <CartItems
                    cartItems={store.cart.items}
                    onUpdateQuantity={cart.updateQuantity}
                    onRemoveItem={cart.removeItem}
                  />
                </div>
              </div>
            )}

            {/* Right Panel - Order Summary & Payment */}
            <div
              className={store.transaction.isCompleted ? "lg:col-span-3" : ""}
            >
              <div className="bg-white rounded-lg p-6">
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
              </div>
            </div>
          </div>
        </div>
      </FadeIn>
    </View>
  );
}
