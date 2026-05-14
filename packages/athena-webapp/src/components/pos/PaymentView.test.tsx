import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PaymentView } from "./PaymentView";

const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "GHS",
});

describe("PaymentView", () => {
  it("uses transaction signal classes for the selected cash payment action", () => {
    render(
      <PaymentView
        cartItemCount={1}
        totalPaid={0}
        remainingDue={5000}
        amountDue={10_000}
        formatter={formatter}
        selectedPaymentMethod="cash"
        setSelectedPaymentMethod={vi.fn()}
        onAddPayment={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    const cashPaymentAction = screen.getByText("Cash").closest("div");

    expect(cashPaymentAction).toHaveClass(
      "bg-transaction-signal",
      "text-transaction-signal-foreground",
    );
  });

  describe.each([
    { method: "cash" as const, expectedAmount: 5000 },
    { method: "card" as const, expectedAmount: 5000 },
    { method: "mobile_money" as const, expectedAmount: 5000 },
  ])("when method is $method", ({ method, expectedAmount }) => {
    it("shows Complete Sale when entered amount covers the full due amount", async () => {
      const onAddPayment = vi.fn().mockResolvedValue(true);
      const onComplete = vi.fn().mockResolvedValue(true);
      const user = userEvent.setup();

      render(
        <PaymentView
          cartItemCount={1}
          totalPaid={0}
          remainingDue={5000}
          amountDue={5000}
          formatter={formatter}
          selectedPaymentMethod={method}
          setSelectedPaymentMethod={vi.fn()}
          onAddPayment={onAddPayment}
          onComplete={onComplete}
        />,
      );

      expect(
        await screen.findByRole("button", { name: "Complete Sale" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Add Payment" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Cancel" }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Complete Sale" }));

      expect(onAddPayment).toHaveBeenCalledWith(method, expectedAmount);
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it("waits for durable payment save before completing the sale", async () => {
      let resolvePayment!: (value: boolean) => void;
      const onAddPayment = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolvePayment = resolve;
          }),
      );
      const onComplete = vi.fn().mockResolvedValue(true);
      const user = userEvent.setup();

      render(
        <PaymentView
          cartItemCount={1}
          totalPaid={0}
          remainingDue={5000}
          amountDue={5000}
          formatter={formatter}
          selectedPaymentMethod={method}
          setSelectedPaymentMethod={vi.fn()}
          onAddPayment={onAddPayment}
          onComplete={onComplete}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Complete Sale" }));

      expect(onAddPayment).toHaveBeenCalledWith(method, expectedAmount);
      expect(onComplete).not.toHaveBeenCalled();

      resolvePayment(true);

      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    });

    it("does not complete when durable payment save fails", async () => {
      const onAddPayment = vi.fn().mockResolvedValue(false);
      const onComplete = vi.fn().mockResolvedValue(true);
      const user = userEvent.setup();

      render(
        <PaymentView
          cartItemCount={1}
          totalPaid={0}
          remainingDue={5000}
          amountDue={5000}
          formatter={formatter}
          selectedPaymentMethod={method}
          setSelectedPaymentMethod={vi.fn()}
          onAddPayment={onAddPayment}
          onComplete={onComplete}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Complete Sale" }));

      expect(onAddPayment).toHaveBeenCalledWith(method, expectedAmount);
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("keeps Add Payment and Cancel for partial payments", async () => {
      const onAddPayment = vi.fn().mockResolvedValue(true);
      const onComplete = vi.fn().mockResolvedValue(false);
      const user = userEvent.setup();

      render(
        <PaymentView
          cartItemCount={1}
          totalPaid={0}
          remainingDue={5000}
          amountDue={5000}
          formatter={formatter}
          selectedPaymentMethod={method}
          setSelectedPaymentMethod={vi.fn()}
          onAddPayment={onAddPayment}
          onComplete={onComplete}
        />,
      );

      const amountInput = await screen.findByRole("textbox");
      fireEvent.change(amountInput, { target: { value: "20" } });

      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: "Complete Sale" }),
        ).not.toBeInTheDocument();
      });

      expect(
        screen.getByRole("button", { name: "Add Payment" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Complete Sale" }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Add Payment" }));

      expect(onAddPayment).toHaveBeenCalledWith(method, 2000);
      expect(onComplete).not.toHaveBeenCalled();
    });
  });
});
