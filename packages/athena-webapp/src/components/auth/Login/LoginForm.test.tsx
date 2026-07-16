import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "./LoginForm";
import { ATHENA_EMAIL_OTP_PROVIDER_ID } from "../../../../shared/auth";

const mocked = vi.hoisted(() => ({
  checkAppLoginEmailApproval: vi.fn(),
  setStep: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({
    query: mocked.checkAppLoginEmailApproval,
  }),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({
    signIn: mocked.signIn,
  }),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    mocked.checkAppLoginEmailApproval.mockReset();
    mocked.checkAppLoginEmailApproval.mockResolvedValue({ approved: true });
    mocked.setStep.mockReset();
    mocked.signIn.mockReset();
  });

  it("starts the Convex Auth OTP flow with a normalized email before advancing", async () => {
    const user = userEvent.setup();

    mocked.signIn.mockResolvedValue({ signingIn: false });

    render(<LoginForm setStep={mocked.setStep} />);

    const emailInput = screen.getByTestId("athena-login-email-input");
    const continueButton = screen.getByTestId("athena-login-email-submit");

    expect(emailInput).toHaveAccessibleName("Email");
    expect(emailInput).toHaveAttribute("autocomplete", "email");
    expect(continueButton).toHaveAccessibleName(/continue/i);

    await user.type(emailInput, "KWAMINA.0X00@GMAIL.COM");
    await user.click(continueButton);

    await waitFor(() =>
      expect(mocked.signIn).toHaveBeenCalledWith(ATHENA_EMAIL_OTP_PROVIDER_ID, {
        email: "kwamina.0x00@gmail.com",
      })
    );
    expect(mocked.setStep).toHaveBeenCalledWith({
      email: "kwamina.0x00@gmail.com",
    });
  });

  it("keeps unapproved users in place with a clear recovery path", async () => {
    const user = userEvent.setup();
    mocked.checkAppLoginEmailApproval.mockResolvedValue({ approved: false });

    render(<LoginForm setStep={mocked.setStep} />);

    const emailInput = screen.getByTestId("athena-login-email-input");
    const statusRegion = screen.getByTestId("athena-login-status-region");
    expect(statusRegion).toHaveClass("min-h-5");

    await user.type(emailInput, "unapproved@example.com");
    await user.click(screen.getByTestId("athena-login-email-submit"));

    const accessMessage = await screen.findByRole("alert");
    expect(accessMessage).toHaveTextContent("Access not available");
    expect(accessMessage).not.toHaveTextContent("Use an approved email");
    expect(accessMessage.querySelector("svg")).toHaveClass(
      "lucide-circle-minus",
    );
    expect(statusRegion).toContainElement(accessMessage);
    expect(mocked.checkAppLoginEmailApproval).toHaveBeenCalledWith(
      expect.anything(),
      { email: "unapproved@example.com" },
    );
    expect(mocked.signIn).not.toHaveBeenCalled();
    expect(mocked.setStep).not.toHaveBeenCalled();
    expect(emailInput).toHaveFocus();
    expect(emailInput).toHaveClass(
      "focus-visible:!ring-0",
      "focus-visible:!ring-offset-0",
    );
    expect(emailInput).not.toHaveClass("focus-visible:ring-warning");

    await user.type(emailInput, "x");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("exposes stable headless controls for the POS recovery path", () => {
    render(
      <LoginForm
        onUsePosRecoveryCode={vi.fn()}
        setStep={mocked.setStep}
      />,
    );

    expect(screen.getByTestId("athena-login-pos-sign-in")).toHaveAccessibleName(
      "POS sign in",
    );
  });

  it("names the POS recovery action for a provisioned local terminal", () => {
    render(
      <LoginForm
        onUsePosRecoveryCode={vi.fn()}
        setStep={mocked.setStep}
        terminalName="Front register"
      />,
    );

    expect(screen.getByTestId("athena-login-pos-sign-in")).toHaveAccessibleName(
      "Sign in to Front register",
    );
  });
});
