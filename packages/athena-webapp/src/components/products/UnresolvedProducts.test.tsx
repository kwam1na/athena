import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnresolvedProducts } from "./UnresolvedProducts";

const mocks = vi.hoisted(() => ({
  useGetUnresolvedProducts: vi.fn(),
}));

vi.mock("~/src/hooks/useGetProducts", () => ({
  useGetUnresolvedProducts: () => mocks.useGetUnresolvedProducts(),
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
  });

  it("renders unresolved products without the pending checkout review queue", () => {
    render(<UnresolvedProducts />);

    expect(screen.getByText("Unresolved Products")).toBeInTheDocument();
    expect(screen.getByTestId("unresolved-products-table")).toBeInTheDocument();
    expect(screen.queryByText("Pending checkout items")).not.toBeInTheDocument();
  });
});
