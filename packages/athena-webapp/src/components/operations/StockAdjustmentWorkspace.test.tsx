import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";

import { StockAdjustmentWorkspaceContent } from "./StockAdjustmentWorkspace";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const baseProps = {
  inventoryItems: [
    {
      _id: "sku-1" as Id<"productSku">,
      inventoryCount: 8,
      productName: "Closure wig",
      quantityAvailable: 6,
      sku: "CW-18",
    },
    {
      _id: "sku-2" as Id<"productSku">,
      inventoryCount: 3,
      productName: "Body wave bundle",
      quantityAvailable: 3,
      sku: "BW-24",
    },
  ],
  isSubmitting: false,
  onSubmitBatch: vi.fn().mockResolvedValue(undefined),
  storeId: "store-1" as Id<"store">,
};

describe("StockAdjustmentWorkspaceContent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    baseProps.onSubmitBatch.mockClear();
  });

  it("submits manual adjustments with a reason code and only changed rows", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const user = userEvent.setup();

    render(<StockAdjustmentWorkspaceContent {...baseProps} />);

    await user.selectOptions(screen.getByLabelText(/reason code/i), "damage");
    await user.clear(
      screen.getByLabelText(/adjustment delta for closure wig/i)
    );
    await user.type(
      screen.getByLabelText(/adjustment delta for closure wig/i),
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
  });

  it("submits cycle counts with counted quantities and filters unchanged lines", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const user = userEvent.setup();

    render(<StockAdjustmentWorkspaceContent {...baseProps} />);

    await user.click(screen.getByRole("button", { name: /cycle count/i }));
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
  });
});
