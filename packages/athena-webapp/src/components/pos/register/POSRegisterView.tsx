import { ComposedPageHeader } from "@/components/common/PageHeader";
import { FadeIn } from "@/components/common/FadeIn";
import { CommandApprovalDialog } from "@/components/operations/CommandApprovalDialog";
import { CashierAuthDialog } from "@/components/pos/CashierAuthDialog";
import { CashierView } from "@/components/pos/CashierView";
import { CartItems } from "@/components/pos/CartItems";
import {
  ProductEntry,
  ProductEntryHandle,
  ProductSearchInput,
} from "@/components/pos/ProductEntry";
import { useSidebar } from "@/components/ui/sidebar";
import View from "@/components/View";
import { cn } from "~/src/lib/utils";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  ScanBarcode,
  Search,
  ShoppingBasket,
  Settings,
  Users,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
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
import { getOrigin } from "~/src/lib/navigationUtils";

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

function ProductLookupEmptyState({
  workflowMode,
}: {
  workflowMode: RegisterWorkflowMode;
}) {
  const isExpenseWorkflow = workflowMode === "expense";

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50/50 to-gray-100/30 p-8 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white text-muted-foreground shadow-sm ">
        <Search className="h-7 w-7" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-900">
          {isExpenseWorkflow
            ? "Ready for expense entry"
            : "Ready for product lookup"}
        </p>
        <p className="text-sm text-muted-foreground">
          {isExpenseWorkflow
            ? "Search or scan products to add expense items"
            : "Scan a barcode or search products to add items to this sale"}
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
          <kbd className="ml-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-gray-500">
            ⌘+K
          </kbd>
        </span>
      </div>
    </div>
  );
}

function CashierAuthWorkspace({
  authDialog,
}: {
  authDialog: NonNullable<RegisterViewModel["authDialog"]>;
}) {
  return (
    <CashierAuthDialog
      open={authDialog.open}
      presentation="inline"
      storeId={authDialog.storeId}
      terminalId={authDialog.terminalId}
      workflowMode={authDialog.workflowMode}
      onAuthenticated={authDialog.onAuthenticated}
      onDismiss={authDialog.onDismiss}
    />
  );
}

function DrawerGateWorkspace({
  drawerGate,
}: {
  drawerGate: NonNullable<RegisterViewModel["drawerGate"]>;
}) {
  return (
    <div className="flex h-full min-h-0 items-start justify-center overflow-y-auto rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50/50 to-gray-100/30 px-6 py-10 sm:px-8 sm:pt-20">
      <div className="w-[min(100%,40rem)]">
        <RegisterDrawerGate drawerGate={drawerGate} />
      </div>
    </div>
  );
}

function RegisterSetupResolvingWorkspace() {
  return (
    <div className="h-full min-h-0 rounded-lg border border-border bg-background" />
  );
}

function CartCountSummary({
  itemCount,
  onExpandCart,
}: {
  itemCount: number;
  onExpandCart: () => void;
}) {
  return (
    <button
      type="button"
      className="shrink-0 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onClick={onExpandCart}
      aria-label="Show cart items"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Items
          </p>
          <p className="text-2xl font-semibold leading-none text-foreground">
            {itemCount}
          </p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ShoppingBasket className="h-4 w-4" />
        </div>
      </div>
    </button>
  );
}

