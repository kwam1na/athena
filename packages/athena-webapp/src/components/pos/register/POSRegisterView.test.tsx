import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseRegisterViewModel = vi.fn();
const mockOpenQuickAddProduct = vi.fn(() => true);
const mockUseAppActionBlocker = vi.fn();

function pressDebugPanelShortcut(
  modifiers: { metaKey?: boolean; ctrlKey?: boolean } = { metaKey: true },
) {
  fireEvent.keyDown(document, {
    code: "Slash",
    key: "/",
    ...modifiers,
  });
  fireEvent.keyUp(document, {
    code: "Slash",
    key: "/",
    ...modifiers,
  });
}

vi.mock("@/lib/pos/presentation/register/useRegisterViewModel", () => ({
  useRegisterViewModel: () => mockUseRegisterViewModel(),
}));

vi.mock("@/lib/app-messages", () => ({
  useAppActionBlocker: (args: unknown) => mockUseAppActionBlocker(args),
}));

vi.mock("@/lib/app-update", () => ({
  APP_UPDATE_APPLY_ACTION_ID: "app-update.apply",
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="sidebar-provider">{children}</div>
  ),
  useSidebar: () => ({
    isMobile: false,
    open: true,
    setOpen: vi.fn(),
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
  }: {
    children: ReactNode;
    params?:
      | ((params: Record<string, string>) => Record<string, string>)
      | Record<string, string>;
    search?: Record<string, string>;
    to: string;
  }) => {
    const resolvedParams =
      typeof params === "function"
        ? params({
            orgUrlSlug: "$orgUrlSlug",
            sessionId: "$sessionId",
            storeUrlSlug: "$storeUrlSlug",
            terminalId: "$terminalId",
          })
        : params;
    const href = to
      .replace("$sessionId", resolvedParams?.sessionId ?? "$sessionId")
      .replace("$terminalId", resolvedParams?.terminalId ?? "$terminalId");
    const query = search ? `?${new URLSearchParams(search)}` : "";

    return <a href={`${href}${query}`}>{children}</a>;
  },
}));

