import { ComposedPageHeader } from "@/components/common/PageHeader";
import { FadeIn } from "@/components/common/FadeIn";
import { CashierAuthDialog } from "@/components/pos/CashierAuthDialog";
import { CartItems } from "@/components/pos/CartItems";
import {
  ProductEntry,
  ProductSearchInput,
} from "@/components/pos/ProductEntry";
import { useSidebar } from "@/components/ui/sidebar";
import View from "@/components/View";
import { cn } from "~/src/lib/utils";
import { ScanBarcode, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useRegisterViewModel } from "@/lib/pos/presentation/register/useRegisterViewModel";

import { RegisterActionBar } from "./RegisterActionBar";
import { RegisterCheckoutPanel } from "./RegisterCheckoutPanel";
import { RegisterCustomerPanel } from "./RegisterCustomerPanel";
import { RegisterDrawerGate } from "./RegisterDrawerGate";

function useCollapseSidebarForPosFlow() {
  const { isMobile, open, setOpen } = useSidebar();
  const collapsedForPosFlowRef = useRef(false);
  const previousSidebarOpenRef = useRef<boolean | null>(null);
  const setOpenRef = useRef(setOpen);

  useEffect(() => {
    setOpenRef.current = setOpen;
  }, [setOpen]);

  useEffect(() => {
    if (isMobile || collapsedForPosFlowRef.current) {
      return;
    }

    previousSidebarOpenRef.current = open;
    setOpen(false);
    collapsedForPosFlowRef.current = true;
  }, [isMobile, open, setOpen]);

  useEffect(() => {
    return () => {
      if (
        collapsedForPosFlowRef.current &&
        previousSidebarOpenRef.current !== null
      ) {
        setOpenRef.current(previousSidebarOpenRef.current);
      }
    };
  }, []);
}

function useLockDocumentScroll(shouldLockScroll: boolean) {
  useEffect(() => {
    if (!shouldLockScroll) {
      return;
    }

    const htmlStyle = document.documentElement.style;
    const bodyStyle = document.body.style;
    const previousHtmlOverflow = htmlStyle.overflow;
    const previousHtmlOverscrollBehaviorY = htmlStyle.overscrollBehaviorY;
    const previousBodyOverflow = bodyStyle.overflow;
    const previousBodyOverscrollBehaviorY = bodyStyle.overscrollBehaviorY;

    htmlStyle.overflow = "hidden";
    htmlStyle.overscrollBehaviorY = "none";
    bodyStyle.overflow = "hidden";
    bodyStyle.overscrollBehaviorY = "none";

    return () => {
      htmlStyle.overflow = previousHtmlOverflow;
      htmlStyle.overscrollBehaviorY = previousHtmlOverscrollBehaviorY;
      bodyStyle.overflow = previousBodyOverflow;
      bodyStyle.overscrollBehaviorY = previousBodyOverscrollBehaviorY;
    };
  }, [shouldLockScroll]);
}

function ProductLookupEmptyState() {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50/50 to-gray-100/30 p-8 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white text-muted-foreground shadow-sm ">
        <Search className="h-7 w-7" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-900">
          Ready for product lookup
        </p>
        <p className="text-sm text-muted-foreground">
          Scan a barcode or search products to add items to this sale
        </p>
      </div>
      <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1">
          <ScanBarcode className="h-3.5 w-3.5" />
          Barcode
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1">
          <Search className="h-3.5 w-3.5" />
          Product search
        </span>
      </div>
    </div>
  );
}

