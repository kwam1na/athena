import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SharedDemoEntry } from "./-shared-demo-entry";
import { getSharedDemoEntryPresentation } from "./-demo-presentation";

const mocked = vi.hoisted(() => ({
  issueTicket: vi.fn(),
  navigate: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  sharedDemoContext: null as null | undefined | { storeId: string },
  useAuth: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  useNavigate: () => mocked.navigate,
}));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signIn: mocked.signIn, signOut: mocked.signOut }) }));
vi.mock("convex/react", () => ({
  useAction: () => mocked.issueTicket,
  useQuery: (...args: unknown[]) => mocked.useQuery(...args),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mocked.useAuth() }));
vi.mock("@/hooks/useSharedDemoContext", () => ({
  isSharedDemoUiEnabled: true,
  useSharedDemoContext: () => mocked.sharedDemoContext,
}));

describe("SharedDemoEntry", () => {
  beforeEach(() => {
    Object.values(mocked).forEach((mock) => {
      if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
    });
    mocked.useAuth.mockReturnValue({ isLoading: false, user: null });
    mocked.sharedDemoContext = null;
    mocked.signOut.mockResolvedValue(undefined);
  });

  it("waits for demo authority before navigating a previously signed-in user", async () => {
    mocked.useAuth.mockReturnValue({
      isLoading: false,
      user: { _id: "normal-user" },
    });
    mocked.useQuery
      .mockReturnValueOnce([{ _id: "normal-org", slug: "normal-org" }])
      .mockReturnValueOnce([{ _id: "normal-store", slug: "normal-store" }]);
    mocked.issueTicket.mockResolvedValue({
      expiresAt: Date.now() + 60_000,
      ticket: "demo-ticket",
    });
    mocked.signIn.mockResolvedValue(undefined);

    render(<SharedDemoEntry />);

    await waitFor(() => expect(mocked.signOut).toHaveBeenCalled());
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("exchanges an opaque ticket without rendering or persisting it", async () => {
    mocked.issueTicket.mockResolvedValue({ ticket: "opaque-secret", expiresAt: Date.now() + 60_000 });
    mocked.signIn.mockResolvedValue(undefined);
    render(<SharedDemoEntry />);

    await waitFor(() => expect(mocked.signIn).toHaveBeenCalledWith("shared-demo", { ticket: "opaque-secret" }));
    expect(mocked.signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("opaque-secret")).not.toBeInTheDocument();
    expect(window.localStorage.setItem).not.toHaveBeenCalledWith(expect.anything(), "opaque-secret");
  });

  it("shows a calm retry state when admission is unavailable", async () => {
    mocked.issueTicket.mockRejectedValue(new Error("raw backend detail"));
    render(<SharedDemoEntry />);
    expect(await screen.findByText("The demo is not available right now.")).toBeInTheDocument();
    expect(screen.queryByText("raw backend detail")).not.toBeInTheDocument();

    mocked.issueTicket.mockResolvedValue({ ticket: "next-ticket", expiresAt: Date.now() + 60_000 });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocked.issueTicket).toHaveBeenCalledTimes(2));
  });

  it("describes the permanent environment boundary without promising a retry", () => {
    expect(
      getSharedDemoEntryPresentation({ enabled: false, failed: false }),
    ).toEqual({
      detail: "Open the demo from an approved development or QA environment.",
      title: "The demo is not available here.",
    });
  });
});
