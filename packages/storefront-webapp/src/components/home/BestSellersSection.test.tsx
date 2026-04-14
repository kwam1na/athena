import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, HTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";

import { BestSellersSection } from "./BestSellersSection";

vi.mock("@/contexts/StoreContext", () => ({
  useStoreContext: () => ({
    formatter: {
      format: (value: number) => `$${value.toFixed(2)}`,
    },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params: _params,
    search: _search,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    params?: unknown;
    search?: unknown;
  }) => <a {...props}>{children}</a>,
}));

vi.mock("../ProductCard", () => ({
  ProductSkuCard: () => <div>Mock Product Card</div>,
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      initial: _initial,
      whileInView: _whileInView,
      viewport: _viewport,
      transition: _transition,
      animate: _animate,
      ...props
    }: HTMLAttributes<HTMLDivElement> & {
      initial?: unknown;
      whileInView?: unknown;
      viewport?: unknown;
      transition?: unknown;
      animate?: unknown;
    }) => (
      <div {...props}>{children}</div>
    ),
  },
}));

describe("BestSellersSection", () => {
  it("renders the best sellers section when products are present", () => {
    render(
      <BestSellersSection
        origin="homepage"
        bestSellersProducts={[
          {
            _id: "sku_1",
            productId: "product_1",
            sku: "SKU-1",
            price: 10,
          } as any,
        ]}
      />,
    );

    expect(screen.getByText("Shop best sellers")).toBeInTheDocument();
  });
});
