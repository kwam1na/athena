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
  it("lets comfortable mobile product names wrap instead of clipping", () => {
    render(
      <CartItems
        cartItems={[
          {
            id: "item-1" as never,
            barcode: "812429039192",
            image: "https://example.com/product.jpg",
            name: "Ebin Lace Bond Extreme Firm Hold Spray",
            price: 2500,
            quantity: 1,
            sku: "KK38-W78-N4G",
          },
        ]}
        readOnly
      />,
    );

    const productName = screen.getByText(
      "Ebin Lace Bond Extreme Firm Hold Spray",
    );
    expect(productName).toHaveClass("leading-5", "sm:line-clamp-2");
    expect(productName).not.toHaveClass("truncate");
    expect(screen.getByText("KK38-W78-N4G")).toHaveClass("break-all");
  });

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
    expect(screen.getByText("Items · 2 · GH₵185")).toBeInTheDocument();
  });

  it("does not render legacy NULL metadata on cart items", () => {
    render(
      <CartItems
        cartItems={[
          {
            id: "item-1" as never,
            barcode: "",
            color: "NULL",
            name: "Fluffy Bonnet",
            price: 3000,
            quantity: 3,
            size: "NULL",
            sku: "6N2Y-2Q6-3KF",
          },
        ]}
      />,
    );

    expect(screen.getByText("Fluffy Bonnet")).toBeInTheDocument();
    expect(screen.getByText("6N2Y-2Q6-3KF")).toBeInTheDocument();
    expect(screen.queryByText("NULL")).not.toBeInTheDocument();
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

  it("gives compact product quantity controls larger touch targets and accepts typed quantities", async () => {
    const user = userEvent.setup();
    const onUpdateQuantity = vi.fn();

    render(
      <CartItems
        density="compact"
        cartItems={[
          {
            id: "item-1" as never,
            barcode: "4739394883944",
            name: "Nicca",
            price: 6500,
            quantity: 6,
            sku: "6N2Y-WMA",
          },
        ]}
        onUpdateQuantity={onUpdateQuantity}
      />,
    );

    const quantityInput = screen.getByRole("spinbutton", {
      name: /quantity for nicca/i,
    });
    expect(quantityInput).toHaveClass("h-11", "w-14");
    await user.click(
      screen.getByRole("button", { name: /increase quantity for nicca/i }),
    );

    expect(onUpdateQuantity).toHaveBeenCalledWith("item-1", 7);

    await user.clear(quantityInput);
    await user.type(quantityInput, "9");
    await user.tab();

    expect(onUpdateQuantity).toHaveBeenCalledWith("item-1", 9);
  });

  it("lets the decrement button remove a quantity-one product line", async () => {
    const user = userEvent.setup();
    const onUpdateQuantity = vi.fn();

    render(
      <CartItems
        cartItems={[
          {
            id: "item-1" as never,
            barcode: "4739394883944",
            name: "Amin Uh",
            price: 109900,
            quantity: 1,
            sku: "6N2Y-RGV-A54",
          },
        ]}
        onUpdateQuantity={onUpdateQuantity}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: /decrease quantity for amin uh/i,
      }),
    );

    expect(onUpdateQuantity).toHaveBeenCalledWith("item-1", 0);
    expect(
      screen.getByRole("spinbutton", { name: /quantity for amin uh/i }),
    ).toHaveValue(1);
  });

  it("removes a product line with one click from the trash button", async () => {
    const user = userEvent.setup();
    const onRemoveItem = vi.fn();

    render(
      <CartItems
        cartItems={[
          {
            id: "item-1" as never,
            barcode: "4739394883944",
            name: "Kang Fa",
            price: 1500,
            quantity: 1,
            sku: "6N2Y-MQR-KG9",
          },
        ]}
        onRemoveItem={onRemoveItem}
      />,
    );

    await user.click(screen.getByRole("button", { name: /remove kang fa/i }));

    expect(onRemoveItem).toHaveBeenCalledOnce();
    expect(onRemoveItem).toHaveBeenCalledWith("item-1");
  });
});
