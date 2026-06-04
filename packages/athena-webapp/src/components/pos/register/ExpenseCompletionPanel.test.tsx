import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAttemptedExpenseAutoPrintReceiptKeysForTest,
  ExpenseCompletionPanel,
} from "./ExpenseCompletionPanel";
import type { RegisterCheckoutState } from "@/lib/pos/presentation/register/registerUiState";
import type { Id } from "~/convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({
  buildExpenseReceiptHtml: vi.fn().mockResolvedValue("<expense-receipt />"),
  printReceipt: vi.fn(),
  activeStore: {
    _id: "store-1",
    name: "Wig Club",
    currency: "GHS",
    config: {},
  } as {
    _id: string;
    name: string;
    currency: string;
    config: Record<string, unknown>;
  } | null,
}));

vi.mock("@/lib/pos/expenseReceipt", () => ({
  buildExpenseReceiptHtml: mocks.buildExpenseReceiptHtml,
}));

vi.mock("@/hooks/usePrint", () => ({
  usePrint: () => ({
    printReceipt: mocks.printReceipt,
  }),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: mocks.activeStore,
  }),
}));

function buildCheckout(
  overrides: Partial<RegisterCheckoutState> = {},
): RegisterCheckoutState {
  return {
    cartItems: [],
    registerNumber: "3",
    subtotal: 0,
    tax: 0,
    total: 13000,
    payments: [],
    hasTerminal: true,
    isTransactionCompleted: true,
    completedOrderNumber: "EXP-1001",
    completedTransactionData: {
      paymentMethod: "manual",
      payments: [],
      transactionId: "expense-transaction-1" as Id<"expenseTransaction">,
      completedAt: new Date("2026-05-20T10:00:00.000Z"),
      cartItems: [
        {
          id: "expense-item-1" as Id<"expenseSessionItem">,
          name: "Nicca",
          barcode: "123",
          sku: "NIC-1",
          price: 6500,
          quantity: 2,
          productId: "product-1" as Id<"product">,
          skuId: "sku-1" as Id<"productSku">,
        },
      ],
      subtotal: 13000,
      tax: 0,
      total: 13000,
      notes: "Damaged item",
    },
    cashierName: "Ato K.",
    onAddPayment: vi.fn(),
    onUpdatePayment: vi.fn(),
    onRemovePayment: vi.fn(),
    onClearPayments: vi.fn(),
    onCompleteTransaction: vi.fn(),
    onStartNewTransaction: vi.fn(),
    ...overrides,
  };
}

describe("ExpenseCompletionPanel", () => {
  beforeEach(() => {
    clearAttemptedExpenseAutoPrintReceiptKeysForTest();
    mocks.buildExpenseReceiptHtml.mockClear();
    mocks.buildExpenseReceiptHtml.mockResolvedValue("<expense-receipt />");
    mocks.printReceipt.mockClear();
    mocks.activeStore = {
      _id: "store-1",
      name: "Wig Club",
      currency: "GHS",
      config: {},
    };
  });

  it("prints the expense receipt once when completion data appears", async () => {
    const checkout = buildCheckout();

    const { rerender } = render(<ExpenseCompletionPanel checkout={checkout} />);
    rerender(<ExpenseCompletionPanel checkout={checkout} />);

    await waitFor(() => {
      expect(mocks.printReceipt).toHaveBeenCalledTimes(1);
    });
    expect(mocks.buildExpenseReceiptHtml).toHaveBeenCalledWith(
      expect.objectContaining({
        reportNumber: "EXP-1001",
        recordedBy: "Ato K.",
        registerNumber: "3",
        totalValue: 13000,
        notes: "Damaged item",
      }),
    );
    expect(mocks.printReceipt).toHaveBeenCalledWith("<expense-receipt />");
  });

  it("allows staff to intentionally print the receipt again", async () => {
    render(<ExpenseCompletionPanel checkout={buildCheckout()} />);

    await waitFor(() => {
      expect(mocks.printReceipt).toHaveBeenCalledTimes(1);
    });

    await userEvent.click(
      screen.getByRole("button", { name: /print receipt/i }),
    );

    await waitFor(() => {
      expect(mocks.printReceipt).toHaveBeenCalledTimes(2);
    });
  });

  it("opens the print window after completion once store data is available", async () => {
    mocks.activeStore = null;
    const checkout = buildCheckout();

    const { rerender } = render(<ExpenseCompletionPanel checkout={checkout} />);

    await waitFor(() => {
      expect(mocks.printReceipt).not.toHaveBeenCalled();
    });

    mocks.activeStore = {
      _id: "store-1",
      name: "Wig Club",
      currency: "GHS",
      config: {},
    };
    rerender(<ExpenseCompletionPanel checkout={checkout} />);

    await waitFor(() => {
      expect(mocks.printReceipt).toHaveBeenCalledTimes(1);
    });
  });

  it("does not auto-open the print window again after the completed expense remounts", async () => {
    const checkout = buildCheckout();

    const { unmount } = render(<ExpenseCompletionPanel checkout={checkout} />);

    await waitFor(() => {
      expect(mocks.printReceipt).toHaveBeenCalledTimes(1);
    });

    unmount();
    render(<ExpenseCompletionPanel checkout={checkout} />);

    await waitFor(() => {
      expect(mocks.printReceipt).toHaveBeenCalledTimes(1);
    });
  });

  it("matches the POS completed register surface while keeping expense facts", async () => {
    const checkout = buildCheckout();

    render(<ExpenseCompletionPanel checkout={checkout} />);

    expect(screen.getByText("Expense complete")).toBeInTheDocument();
    expect(screen.getByText("Ready for next expense")).toBeInTheDocument();
    expect(screen.getByText("Total value")).toBeInTheDocument();
    expect(screen.getByText("GH₵130")).toBeInTheDocument();
    expect(screen.getByText("Items")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Report")).toBeInTheDocument();
    expect(screen.getByText("#EXP-1001")).toBeInTheDocument();
    expect(screen.getByText("Recorded by")).toBeInTheDocument();
    expect(screen.getByText("Ato K.")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /start new expense/i }),
    );

    expect(checkout.onStartNewTransaction).toHaveBeenCalledTimes(1);
  });
});