function POSOnboardingWorkspace({
  onboarding,
}: {
  onboarding: RegisterViewModel["onboarding"];
}) {
  const steps = [
    {
      id: "terminal",
      title: "Set up this register",
      description: onboarding.terminalReady
        ? "Register details are ready for this checkout station"
        : "Name this checkout station and assign its register number",
      isComplete: onboarding.terminalReady,
      isCurrent: onboarding.nextStep === "terminal",
      icon: Settings,
      action:
        onboarding.nextStep === "terminal" ? (
          <Link
            params={(params) => ({
              ...params,
              orgUrlSlug: params.orgUrlSlug!,
              storeUrlSlug: params.storeUrlSlug!,
            })}
            to="/$orgUrlSlug/store/$storeUrlSlug/pos/settings"
            search={{ o: getOrigin() }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-action-commit px-4 text-sm font-medium text-action-commit-foreground transition-colors hover:bg-action-commit/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Open register setup
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : null,
    },
    {
      id: "cashierSetup",
      title: "Add cashier access",
      description: onboarding.cashierSetupReady
        ? `${onboarding.cashierCount} cashier ${
            onboarding.cashierCount === 1 ? "profile is" : "profiles are"
          } ready for POS sign-in.`
        : "Add at least one cashier or manager with an active PIN",
      isComplete: onboarding.cashierSetupReady,
      isCurrent: onboarding.nextStep === "cashierSetup",
      icon: Users,
      action:
        onboarding.nextStep === "cashierSetup" ? (
          <Link
            params={(params) => ({
              ...params,
              orgUrlSlug: params.orgUrlSlug!,
              storeUrlSlug: params.storeUrlSlug!,
            })}
            to="/$orgUrlSlug/store/$storeUrlSlug/members"
            search={{ o: getOrigin() }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-action-commit px-4 text-sm font-medium text-action-commit-foreground transition-colors hover:bg-action-commit/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Manage staff
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : null,
    },
  ];

  return (
    <div className="flex h-full min-h-0 overflow-y-auto rounded-lg border border-border bg-background">
      <div className="mx-auto flex w-full flex-col gap-layout-xl px-layout-3xl py-layout-2xl">
        <header className="max-w-3xl space-y-layout-sm">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Onboarding
          </p>
          <h2 className="font-display text-3xl font-light text-foreground">
            Finish setup before your first checkout
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Athena checks the register setup and staff access before products
            can be scanned into a sale.
          </p>
        </header>

        <div className="grid gap-layout-lg lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)]">
          <div className="space-y-layout-md">
            {steps.map((step) => {
              const Icon = step.icon;
              const isWaiting = !step.isComplete && !step.isCurrent;
              return (
                <section
                  key={step.id}
                  className={cn(
                    "rounded-lg border p-layout-md transition-colors",
                    step.isComplete && "border-border bg-surface",
                    step.isCurrent &&
                    "border-action-commit/40 bg-background shadow-sm",
                    isWaiting &&
                    "border-transparent bg-transparent py-layout-sm opacity-55",
                  )}
                >
                  <div className="flex gap-layout-md">
                    <div
                      className={cn(
                        "mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground",
                        step.isComplete &&
                        "border-success/30 bg-success/10 text-success",
                        step.isCurrent &&
                        !step.isComplete &&
                        "border-action-commit/30 bg-action-neutral-soft text-action-commit",
                        isWaiting &&
                        "h-8 w-8 border-border/60 bg-transparent text-muted-foreground",
                      )}
                    >
                      {step.isComplete ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : step.isCurrent ? (
                        <Icon className="h-4 w-4" />
                      ) : (
                        <Circle className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-layout-xs">
                      <div className="flex flex-wrap items-center gap-layout-xs">
                        <h3
                          className={cn(
                            "text-base font-medium text-foreground",
                            isWaiting && "font-normal text-muted-foreground",
                          )}
                        >
                          {step.title}
                        </h3>
                        {!isWaiting ? (
                          <span className="rounded-full border border-border bg-background px-layout-xs py-layout-2xs text-xs text-muted-foreground">
                            {step.isComplete ? "Done" : "Next"}
                          </span>
                        ) : null}
                      </div>
                      <p
                        className={cn(
                          "text-sm leading-6 text-muted-foreground",
                          isWaiting && "text-muted-foreground/80",
                        )}
                      >
                        {step.description}
                      </p>
                      {step.action ? (
                        <div className="pt-layout-xs">{step.action}</div>
                      ) : null}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
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
  const [isPaymentEntryActive, setIsPaymentEntryActive] = useState(false);
  const [isPaymentEditActive, setIsPaymentEditActive] = useState(false);
  const [isPaymentsListExpanded, setIsPaymentsListExpanded] = useState(false);
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
  const cartItemCount =
    viewModel.cart?.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const isAwaitingCashierAuth = Boolean(viewModel.authDialog?.open);
  const onboardingState =
    viewModel.onboarding ??
    ({
      shouldShow: false,
      terminalReady: viewModel.registerInfo?.hasTerminal ?? false,
      cashierSetupReady: true,
      cashierSignedIn: Boolean(viewModel.cashierCard),
      cashierCount: viewModel.cashierCard ? 1 : 0,
      nextStep: "ready",
    } satisfies RegisterViewModel["onboarding"]);
  const shouldShowOnboarding =
    isPosWorkflow &&
    onboardingState.shouldShow &&
    !viewModel.checkout.isTransactionCompleted &&
    !viewModel.drawerGate;
  const isResolvingRegisterSetup =
    isPosWorkflow &&
    !onboardingState.shouldShow &&
    !onboardingState.terminalReady &&
    !viewModel.authDialog &&
    !viewModel.drawerGate &&
    !viewModel.checkout.isTransactionCompleted;
  const canSearchProducts =
    !viewModel.checkout.isTransactionCompleted &&
    !viewModel.drawerGate &&
    !isAwaitingCashierAuth &&
    !shouldShowOnboarding &&
    !isResolvingRegisterSetup;
  const isHeaderProductSearchSupported =
    isSessionActive && canSearchProducts && !viewModel.productEntry.disabled;
  const shouldRenderSaleSurface =
    isPosWorkflow ? !viewModel.checkout.isTransactionCompleted : true;
  const shouldRenderExpenseCompletionPanel = !isPosWorkflow;
  const shouldRenderCheckoutPanel =
    isPosWorkflow || shouldRenderExpenseCompletionPanel;
  const shouldShowPaymentWorkspace =
    isPosWorkflow && isPaymentEntryActive && !hasProductSearchIntent;
  const shouldShowCartSummarySidebar =
    isPosWorkflow &&
    shouldRenderSaleSurface &&
    ((isPaymentEntryActive && hasProductSearchIntent) ||
      isPaymentEditActive ||
      isPaymentsListExpanded) &&
    !shouldShowPaymentWorkspace &&
    !shouldShowOnboarding &&
    !isResolvingRegisterSetup;
  const shouldRenderCartSidebar =
    shouldRenderSaleSurface &&
    !shouldShowPaymentWorkspace &&
    !shouldShowCartSummarySidebar &&
    !shouldShowOnboarding &&
    !isResolvingRegisterSetup;
  const shouldRenderWorkspaceSidebar =
    !shouldShowOnboarding &&
    !isResolvingRegisterSetup &&
    (shouldRenderCartSidebar ||
      shouldRenderCheckoutPanel ||
      isAwaitingCashierAuth);

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
    setIsPaymentEntryActive(isActive);
  }, []);

  const handlePaymentsExpandedChange = useCallback((isExpanded: boolean) => {
    setIsPaymentsListExpanded(isExpanded);
  }, []);

  const handleCartSummaryClick = useCallback(() => {
    setIsPaymentsListExpanded(false);
  }, []);

  const handleEditingPaymentChange = useCallback((isEditing: boolean) => {
    setIsPaymentEditActive(isEditing);
  }, []);

  const handlePaymentEntryStart = useCallback(() => {
    if (hasProductSearchIntent) {
      viewModel.productEntry?.setProductSearchQuery?.("");
    }

    setIsPaymentEntryActive(true);
  }, [hasProductSearchIntent, viewModel.productEntry]);

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
      fullHeight
      lockDocumentScroll
      width={registerViewWidth}
      contentClassName={cn(
        "flex h-full max-h-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-white",
      )}
      headerClassName="shrink-0"
      mainClassName={cn("min-h-0 flex-1")}
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

              {!shouldShowOnboarding && !isResolvingRegisterSetup ? (
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
              ) : null}
            </div>
          }
          trailingContent={
            canSearchProducts && isPosWorkflow ? (
              <RegisterActionBar
                closeoutControl={viewModel.closeoutControl}
                registerInfo={viewModel.registerInfo}
                sessionPanel={viewModel.sessionPanel}
              />
            ) : undefined
          }
        />
      }
    >
      <FadeIn className={registerContentClassName}>
        <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
          {isPosWorkflow &&
          shouldRenderSaleSurface &&
          !shouldShowOnboarding &&
          !isResolvingRegisterSetup ? (
            <RegisterCustomerPanel
              customerPanel={viewModel.customerPanel}
              disabled={!isSessionActive}
            />
          ) : null}

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden lg:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
            {shouldRenderSaleSurface ? (
              <div
                className={cn(
                  "flex min-h-0 flex-col overflow-hidden pr-1",
                  !shouldRenderWorkspaceSidebar && "lg:col-span-2",
                )}
              >
                {shouldShowOnboarding ? (
                  <POSOnboardingWorkspace onboarding={onboardingState} />
                ) : isResolvingRegisterSetup ? (
                  <RegisterSetupResolvingWorkspace />
                ) : isPosWorkflow && viewModel.drawerGate ? (
                  <DrawerGateWorkspace drawerGate={viewModel.drawerGate} />
                ) : isAwaitingCashierAuth && viewModel.authDialog ? (
                  <CashierAuthWorkspace authDialog={viewModel.authDialog} />
                ) : shouldShowPaymentWorkspace ? (
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
                      showProductLookup={viewModel.productEntry.showProductLookup}
                      setShowProductLookup={
                        viewModel.productEntry.setShowProductLookup
                      }
                      productSearchQuery={viewModel.productEntry.productSearchQuery}
                      setProductSearchQuery={
                        viewModel.productEntry.setProductSearchQuery
                      }
                      onBarcodeSubmit={viewModel.productEntry.onBarcodeSubmit}
                      onAddProduct={viewModel.productEntry.onAddProduct}
                      searchResults={viewModel.productEntry.searchResults}
                      isSearchLoading={viewModel.productEntry.isSearchLoading}
                      isSearchReady={viewModel.productEntry.isSearchReady}
                      showSearchInput={false}
                      containerClassName="h-full min-h-0"
                      lookupPanelClassName="flex h-full min-h-0 flex-col overflow-hidden"
                      resultsClassName="max-h-none min-h-0 flex-1 pr-1"
                    />
                  </div>
                ) : (
                  <ProductLookupEmptyState
                    workflowMode={effectiveWorkflowMode}
                  />
                )}
              </div>
            ) : null}

            {shouldRenderWorkspaceSidebar ? (
              <div
                className={cn(
                  "flex h-full min-h-0 overflow-hidden",
                  shouldRenderSaleSurface ? "lg:col-span-1" : "lg:col-span-2",
                )}
              >
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                  {shouldRenderCartSidebar ? (
                    <CartItems
                      cartItems={viewModel.cart.items}
                      onUpdateQuantity={viewModel.cart.onUpdateQuantity}
                      onRemoveItem={viewModel.cart.onRemoveItem}
                      clearCart={viewModel.cart.onClearCart}
                      density="compact"
                    />
                  ) : null}

                  {shouldShowCartSummarySidebar ? (
                    <CartCountSummary
                      itemCount={cartItemCount}
                      onExpandCart={handleCartSummaryClick}
                    />
                  ) : null}

                  {shouldRenderCheckoutPanel ? (
                    <div
                      className={cn(
                        "rounded-lg bg-white p-4",
                        shouldShowPaymentWorkspace ||
                          shouldShowCartSummarySidebar ||
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
                          onEditingPaymentChange={handleEditingPaymentChange}
                          hidePaymentItemCountSummary={
                            shouldShowCartSummarySidebar
                          }
                          paymentsExpanded={isPaymentsListExpanded}
                          onPaymentsExpandedChange={
                            handlePaymentsExpandedChange
                          }
                        />
                      ) : (
                        <ExpenseCompletionPanel checkout={viewModel.checkout} />
                      )}
                    </div>
                  ) : null}

                  {!isPosWorkflow ? (
                    <div className="shrink-0">
                      <CashierView
                        cashierName={
                          viewModel.cashierCard?.cashierName ?? "Unassigned"
                        }
                        isSignInRequired={
                          isAwaitingCashierAuth || !viewModel.cashierCard
                        }
                        onSignOut={viewModel.cashierCard?.onSignOut}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </FadeIn>

      {viewModel.authDialog && !isAwaitingCashierAuth && (
        <CashierAuthDialog
          open={viewModel.authDialog.open}
          storeId={viewModel.authDialog.storeId}
          terminalId={viewModel.authDialog.terminalId}
          workflowMode={viewModel.authDialog.workflowMode}
          onAuthenticated={viewModel.authDialog.onAuthenticated}
          onDismiss={viewModel.authDialog.onDismiss}
        />
      )}

      {viewModel.commandApprovalDialog ? (
        <CommandApprovalDialog
          approval={viewModel.commandApprovalDialog.approval}
          onApproved={viewModel.commandApprovalDialog.onApproved}
          onAuthenticateForApproval={
            viewModel.commandApprovalDialog.onAuthenticateForApproval
          }
          onDismiss={viewModel.commandApprovalDialog.onDismiss}
          open={viewModel.commandApprovalDialog.open}
          requestedByStaffProfileId={
            viewModel.commandApprovalDialog.requestedByStaffProfileId
          }
          storeId={viewModel.commandApprovalDialog.storeId}
        />
      ) : null}
    </View>
  );
}
