import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DefaultCatchBoundary } from "./DefaultCatchBoundary";

const mocked = vi.hoisted(() => ({
  invalidate: vi.fn(),
  useMatch: vi.fn(),
  useRouterState: vi.fn(),
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

  it.each([
    "The demo session has expired. Open the demo again.",
    "The shared demo session has expired. Open the demo again.",
  ])("offers seamless demo re-entry for an expired demo session", (message) => {
    mocked.useRouterState.mockImplementation(
      ({ select }: { select: (state: unknown) => unknown }) =>
        select({
          location: {
            pathname: "/demo/store/central/pos",
          },
        }),
    );

    render(
      <DefaultCatchBoundary
        error={new Error(`[CONVEX Q(inventory/pos:getTodaySummary)] ${message}`)}
        reset={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Your demo session ended" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Open the demo again to start a fresh session and continue exploring Athena.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open demo again" })).toHaveAttribute(
      "href",
      "/demo",
    );
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
