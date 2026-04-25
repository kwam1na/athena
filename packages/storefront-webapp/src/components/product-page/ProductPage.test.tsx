import type { HTMLAttributes, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ProductPage from "./ProductPage";
import { useProductPageLogic } from "@/hooks/useProductPageLogic";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    main: ({ children, ...props }: HTMLAttributes<HTMLElement>) => (
      <main {...props}>{children}</main>
    ),
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStoreContext: () => ({ store: {} }),
}));

vi.mock("@/hooks/useTrackAction", () => ({
  useTrackAction: () => ({ track: vi.fn() }),
}));

vi.mock("@/hooks/useProductPageLogic", () => ({
  useProductPageLogic: vi.fn(),
}));

vi.mock("@/lib/storeConfig", () => ({
  getStoreFallbackImageUrl: () => "https://example.com/fallback.jpg",
}));

describe("ProductPage", () => {
  it("renders not found when a product has no visible skus", () => {
    vi.mocked(useProductPageLogic).mockReturnValue({
      productSlug: "sample-product",
      product: {
        _id: "product-1",
        skus: [],
      },
      error: null,
      selectedSku: null,
      setSelectedSku: vi.fn(),
      isSheetOpen: false,
      setIsSheetOpen: vi.fn(),
      sheetContent: { current: null },
      handleUpdateBag: vi.fn(),
      handleUpdateSavedBag: vi.fn(),
      savedBagItem: null,
      formatter: (value: number) => `${value}`,
      isSoldOut: false,
      isLowStock: false,
      isPromoCodeItem: false,
      addedItemSuccessfully: false,
      isUpdatingBag: false,
      bagAction: "add",
      productDiscount: null,
    } as any);

    render(<ProductPage />);

    expect(
      screen.getByText("The page you're looking for does not exist"),
    ).toBeInTheDocument();
  });
});
