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
  it("tells the one-day story and funnels to the demo", async () => {
    const user = userEvent.setup();
    render(<Index />);

    expect(screen.getByRole("heading", {
      name: /one person\. a whole store\. fully in view\./i,
    })).toBeInTheDocument();

    // The five workspace acts, in day order, pinned to timestamps.
    expect(screen.getAllByText(/8:47 AM/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("heading", { name: /start ready, not scrambling/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /one place to stand while the day moves/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /sales don't wait for the internet/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /every sale lands twice/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /know what's in every drawer/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /close the day with a clear conscience/i })).toBeInTheDocument();

    // The automation reveal pays off the hero's objection.
    expect(screen.getByRole("heading", { name: /but i'm just one person/i })).toBeInTheDocument();
    expect(screen.getByText(/you were never running it alone/i)).toBeInTheDocument();

    // The traced sale reconciles across POS, the sync bridge, and the books.
    const saleAmounts = screen.getAllByText("GH₵385");
    expect(saleAmounts.length).toBeGreaterThanOrEqual(2);

    // Demo is the primary CTA (header, hero, closing band) and walkthrough is
    // demoted but present.
    const demoLinks = screen.getAllByRole("link", { name: /try the demo/i });
    expect(demoLinks).toHaveLength(3);
    for (const link of demoLinks) {
      expect(link).toHaveAttribute("href", "/demo");
    }
    const walkthroughLinks = screen.getAllByRole("link", {
      name: /request a walkthrough/i,
    });
    expect(walkthroughLinks.length).toBeGreaterThanOrEqual(1);
    expect(walkthroughLinks[0]).toHaveAttribute("href", "/walkthrough");
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/login",
    );

    expect(mocked.emitLandingFunnelEvent).toHaveBeenCalledWith("page_view");
    await user.click(demoLinks[0]);
    expect(mocked.emitLandingFunnelEvent).toHaveBeenCalledWith("demo_cta");
    await user.click(walkthroughLinks[0]);
    expect(mocked.emitLandingFunnelEvent).toHaveBeenCalledWith("walkthrough_cta");
  });

  it("renders the finished scene compositions without animation infrastructure", () => {
    // jsdom has no IntersectionObserver, matching the reduced-motion path:
    // scenes must show their final frames statically.
    render(<Index />);

    expect(screen.getByText(/opening handoff is complete\. the store day is ready to run\./i)).toBeInTheDocument();
    expect(screen.getByText(/sale completed · receipt #0041 · cash/i)).toBeInTheDocument();
    expect(screen.getByText(/offline — sales continue/i)).toBeInTheDocument();
    expect(screen.getAllByText(/pending sync/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/expected in drawer/i)).toBeInTheDocument();
    expect(screen.getByText(/athena completed eod review under store policy\./i)).toBeInTheDocument();
    expect(screen.getByText(/carried to tomorrow's opening/i)).toBeInTheDocument();
  });
});
