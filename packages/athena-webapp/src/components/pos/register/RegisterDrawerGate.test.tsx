import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RegisterDrawerGate } from "./RegisterDrawerGate";
import type { RegisterDrawerGateState } from "@/lib/pos/presentation/register/registerUiState";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    params?: unknown;
    search?: unknown;
    to?: string;
  }) => (
    <a href="#" {...props}>
      {children}
    </a>
  ),
}));

function renderGate(overrides: Partial<RegisterDrawerGateState> = {}) {
  const drawerGate: RegisterDrawerGateState = {
    canOpenDrawer: true,
    currency: "GHS",
    errorMessage: null,
    isSubmitting: false,
    mode: "initialSetup",
    notes: "",
    onNotesChange: vi.fn(),
    onOpeningFloatChange: vi.fn(),
    onSignOut: vi.fn(),
    onSubmit: vi.fn(),
    openingFloat: "50.00",
    registerLabel: "Codex",
    registerNumber: "3",
    ...overrides,
  };

  render(<RegisterDrawerGate drawerGate={drawerGate} />);

  return drawerGate;
}

describe("RegisterDrawerGate", () => {
  it("uses workflow styling for opening float corrections", () => {
    renderGate({
      correctedOpeningFloat: "5",
      correctionReason: "Opening count was corrected.",
      expectedCash: 20500,
      mode: "openingFloatCorrection",
    });

    expect(screen.getByRole("button", { name: "Save correction" })).toHaveClass(
      "bg-action-workflow",
    );
  });

  it("blocks drawer opening unless the signed-in staff member is a cashier or manager", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderGate({
      canOpenDrawer: false,
      onSubmit,
    });

    expect(
      screen.getByText("Cashier or manager sign-in required to open this drawer."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open drawer" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Open drawer" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows pesewa-level submitted closeout variances while whole cedi counts stay compact", () => {
    renderGate({
      canViewCloseoutFinancials: true,
      closeoutSubmittedCountedCash: 10000,
      closeoutSubmittedVariance: 2,
      expectedCash: 10002,
      hasPendingCloseoutApproval: true,
      mode: "closeoutBlocked",
    });

    expect(screen.getByText("GH₵100.02")).toBeInTheDocument();
    expect(screen.getByText("GH₵100")).toBeInTheDocument();
    expect(screen.getByText("GH₵0.02")).toHaveClass("text-success");
  });

  it("does not render a reopen action when no reopen handler is available", () => {
    renderGate({
      canViewCloseoutFinancials: true,
      closeoutSubmittedCountedCash: 12500,
      closeoutSubmittedVariance: 2500,
      expectedCash: 10000,
      hasPendingCloseoutApproval: true,
      mode: "closeoutBlocked",
      onReopenRegister: undefined,
    });

    expect(
      screen.queryByRole("button", { name: "Reopen register" }),
    ).not.toBeInTheDocument();
  });

  it("offers replacement drawer opening for submitted review-only closeouts", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderGate({
      canViewCloseoutFinancials: true,
      closeoutSecondaryActionLabel: "Open replacement drawer",
      closeoutSubmittedCountedCash: 12500,
      closeoutSubmittedVariance: 2500,
      expectedCash: 10000,
      hasPendingCloseoutApproval: true,
      mode: "closeoutBlocked",
      onReopenRegister: undefined,
      onSubmit,
    });

    await user.click(
      screen.getByRole("button", { name: "Open replacement drawer" }),
    );

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Reopen register" }),
    ).not.toBeInTheDocument();
  });

  it("hides submitted closeout sign-out when no staff is signed in", () => {
    renderGate({
      canViewCloseoutFinancials: true,
      closeoutSubmittedCountedCash: 780_000,
      closeoutSubmittedVariance: 40_000,
      expectedCash: 740_000,
      hasPendingCloseoutApproval: true,
      hasSignedInStaff: false,
      mode: "closeoutBlocked",
      onReopenRegister: vi.fn(),
    });

    expect(screen.getByText("Manager approval required")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign out" }),
    ).not.toBeInTheDocument();
  });

  it("shows synced zero-variance closeouts as submitted instead of rendering the closeout form", () => {
    renderGate({
      canViewCloseoutFinancials: true,
      closeoutSubmittedCountedCash: 10000,
      closeoutSubmittedReason: "pending_sync",
      closeoutSubmittedVariance: 0,
      expectedCash: 10000,
      mode: "closeoutBlocked",
      onReopenRegister: vi.fn(),
    });

    expect(screen.getByText("Closeout syncing")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Closeout is saved on this register. Selling is paused until sync finishes or the register is reopened.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit closeout" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Counted cash/i),
    ).not.toBeInTheDocument();
  });

  it("shows pesewa-level draft closeout variances while whole cedi expected cash stays compact", () => {
    renderGate({
      canViewCloseoutFinancials: true,
      closeoutCountedCash: "100.00",
      closeoutDraftVariance: -2,
      expectedCash: 10002,
      mode: "closeoutBlocked",
    });

    expect(screen.getByText("GH₵100.02")).toBeInTheDocument();
    expect(screen.getByText("GH₵-0.02")).toHaveClass("text-danger");
  });

  it("hides draft closeout financials from non-manager cashiers", () => {
    renderGate({
      canViewCloseoutFinancials: false,
      closeoutCountedCash: "100.00",
      closeoutDraftVariance: -2,
      expectedCash: 10002,
      mode: "closeoutBlocked",
    });

    expect(screen.queryByText("Expected")).not.toBeInTheDocument();
    expect(screen.queryByText("Draft variance")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending count")).not.toBeInTheDocument();
    expect(screen.queryByText("GH₵100.02")).not.toBeInTheDocument();
    expect(screen.queryByText("GH₵-0.02")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Counted cash (GH₵)")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Submit closeout" }),
    ).toBeInTheDocument();
  });

  it("calls out pending cash voids in the closeout expected cash context", () => {
    renderGate({
      canViewCloseoutFinancials: true,
      closeoutCountedCash: "6100.00",
      closeoutDraftVariance: 0,
      expectedCash: 610000,
      mode: "closeoutBlocked",
      pendingCashVoidApprovals: {
        cashAffectingCount: 1,
        cashAdjustmentCount: 1,
        cashAdjustmentDelta: -2000,
        cashAmount: 8000,
      },
    });

    expect(screen.getByText("Expected now")).toBeInTheDocument();
    expect(screen.getByText("GH₵6,100")).toBeInTheDocument();
    expect(screen.getByText("After adjustments")).toBeInTheDocument();
    expect(screen.getByText("GH₵6,000")).toBeInTheDocument();
    const metricText =
      screen.getByText("Expected now").closest("dl")?.textContent ?? "";
    expect(metricText.indexOf("Expected now")).toBeLessThan(
      metricText.indexOf("After adjustments"),
    );
    expect(metricText.indexOf("After adjustments")).toBeLessThan(
      metricText.indexOf("Draft variance"),
    );
    expect(
      screen.getByText(/After adjustments applies 1 pending cash void/),
    ).toHaveTextContent("GH₵80");
    expect(
      screen.getByText(/1 pending cash item adjustment reducing cash/),
    ).toHaveTextContent("GH₵20");
    expect(
      screen.queryByText(/expected cash becomes/),
    ).not.toBeInTheDocument();
  });

  it("runs the closeout secondary action for return-to-sale states", async () => {
    const user = userEvent.setup();
    const onCloseoutSecondaryAction = vi.fn();
    renderGate({
      closeoutSecondaryActionLabel: "Return to sale",
      expectedCash: 10002,
      mode: "closeoutBlocked",
      onCloseoutSecondaryAction,
    });

    await user.click(screen.getByRole("button", { name: "Return to sale" }));

    expect(onCloseoutSecondaryAction).toHaveBeenCalledTimes(1);
  });

  it("labels compact cloud session codes", () => {
    renderGate({
      closeoutCountedCash: "100.00",
      expectedCash: 10002,
      mode: "closeoutBlocked",
      registerSessionCode: "8980ZC",
      registerSessionCodeScope: "cloud",
    });

    expect(screen.getByText("Cloud session")).toBeInTheDocument();
    expect(screen.getByText("8980ZC")).toBeInTheDocument();
  });

  it("labels compact local session codes", () => {
    renderGate({
      closeoutCountedCash: "100.00",
      expectedCash: 10002,
      mode: "closeoutBlocked",
      registerSessionCode: "F48D56",
      registerSessionCodeScope: "local",
    });

    expect(screen.getByText("Local session")).toBeInTheDocument();
    expect(screen.getByText("F48D56")).toBeInTheDocument();
    expect(
      screen.queryByText(/local-register-/i),
    ).not.toBeInTheDocument();
  });

  it("shows terminal repair copy and sign-out action", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    renderGate({
      mode: "terminalRepair",
      onSignOut,
    });

    expect(screen.getByText("Setup needed")).toBeInTheDocument();
    expect(
      screen.getByText("Terminal setup needs repair"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("shows terminal repair errors when repair cannot continue", async () => {
    const user = userEvent.setup();
    const onRepairTerminalSetup = vi.fn();
    renderGate({
      errorMessage:
        "Terminal setup repair needs the current local setup record. Open POS Settings to repair setup.",
      mode: "terminalRepair",
      onRepairTerminalSetup,
    });

    expect(
      screen.getByText(
        "Terminal setup repair needs the current local setup record. Open POS Settings to repair setup.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Repair setup" }));

    expect(onRepairTerminalSetup).toHaveBeenCalledTimes(1);
  });

  it("shows drawer authority repair copy and sign-out action", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    const onRetrySync = vi.fn();
    renderGate({
      mode: "drawerAuthorityRepair",
      onRetrySync,
      onSignOut,
    });

    expect(screen.getByText("Setup needed")).toBeInTheDocument();
    expect(
      screen.getByText("Drawer needs repair"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Retry drawer check" }),
    );
    expect(onRetrySync).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("requires clearing a sale from a closed drawer before replacement", async () => {
    const user = userEvent.setup();
    const onClearSale = vi.fn();
    renderGate({
      mode: "recovery",
      onClearSale,
      onSubmit: undefined,
    });

    expect(screen.getByText("Sale paused")).toBeInTheDocument();
    expect(screen.getByText("Drawer changed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This sale belongs to the previous drawer. Clear the sale before opening a replacement drawer.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Opening float/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sale paused. This sale belongs to the previous drawer.",
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Drawer changed" })).toHaveFocus(),
    );

    await user.click(screen.getByRole("button", { name: "Clear sale" }));
    expect(onClearSale).toHaveBeenCalledOnce();
  });

  it("disables repeat clear attempts while the durable clear is running", () => {
    renderGate({
      isClearingSale: true,
      mode: "recovery",
      onClearSale: vi.fn(),
      onSubmit: undefined,
    });

    expect(screen.getByRole("button", { name: "Clear sale" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDisabled();
  });

  it("labels the opening form as a replacement after a durable clear", () => {
    renderGate({ isReplacement: true });

    expect(screen.getByText("Open a replacement drawer")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The previous drawer is closed. Enter the opening float for a new drawer.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open replacement drawer" }),
    ).toBeInTheDocument();
  });

  it("gives authority persistence failures a dedicated retry action", async () => {
    const user = userEvent.setup();
    const onRetrySync = vi.fn();
    renderGate({
      mode: "drawerAuthorityRepair",
      onRetrySync,
      repairReason: "persistence_failed",
    });

    expect(screen.getByText("Drawer status not saved")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Athena could not save the latest drawer status on this register. Retry before continuing.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetrySync).toHaveBeenCalledOnce();
  });
});
