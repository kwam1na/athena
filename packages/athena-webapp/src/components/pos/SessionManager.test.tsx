import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SessionManager } from "./SessionManager";

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
  Badge: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../common/FadeIn", () => ({
  FadeIn: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./session/HeldSessionsList", () => ({
  HeldSessionsList: () => <div>held-sessions-list</div>,
}));

describe("SessionManager", () => {
  it("renders the active session controls when a session is present", () => {
    render(
      <SessionManager
        sessionPanel={{
          activeSessionNumber: "SES-001",
          activeSessionTraceId: "pos_session:ses-001",
          hasExpiredSession: false,
          canHoldSession: true,
          disableNewSession: false,
          heldSessions: [],
          onHoldCurrentSession: vi.fn(),
          onVoidCurrentSession: vi.fn(),
          onResumeSession: vi.fn(),
          onVoidHeldSession: vi.fn(),
          onStartNewSession: vi.fn(),
        }}
      />,
    );

    expect(
      screen.queryByText("SES-001"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hold/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /clear sale/i }),
    ).toBeInTheDocument();
  });

  it("does not render trace navigation when trace metadata is absent", () => {
    render(
      <SessionManager
        sessionPanel={{
          activeSessionNumber: "SES-001",
          activeSessionTraceId: null,
          hasExpiredSession: false,
          canHoldSession: true,
          disableNewSession: false,
          heldSessions: [],
          onHoldCurrentSession: vi.fn(),
          onVoidCurrentSession: vi.fn(),
          onResumeSession: vi.fn(),
          onVoidHeldSession: vi.fn(),
          onStartNewSession: vi.fn(),
        }}
      />,
    );

    expect(
      screen.queryByRole("link", { name: "View trace" }),
    ).not.toBeInTheDocument();
  });

  it("disables hold and new-sale actions from panel state", async () => {
    const onHoldCurrentSession = vi.fn();
    const onStartNewSession = vi.fn();

    render(
      <SessionManager
        sessionPanel={{
          activeSessionNumber: "SES-001",
          activeSessionTraceId: null,
          hasExpiredSession: false,
          canHoldSession: false,
          disableNewSession: true,
          heldSessions: [],
          onHoldCurrentSession,
          onVoidCurrentSession: vi.fn(),
          onResumeSession: vi.fn(),
          onVoidHeldSession: vi.fn(),
          onStartNewSession,
        }}
      />,
    );

    const holdButton = screen.getByRole("button", { name: /hold/i });
    const newSaleButton = screen.getByRole("button", { name: /new sale/i });

    expect(holdButton).toBeDisabled();
    expect(newSaleButton).toBeDisabled();

    await userEvent.click(holdButton);
    await userEvent.click(newSaleButton);

    expect(onHoldCurrentSession).not.toHaveBeenCalled();
    expect(onStartNewSession).not.toHaveBeenCalled();
  });

  it("keeps held-sale resume controls hidden when no held sessions exist", () => {
    render(
      <SessionManager
        sessionPanel={{
          activeSessionNumber: null,
          activeSessionTraceId: null,
          hasExpiredSession: false,
          canHoldSession: false,
          disableNewSession: false,
          heldSessions: [],
          onHoldCurrentSession: vi.fn(),
          onVoidCurrentSession: vi.fn(),
          onResumeSession: vi.fn(),
          onVoidHeldSession: vi.fn(),
          onStartNewSession: vi.fn(),
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: /hold/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /clear sale/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /resume sale/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new sale/i })).toBeInTheDocument();
  });
});
