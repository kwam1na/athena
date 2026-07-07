import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InputOTPForm } from "./InputOTP";
import { ATHENA_EMAIL_OTP_PROVIDER_ID } from "../../../../shared/auth";

const mocked = vi.hoisted(() => ({
  signIn: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({
    signIn: mocked.signIn,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocked.navigate,
}));

vi.mock("@/components/ui/input-otp", () => ({
  InputOTP: forwardRef<
    HTMLInputElement,
    InputHTMLAttributes<HTMLInputElement> & {
      children?: ReactNode;
      onChange?: (value: string) => void;
      pasteTransformer?: (value: string) => string;
    }
  >(({ children: _children, onChange, pasteTransformer: _paste, ...props }, ref) => (
    <>
      {void _children}
      {void _paste}
      <input
        {...props}
        ref={ref}
        onChange={(event) => onChange?.(event.currentTarget.value)}
      />
    </>
  )),
  InputOTPGroup: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  InputOTPSlot: () => <span />,
}));

describe("InputOTPForm headless control", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    mocked.signIn.mockReset();
    mocked.navigate.mockReset();
    window.sessionStorage.clear();
  });

  it("exposes a stable, accessible OTP input that can be filled by headless automation", async () => {
    mocked.signIn.mockResolvedValue({ signingIn: true });

    render(<InputOTPForm email="Manager@Example.com" onBack={vi.fn()} />);

    const otpInput = screen.getByTestId("athena-login-otp-input");

    expect(otpInput).toHaveAccessibleName("One-time code");
    expect(otpInput).toHaveAttribute("name", "pin");
    expect(otpInput).toHaveAttribute("autocomplete", "one-time-code");
    expect(otpInput).toHaveAttribute("inputmode", "numeric");

    fireEvent.change(otpInput, { target: { value: "123456" } });

    await waitFor(() =>
      expect(mocked.signIn).toHaveBeenCalledWith(ATHENA_EMAIL_OTP_PROVIDER_ID, {
        code: "123456",
        email: "manager@example.com",
      }),
    );
  });

  it("exposes stable controls for OTP actions", () => {
    render(
      <InputOTPForm
        email="manager@example.com"
        onBack={vi.fn()}
        requestNewCodeDelaySeconds={0}
      />,
    );

    expect(screen.getByTestId("athena-login-change-email")).toHaveAccessibleName(
      /change email/i,
    );
    expect(screen.getByTestId("athena-login-otp-submit")).toHaveAccessibleName(
      /continue/i,
    );
    expect(screen.getByTestId("athena-login-request-code")).toHaveAccessibleName(
      /request a new code/i,
    );
  });
});
