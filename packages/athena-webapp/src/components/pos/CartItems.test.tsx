import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CartItems } from "./CartItems";
import type { RegisterServiceLineState } from "@/lib/pos/presentation/register/registerUiState";

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: {
      currency: "GHS",
    },
  }),
}));

function buildServiceLine(
  overrides: Partial<RegisterServiceLineState> = {},
): RegisterServiceLineState {
  return {
    id: "service-line-1",
    serviceCatalogId: "service-1" as RegisterServiceLineState["serviceCatalogId"],
    name: "Closure Repair",
    serviceMode: "repair",
    pricingModel: "starting_at",
    price: 6500,
    quantity: 1,
    amountRequired: false,
    ...overrides,
  };
}

describe("CartItems service lines", () => {
  it("renders service lines separately from product SKU metadata", () => {
    render(
      <CartItems
        cartItems={[
          {
            id: "item-1" as never,
            barcode: "1234567890",
            name: "Body Wave",
            price: 12000,
            quantity: 1,
            sku: "BW-18",
          },
        ]}
        serviceItems={[buildServiceLine()]}
      />,
    );

    expect(screen.getByText("Closure Repair")).toBeInTheDocument();
    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByText(/Entered amount/i)).toBeInTheDocument();
    expect(screen.getByText("Body Wave")).toBeInTheDocument();
    expect(screen.getByText("BW-18")).toBeInTheDocument();
  });

  it("updates editable service amounts and removes service lines", async () => {
    const user = userEvent.setup();
    const onUpdateServiceAmount = vi.fn();
    const onRemoveService = vi.fn();

    render(
      <CartItems
        cartItems={[]}
        serviceItems={[buildServiceLine()]}
        onUpdateServiceAmount={onUpdateServiceAmount}
        onRemoveService={onRemoveService}
      />,
    );

    const amountInput = screen.getByLabelText(/closure repair service amount/i);
    await user.clear(amountInput);
    await user.type(amountInput, "72");
    await user.tab();

    expect(onUpdateServiceAmount).toHaveBeenCalledWith("service-line-1", 7200);

    await user.click(screen.getByRole("button"));

    expect(onRemoveService).toHaveBeenCalledWith("service-line-1");
  });
});
