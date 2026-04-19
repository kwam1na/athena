import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Banknote,
  Smartphone,
  CreditCard,
  Plus,
  Check,
  ArrowRight,
  X,
  SquareChevronLeft,
  SquareChevronLeftIcon,
  ChevronLeft,
  RotateCcw,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { usePOSStore } from "~/src/stores/posStore";
import {
  validatePaymentAmount,
  canCompleteTransaction,
} from "~/src/lib/pos/validation";
import {
  formatStoredAmount,
  parseDisplayAmountInput,
} from "~/src/lib/pos/displayAmounts";
import { cn } from "~/src/lib/utils";

export type SelectedPaymentMethod = "cash" | "mobile_money" | "card";

interface PaymentViewProps {
  onAddAnotherPaymentMethod: () => void;
  onCancel: () => void;
  amountDue: number;
  formatter: Intl.NumberFormat;
  selectedPaymentMethod: SelectedPaymentMethod | null;
  setSelectedPaymentMethod: (method: SelectedPaymentMethod | null) => void;
  onComplete: () => void;
}

const ActionButtons = ({
  onAddAnotherPaymentMethod,
  onCancel,
  onComplete,
  canComplete,
  setSelectedPaymentMethod,
}: {
  onAddAnotherPaymentMethod: () => void;
  onCancel: () => void;
  onComplete: () => void;
  canComplete: boolean;
  setSelectedPaymentMethod: (method: SelectedPaymentMethod | null) => void;
}) => {
  const store = usePOSStore();

  return (
    <div className="space-y-4">
      {store.cart.items.length > 0 && (
        <>
          {canComplete ? (
            <>
              <Button
                variant="outline"
                className={cn(
                  "w-full p-8 text-lg bg-green-600 text-white hover:bg-green-700 hover:text-white"
                )}
                onClick={onComplete}
              >
                Complete Transaction
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              className="w-full p-8 text-lg flex items-center gap-2 text-sky-700 hover:text-sky-800"
              onClick={onAddAnotherPaymentMethod}
            >
              <RefreshCw className="w-4 h-4" />
              Change Payment Method
            </Button>
          )}
          {!canComplete && (
            <Button
              variant="outline"
              className="w-full p-8 text-lg flex items-center gap-2 text-red-700 hover:text-red-800"
              onClick={() => setSelectedPaymentMethod(null)}
            >
              <ChevronLeft className="w-4 h-4" />
              Cancel
            </Button>
          )}
        </>
      )}

      {store.payment.payments.length >= 1 && (
        <Button
          variant="outline"
          className="w-full p-8 text-lg flex items-center gap-2 text-red-700 hover:text-red-800"
          onClick={onCancel}
        >
          <Trash2 className="w-4 h-4" />
          {store.payment.payments.length > 1
            ? "Clear all payments"
            : "Clear payment"}
        </Button>
      )}
    </div>
  );
};

