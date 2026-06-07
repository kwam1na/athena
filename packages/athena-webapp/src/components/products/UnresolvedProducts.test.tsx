import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import { UnresolvedProducts } from "./UnresolvedProducts";

const mocks = vi.hoisted(() => ({
	  resolvePendingCheckoutItem: vi.fn(),
	  useGetUnresolvedProducts: vi.fn(),
	  usePOSPendingCheckoutItemsForReview: vi.fn(),
	  usePOSRegisterCatalog: vi.fn(),
	}));

vi.mock("~/src/hooks/useGetProducts", () => ({
  useGetUnresolvedProducts: () => mocks.useGetUnresolvedProducts(),
}));

vi.mock("~/src/hooks/usePOSProducts", () => ({
	  usePOSPendingCheckoutItemsForReview: (storeId: Id<"store"> | undefined) =>
	    mocks.usePOSPendingCheckoutItemsForReview(storeId),
	  usePOSRegisterCatalog: (storeId: Id<"store"> | undefined) =>
	    mocks.usePOSRegisterCatalog(storeId),
	  usePOSResolvePendingCheckoutItemReview: () => mocks.resolvePendingCheckoutItem,
	}));

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: {
      _id: "store-1",
    },
  }),
}));

vi.mock("~/src/hooks/use-navigate-back", () => ({
  useNavigateBack: () => vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({}),
}));

vi.mock("../View", () => ({
  default: ({
    children,
    header,
  }: {
    children: ReactNode;
    header?: ReactNode;
  }) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));

vi.mock("../common/FadeIn", () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../base/table/data-table", () => ({
  GenericDataTable: () => <div data-testid="unresolved-products-table" />,
}));

vi.mock("./products-table/components/productColumns", () => ({
  productColumns: [],
}));

describe("UnresolvedProducts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
	    mocks.useGetUnresolvedProducts.mockReturnValue([
	      {
	        _id: "unresolved-product-1",
	        name: "Unresolved product",
	        skus: [],
	      },
	    ]);
	    mocks.usePOSRegisterCatalog.mockReturnValue([
	      {
	        name: "Catalog gel",
	        productId: "product-1",
	        sku: "GEL-1",
	        skuId: "sku-1",
	      },
	    ]);
	    mocks.usePOSPendingCheckoutItemsForReview.mockReturnValue([
      {
        _id: "pending-1",
        createdAt: 1,
        createdFrom: "online",
        evidence: {
          totalQuantitySold: 2,
          transactionCount: 1,
        },
        lookupCode: "999999999999",
        name: "Uncataloged gel",
        provisionalPrice: 2500,
        reviewPriority: "elevated",
        status: "pending_review",
        updatedAt: 2,
      },
    ]);
  });

  it("lists pending checkout items and lets a manager flag or reject them", async () => {
    const user = userEvent.setup();

    render(<UnresolvedProducts />);

	    expect(mocks.usePOSPendingCheckoutItemsForReview).toHaveBeenCalledWith(
	      "store-1",
	    );
	    expect(mocks.usePOSRegisterCatalog).toHaveBeenCalledWith("store-1");
    expect(screen.getByText("Pending checkout items")).toBeInTheDocument();
    expect(screen.getByText("Uncataloged gel")).toBeInTheDocument();
    expect(
      screen.getByText(/Sold 2 across 1 sale .* 999999999999/),
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText("Catalog SKU for Uncataloged gel"),
      "product-1:sku-1",
    );
    await user.click(screen.getByRole("button", { name: "Link" }));
    await user.click(screen.getByRole("button", { name: "Flag" }));
    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(mocks.resolvePendingCheckoutItem).toHaveBeenNthCalledWith(1, {
      approvedProductId: "product-1",
      approvedProductSkuId: "sku-1",
      pendingCheckoutItemId: "pending-1",
      status: "linked_to_catalog",
      storeId: "store-1",
    });
    expect(mocks.resolvePendingCheckoutItem).toHaveBeenNthCalledWith(2, {
      pendingCheckoutItemId: "pending-1",
      status: "flagged",
      storeId: "store-1",
    });
    expect(mocks.resolvePendingCheckoutItem).toHaveBeenNthCalledWith(3, {
      pendingCheckoutItemId: "pending-1",
      status: "rejected",
      storeId: "store-1",
    });
  });
});
