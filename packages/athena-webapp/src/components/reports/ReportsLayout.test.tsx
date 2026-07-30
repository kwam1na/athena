import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerState = vi.hoisted(() => ({
  pathname: "/acme/store/downtown/reports",
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children?: React.ReactNode;
    to: string;
  }) => {
    delete (props as Record<string, unknown>).params;
    return (
      <a href={to} {...props}>
        {children}
      </a>
    );
  },
  Outlet: () => <div data-testid="reports-outlet" />,
  useLocation: () => ({ pathname: routerState.pathname }),
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
}));

import { ReportsLayout } from "./ReportsLayout";

describe("ReportsLayout", () => {
  beforeEach(() => {
    routerState.pathname = "/acme/store/downtown/reports";
  });

  it("renders the Overview and Items tabs and the outlet", () => {
    render(<ReportsLayout />);
    expect(
      screen.getByText(
        "Review sales and product performance.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Items" })).toBeInTheDocument();
    expect(screen.getByTestId("reports-outlet")).toBeInTheDocument();
  });

  it("marks the Overview tab active on the base reports path", () => {
    render(<ReportsLayout />);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("lets an SKU detail route own the page title and navigation", () => {
    routerState.pathname =
      "/acme/store/downtown/reports/items/product-sku-1";

    render(<ReportsLayout />);

    expect(
      screen.queryByText("Review sales and product performance."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Reports views" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("reports-outlet")).toBeInTheDocument();
  });
});