export function POSRegisterView() {
  const viewModel = useRegisterViewModel();
  const [isPaymentInputActive, setIsPaymentInputActive] = useState(false);
  useCollapseSidebarForPosFlow();
  const isSessionActive = viewModel.header.isSessionActive;
  const isAuthDialogOpen = Boolean(viewModel.authDialog?.open);
  const shouldUseFullscreenRegisterShell = isSessionActive || isAuthDialogOpen;
  useLockDocumentScroll(shouldUseFullscreenRegisterShell);
  const registerViewWidth = "full";
  const registerContentClassName = cn(
    "w-full px-6 py-5",
    shouldUseFullscreenRegisterShell ? "h-full min-h-0" : "h-auto",
    shouldUseFullscreenRegisterShell && "overflow-hidden",
  );
  const canSearchProducts =
    !viewModel.checkout.isTransactionCompleted && !viewModel.drawerGate;
  const shouldShowHeaderProductSearch = isSessionActive && canSearchProducts;

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
      width={registerViewWidth}
      className={cn(
        shouldUseFullscreenRegisterShell &&
          "h-[calc(100dvh-2.5rem)] max-h-[calc(100dvh-2.5rem)] overflow-hidden",
      )}
      contentClassName={cn(
        shouldUseFullscreenRegisterShell &&
          "flex h-full max-h-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-white",
      )}
      headerClassName={cn(shouldUseFullscreenRegisterShell && "shrink-0")}
      mainClassName={cn(
        shouldUseFullscreenRegisterShell && "min-h-0 flex-1 overflow-hidden",
      )}
      header={
        <ComposedPageHeader
          width={registerViewWidth}
          className="h-auto flex-wrap gap-x-4 gap-y-3 py-4"
          onNavigateBack={viewModel.onNavigateBack}
          leadingContent={
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-8">
              <div className="flex shrink-0 items-center gap-3">
                {isSessionActive && (
                  <FadeIn className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse" />
                  </FadeIn>
                )}
                <p className="text-lg font-semibold text-gray-900">
                  {viewModel.header.title}
                </p>
              </div>

              {shouldShowHeaderProductSearch && (
                <ProductSearchInput
                  disabled={viewModel.productEntry.disabled}
                  productSearchQuery={viewModel.productEntry.productSearchQuery}
                  setProductSearchQuery={
                    viewModel.productEntry.setProductSearchQuery
                  }
                  onBarcodeSubmit={viewModel.productEntry.onBarcodeSubmit}
                  className="max-w-[800px] flex-1"
                  inputClassName="h-14"
                />
              )}
            </div>
          }
          trailingContent={
            canSearchProducts ? (
              <RegisterActionBar
                registerInfo={viewModel.registerInfo}
                sessionPanel={viewModel.sessionPanel}
              />
            ) : undefined
          }
        />
      }
    >
      <FadeIn className={registerContentClassName}>
        {viewModel.drawerGate ? (
          <RegisterDrawerGate drawerGate={viewModel.drawerGate} />
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
            {!viewModel.checkout.isTransactionCompleted && (
              <RegisterCustomerPanel customerPanel={viewModel.customerPanel} />
            )}

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden lg:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
              {!viewModel.checkout.isTransactionCompleted && (
                <div className="flex min-h-0 flex-col overflow-hidden pr-1">
                  {isPaymentInputActive ? (
                    <CartItems
                      cartItems={viewModel.cart.items}
                      onUpdateQuantity={viewModel.cart.onUpdateQuantity}
                      onRemoveItem={viewModel.cart.onRemoveItem}
                      clearCart={viewModel.cart.onClearCart}
                      density="comfortable"
                    />
                  ) : viewModel.productEntry.productSearchQuery ? (
                    <div className="min-h-0 flex-1">
                      <ProductEntry
                        disabled={viewModel.productEntry.disabled}
                        showProductLookup={
                          viewModel.productEntry.showProductLookup
                        }
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
                        showSearchInput={false}
                        containerClassName="h-full min-h-0"
                        lookupPanelClassName="flex h-full min-h-0 flex-col overflow-hidden"
                        resultsClassName="max-h-none min-h-0 flex-1 pr-1"
                      />
                    </div>
                  ) : (
                    <ProductLookupEmptyState />
                  )}
                </div>
              )}

              <div
                className={cn(
                  "flex h-full min-h-0 overflow-hidden",
                  viewModel.checkout.isTransactionCompleted && "lg:col-span-2",
                )}
              >
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                  {!viewModel.checkout.isTransactionCompleted &&
                    !isPaymentInputActive && (
                      <CartItems
                        cartItems={viewModel.cart.items}
                        onUpdateQuantity={viewModel.cart.onUpdateQuantity}
                        onRemoveItem={viewModel.cart.onRemoveItem}
                        clearCart={viewModel.cart.onClearCart}
                        density="compact"
                      />
                    )}

                  <div
                    className={cn(
                      "rounded-lg bg-white p-4",
                      isPaymentInputActive ||
                        viewModel.checkout.isTransactionCompleted
                        ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                        : "shrink-0",
                    )}
                  >
                    <RegisterCheckoutPanel
                      checkout={viewModel.checkout}
                      cashierCard={viewModel.cashierCard}
                      onPaymentFlowChange={setIsPaymentInputActive}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
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
