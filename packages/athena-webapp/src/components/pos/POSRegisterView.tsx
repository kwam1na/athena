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

  // Get barcode search result for manual entry
  const barcodeSearchResult = usePOSBarcodeSearch(
    activeStore?._id,
    state.barcodeInput
  );

  // Handle barcode form submission
  const handleBarcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state.barcodeInput.trim()) return;

    if (barcodeSearchResult) {
      await cart.addFromBarcode(state.barcodeInput, barcodeSearchResult);
      ui.setBarcodeInput("");
    } else {
      console.warn("Product not found for barcode:", state.barcodeInput);
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
          {/* Quick Actions Section */}
          {!state.isTransactionCompleted && (
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <QuickActionsBar
                showCustomerInfo={state.isCustomerPanelOpen}
                setShowCustomerInfo={ui.setShowCustomerPanel}
              />
            </div>
          )}

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
                    barcodeInput={state.barcodeInput}
                    setBarcodeInput={ui.setBarcodeInput}
                    isScanning={state.isScanning}
                    setIsScanning={ui.setIsScanning}
                    showProductLookup={state.isProductEntryOpen}
                    setShowProductLookup={ui.setShowProductEntry}
                    productSearchQuery={state.productSearchQuery}
                    setProductSearchQuery={ui.setProductSearchQuery}
                    onBarcodeSubmit={handleBarcodeSubmit}
                    onAddProduct={cart.addProduct}
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
