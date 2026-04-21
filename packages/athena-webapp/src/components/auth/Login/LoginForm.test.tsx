import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "./LoginForm";

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

    await user.type(screen.getByPlaceholderText(/email/i), "Manager@Example.com");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(mocked.signIn).toHaveBeenCalledWith("resend-otp", {
        email: "manager@example.com",
      })
    );
    expect(mocked.setStep).toHaveBeenCalledWith({
      email: "manager@example.com",
    });
  });
});
