import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import { Route, SkuActivityRouteShell } from "./sku-activity";

const mockedHooks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useNavigate: vi.fn(),
  useProtectedAdminPageState: vi.fn(),
  useQuery: vi.fn(),
}));

const mockedRouter = vi.hoisted(() => ({
  navigateBack: vi.fn(),
  search: {} as Record<string, unknown>,
}));

const mockedApi = vi.hoisted(() => ({
  getSkuActivityForProductSku: "getSkuActivityForProductSku",
  getOrganizations: "getOrganizations",
  getStores: "getStores",
  searchProductSkus: "searchProductSkus",
}));

vi.mock("@tanstack/react-router", () => ({
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
  it("renders the safe inline failure state", () => {
    const ErrorView = (Route as unknown as { errorComponent: ComponentType })
      .errorComponent;

    render(<ErrorView />);

    expect(screen.getByText("SKU activity unavailable.")).toBeInTheDocument();
    expect(
      screen.getByText("Refresh the SKU or try again from the inventory view."),
    ).toBeInTheDocument();
  });
});
