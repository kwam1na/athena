import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProductOperationalTimeline } from "./ProductOperationalTimeline";

const mocks = vi.hoisted(() => ({
  useGetActiveStore: vi.fn(),
  useProduct: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    operations: {
      operationalEvents: {
        listProductOperationalTimeline: "listProductOperationalTimeline",
      },
    },
  },
}));

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: mocks.useGetActiveStore,
}));

vi.mock("~/src/contexts/ProductContext", () => ({
  useProduct: mocks.useProduct,
}));

function renderTimeline(events: unknown[]) {
  mocks.useGetActiveStore.mockReturnValue({
    activeStore: { _id: "store-1" },
  });
  mocks.useProduct.mockReturnValue({
    activeProduct: { _id: "product-1" },
    activeProductVariant: { id: "sku-1" },
  });
  mocks.useQuery.mockReturnValue(events);

  render(<ProductOperationalTimeline />);
}

describe("ProductOperationalTimeline", () => {
  it("renders product and SKU operational events", () => {
    renderTimeline([
      {
        createdAt: Date.UTC(2026, 4, 30, 12),
        id: "event-1",
        message: "Kwamina Nuh quick added Vitamilk with quantity 100.",
        subject: {
          id: "sku-1",
          sku: "SKU-001",
          type: "product_sku",
        },
        type: "pos_quick_add_product_created",
      },
    ]);

    expect(screen.getByText("Operational timeline")).toBeInTheDocument();
    expect(
      screen.getByText("Kwamina Nuh quick added Vitamilk with quantity 100."),
    ).toBeInTheDocument();
    expect(screen.getByText("SKU-001")).toBeInTheDocument();
    expect(screen.getByText("Current SKU")).toBeInTheDocument();
    expect(screen.getByText("1 event")).toBeInTheDocument();
  });

  it("renders an empty state when no operational events exist", () => {
    renderTimeline([]);

    expect(
      screen.getByText("No operational events recorded for this product."),
    ).toBeInTheDocument();
    expect(screen.getByText("0 events")).toBeInTheDocument();
  });
});
