import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DefaultCatchBoundary } from "./DefaultCatchBoundary";
import { SHARED_DEMO_SESSION_EXPIRED_CODE } from "~/shared/sharedDemoActionError";
import {
  clearSharedDemoRenewalAttempts,
  countSharedDemoRenewalAttempts,
  MAX_SHARED_DEMO_RENEWAL_ATTEMPTS,
  recordSharedDemoRenewalAttempt,
} from "@/lib/errors/sharedDemoSessionExpired";

function expiredDemoError() {
  return Object.assign(
    new Error("[CONVEX Q(app:getCurrentUser)] Server Error"),
    { data: { code: SHARED_DEMO_SESSION_EXPIRED_CODE } },
  );
}

const mocked = vi.hoisted(() => ({
  invalidate: vi.fn(),
  issueTicket: vi.fn(),
  signIn: vi.fn(),
  useMatch: vi.fn(),
  useRouterState: vi.fn(),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mocked.signIn, signOut: vi.fn() }),
}));

vi.mock("convex/react", () => ({
  useAction: () => mocked.issueTicket,
}));

vi.mock("@tanstack/react-router", () => ({
  ErrorComponent: ({ error }: { error: Error }) => <div>{error.message}</div>,
  Link: ({
    children,
    onClick,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    to: string;
  }) => (
    <a href={to} onClick={onClick} {...props}>
      {children}
    </a>
  ),
  rootRouteId: "__root__",
  useMatch: mocked.useMatch,
  useRouterState: mocked.useRouterState,
  useRouter: () => ({
    invalidate: mocked.invalidate,
  }),
}));

describe("DefaultCatchBoundary", () => {
  beforeEach(() => {
    mocked.invalidate.mockReset();
    mocked.useMatch.mockReset();
    mocked.useMatch.mockReturnValue(true);
    mocked.useRouterState.mockImplementation(
      ({ select }: { select: (state: unknown) => unknown }) =>
        select({ location: { pathname: "/wigclub/store/wigclub/products" } }),
    );
    window.history.back = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocked.issueTicket.mockReset();
    mocked.signIn.mockReset();
    // Module-level counter state in sharedDemoSessionExpired.ts: without this,
    // a test that renews leaks its attempt into whatever runs next and routes
    // it down the capped branch for reasons it never asserts.
    clearSharedDemoRenewalAttempts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a generic recovery message without the raw error text", () => {
    render(
      <DefaultCatchBoundary
        error={new Error("upstream request timed out")}
        reset={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /please try again\. if the problem keeps happening, go back and retry the action\./i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/upstream request timed out/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /home/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("keeps public route recovery on the product page", () => {
    mocked.useRouterState.mockImplementation(
      ({ select }: { select: (state: unknown) => unknown }) =>
        select({ location: { pathname: "/landing" } }),
    );

    render(
      <DefaultCatchBoundary
        error={new Error("temporary public render failure")}
        reset={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute(
      "href",
      "/landing",
    );
  });

  it("keeps the retry action wired to router invalidation", () => {
    render(
      <DefaultCatchBoundary
        error={new Error("temporary transport failure")}
        reset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(mocked.invalidate).toHaveBeenCalledTimes(1);
  });

  it("reloads the app when a route module failed to load", () => {
    const reloadPage = vi.fn();

    render(
      <DefaultCatchBoundary
        error={
          new TypeError(
            "Failed to fetch dynamically imported module: http://localhost:5173/open-work.tsx?tsr-split=component",
          )
        }
        reloadPage={reloadPage}
        reset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reload app" }));

    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(mocked.invalidate).not.toHaveBeenCalled();
  });

  it("renews an expired demo session without asking for a click", async () => {
    mocked.issueTicket.mockResolvedValue({ ticket: "ticket-1" });
    mocked.signIn.mockResolvedValue(undefined);
    const reloadPage = vi.fn();
    mocked.useRouterState.mockImplementation(
      ({ select }: { select: (state: unknown) => unknown }) =>
        select({ location: { pathname: "/demo/store/central/pos" } }),
    );

    render(
      <DefaultCatchBoundary
        error={expiredDemoError()}
        reloadPage={reloadPage}
        reset={vi.fn()}
      />,
    );

    // A session ending is not a decision the visitor made, and the only route
    // back is the one they already took — so renewal starts on its own rather
    // than waiting behind a button. The manual link is still rendered beside
    // the spinner as the escape from a request that never settles, but nothing
    // requires the visitor to touch it.
    expect(
      screen.getByRole("heading", { name: "Starting a fresh demo session" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();

    await waitFor(() => expect(mocked.signIn).toHaveBeenCalledWith(
      "shared-demo",
      { ticket: "ticket-1" },
    ));
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));

    // The cap is only real if rendering the renewal is what counts against it.
    // Asserted here rather than by calling the recorder directly, so dropping
    // the call in the component fails a test instead of silently uncapping.
    expect(countSharedDemoRenewalAttempts()).toBe(1);
  });

  it("hands back the manual route when renewal itself fails", async () => {
    mocked.issueTicket.mockRejectedValue(new Error("no ticket"));
    mocked.useRouterState.mockImplementation(
      ({ select }: { select: (state: unknown) => unknown }) =>
        select({ location: { pathname: "/demo/store/central/pos" } }),
    );

    render(
      <DefaultCatchBoundary error={expiredDemoError()} reset={vi.fn()} />,
    );

    // Without this the visitor sits on the spinner forever: renewal is the
    // only thing running, and it has already given up.
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Your demo session ended" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("link", { name: "Open demo again" }),
    ).toHaveAttribute("href", "/demo");
  });

  it("falls back to the manual route once renewal has been tried enough", () => {
    for (let i = 0; i < MAX_SHARED_DEMO_RENEWAL_ATTEMPTS; i += 1) {
      recordSharedDemoRenewalAttempt();
    }
    mocked.useRouterState.mockImplementation(
      ({ select }: { select: (state: unknown) => unknown }) =>
        select({ location: { pathname: "/demo/store/central/pos" } }),
    );

    render(
      <DefaultCatchBoundary error={expiredDemoError()} reset={vi.fn()} />,
    );

    // Renewal that keeps landing back here must stop and hand over, rather
    // than reload forever behind a spinner.
    expect(
      screen.getByRole("heading", { name: "Your demo session ended" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open demo again" }),
    ).toHaveAttribute("href", "/demo");
    // "Try again" calls router.invalidate() against queries that are certain
    // to fail again; offering it here bounces the visitor on a dead button
    // instead of the one route that works.
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the non-root recovery link wired to browser back navigation", () => {
    mocked.useMatch.mockReturnValue(false);

    render(
      <DefaultCatchBoundary
        error={new Error("temporary transport failure")}
        reset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: /go back/i }));

    expect(window.history.back).toHaveBeenCalledTimes(1);
  });
});
