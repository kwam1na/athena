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
window.ResizeObserver =
  window.ResizeObserver ??
  (ResizeObserverStub as unknown as typeof ResizeObserver);

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

    expect(
      screen.getByRole("heading", {
        name: /the day runs itself\. you see all of it — from anywhere\./i,
      }),
    ).toBeInTheDocument();

    // The five workspace acts, in day order, pinned to timestamps.
    expect(screen.getAllByText(/9:34 AM/).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole("heading", {
        name: /today opens where yesterday closed/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /the whole day's pulse, in one read/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /network drops\. sales don't\./i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /the books keep themselves/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /know what's in every drawer/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /today closes where tomorrow begins/i,
      }),
    ).toBeInTheDocument();

    // The automation reveal pays off the hero's objection.
    expect(
      screen.getByRole("heading", { name: /the day didn't run itself/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/athena did\. it started the opening/i),
    ).toBeInTheDocument();

    // The traced sale reconciles across the receipt, the traveling chip, and
    // the drawer's expected-cash delta.
    const saleAmounts = screen.getAllByText(/GH₵385/);
    expect(saleAmounts.length).toBeGreaterThanOrEqual(2);

    // Demo is the sole CTA (header, hero, closing band); the walkthrough and
    // sign-in links have been removed from the marketing page. The header
    // labels it "Try the demo"; the hero and closing band say "Demo Athena".
    const demoLinks = screen.getAllByRole("link", { name: /demo/i });
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

    // Captured workspace shots for the acts that used to be live scenes.
    expect(
      screen.getByAltText(/opening handoff workspace/i),
    ).toBeInTheDocument();
    expect(
      screen.getByAltText(/daily operations workspace:/i),
    ).toBeInTheDocument();
    expect(screen.getByAltText(/pending sync/i)).toBeInTheDocument();
    expect(screen.getByAltText(/'synced'/i)).toBeInTheDocument();
    expect(screen.getByAltText(/eod review workspace/i)).toBeInTheDocument();

    // Sync bridge: the traced sale travels from the register into the books.
    expect(screen.getByText(/receipt #1154/i)).toBeInTheDocument();
    expect(screen.getAllByText(/pending sync/i).length).toBeGreaterThanOrEqual(
      1,
    );
    // Real RegisterSessionActivitySection exhibit (sync bridge).
    expect(
      screen.getAllByText(/expected in drawer/i).length,
    ).toBeGreaterThanOrEqual(1);

    // Cash Controls: the real dashboard shows the story day's drawer.
    expect(
      screen.getAllByText(/expected in drawers/i).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("GH₵-5").length).toBeGreaterThanOrEqual(1);

    // The automation reveal replays the day's moments.
    expect(
      screen.getByText(/every decision stayed with the owner/i),
    ).toBeInTheDocument();
  });
});
