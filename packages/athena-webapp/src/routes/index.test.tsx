import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { Index } from "./-index-route-view";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: ReactNode;
    to: string;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe("Index route", () => {
  it("renders a public product entry with one clear navigation hierarchy", () => {
    render(<Index />);

    expect(
      screen.getByRole("heading", {
        name: /see how the business is doing today/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /request a walkthrough/i }),
    ).toHaveAttribute("href", "/walkthrough");
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/login",
    );

    const primaryNavigation = screen.getByRole("navigation", {
      name: /primary navigation/i,
    });
    expect(primaryNavigation.querySelectorAll("a")).toHaveLength(3);
  });
});
