import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PointOfSaleView from "./PointOfSaleView";

const useGetActiveOrganizationMock = vi.fn();
const useGetActiveStoreMock = vi.fn();
const usePermissionsMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
  }: {
    children?: React.ReactNode;
    params?: { orgUrlSlug: string; storeUrlSlug: string };
    to?: string;
  }) => (
    <a
      href={
        to
          ?.replace("$orgUrlSlug", params?.orgUrlSlug ?? "")
          .replace("$storeUrlSlug", params?.storeUrlSlug ?? "") ?? "#"
      }
    >
      {children}
    </a>
  ),
  useParams: () => ({}),
  useSearch: () => ({}),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: function UseGetActiveStoreMockAdapter() {
    return useGetActiveStoreMock();
  },
}));

vi.mock("@/hooks/useGetOrganizations", () => ({
  useGetActiveOrganization: () => useGetActiveOrganizationMock(),
}));

vi.mock("~/src/hooks/useGetCurrencyFormatter", () => ({
  useGetCurrencyFormatter: () =>
    new Intl.NumberFormat("en-US", { currency: "GHS", style: "currency" }),
}));

vi.mock("~/src/hooks/useGetTerminal", () => ({
  useGetTerminal: () => ({ terminal: null }),
}));

vi.mock("~/src/hooks/usePermissions", () => ({
  usePermissions: () => usePermissionsMock(),
}));

vi.mock("../View", () => ({
  default: ({
    children,
    header,
  }: {
    children?: React.ReactNode;
    header?: React.ReactNode;
  }) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));

vi.mock("../common/FadeIn", () => ({
  FadeIn: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

describe("PointOfSaleView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGetActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
        slug: "downtown",
      },
    });
    useGetActiveOrganizationMock.mockReturnValue({
      activeOrganization: {
        slug: "acme",
      },
    });
    usePermissionsMock.mockReturnValue({
      hasFullAdminAccess: true,
    });
    useQueryMock.mockReturnValueOnce({}).mockReturnValueOnce({
      totalItemsSold: 3,
      totalSales: 12_500,
      totalTransactions: 2,
    });
  });

  it("renders the POS landing header as the page title", () => {
    render(<PointOfSaleView />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Point of Sale" }),
    ).toBeInTheDocument();
  });

  it("links managers to active POS session operations from the POS landing page", () => {
    render(<PointOfSaleView />);

    const link = screen.getByRole("link", { name: /Active Sessions/i });

    expect(link).toHaveAttribute("href", "/acme/store/downtown/pos/sessions");
    expect(
      screen.getByText("Review active and held sales reserving inventory"),
    ).toBeInTheDocument();
  });
});
