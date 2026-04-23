import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GENERIC_UNEXPECTED_ERROR_MESSAGE } from "~/shared/commandResult";

import { JoinTeam } from "./index";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  redeemCode: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.redeemCode,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & { children: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
  },
}));

describe("JoinTeam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collapses thrown invite redemption faults to the shared fallback copy", async () => {
    mocks.redeemCode.mockRejectedValue(
      new Error("[CONVEX] raw backend details that should never be toasted"),
    );

    const user = userEvent.setup();

    render(<JoinTeam />);

    await user.type(screen.getByPlaceholderText(/email/i), "ama@example.com");
    await user.type(screen.getByPlaceholderText("XXXXXX"), "ABC123");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("An error occurred", {
        description: GENERIC_UNEXPECTED_ERROR_MESSAGE,
      }),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        description: expect.stringContaining("raw backend details"),
      }),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
