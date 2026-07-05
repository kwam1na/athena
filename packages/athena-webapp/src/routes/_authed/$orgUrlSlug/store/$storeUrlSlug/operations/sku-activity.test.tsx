import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import type { SkuActivityUntrustedSalesQueryResult } from "~/src/components/operations/skuActivityUntrustedSalesAdapter";
import { Route, SkuActivityRouteShell } from "./sku-activity";

const mockedHooks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useNavigate: vi.fn(),
  useProtectedAdminPageState: vi.fn(),
  useQuery: vi.fn(),
}));

const mockedRouter = vi.hoisted(() => ({
  navigate: vi.fn(),
  navigateBack: vi.fn(),
  search: {} as Record<string, unknown>,
}));

const mockedApi = vi.hoisted(() => ({
  getSkuActivityForProductSku: "getSkuActivityForProductSku",
  getUntrustedSkuSaleEvidence: "getUntrustedSkuSaleEvidence",
  getOrganizations: "getOrganizations",
  getStores: "getStores",
  searchProductSkus: "searchProductSkus",
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
  }: {
    children: ReactNode;
    params?: Record<string, string>;
    search?: Record<string, string | undefined>;
    to?: string;
  }) => {
    const href = Object.entries(params ?? {}).reduce(
      (path, [key, value]) => path.replace(`$${key}`, value),
      to ?? "/",
    );
    const searchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(search ?? {})) {
      if (value !== undefined) {
        searchParams.set(key, value);
      }
    }

    return (
      <a href={`${href}${searchParams.size ? `?${searchParams}` : ""}`}>
        {children}
      </a>
    );
  },
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useNavigate: mockedHooks.useNavigate,
    useParams: () => ({
      orgUrlSlug: "wigclub",
      storeUrlSlug: "osu",
    }),
    useSearch: () => mockedRouter.search,
  }),
  useSearch: () => mockedRouter.search,
}));

vi.mock("~/src/hooks/use-navigate-back", () => ({
  useNavigateBack: () => mockedRouter.navigateBack,
}));

vi.mock("convex/react", () => ({
  useQuery: mockedHooks.useQuery,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: mockedHooks.useAuth,
}));

vi.mock("@/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: mockedHooks.useProtectedAdminPageState,
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    inventory: {
      organizations: {
        getAll: mockedApi.getOrganizations,
      },
      skuSearch: {
        searchProductSkus: mockedApi.searchProductSkus,
      },
      stores: {
        getAll: mockedApi.getStores,
      },
    },
    operations: {
      skuActivity: {
        getSkuActivityForProductSku: mockedApi.getSkuActivityForProductSku,
        getUntrustedSkuSaleEvidence: mockedApi.getUntrustedSkuSaleEvidence,
      },
    },
  },
}));

const readyProtectedState = {
  canAccessProtectedSurface: true,
  hasFullAdminAccess: false,
  isAuthenticated: true,
  isLoadingAccess: false,
};

