import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AppHeader } from "./Navbar";

const mocked = vi.hoisted(() => ({
  useGetOrganizations: vi.fn(() => []),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    to,
  }: {
    children: ReactNode;
    className?: string;
    to: string;
  }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/useGetOrganizations", () => ({
  useGetOrganizations: mocked.useGetOrganizations,
}));

vi.mock("./organization-switcher", () => ({
  default: ({ className }: { className?: string }) => (
    <button className={className} data-testid="organization-switcher">
      Wigclub
    </button>
  ),
}));

describe("AppHeader", () => {
  it("lets the brand yield to the store switcher on narrow mobile headers", () => {
    render(<AppHeader />);

    expect(screen.getByRole("link", { name: "athena" })).toHaveClass(
      "hidden",
      "min-[430px]:flex",
      "shrink-0",
    );
    expect(screen.getByLabelText("Development environment")).toHaveClass(
      "border-action-workflow-border",
      "bg-action-workflow-soft",
      "text-action-workflow",
    );
    expect(screen.getByTestId("organization-switcher")).toHaveClass(
      "max-w-[10.75rem]",
      "min-[430px]:max-w-[14rem]",
    );
  });
});
