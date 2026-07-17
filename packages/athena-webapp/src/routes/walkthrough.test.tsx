import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  it("uses the public shell without recounting its self-link as a landing CTA", async () => {
    const user = userEvent.setup();
    render(<WalkthroughPage />);

    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Show us what you need to see clearly." })).toBeVisible();
    expect(screen.getByRole("form", { name: "Walkthrough request" })).toBeVisible();
    expect(screen.getByRole("link", { name: "privacy and retention details" })).toBeVisible();

    await user.click(
      screen.getByRole("link", { name: "Request a walkthrough" }),
    );
    expect(mocked.emitLandingFunnelEvent).not.toHaveBeenCalledWith(
      "walkthrough_cta",
    );
  });
});
