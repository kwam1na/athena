import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";

import { SharedDemoOwnerHome } from "./SharedDemoOwnerHome";
import { SharedDemoStatusBar } from "./SharedDemoStatusBar";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a data-router-link="true" href={to} {...props} />
  ),
}));

const routes = {
  cash: "/demo-org/store/demo-store/cash-controls",
  inventory: "/demo-org/store/demo-store/operations/stock-adjustments",
  operations: "/demo-org/store/demo-store/operations",
  orders: "/demo-org/store/demo-store/orders/ready",
  pos: "/demo-org/store/demo-store/pos",
};

describe("SharedDemoOwnerHome", () => {
  it("orients an owner across the exposed Athena routes without presenting staff messages", () => {
    render(<SharedDemoOwnerHome routes={routes} />);

    expect(
      screen.getByRole("heading", { name: "Run Osu Studio" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Changes reset at the start of every hour."),
    ).toBeInTheDocument();
    expect(screen.getByText("Register open")).toBeInTheDocument();
    expect(screen.getByText("Pickup ready")).toBeInTheDocument();
    expect(screen.getByText("Work to review")).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(5);
    links.forEach((link) =>
      expect(link).toHaveAttribute("data-router-link", "true"),
    );
    expect(screen.getByRole("link", { name: /Make a sale/ })).toHaveAttribute(
      "href",
      routes.pos,
    );
    expect(screen.getByRole("link", { name: /Review stock/ })).toHaveAttribute(
      "href",
      routes.inventory,
    );
    expect(screen.getByRole("link", { name: /Manage cash/ })).toHaveAttribute(
      "href",
      routes.cash,
    );
    expect(
      screen.getByRole("link", { name: /Fulfill an order/ }),
    ).toHaveAttribute("href", routes.orders);
    expect(
      screen.queryByRole("link", { name: /Coordinate the team/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review today/ })).toHaveAttribute(
      "href",
      routes.operations,
    );
    expect(
      screen.getByRole("link", {
        name: /See the store day and outstanding work/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/reports are read-only in the demo/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Open Reports/ }),
    ).not.toBeInTheDocument();
  });
});

describe("SharedDemoStatusBar", () => {
  it("keeps owner home available without repeating reset guidance there", () => {
    render(
      <SharedDemoStatusBar
        currentPathname="/demo-home/"
        homeHref="/demo-home"
      />,
    );

    expect(screen.getByRole("link", { name: "Owner home" })).toHaveAttribute(
      "aria-label",
      "Owner home",
    );
    expect(screen.getByRole("link", { name: "Owner home" })).toHaveAttribute(
      "data-router-link",
      "true",
    );
    expect(screen.getByRole("link", { name: "Exit demo" })).toHaveAttribute(
      "href",
      "/landing",
    );
    expect(
      screen.queryByRole("button", { name: "Open demo guide" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Restore demo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Demo resets at the start of every hour"),
    ).not.toBeInTheDocument();
  });

  it("shows reset guidance beside owner home in other demo workspaces", () => {
    render(
      <SharedDemoStatusBar
        currentPathname="/demo-home/cash-controls"
        homeHref="/demo-home"
      />,
    );

    expect(
      screen.getByText("Demo resets at the start of every hour"),
    ).toBeInTheDocument();
  });
});
