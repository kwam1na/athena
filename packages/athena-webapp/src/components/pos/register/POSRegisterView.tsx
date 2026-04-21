import { ComposedPageHeader } from "@/components/common/PageHeader";
import { FadeIn } from "@/components/common/FadeIn";
import { CashierAuthDialog } from "@/components/pos/CashierAuthDialog";
import { CartItems } from "@/components/pos/CartItems";
import { ProductEntry } from "@/components/pos/ProductEntry";
import View from "@/components/View";
import { cn } from "~/src/lib/utils";

import { useRegisterViewModel } from "@/lib/pos/presentation/register/useRegisterViewModel";

import { RegisterActionBar } from "./RegisterActionBar";
import { RegisterCheckoutPanel } from "./RegisterCheckoutPanel";
import { RegisterCustomerPanel } from "./RegisterCustomerPanel";

export function POSRegisterView() {
  const viewModel = useRegisterViewModel();

  if (!viewModel.hasActiveStore) {
    return (
      <View
        header={
          <ComposedPageHeader
            leadingContent={
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-lg font-semibold text-gray-900">
                    {viewModel.header.title}
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
          onNavigateBack={viewModel.onNavigateBack}
          leadingContent={
            <div className="flex items-center gap-3">
              <p className="text-lg font-semibold text-gray-900">
                {viewModel.header.title}
              </p>
              {viewModel.header.isSessionActive && (
                <FadeIn className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse" />
                  <p className="text-sm text-green-600">Active Session</p>
                </FadeIn>
              )}
            </div>
          }
          trailingContent={
            !viewModel.checkout.isTransactionCompleted ? (
              <RegisterActionBar
                registerInfo={viewModel.registerInfo}
                sessionPanel={viewModel.sessionPanel}
              />
            ) : undefined
          }
        />
      }
    >
      <FadeIn className="container mx-auto h-full w-full p-6">
        <div className="space-y-6">
          {!viewModel.checkout.isTransactionCompleted && (
            <RegisterCustomerPanel customerPanel={viewModel.customerPanel} />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {!viewModel.checkout.isTransactionCompleted && (
              <div className="lg:col-span-2 space-y-16">
                <div className="px-6">
                  <ProductEntry
                    disabled={viewModel.productEntry.disabled}
                    showProductLookup={viewModel.productEntry.showProductLookup}
                    setShowProductLookup={
                      viewModel.productEntry.setShowProductLookup
                    }
                    productSearchQuery={
                      viewModel.productEntry.productSearchQuery
                    }
                    setProductSearchQuery={
                      viewModel.productEntry.setProductSearchQuery
                    }
                    onBarcodeSubmit={viewModel.productEntry.onBarcodeSubmit}
                    onAddProduct={viewModel.productEntry.onAddProduct}
                    barcodeSearchResult={
                      viewModel.productEntry.barcodeSearchResult
                    }
                    productIdSearchResults={
                      viewModel.productEntry.productIdSearchResults
                    }
                  />
                </div>

                <div className="bg-white rounded-lg p-6">
                  <CartItems
                    cartItems={viewModel.cart.items}
                    onUpdateQuantity={viewModel.cart.onUpdateQuantity}
                    onRemoveItem={viewModel.cart.onRemoveItem}
                    clearCart={viewModel.cart.onClearCart}
                  />
                </div>
              </div>
            )}

            <div
              className={cn(
                viewModel.checkout.isTransactionCompleted && "lg:col-span-3",
              )}
            >
              <div className="bg-white rounded-lg p-6">
                <RegisterCheckoutPanel
                  checkout={viewModel.checkout}
                  cashierCard={viewModel.cashierCard}
                />
              </div>
            </div>
          </div>
        </div>
      </FadeIn>

      {viewModel.authDialog && (
        <CashierAuthDialog
          open={viewModel.authDialog.open}
          storeId={viewModel.authDialog.storeId}
          terminalId={viewModel.authDialog.terminalId}
          onAuthenticated={viewModel.authDialog.onAuthenticated}
          onDismiss={viewModel.authDialog.onDismiss}
        />
      )}
    </View>
  );
}
