import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";

import { ServiceIntakeView } from "./ServiceIntakeView";

const mockedHooks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useMutation: vi.fn(),
  useProtectedAdminPageState: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: mockedHooks.useMutation,
  useQuery: mockedHooks.useQuery,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: mockedHooks.useAuth,
}));

vi.mock("@/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: mockedHooks.useProtectedAdminPageState,
}));

const mockedToast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: mockedToast,
}));

const readyProtectedState = {
  activeStore: { _id: "store-1" as Id<"store"> },
  canQueryProtectedData: true,
  hasFullAdminAccess: true,
  isAuthenticated: true,
  isLoadingAccess: false,
};

async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  option: RegExp
) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("ServiceIntakeView auth readiness", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.clearAllMocks();
    mockedHooks.useAuth.mockReturnValue({
      isLoading: false,
      user: { _id: "user-1" as Id<"athenaUser"> },
    });
    mockedHooks.useProtectedAdminPageState.mockReturnValue(readyProtectedState);
    mockedHooks.useMutation.mockReturnValue(vi.fn());
    mockedHooks.useQuery.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips protected queries while protected auth is still loading", () => {
    mockedHooks.useProtectedAdminPageState.mockReturnValue({
      ...readyProtectedState,
      canQueryProtectedData: false,
      isAuthenticated: false,
      isLoadingAccess: true,
    });

    const { container } = render(<ServiceIntakeView />);

    expect(container).toBeEmptyDOMElement();
    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
      "skip",
    ]);
  });

  it("renders a sign-in fallback instead of subscribing when Convex auth is missing", () => {
    mockedHooks.useProtectedAdminPageState.mockReturnValue({
      ...readyProtectedState,
      canQueryProtectedData: false,
      isAuthenticated: false,
    });

    render(<ServiceIntakeView />);

    expect(screen.getByText("Sign in required")).toBeInTheDocument();
    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
      "skip",
    ]);
  });

  it("subscribes to protected service intake data once the shared admin gate is ready", () => {
    mockedHooks.useQuery
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);

    render(<ServiceIntakeView />);

    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
      { storeId: "store-1" },
    ]);
  });

  it("shows generic inline fallback copy when the mutation throws unexpectedly", async () => {
    const user = userEvent.setup();

    mockedHooks.useMutation.mockReturnValue(
      vi.fn().mockRejectedValue(new Error("[CONVEX] leaked server details trace=abc123")),
    );
    mockedHooks.useQuery.mockImplementation((_, args) => {
      if (args === "skip") {
        return undefined;
      }

      return [
        {
          _id: "staff-1",
          fullName: "Adjoa Tetteh",
          phoneNumber: "+233200000000",
          roles: ["stylist"],
        },
      ];
    });

    render(<ServiceIntakeView />);

    await user.type(screen.getByLabelText(/customer name/i), "Ama Mensah");
    await user.type(
      screen.getByLabelText(/service title/i),
      "Wash and restyle closure wig",
    );
    await chooseSelectOption(user, /assigned staff/i, /adjoa tetteh/i);

    await user.click(screen.getByRole("button", { name: /create intake/i }));

    await waitFor(() =>
      expect(screen.getByText("Please try again.")).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/\[CONVEX\] leaked server details/i),
    ).not.toBeInTheDocument();
    expect(mockedToast.error).not.toHaveBeenCalled();
    expect(mockedToast.success).not.toHaveBeenCalled();
  });
});