vi.mock("@/components/View", () => ({
  default: ({
    header,
    children,
  }: {
    header: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <div data-testid="view-header">{header}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock("@/components/common/FadeIn", () => ({
  FadeIn: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

vi.mock("@/components/common/PageHeader", () => ({
  ComposedPageHeader: ({
    leadingContent,
    trailingContent,
  }: {
    leadingContent: ReactNode;
    trailingContent?: ReactNode;
  }) => (
    <header>
      <div>{leadingContent}</div>
      <div>{trailingContent}</div>
    </header>
  ),
}));

vi.mock("@/components/pos/ProductEntry", async () => {
  const React = await import("react");

  return {
    ProductEntry: React.forwardRef(
      (
        {
          canSearchProducts,
          canSearchServices,
          onAddProduct,
          serviceEntry,
        }: {
          canSearchProducts?: boolean;
          canSearchServices?: boolean;
          onAddProduct?: (
            product: {
              id: string;
              name: string;
              price: number;
              productId: string;
              skuId: string;
            },
            quantity?: number,
          ) => boolean | Promise<boolean>;
          serviceEntry?: {
            onAddService?: (
              service: {
                id: string;
                name: string;
                serviceMode: "repair";
                pricingModel: "fixed";
              },
              amount?: number,
            ) => boolean | Promise<boolean>;
          };
        },
        ref,
      ) => {
        React.useImperativeHandle(ref, () => ({
          focusProductSearchInput: () => true,
          openQuickAddProduct: mockOpenQuickAddProduct,
        }));

        return (
          <div>
            product-entry
            {onAddProduct && canSearchProducts !== false ? (
              <button
                type="button"
                onClick={() =>
                  void onAddProduct({
                    id: "product-1",
                    name: "Nuggs",
                    price: 5500,
                    productId: "product-1",
                    skuId: "sku-1",
                  })
                }
              >
                mock-add-product
              </button>
            ) : null}
            {serviceEntry?.onAddService && canSearchServices !== false ? (
              <button
                type="button"
                onClick={() =>
                  void serviceEntry.onAddService?.({
                    id: "service-1",
                    name: "Repair",
                    serviceMode: "repair",
                    pricingModel: "fixed",
                  })
                }
              >
                mock-add-service
              </button>
            ) : null}
          </div>
        );
      },
    ),
    ProductSearchInput: React.forwardRef<
      HTMLInputElement,
      {
        disabled?: boolean;
        lookupKind?: string;
        onActivate?: () => void;
        readOnly?: boolean;
      }
    >(
      (
        { disabled, lookupKind = "products_services", onActivate, readOnly },
        ref,
      ) => (
        <div>
          <input
            ref={ref}
            aria-label="product search input"
            disabled={disabled}
            readOnly={readOnly}
            onPointerDown={onActivate}
          />
          <span>product-search-input</span>
          <span>{`lookup-kind-${lookupKind}`}</span>
        </div>
      ),
    ),
  };
});

vi.mock("@/components/pos/CartItems", () => ({
  CartItems: ({
    cartItems = [],
    density,
    readOnly = false,
    serviceItems = [],
  }: {
    cartItems?: Array<{ name?: string; quantity: number }>;
    density?: string;
    readOnly?: boolean;
    serviceItems?: Array<{ quantity: number }>;
  }) => (
    <div data-testid={`cart-items-${density ?? "default"}`}>
      <span>cart-items</span>
      <span>
        {`cart-items-count-${
          cartItems.reduce((sum, item) => sum + item.quantity, 0) +
          serviceItems.reduce((sum, item) => sum + item.quantity, 0)
        }`}
      </span>
      <span>{`cart-items-readonly-${readOnly ? "yes" : "no"}`}</span>
      <span>{`cart-items-density-${density ?? "comfortable"}`}</span>
      {cartItems.map((item) =>
        item.name ? <span key={item.name}>{item.name}</span> : null,
      )}
    </div>
  ),
}));

vi.mock("@/components/pos/CashierAuthDialog", () => ({
  CashierAuthDialog: ({ open }: { open: boolean }) =>
    open ? <div>cashier-auth-dialog</div> : null,
}));

vi.mock("./RegisterActionBar", () => ({
  RegisterActionBar: ({
    cashierCard,
    closeoutControl,
    drawerGate,
  }: {
    cashierCard?: {
      cashierName?: string;
      onSignOut?: () => void;
    } | null;
    closeoutControl?: {
      canCloseout: boolean;
      canShowOpeningFloatCorrection: boolean;
      canCorrectOpeningFloat: boolean;
      onRequestCloseout: () => void;
      onRequestOpeningFloatCorrection: () => void;
    } | null;
    drawerGate?: {
      mode?: string;
      onSubmit?: () => void;
    } | null;
  }) => (
    <div>
      register-action-bar
      <div>
        Cashier {cashierCard?.cashierName ?? "Unassigned"}
        {cashierCard ? (
          <button onClick={cashierCard.onSignOut}>Sign out</button>
        ) : null}
      </div>
      {closeoutControl ? (
        <>
          {closeoutControl.canShowOpeningFloatCorrection ? (
            <button
              disabled={!closeoutControl.canCorrectOpeningFloat}
              onClick={closeoutControl.onRequestOpeningFloatCorrection}
            >
              float-control
            </button>
          ) : null}
          <button
            disabled={!closeoutControl.canCloseout}
            onClick={closeoutControl.onRequestCloseout}
          >
            closeout-control
          </button>
        </>
      ) : null}
      {drawerGate?.mode === "recovery" ? (
        <button onClick={drawerGate.onSubmit}>drawer-recovery-action</button>
      ) : null}
    </div>
  ),
}));

vi.mock("./RegisterCustomerPanel", () => ({
  RegisterCustomerPanel: () => <div>register-customer-panel</div>,
}));

vi.mock("./RegisterCheckoutPanel", () => ({
  RegisterCheckoutPanel: ({
    checkout,
    onPaymentFlowChange,
    onPaymentEntryStart,
    onEditingPaymentChange,
    hideActiveSummaryCards,
    onPaymentsExpandedChange,
  }: {
    checkout: {
      cartItems?: Array<{ quantity: number }>;
      serviceLines?: Array<{ quantity?: number }>;
      total?: number;
    };
    onPaymentFlowChange: (active: boolean) => void;
    onPaymentEntryStart: () => void;
    onEditingPaymentChange?: (editing: boolean) => void;
    hideActiveSummaryCards?: boolean;
    onPaymentsExpandedChange?: (expanded: boolean) => void;
  }) => (
    <div>
      <button onClick={() => onPaymentFlowChange(false)}>
        show-payment-methods
      </button>
      <button onClick={() => onPaymentFlowChange(true)}>
        activate-payment-entry
      </button>
      <button onClick={onPaymentEntryStart}>start-payment-entry</button>
      <button onClick={() => onEditingPaymentChange?.(true)}>
        start-payment-edit
      </button>
      <button onClick={() => onPaymentsExpandedChange?.(true)}>
        expand-payments
      </button>
      {hideActiveSummaryCards ? <div>hide-active-summary-cards</div> : null}
      <div>
        {`checkout-items-count-${
          checkout.cartItems?.reduce((sum, item) => sum + item.quantity, 0) ?? 0
        }`}
      </div>
      <div>{`checkout-total-${checkout.total ?? 0}`}</div>
      <div>register-checkout-panel</div>
    </div>
  ),
}));

vi.mock("./ExpenseCompletionPanel", () => ({
  ExpenseCompletionPanel: () => <div>expense-completion-panel</div>,
}));

describe("POSRegisterView", () => {
  beforeEach(() => {
    mockUseRegisterViewModel.mockReset();
    mockUseAppActionBlocker.mockClear();
  });

  it("renders a lightweight empty state while the active store is unresolved", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: false,
      header: {
        title: "POS",
        isSessionActive: false,
      },
      checkout: {
        isTransactionCompleted: false,
      },
      drawerGate: null,
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("POS")).toBeInTheDocument();
    expect(
      screen.queryByText("register-checkout-panel"),
    ).not.toBeInTheDocument();
  });

  it("registers the POS update apply blocker from the view model", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      updateApplyBlocker: {
        active: true,
        label: "Sale in progress",
        priority: "critical-workflow",
        guidance:
          "Finish, hold, or clear this sale before applying the update.",
      },
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {},
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: null,
      closeoutControl: null,
      drawerGate: null,
      syncStatus: null,
      authDialog: null,
      commandApprovalDialog: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(mockUseAppActionBlocker).toHaveBeenCalledWith({
      actionId: "app-update.apply",
      active: true,
      blockerId: "pos-register",
      label: "Sale in progress",
      priority: "critical-workflow",
      guidance: "Finish, hold, or clear this sale before applying the update.",
    });
  });

  it("renders the thin register shell around the view model state", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {},
      cart: {
        items: [
          {
            id: "line-1",
            name: "Nuggs",
            price: 5500,
            quantity: 1,
          },
        ],
      },
      checkout: {
        isTransactionCompleted: false,
        payments: [{ method: "mobile_money", amount: 24000, timestamp: 1 }],
        total: 24000,
      },
      sessionPanel: {},
      cashierCard: {
        cashierName: "Ato K.",
        onSignOut: vi.fn(),
      },
      closeoutControl: {
        canCloseout: true,
        canShowOpeningFloatCorrection: true,
        canCorrectOpeningFloat: true,
        onRequestCloseout: vi.fn(),
        onRequestOpeningFloatCorrection: vi.fn(),
      },
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("register-action-bar")).toBeInTheDocument();
    expect(screen.getByText("Cashier Ato K.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("closeout-control")).toBeInTheDocument();
    expect(screen.getByText("register-customer-panel")).toBeInTheDocument();
    expect(screen.getByText("product-search-input")).toBeInTheDocument();
    expect(screen.getByText("Ready for checkout lookup")).toBeInTheDocument();
    expect(screen.getAllByText("⌘+K").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("region", { name: "Sale summary" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Sale summary" }).parentElement,
    ).toHaveClass("lg:grid-cols-[minmax(0,0.86fr)_minmax(28rem,0.68fr)]");
    expect(screen.getByText("Balance due")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("GH₵240")).toBeInTheDocument();
    expect(screen.getByText("GH₵0")).toBeInTheDocument();
    expect(screen.getByText("cart-items")).toBeInTheDocument();
    expect(screen.getByText("register-checkout-panel")).toBeInTheDocument();
    expect(screen.getByText("hide-active-summary-cards")).toBeInTheDocument();
    expect(
      screen.getByTestId("register-main-workspace").closest(".box-border"),
    ).toBeInTheDocument();
    expect(screen.queryByText("cashier-auth-dialog")).not.toBeInTheDocument();
  });

  it("surfaces service-only lookup without product actions", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        canSearchProducts: false,
        canSearchServices: true,
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
        onAddProduct: vi.fn(async () => true),
        searchResults: [],
        isSearchLoading: false,
        isSearchReady: true,
        canQuickAddProduct: true,
      },
      serviceEntry: {
        disabled: false,
        serviceSearchQuery: "",
        setServiceSearchQuery: vi.fn(),
        searchResults: [],
        isSearchLoading: false,
        isSearchReady: true,
        items: [],
        onAddService: vi.fn(async () => true),
        onUpdateServiceAmount: vi.fn(),
        onRemoveService: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {
        cashierName: "Ato K.",
        onSignOut: vi.fn(),
      },
      closeoutControl: null,
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("lookup-kind-services")).toBeInTheDocument();
    expect(screen.getByText("Ready for service lookup")).toBeInTheDocument();
    expect(screen.getByText("Service search")).toBeInTheDocument();
    expect(screen.queryByText("Barcode")).not.toBeInTheDocument();
    expect(screen.queryByText("Product search")).not.toBeInTheDocument();
    expect(screen.queryByText("Quick add product")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "mock-add-product" }),
    ).not.toBeInTheDocument();
  });

  it("surfaces product-only lookup without service actions", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        canSearchProducts: true,
        canSearchServices: false,
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
        onAddProduct: vi.fn(async () => true),
        searchResults: [],
        isSearchLoading: false,
        isSearchReady: true,
        canQuickAddProduct: true,
      },
      serviceEntry: {
        disabled: false,
        serviceSearchQuery: "",
        setServiceSearchQuery: vi.fn(),
        searchResults: [],
        isSearchLoading: false,
        isSearchReady: true,
        items: [],
        onAddService: vi.fn(async () => true),
        onUpdateServiceAmount: vi.fn(),
        onRemoveService: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {
        cashierName: "Ato K.",
        onSignOut: vi.fn(),
      },
      closeoutControl: null,
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("lookup-kind-products")).toBeInTheDocument();
    expect(screen.getByText("Ready for product lookup")).toBeInTheDocument();
    expect(screen.getByText("Barcode")).toBeInTheDocument();
    expect(screen.getByText("Product search")).toBeInTheDocument();
    expect(screen.queryByText("Service search")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "mock-add-service" }),
    ).not.toBeInTheDocument();
  });

  it("returns focus to the header product search after adding a service", async () => {
    const onAddService = vi.fn(async () => true);
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "repair",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
        onAddProduct: vi.fn(async () => true),
        searchResults: [],
        isSearchLoading: false,
        isSearchReady: true,
        canQuickAddProduct: false,
      },
      serviceEntry: {
        disabled: false,
        serviceSearchQuery: "repair",
        setServiceSearchQuery: vi.fn(),
        searchResults: [],
        isSearchLoading: false,
        isSearchReady: true,
        items: [],
        onAddService,
        onUpdateServiceAmount: vi.fn(),
        onRemoveService: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {
        cashierName: "Ato K.",
        onSignOut: vi.fn(),
      },
      closeoutControl: null,
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    const searchInput = screen.getByLabelText("product search input");
    searchInput.blur();
    expect(searchInput).not.toHaveFocus();

    await userEvent.click(
      screen.getByRole("button", { name: "mock-add-service" }),
    );

    await waitFor(() => expect(searchInput).toHaveFocus());
    expect(onAddService).toHaveBeenCalledWith(
      expect.objectContaining({ id: "service-1" }),
      undefined,
    );
  });

  it("renders local-only register context with debug state instead of the blank shell", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      debug: {
        activeStoreSource: "local",
        authDialogOpen: true,
        hasLiveActiveStore: false,
        localStaffAuthorityStatus: "ready",
        localEntryStatus: "ready",
        online: false,
        staffSignedIn: false,
        storeId: "store-1",
        syncFlow: {
          eventAppendToken: 0,
          pendingEventCount: 1,
          source: "runtime",
          staffProof: "missing",
          status: "pending_sync",
        },
        terminalId: "terminal-1",
        terminalSource: "local",
      },
      header: {
        title: "POS",
        isSessionActive: false,
      },
      registerInfo: {
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: true,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: null,
      cashierCard: null,
      closeoutControl: null,
      authDialog: {
        open: true,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByLabelText("No staff signed in")).toBeInTheDocument();
    expect(
      screen.queryByText("Support sync diagnostics"),
    ).not.toBeInTheDocument();
    pressDebugPanelShortcut({ ctrlKey: true });

    expect(screen.getByText("Support sync diagnostics")).toBeInTheDocument();
    expect(screen.getAllByText("Offline")).not.toHaveLength(0);
    expect(screen.getAllByText("Local")).not.toHaveLength(0);
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("shows the debug strip while the register has an active connection", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      debug: {
        activeStoreSource: "live",
        authDialogOpen: false,
        hasLiveActiveStore: true,
        localStaffAuthorityStatus: "ready",
        localEntryStatus: "ready",
        online: true,
        staffSignedIn: true,
        storeId: "store-1",
        syncFlow: {
          checkInPublishAttemptedAt: Date.UTC(2026, 4, 15, 12, 35, 0),
          checkInPublishCompletedAt: Date.UTC(2026, 4, 15, 12, 35, 1),
          checkInPublishMessage:
            "You do not have access to update this POS terminal status.",
          checkInPublishReason: "authorization_failed",
          checkInPublishStatus: "rejected",
          eventAppendToken: 2,
          failureCount: 0,
          lastFailure: null,
          lastLocalSequence: 4,
          localOnlyEventCount: 29,
          lastRuntimeTrigger: "manual-retry",
          lastRuntimeTriggerAt: Date.UTC(2026, 4, 15, 12, 34, 56),
          lastRuntimeTriggerPriority: "high",
          lastSyncedSequence: 4,
          mode: "status-only",
          nextPendingSequence: null,
          oldestPendingEventAt: Date.UTC(2026, 4, 15, 12, 0, 0),
          oldestPendingEventSequence: 3,
          oldestPendingUploadSequence: 2,
          nextPendingUploadSequence: 2,
          pendingEventCount: 0,
          pendingUploadEventCount: 5,
          reviewEventCount: 33,
          schedulerBackoffUntil: null,
          schedulerRunning: false,
          schedulerScheduled: false,
          source: "none",
          staffProof: "present",
          status: "needs_review",
        },
        terminalId: "terminal-1",
        terminalSource: "live",
      },
      header: {
        title: "POS",
        isSessionActive: false,
      },
      registerInfo: {
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: true,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: null,
      cashierCard: null,
      closeoutControl: null,
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByLabelText("Staff signed in")).toBeInTheDocument();
    expect(
      screen.queryByText("Support sync diagnostics"),
    ).not.toBeInTheDocument();
    pressDebugPanelShortcut();

    expect(screen.getByText("Support sync diagnostics")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getAllByText("Live")).not.toHaveLength(0);
    expect(screen.getAllByText("Local review")).not.toHaveLength(0);
    expect(screen.getByText("Local review item")).toBeInTheDocument();
    expect(screen.getByText("Manual retry")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("2026-05-15T12:34:56Z")).toBeInTheDocument();
    expect(screen.getByText("local 4 synced 4 next n/a")).toBeInTheDocument();
    expect(screen.getByText("eligible uploads")).toBeInTheDocument();
    expect(screen.getByText("local review items")).toBeInTheDocument();
    expect(screen.getByText("sync hold-up")).toBeInTheDocument();
    expect(
      screen.getByText(
        "5 uploaded review events are waiting on server review; 29 local-only review records need support inspection.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("next sync step")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Open terminal health or cash controls to resolve the server review. Retry only checks whether that review has settled.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open terminal health/i }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/pos/terminals/terminal-1"),
    );
    expect(screen.getByText("runtime mode")).toBeInTheDocument();
    expect(screen.getByText("Status only")).toBeInTheDocument();
    expect(screen.getByText("check-in publish")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText("check-in reason")).toBeInTheDocument();
    expect(screen.getByText("Authorization Failed")).toBeInTheDocument();
    expect(screen.getByText("check-in attempted")).toBeInTheDocument();
    expect(screen.getByText("2026-05-15T12:35:00Z")).toBeInTheDocument();
    expect(screen.getByText("check-in completed")).toBeInTheDocument();
    expect(screen.getByText("2026-05-15T12:35:01Z")).toBeInTheDocument();
    expect(screen.getByText("check-in note")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You do not have access to update this POS terminal status.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("local-only events")).toBeInTheDocument();
    expect(screen.getByText("oldest pending")).toBeInTheDocument();
    expect(screen.getByText("2026-05-15T12:00:00Z")).toBeInTheDocument();
    expect(screen.getByText("local 3 upload 2")).toBeInTheDocument();
    expect(screen.getByText("oldest 2 next 2")).toBeInTheDocument();
    expect(screen.getByText("scheduler")).toBeInTheDocument();
    expect(screen.getByText("last failure")).toBeInTheDocument();
    expect(screen.getByText("none")).toBeInTheDocument();

    pressDebugPanelShortcut();
    expect(
      screen.queryByText("Support sync diagnostics"),
    ).not.toBeInTheDocument();
  });

  it("shows the same debug strip in the expense workflow with the established shortcut", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: false,
      },
      registerInfo: {
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: true,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: null,
      cashierCard: null,
      closeoutControl: null,
      authDialog: null,
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(
      <POSRegisterView
        workflowMode="expense"
        viewModel={{
          workflowMode: "expense",
          hasActiveStore: true,
          debug: {
            activeStoreSource: "live",
            authDialogOpen: false,
            cashierPresence: "missing",
            hasLiveActiveStore: true,
            localStaffAuthorityStatus: "ready",
            localEntryStatus: "ready",
            online: true,
            staffSignedIn: true,
            storeId: "store-1",
            syncFlow: {
              eventAppendToken: 4,
              lastRuntimeTrigger: "event-appended",
              lastRuntimeTriggerPriority: "high",
              mode: "status-only",
              pendingEventCount: 2,
              pendingUploadEventCount: 2,
              source: "runtime",
              staffProof: "present",
              status: "pending_sync",
            },
            terminalId: "terminal-1",
            terminalSource: "live",
          },
          header: {
            title: "Expense Products",
            isSessionActive: false,
          },
          registerInfo: {
            registerLabel: "Expense Register",
            hasTerminal: true,
          },
          onboarding: {
            shouldShow: false,
            terminalReady: true,
            cashierSetupReady: true,
            cashierSignedIn: true,
            cashierCount: 1,
            nextStep: "ready",
          },
          customerPanel: {
            isOpen: false,
            onOpenChange: vi.fn(),
            customerInfo: { name: "", email: "", phone: "" },
            onCustomerCommitted: vi.fn(),
            setCustomerInfo: vi.fn(),
          },
          productEntry: {
            disabled: false,
            showProductLookup: true,
            setShowProductLookup: vi.fn(),
            productSearchQuery: "",
            setProductSearchQuery: vi.fn(),
            onBarcodeSubmit: vi.fn(),
            onAddProduct: vi.fn(),
            searchResults: [],
            isSearchLoading: false,
            isSearchReady: true,
            canQuickAddProduct: false,
          },
          cart: {
            items: [],
            onUpdateQuantity: vi.fn(),
            onRemoveItem: vi.fn(),
            onClearCart: vi.fn(),
          },
          checkout: {
            cartItems: [],
            registerNumber: "Expense Register",
            subtotal: 0,
            tax: 0,
            total: 0,
            payments: [],
            hasTerminal: true,
            isTransactionCompleted: false,
            completedOrderNumber: null,
            onAddPayment: vi.fn(),
            onUpdatePayment: vi.fn(),
            onRemovePayment: vi.fn(),
            onClearPayments: vi.fn(),
            onCompleteTransaction: vi.fn(),
            onStartNewTransaction: vi.fn(),
          },
          sessionPanel: null,
          cashierCard: {
            cashierName: "Jogo D.",
            onSignOut: vi.fn(),
          },
          cashierPresenceRestore: { status: "missing" },
          closeoutControl: null,
          updateApplyBlocker: {
            active: false,
            label: "Register ready",
            priority: "critical-workflow",
            guidance: "Apply the update when you are ready.",
          },
          authDialog: null,
          drawerGate: null,
          commandApprovalDialog: null,
          onNavigateBack: vi.fn(),
        }}
      />,
    );

    expect(
      screen.queryByText("Support sync diagnostics"),
    ).not.toBeInTheDocument();
    pressDebugPanelShortcut();

    expect(screen.getByText("Support sync diagnostics")).toBeInTheDocument();
    expect(screen.getByText("Expense Products")).toBeInTheDocument();
    expect(screen.getByText("activity signal")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("New register activity")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("shows POS sync status and schedules manual retry from the header", async () => {
    const onRetrySync = vi.fn();
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      closeoutControl: null,
      authDialog: {
        open: false,
      },
      drawerGate: null,
      syncStatus: {
        description:
          "Register activity is saved locally and will sync when ready.",
        label: "Pending sync",
        pendingEventCount: 2,
        reconciliationItems: [],
        status: "pending_sync",
        tone: "warning",
        onRetrySync,
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    const retrySyncButton = screen.getByRole("button", {
      name: /retry pos sync: pending sync/i,
    });

    expect(retrySyncButton).toHaveTextContent("pending sync");
    expect(retrySyncButton).not.toHaveTextContent("2");

    await userEvent.click(retrySyncButton);

    expect(onRetrySync).toHaveBeenCalled();
  });

  it("shows restrained copy while restored cashier access is validating", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: false,
      },
      registerInfo: {
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: true,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: null,
      cashierCard: null,
      cashierPresenceRestore: {
        status: "validation_pending",
        message: "Checking cashier access before new sales.",
      },
      closeoutControl: null,
      authDialog: {
        open: true,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(
      screen.queryByText("Checking cashier access before new sales."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("cashier-auth-dialog")).toBeInTheDocument();
    expect(screen.queryByText(/Cashier Ama K\./)).not.toBeInTheDocument();
  });

  it("shows cashier presence in support diagnostics without proof material", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      cashierPresenceRestore: {
        status: "restored",
      },
      closeoutControl: null,
      authDialog: {
        open: false,
      },
      drawerGate: null,
      debug: {
        activeStoreSource: "live",
        authDialogOpen: false,
        cashierPresence: "restored",
        hasLiveActiveStore: true,
        localStaffAuthorityStatus: "ready",
        localEntryStatus: "ready",
        online: true,
        staffSignedIn: true,
        syncFlow: {
          eventAppendToken: 1,
          source: "none",
          staffProof: "present",
          status: "synced",
        },
        terminalSource: "live",
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    await userEvent.keyboard("{Meta>}/{/Meta}");

    expect(screen.getByText("cashier presence")).toBeInTheDocument();
    expect(screen.getByText("Restored")).toBeInTheDocument();
    expect(
      screen.queryByText(/proof-token|pin|sync-secret/i),
    ).not.toBeInTheDocument();
  });

  it("shows app-session-unverified local continuation only in support diagnostics", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {
        cashierName: "Ama Serwa",
        onSignOut: vi.fn(),
      },
      closeoutControl: null,
      authDialog: {
        open: false,
      },
      drawerGate: null,
      debug: {
        activeStoreSource: "local",
        appSessionRecovery: "waiting_for_network",
        authDialogOpen: false,
        cashierPresence: "restored",
        hasLiveActiveStore: false,
        localStaffAuthorityStatus: "ready",
        localEntryStatus: "ready",
        online: false,
        staffSignedIn: true,
        syncFlow: {
          eventAppendToken: 3,
          localOnlyEventCount: 2,
          pendingEventCount: 2,
          pendingUploadEventCount: 0,
          source: "runtime",
          staffProof: "present",
          status: "pending_sync",
        },
        terminalId: "terminal-1",
        terminalSource: "local",
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("register-checkout-panel")).toBeInTheDocument();
    expect(screen.getByText("Ready for checkout lookup")).toBeInTheDocument();
    expect(
      screen.queryByText("App session unverified"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/reconciliation/i)).not.toBeInTheDocument();

    pressDebugPanelShortcut();

    expect(screen.getByText("app session")).toBeInTheDocument();
    expect(screen.getByText("Local sale continuation")).toBeInTheDocument();
    expect(screen.getByText("reconciliation posture")).toBeInTheDocument();
    expect(
      screen.getByText(
        "App session unverified; local sales stay on this register until cloud validation returns.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/assertion|token|secret|password|otp/i),
    ).not.toBeInTheDocument();
  });

  it("shows an operable register as ready when manager review exists elsewhere", async () => {
    const onRetrySync = vi.fn();
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      closeoutControl: null,
      authDialog: {
        open: false,
      },
      drawerGate: null,
      syncStatus: {
        description: "Synced register activity needs manager review.",
        label: "Needs review",
        pendingEventCount: 1,
        reconciliationItems: [],
        status: "needs_review",
        tone: "danger",
        onRetrySync,
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /check pos sync review: needs review/i,
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("needs review")).not.toBeInTheDocument();
    expect(onRetrySync).not.toHaveBeenCalled();
  });

  it("hides manager review sync from the header when another cashier step owns the flow", async () => {
    const onRetrySync = vi.fn();
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: true,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      closeoutControl: null,
      authDialog: {
        open: true,
      },
      drawerGate: null,
      syncStatus: {
        description: "Synced register activity needs manager review.",
        label: "Needs review",
        pendingEventCount: 1,
        reconciliationItems: [],
        status: "needs_review",
        tone: "danger",
        onRetrySync,
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(
      screen.queryByRole("button", {
        name: /check pos sync review: needs review/i,
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("needs review")).not.toBeInTheDocument();
    expect(screen.getByText("cashier-auth-dialog")).toBeInTheDocument();
    expect(onRetrySync).not.toHaveBeenCalled();
  });

  it("hides sale controls while a locally closed register is waiting to sync", async () => {
    const onRetrySync = vi.fn();
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: false,
      },
      registerInfo: {
        customerName: undefined,
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: true,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      closeoutControl: {
        canCloseout: false,
        canShowOpeningFloatCorrection: false,
        canCorrectOpeningFloat: false,
        onRequestCloseout: vi.fn(),
        onRequestOpeningFloatCorrection: vi.fn(),
      },
      authDialog: {
        open: false,
      },
      drawerGate: null,
      syncStatus: {
        description:
          "This register was closed locally. Athena will reconcile the closeout after sync.",
        label: "Locally closed",
        reconciliationItems: [],
        status: "locally_closed_pending_sync",
        tone: "warning",
        onRetrySync,
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("Register closed locally")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This register was closed locally. Athena will reconcile the closeout after sync.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /retry sync/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("register-customer-panel"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("register-action-bar")).not.toBeInTheDocument();
    expect(
      screen.queryByText("register-checkout-panel"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Ready for product lookup"),
    ).not.toBeInTheDocument();
  });

  it("focuses the product lookup entry when the empty lookup workspace is clicked", async () => {
    const setShowProductLookup = vi.fn();

    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        setShowProductLookup,
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      closeoutControl: {
        canCloseout: true,
        canShowOpeningFloatCorrection: true,
        canCorrectOpeningFloat: true,
        onRequestCloseout: vi.fn(),
        onRequestOpeningFloatCorrection: vi.fn(),
      },
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    await userEvent.click(screen.getByTestId("product-lookup-empty-state"));

    expect(setShowProductLookup).toHaveBeenCalledWith(true);
    expect(screen.getByLabelText("product search input")).toHaveFocus();
  });

  it("starts a new sale before focusing product lookup from the idle lookup workspace", async () => {
    const setShowProductLookup = vi.fn();
    let isSessionActive = false;
    const onStartNewSession = vi.fn(async () => {
      isSessionActive = true;
    });
    mockUseRegisterViewModel.mockImplementation(() => ({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        setShowProductLookup,
        onBarcodeSubmit: vi.fn(),
        canQuickAddProduct: false,
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {
        disableNewSession: false,
        onStartNewSession,
      },
      cashierCard: {},
      closeoutControl: {
        canCloseout: true,
        canShowOpeningFloatCorrection: true,
        canCorrectOpeningFloat: true,
        onRequestCloseout: vi.fn(),
        onRequestOpeningFloatCorrection: vi.fn(),
      },
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    }));

    const { POSRegisterView } = await import("./POSRegisterView");
    const { rerender } = render(<POSRegisterView />);

    await userEvent.click(screen.getByTestId("product-lookup-empty-state"));
    expect(onStartNewSession).toHaveBeenCalledTimes(1);

    rerender(<POSRegisterView />);

    await waitFor(() => {
      expect(setShowProductLookup).toHaveBeenCalledWith(true);
      expect(screen.getByLabelText("product search input")).toHaveFocus();
    });
  });

  it("starts a new sale before focusing product lookup when the idle header lookup is touched", async () => {
    const setShowProductLookup = vi.fn();
    let isSessionActive = false;
    const onStartNewSession = vi.fn(async () => {
      isSessionActive = true;
    });
    mockUseRegisterViewModel.mockImplementation(() => ({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        setShowProductLookup,
        onBarcodeSubmit: vi.fn(),
        canQuickAddProduct: false,
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {
        disableNewSession: false,
        onStartNewSession,
      },
      cashierCard: {},
      closeoutControl: {
        canCloseout: true,
        canShowOpeningFloatCorrection: true,
        canCorrectOpeningFloat: true,
        onRequestCloseout: vi.fn(),
        onRequestOpeningFloatCorrection: vi.fn(),
      },
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    }));

    const { POSRegisterView } = await import("./POSRegisterView");
    const { rerender } = render(<POSRegisterView />);

    const searchInput = screen.getByLabelText("product search input");
    expect(searchInput).not.toBeDisabled();
    expect(searchInput).not.toHaveAttribute("readonly");

    await userEvent.click(searchInput);
    expect(onStartNewSession).toHaveBeenCalledTimes(1);

    rerender(<POSRegisterView />);

    await waitFor(() => {
      expect(setShowProductLookup).toHaveBeenCalledWith(true);
      expect(screen.getByLabelText("product search input")).toHaveFocus();
    });
  });

  it("returns focus to the header product search after an item is added", async () => {
    const onAddProduct = vi.fn().mockResolvedValue(true);

    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "nuggs",
        setProductSearchQuery: vi.fn(),
        setShowProductLookup: vi.fn(),
        showProductLookup: true,
        onBarcodeSubmit: vi.fn(),
        onAddProduct,
        searchResults: [],
        isSearchLoading: false,
        isSearchReady: true,
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      closeoutControl: null,
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    const searchInput = screen.getByLabelText("product search input");
    searchInput.blur();

    await userEvent.click(screen.getByText("mock-add-product"));

    await waitFor(() => {
      expect(onAddProduct).toHaveBeenCalled();
      expect(searchInput).toHaveFocus();
    });
  });

  it("shows manager quick add from the empty product lookup workspace", async () => {
    const setShowProductLookup = vi.fn();
    mockOpenQuickAddProduct.mockClear();

    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        setShowProductLookup,
        onBarcodeSubmit: vi.fn(),
        canQuickAddProduct: true,
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      closeoutControl: {
        canCloseout: true,
        canShowOpeningFloatCorrection: true,
        canCorrectOpeningFloat: true,
        onRequestCloseout: vi.fn(),
        onRequestOpeningFloatCorrection: vi.fn(),
      },
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    await userEvent.click(
      screen.getByRole("button", { name: /quick add product/i }),
    );

    expect(screen.getByText("Ready for checkout lookup")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add service/i }),
    ).not.toBeInTheDocument();
    expect(setShowProductLookup).toHaveBeenCalledWith(true);
    await waitFor(() => expect(mockOpenQuickAddProduct).toHaveBeenCalled());
  });

  it("hides empty-state quick add for non-manager cashiers", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        setShowProductLookup: vi.fn(),
        onBarcodeSubmit: vi.fn(),
        canQuickAddProduct: false,
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      closeoutControl: {
        canCloseout: true,
        canShowOpeningFloatCorrection: false,
        canCorrectOpeningFloat: false,
        onRequestCloseout: vi.fn(),
        onRequestOpeningFloatCorrection: vi.fn(),
      },
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(
      screen.queryByRole("button", { name: /quick add product/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add service/i }),
    ).not.toBeInTheDocument();
  });

  it("renders POS onboarding when register setup is incomplete", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: false,
      },
      registerInfo: {
        customerName: undefined,
        registerLabel: "No terminal configured",
        hasTerminal: false,
      },
      onboarding: {
        shouldShow: true,
        terminalReady: false,
        cashierSetupReady: true,
        cashierSignedIn: false,
        cashierCount: 2,
        nextStep: "terminal",
      },
      customerPanel: {},
      productEntry: {
        disabled: true,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: null,
      cashierCard: null,
      authDialog: null,
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("Onboarding")).toBeInTheDocument();
    expect(
      screen.getByText("Finish setup before your first checkout"),
    ).toBeInTheDocument();
    expect(screen.getByText("Set up this register")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open register setup/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/pos/settings?o=%252F",
    );
    expect(screen.queryByText("product-search-input")).not.toBeInTheDocument();
    expect(
      screen.queryByText("register-checkout-panel"),
    ).not.toBeInTheDocument();
  });

  it("returns to the regular cashier sign-in flow once setup is ready", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: false,
      },
      registerInfo: {
        customerName: undefined,
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      onboarding: {
        shouldShow: false,
        terminalReady: true,
        cashierSetupReady: true,
        cashierSignedIn: false,
        cashierCount: 1,
        nextStep: "ready",
      },
      customerPanel: {},
      productEntry: {
        disabled: true,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: null,
      cashierCard: null,
      authDialog: {
        open: true,
        storeId: "store-1",
        terminalId: "terminal-1",
        workflowMode: "pos",
        onAuthenticated: vi.fn(),
        onDismiss: vi.fn(),
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.queryByText("Onboarding")).not.toBeInTheDocument();
    expect(screen.getByText("cashier-auth-dialog")).toBeInTheDocument();
    expect(
      screen.queryByText("register-customer-panel"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("cart-items")).toBeInTheDocument();
    expect(screen.getByText("register-checkout-panel")).toBeInTheDocument();
  });

  it("holds a blank register workspace while setup is resolving before auth", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: false,
      },
      registerInfo: {
        customerName: undefined,
        registerLabel: "No terminal configured",
        hasTerminal: false,
      },
      onboarding: {
        shouldShow: false,
        terminalReady: false,
        cashierSetupReady: true,
        cashierSignedIn: false,
        cashierCount: 1,
        nextStep: "ready",
      },
      customerPanel: {},
      productEntry: {
        disabled: true,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: null,
      cashierCard: null,
      authDialog: null,
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.queryByText("Onboarding")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Ready for product lookup"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("product-search-input")).not.toBeInTheDocument();
    expect(
      screen.queryByText("register-customer-panel"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("cart-items")).not.toBeInTheDocument();
    expect(
      screen.queryByText("register-checkout-panel"),
    ).not.toBeInTheDocument();
  });

  it("holds a blank register workspace while cashier presence restore is pending", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: undefined,
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: true,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: null,
      cashierCard: null,
      cashierPresenceRestore: {
        status: "pending",
      },
      closeoutControl: null,
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.queryByText("product-search-input")).not.toBeInTheDocument();
    expect(
      screen.queryByText("register-customer-panel"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("cart-items")).not.toBeInTheDocument();
    expect(
      screen.queryByText("register-checkout-panel"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("cashier-auth-dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Ready for product lookup"),
    ).not.toBeInTheDocument();
  });

  it("keeps the full POS rail while hiding main sale controls when cashier authentication is locked", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: undefined,
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: true,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [
          {
            id: "line-1",
            name: "Hodor",
            price: 550,
            quantity: 1,
          },
        ],
      },
      checkout: {
        cartItems: [
          {
            id: "line-1",
            name: "Hodor",
            price: 550,
            quantity: 1,
          },
        ],
        isTransactionCompleted: false,
        payments: [],
        subtotal: 550,
        tax: 0,
        total: 550,
      },
      sessionPanel: null,
      cashierCard: null,
      authDialog: {
        open: true,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("cashier-auth-dialog")).toBeInTheDocument();
    expect(
      screen.queryByText("register-customer-panel"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("product-entry")).not.toBeInTheDocument();
    expect(screen.getByText("cart-items")).toBeInTheDocument();
    expect(screen.getByText("cart-items-count-0")).toBeInTheDocument();
    expect(screen.getByText("register-checkout-panel")).toBeInTheDocument();
    expect(screen.getByText("checkout-items-count-0")).toBeInTheDocument();
    expect(screen.getByText("checkout-total-0")).toBeInTheDocument();
    expect(
      screen.getByTestId("register-workspace-sidebar"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("register-main-workspace")).not.toHaveClass(
      "lg:col-span-2",
    );
  });

  it("renders expense completion UI in expense workflow without POS checkout controls", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "Expense",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Expenses",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        showProductLookup: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
        onAddProduct: vi.fn(),
        setShowProductLookup: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: null,
      cashierCard: null,
      drawerGate: {
        mode: "initialSetup",
        registerLabel: "Expenses",
        registerNumber: "1",
        currency: "GHS",
        openingFloat: "0.00",
        notes: "",
        errorMessage: null,
        isSubmitting: false,
        onOpeningFloatChange: vi.fn(),
        onNotesChange: vi.fn(),
        onSubmit: vi.fn(),
        onSignOut: vi.fn(),
      },
      authDialog: {
        open: false,
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView workflowMode="expense" />);

    expect(screen.getByText("expense-completion-panel")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("register-workspace-sidebar")).getByText(
        "expense-completion-panel",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("register-main-workspace")).queryByText(
        "expense-completion-panel",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText("cart-items")).toBeInTheDocument();
    expect(screen.queryByText("register-action-bar")).not.toBeInTheDocument();
    expect(
      screen.queryByText("register-customer-panel"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("register-checkout-panel"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Drawer closed")).not.toBeInTheDocument();
  });

  it("falls back to the injected expense view model workflow when mode prop is omitted", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "Expense",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Expenses",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        showProductLookup: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
        onAddProduct: vi.fn(),
        setShowProductLookup: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      workflowMode: "expense",
      sessionPanel: null,
      cashierCard: null,
      drawerGate: null,
      authDialog: {
        open: false,
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("expense-completion-panel")).toBeInTheDocument();
    expect(
      screen.queryByText("register-checkout-panel"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("register-action-bar")).not.toBeInTheDocument();
  });

  it("shows the expense entry state after an expense session completes", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "Expense Products",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Expenses",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        showProductLookup: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
        onAddProduct: vi.fn(),
        setShowProductLookup: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: true,
        cartItems: [],
        completedTransactionData: {
          completedAt: new Date("2026-06-17T12:00:00Z"),
          cartItems: [
            {
              id: "expense-item-1",
              name: "Wigclub Scarf",
              price: 1000,
              quantity: 2,
              productId: "product-1",
              skuId: "sku-1",
            },
          ],
          total: 2000,
        },
      },
      workflowMode: "expense",
      sessionPanel: null,
      cashierCard: null,
      drawerGate: null,
      authDialog: {
        open: false,
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(
      within(screen.getByTestId("register-main-workspace")).getByText(
        "expense-completion-panel",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("register-workspace-sidebar")).queryByText(
        "expense-completion-panel",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Ready for expense entry"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Search or scan products to add expense items"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("cart-items")).toBeInTheDocument();
    expect(screen.getByText("cart-items-count-2")).toBeInTheDocument();
    expect(screen.getByText("cart-items-readonly-yes")).toBeInTheDocument();
    expect(screen.getByText("cart-items-density-comfortable")).toBeInTheDocument();
    expect(screen.getByText("Wigclub Scarf")).toBeInTheDocument();
    expect(screen.getByText("expense-completion-panel")).toBeInTheDocument();
    expect(screen.getByText("Cashier")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(
      screen.queryByText("register-checkout-panel"),
    ).not.toBeInTheDocument();
  });

  it("keeps the register shell around expense authentication", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "Expense Products",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Expenses",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: true,
        showProductLookup: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
        onAddProduct: vi.fn(),
        setShowProductLookup: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: true,
      },
      workflowMode: "expense",
      sessionPanel: null,
      cashierCard: null,
      drawerGate: null,
      authDialog: {
        open: true,
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    const authDialog = screen.getByText("cashier-auth-dialog");

    expect(authDialog).toBeInTheDocument();
    expect(authDialog.parentElement).not.toHaveClass("lg:col-span-2");
    expect(screen.getByText("cart-items")).toBeInTheDocument();
    expect(screen.getByText("expense-completion-panel")).toBeInTheDocument();
    expect(screen.getByText("Cashier")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(
      screen.queryByText("Ready for expense entry"),
    ).not.toBeInTheDocument();
  });

  it("keeps POS workflow behavior when expense completion data is present but mode is not set to expense", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        showProductLookup: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
        onAddProduct: vi.fn(),
        setShowProductLookup: vi.fn(),
      },
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      drawerGate: null,
      authDialog: {
        open: false,
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("register-checkout-panel")).toBeInTheDocument();
    expect(screen.getByText("register-customer-panel")).toBeInTheDocument();
    expect(screen.getByText("cart-items")).toBeInTheDocument();
    expect(
      screen.queryByText("expense-completion-panel"),
    ).not.toBeInTheDocument();
  });

  it("keeps product lookup stable while payment method selection is active", async () => {
    const setProductSearchQuery = vi.fn();
    const baseViewModel = {
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery,
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [
          {
            id: "line-1",
            name: "Nuggs",
            price: 5500,
            quantity: 1,
          },
        ],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    };
    mockUseRegisterViewModel.mockReturnValue(baseViewModel);

    const { POSRegisterView } = await import("./POSRegisterView");
    const { rerender } = render(<POSRegisterView />);

    await userEvent.click(screen.getByText("show-payment-methods"));

    expect(screen.getByText("Ready for checkout lookup")).toBeInTheDocument();
    expect(screen.getByTestId("cart-items-compact")).toBeInTheDocument();
    expect(screen.queryByText("product-entry")).not.toBeInTheDocument();

    mockUseRegisterViewModel.mockReturnValue({
      ...baseViewModel,
      productEntry: {
        ...baseViewModel.productEntry,
        productSearchQuery: "water",
      },
    });

    rerender(<POSRegisterView />);

    await waitFor(() => {
      expect(screen.getByText("product-entry")).toBeInTheDocument();
    });
    expect(
      within(screen.getByTestId("register-main-workspace")).queryByTestId(
        "cart-items-compact",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("register-workspace-sidebar")).queryByTestId(
        "cart-items-compact",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("register-checkout-panel").closest(".rounded-lg"),
    ).toHaveClass("flex", "flex-1");

    await userEvent.click(screen.getByText("show-payment-methods"));

    expect(setProductSearchQuery).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText("start-payment-entry"));

    expect(setProductSearchQuery).toHaveBeenCalledWith("");
  });

  it("moves cart to the left while payment entry is active", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [
          {
            id: "line-1",
            name: "Nuggs",
            price: 5500,
            quantity: 1,
          },
        ],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    await userEvent.click(screen.getByText("start-payment-entry"));

    expect(screen.getByText("Ready for checkout lookup")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("register-main-workspace")).getByTestId(
        "cart-items-compact",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("register-workspace-sidebar")).queryByTestId(
        "cart-items-compact",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("cart-items-comfortable"),
    ).not.toBeInTheDocument();
  });

  it("keeps the product lookup workspace stable while a payment is edited", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [
          {
            id: "line-1",
            name: "Nuggs",
            price: 5500,
            quantity: 1,
          },
          {
            id: "line-2",
            name: "Agya",
            price: 7500,
            quantity: 2,
          },
        ],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("Ready for checkout lookup")).toBeInTheDocument();
    expect(screen.getByTestId("cart-items-compact")).toBeInTheDocument();

    await userEvent.click(screen.getByText("start-payment-edit"));

    expect(screen.getByText("Ready for checkout lookup")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("register-main-workspace")).getByTestId(
        "cart-items-compact",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("register-workspace-sidebar")).queryByTestId(
        "cart-items-compact",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("cart-items-comfortable"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show cart items" }),
    ).not.toBeInTheDocument();
  });

  it("hides the cart column when payment entry stays beside product results", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "agya",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [
          {
            id: "line-1",
            name: "Nuggs",
            price: 5500,
            quantity: 1,
          },
          {
            id: "line-2",
            name: "Agya",
            price: 7500,
            quantity: 2,
          },
        ],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    await userEvent.click(screen.getByText("activate-payment-entry"));

    expect(
      within(screen.getByTestId("register-main-workspace")).getByText(
        "product-entry",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("register-main-workspace")).queryByTestId(
        "cart-items-compact",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("register-workspace-sidebar")).queryByTestId(
        "cart-items-compact",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("cart-items-comfortable"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show cart items" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the cart visible when payments are expanded", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [
          {
            id: "line-1",
            name: "Nuggs",
            price: 5500,
            quantity: 1,
          },
          {
            id: "line-2",
            name: "Agya",
            price: 7500,
            quantity: 2,
          },
        ],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByTestId("cart-items-compact")).toBeInTheDocument();

    await userEvent.click(screen.getByText("expand-payments"));

    expect(
      within(screen.getByTestId("register-main-workspace")).getByTestId(
        "cart-items-compact",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("register-main-workspace")).getByText(
        "cart-items-count-3",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("register-workspace-sidebar")).queryByTestId(
        "cart-items-compact",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show cart items" }),
    ).not.toBeInTheDocument();
  });

  it("does not render the collapsed cart summary after payments expand", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {
        disabled: false,
        productSearchQuery: "",
        setProductSearchQuery: vi.fn(),
        onBarcodeSubmit: vi.fn(),
      },
      cart: {
        items: [
          {
            id: "line-1",
            name: "Nuggs",
            price: 5500,
            quantity: 1,
          },
          {
            id: "line-2",
            name: "Agya",
            price: 7500,
            quantity: 2,
          },
        ],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      authDialog: {
        open: false,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    await userEvent.click(screen.getByText("expand-payments"));

    expect(
      within(screen.getByTestId("register-main-workspace")).getByTestId(
        "cart-items-compact",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("register-main-workspace")).getByText(
        "cart-items-count-3",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("register-workspace-sidebar")).queryByTestId(
        "cart-items-compact",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show cart items" }),
    ).not.toBeInTheDocument();
  });

  it("renders the drawer gate in the product lookup space while drawer setup is pending", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: false,
      },
      registerInfo: {
        customerName: undefined,
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {},
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      drawerGate: {
        mode: "initialSetup",
        registerLabel: "Front Counter",
        registerNumber: "1",
        currency: "GHS",
        canOpenCashControls: false,
        openingFloat: "50.00",
        notes: "",
        errorMessage: null,
        isSubmitting: false,
        onOpeningFloatChange: vi.fn(),
        onNotesChange: vi.fn(),
        onSubmit: vi.fn(),
        onSignOut: vi.fn(),
      },
      sessionPanel: null,
      cashierCard: null,
      authDialog: {
        open: false,
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("Drawer closed")).toBeInTheDocument();
    expect(
      screen.getByText("Open drawer to start selling"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Front Counter is closed. Enter the opening float before starting sales.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Opening float (GH₵)")).toBeInTheDocument();
    expect(screen.getByText("register-customer-panel")).toBeInTheDocument();
    expect(screen.queryByText("product-entry")).not.toBeInTheDocument();
    expect(screen.getByText("cart-items")).toBeInTheDocument();
    expect(screen.getByText("register-checkout-panel")).toBeInTheDocument();
    expect(screen.queryByText("register-action-bar")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /cash controls/i }),
    ).not.toBeInTheDocument();
  });

  it("renders recovery copy, inline errors, and escape actions in the product lookup space", async () => {
    const onSignOut = vi.fn();
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: true,
      },
      registerInfo: {
        customerName: "Ama Serwa",
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {},
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      drawerGate: {
        mode: "recovery",
        registerLabel: "Front Counter",
        registerNumber: "1",
        currency: "GHS",
        canOpenCashControls: true,
        openingFloat: "50.00",
        notes: "",
        errorMessage:
          "Drawer already open for this register. Return to the active sale or review it in Cash Controls.",
        isSubmitting: false,
        onOpeningFloatChange: vi.fn(),
        onNotesChange: vi.fn(),
        onSubmit: vi.fn(),
        onSignOut,
      },
      sessionPanel: {},
      cashierCard: {},
      authDialog: {
        open: false,
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("Drawer closed")).toBeInTheDocument();
    expect(screen.getByText("Open drawer to continue")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Front Counter is closed. Open the drawer to continue this sale.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Drawer already open for this register. Return to the active sale or review it in Cash Controls.",
    );
    expect(screen.getByText("register-customer-panel")).toBeInTheDocument();
    expect(screen.queryByText("product-entry")).not.toBeInTheDocument();
    expect(screen.getByText("cart-items")).toBeInTheDocument();
    expect(screen.getByText("register-checkout-panel")).toBeInTheDocument();
    expect(screen.getByText("register-action-bar")).toBeInTheDocument();
    expect(screen.getByText("drawer-recovery-action")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /cash controls/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls?o=%252F",
    );

    const signOutButtons = screen.getAllByRole("button", { name: /sign out/i });
    await userEvent.click(signOutButtons.at(-1)!);

    expect(onSignOut).toHaveBeenCalled();
  });

  it("renders closeout-blocked copy without drawer-opening controls", async () => {
    const onSignOut = vi.fn();
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: false,
      },
      registerInfo: {
        customerName: undefined,
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {},
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      drawerGate: {
        mode: "closeoutBlocked",
        isRecovery: false,
        registerLabel: "Front Counter",
        registerNumber: "1",
        currency: "GHS",
        canOpenCashControls: true,
        cashControlsRegisterSessionId: "drawer-1",
        closeoutCountedCash: "",
        closeoutDraftVariance: -500,
        closeoutNotes: "",
        expectedCash: 5000,
        errorMessage: null,
        isCloseoutSubmitting: false,
        isReopeningCloseout: false,
        onCloseoutSecondaryAction: vi.fn(),
        onCloseoutCountedCashChange: vi.fn(),
        onCloseoutNotesChange: vi.fn(),
        onReopenRegister: vi.fn(),
        onSubmitCloseout: vi.fn(),
        onSignOut,
      },
      sessionPanel: null,
      cashierCard: null,
      authDialog: {
        open: false,
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(
      screen.getByText("Register 1 closeout in progress"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Finish this register closeout in Cash Controls before selling here./i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /cash controls/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/drawer-1?o=%252F",
    );
    expect(screen.getByText("Expected")).toBeInTheDocument();
    expect(screen.getByText("GH₵50")).toBeInTheDocument();
    expect(screen.getByText("GH₵-5")).toBeInTheDocument();
    expect(screen.getByLabelText(/counted cash/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/closeout notes/i)).not.toBeRequired();
    expect(
      screen.queryByText("Notes are required when the count has variance."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /submit closeout/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reopen register/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/opening float/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /open drawer/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("register-customer-panel")).toBeInTheDocument();
    expect(screen.queryByText("product-entry")).not.toBeInTheDocument();
    expect(screen.getByText("cart-items")).toBeInTheDocument();
    expect(screen.getByText("register-checkout-panel")).toBeInTheDocument();
    expect(screen.queryByText("register-action-bar")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(onSignOut).toHaveBeenCalled();
  });

  it("renders manager approval pending closeout state without closeout inputs", async () => {
    const onSignOut = vi.fn();
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: false,
      },
      registerInfo: {
        customerName: undefined,
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {},
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      drawerGate: {
        mode: "closeoutBlocked",
        isRecovery: false,
        registerLabel: "Front Counter",
        registerNumber: "3",
        currency: "GHS",
        closeoutSubmittedCountedCash: 300_000,
        closeoutSubmittedVariance: -568_100,
        closeoutSecondaryActionLabel: "Reopen register",
        expectedCash: 868_100,
        errorMessage: null,
        canOpenCashControls: true,
        cashControlsRegisterSessionId: "drawer-1",
        hasPendingCloseoutApproval: true,
        hasSignedInStaff: false,
        isReopeningCloseout: false,
        onReopenRegister: vi.fn(),
        onSignOut,
      },
      sessionPanel: null,
      cashierCard: null,
      authDialog: {
        open: false,
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("Manager approval required")).toBeInTheDocument();
    expect(
      screen.getByText("Register 3 closeout submitted"),
    ).toBeInTheDocument();
    expect(screen.getByText("GH₵8,681")).toBeInTheDocument();
    expect(screen.getByText("GH₵3,000")).toBeInTheDocument();
    expect(screen.getByText("GH₵-5,681")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /cash controls/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/drawer-1?o=%252F",
    );
    expect(
      screen.getByRole("button", { name: /reopen register/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /sign out/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/counted cash/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/closeout notes/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /submit closeout/i }),
    ).not.toBeInTheDocument();
  });

  it("hides cash controls from non-manager pending closeout approval state", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      header: {
        title: "POS",
        isSessionActive: false,
      },
      registerInfo: {
        customerName: undefined,
        registerLabel: "Front Counter",
        hasTerminal: true,
      },
      customerPanel: {},
      productEntry: {},
      cart: {
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      drawerGate: {
        mode: "closeoutBlocked",
        isRecovery: false,
        registerLabel: "Front Counter",
        registerNumber: "3",
        currency: "GHS",
        closeoutSubmittedCountedCash: 300_000,
        closeoutSubmittedVariance: -568_100,
        closeoutSecondaryActionLabel: "Reopen register",
        expectedCash: 868_100,
        errorMessage: null,
        canOpenCashControls: false,
        hasPendingCloseoutApproval: true,
        isReopeningCloseout: false,
        onReopenRegister: vi.fn(),
        onSignOut: vi.fn(),
      },
      sessionPanel: null,
      cashierCard: null,
      authDialog: {
        open: false,
      },
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("Manager approval required")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /cash controls/i }),
    ).not.toBeInTheDocument();
  });
});