describe("SkuActivityRouteShell", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
    mockedRouter.search = {};
    mockedHooks.useAuth.mockReturnValue({
      isLoading: false,
      user: { _id: "user-1" },
    });
    mockedHooks.useNavigate.mockReturnValue(mockedRouter.navigate);
    mockedHooks.useProtectedAdminPageState.mockReturnValue(readyProtectedState);
    mockedHooks.useQuery.mockImplementation((query, args) => {
      if (args === "skip") {
        return undefined;
      }

      if (query === mockedApi.getOrganizations) {
        expect(args).toEqual({ userId: "user-1" });
        return [{ _id: "org-1", slug: "wigclub" }];
      }

      if (query === mockedApi.getStores) {
        expect(args).toEqual({ organizationId: "org-1" });
        return [{ _id: "store-1" as Id<"store">, slug: "osu" }];
      }

      if (query === mockedApi.searchProductSkus) {
        return {
          results: [
            {
              productSkuId: "sku-id-1" as Id<"productSku">,
              sku: "KK38-X3C-MQE",
            },
          ],
        };
      }

      if (query === mockedApi.getSkuActivityForProductSku) {
        return null;
      }

      if (query === mockedApi.getUntrustedSkuSaleEvidence) {
        return {
          hasMoreSources: false,
          reviewStatus: "open",
          selected: null,
          sourceFilter: "all",
          sourceLimit: 50,
          sources: [],
          totalSourceCount: 0,
        };
      }

      return undefined;
    });
  });

  it("blocks direct URL access when store-day access is denied", () => {
    mockedHooks.useProtectedAdminPageState.mockReturnValue({
      ...readyProtectedState,
      canAccessProtectedSurface: false,
    });

    render(
      <SkuActivityRouteShell
        orgUrlSlug="wigclub"
        sku="KK38-X3C-MQE"
        storeUrlSlug="osu"
      />,
    );

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
      "skip",
    ]);
  });

  it("subscribes to SKU activity only after the store-day gate allows access", () => {
    render(
      <SkuActivityRouteShell
        orgUrlSlug="wigclub"
        sku="KK38-X3C-MQE"
        storeUrlSlug="osu"
      />,
    );

    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      { userId: "user-1" },
      { organizationId: "org-1" },
      { limit: 5, query: "KK38-X3C-MQE", storeId: "store-1" },
      { productSkuId: "sku-id-1", sku: undefined, storeId: "store-1" },
    ]);
    expect(
      screen.getByRole("button", { name: "Inspect SKU" }),
    ).toBeInTheDocument();
  });

  it("returns from SKU inspection to the evidence workflow", () => {
    render(
      <SkuActivityRouteShell
        orgUrlSlug="wigclub"
        reviewStatus="reviewed"
        sku="KK38-X3C-MQE"
        source="pending_checkout"
        storeUrlSlug="osu"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Back to evidence" }),
    );

    expect(mockedRouter.navigate).toHaveBeenCalledTimes(1);
    const navigateArgs = mockedRouter.navigate.mock.calls[0]?.[0];
    const nextSearch =
      typeof navigateArgs?.search === "function"
        ? navigateArgs.search({
            reviewStatus: "reviewed",
            sku: "KK38-X3C-MQE",
            source: "pending_checkout",
          })
        : navigateArgs?.search;

    expect(nextSearch).toMatchObject({
      productSkuId: undefined,
      reviewStatus: "reviewed",
      sku: undefined,
      source: "pending_checkout",
      transactionPage: undefined,
    });
  });

  it("shows the untrusted sales workspace when no SKU is selected", () => {
    render(<SkuActivityRouteShell orgUrlSlug="wigclub" storeUrlSlug="osu" />);

    expect(
      screen.getByRole("textbox", { name: "Evidence search" }),
    ).toBeInTheDocument();
    const queryArgs = mockedHooks.useQuery.mock.calls.map(([, args]) => args);
    expect(queryArgs).toContainEqual({ userId: "user-1" });
    expect(queryArgs).toContainEqual({ organizationId: "org-1" });
    expect(queryArgs).toContainEqual(
      {
        limit: 50,
        reviewStatus: "open",
        selectedSource: undefined,
        sourceFilter: "all",
        storeId: "store-1",
        transactionLimit: 100,
      },
    );
    expect(
      screen.getByText("Products moving before trust review"),
    ).toBeInTheDocument();
    expect(screen.getByText("No sale evidence found.")).toBeInTheDocument();
  });

  it("uses the default search field for evidence filtering and keeps SKU inspection explicit", () => {
    mockedHooks.useQuery.mockImplementation((query, args) => {
      if (args === "skip") {
        return undefined;
      }

      if (query === mockedApi.getOrganizations) {
        return [{ _id: "org-1", slug: "wigclub" }];
      }

      if (query === mockedApi.getStores) {
        return [{ _id: "store-1" as Id<"store">, slug: "osu" }];
      }

      if (query === mockedApi.getUntrustedSkuSaleEvidence) {
        return {
          hasMoreSources: false,
          reviewStatus: "open",
          selected: null,
          sourceFilter: "all",
          sourceLimit: 50,
          sources: [
            {
              evidence: {
                lastPosTransactionId: "transaction-1",
                lastSoldAt: 2_000,
                saleCount: 1,
                totalQuantitySold: 1,
              },
              id: "provisional-1",
              lastActivityAt: 2_000,
              lookupCode: "6N2Y-RAN-G11",
              productId: "product-1",
              productSkuId: "sku-1",
              reviewState: "open",
              sku: "6N2Y-RAN-G11",
              sourceType: "inventoryImportProvisionalSku",
              status: "active",
              title: "SUNFLOWER PARFUME",
              updatedAt: 2_100,
            },
            {
              evidence: {
                lastPosTransactionId: "transaction-2",
                lastSoldAt: 1_500,
                saleCount: 1,
                totalQuantitySold: 1,
              },
              id: "provisional-2",
              lastActivityAt: 1_500,
              lookupCode: "6N2Y-XDS-2HB",
              productId: "product-2",
              productSkuId: "sku-2",
              reviewState: "open",
              sku: "6N2Y-XDS-2HB",
              sourceType: "inventoryImportProvisionalSku",
              status: "active",
              title: "BIOSILK OIL",
              updatedAt: 1_600,
            },
          ],
          totalSourceCount: 2,
        } satisfies SkuActivityUntrustedSalesQueryResult;
      }

      return undefined;
    });

    render(<SkuActivityRouteShell orgUrlSlug="wigclub" storeUrlSlug="osu" />);

    const evidenceSearch = screen.getByRole("textbox", {
      name: "Evidence search",
    });

    expect(evidenceSearch).toHaveAttribute(
      "placeholder",
      "Search evidence or enter SKU",
    );
    expect(screen.getByText("Sunflower Parfume")).toBeInTheDocument();
    expect(screen.getByText("Biosilk Oil")).toBeInTheDocument();

    fireEvent.change(evidenceSearch, { target: { value: "sunflower" } });

    expect(screen.getByText("Sunflower Parfume")).toBeInTheDocument();
    expect(screen.queryByText("Biosilk Oil")).not.toBeInTheDocument();
    expect(mockedRouter.navigate).toHaveBeenCalledTimes(1);
    const evidenceNavigateArgs = mockedRouter.navigate.mock.calls[0]?.[0];
    const evidenceSearchParams =
      typeof evidenceNavigateArgs?.search === "function"
        ? evidenceNavigateArgs.search({})
        : evidenceNavigateArgs?.search;

    expect(evidenceSearchParams).toMatchObject({
      evidenceQuery: "sunflower",
      transactionPage: undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: "Inspect SKU" }));

    expect(mockedRouter.navigate).toHaveBeenCalledTimes(2);
    const navigateArgs = mockedRouter.navigate.mock.calls[1]?.[0];
    const nextSearch =
      typeof navigateArgs?.search === "function"
        ? navigateArgs.search({ evidenceQuery: "sunflower" })
        : navigateArgs?.search;

    expect(nextSearch).toMatchObject({
      evidenceQuery: undefined,
      sku: "sunflower",
    });
  });

  it("restores evidence filtering from the URL query", () => {
    mockedHooks.useQuery.mockImplementation((query, args) => {
      if (args === "skip") {
        return undefined;
      }

      if (query === mockedApi.getOrganizations) {
        return [{ _id: "org-1", slug: "wigclub" }];
      }

      if (query === mockedApi.getStores) {
        return [{ _id: "store-1" as Id<"store">, slug: "osu" }];
      }

      if (query === mockedApi.getUntrustedSkuSaleEvidence) {
        return {
          hasMoreSources: false,
          reviewStatus: "open",
          selected: null,
          sourceFilter: "all",
          sourceLimit: 50,
          sources: [
            {
              evidence: {
                lastPosTransactionId: "transaction-1",
                lastSoldAt: 2_000,
                saleCount: 1,
                totalQuantitySold: 1,
              },
              id: "provisional-1",
              lastActivityAt: 2_000,
              lookupCode: "6N2Y-RAN-G11",
              productId: "product-1",
              productSkuId: "sku-1",
              reviewState: "open",
              sku: "6N2Y-RAN-G11",
              sourceType: "inventoryImportProvisionalSku",
              status: "active",
              title: "SUNFLOWER PARFUME",
              updatedAt: 2_100,
            },
            {
              evidence: {
                lastPosTransactionId: "transaction-2",
                lastSoldAt: 1_500,
                saleCount: 1,
                totalQuantitySold: 1,
              },
              id: "provisional-2",
              lastActivityAt: 1_500,
              lookupCode: "6N2Y-XDS-2HB",
              productId: "product-2",
              productSkuId: "sku-2",
              reviewState: "open",
              sku: "6N2Y-XDS-2HB",
              sourceType: "inventoryImportProvisionalSku",
              status: "active",
              title: "BIOSILK OIL",
              updatedAt: 1_600,
            },
          ],
          totalSourceCount: 2,
        } satisfies SkuActivityUntrustedSalesQueryResult;
      }

      return undefined;
    });

    render(
      <SkuActivityRouteShell
        evidenceQuery="sunflower"
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    expect(screen.getByRole("textbox", { name: "Evidence search" })).toHaveValue(
      "sunflower",
    );
    expect(screen.getByText("Sunflower Parfume")).toBeInTheDocument();
    expect(screen.queryByText("Biosilk Oil")).not.toBeInTheDocument();
  });

  it("clears the URL-backed evidence query from the search input", () => {
    mockedHooks.useQuery.mockImplementation((query, args) => {
      if (args === "skip") {
        return undefined;
      }

      if (query === mockedApi.getOrganizations) {
        return [{ _id: "org-1", slug: "wigclub" }];
      }

      if (query === mockedApi.getStores) {
        return [{ _id: "store-1", slug: "osu" }];
      }

      if (query === mockedApi.getUntrustedSkuSaleEvidence) {
        return {
          hasMoreSources: false,
          reviewStatus: "open",
          selected: null,
          sourceFilter: "all",
          sourceLimit: 10,
          sources: [
            {
              evidence: {
                lastSoldAt: 1_000,
                saleCount: 1,
                totalQuantitySold: 1,
              },
              id: "provisional-1",
              lastActivityAt: 1_000,
              lookupCode: "6N2Y-RAN-G11",
              productId: "product-1",
              productSkuId: "sku-1",
              reviewState: "open",
              sku: "6N2Y-RAN-G11",
              sourceType: "inventoryImportProvisionalSku",
              status: "active",
              title: "SUNFLOWER PARFUME",
              updatedAt: 1_100,
            },
          ],
          totalSourceCount: 1,
        } satisfies SkuActivityUntrustedSalesQueryResult;
      }

      return undefined;
    });

    render(
      <SkuActivityRouteShell
        evidenceQuery="sunflower"
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    const evidenceSearch = screen.getByRole("textbox", {
      name: "Evidence search",
    });

    expect(evidenceSearch).toHaveValue("sunflower");

    fireEvent.click(screen.getByRole("button", { name: "Clear evidence search" }));

    expect(evidenceSearch).toHaveValue("");
    expect(mockedRouter.navigate).toHaveBeenCalledTimes(1);

    const navigateArgs = mockedRouter.navigate.mock.calls[0]?.[0];
    const nextSearch =
      typeof navigateArgs?.search === "function"
        ? navigateArgs.search({
            evidenceQuery: "sunflower",
            selectedSourceId: "provisional-1",
            selectedSourceType: "inventoryImportProvisionalSku",
            transactionPage: 2,
          })
        : navigateArgs?.search;

    expect(nextSearch).toMatchObject({
      evidenceQuery: undefined,
      selectedSourceId: undefined,
      selectedSourceType: undefined,
      transactionPage: undefined,
    });
  });

  it("animates the header description to untrusted sale metrics after evidence loads", async () => {
    mockedHooks.useQuery.mockImplementation((query, args) => {
      if (args === "skip") {
        return undefined;
      }

      if (query === mockedApi.getOrganizations) {
        return [{ _id: "org-1", slug: "wigclub" }];
      }

      if (query === mockedApi.getStores) {
        return [{ _id: "store-1" as Id<"store">, slug: "osu" }];
      }

      if (query === mockedApi.getUntrustedSkuSaleEvidence) {
        return {
          hasMoreSources: false,
          reviewStatus: "open",
          selected: null,
          sourceFilter: "all",
          sourceLimit: 50,
          sources: [
            {
              evidence: {
                lastPosTransactionId: "transaction-1",
                lastSoldAt: 2_000,
                saleCount: 2,
                totalQuantitySold: 3,
              },
              id: "provisional-1",
              lastActivityAt: 2_000,
              lookupCode: "6N2Y-ABC-123",
              productId: "product-1",
              productSkuId: "sku-1",
              reviewState: "open",
              sku: "6N2Y-ABC-123",
              sourceType: "inventoryImportProvisionalSku",
              status: "active",
              title: "SUNFLOWER PARFUME",
              updatedAt: 2_100,
            },
          ],
          totalSourceCount: 1,
        } satisfies SkuActivityUntrustedSalesQueryResult;
      }

      return undefined;
    });

    render(<SkuActivityRouteShell orgUrlSlug="wigclub" storeUrlSlug="osu" />);

    expect(
      await screen.findByRole("heading", {
        name: "3 units sold",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "From completed sales tied to provisional catalog and pending checkout sources.",
      ),
    ).toBeInTheDocument();
  });

  it("routes selected POS pending checkout sources to product detail", () => {
    mockedHooks.useQuery.mockImplementation((query, args) => {
      if (args === "skip") {
        return undefined;
      }

      if (query === mockedApi.getOrganizations) {
        return [{ _id: "org-1", slug: "wigclub" }];
      }

      if (query === mockedApi.getStores) {
        return [{ _id: "store-1" as Id<"store">, slug: "osu" }];
      }

      if (query === mockedApi.getUntrustedSkuSaleEvidence) {
        return {
          hasMoreSources: false,
          reviewStatus: "reviewed",
          selected: {
            source: {
              evidence: {
                lastPosTransactionId: "transaction-1",
                lastSoldAt: 2_000,
                saleCount: 1,
                totalQuantitySold: 1,
              },
              id: "pending-1",
              lastActivityAt: 2_000,
              lookupCode: null,
              productId: "product-pending-1",
              productSkuId: "sku-pending-1",
              reviewState: "reviewed",
              sku: null,
              sourceType: "posPendingCheckoutItem",
              status: "approved",
              title: "SAA",
              updatedAt: 2_100,
            },
            transactionHistory: {
              isTruncated: false,
              rows: [],
            },
          },
          sourceFilter: "all",
          sourceLimit: 50,
          sources: [],
          totalSourceCount: 1,
        } satisfies SkuActivityUntrustedSalesQueryResult;
      }

      return undefined;
    });

    render(
      <SkuActivityRouteShell
        orgUrlSlug="wigclub"
        reviewStatus="reviewed"
        selectedSourceId="pending-1"
        selectedSourceType="posPendingCheckoutItem"
        storeUrlSlug="osu"
      />,
    );

    const reviewLinks = screen.getAllByRole("link", {
      name: "Review pending checkout",
    });

    expect(reviewLinks).toHaveLength(2);
    for (const reviewLink of reviewLinks) {
      const href = new URL(
        reviewLink.getAttribute("href") ?? "",
        "http://test",
      );

      expect(href.pathname).toBe(
        "/wigclub/store/osu/products/product-pending-1",
      );
      expect(href.searchParams.get("variant")).toBe("sku-pending-1");
      expect(href.searchParams.get("o")).toBeTruthy();
      expect(href.searchParams.get("categorySlug")).toBeNull();
    }
  });

  it("keeps the evidence workspace mounted while a selected source refetches", () => {
    const untrustedSkuSales: SkuActivityUntrustedSalesQueryResult = {
      hasMoreSources: false,
      reviewStatus: "open",
      selected: null,
      sourceFilter: "all",
      sourceLimit: 50,
      sources: [
        {
          evidence: {
            lastPosTransactionId: "transaction-1",
            lastSoldAt: 2_000,
            saleCount: 1,
            totalQuantitySold: 1,
          },
          id: "provisional-1",
          lastActivityAt: 2_000,
          lookupCode: "6N2Y-RAN-G11",
          productId: "product-1",
          productSkuId: "sku-1",
          reviewState: "open",
          sku: "6N2Y-RAN-G11",
          sourceType: "inventoryImportProvisionalSku",
          status: "active",
          title: "SUNFLOWER PARFUME",
          updatedAt: 2_100,
        },
      ],
      totalSourceCount: 1,
    };
    let currentUntrustedSkuSales:
      | SkuActivityUntrustedSalesQueryResult
      | undefined = untrustedSkuSales;

    mockedHooks.useQuery.mockImplementation((query, args) => {
      if (args === "skip") {
        return undefined;
      }

      if (query === mockedApi.getOrganizations) {
        return [{ _id: "org-1", slug: "wigclub" }];
      }

      if (query === mockedApi.getStores) {
        return [{ _id: "store-1" as Id<"store">, slug: "osu" }];
      }

      if (query === mockedApi.getUntrustedSkuSaleEvidence) {
        return currentUntrustedSkuSales;
      }

      return undefined;
    });

    const { rerender } = render(
      <SkuActivityRouteShell orgUrlSlug="wigclub" storeUrlSlug="osu" />,
    );

    expect(screen.getByText("Sunflower Parfume")).toBeInTheDocument();
    expect(screen.getByText("6N2Y-RAN-G11")).toBeInTheDocument();
    expect(screen.queryByText("Lookup: 6N2Y-RAN-G11")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Loading untrusted SKU sales."),
    ).not.toBeInTheDocument();

    currentUntrustedSkuSales = undefined;

    rerender(
      <SkuActivityRouteShell
        orgUrlSlug="wigclub"
        selectedSourceId="provisional-1"
        selectedSourceType="inventoryImportProvisionalSku"
        storeUrlSlug="osu"
      />,
    );

    expect(screen.getAllByText("Sunflower Parfume")).toHaveLength(2);
    expect(screen.getByText("Full transaction history")).toBeInTheDocument();
    expect(screen.getAllByText("Units sold")).toHaveLength(2);
    expect(
      screen.getByLabelText("Loading transaction history"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Loading untrusted SKU sales."),
    ).not.toBeInTheDocument();
  });

  it("falls back to the direct SKU activity lookup when catalog search has no match", () => {
    mockedHooks.useQuery.mockImplementation((query, args) => {
      if (args === "skip") {
        return undefined;
      }

      if (query === mockedApi.getOrganizations) {
        return [{ _id: "org-1", slug: "wigclub" }];
      }

      if (query === mockedApi.getStores) {
        return [{ _id: "store-1" as Id<"store">, slug: "osu" }];
      }

      if (query === mockedApi.searchProductSkus) {
        return { results: [] };
      }

      if (query === mockedApi.getSkuActivityForProductSku) {
        return null;
      }

      return undefined;
    });

    render(
      <SkuActivityRouteShell
        orgUrlSlug="wigclub"
        sku="KK38-X3C-MQE"
        storeUrlSlug="osu"
      />,
    );

    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      { userId: "user-1" },
      { organizationId: "org-1" },
      { limit: 5, query: "KK38-X3C-MQE", storeId: "store-1" },
      { productSkuId: undefined, sku: "KK38-X3C-MQE", storeId: "store-1" },
    ]);
  });

  it("shows the back affordance when opened with an origin search param", () => {
    mockedRouter.search = {
      o: "/wigclub/store/osu/operations",
    };

    render(
      <SkuActivityRouteShell
        orgUrlSlug="wigclub"
        showBackButton
        sku="KK38-X3C-MQE"
        storeUrlSlug="osu"
      />,
    );

    expect(screen.getByRole("button", { name: "Go back" })).toBeInTheDocument();
  });
});

describe("SkuActivityRouteErrorView", () => {
  it("renders the untrusted workspace failure state when no SKU is selected", () => {
    const ErrorView = (Route as unknown as { errorComponent: ComponentType })
      .errorComponent;

    render(<ErrorView />);

    expect(
      screen.getByText("Untrusted SKU sales unavailable."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Refresh the workspace or try again from Store Ops."),
    ).toBeInTheDocument();
  });

  it("renders the SKU lookup failure state when a SKU is selected", () => {
    const ErrorView = (Route as unknown as { errorComponent: ComponentType })
      .errorComponent;
    mockedRouter.search = {
      sku: "KK38-X3C-MQE",
    };

    render(<ErrorView />);

    expect(screen.getByText("SKU activity unavailable.")).toBeInTheDocument();
    expect(
      screen.getByText("Refresh the SKU or try again from the inventory view."),
    ).toBeInTheDocument();
  });
});
