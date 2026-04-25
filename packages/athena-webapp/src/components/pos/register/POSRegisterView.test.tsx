import { render, screen } from "@testing-library/react";
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

vi.mock("@/components/pos/ProductEntry", () => ({
  ProductEntry: () => <div>product-entry</div>,
  ProductSearchInput: () => <div>product-search-input</div>,
}));

vi.mock("@/components/pos/CartItems", () => ({
  CartItems: () => <div>cart-items</div>,
}));

vi.mock("@/components/pos/CashierAuthDialog", () => ({
  CashierAuthDialog: ({ open }: { open: boolean }) =>
    open ? <div>cashier-auth-dialog</div> : null,
}));

vi.mock("./RegisterActionBar", () => ({
  RegisterActionBar: () => <div>register-action-bar</div>,
}));

vi.mock("./RegisterCustomerPanel", () => ({
  RegisterCustomerPanel: () => <div>register-customer-panel</div>,
}));

vi.mock("./RegisterCheckoutPanel", () => ({
  RegisterCheckoutPanel: () => <div>register-checkout-panel</div>,
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
      authDialog: {
        open: true,
      },
      drawerGate: null,
      onNavigateBack: vi.fn(),
    });

    const { POSRegisterView } = await import("./POSRegisterView");
    render(<POSRegisterView />);

    expect(screen.getByText("register-action-bar")).toBeInTheDocument();
    expect(screen.getByText("register-customer-panel")).toBeInTheDocument();
    expect(screen.getByText("product-search-input")).toBeInTheDocument();
    expect(screen.getByText("Ready for product lookup")).toBeInTheDocument();
    expect(screen.getByText("cart-items")).toBeInTheDocument();
    expect(screen.getByText("register-checkout-panel")).toBeInTheDocument();
    expect(screen.getByText("cashier-auth-dialog")).toBeInTheDocument();
  });

  it("renders the drawer gate instead of the selling surface while drawer setup is pending", async () => {
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
    expect(screen.queryByText("product-entry")).not.toBeInTheDocument();
    expect(screen.queryByText("cart-items")).not.toBeInTheDocument();
    expect(
      screen.queryByText("register-checkout-panel"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("register-action-bar")).not.toBeInTheDocument();
  });

  it("renders recovery copy, inline errors, and escape actions while hiding sale controls", async () => {
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
    expect(
      screen.getByText(/needs an open drawer before this sale can continue/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Drawer already open for this register. Return to the active sale or review it in Cash Controls.",
    );
    expect(screen.queryByText("product-entry")).not.toBeInTheDocument();
    expect(screen.queryByText("cart-items")).not.toBeInTheDocument();
    expect(
      screen.queryByText("register-checkout-panel"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("register-action-bar")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /cash controls/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers",
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
        errorMessage: null,
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

    expect(screen.getByText("Closeout in progress")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Front Counter is already in closeout. Finish it in Cash Controls before selling here again./i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /cash controls/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/opening float/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/notes/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /open drawer/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("product-entry")).not.toBeInTheDocument();
    expect(screen.queryByText("cart-items")).not.toBeInTheDocument();
    expect(
      screen.queryByText("register-checkout-panel"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("register-action-bar")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(onSignOut).toHaveBeenCalled();
  });
});
