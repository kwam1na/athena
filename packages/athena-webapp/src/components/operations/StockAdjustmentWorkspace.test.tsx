import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";
import { ok, userError } from "~/shared/commandResult";

import { StockAdjustmentWorkspaceContent } from "./StockAdjustmentWorkspace";

const mockedHandlers = vi.hoisted(() => ({
  onSubmitBatch: vi.fn(),
}));

const mockedToast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: mockedToast,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    params: (prev: {
      orgUrlSlug?: string;
      storeUrlSlug?: string;
    }) => {
      orgUrlSlug: string;
      productSlug: string;
      storeUrlSlug: string;
    };
    search?: { o?: string };
    to: string;
  }) => {
    const nextParams = params({
      orgUrlSlug: "wigclub",
      storeUrlSlug: "wigclub",
    });
    const href = to
      .replace("$orgUrlSlug", nextParams.orgUrlSlug)
      .replace("$storeUrlSlug", nextParams.storeUrlSlug)
      .replace("$productSlug", nextParams.productSlug);
    const searchParams = search?.o ? `?o=${search.o}` : "";

    return (
      <a href={`${href}${searchParams}`} {...props}>
        {children}
      </a>
    );
  },
}));

const baseProps = {
  inventoryItems: [
    {
      _id: "sku-1" as Id<"productSku">,
      colorName: "natural black",
      imageUrl: "https://cdn.example.com/closure-wig.jpg",
      inventoryCount: 8,
      length: 18,
      productCategory: "Hair",
      productId: "product-1" as Id<"product">,
      productName: "closure wig",
      quantityAvailable: 6,
      sku: "CW-18",
    },
    {
      _id: "sku-2" as Id<"productSku">,
      imageUrl: "https://cdn.example.com/body-wave.jpg",
      inventoryCount: 3,
      productCategory: "Hair",
      productId: "product-2" as Id<"product">,
      productName: "body wave bundle",
      quantityAvailable: 3,
      sku: "BW-24",
    },
  ],
  isSubmitting: false,
  onSubmitBatch: mockedHandlers.onSubmitBatch,
  storeId: "store-1" as Id<"store">,
};

function renderStockAdjustmentWorkspace(
  props: Partial<ComponentProps<typeof StockAdjustmentWorkspaceContent>> = {},
) {
  render(<StockAdjustmentWorkspaceContent {...baseProps} {...props} />);
}

