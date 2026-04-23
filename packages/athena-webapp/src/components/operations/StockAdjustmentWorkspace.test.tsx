import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  onSubmitBatch: mockedHandlers.onSubmitBatch,
  storeId: "store-1" as Id<"store">,
};

describe("StockAdjustmentWorkspaceContent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockedToast.error.mockReset();
    mockedToast.success.mockReset();
    mockedHandlers.onSubmitBatch.mockReset();
    mockedHandlers.onSubmitBatch.mockResolvedValue(ok({ _id: "batch-1" }));
  });

  it("submits manual adjustments with a reason code and only changed rows", async () => {
    mockedHandlers.onSubmitBatch.mockResolvedValue(ok({ _id: "batch-1" }));
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
    await waitFor(() =>
      expect(mockedToast.success).toHaveBeenCalledWith(
        "Cycle count reconciled"
      )
    );
  });

  it("presents safe command errors without raising a success toast", async () => {
    const user = userEvent.setup();
    mockedHandlers.onSubmitBatch.mockResolvedValueOnce(
      userError({
        code: "authorization_failed",
        message: "You do not have permission to adjust stock for this store.",
      })
    );

    render(<StockAdjustmentWorkspaceContent {...baseProps} />);

    await user.clear(
      screen.getByLabelText(/adjustment delta for closure wig/i)
    );
    await user.type(
      screen.getByLabelText(/adjustment delta for closure wig/i),
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
