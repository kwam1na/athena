import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banknote, CreditCardIcon, Smartphone, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { toDisplayAmount } from "~/convex/lib/currency";
import {
  formatStoredAmount,
  parseDisplayAmountInput,
} from "~/src/lib/pos/displayAmounts";
import { validatePaymentAmount } from "~/src/lib/pos/validation";

import type { Payment } from "./types";
import type { SelectedPaymentMethod } from "./PaymentView";

interface PaymentsAddedListProps {
  payments: Payment[];
  formatter: Intl.NumberFormat;
  totalAmountDue: number;
  readOnly?: boolean;
  isTransactionCompleted?: boolean;
  onUpdatePayment?: (paymentId: string, amount: number) => void;
  onRemovePayment?: (paymentId: string) => void;
}

const getPaymentMethodLabel = (method: SelectedPaymentMethod) => {
  switch (method) {
    case "cash":
      return (
        <div className="flex items-center gap-2">
          <Banknote className="w-6 h-6" />
          <p className="capitalize">Cash</p>
        </div>
      );
    case "card":
      return (
        <div className="flex items-center gap-2">
          <CreditCardIcon className="w-6 h-6" />
          <p className="capitalize">Card</p>
        </div>
      );
    case "mobile_money":
      return (
        <div className="flex items-center gap-2">
          <Smartphone className="w-6 h-6" />
          <p className="capitalize">Mobile Money</p>
        </div>
      );
  }
};

export const PaymentsAddedList = ({
  payments,
  formatter,
  totalAmountDue,
  readOnly = false,
  isTransactionCompleted = false,
  onUpdatePayment,
  onRemovePayment,
}: PaymentsAddedListProps) => {
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState<number | undefined>(
    undefined,
  );

  const handleStartEdit = (payment: Payment) => {
    setEditingPaymentId(payment.id);
    setEditingAmount(payment.amount);
  };

  const handleSaveEdit = (paymentId: string) => {
    if (!editingAmount || editingAmount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    const payment = payments.find((candidate) => candidate.id === paymentId);
    if (!payment || !onUpdatePayment) {
      return;
    }

    const otherPaymentsTotal = payments
      .filter((candidate) => candidate.id !== paymentId)
      .reduce((sum, candidate) => sum + candidate.amount, 0);
    const newRemainingDue = totalAmountDue - otherPaymentsTotal;

    const validation = validatePaymentAmount(
      editingAmount,
      newRemainingDue,
      formatter,
      payment.method,
    );
    if (!validation.isValid) {
      toast.error(validation.errors[0]);
      return;
    }

    onUpdatePayment(paymentId, editingAmount);
    setEditingPaymentId(null);
    setEditingAmount(undefined);
  };

  const handleCancelEdit = () => {
    setEditingPaymentId(null);
    setEditingAmount(undefined);
  };

  if (payments.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <p className="text-lg font-medium">Payments</p>
      <div className="space-y-4">
        {payments.map((payment) => (
          <div
            key={payment.id}
            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
          >
            {editingPaymentId === payment.id ? (
              <div className="flex items-center gap-2 flex-1">
                <span className="text-sm capitalize">
                  {getPaymentMethodLabel(payment.method)}:
                </span>
                <Input
                  type="number"
                  value={
                    editingAmount !== undefined
                      ? toDisplayAmount(editingAmount)
                      : ""
                  }
                  onChange={(event) =>
                    setEditingAmount(
                      parseDisplayAmountInput(event.target.value),
                    )
                  }
                  className="h-8 flex-1"
                  min={0}
                  step="0.01"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleSaveEdit(payment.id)}
                >
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                  Cancel
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-lg">
                  {getPaymentMethodLabel(payment.method)}
                  <span className="font-semibold">
                    {formatStoredAmount(formatter, payment.amount)}
                  </span>
                </div>
                {!isTransactionCompleted && !readOnly && (
                  <div className="flex gap-2">
                    {onUpdatePayment && (
                      <Button
                        variant="ghost"
                        className="px-4"
                        onClick={() => handleStartEdit(payment)}
                      >
                        Edit
                      </Button>
                    )}
                    {onRemovePayment && (
                      <Button
                        variant="ghost"
                        className="p-8"
                        onClick={() => onRemovePayment(payment.id)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