describe("StockAdjustmentWorkspaceContent", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    mockedToast.error.mockReset();
    mockedToast.success.mockReset();
    mockedHandlers.onSubmitBatch.mockReset();
    mockedHandlers.onSubmitBatch.mockResolvedValue(ok({ _id: "batch-1" }));
  });

  beforeEach(() => {
    window.history.replaceState(
      null,
      "",
      "/wigclub/store/wigclub/operations/stock-adjustments",
    );
  });

  it("submits manual adjustments with a reason code and only changed rows", async () => {
    mockedHandlers.onSubmitBatch.mockResolvedValue(ok({ _id: "batch-1" }));
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const user = userEvent.setup();

    renderStockAdjustmentWorkspace();

    await user.click(screen.getByRole("tab", { name: /manual adjustment/i }));
    await user.click(screen.getByLabelText(/reason code/i));
    await user.click(await screen.findByRole("option", { name: "Damage" }));
    await user.clear(
      screen.getByLabelText(/adjustment delta for .*closure wig/i)
    );
    await user.type(
      screen.getByLabelText(/adjustment delta for .*closure wig/i),
      "-2"
    );
    await user.click(screen.getByRole("button", { name: /submit adjustment/i }));

    await waitFor(() =>
      expect(baseProps.onSubmitBatch).toHaveBeenCalledWith({
        adjustmentType: "manual",
        lineItems: [
          {
            productSkuId: "sku-1",
            quantityDelta: -2,
          },
        ],
        notes: undefined,
        reasonCode: "damage",
        storeId: "store-1",
        submissionKey: "stock-adjustment-manual-rs",
      })
    );
    await waitFor(() =>
      expect(mockedToast.success).toHaveBeenCalledWith(
        "Stock adjustment applied"
      )
    );
  });

  it("submits cycle counts with counted quantities and filters unchanged lines", async () => {
    mockedHandlers.onSubmitBatch.mockResolvedValue(ok({ _id: "batch-1" }));
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const user = userEvent.setup();

    renderStockAdjustmentWorkspace();

    expect(screen.getByText("Count in progress")).toBeInTheDocument();

    await user.clear(
      screen.getByLabelText(/counted quantity for body wave bundle/i)
    );
    await user.type(
      screen.getByLabelText(/counted quantity for body wave bundle/i),
      "7"
    );
    await user.click(screen.getByRole("button", { name: /submit count/i }));

    await waitFor(() =>
      expect(baseProps.onSubmitBatch).toHaveBeenCalledWith({
        adjustmentType: "cycle_count",
        lineItems: [
          {
            countedQuantity: 7,
            productSkuId: "sku-2",
          },
        ],
        notes: undefined,
        reasonCode: "cycle_count_reconciliation",
        storeId: "store-1",
        submissionKey: "stock-adjustment-cycle_count-rs",
      })
    );
    await waitFor(() =>
      expect(mockedToast.success).toHaveBeenCalledWith("Count applied")
    );
    expect(screen.getByText("Count applied")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Operator count submitted. Inventory movements have been written.",
      ),
    ).toBeInTheDocument();
  });

  it("resets an edited cycle count field to the original system count", async () => {
    const user = userEvent.setup();

    renderStockAdjustmentWorkspace();

    const bodyWaveInput = screen.getByLabelText(
      /counted quantity for body wave bundle/i,
    );

    await user.clear(bodyWaveInput);
    await user.type(bodyWaveInput, "7");

    const resetButton = screen.getByRole("button", {
      name: /restore original value for body wave bundle/i,
    });

    expect(bodyWaveInput).toHaveValue(7);
    expect(resetButton).toBeEnabled();

    await user.click(resetButton);

    expect(bodyWaveInput).toHaveValue(3);
    expect(resetButton).toBeDisabled();
  });

  it("orients cycle counts around a selected category scope", async () => {
    const user = userEvent.setup();

    renderStockAdjustmentWorkspace({
      inventoryItems: [
        {
          _id: "sku-1" as Id<"productSku">,
          inventoryCount: 8,
          productCategory: "Hair",
          productName: "closure wig",
          quantityAvailable: 6,
          sku: "CW-18",
        },
        {
          _id: "sku-2" as Id<"productSku">,
          inventoryCount: 3,
          productCategory: "Books",
          productName: "ai engineering",
          quantityAvailable: 3,
          sku: "BOOK-1",
        },
      ],
    });

    expect(
      screen.getByRole("button", { name: /books 1 sku/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /hair 1 sku/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /books 1 sku/i }),
    ).toHaveAttribute("aria-pressed", "true");
    const table = screen.getByRole("table");

    expect(within(table).getByText("Ai Engineering")).toBeInTheDocument();
    expect(within(table).queryByText("Closure Wig")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /hair 1 sku/i }));

    expect(
      screen.getByRole("button", { name: /hair 1 sku/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(within(table).getByText("Closure Wig")).toBeInTheDocument();
    expect(within(table).queryByText("Ai Engineering")).not.toBeInTheDocument();
  });

  it("uses the app data table pagination for stock rows", async () => {
    const user = userEvent.setup();
    const inventoryItems = Array.from({ length: 11 }, (_, index) => ({
      _id: `sku-${index + 1}` as Id<"productSku">,
      inventoryCount: index + 1,
      productCategory: "Inventory",
      productId: `product-${index + 1}` as Id<"product">,
      productName: `Inventory item ${index + 1}`,
      quantityAvailable: index + 1,
      sku: `SKU-${index + 1}`,
    }));

    renderStockAdjustmentWorkspace({ inventoryItems });

    const table = screen.getByRole("table");

    expect(within(table).getByText("Inventory Item 1")).toBeInTheDocument();
    expect(within(table).queryByText("Inventory Item 11")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1-10 of 11 SKUs")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next page/i }));

    expect(within(table).queryByText("Inventory Item 1")).not.toBeInTheDocument();
    expect(within(table).getByText("Inventory Item 11")).toBeInTheDocument();
    expect(screen.getByText("Showing 11-11 of 11 SKUs")).toBeInTheDocument();

    await user.click(within(table).getByText("Inventory Item 11"));

    expect(screen.getByText("Showing 11-11 of 11 SKUs")).toBeInTheDocument();
  });

  it("shows the active SKU detail image in the right rail", async () => {
    const user = userEvent.setup();

    renderStockAdjustmentWorkspace();

    expect(screen.getByAltText('18" Natural Black Closure Wig')).toHaveAttribute(
      "src",
      "https://cdn.example.com/closure-wig.jpg",
    );

    await user.click(
      screen.getByLabelText(/counted quantity for body wave bundle/i),
    );

    expect(screen.getByAltText("Body Wave Bundle")).toHaveAttribute(
      "src",
      "https://cdn.example.com/body-wave.jpg",
    );
  });

  it("updates the active SKU detail when a stock row is clicked", async () => {
    const user = userEvent.setup();

    renderStockAdjustmentWorkspace();

    expect(
      screen.getByRole("link", {
        name: /view product detail for .*closure wig/i,
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/wigclub/products/product-1?o=%2Fwigclub%2Fstore%2Fwigclub%2Foperations%2Fstock-adjustments",
    );

    const bodyWaveRow = screen.getByText("Body Wave Bundle").closest("tr");
    expect(bodyWaveRow).not.toBeNull();

    await user.click(bodyWaveRow!);

    expect(screen.getByAltText("Body Wave Bundle")).toHaveAttribute(
      "src",
      "https://cdn.example.com/body-wave.jpg",
    );
    expect(
      screen.getByRole("link", {
        name: /view product detail for body wave bundle/i,
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/wigclub/products/product-2?o=%2Fwigclub%2Fstore%2Fwigclub%2Foperations%2Fstock-adjustments",
    );
    expect(bodyWaveRow).toHaveClass("bg-muted/60");
  });

  it("presents safe command errors without raising a success toast", async () => {
    const user = userEvent.setup();
    mockedHandlers.onSubmitBatch.mockResolvedValueOnce(
      userError({
        code: "authorization_failed",
        message: "You do not have permission to adjust stock for this store.",
      })
    );

    renderStockAdjustmentWorkspace();

    await user.click(screen.getByRole("tab", { name: /manual adjustment/i }));
    await user.clear(
      screen.getByLabelText(/adjustment delta for .*closure wig/i)
    );
    await user.type(
      screen.getByLabelText(/adjustment delta for .*closure wig/i),
      "-2"
    );
    await user.click(screen.getByRole("button", { name: /submit adjustment/i }));

    await waitFor(() =>
      expect(mockedToast.error).toHaveBeenCalledWith(
        "You do not have permission to adjust stock for this store."
      )
    );
    expect(mockedToast.success).not.toHaveBeenCalled();
  });
});
