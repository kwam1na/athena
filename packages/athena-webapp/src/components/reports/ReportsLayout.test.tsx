import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: React.ComponentProps<"a"> & {
    params?: unknown;
    search?: unknown;
    to: string;
  }) => {
    delete props.params;
    delete props.search;
    return (
      <a href={to} {...props}>
        {children}
      </a>
    );
  },
  Outlet: () => <div>Nested report</div>,
  useLocation: () => ({ pathname: "/org/store/store/reports" }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ orgUrlSlug: "org", storeUrlSlug: "store" }),
  useSearch: () => ({}),
}));
vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "store-1" } }),
}));
vi.mock("~/convex/_generated/api", () => ({
  api: {
    reporting: {
      customRangeRequests: {
        getCustomRangeStatus: "status",
        requestCustomRange: "request",
      },
    },
  },
}));
vi.mock("@/components/View", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("@/components/common/FadeIn", () => ({
  FadeIn: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { ReportsLayout, shouldShowReportPeriodControls } from "./ReportsLayout";

describe("ReportsLayout", () => {
  it("provides directly addressable workspace navigation", () => {
    render(<ReportsLayout />);
    expect(
      screen.getByRole("heading", { name: "Reports" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Items" })).toHaveAttribute(
      "href",
      expect.stringContaining("/reports/items"),
    );
    expect(screen.getByRole("link", { name: "Inventory" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Storefront" }),
    ).toBeInTheDocument();
  });

  it("keeps financial period controls out of the independent Storefront surface", () => {
    expect(
      shouldShowReportPeriodControls("/org/store/shop/reports/storefront"),
    ).toBe(false);
    expect(
      shouldShowReportPeriodControls("/org/store/shop/reports/items"),
    ).toBe(true);
  });
});
