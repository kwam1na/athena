import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ATHENA_POS_RECOVERY_CODE_PROVIDER_ID } from "../../../../shared/auth";
import { Login } from "./index";

const mocked = vi.hoisted(() => ({
  navigate: vi.fn(),
  signIn: vi.fn(),
  useSearch: vi.fn(),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mocked.signIn }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocked.navigate,
  useSearch: mocked.useSearch,
}));

describe("Login", () => {
  beforeEach(() => {
    mocked.navigate.mockReset();
    mocked.signIn.mockReset();
    mocked.useSearch.mockReset();
    window.sessionStorage.clear();
  });

  it("passes POS route scope from redirectTo into recovery-code sign-in", async () => {
    const user = userEvent.setup();
    mocked.signIn.mockResolvedValue({ signingIn: true });
    mocked.useSearch.mockReturnValue({
      redirectTo: "/wigclub/store/wigclub/pos/register",
    });

    render(<Login />);

    await user.click(
      screen.getByRole("button", { name: /use pos recovery code/i }),
    );
    await user.type(screen.getByLabelText(/recovery code/i), "abc-123");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(mocked.signIn).toHaveBeenCalledWith(
        ATHENA_POS_RECOVERY_CODE_PROVIDER_ID,
        {
          code: "abc-123",
          email: "pos@wigclub.store",
          orgUrlSlug: "wigclub",
          storeUrlSlug: "wigclub",
        },
      ),
    );
    expect(mocked.navigate).toHaveBeenCalledWith({
      to: "/wigclub/store/wigclub/pos/register",
    });
  });

  it("disables recovery-code submission when redirectTo is not a POS route", async () => {
    const user = userEvent.setup();
    mocked.useSearch.mockReturnValue({ redirectTo: "/login" });

    render(<Login />);

    await user.click(
      screen.getByRole("button", { name: /use pos recovery code/i }),
    );
    await user.type(screen.getByLabelText(/recovery code/i), "abc-123");

    expect(
      screen.getByText("Open recovery from the store login route."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    expect(mocked.signIn).not.toHaveBeenCalled();
  });
});
