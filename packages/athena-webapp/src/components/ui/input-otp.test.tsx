import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InputOTP, InputOTPGroup, InputOTPSlot } from "./input-otp";

describe("InputOTP", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("exposes automation attributes on the real fillable OTP input", () => {
    render(
      <InputOTP
        maxLength={6}
        aria-label="One-time code"
        autoComplete="one-time-code"
        data-testid="athena-login-otp-input"
        inputMode="numeric"
        name="pin"
        pattern="[0-9]*"
        value=""
        onChange={() => {}}
      >
        <InputOTPGroup>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <InputOTPSlot key={index} index={index} />
          ))}
        </InputOTPGroup>
      </InputOTP>,
    );

    const otpInput = screen.getByTestId("athena-login-otp-input");

    expect(otpInput).toHaveAccessibleName("One-time code");
    expect(otpInput).toHaveAttribute("name", "pin");
    expect(otpInput).toHaveAttribute("autocomplete", "one-time-code");
    expect(otpInput).toHaveAttribute("inputmode", "numeric");
  });
});
