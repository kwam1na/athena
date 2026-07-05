import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "./LoginForm";
import { ATHENA_EMAIL_OTP_PROVIDER_ID } from "../../../../shared/auth";

const mocked = vi.hoisted(() => ({
  setStep: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({
    signIn: mocked.signIn,
  }),
}));

describe("LoginForm", () => {
  beforeEach(() => {
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

    await user.type(emailInput, "Manager@Example.com");
    await user.click(continueButton);

    await waitFor(() =>
      expect(mocked.signIn).toHaveBeenCalledWith(ATHENA_EMAIL_OTP_PROVIDER_ID, {
        email: "manager@example.com",
      })
    );
    expect(mocked.setStep).toHaveBeenCalledWith({
      email: "manager@example.com",
    });
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
});
