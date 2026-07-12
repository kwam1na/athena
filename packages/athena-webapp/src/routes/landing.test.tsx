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
  Link: ({ children, onClick, to, ...props }: {
    children: ReactNode;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
    to: string;
  }) => (
    <a href={to} onClick={(event) => {
      event.preventDefault();
      onClick?.(event);
    }} {...props}>
      {children}
    </a>
  ),
}));

describe("landing route", () => {
  it("renders the public product entry at its dedicated route", async () => {
    const user = userEvent.setup();
    render(<Index />);

    expect(screen.getByRole("heading", {
      name: /see today's sales\. know what needs attention\./i,
    })).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      name: /today is only the beginning/i,
    })).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      name: /see which products shaped the day/i,
    })).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      name: /decide what needs your attention next/i,
    })).toBeInTheDocument();
    expect(screen.getByText(/in-person and online sales stay connected/i)).toBeInTheDocument();
    expect(screen.getByText(/give your team room to work/i)).toBeInTheDocument();

    const walkthroughLinks = screen.getAllByRole("link", {
      name: /request a walkthrough/i,
    });
    expect(walkthroughLinks).toHaveLength(3);
    expect(walkthroughLinks[0]).toHaveAttribute("href", "/walkthrough");
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/login",
    );

    await user.click(walkthroughLinks[0]);
    expect(mocked.emitLandingFunnelEvent).toHaveBeenCalledWith("walkthrough_cta");
  });
});
