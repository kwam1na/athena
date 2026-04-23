import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DefaultCatchBoundary } from "./DefaultCatchBoundary";

const mocked = vi.hoisted(() => ({
  invalidate: vi.fn(),
  useMatch: vi.fn(),
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
  useRouter: () => ({
    invalidate: mocked.invalidate,
  }),
}));

describe("DefaultCatchBoundary", () => {
  beforeEach(() => {
    mocked.invalidate.mockReset();
    mocked.useMatch.mockReset();
    mocked.useMatch.mockReturnValue(true);
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
