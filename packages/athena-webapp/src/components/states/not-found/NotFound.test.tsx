import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import NotFound from "./NotFound";

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

describe("NotFound", () => {
  it("returns authenticated not-found states to the app entry by default", () => {
    render(<NotFound entity="product" entityIdentifier="missing" />);

    expect(screen.getByRole("link", { name: /take me home/i })).toHaveAttribute(
      "href",
      "/app",
    );
  });

  it("allows the public shell to recover to the product page", () => {
    render(
      <NotFound entity="page" entityIdentifier="provided" homePath="/" />,
    );

    expect(screen.getByRole("link", { name: /take me home/i })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
