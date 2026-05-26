import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RegisterCheckoutState } from "@/lib/pos/presentation/register/registerUiState";
import type { Id } from "~/convex/_generated/dataModel";
import { RegisterCheckoutPanel } from "./RegisterCheckoutPanel";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../OrderSummary", () => ({
  OrderSummary: ({
    onVoidTransaction,
  }: {
    onVoidTransaction?: () => void | Promise<void>;
  }) => (
    <div>
      {onVoidTransaction ? (
        <button onClick={() => void onVoidTransaction()} type="button">
          Void sale
        </button>
      ) : null}
    </div>
  ),
}));

function buildCheckout(
  overrides: Partial<RegisterCheckoutState> = {},
): RegisterCheckoutState {
  return {
    actorStaffProfileId: "staff-1" as Id<"staffProfile">,
    cartItems: [],
    cashierName: "Ato K.",
    completedOrderNumber: "192231",
    completedTransactionData: {
      paymentMethod: "cash",
      transactionId: "txn-1" as Id<"posTransaction">,
      completedAt: new Date("2026-05-25T14:27:00.000Z"),
      cartItems: [],
      subtotal: 150000,
      tax: 0,
      total: 150000,
    },
    currency: "GHS",
    hasTerminal: true,
    isTransactionCompleted: true,
    onAddPayment: vi.fn(),
    onClearPayments: vi.fn(),
    onCompleteTransaction: vi.fn(),
    onRemovePayment: vi.fn(),
    onStartNewTransaction: vi.fn(),
    onUpdatePayment: vi.fn(),
    payments: [],
    registerNumber: "3",
    subtotal: 150000,
    tax: 0,
    total: 150000,
    ...overrides,
  };
}

describe("RegisterCheckoutPanel", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    window.history.pushState(
      {},
      "",
      "/wigclub/store/wigclub/pos/register?o=%2Fwigclub%2Fstore%2Fwigclub%2Fpos",
    );
  });

  it("navigates completed POS sales to the transaction void surface", async () => {
    const user = userEvent.setup();

    render(<RegisterCheckoutPanel checkout={buildCheckout()} />);

    await user.click(screen.getByRole("button", { name: "Void sale" }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
      params: expect.any(Function),
      search: {
        o: "%2Fwigclub%2Fstore%2Fwigclub%2Fpos%2Fregister%3Fo%3D%252Fwigclub%252Fstore%252Fwigclub%252Fpos",
      },
    });
    const resolveParams = mockNavigate.mock.calls[0]?.[0].params as (
      current: Record<string, string>,
    ) => Record<string, string>;
    expect(
      resolveParams({ orgUrlSlug: "wigclub", storeUrlSlug: "wigclub" }),
    ).toMatchObject({
      orgUrlSlug: "wigclub",
      storeUrlSlug: "wigclub",
      transactionId: "txn-1",
    });
  });

  it("does not surface voiding before the completed sale has a cloud transaction", () => {
    render(
      <RegisterCheckoutPanel
        checkout={buildCheckout({ completedTransactionData: null })}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Void sale" }),
    ).not.toBeInTheDocument();
  });
});
