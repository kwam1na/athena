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

vi.mock("./ReportsCatalogLookup", () => ({
  ReportsCatalogLookup: () => <div data-testid="reports-catalog-lookup" />,
}));

import { ReportsLayout } from "./ReportsLayout";

describe("ReportsLayout", () => {
  beforeEach(() => {
    routerState.pathname = "/acme/store/downtown/reports";
    routerState.search = {};
  });

  it("renders the Overview, Week, and Items tabs in workspace order", () => {
    render(<ReportsLayout />);
    expect(
      screen.getByText("Review sales and product performance."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Week" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Items" })).toBeInTheDocument();
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      ["Overview", "Week", "Items"],
    );
    expect(screen.getByTestId("reports-outlet")).toBeInTheDocument();
    expect(screen.getByTestId("reports-catalog-lookup")).toBeInTheDocument();
  });

  it("shares one product search across Overview, Week, and Items", () => {
    const { rerender } = render(<ReportsLayout />);

    expect(screen.getAllByTestId("reports-catalog-lookup")).toHaveLength(1);

    routerState.pathname = "/acme/store/downtown/reports/items";
    rerender(<ReportsLayout />);
    expect(screen.getAllByTestId("reports-catalog-lookup")).toHaveLength(1);

    routerState.pathname = "/acme/store/downtown/reports/weekly";
    rerender(<ReportsLayout />);
    expect(screen.getAllByTestId("reports-catalog-lookup")).toHaveLength(1);
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
    expect(screen.getByRole("link", { name: "Week" })).toHaveAttribute(
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
      screen.getByRole("link", { name: "Week" }).getAttribute("data-search")!,
    );
    rerender(<ReportsLayout />);

    expect(screen.getByRole("link", { name: "Week" })).toHaveAttribute(
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

  it("keeps the Weekly tab a state-preserving self-link while Weekly is active", () => {
    routerState.pathname = "/acme/store/downtown/reports/weekly";
    routerState.search = {
      reportId: "week:2026-07-06",
      history: true,
      historyCursor: "cursor-2",
      historyCursorTrail: [null, "cursor-1"],
      overviewWindow: "trailing30",
      overviewSelectedDay: "2026-07-16",
    };

    render(<ReportsLayout />);

    expect(
      JSON.parse(
        screen
          .getByRole("link", { name: "Week" })
          .getAttribute("data-search")!,
      ),
    ).toEqual(routerState.search);
    expect(
      JSON.parse(
        screen
          .getByRole("link", { name: "Overview" })
          .getAttribute("data-search")!,
      ),
    ).toEqual({
      window: "trailing30",
      selectedDay: "2026-07-16",
    });
  });

  it("keeps the Overview tab a state-preserving self-link while Overview is active", () => {
    routerState.search = {
      window: "trailing30",
      daysPage: 3,
      selectedDay: "2026-07-16",
    };

    render(<ReportsLayout />);

    expect(
      JSON.parse(
        screen
          .getByRole("link", { name: "Overview" })
          .getAttribute("data-search")!,
      ),
    ).toEqual(routerState.search);
  });

  it("marks only the active tab with aria-current", () => {
    routerState.pathname = "/acme/store/downtown/reports/weekly";

    render(<ReportsLayout />);

    expect(screen.getByRole("link", { name: "Week" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const label of ["Overview", "Items"]) {
      expect(screen.getByRole("link", { name: label })).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  it("marks only Items on the Items route", () => {
    routerState.pathname = "/acme/store/downtown/reports/items";

    render(<ReportsLayout />);

    expect(screen.getByRole("link", { name: "Items" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const label of ["Overview", "Week"]) {
      expect(screen.getByRole("link", { name: label })).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  it("lets an SKU detail route own the page title and navigation", () => {
    routerState.pathname = "/acme/store/downtown/reports/items/product-sku-1";

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
