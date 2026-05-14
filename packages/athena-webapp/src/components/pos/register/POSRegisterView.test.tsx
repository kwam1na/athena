import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const mockUseRegisterViewModel = vi.fn();

vi.mock("@/lib/pos/presentation/register/useRegisterViewModel", () => ({
  useRegisterViewModel: () => mockUseRegisterViewModel(),
}));

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({
    isMobile: false,
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
          })
        : params;
    const href = to.replace(
      "$sessionId",
      resolvedParams?.sessionId ?? "$sessionId",
    );
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
  FadeIn: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    ProductEntry: React.forwardRef((_, ref) => {
      React.useImperativeHandle(ref, () => ({
        focusProductSearchInput: () => true,
      }));

      return <div>product-entry</div>;
    }),
    ProductSearchInput: React.forwardRef<HTMLInputElement>((_, ref) => (
      <div>
        <input ref={ref} aria-label="product search input" />
        <span>product-search-input</span>
      </div>
    )),
  };
});

vi.mock("@/components/pos/CartItems", () => ({
  CartItems: ({ density }: { density?: string }) => (
    <div data-testid={`cart-items-${density ?? "default"}`}>cart-items</div>
  ),
}));

vi.mock("@/components/pos/CashierAuthDialog", () => ({
  CashierAuthDialog: ({ open }: { open: boolean }) =>
    open ? <div>cashier-auth-dialog</div> : null,
}));

vi.mock("./RegisterActionBar", () => ({
  RegisterActionBar: ({
    closeoutControl,
  }: {
    closeoutControl?: {
      canCloseout: boolean;
      canShowOpeningFloatCorrection: boolean;
      canCorrectOpeningFloat: boolean;
      onRequestCloseout: () => void;
      onRequestOpeningFloatCorrection: () => void;
    } | null;
  }) => (
    <div>
      register-action-bar
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
    </div>
  ),
}));

vi.mock("./RegisterCustomerPanel", () => ({
  RegisterCustomerPanel: () => <div>register-customer-panel</div>,
}));

