import { ComposedPageHeader } from "@/components/common/PageHeader";
import { FadeIn } from "@/components/common/FadeIn";
import { CashierAuthDialog } from "@/components/pos/CashierAuthDialog";
import { CartItems } from "@/components/pos/CartItems";
import {
  ProductEntry,
  ProductEntryHandle,
  ProductSearchInput,
} from "@/components/pos/ProductEntry";
import { useSidebar } from "@/components/ui/sidebar";
import View from "@/components/View";
import { cn } from "~/src/lib/utils";
import { ScanBarcode, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type RegisterViewModel,
  type RegisterWorkflowMode,
} from "@/lib/pos/presentation/register/registerUiState";
import { useRegisterViewModel } from "@/lib/pos/presentation/register/useRegisterViewModel";

import { RegisterActionBar } from "./RegisterActionBar";
import { RegisterCheckoutPanel } from "./RegisterCheckoutPanel";
import { RegisterCustomerPanel } from "./RegisterCustomerPanel";
import { RegisterDrawerGate } from "./RegisterDrawerGate";
import { ExpenseCompletionPanel } from "./ExpenseCompletionPanel";

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

interface POSRegisterViewProps {
  workflowMode?: RegisterWorkflowMode;
  viewModel?: RegisterViewModel;
}

export function POSRegisterView({
  workflowMode,
  viewModel: injectedViewModel,
}: POSRegisterViewProps) {
  const registerViewModel = useRegisterViewModel();
  const viewModel = injectedViewModel ?? registerViewModel;
  const effectiveWorkflowMode: RegisterWorkflowMode =
    workflowMode ?? viewModel.workflowMode ?? "pos";
  const isPosWorkflow = effectiveWorkflowMode === "pos";
  const [isPaymentInputActive, setIsPaymentInputActive] = useState(false);
  const productEntryRef = useRef<ProductEntryHandle>(null);
  const headerProductSearchInputRef = useRef<HTMLInputElement>(null);

  useCollapseSidebarForPosFlow();
  const isSessionActive = viewModel.header.isSessionActive;
  const registerViewWidth = "full";
  const registerContentClassName = cn(
    "w-full px-6 py-5",
    "h-full min-h-0",
    "overflow-hidden",
  );
  const hasProductSearchIntent =
    (viewModel.productEntry?.productSearchQuery ?? "").trim().length > 0;
  const isAwaitingCashierAuth = Boolean(viewModel.authDialog?.open);
  const shouldShowPaymentWorkspace =
    isPosWorkflow && isPaymentInputActive && !hasProductSearchIntent;
  const canSearchProducts =
    !viewModel.checkout.isTransactionCompleted &&
    !viewModel.drawerGate &&
    !isAwaitingCashierAuth;
  const isHeaderProductSearchSupported =
    isSessionActive && canSearchProducts && !viewModel.productEntry.disabled;
  const shouldRenderSaleSurface =
    !viewModel.checkout.isTransactionCompleted && !isAwaitingCashierAuth;
  const shouldRenderCheckoutPanel =
    !isAwaitingCashierAuth &&
    (isPosWorkflow || !viewModel.checkout.isTransactionCompleted);

  useEffect(() => {
    if (hasProductSearchIntent && isPaymentInputActive) {
      setIsPaymentInputActive(false);
    }
  }, [hasProductSearchIntent, isPaymentInputActive]);

  useEffect(() => {
    const handleCmdK = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "k"
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;

      if (isTypingTarget) {
        return;
      }

      event.preventDefault();

      if (!isHeaderProductSearchSupported) {
        return;
      }

      const didFocusProductEntryInput =
        productEntryRef.current?.focusProductSearchInput() ?? false;
      if (didFocusProductEntryInput) {
        return;
      }

      if (isHeaderProductSearchSupported) {
        headerProductSearchInputRef.current?.focus();
        headerProductSearchInputRef.current?.select();
      }
    };

    document.addEventListener("keydown", handleCmdK);
    return () => document.removeEventListener("keydown", handleCmdK);
  }, [isHeaderProductSearchSupported]);

  const handlePaymentFlowChange = useCallback((isActive: boolean) => {
    setIsPaymentInputActive(isActive);
  }, []);

  const handlePaymentEntryStart = useCallback(() => {
    if (hasProductSearchIntent) {
      viewModel.productEntry?.setProductSearchQuery?.("");
    }

    setIsPaymentInputActive(true);
  }, [hasProductSearchIntent, viewModel.productEntry]);

  if (!viewModel.hasActiveStore) {
    return (
      <View
        fullHeight
        lockDocumentScroll
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
      fullHeight
      lockDocumentScroll
      contentClassName={cn(
        "flex h-full max-h-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-white",
      )}
      headerClassName="shrink-0"
      mainClassName={cn("min-h-0 flex-1 overflow-hidden")}
      header={
        <ComposedPageHeader
          width={registerViewWidth}
          className="h-auto flex-wrap gap-x-4 gap-y-3 py-4"
          onNavigateBack={viewModel.onNavigateBack}
          leadingContent={
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-8">
              <div className="flex shrink-0 items-center gap-3">
                {isSessionActive ? (
                  <FadeIn className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 bg-green-600 rounded-full animate-pulse`}
                    />
                  </FadeIn>
                ) : (
                  <div
                    className={`w-2 h-2 bg-background rounded-full animate-pulse`}
                  />
                )}

                <p className="text-lg font-semibold text-gray-900">
                  {viewModel.header.title}
                </p>
              </div>

              <ProductSearchInput
                ref={headerProductSearchInputRef}
                disabled={!isHeaderProductSearchSupported}
                productSearchQuery={viewModel.productEntry.productSearchQuery}
                setProductSearchQuery={
                  viewModel.productEntry.setProductSearchQuery
                }
                onBarcodeSubmit={viewModel.productEntry.onBarcodeSubmit}
                className="max-w-[800px] flex-1"
                inputClassName="h-14"
              />
            </div>
          }
          trailingContent={
            canSearchProducts && isPosWorkflow ? (
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
        {isPosWorkflow && viewModel.drawerGate ? (
          <RegisterDrawerGate drawerGate={viewModel.drawerGate} />
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
            {isPosWorkflow && shouldRenderSaleSurface ? (
              <RegisterCustomerPanel
                customerPanel={viewModel.customerPanel}
                disabled={!isSessionActive}
              />
            ) : null}

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden lg:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
              {shouldRenderSaleSurface ? (
                <div className="flex min-h-0 flex-col overflow-hidden pr-1">
                  {shouldShowPaymentWorkspace ? (
                    <CartItems
                      cartItems={viewModel.cart.items}
                      onUpdateQuantity={viewModel.cart.onUpdateQuantity}
                      onRemoveItem={viewModel.cart.onRemoveItem}
                      clearCart={viewModel.cart.onClearCart}
                      density="comfortable"
                    />
                  ) : hasProductSearchIntent ? (
                    <div className="min-h-0 flex-1">
                      <ProductEntry
                        ref={productEntryRef}
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
              ) : null}

              <div
                className={cn(
                  "flex h-full min-h-0 overflow-hidden",
                  shouldRenderSaleSurface ? "lg:col-span-1" : "lg:col-span-2",
                )}
              >
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                  {shouldRenderSaleSurface && !shouldShowPaymentWorkspace ? (
                    <CartItems
                      cartItems={viewModel.cart.items}
                      onUpdateQuantity={viewModel.cart.onUpdateQuantity}
                      onRemoveItem={viewModel.cart.onRemoveItem}
                      clearCart={viewModel.cart.onClearCart}
                      density="compact"
                    />
                  ) : null}

                  {shouldRenderCheckoutPanel ? (
                    <div
                      className={cn(
                        "rounded-lg bg-white p-4",
                        shouldShowPaymentWorkspace ||
                          viewModel.checkout.isTransactionCompleted
                          ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                          : "shrink-0",
                      )}
                    >
                      {isPosWorkflow ? (
                        <RegisterCheckoutPanel
                          checkout={viewModel.checkout}
                          cashierCard={viewModel.cashierCard}
                          onPaymentFlowChange={handlePaymentFlowChange}
                          onPaymentEntryStart={handlePaymentEntryStart}
                        />
                      ) : (
                        <ExpenseCompletionPanel checkout={viewModel.checkout} />
                      )}
                    </div>
                  ) : null}
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
