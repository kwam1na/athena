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

  it("shows service totals without a quantity count", () => {
    render(
      <CartItems
        cartItems={[]}
        serviceItems={[buildServiceLine({ price: 40000, quantity: 2 })]}
        onRemoveService={vi.fn()}
      />,
    );

    expect(screen.queryByText("x2")).not.toBeInTheDocument();
    expect(screen.queryByText("2 x GH₵400")).not.toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
    expect(screen.getByText("GH₵800")).toBeInTheDocument();
    expect(screen.getByText("GH₵800").closest(".col-span-2")).toHaveClass(
      "col-span-2",
      "justify-end",
    );
    expect(screen.getByRole("button").closest(".col-span-1")).toHaveClass(
      "col-span-1",
    );
  });

  it("aligns compact service pricing like compact product rows", () => {
    render(
      <CartItems
        cartItems={[]}
        density="compact"
        serviceItems={[
          buildServiceLine({
            price: 40000,
            pricingModel: "fixed",
            quantity: 2,
            serviceMode: "revamp",
          }),
        ]}
      />,
    );

    expect(screen.getByText(/revamp · fixed price/i)).toBeInTheDocument();
    expect(screen.getByText("GH₵400")).toBeInTheDocument();
    expect(screen.getByText("GH₵800")).toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
    expect(screen.queryByText("2 x GH₵400")).not.toBeInTheDocument();
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
