import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SharedDemoEntry } from "./demo";
import { getSharedDemoEntryPresentation } from "./demoPresentation";

const mocked = vi.hoisted(() => ({
  issueTicket: vi.fn(),
  navigate: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
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

describe("SharedDemoEntry", () => {
  beforeEach(() => {
    Object.values(mocked).forEach((mock) => mock.mockReset());
    mocked.useAuth.mockReturnValue({ isLoading: false, user: null });
    mocked.signOut.mockResolvedValue(undefined);
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
    expect(await screen.findByText("The shared demo is not available right now.")).toBeInTheDocument();
    expect(screen.queryByText("raw backend detail")).not.toBeInTheDocument();

    mocked.issueTicket.mockResolvedValue({ ticket: "next-ticket", expiresAt: Date.now() + 60_000 });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocked.issueTicket).toHaveBeenCalledTimes(2));
  });

  it("describes the permanent environment boundary without promising a retry", () => {
    expect(
      getSharedDemoEntryPresentation({ enabled: false, failed: false }),
    ).toEqual({
      detail: "Open the shared demo from an approved development or QA environment.",
      title: "The shared demo is not available here.",
    });
  });
});
