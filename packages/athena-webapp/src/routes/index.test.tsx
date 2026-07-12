import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { Index } from "./-index-route-view";

const mocked = vi.hoisted(() => ({
  emitLandingFunnelEvent: vi.fn(),
}));

vi.mock("@/lib/marketing/landingFunnelClient", () => ({
  emitLandingFunnelEvent: mocked.emitLandingFunnelEvent,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    onClick,
    to,
    ...props
  }: {
    children: ReactNode;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
    to: string;
  }) => (
    <a
      href={to}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

describe("Index route", () => {
  it("renders a public product entry with one clear navigation hierarchy", async () => {
    const user = userEvent.setup();
    render(<Index />);

    expect(
      screen.getByRole("heading", {
        name: /see how the business is doing today/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /request a walkthrough/i }),
    ).toHaveAttribute("href", "/walkthrough");
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/login",
    );

    const primaryNavigation = screen.getByRole("navigation", {
      name: /primary navigation/i,
    });
    expect(primaryNavigation.querySelectorAll("a")).toHaveLength(3);

    await user.click(
      screen.getByRole("link", { name: /request a walkthrough/i }),
    );
    expect(mocked.emitLandingFunnelEvent).toHaveBeenCalledWith(
      "walkthrough_cta",
    );
  });
});
