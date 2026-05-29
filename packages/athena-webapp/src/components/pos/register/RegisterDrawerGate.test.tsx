import { render, screen } from "@testing-library/react";
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
  it("blocks drawer opening unless the signed-in staff member is a manager", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderGate({
      canOpenDrawer: false,
      onSubmit,
    });

    expect(
      screen.getByText("Manager sign-in required to open this drawer."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open drawer" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Open drawer" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows pesewa-level submitted closeout variances while whole cedi counts stay compact", () => {
    renderGate({
      closeoutSubmittedCountedCash: 10000,
      closeoutSubmittedVariance: 2,
      expectedCash: 10002,
      hasPendingCloseoutApproval: true,
      mode: "closeoutBlocked",
    });

    expect(screen.getByText("GH₵100.02")).toBeInTheDocument();
    expect(screen.getByText("GH₵100")).toBeInTheDocument();
    expect(screen.getByText("GH₵0.02")).toHaveClass("text-emerald-700");
  });

  it("does not render a reopen action when no reopen handler is available", () => {
    renderGate({
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

  it("shows synced zero-variance closeouts as submitted instead of rendering the closeout form", () => {
    renderGate({
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
      closeoutCountedCash: "100.00",
      closeoutDraftVariance: -2,
      expectedCash: 10002,
      mode: "closeoutBlocked",
    });

    expect(screen.getByText("GH₵100.02")).toBeInTheDocument();
    expect(screen.getByText("GH₵-0.02")).toHaveClass("text-red-700");
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

  it("shows drawer authority repair copy and sign-out action", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    renderGate({
      mode: "drawerAuthorityRepair",
      onSignOut,
    });

    expect(screen.getByText("Setup needed")).toBeInTheDocument();
    expect(
      screen.getByText("Drawer needs repair"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