export const PaymentView = ({
  onAddAnotherPaymentMethod,
  onCancel,
  amountDue,
  formatter,
  selectedPaymentMethod,
  setSelectedPaymentMethod,
  onComplete,
}: PaymentViewProps) => {
  const store = usePOSStore();
  const [currentAmount, setCurrentAmount] = useState<number | undefined>(
    undefined
  );
  const [displayValue, setDisplayValue] = useState<string>("");

  // Calculate remaining due from store
  const remainingDue = amountDue - store.payment.totalPaid;
  const totalPaid = store.payment.totalPaid;
  const canComplete = canCompleteTransaction(totalPaid, amountDue);

  // Update remaining due when amountDue changes
  useEffect(() => {
    store.calculateRemainingDue(amountDue);
  }, [amountDue, store]);

  // Pre-fill current amount with remaining due
  useEffect(() => {
    if (currentAmount === undefined && remainingDue > 0) {
      setCurrentAmount(remainingDue);
    }
  }, [remainingDue]);

  // Update display value when currentAmount changes
  useEffect(() => {
    if (currentAmount !== undefined) {
      setDisplayValue(formatStoredAmount(formatter, currentAmount));
    } else {
      setDisplayValue("");
    }
  }, [currentAmount, formatter]);

  const paymentMethodStylesMap = {
    cash: {
      bg: "bg-primary",
      text: "text-white",
      hoverBg: "hover:bg-primary/90",
      hoverText: "hover:text-white",
    },
    mobile_money: {
      bg: "bg-yellow-200",
      text: "text-yellow-900",
      hoverBg: "hover:bg-yellow-300",
      hoverText: "hover:text-yellow-800",
    },
    card: {
      bg: "bg-rose-200",
      text: "text-rose-900",
      hoverBg: "hover:bg-rose-300",
      hoverText: "hover:text-rose-800",
    },
  };

  const paymentMethodIconMap = {
    cash: <Banknote className="w-4 h-4 mr-2" />,
    mobile_money: <Smartphone className="w-4 h-4 mr-2" />,
    card: <CreditCard className="w-4 h-4 mr-2" />,
  };

  const handleAddPayment = () => {
    if (!selectedPaymentMethod) {
      toast.error("Please select a payment method");
      return;
    }

    if (!currentAmount || currentAmount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    // Validate payment amount (allows cash to exceed remaining due for change)
    const validation = validatePaymentAmount(
      currentAmount,
      remainingDue,
      formatter,
      selectedPaymentMethod
    );
    if (!validation.isValid) {
      toast.error(validation.errors[0]);
      return;
    }

    console.table({ currentAmount, remainingDue });

    store.addPayment(selectedPaymentMethod, currentAmount);
    // For cash, if amount exceeds remaining due, clear the input (change will be shown)
    // For other methods, set to remaining due if fully paid
    if (selectedPaymentMethod === "cash" && currentAmount >= remainingDue) {
      setCurrentAmount(undefined);
    } else {
      setCurrentAmount(
        remainingDue - currentAmount > 0
          ? remainingDue - currentAmount
          : undefined
      );
    }

    setSelectedPaymentMethod(null);
  };

  const handleClearAll = () => {
    store.clearPayments();
    if (remainingDue > 0) setCurrentAmount(remainingDue);
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    const parsedAmount = parseDisplayAmountInput(rawValue);

    if (parsedAmount === undefined) {
      setDisplayValue("");
      setCurrentAmount(undefined);
      return;
    }

    if (selectedPaymentMethod !== "cash" && parsedAmount > remainingDue) {
      return;
    }

    setCurrentAmount(parsedAmount);
    setDisplayValue(formatStoredAmount(formatter, parsedAmount));
  };

  const handleAmountBlur = () => {
    if (currentAmount !== undefined) {
      setDisplayValue(formatStoredAmount(formatter, currentAmount));
    }
  };

  if (!selectedPaymentMethod) {
    console.log("no selected payment method");
    return (
      <ActionButtons
        onAddAnotherPaymentMethod={onAddAnotherPaymentMethod}
        onCancel={onCancel}
        onComplete={onComplete}
        canComplete={canComplete}
        setSelectedPaymentMethod={setSelectedPaymentMethod}
      />
    );
  }

  return (
    <div className="space-y-24">
      {/* Payment Input Section */}
      {store.payment.remainingDue > 0 && (
        <div className="space-y-8">
          <div className="flex items-center gap-2">
            {paymentMethodIconMap[selectedPaymentMethod]}
            <p className="font-medium capitalize">
              Pay with {selectedPaymentMethod.replace("_", " ")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              placeholder="0.00"
              className="h-16 w-full"
              textSize="4xl"
              value={displayValue}
              onChange={handleAmountChange}
              onBlur={handleAmountBlur}
            />

            <Button
              variant="outline"
              className="p-8"
              onClick={() => setCurrentAmount(undefined)}
            >
              <ChevronLeft className="w-6 h-6" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className={cn(
                "flex-1 p-8 text-lg",
                paymentMethodStylesMap[selectedPaymentMethod].bg,
                paymentMethodStylesMap[selectedPaymentMethod].text,
                paymentMethodStylesMap[selectedPaymentMethod].hoverBg,
                paymentMethodStylesMap[selectedPaymentMethod].hoverText
              )}
              onClick={handleAddPayment}
              disabled={!currentAmount || currentAmount <= 0}
            >
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  <p>Add Payment</p>
                </div>
                {currentAmount && (
                  <span className="font-semibold">
                    {currentAmount
                      ? formatStoredAmount(formatter, currentAmount)
                      : "0.00"}
                  </span>
                )}
              </div>
            </Button>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <ActionButtons
        onAddAnotherPaymentMethod={onAddAnotherPaymentMethod}
        onCancel={onCancel}
        onComplete={onComplete}
        canComplete={canComplete}
        setSelectedPaymentMethod={setSelectedPaymentMethod}
      />
    </div>
  );
};
