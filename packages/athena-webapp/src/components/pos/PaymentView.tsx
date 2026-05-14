import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowRight,
  Banknote,
  ChevronLeft,
  CreditCard,
  Smartphone,
  Loader2,
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
  isOverpayPaymentMethod,
  validatePaymentAmount,
} from "~/src/lib/pos/validation";

export type SelectedPaymentMethod = PosPaymentMethod;

interface PaymentViewProps {
  cartItemCount: number;
  totalPaid: number;
  remainingDue: number;
  amountDue: number;
  formatter: Intl.NumberFormat;
  selectedPaymentMethod: SelectedPaymentMethod | null;
  setSelectedPaymentMethod: (method: SelectedPaymentMethod | null) => void;
  onAddPayment: (
    method: SelectedPaymentMethod,
    amount: number,
  ) => boolean | Promise<boolean>;
  onComplete: () => void | Promise<boolean | void>;
  onPaymentAmountChange?: (amount: number | undefined) => void;
  isCompleting?: boolean;
}

const ActionButtons = ({
  cartItemCount,
  canComplete,
  onComplete,
  isCompleting = false,
}: {
  cartItemCount: number;
  canComplete: boolean;
  onComplete: () => void | Promise<boolean | void>;
  isCompleting?: boolean;
}) => {
  return (
    <div className="grid gap-3">
      {cartItemCount > 0 && canComplete && (
        <Button
          variant="outline"
          className={cn(
            "h-20 w-full rounded-xl bg-green-600 px-6 text-lg font-semibold text-white shadow-sm hover:bg-green-700 hover:text-white",
          )}
          onClick={onComplete}
          disabled={isCompleting}
        >
          Complete Sale
          <CompleteSaleActionIcon isCompleting={isCompleting} />
        </Button>
      )}
    </div>
  );
};

const CompleteSaleActionIcon = ({
  isCompleting,
}: {
  isCompleting: boolean;
}) => {
  return (
    <span className="relative ml-2 inline-flex h-4 w-4">
      {isCompleting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <ArrowRight className="h-4 w-4" />
      )}
    </span>
  );
};

