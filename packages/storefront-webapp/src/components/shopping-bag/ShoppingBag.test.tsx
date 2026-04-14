import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ShoppingBagCheckoutButton } from "./ShoppingBag";

describe("ShoppingBagCheckoutButton", () => {
  it("exposes a stable checkout-start hook", () => {
    render(
      <ShoppingBagCheckoutButton
        hasPendingOrders={false}
        isProcessingCheckoutRequest={false}
        isUpdatingBag={false}
        onCheckoutClick={vi.fn()}
      />,
    );

    expect(screen.getByTestId("storefront-bag-start-checkout")).toBeInTheDocument();
  });
});
