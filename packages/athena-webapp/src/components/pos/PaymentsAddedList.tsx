import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Smartphone, CreditCardIcon, Banknote, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { usePOSStore } from "~/src/stores/posStore";
import { validatePaymentAmount } from "~/src/lib/pos/validation";
import { formatStoredAmount, parseDisplayAmountInput } from "~/src/lib/pos/displayAmounts";
import { Payment } from "./types";
import { SelectedPaymentMethod } from "./PaymentView";
import { usePOSOperations } from "~/src/hooks/usePOSOperations";
import { toDisplayAmount } from "~/convex/lib/currency";

interface PaymentsAddedListProps {
  formatter: Intl.NumberFormat;
  totalAmountDue: number;
  readOnly?: boolean;
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
  formatter,
  totalAmountDue,
  readOnly,
}: PaymentsAddedListProps) => {
  const store = usePOSStore();
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState<number | undefined>(
    undefined
  );

  const { state } = usePOSOperations();

  const handleStartEdit = (payment: Payment) => {
    setEditingPaymentId(payment.id);
    setEditingAmount(payment.amount);
  };

  const handleSaveEdit = (paymentId: string) => {
    if (!editingAmount || editingAmount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    const payment = store.payment.payments.find((p) => p.id === paymentId);
    if (!payment) return;

    const otherPaymentsTotal = store.payment.payments
      .filter((p) => p.id !== paymentId)
      .reduce((sum, p) => sum + p.amount, 0);
    const newRemainingDue = totalAmountDue - otherPaymentsTotal;

    // Validate payment amount (allows cash to exceed remaining due for change)
    const validation = validatePaymentAmount(
      editingAmount,
      newRemainingDue,
      formatter,
      payment.method
    );
    if (!validation.isValid) {
      toast.error(validation.errors[0]);
      return;
    }

    store.updatePayment(paymentId, editingAmount);
    setEditingPaymentId(null);
    setEditingAmount(undefined);
  };

  const handleCancelEdit = () => {
    setEditingPaymentId(null);
    setEditingAmount(undefined);
  };

  const handleRemovePayment = (paymentId: string) => {
    store.removePayment(paymentId);
  };

  if (store.payment.payments.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <p className="text-lg font-medium">Payments</p>
      <div className="space-y-4">
        {store.payment.payments.map((payment) => (
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
                  onChange={(e) =>
                    setEditingAmount(parseDisplayAmountInput(e.target.value))
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
                {!state.isTransactionCompleted && !readOnly && (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      className="p-8"
                      onClick={() => handleRemovePayment(payment.id)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
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
