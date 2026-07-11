import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ to, children, ...props }: React.ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

import { WalkthroughPage } from "./walkthrough";

describe("walkthrough route", () => {
  it("uses the public shell and presents one accessible request form", () => {
    render(<WalkthroughPage />);

    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Show us what you need to see clearly." })).toBeVisible();
    expect(screen.getByRole("form", { name: "Walkthrough request" })).toBeVisible();
    expect(screen.getByRole("link", { name: "privacy and retention details" })).toBeVisible();
  });
});
