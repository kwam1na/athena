import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerState = vi.hoisted(() => ({
  pathname: "/acme/store/downtown/reports",
  search: {} as Record<string, unknown>,
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
    const search = (props as Record<string, unknown>).search;
    delete (props as Record<string, unknown>).search;
    return (
      <a
        data-search={search ? JSON.stringify(search) : undefined}
        href={to}
        {...props}
      >
        {children}
      </a>
    );
  },
  Outlet: () => <div data-testid="reports-outlet" />,
  useLocation: () => ({
    pathname: routerState.pathname,
    search: routerState.search,
  }),
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
}));

import { ReportsLayout } from "./ReportsLayout";

describe("ReportsLayout", () => {
  beforeEach(() => {
    routerState.pathname = "/acme/store/downtown/reports";
    routerState.search = {};
  });

  it("renders the Overview, Weekly, and Items tabs in workspace order", () => {
    render(<ReportsLayout />);
    expect(
      screen.getByText(
        "Review sales and product performance.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Weekly" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Items" })).toBeInTheDocument();
    expect(
      screen.getAllByRole("link").map((link) => link.textContent),
    ).toEqual(["Overview", "Weekly", "Items"]);
    expect(screen.getByTestId("reports-outlet")).toBeInTheDocument();
  });

  it("marks the Overview tab active on the base reports path", () => {
    render(<ReportsLayout />);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps validated Overview state while opening Weekly and restores it on return", () => {
    routerState.search = {
      window: "weekToDate",
      daysStart: "2026-07-01",
      daysEnd: "2026-07-28",
      daysTableStart: "2026-06-01",
      daysTableEnd: "2026-07-31",
      daysPage: 2,
      selectedDay: "2026-07-16",
    };

    const { rerender } = render(<ReportsLayout />);
    expect(screen.getByRole("link", { name: "Weekly" })).toHaveAttribute(
      "data-search",
      JSON.stringify({
        overviewWindow: "weekToDate",
        overviewDaysStart: "2026-07-01",
        overviewDaysEnd: "2026-07-28",
        overviewDaysTableStart: "2026-06-01",
        overviewDaysTableEnd: "2026-07-31",
        overviewDaysPage: 2,
        overviewSelectedDay: "2026-07-16",
      }),
    );

    routerState.pathname = "/acme/store/downtown/reports/weekly";
    routerState.search = JSON.parse(
      screen.getByRole("link", { name: "Weekly" }).getAttribute("data-search")!,
    );
    rerender(<ReportsLayout />);

    expect(screen.getByRole("link", { name: "Weekly" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "data-search",
      JSON.stringify({
        window: "weekToDate",
        daysStart: "2026-07-01",
        daysEnd: "2026-07-28",
        daysTableStart: "2026-06-01",
        daysTableEnd: "2026-07-31",
        daysPage: 2,
        selectedDay: "2026-07-16",
      }),
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
