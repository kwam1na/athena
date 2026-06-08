import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExpenseReportView } from "./ExpenseReportView";

const getActiveStoreMock = vi.fn();
const printReceiptMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({
    reportId: "expense-1",
  }),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => getActiveStoreMock(),
}));

vi.mock("~/src/hooks/usePrint", () => ({
  usePrint: () => ({
    printReceipt: printReceiptMock,
  }),
}));

vi.mock("../../View", () => ({
  default: ({
    children,
    header,
  }: {
    children?: React.ReactNode;
    header?: React.ReactNode;
  }) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));

vi.mock("../../common/FadeIn", () => ({
  FadeIn: ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

vi.mock("../../common/PageHeader", () => ({
  SimplePageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock("../CartItems", () => ({
  CartItems: ({
    cartItems,
    className,
  }: {
    cartItems: Array<{ id: string; name: string }>;
    className?: string;
  }) => (
    <div className={className} data-testid="expense-cart-items">
      {cartItems.map((item) => (
        <span key={item.id}>{item.name}</span>
      ))}
    </div>
  ),
}));

describe("ExpenseReportView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
        name: "Wigclub Osu",
        config: {
          contact: {
            phoneNumber: "+233 555 0100",
            location: "Oxford Street, Accra, Greater Accra, Ghana",
          },
        },
      },
    });
    useQueryMock.mockReturnValue({
      _id: "expense-1",
      transactionNumber: "EXP-123456",
      totalValue: 13_000,
      completedAt: Date.UTC(2026, 4, 18, 15, 46),
      notes: "Counter stock adjustment.",
      registerNumber: "3",
      staffProfile: {
        firstName: "Ama",
        lastName: "Kusi",
      },
      items: [
        {
          _id: "item-1",
          productName: "Nicca",
          productSku: "6N2Y-WMA-EAW",
          costPrice: 6_500,
          quantity: 2,
          productId: "product-1",
          productSkuId: "sku-1",
          color: "Natural",
          image: null,
          size: "Large",
          length: 18,
        },
      ],
    });
  });

  it("prints the rendered expense receipt from the report detail page", async () => {
    const user = userEvent.setup();
    render(<ExpenseReportView />);

    await user.click(screen.getByRole("button", { name: "Print receipt" }));

    await waitFor(() => expect(printReceiptMock).toHaveBeenCalledTimes(1));
    const [receiptHtml] = printReceiptMock.mock.calls[0];
    expect(receiptHtml).toContain("Wigclub Osu");
    expect(receiptHtml).toContain("EXP-123456");
    expect(receiptHtml).toContain("Ama K.");
    expect(receiptHtml).toContain("Register:");
    expect(receiptHtml).toContain("Nicca");
    expect(receiptHtml).toContain("2 × GH₵65");
    expect(receiptHtml).toContain("GH₵130");
  });

  it("promotes expense report items before the summary rail on mobile", () => {
    render(<ExpenseReportView />);

    expect(screen.getByTestId("expense-cart-items")).toHaveClass(
      "order-1",
      "min-h-[22rem]",
      "xl:order-2",
      "xl:h-full",
    );
    expect(screen.getByTestId("expense-cart-items")).toHaveTextContent("Nicca");
  });
});
