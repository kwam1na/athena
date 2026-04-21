import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InputOTPForm } from "./InputOTP";
import { LOGGED_IN_USER_ID_KEY } from "~/src/lib/constants";

const mocked = vi.hoisted(() => ({
  navigate: vi.fn(),
  signIn: vi.fn(),
  syncAuthenticatedAthenaUser: vi.fn(),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({
    signIn: mocked.signIn,
  }),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocked.syncAuthenticatedAthenaUser,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocked.navigate,
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
    mocked.navigate.mockReset();
    mocked.signIn.mockReset();
    mocked.syncAuthenticatedAthenaUser.mockReset();
  });

  it("signs in through Convex Auth and syncs the Athena user before navigating", async () => {
    const user = userEvent.setup();

    mocked.signIn.mockResolvedValue({ signingIn: true });
    mocked.syncAuthenticatedAthenaUser.mockResolvedValue({ _id: "user-1" });

    render(<InputOTPForm email=" Manager@Example.com " />);

    await user.type(screen.getByLabelText(/verification code/i), "123456");

    await waitFor(() =>
      expect(mocked.signIn).toHaveBeenCalledWith("resend-otp", {
        code: "123456",
        email: "manager@example.com",
      })
    );
    expect(mocked.syncAuthenticatedAthenaUser).toHaveBeenCalledWith({});
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      LOGGED_IN_USER_ID_KEY,
      "user-1"
    );
    expect(mocked.navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("surfaces non-verification sync failures to the operator", async () => {
    const user = userEvent.setup();

    mocked.signIn.mockResolvedValue({ signingIn: true });
    mocked.syncAuthenticatedAthenaUser.mockRejectedValue(
      new Error(
        "Multiple Athena users match this email. Resolve duplicate accounts before continuing."
      )
    );

    render(<InputOTPForm email="manager@example.com" />);

    await user.type(screen.getByLabelText(/verification code/i), "123456");

    await waitFor(() =>
      expect(
        screen.getByText(
          "Multiple Athena users match this email. Resolve duplicate accounts before continuing."
        )
      ).toBeInTheDocument()
    );
  });
});
