import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowRight,
  Banknote,
  ChevronLeft,
  CreditCard,
  RefreshCw,
  Smartphone,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { toast } from "sonner";

import type { PosPaymentMethod } from "@/lib/pos/domain";
import {
  formatStoredAmount,
  parseDisplayAmountInput,
} from "~/src/lib/pos/displayAmounts";
import { cn } from "~/src/lib/utils";
import {
  canCompleteTransaction,
  validatePaymentAmount,
} from "~/src/lib/pos/validation";

export type SelectedPaymentMethod = PosPaymentMethod;

interface PaymentViewProps {
  cartItemCount: number;
  paymentCount: number;
  totalPaid: number;
  remainingDue: number;
  amountDue: number;
  formatter: Intl.NumberFormat;
  selectedPaymentMethod: SelectedPaymentMethod | null;
  setSelectedPaymentMethod: (method: SelectedPaymentMethod | null) => void;
  onAddPayment: (method: SelectedPaymentMethod, amount: number) => void;
  onAddAnotherPaymentMethod: () => void;
  onClearPayments: () => void;
  onComplete: () => void | Promise<void>;
  isCompleting?: boolean;
}

const ActionButtons = ({
  cartItemCount,
  paymentCount,
  canComplete,
  onAddAnotherPaymentMethod,
  onCancel,
  onComplete,
  setSelectedPaymentMethod,
  isCompleting = false,
}: {
  cartItemCount: number;
  paymentCount: number;
  canComplete: boolean;
  onAddAnotherPaymentMethod: () => void;
  onCancel: () => void;
  onComplete: () => void | Promise<void>;
  setSelectedPaymentMethod: (method: SelectedPaymentMethod | null) => void;
  isCompleting?: boolean;
}) => {
  return (
    <div className="space-y-4">
      {cartItemCount > 0 && (
        <>
          {canComplete ? (
            <Button
              variant="outline"
              className={cn(
                "w-full p-8 text-lg bg-green-600 text-white hover:bg-green-700 hover:text-white",
              )}
              onClick={onComplete}
              disabled={isCompleting}
            >
              {isCompleting ? "Completing transaction..." : "Complete Transaction"}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
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

      {paymentCount >= 1 && (
        <Button
          variant="outline"
          className="w-full p-8 text-lg flex items-center gap-2 text-red-700 hover:text-red-800"
          onClick={onCancel}
        >
          <Trash2 className="w-4 h-4" />
          {paymentCount > 1 ? "Clear all payments" : "Clear payment"}
        </Button>
      )}
    </div>
  );
};

export const PaymentView = ({
  cartItemCount,
  paymentCount,
  totalPaid,
  remainingDue,
  amountDue,
  formatter,
  selectedPaymentMethod,
  setSelectedPaymentMethod,
  onAddPayment,
  onAddAnotherPaymentMethod,
  onClearPayments,
  onComplete,
  isCompleting = false,
}: PaymentViewProps) => {
  const [currentAmount, setCurrentAmount] = useState<number | undefined>(
    undefined,
  );
  const [displayValue, setDisplayValue] = useState("");

  const canComplete = canCompleteTransaction(totalPaid, amountDue);

  useEffect(() => {
    if (currentAmount === undefined && remainingDue > 0) {
      setCurrentAmount(remainingDue);
    }
  }, [currentAmount, remainingDue]);

  useEffect(() => {
    if (currentAmount !== undefined) {
      setDisplayValue(formatStoredAmount(formatter, currentAmount));
      return;
    }

    setDisplayValue("");
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
  } satisfies Record<
    SelectedPaymentMethod,
    {
      bg: string;
      text: string;
      hoverBg: string;
      hoverText: string;
    }
  >;

  const paymentMethodIconMap = {
    cash: <Banknote className="w-4 h-4 mr-2" />,
    mobile_money: <Smartphone className="w-4 h-4 mr-2" />,
    card: <CreditCard className="w-4 h-4 mr-2" />,
  } satisfies Record<SelectedPaymentMethod, ReactNode>;

  const handleAddPayment = () => {
    if (!selectedPaymentMethod) {
      toast.error("Please select a payment method");
      return;
    }

    if (!currentAmount || currentAmount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    const validation = validatePaymentAmount(
      currentAmount,
      remainingDue,
      formatter,
      selectedPaymentMethod,
    );

    if (!validation.isValid) {
      toast.error(validation.errors[0]);
      return;
    }

    onAddPayment(selectedPaymentMethod, currentAmount);

    if (selectedPaymentMethod === "cash" && currentAmount >= remainingDue) {
      setCurrentAmount(undefined);
    } else {
      setCurrentAmount(
        remainingDue - currentAmount > 0
          ? remainingDue - currentAmount
          : undefined,
      );
    }

    setSelectedPaymentMethod(null);
  };

  const handleClearAll = () => {
    onClearPayments();
    if (amountDue > 0) {
      setCurrentAmount(amountDue);
    }
  };

  const handleAmountChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value;
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
    return (
      <ActionButtons
        cartItemCount={cartItemCount}
        paymentCount={paymentCount}
        onAddAnotherPaymentMethod={onAddAnotherPaymentMethod}
        onCancel={handleClearAll}
        onComplete={onComplete}
        canComplete={canComplete}
        setSelectedPaymentMethod={setSelectedPaymentMethod}
        isCompleting={isCompleting}
      />
    );
  }

  const paymentMethodStyles = paymentMethodStylesMap[selectedPaymentMethod];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-lg font-medium">Add payment</p>
        <div className="grid grid-cols-1 gap-2">
          {(["cash", "mobile_money", "card"] as SelectedPaymentMethod[]).map(
            (method) => {
              const styles = paymentMethodStylesMap[method];

              return (
                <Button
                  key={method}
                  variant="outline"
                  className={cn(
                    "w-full py-10 justify-start",
                    styles.bg,
                    styles.text,
                    styles.hoverBg,
                    styles.hoverText,
                    selectedPaymentMethod === method &&
                      "ring-2 ring-offset-2 ring-primary",
                  )}
                  onClick={() => setSelectedPaymentMethod(method)}
                >
                  {paymentMethodIconMap[method]}
                  {method === "mobile_money"
                    ? "Mobile Money"
                    : method.charAt(0).toUpperCase() + method.slice(1)}
                </Button>
              );
            },
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Amount</p>
        <Input
          type="text"
          inputMode="decimal"
          value={displayValue}
          onChange={handleAmountChange}
          onBlur={handleAmountBlur}
          className="h-12 text-lg"
          placeholder={formatStoredAmount(formatter, remainingDue)}
        />
      </div>

      <div className="rounded-lg bg-gray-50 p-4 text-sm">
        <div className="flex items-center justify-between">
          <span>Selected method</span>
          <span className="font-medium capitalize">
            {selectedPaymentMethod === "mobile_money"
              ? "Mobile Money"
              : selectedPaymentMethod}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span>Remaining due</span>
          <span className="font-medium">
            {formatStoredAmount(formatter, remainingDue)}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <Button
          variant="outline"
          className={cn(
            "w-full p-8 text-lg",
            paymentMethodStyles.bg,
            paymentMethodStyles.text,
            paymentMethodStyles.hoverBg,
            paymentMethodStyles.hoverText,
          )}
          onClick={handleAddPayment}
        >
          Add Payment
        </Button>

        <Button
          variant="outline"
          className="w-full p-8 text-lg flex items-center gap-2 text-red-700 hover:text-red-800"
          onClick={() => setSelectedPaymentMethod(null)}
        >
          <ChevronLeft className="w-4 h-4" />
          Cancel
        </Button>
      </div>
    </div>
  );
};
