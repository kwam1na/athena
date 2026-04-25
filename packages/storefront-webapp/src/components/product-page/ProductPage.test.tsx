import { cleanup, render, screen } from "@testing-library/react";
import { type HTMLAttributes, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProductPage from "./ProductPage";

const useProductPageLogicMock = vi.fn();

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
    main: ({ children, ...props }: HTMLAttributes<HTMLElement>) => (
      <main {...props}>{children}</main>
    ),
  },
}));

vi.mock("@/hooks/useProductPageLogic", () => ({
  useProductPageLogic: () => useProductPageLogicMock(),
}));

vi.mock("@/hooks/useTrackAction", () => ({
  useTrackAction: vi.fn(),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStoreContext: () => ({ store: {} }),
}));

vi.mock("../states/not-found/NotFound", () => ({
  default: () => <div>The page you're looking for does not exist</div>,
}));

const makePageState = (overrides = {}) =>
  ({
    productSlug: "product-id",
    product: { _id: "product-id", skus: [] },
    error: false,
    selectedSku: null,
    setSelectedSku: vi.fn(),
    isSheetOpen: false,
    setIsSheetOpen: vi.fn(),
    sheetContent: { current: null },
    handleUpdateBag: vi.fn(),
    handleUpdateSavedBag: vi.fn(),
    savedBagItem: null,
    formatter: new Intl.NumberFormat("en-US"),
    isSoldOut: false,
    isLowStock: false,
    isPromoCodeItem: false,
    addedItemSuccessfully: null,
    isUpdatingBag: false,
    bagAction: "add" as const,
    productDiscount: null,
    ...overrides,
  }) as any;

beforeEach(() => {
  window.scrollTo = vi.fn();
  cleanup();
  useProductPageLogicMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ProductPage", () => {
  it("shows not found for a hidden product", () => {
    useProductPageLogicMock.mockReturnValue(
      makePageState({
        product: {
          _id: "product-id",
          isVisible: false,
          skus: [{ _id: "sku-id", images: [], price: 1000, isVisible: true }],
        },
        selectedSku: {
          _id: "sku-id",
          sku: "SKU-ID",
          images: [],
          price: 1000,
          isVisible: true,
        },
      }),
    );

    render(<ProductPage />);

    expect(
      screen.getByText("The page you're looking for does not exist"),
    ).toBeInTheDocument();
  });

  it("shows not found when the single visible product SKU is hidden", () => {
    useProductPageLogicMock.mockReturnValue(
      makePageState({
        product: {
          _id: "product-id",
          skus: [{ _id: "sku-id", images: [], price: 1000, isVisible: false }],
        },
        selectedSku: {
          _id: "sku-id",
          sku: "SKU-ID",
          images: [],
          price: 1000,
          isVisible: false,
        },
      }),
    );

    render(<ProductPage />);

    expect(
      screen.getByText("The page you're looking for does not exist"),
    ).toBeInTheDocument();
  });

  it("shows not found when backend returns no visible single SKU", () => {
    useProductPageLogicMock.mockReturnValue(
      makePageState({
        product: {
          _id: "product-id",
          isVisible: true,
          skus: [],
        },
        selectedSku: null,
      }),
    );

    render(<ProductPage />);

    expect(
      screen.getByText("The page you're looking for does not exist"),
    ).toBeInTheDocument();
  });
});
