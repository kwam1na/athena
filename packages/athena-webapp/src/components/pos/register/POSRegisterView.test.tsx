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
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
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
  CartItems: () => <div>cart-items</div>,
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
      onRequestCloseout: () => void;
    } | null;
  }) => (
    <div>
      register-action-bar
      {closeoutControl ? (
        <button
          disabled={!closeoutControl.canCloseout}
          onClick={closeoutControl.onRequestCloseout}
        >
          closeout-control
        </button>
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
  }: {
    onPaymentFlowChange: (active: boolean) => void;
    onPaymentEntryStart: () => void;
  }) => (
    <div>
      <button onClick={() => onPaymentFlowChange(true)}>
        activate-payment-flow
      </button>
      <button onClick={onPaymentEntryStart}>start-payment-entry</button>
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
        items: [],
      },
      checkout: {
        isTransactionCompleted: false,
      },
      sessionPanel: {},
      cashierCard: {},
      closeoutControl: {
        canCloseout: true,
        onRequestCloseout: vi.fn(),
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
    expect(screen.queryByText("register-customer-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("register-checkout-panel")).not.toBeInTheDocument();
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
    expect(screen.queryByText("register-checkout-panel")).not.toBeInTheDocument();
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
    expect(screen.queryByText("register-checkout-panel")).not.toBeInTheDocument();
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
    expect(screen.queryByText("Ready for expense entry")).not.toBeInTheDocument();
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
    expect(screen.queryByText("expense-completion-panel")).not.toBeInTheDocument();
  });

  it("returns to product entry when a paid sale starts a new product search", async () => {
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
        items: [],
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

    await userEvent.click(screen.getByText("activate-payment-flow"));

    expect(screen.getByText("cart-items")).toBeInTheDocument();
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

    await userEvent.click(screen.getByText("activate-payment-flow"));

    expect(setProductSearchQuery).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText("start-payment-entry"));

    expect(setProductSearchQuery).toHaveBeenCalledWith("");
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
    expect(screen.getByText("Open drawer to start selling")).toBeInTheDocument();
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
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls",
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
        closeoutCountedCash: "",
        closeoutDraftVariance: undefined,
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
    ).toBeInTheDocument();
    expect(screen.getByText("Expected")).toBeInTheDocument();
    expect(screen.getByText("GH₵50")).toBeInTheDocument();
    expect(screen.getByLabelText(/counted cash/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/closeout notes/i)).toBeInTheDocument();
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
});
