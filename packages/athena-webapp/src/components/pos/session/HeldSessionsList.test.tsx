import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HeldSessionsList } from "./HeldSessionsList";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params: _params,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    params?: unknown;
    to?: string;
  }) => (
    <a href={to ?? "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("~/src/hooks/useGetCurrencyFormatter", () => ({
  useGetCurrencyFormatter: () =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
}));

describe("HeldSessionsList", () => {
  it("renders a held-session trace link when the workflow trace id is present", () => {
    render(
      <HeldSessionsList
        sessions={[
          {
            _id: "session-1" as never,
            cartItems: [],
            expiresAt: Date.now() + 10_000,
            heldAt: Date.now(),
            sessionNumber: "SES-001",
            updatedAt: Date.now(),
            workflowTraceId: "pos_session:ses-001",
          },
        ]}
        onResumeSession={vi.fn()}
        onVoidSession={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "View trace" })).toBeInTheDocument();
  });

  it("hides the held-session trace link when trace metadata is absent", () => {
    render(
      <HeldSessionsList
        sessions={[
          {
            _id: "session-2" as never,
            cartItems: [],
            expiresAt: Date.now() + 10_000,
            heldAt: Date.now(),
            sessionNumber: "SES-002",
            updatedAt: Date.now(),
          },
        ]}
        onResumeSession={vi.fn()}
        onVoidSession={vi.fn()}
      />,
    );

    expect(screen.queryByRole("link", { name: "View trace" })).not.toBeInTheDocument();
  });
});
