import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forwardRef } from "react";

import { InputOTPForm } from "./InputOTP";
import { PENDING_ATHENA_AUTH_SYNC_KEY } from "~/src/lib/constants";
import { ATHENA_EMAIL_OTP_PROVIDER_ID } from "../../../../shared/auth";

const mocked = vi.hoisted(() => ({
  signIn: vi.fn(),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({
    signIn: mocked.signIn,
  }),
}));

vi.mock("@/components/ui/input-otp", () => ({
  InputOTP: forwardRef<HTMLInputElement, any>((props, ref) => (
    <input
      aria-label="Verification code"
      ref={ref}
      onChange={(event) => props.onChange?.(event.target.value)}
      value={props.value ?? ""}
    />
  )),
  InputOTPGroup: ({ children }: any) => <div>{children}</div>,
  InputOTPSlot: () => null,
}));

describe("InputOTPForm", () => {
  beforeEach(() => {
    mocked.signIn.mockReset();
    window.sessionStorage.clear();
  });

  it("records that the Athena-user sync should finish after Convex Auth signs in", async () => {
    const user = userEvent.setup();

    mocked.signIn.mockResolvedValue({ signingIn: true });

    render(
      <InputOTPForm email=" Manager@Example.com " onBack={vi.fn()} />
    );

    await user.type(screen.getByLabelText(/verification code/i), "123456");

    await waitFor(() =>
      expect(mocked.signIn).toHaveBeenCalledWith(ATHENA_EMAIL_OTP_PROVIDER_ID, {
        code: "123456",
        email: "manager@example.com",
      })
    );
    expect(window.sessionStorage.setItem).toHaveBeenCalledWith(
      PENDING_ATHENA_AUTH_SYNC_KEY,
      "1"
    );
  });

  it("surfaces invalid verification codes to the operator", async () => {
    const user = userEvent.setup();

    mocked.signIn.mockResolvedValue({ signingIn: false });

    render(
      <InputOTPForm email="manager@example.com" onBack={vi.fn()} />
    );

    await user.type(screen.getByLabelText(/verification code/i), "123456");

    await waitFor(() =>
      expect(screen.getByText("Invalid code entered")).toBeInTheDocument()
    );
  });

  it("lets the operator return to the email step", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();

    render(
      <InputOTPForm email="manager@example.com" onBack={onBack} />
    );

    await user.click(screen.getByRole("button", { name: /change email/i }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("requests a fresh code for the same email after the resend delay", async () => {
    const user = userEvent.setup();

    mocked.signIn.mockResolvedValue({});

    render(
      <InputOTPForm
        email=" Manager@Example.com "
        onBack={vi.fn()}
        requestNewCodeDelaySeconds={0}
      />
    );

    await user.click(
      screen.getByRole("button", { name: /request a new code/i })
    );

    await waitFor(() =>
      expect(mocked.signIn).toHaveBeenCalledWith(ATHENA_EMAIL_OTP_PROVIDER_ID, {
        email: "manager@example.com",
      })
    );
    expect(screen.getByText(/request a new code/i)).toBeInTheDocument();
  });
});
