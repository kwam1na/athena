import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  InputOTP: (props: any) => (
    <input
      aria-label="Verification code"
      onChange={(event) => props.onChange?.(event.target.value)}
      value={props.value ?? ""}
    />
  ),
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

    render(<InputOTPForm email=" Manager@Example.com " />);

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

    render(<InputOTPForm email="manager@example.com" />);

    await user.type(screen.getByLabelText(/verification code/i), "123456");

    await waitFor(() =>
      expect(screen.getByText("Invalid code entered")).toBeInTheDocument()
    );
  });
});
