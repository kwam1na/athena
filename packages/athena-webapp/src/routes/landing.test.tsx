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

// The POS cart exhibit resolves the store currency through this hook; on the
// public landing page there is no active store and it falls back to GHS.
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: null, isLoadingStores: false }),
  useGetStores: () => undefined,
}));

// The embedded read-only report renders a back button whose hook walks the
// auth/org chain; the landing page never navigates back from an exhibit.
vi.mock("@/hooks/use-navigate-back", () => ({
  useNavigateBack: () => () => undefined,
}));

// jsdom lacks ResizeObserver; the embedded store-pulse chart needs it.
class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}
window.ResizeObserver = window.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

// jsdom has no matchMedia; the embedded workspace components use it for
// responsive variants.
Object.defineProperty(window, "matchMedia", {
  value: (query: string) => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  }),
  writable: true,
});

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
  useLocation: () => ({ pathname: "/landing" }),
  useNavigate: () => () => undefined,
  useParams: () => ({}),
  useRouter: () => ({ history: { back: () => undefined } }),
  useSearch: () => ({}),
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

    // Demo is the sole CTA (header, hero, closing band); the walkthrough and
    // sign-in links have been removed from the marketing page.
    const demoLinks = screen.getAllByRole("link", { name: /try the demo/i });
    expect(demoLinks).toHaveLength(3);
    for (const link of demoLinks) {
      expect(link).toHaveAttribute("href", "/demo");
    }
    expect(
      screen.queryByRole("link", { name: /request a walkthrough/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /sign in/i }),
    ).not.toBeInTheDocument();

    expect(mocked.emitLandingFunnelEvent).toHaveBeenCalledWith("page_view");
    await user.click(demoLinks[0]);
    expect(mocked.emitLandingFunnelEvent).toHaveBeenCalledWith("demo_cta");
  });

  it("renders the finished scene compositions without animation infrastructure", () => {
    // jsdom has no IntersectionObserver, matching the reduced-motion path:
    // scenes must show their final frames statically — including the real
    // workspace components rendered from fixture data.
    render(<Index />);

    expect(screen.getByText(/opening handoff is complete\. the store day is ready to run\./i)).toBeInTheDocument();
    expect(screen.getByText(/sale completed · receipt #0041 · cash/i)).toBeInTheDocument();
    expect(screen.getByText(/offline — sales continue/i)).toBeInTheDocument();
    expect(screen.getAllByText(/pending sync/i).length).toBeGreaterThanOrEqual(1);
    // Real StorePulseSummaryView exhibit (Daily Operations).
    expect(screen.getByText(/top items so far/i)).toBeInTheDocument();
    expect(screen.getAllByText(/how customers paid/i).length).toBeGreaterThanOrEqual(1);
    // Real RegisterSessionActivitySection exhibit (sync bridge).
    expect(screen.getAllByText(/expected in drawer/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/carried to tomorrow's opening handoff/i)).toBeInTheDocument();
  });
});