export const PaymentView = ({
  cartItemCount,
  totalPaid,
  remainingDue,
  amountDue,
  formatter,
  selectedPaymentMethod,
  setSelectedPaymentMethod,
  onAddPayment,
  onComplete,
  onPaymentAmountChange,
  isCompleting = false,
}: PaymentViewProps) => {
  const [currentAmount, setCurrentAmount] = useState<number | undefined>(
    undefined,
  );
  const [displayValue, setDisplayValue] = useState("");
  const [keypadValue, setKeypadValue] = useState("");

  const canComplete = canCompleteTransaction(totalPaid, amountDue);
  const enteredAmount = currentAmount ?? 0;
  const shouldCompleteWithCurrentAmount =
    Boolean(selectedPaymentMethod) &&
    currentAmount !== undefined &&
    enteredAmount > 0 &&
    currentAmount >= remainingDue &&
    remainingDue > 0;

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

  useEffect(() => {
    setKeypadValue("");
  }, [selectedPaymentMethod]);

  useEffect(() => {
    onPaymentAmountChange?.(currentAmount);
  }, [currentAmount, onPaymentAmountChange]);

  const paymentMethodStylesMap = {
    cash: {
      bg: "bg-transaction-signal",
      text: "text-transaction-signal-foreground",
      hoverBg: "hover:bg-transaction-signal/90",
      hoverText: "hover:text-transaction-signal-foreground",
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
    cash: <Banknote className="h-5 w-5" />,
    mobile_money: <Smartphone className="h-5 w-5" />,
    card: <CreditCard className="h-5 w-5" />,
  } satisfies Record<SelectedPaymentMethod, ReactNode>;

  const paymentMethodLabelMap = {
    cash: "Cash",
    mobile_money: "Mobile Money",
    card: "Card",
  } satisfies Record<SelectedPaymentMethod, string>;

  const handleAddPayment = async () => {
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

    const isPaymentSaved = await onAddPayment(
      selectedPaymentMethod,
      currentAmount,
    );
    if (!isPaymentSaved) {
      return;
    }

    if (shouldCompleteWithCurrentAmount) {
      const isCompleted = await onComplete();
      if (isCompleted === false) {
        return;
      }

      return;
    }

    if (
      isOverpayPaymentMethod(selectedPaymentMethod) &&
      currentAmount >= remainingDue
    ) {
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

  const handleAmountChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value;
    const parsedAmount = parseDisplayAmountInput(rawValue);

    if (parsedAmount === undefined) {
      setDisplayValue("");
      setCurrentAmount(undefined);
      return;
    }

    if (
      !isOverpayPaymentMethod(selectedPaymentMethod) &&
      parsedAmount > remainingDue
    ) {
      return;
    }

    setCurrentAmount(parsedAmount);
    setDisplayValue(formatStoredAmount(formatter, parsedAmount));
    setKeypadValue("");
  };

  const handleAmountBlur = () => {
    if (currentAmount !== undefined) {
      setDisplayValue(formatStoredAmount(formatter, currentAmount));
    }
  };

  const setAmountFromTouch = (
    amount: number | undefined,
    nextKeypadValue = "",
  ) => {
    if (
      amount !== undefined &&
      !isOverpayPaymentMethod(selectedPaymentMethod) &&
      amount > remainingDue
    ) {
      return;
    }

    setCurrentAmount(amount);
    setKeypadValue(nextKeypadValue);
  };

  const handleKeypadPress = (key: string) => {
    if (key === "clear") {
      setAmountFromTouch(undefined);
      return;
    }

    if (key === "backspace") {
      const nextValue = keypadValue.slice(0, -1);
      const parsedAmount = parseDisplayAmountInput(nextValue);
      setAmountFromTouch(parsedAmount, nextValue);
      return;
    }

    const nextValue = keypadValue === "0" ? key : `${keypadValue}${key}`;
    const normalizedValue = nextValue.replace(/^0+(?=\d)/, "");
    const parsedAmount = parseDisplayAmountInput(normalizedValue);

    if (parsedAmount === undefined) {
      return;
    }

    setAmountFromTouch(parsedAmount, normalizedValue);
  };

  if (!selectedPaymentMethod) {
    return (
      <ActionButtons
        cartItemCount={cartItemCount}
        onComplete={onComplete}
        canComplete={canComplete}
        isCompleting={isCompleting}
      />
    );
  }

  const paymentMethodStyles = paymentMethodStylesMap[selectedPaymentMethod];
  const selectedPaymentLabel = paymentMethodLabelMap[selectedPaymentMethod];
  const quickAmountOptions = [
    { label: "Exact", amount: remainingDue },
    { label: "Half", amount: Math.round(remainingDue / 2) },
  ];
  const keypadKeys = [
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "clear",
    "0",
    "backspace",
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-base font-medium text-muted-foreground">
              Amount to add
            </p>
            <div
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2",
                paymentMethodStyles.bg,
                paymentMethodStyles.text,
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15">
                {paymentMethodIconMap[selectedPaymentMethod]}
              </span>
              <span className="truncate text-sm font-semibold">
                {selectedPaymentLabel}
              </span>
              {!isCompleting && (
                <Button
                  variant="outline"
                  className="ml-1 h-8 shrink-0 rounded-md border-white/50 bg-white/90 px-3 text-xs text-gray-950 hover:bg-white hover:text-gray-950"
                  onClick={() => setSelectedPaymentMethod(null)}
                >
                  Change
                </Button>
              )}
            </div>
          </div>

          <Input
            type="text"
            inputMode="decimal"
            value={displayValue}
            onChange={handleAmountChange}
            onBlur={handleAmountBlur}
            className="mt-3 h-24 rounded-lg border-gray-200 bg-gray-50 px-6 !text-5xl font-semibold text-gray-950"
            placeholder={formatStoredAmount(formatter, remainingDue)}
          />

          <div className="mt-3 grid grid-cols-3 gap-2">
            {quickAmountOptions.map((option) => (
              <Button
                key={option.label}
                type="button"
                variant="outline"
                className="h-14 rounded-lg bg-white text-base font-medium"
                disabled={option.amount <= 0}
                onClick={() => setAmountFromTouch(option.amount)}
              >
                {option.label}
              </Button>
            ))}
            <Button
              type="button"
              variant="outline"
              className="h-14 rounded-lg bg-white text-base font-medium text-red-700 hover:text-red-800"
              onClick={() => setAmountFromTouch(undefined)}
            >
              Clear
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {keypadKeys.map((key) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              className={cn(
                "h-11 rounded-xl bg-white text-lg font-semibold shadow-sm shadow-gray-200/60",
                key === "clear" && "text-red-700 hover:text-red-800",
              )}
              onClick={() => handleKeypadPress(key)}
            >
              {key === "clear" ? "C" : key === "backspace" ? "Del" : key}
            </Button>
          ))}
        </div>
      </div>

      <div className="shrink-0 space-y-3">
        {shouldCompleteWithCurrentAmount || isCompleting ? (
          <Button
            variant="outline"
            className={cn(
              "h-20 w-full rounded-xl px-6 text-lg font-semibold shadow-sm",
              "bg-green-600 text-white hover:bg-green-700 hover:text-white",
            )}
            onClick={handleAddPayment}
            disabled={isCompleting}
          >
            Complete Sale
            <CompleteSaleActionIcon isCompleting={isCompleting} />
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              className={cn(
                "h-20 w-full rounded-xl px-6 text-lg font-semibold shadow-sm",
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
              className="flex h-16 w-full items-center gap-2 rounded-xl px-6 text-base text-red-700 hover:text-red-800"
              onClick={() => setSelectedPaymentMethod(null)}
              disabled={isCompleting}
            >
              <ChevronLeft className="w-4 h-4" />
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
