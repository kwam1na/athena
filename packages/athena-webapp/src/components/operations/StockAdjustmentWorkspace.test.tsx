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
    params: (prev: { orgUrlSlug?: string; storeUrlSlug?: string }) => {
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
      barcode: "1234567890123",
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
  });

  beforeEach(() => {
    mockedHandlers.onSubmitBatch.mockResolvedValue(ok({ _id: "batch-1" }));
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
      screen.getByLabelText(/adjustment delta for .*closure wig/i),
    );
    await user.type(
      screen.getByLabelText(/adjustment delta for .*closure wig/i),
      "-2",
    );
    await user.click(
      screen.getByRole("button", { name: /submit adjustment/i }),
    );

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
      }),
    );
    await waitFor(() =>
      expect(mockedToast.success).toHaveBeenCalledWith(
        "Stock adjustment applied",
      ),
    );
  });

  it("submits cycle counts with counted quantities and filters unchanged lines", async () => {
    mockedHandlers.onSubmitBatch.mockResolvedValue(ok({ _id: "batch-1" }));
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const user = userEvent.setup();

    renderStockAdjustmentWorkspace();

    expect(screen.getByText("Count in progress")).toBeInTheDocument();

    await user.clear(
      screen.getByLabelText(/counted quantity for body wave bundle/i),
    );
    await user.type(
      screen.getByLabelText(/counted quantity for body wave bundle/i),
      "7",
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
      }),
    );
    await waitFor(() =>
      expect(mockedToast.success).toHaveBeenCalledWith("Count applied"),
    );
    expect(screen.getByText("Count applied")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Operator count submitted. Inventory movements have been written.",
      ),
    ).toBeInTheDocument();
  });

  it("hydrates cycle count inputs from saved draft lines", () => {
    renderStockAdjustmentWorkspace({
      cycleCountDraft: {
        _id: "draft-1" as Id<"cycleCountDraft">,
        changedLineCount: 1,
        lastSavedAt: 1000,
        lines: [
          {
            baselineAvailableCount: 6,
            baselineInventoryCount: 8,
            countedQuantity: 5,
            isDirty: true,
            productSkuId: "sku-1" as Id<"productSku">,
          },
        ],
        scopeKey: "Hair",
        staleLineCount: 0,
        status: "open",
      },
    });

    expect(
      screen.getByLabelText(/counted quantity for .*closure wig/i),
    ).toHaveValue(5);
    expect(
      screen.getByText(/saved count: 1 SKU across 1 scope/i),
    ).toBeInTheDocument();
  });

  it("hides discard when the active count has no saved SKU changes", () => {
    renderStockAdjustmentWorkspace({
      cycleCountDraft: {
        _id: "draft-1" as Id<"cycleCountDraft">,
        changedLineCount: 0,
        lines: [],
        scopeKey: "Hair",
        staleLineCount: 0,
        status: "open",
      },
      onDiscardCycleCountDraft: vi.fn().mockResolvedValue(ok({})),
    });

    expect(
      screen.queryByRole("button", { name: /discard draft/i }),
    ).not.toBeInTheDocument();
  });

  it("hides discard after a cycle count is applied", async () => {
    const user = userEvent.setup();
    const onSubmitCycleCountDraft = vi.fn().mockResolvedValue(ok({}));

    renderStockAdjustmentWorkspace({
      cycleCountDraft: {
        _id: "draft-1" as Id<"cycleCountDraft">,
        changedLineCount: 1,
        lines: [
          {
            baselineAvailableCount: 6,
            baselineInventoryCount: 8,
            countedQuantity: 5,
            isDirty: true,
            productSkuId: "sku-1" as Id<"productSku">,
          },
        ],
        scopeKey: "Hair",
        staleLineCount: 0,
        status: "open",
      },
      onDiscardCycleCountDraft: vi.fn().mockResolvedValue(ok({})),
      onSubmitCycleCountDraft,
    });

    expect(
      screen.getByRole("button", { name: /discard draft/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /submit count/i }));

    await waitFor(() =>
      expect(mockedToast.success).toHaveBeenCalledWith("Count applied"),
    );
    expect(
      screen.queryByRole("button", { name: /discard draft/i }),
    ).not.toBeInTheDocument();
  });

  it("summarizes saved draft SKUs across all scopes in the batch rail", () => {
    renderStockAdjustmentWorkspace({
      cycleCountDraft: {
        _id: "draft-1" as Id<"cycleCountDraft">,
        changedLineCount: 2,
        lastSavedAt: 1000,
        lines: [
          {
            baselineAvailableCount: 6,
            baselineInventoryCount: 8,
            countedQuantity: 5,
            isDirty: true,
            productSkuId: "sku-1" as Id<"productSku">,
          },
          {
            baselineAvailableCount: 3,
            baselineInventoryCount: 3,
            countedQuantity: 7,
            isDirty: true,
            productSkuId: "sku-2" as Id<"productSku">,
          },
        ],
        scopeKey: "Hair",
        staleLineCount: 0,
        status: "open",
      },
      cycleCountDraftSummary: {
        changedLineCount: 5,
        draftCount: 3,
        largestAbsoluteDelta: 4,
        lastSavedAt: 2000,
        netQuantityDelta: -9,
        scopeKeys: ["Beverages", "Hair"],
        scopeCount: 3,
        staleLineCount: 0,
      },
    });

    expect(
      screen.getByText(/saved count: 5 SKUs across 3 scopes/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/current: hair, 2 SKUs/i)).toBeInTheDocument();
    expect(screen.getByText(/scopes: beverages, hair/i)).toBeInTheDocument();
    expect(screen.getByText("Count metrics")).toBeInTheDocument();
    expect(screen.getByText("All saved counts")).toBeInTheDocument();
    expect(screen.getByText("Selected scope")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("-9")).toBeInTheDocument();
    expect(screen.getAllByText("SKUs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Net").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Variance").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
  });

  it("submits the overall cycle count draft when the current scope has no changes", async () => {
    const user = userEvent.setup();
    const onSubmitCycleCountDraft = vi.fn().mockResolvedValue(ok({}));

    renderStockAdjustmentWorkspace({
      cycleCountDraft: {
        _id: "draft-1" as Id<"cycleCountDraft">,
        changedLineCount: 0,
        lines: [],
        scopeKey: "Hair",
        staleLineCount: 0,
        status: "open",
      },
      cycleCountDraftSummary: {
        changedLineCount: 5,
        draftCount: 2,
        largestAbsoluteDelta: 4,
        netQuantityDelta: 23,
        scopeKeys: ["Beverages", "Hair Tools"],
        scopeCount: 2,
        staleLineCount: 0,
      },
      onSubmitCycleCountDraft,
    });

    await user.click(screen.getByRole("button", { name: /submit count/i }));

    await waitFor(() =>
      expect(onSubmitCycleCountDraft).toHaveBeenCalledWith({
        notes: undefined,
      }),
    );
    expect(mockedToast.error).not.toHaveBeenCalledWith(
      "Enter at least one counted SKU that differs from the system stock",
    );
  });

  it("saves cycle count edits on blur without using the URL", async () => {
    const user = userEvent.setup();
    const onSaveCycleCountDraftLine = vi.fn().mockResolvedValue(ok({}));
    const onSearchStateChange = vi.fn();

    renderStockAdjustmentWorkspace({
      onSaveCycleCountDraftLine,
      onSearchStateChange,
      searchState: {
        mode: "cycle_count",
        page: 1,
        scope: "Hair",
        sku: "sku-1",
      },
    });

    const input = screen.getByLabelText(/counted quantity for .*closure wig/i);

    await user.clear(input);
    await user.type(input, "5");
    await user.tab();

    await waitFor(() =>
      expect(onSaveCycleCountDraftLine).toHaveBeenCalledWith({
        countedQuantity: 5,
        productSkuId: "sku-1",
      }),
    );
    expect(onSearchStateChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ countedQuantity: 5 }),
    );
  });

  it("flushes the focused cycle count edit before submitting", async () => {
    const user = userEvent.setup();
    const onSaveCycleCountDraftLine = vi.fn().mockResolvedValue(ok({}));
    const onSubmitCycleCountDraft = vi.fn().mockResolvedValue(ok({}));

    renderStockAdjustmentWorkspace({
      cycleCountDraft: {
        _id: "draft-1" as Id<"cycleCountDraft">,
        changedLineCount: 0,
        lines: [],
        scopeKey: "Hair",
        staleLineCount: 0,
        status: "open",
      },
      cycleCountDraftSummary: {
        changedLineCount: 0,
        draftCount: 0,
        largestAbsoluteDelta: 0,
        netQuantityDelta: 0,
        scopeKeys: [],
        scopeCount: 0,
        staleLineCount: 0,
      },
      onSaveCycleCountDraftLine,
      onSubmitCycleCountDraft,
    });

    const input = screen.getByLabelText(/counted quantity for .*closure wig/i);

    await user.clear(input);
    await user.type(input, "5");
    await user.click(screen.getByRole("button", { name: /submit count/i }));

    await waitFor(() =>
      expect(onSaveCycleCountDraftLine).toHaveBeenCalledWith({
        countedQuantity: 5,
        productSkuId: "sku-1",
      }),
    );
    await waitFor(() =>
      expect(onSubmitCycleCountDraft).toHaveBeenCalledWith({
        notes: undefined,
      }),
    );
  });

  it("keeps unsaved typing when another draft line refreshes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <StockAdjustmentWorkspaceContent
        {...baseProps}
        cycleCountDraft={{
          _id: "draft-1" as Id<"cycleCountDraft">,
          changedLineCount: 0,
          lines: [],
          scopeKey: "Hair",
          staleLineCount: 0,
          status: "open",
        }}
      />,
    );

    const bodyWaveInput = screen.getByLabelText(
      /counted quantity for body wave bundle/i,
    );

    await user.clear(bodyWaveInput);
    await user.type(bodyWaveInput, "7");

    rerender(
      <StockAdjustmentWorkspaceContent
        {...baseProps}
        cycleCountDraft={{
          _id: "draft-1" as Id<"cycleCountDraft">,
          changedLineCount: 1,
          lines: [
            {
              baselineAvailableCount: 6,
              baselineInventoryCount: 8,
              countedQuantity: 5,
              isDirty: true,
              productSkuId: "sku-1" as Id<"productSku">,
            },
          ],
          scopeKey: "Hair",
          staleLineCount: 0,
          status: "open",
        }}
      />,
    );

    expect(
      screen.getByLabelText(/counted quantity for body wave bundle/i),
    ).toHaveValue(7);
  });

  it("blocks stale draft submission feedback and names affected SKUs", async () => {
    const user = userEvent.setup();
    const onSubmitCycleCountDraft = vi.fn().mockResolvedValue(
      userError({
        code: "precondition_failed",
        message:
          "Inventory changed since this count started. Review the affected SKUs before submitting.",
        metadata: {
          staleLines: [
            {
              baselineInventoryCount: 8,
              currentInventoryCount: 9,
              productName: "Closure wig",
              productSkuId: "sku-1",
              sku: "CW-18",
            },
          ],
        },
      }),
    );

    renderStockAdjustmentWorkspace({
      cycleCountDraft: {
        _id: "draft-1" as Id<"cycleCountDraft">,
        changedLineCount: 1,
        lines: [
          {
            baselineAvailableCount: 6,
            baselineInventoryCount: 8,
            countedQuantity: 5,
            isDirty: true,
            productSkuId: "sku-1" as Id<"productSku">,
          },
        ],
        scopeKey: "Hair",
        staleLineCount: 0,
        status: "open",
      },
      onSubmitCycleCountDraft,
    });

    await user.click(screen.getByRole("button", { name: /submit count/i }));

    expect(
      await screen.findByText("Inventory changed since this count started."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Closure wig: 8 to 9 on hand/i),
    ).toBeInTheDocument();
    expect(mockedToast.success).not.toHaveBeenCalledWith("Count applied");
  });

  it("refreshes a stale SKU baseline from the stale state", async () => {
    const user = userEvent.setup();
    const onRefreshCycleCountDraftLineBaseline = vi
      .fn()
      .mockResolvedValue(ok({}));
    const onSubmitCycleCountDraft = vi.fn().mockResolvedValue(
      userError({
        code: "precondition_failed",
        message:
          "Inventory changed since this count started. Review the affected SKUs before submitting.",
        metadata: {
          staleLines: [
            {
              baselineInventoryCount: 8,
              currentInventoryCount: 9,
              productName: "Closure wig",
              productSkuId: "sku-1",
              sku: "CW-18",
            },
          ],
        },
      }),
    );

    renderStockAdjustmentWorkspace({
      cycleCountDraft: {
        _id: "draft-1" as Id<"cycleCountDraft">,
        changedLineCount: 1,
        lines: [
          {
            baselineAvailableCount: 6,
            baselineInventoryCount: 8,
            countedQuantity: 5,
            isDirty: true,
            productSkuId: "sku-1" as Id<"productSku">,
          },
        ],
        scopeKey: "Hair",
        staleLineCount: 0,
        status: "open",
      },
      onRefreshCycleCountDraftLineBaseline,
      onSubmitCycleCountDraft,
    });

    await user.click(screen.getByRole("button", { name: /submit count/i }));
    await user.click(
      await screen.findByRole("button", { name: /use latest stock/i }),
    );

    await waitFor(() =>
      expect(onRefreshCycleCountDraftLineBaseline).toHaveBeenCalledWith({
        productSkuId: "sku-1",
      }),
    );
    expect(mockedToast.success).toHaveBeenCalledWith("Baseline refreshed");
    expect(
      screen.queryByText("Inventory changed since this count started."),
    ).not.toBeInTheDocument();
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
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: /show all scopes/i }),
    ).toBeDisabled();
    const table = screen.getByRole("table");

    expect(within(table).getByText("Ai Engineering")).toBeInTheDocument();
    expect(within(table).getByText("Closure Wig")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /hair 1 sku/i }));

    expect(screen.getByRole("button", { name: /hair 1 sku/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /show all scopes/i }),
    ).toBeEnabled();
    expect(within(table).getByText("Closure Wig")).toBeInTheDocument();
    expect(within(table).queryByText("Ai Engineering")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /hair 1 sku/i }));

    expect(screen.getByRole("button", { name: /hair 1 sku/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByRole("button", { name: /show all scopes/i }),
    ).toBeDisabled();
    expect(within(table).getByText("Closure Wig")).toBeInTheDocument();
    expect(within(table).getByText("Ai Engineering")).toBeInTheDocument();
  });

  it("shows stock scopes in manual adjustment mode", async () => {
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
      searchState: {
        mode: "manual",
      },
    });

    expect(
      screen.getByRole("button", { name: /books 1 sku/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /hair 1 sku/i }),
    ).toBeInTheDocument();

    const table = screen.getByRole("table");

    expect(within(table).getByText("Ai Engineering")).toBeInTheDocument();
    expect(within(table).getByText("Closure Wig")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /books 1 sku/i }));

    expect(
      screen.getByRole("button", { name: /books 1 sku/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(within(table).getByText("Ai Engineering")).toBeInTheDocument();
    expect(within(table).queryByText("Closure Wig")).not.toBeInTheDocument();
  });

  it("leads with the current inventory availability state", () => {
    renderStockAdjustmentWorkspace();

    expect(
      screen.getByRole("heading", {
        name: "1 SKU has reserved units.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/9 of 11 units are available to sell\. Choose a scope/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText("On hand").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Available").length).toBeGreaterThan(0);
    expect(screen.getByText("Reserved")).toBeInTheDocument();
  });

  it("shows POS reserved units as reducing sellable availability", () => {
    renderStockAdjustmentWorkspace({
      inventoryItems: [
        {
          _id: "sku-held" as Id<"productSku">,
          durableQuantityAvailable: 8,
          inventoryCount: 10,
          posReservedQuantity: 2,
          productCategory: "Hair",
          productName: "Held Closure",
          quantityAvailable: 6,
          reservedQuantity: 2,
          sku: "HC-18",
        },
      ],
    });

    expect(
      screen.getByText(
        /6 of 10 units are available to sell\. 2 reserved in POS sessions\./i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("2 POS")).toBeInTheDocument();
  });

  it("shows active checkout reservations beside reduced availability", () => {
    renderStockAdjustmentWorkspace({
      inventoryItems: [
        {
          _id: "sku-checkout-held" as Id<"productSku">,
          checkoutReservedQuantity: 1,
          durableQuantityAvailable: 9,
          inventoryCount: 10,
          productCategory: "Hair",
          productName: "Checkout Held Closure",
          quantityAvailable: 9,
          reservedQuantity: 1,
          sku: "CHC-18",
        },
      ],
    });

    expect(
      screen.getByText(
        /9 of 10 units are available to sell\. 1 reserved in active checkout sessions\./i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("1 checkout")).toBeInTheDocument();
  });

  it("formats inventory status numbers with compact k notation", () => {
    renderStockAdjustmentWorkspace({
      inventoryItems: [
        {
          _id: "sku-large-1" as Id<"productSku">,
          inventoryCount: 20_000,
          productCategory: "Home Care",
          productName: "bulk candle",
          quantityAvailable: 20_000,
          sku: "CANDLE-BULK",
        },
        {
          _id: "sku-large-2" as Id<"productSku">,
          inventoryCount: 727,
          productCategory: "Home Care",
          productName: "room spray",
          quantityAvailable: 727,
          sku: "ROOM-SPRAY",
        },
      ],
    });

    expect(
      screen.getByText(/20\.7k of 20\.7k units are available to sell\./i),
    ).toBeInTheDocument();
    expect(screen.getAllByText("20.7k").length).toBeGreaterThan(1);
  });

  it("filters stock rows by product search and availability", async () => {
    const user = userEvent.setup();

    renderStockAdjustmentWorkspace();

    const table = screen.getByRole("table");

    expect(
      within(table).getByText('18" Natural Black Closure Wig'),
    ).toBeInTheDocument();
    expect(within(table).getByText("Body Wave Bundle")).toBeInTheDocument();

    await user.type(
      screen.getByRole("textbox", {
        name: /search products, skus, or barcodes/i,
      }),
      "body",
    );

    expect(
      within(table).queryByText('18" Natural Black Closure Wig'),
    ).not.toBeInTheDocument();
    expect(within(table).getByText("Body Wave Bundle")).toBeInTheDocument();

    await user.clear(
      screen.getByRole("textbox", {
        name: /search products, skus, or barcodes/i,
      }),
    );
    await user.click(
      screen.getByRole("combobox", { name: /filter by availability/i }),
    );
    await user.click(await screen.findByRole("option", { name: "Reserved" }));

    expect(
      within(table).getByText('18" Natural Black Closure Wig'),
    ).toBeInTheDocument();
    expect(
      within(table).queryByText("Body Wave Bundle"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 2 SKUs.")).toBeInTheDocument();
  });

  it("filters stock rows by barcode", async () => {
    const user = userEvent.setup();

    renderStockAdjustmentWorkspace();

    const table = screen.getByRole("table");

    await user.type(
      screen.getByRole("textbox", {
        name: /search products, skus, or barcodes/i,
      }),
      "1234567890123",
    );

    expect(
      within(table).getByText('18" Natural Black Closure Wig'),
    ).toBeInTheDocument();
    expect(
      within(table).queryByText("Body Wave Bundle"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 2 SKUs.")).toBeInTheDocument();
  });

  it("shows available SKU identifiers in the table and detail rail", () => {
    renderStockAdjustmentWorkspace();

    const table = screen.getByRole("table");
    const row = within(table)
      .getByText('18" Natural Black Closure Wig')
      .closest("tr");

    expect(row).not.toBeNull();
    expect(within(row!).getByText("CW-18")).toBeInTheDocument();
    expect(within(row!).getByText("1234567890123")).toBeInTheDocument();
    expect(within(row!).getByText("Hair")).toBeInTheDocument();
    expect(within(row!).getByText('18"')).toBeInTheDocument();
    expect(within(row!).getByText("natural black")).toBeInTheDocument();
    expect(screen.getAllByText("SKU").length).toBeGreaterThan(1);
    expect(screen.getByText("Barcode")).toBeInTheDocument();
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.getByText("Length")).toBeInTheDocument();
    expect(screen.getByText("Color")).toBeInTheDocument();
  });

  it("renders the fallback image slot when the active SKU has no image", () => {
    renderStockAdjustmentWorkspace({
      inventoryItems: [
        {
          _id: "sku-no-image" as Id<"productSku">,
          colorName: "black",
          inventoryCount: 2,
          length: 12,
          productCategory: "Hair",
          productId: "product-no-image" as Id<"product">,
          productName: "closure",
          quantityAvailable: 2,
          sku: "NO-IMG",
        },
      ],
    });

    expect(screen.getByLabelText("SKU image unavailable")).toBeInTheDocument();
    expect(screen.getAllByText("NO-IMG").length).toBeGreaterThan(1);
    expect(screen.getAllByText("black").length).toBeGreaterThan(1);
  });

  it("filters to reserved SKUs from the inventory state metric", async () => {
    const user = userEvent.setup();
    const onSearchStateChange = vi.fn();

    renderStockAdjustmentWorkspace({
      inventoryItems: [
        {
          _id: "sku-unavailable-hair" as Id<"productSku">,
          inventoryCount: 8,
          productCategory: "Hair",
          productName: "closure wig",
          quantityAvailable: 6,
          sku: "CW-18",
        },
        {
          _id: "sku-available-hair" as Id<"productSku">,
          inventoryCount: 3,
          productCategory: "Hair",
          productName: "body wave bundle",
          quantityAvailable: 3,
          sku: "BW-24",
        },
        {
          _id: "sku-unavailable-books" as Id<"productSku">,
          inventoryCount: 4,
          productCategory: "Books",
          productName: "ai engineering",
          quantityAvailable: 2,
          sku: "BOOK-1",
        },
        {
          _id: "sku-available-makeup" as Id<"productSku">,
          inventoryCount: 5,
          productCategory: "Makeup",
          productName: "lip gloss",
          quantityAvailable: 5,
          sku: "LIP-1",
        },
      ],
      onSearchStateChange,
    });

    const table = screen.getByRole("table");

    expect(within(table).getByText("Ai Engineering")).toBeInTheDocument();
    expect(within(table).getByText("Closure Wig")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /reserved 4/i }));

    expect(onSearchStateChange).toHaveBeenLastCalledWith({
      availability: "unavailable",
      page: 1,
      scope: "Books",
      sku: "sku-unavailable-books",
    });
    expect(screen.getByRole("button", { name: /reserved 4/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(table).getByText("Ai Engineering")).toBeInTheDocument();
    expect(within(table).queryByText("Closure Wig")).not.toBeInTheDocument();
    expect(
      within(table).queryByText("Body Wave Bundle"),
    ).not.toBeInTheDocument();
    expect(within(table).queryByText("Lip Gloss")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 1 SKU.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /reserved 4/i }));

    expect(onSearchStateChange).toHaveBeenLastCalledWith({
      availability: undefined,
      page: 1,
      query: undefined,
      scope: undefined,
      sku: undefined,
    });
    expect(screen.getByRole("button", { name: /reserved 4/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(table).getByText("Ai Engineering")).toBeInTheDocument();
    expect(within(table).getByText("Closure Wig")).toBeInTheDocument();
  });

  it("reports stock filter changes for route search", async () => {
    const user = userEvent.setup();
    const onSearchStateChange = vi.fn();

    renderStockAdjustmentWorkspace({ onSearchStateChange });

    await user.type(
      screen.getByRole("textbox", {
        name: /search products, skus, or barcodes/i,
      }),
      "CW",
    );

    expect(onSearchStateChange).toHaveBeenLastCalledWith({
      availability: undefined,
      page: 1,
      query: "CW",
      sku: undefined,
    });

    await user.click(
      screen.getByRole("combobox", { name: /filter by availability/i }),
    );
    await user.click(await screen.findByRole("option", { name: "Reserved" }));

    expect(onSearchStateChange).toHaveBeenLastCalledWith({
      availability: "unavailable",
      page: 1,
      query: "CW",
      sku: undefined,
    });
  });

  it("marks stock rows when available quantity matches on hand", () => {
    renderStockAdjustmentWorkspace();

    const table = screen.getByRole("table");
    const closureRow = within(table)
      .getByText(/closure wig/i)
      .closest("tr");
    const bodyWaveRow = within(table)
      .getByText("Body Wave Bundle")
      .closest("tr");

    expect(closureRow).not.toBeNull();
    expect(bodyWaveRow).not.toBeNull();
    expect(
      within(closureRow!).queryByText("On hand and available match"),
    ).not.toBeInTheDocument();
    expect(
      within(bodyWaveRow!).getByText("On hand and available match"),
    ).toBeInTheDocument();
    expect(within(bodyWaveRow!).getByText("All available")).toBeInTheDocument();
  });

  it("labels zero stock as none available when on hand matches available", () => {
    renderStockAdjustmentWorkspace({
      inventoryItems: [
        {
          _id: "sku-zero" as Id<"productSku">,
          inventoryCount: 0,
          productCategory: "POS quick add",
          productName: "anker wireless charger",
          quantityAvailable: 0,
          sku: "CHARGER-0",
        },
      ],
    });

    const table = screen.getByRole("table");
    const row = within(table).getByText("Anker Wireless Charger").closest("tr");

    expect(row).not.toBeNull();
    expect(within(row!).getByText("None available")).toBeInTheDocument();
    expect(within(row!).queryByText("All available")).not.toBeInTheDocument();
    expect(
      within(row!).queryByText("0 None available"),
    ).not.toBeInTheDocument();
  });

  it("uses the app data table pagination for stock rows", async () => {
    const user = userEvent.setup();
    const onSearchStateChange = vi.fn();
    const inventoryItems = Array.from({ length: 11 }, (_, index) => ({
      _id: `sku-${index + 1}` as Id<"productSku">,
      inventoryCount: index + 1,
      productCategory: "Inventory",
      productId: `product-${index + 1}` as Id<"product">,
      productName: `Inventory item ${index + 1}`,
      quantityAvailable: index + 1,
      sku: `SKU-${index + 1}`,
    }));

    renderStockAdjustmentWorkspace({ inventoryItems, onSearchStateChange });

    const table = screen.getByRole("table");

    expect(within(table).getByText("Inventory Item 1")).toBeInTheDocument();
    expect(
      within(table).queryByText("Inventory Item 11"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1-10 of 11 SKUs")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toHaveClass(
      "text-muted-foreground",
    );

    await user.click(screen.getByRole("button", { name: /next page/i }));

    await waitFor(() =>
      expect(onSearchStateChange).toHaveBeenCalledWith({ page: 2 }),
    );
    expect(
      within(table).queryByText("Inventory Item 1"),
    ).not.toBeInTheDocument();
    expect(within(table).getByText("Inventory Item 11")).toBeInTheDocument();
    expect(screen.getByText("Showing 11-11 of 11 SKUs")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toHaveClass(
      "text-muted-foreground",
    );

    await user.click(within(table).getByText("Inventory Item 11"));

    expect(screen.getByText("Showing 11-11 of 11 SKUs")).toBeInTheDocument();
  });

  it("keeps the current stock row page when a counted quantity changes", async () => {
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

    await user.click(screen.getByRole("button", { name: /next page/i }));

    expect(within(table).getByText("Inventory Item 11")).toBeInTheDocument();
    expect(screen.getByText("Showing 11-11 of 11 SKUs")).toBeInTheDocument();

    const countedInput = within(table).getByLabelText(
      /counted quantity for inventory item 11/i,
    );

    await user.clear(countedInput);
    await user.type(countedInput, "13");

    expect(within(table).getByText("Inventory Item 11")).toBeInTheDocument();
    expect(
      within(table).queryByText("Inventory Item 1"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Showing 11-11 of 11 SKUs")).toBeInTheDocument();
  });

  it("restores stock selection state from route search", () => {
    const inventoryItems = Array.from({ length: 11 }, (_, index) => ({
      _id: `sku-${index + 1}` as Id<"productSku">,
      inventoryCount: index + 1,
      productCategory: "Inventory",
      productId: `product-${index + 1}` as Id<"product">,
      productName: `Inventory item ${index + 1}`,
      quantityAvailable: index + 1,
      sku: `SKU-${index + 1}`,
    }));

    renderStockAdjustmentWorkspace({
      inventoryItems,
      searchState: {
        mode: "cycle_count",
        page: 2,
        scope: "Inventory",
        sku: "sku-11",
      },
    });

    const table = screen.getByRole("table");

    expect(
      within(table).queryByText("Inventory Item 1"),
    ).not.toBeInTheDocument();
    expect(within(table).getByText("Inventory Item 11")).toBeInTheDocument();
    expect(screen.getByText("Showing 11-11 of 11 SKUs")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /view product detail for inventory item 11/i,
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/wigclub/products/product-11?o=%2Fwigclub%2Fstore%2Fwigclub%2Foperations%2Fstock-adjustments",
    );
  });

  it("does not snap controlled stock pagination back while the route update is pending", async () => {
    const user = userEvent.setup();
    const onSearchStateChange = vi.fn();
    const inventoryItems = Array.from({ length: 31 }, (_, index) => ({
      _id: `sku-${index + 1}` as Id<"productSku">,
      inventoryCount: index + 1,
      productCategory: "Inventory",
      productId: `product-${index + 1}` as Id<"product">,
      productName: `Inventory item ${index + 1}`,
      quantityAvailable: index + 1,
      sku: `SKU-${index + 1}`,
    }));

    renderStockAdjustmentWorkspace({
      inventoryItems,
      onSearchStateChange,
      searchState: {
        mode: "cycle_count",
        page: 3,
        scope: "Inventory",
        sku: "sku-21",
      },
    });

    const table = screen.getByRole("table");

    expect(within(table).getByText("Inventory Item 21")).toBeInTheDocument();
    expect(screen.getByText("Showing 21-30 of 31 SKUs")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next page/i }));

    await waitFor(() =>
      expect(onSearchStateChange).toHaveBeenCalledWith({ page: 4 }),
    );
    expect(
      within(table).queryByText("Inventory Item 21"),
    ).not.toBeInTheDocument();
    expect(within(table).getByText("Inventory Item 31")).toBeInTheDocument();
    expect(screen.getByText("Showing 31-31 of 31 SKUs")).toBeInTheDocument();
  });

  it("reports stock selection changes for route search", async () => {
    const user = userEvent.setup();
    const onSearchStateChange = vi.fn();
    const inventoryItems = [
      {
        _id: "sku-1" as Id<"productSku">,
        inventoryCount: 8,
        productCategory: "Hair",
        productId: "product-1" as Id<"product">,
        productName: "closure wig",
        quantityAvailable: 6,
        sku: "CW-18",
      },
      ...Array.from({ length: 11 }, (_, index) => ({
        _id: `sku-inventory-${index + 1}` as Id<"productSku">,
        inventoryCount: index + 1,
        productCategory: "Inventory",
        productId: `product-inventory-${index + 1}` as Id<"product">,
        productName: `Inventory item ${index + 1}`,
        quantityAvailable: index + 1,
        sku: `SKU-${index + 1}`,
      })),
    ];

    renderStockAdjustmentWorkspace({
      inventoryItems,
      onSearchStateChange,
      searchState: {
        mode: "cycle_count",
        scope: "Inventory",
      },
    });

    await user.click(screen.getByRole("button", { name: /hair 1 sku/i }));

    expect(onSearchStateChange).toHaveBeenCalledWith({
      page: 1,
      scope: "Hair",
      sku: "sku-1",
    });

    await user.click(screen.getByRole("tab", { name: /manual adjustment/i }));

    expect(onSearchStateChange).toHaveBeenCalledWith({
      mode: "manual",
      page: 1,
      scope: "Hair",
      sku: "sku-1",
    });
  });

  it("shows the active SKU detail image in the right rail", async () => {
    const user = userEvent.setup();

    renderStockAdjustmentWorkspace();

    expect(
      screen.getByAltText('18" Natural Black Closure Wig'),
    ).toHaveAttribute("src", "https://cdn.example.com/closure-wig.jpg");

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
      }),
    );

    renderStockAdjustmentWorkspace();

    await user.click(screen.getByRole("tab", { name: /manual adjustment/i }));
    await user.clear(
      screen.getByLabelText(/adjustment delta for .*closure wig/i),
    );
    await user.type(
      screen.getByLabelText(/adjustment delta for .*closure wig/i),
      "-2",
    );
    await user.click(
      screen.getByRole("button", { name: /submit adjustment/i }),
    );

    await waitFor(() =>
      expect(mockedToast.error).toHaveBeenCalledWith(
        "You do not have permission to adjust stock for this store.",
      ),
    );
    expect(mockedToast.success).not.toHaveBeenCalled();
  });
});
