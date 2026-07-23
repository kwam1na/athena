import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  emitLandingFunnelEvent: vi.fn(),
}));

vi.mock("@/lib/marketing/landingFunnelClient", () => ({
  emitLandingFunnelEvent: mocked.emitLandingFunnelEvent,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ to, children, onClick, ...props }: React.ComponentProps<"a"> & { to: string }) => (
    <a href={to} onClick={(event) => {
      event.preventDefault();
      onClick?.(event);
    }} {...props}>{children}</a>
  ),
}));

import { WalkthroughPage } from "./-walkthrough-page";

describe("walkthrough route", () => {
  it("uses the public shell with the theme switcher in place of the self-link and sign-in", () => {
    render(<WalkthroughPage />);

    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Tell us what you need to see clearly." })).toBeVisible();
    expect(screen.getByRole("form", { name: "Register interest" })).toBeVisible();
    expect(screen.getByRole("link", { name: "privacy and retention details" })).toBeVisible();

    // The nav drops its own register-interest and sign-in links here and shows
    // the theme switcher instead; the demo remains the only nav CTA.
    expect(
      screen.getByRole("button", { name: /switch to (light|dark) theme/i }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Register interest" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Sign in" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try the demo" })).toBeVisible();
  });
});
