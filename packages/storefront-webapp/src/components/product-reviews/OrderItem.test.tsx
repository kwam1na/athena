import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { currencyFormatter } from "@/lib/utils";

import { OrderItem } from "./OrderItem";

vi.mock("@/contexts/StoreContext", () => ({
  useStoreContext: () => ({
    store: undefined,
  }),
}));

describe("product review OrderItem", () => {
  it("renders stored item prices from pesewas without double-converting", () => {
    render(
      <OrderItem
        formatter={currencyFormatter("GHS")}
        item={{
          productName: "Wigclub Bonnets",
          price: 2999,
          quantity: 1,
        }}
      />,
    );

    expect(screen.getByText("GH₵29.99")).toBeInTheDocument();
    expect(screen.queryByText("GH₵2,999")).not.toBeInTheDocument();
  });
});
