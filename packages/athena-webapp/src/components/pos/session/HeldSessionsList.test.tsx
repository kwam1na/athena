import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  it("renders an empty held-sales state", () => {
    render(
      <HeldSessionsList
        sessions={[]}
        onResumeSession={vi.fn()}
        onVoidSession={vi.fn()}
      />,
    );

    expect(screen.getByText("No held sales")).toBeInTheDocument();
  });

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

  it("renders customer, totals, hold reason, and action callbacks for held sales", async () => {
    const onResumeSession = vi.fn();
    const onVoidSession = vi.fn();

    render(
      <HeldSessionsList
        sessions={[
          {
            _id: "session-3" as never,
            cartItems: [
              {
                id: "item-1",
                name: "Body Wave",
                price: 125,
                quantity: 2,
              } as never,
            ],
            customer: {
              name: "Ama Serwa",
              email: "ama@example.com",
              phone: "555-0100",
            },
            expiresAt: Date.now() + 10_000,
            heldAt: Date.now(),
            holdReason: "Customer checking another item",
            sessionNumber: "SES-003",
            total: 12_500,
            updatedAt: Date.now(),
            workflowTraceId: "pos_session:ses-003",
          },
        ]}
        onResumeSession={onResumeSession}
        onVoidSession={onVoidSession}
      />,
    );

    expect(screen.getByText("Held sales")).toBeInTheDocument();
    expect(screen.getByText("SES-003")).toBeInTheDocument();
    expect(screen.getByText("Ama Serwa")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
    expect(screen.getByText("$125.00")).toBeInTheDocument();
    expect(
      screen.getByText('"Customer checking another item"'),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View trace" })).toBeInTheDocument();

    await userEvent.click(screen.getByTitle("Resume sale"));
    await userEvent.click(screen.getByTitle("Clear sale"));

    expect(onResumeSession).toHaveBeenCalledWith("session-3");
    expect(onVoidSession).toHaveBeenCalledWith("session-3");
  });

  it("marks expired held sales and disables resume without blocking clear", async () => {
    const onResumeSession = vi.fn();
    const onVoidSession = vi.fn();

    render(
      <HeldSessionsList
        sessions={[
          {
            _id: "session-4" as never,
            cartItems: [],
            expiresAt: Date.now() - 10_000,
            heldAt: Date.now() - 20_000,
            sessionNumber: "SES-004",
            updatedAt: Date.now() - 20_000,
          },
        ]}
        onResumeSession={onResumeSession}
        onVoidSession={onVoidSession}
      />,
    );

    expect(screen.getByText("Expired")).toBeInTheDocument();

    const resumeButton = screen.getByTitle("Resume sale");
    expect(resumeButton).toBeDisabled();

    await userEvent.click(resumeButton);
    await userEvent.click(screen.getByTitle("Clear sale"));

    expect(onResumeSession).not.toHaveBeenCalled();
    expect(onVoidSession).toHaveBeenCalledWith("session-4");
  });
});
