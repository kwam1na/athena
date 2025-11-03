import { useEffect } from "react";
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
import { usePOSOperations } from "@/hooks/usePOSOperations";
import { usePOSBarcodeSearch } from "@/hooks/usePOSProducts";
import { useDebounce } from "@/hooks/useDebounce";
import { extractBarcodeFromInput } from "@/lib/pos/barcodeUtils";
import {
  POS_SEARCH_DEBOUNCE_MS,
  POS_AUTO_ADD_DELAY_MS,
} from "@/lib/pos/constants";

export function POSRegisterView() {
  const { activeStore } = useGetActiveStore();
  const { cart, session, customer, ui, state, store, transaction } =
    usePOSOperations();

  // Initialize store with active store
  useEffect(() => {
    if (activeStore?._id && state.storeId !== activeStore._id) {
      store.setStoreId(activeStore._id);
    }
  }, [activeStore, state.storeId, store]);

  // Auto-replace URL with extracted barcode in the input field
  useEffect(() => {
    if (state.productSearchQuery.trim()) {
      const extractedBarcode = extractBarcodeFromInput(
        state.productSearchQuery
      );
      // If the extracted barcode is different from the input (meaning we parsed a URL),
      // replace the input with just the barcode
      if (extractedBarcode !== state.productSearchQuery) {
        ui.setProductSearchQuery(extractedBarcode);
      }
    }
  }, [state.productSearchQuery]);

  // Extract barcode from unified search input (handles both URLs and plain barcodes)
  const actualBarcode = extractBarcodeFromInput(state.productSearchQuery);

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
      ui.setProductSearchQuery("");
    }, POS_AUTO_ADD_DELAY_MS);

    // Cleanup: cancel timeout if barcode changes before delay completes
    return () => clearTimeout(timeoutId);
  }, [actualBarcode, barcodeSearchResult]);

  // Handle barcode/URL submission from unified search input
  const handleBarcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state.productSearchQuery.trim()) return;

    if (barcodeSearchResult) {
      await cart.addFromBarcode(actualBarcode, barcodeSearchResult);
      ui.setProductSearchQuery("");
    }
  };

  // Handle session loading from SessionManager
  const handleSessionLoaded = (sessionData: any) => {
    store.loadSessionData(sessionData);
  };

  // Handle new session from SessionManager
  const handleNewSession = () => {
    session.startNewSession();
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
              <div>
                <p className="text-lg font-semibold text-gray-900">
                  POS Register
                </p>
              </div>
            </div>
          }
          trailingContent={
            !state.isTransactionCompleted ? (
              <div className="flex items-center gap-4">
                {/* Quick Actions Section */}
                <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg border">
                  <QuickActionsBar
                    showCustomerInfo={state.isCustomerPanelOpen}
                    setShowCustomerInfo={ui.setShowCustomerPanel}
                  />
                </div>

                {/* Session Management Section */}
                <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg border">
                  <SessionManager
                    key={`session-manager-${state.currentSessionId || "no-session"}-${state.activeSession?.sessionNumber || "empty"}`}
                    storeId={activeStore._id}
                    registerNumber={state.registerNumber}
                    cartItems={state.cartItems}
                    customerInfo={
                      state.currentCustomer || {
                        customerId: undefined,
                        name: "",
                        email: "",
                        phone: "",
                      }
                    }
                    subtotal={state.cartSubtotal}
                    tax={state.cartTax}
                    total={state.cartTotal}
                    onSessionLoaded={handleSessionLoaded}
                    onNewSession={handleNewSession}
                  />
                </div>

                {/* Register Info Section */}
                <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg border">
                  <RegisterActions
                    customerName={state.currentCustomer?.name}
                    registerNumber={state.registerNumber}
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
          {!state.isTransactionCompleted && (
            <CustomerInfoPanel
              isOpen={state.isCustomerPanelOpen}
              onOpenChange={ui.setShowCustomerPanel}
              customerInfo={
                state.currentCustomer || {
                  customerId: undefined,
                  name: "",
                  email: "",
                  phone: "",
                }
              }
              setCustomerInfo={(info) => {
                if (typeof info === "function") {
                  // Handle setter function by applying it to current state
                  const currentInfo = state.currentCustomer || {
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
            {!state.isTransactionCompleted && (
              <div className="lg:col-span-2 space-y-6">
                {/* Product Entry Section */}
                <div className="bg-white rounded-lg border shadow-sm p-6">
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Product Entry
                    </h3>
                    <p className="text-sm text-gray-500">Search for products</p>
                  </div>
                  <ProductEntry
                    barcodeInput=""
                    setBarcodeInput={() => {}}
                    isScanning={state.isScanning}
                    setIsScanning={ui.setIsScanning}
                    showProductLookup={state.isProductEntryOpen}
                    setShowProductLookup={ui.setShowProductEntry}
                    productSearchQuery={state.productSearchQuery}
                    setProductSearchQuery={ui.setProductSearchQuery}
                    onBarcodeSubmit={handleBarcodeSubmit}
                    onAddProduct={cart.addProduct}
                    barcodeSearchResult={barcodeSearchResult}
                  />
                </div>

                {/* Cart Items Section */}
                <div className="bg-white rounded-lg border shadow-sm p-6">
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Cart Items
                    </h3>
                    <p className="text-sm text-gray-500">
                      {!state.isCartEmpty &&
                        `${state.cartItemCount} item${state.cartItemCount > 1 ? "s" : ""} in cart`}
                    </p>
                  </div>
                  <CartItems
                    cartItems={state.cartItems}
                    onUpdateQuantity={cart.updateQuantity}
                    onRemoveItem={cart.removeItem}
                  />
                </div>
              </div>
            )}

            {/* Right Panel - Order Summary & Payment */}
            <div
              className={state.isTransactionCompleted ? "lg:col-span-3" : ""}
            >
              <div className="bg-white rounded-lg border shadow-sm p-6">
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {state.isTransactionCompleted && "Transaction Complete"}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {state.isTransactionCompleted &&
                      "Transaction has been processed successfully"}
                  </p>
                </div>
                <OrderSummary
                  cartItems={state.cartItems}
                  onClearCart={cart.clearCart}
                  onClearCustomer={customer.clearCustomer}
                  customerId={state.currentCustomer?.customerId}
                  customerInfo={
                    state.currentCustomer
                      ? {
                          name: state.currentCustomer.name,
                          email: state.currentCustomer.email,
                          phone: state.currentCustomer.phone,
                        }
                      : undefined
                  }
                  registerNumber={state.registerNumber}
                  currentSessionId={state.currentSessionId}
                  onTransactionStateChange={(isCompleted) => {
                    if (!isCompleted) {
                      // Start new transaction when clearing completed state
                      transaction.startNewTransaction();
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