vi.mock("./RegisterCheckoutPanel", () => ({
  RegisterCheckoutPanel: ({
    onPaymentFlowChange,
    onPaymentEntryStart,
    onEditingPaymentChange,
    onPaymentsExpandedChange,
  }: {
    onPaymentFlowChange: (active: boolean) => void;
    onPaymentEntryStart: () => void;
    onEditingPaymentChange?: (editing: boolean) => void;
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
      <div>register-checkout-panel</div>
    </div>
  ),
}));

vi.mock("./ExpenseCompletionPanel", () => ({
  ExpenseCompletionPanel: () => <div>expense-completion-panel</div>,
}));

describe("POSRegisterView", () => {
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

    expect(screen.getByText("register-action-bar")).toBeInTheDocument();
    expect(screen.getByText("closeout-control")).toBeInTheDocument();
    expect(screen.getByText("register-customer-panel")).toBeInTheDocument();
    expect(screen.getByText("product-search-input")).toBeInTheDocument();
    expect(screen.getByText("Ready for product lookup")).toBeInTheDocument();
    expect(screen.getByText("⌘+K")).toBeInTheDocument();
    expect(screen.getByText("cart-items")).toBeInTheDocument();
    expect(screen.getByText("register-checkout-panel")).toBeInTheDocument();
    expect(screen.queryByText("cashier-auth-dialog")).not.toBeInTheDocument();
  });

  it("renders local-only register context with debug state instead of the blank shell", async () => {
    mockUseRegisterViewModel.mockReturnValue({
      hasActiveStore: true,
      debug: {
        activeStoreSource: "local",
        authDialogOpen: true,
        hasLiveActiveStore: false,
        localEntryStatus: "ready",
        online: false,
        staffSignedIn: false,
        storeId: "store-1",
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

    expect(screen.getByText("Register connection details")).toBeInTheDocument();
    expect(screen.getByText("offline")).toBeInTheDocument();
    expect(screen.getByText("local:store-1")).toBeInTheDocument();
    expect(screen.getByText("local:terminal-1")).toBeInTheDocument();
    expect(screen.getByText("cashier-auth-dialog")).toBeInTheDocument();
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

    expect(screen.getByText("Pending sync")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /retry pos sync/i }));

    expect(onRetrySync).toHaveBeenCalled();
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
    expect(screen.getByText("Locally closed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry sync/i })).toBeInTheDocument();
    expect(screen.queryByText("register-customer-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("register-action-bar")).not.toBeInTheDocument();
    expect(screen.queryByText("register-checkout-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("Ready for product lookup")).not.toBeInTheDocument();
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

    await userEvent.click(
      screen.getByRole("button", { name: /Ready for product lookup/i }),
    );

    expect(setShowProductLookup).toHaveBeenCalledWith(true);
    expect(screen.getByLabelText("product search input")).toHaveFocus();
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
    expect(screen.getByText("Finish setup before your first checkout")).toBeInTheDocument();
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
    expect(screen.getByText("register-customer-panel")).toBeInTheDocument();
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
    expect(screen.queryByText("Ready for product lookup")).not.toBeInTheDocument();
    expect(screen.queryByText("product-search-input")).not.toBeInTheDocument();
    expect(screen.queryByText("register-customer-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("cart-items")).not.toBeInTheDocument();
    expect(
      screen.queryByText("register-checkout-panel"),
    ).not.toBeInTheDocument();
  });

  it("renders cashier authentication in the product lookup space while keeping POS controls visible", async () => {
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
      authDialog: {
        open: true,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("cashier-auth-dialog")).toBeInTheDocument();
    expect(screen.getByText("register-customer-panel")).toBeInTheDocument();
    expect(screen.queryByText("product-entry")).not.toBeInTheDocument();
    expect(screen.getByText("cart-items")).toBeInTheDocument();
    expect(screen.getByText("register-checkout-panel")).toBeInTheDocument();
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

    expect(screen.getByText("Ready for expense entry")).toBeInTheDocument();
    expect(
      screen.getByText("Search or scan products to add expense items"),
    ).toBeInTheDocument();
    expect(screen.getByText("cart-items")).toBeInTheDocument();
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

    expect(screen.getByText("Ready for product lookup")).toBeInTheDocument();
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

    expect(
      screen.queryByText("Ready for product lookup"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("cart-items-comfortable")).toBeInTheDocument();
    expect(screen.queryByTestId("cart-items-compact")).not.toBeInTheDocument();
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

    expect(screen.getByText("Ready for product lookup")).toBeInTheDocument();
    expect(screen.getByTestId("cart-items-compact")).toBeInTheDocument();

    await userEvent.click(screen.getByText("start-payment-edit"));

    expect(screen.getByText("Ready for product lookup")).toBeInTheDocument();
    expect(screen.queryByTestId("cart-items-compact")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("cart-items-comfortable"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Items")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("summarizes the cart in the rail when payment entry stays beside product results", async () => {
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

    expect(screen.getByText("product-entry")).toBeInTheDocument();
    expect(screen.getByText("Items")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByTestId("cart-items-compact")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("cart-items-comfortable"),
    ).not.toBeInTheDocument();
  });

  it("collapses the cart in the rail when payments are expanded", async () => {
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

    expect(screen.queryByTestId("cart-items-compact")).not.toBeInTheDocument();
    expect(screen.getByText("Items")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("expands the cart and collapses payments when the item summary is selected", async () => {
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

    expect(screen.queryByTestId("cart-items-compact")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show cart items" }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Show cart items" }),
    );

    expect(screen.getByTestId("cart-items-compact")).toBeInTheDocument();
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
    expect(screen.queryByText("register-action-bar")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /cash controls/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls?o=%252F",
    );

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

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
    expect(screen.getByLabelText(/closeout notes/i)).toBeRequired();
    expect(
      screen.getByText("Notes are required when the count has variance."),
    ).toBeInTheDocument();
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
      screen.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
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
