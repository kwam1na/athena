import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Banknote,
  ChevronDown,
  ChevronUp,
  Check,
  CreditCardIcon,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { toast } from "sonner";

import { toDisplayAmount } from "~/convex/lib/currency";
import {
  formatStoredAmount,
  parseDisplayAmountInput,
} from "~/src/lib/pos/displayAmounts";
import { validatePaymentAmount } from "~/src/lib/pos/validation";
import { cn } from "~/src/lib/utils";

import type { Payment } from "./types";
import type { SelectedPaymentMethod } from "./PaymentView";

interface PaymentsAddedListProps {
  payments: Payment[];
  formatter: Intl.NumberFormat;
  totalAmountDue: number;
  balanceDue?: number;
  selectedPaymentMethod?: SelectedPaymentMethod | null;
  paymentAmountDraft?: number;
  readOnly?: boolean;
  isTransactionCompleted?: boolean;
  editingPaymentId?: string | null;
  onEditingPaymentIdChange?: (paymentId: string | null) => void;
  paymentsExpanded?: boolean;
  onUpdatePayment?: (paymentId: string, amount: number) => void;
  onRemovePayment?: (paymentId: string) => void;
  onClearPayments?: () => void;
  onEditingPaymentChange?: (isEditing: boolean) => void;
  onPaymentsExpandedChange?: (isExpanded: boolean) => void;
  variant?: "default" | "minimized";
}

const getPaymentMethodIcon = (method: SelectedPaymentMethod) => {
  switch (method) {
    case "cash":
      return <Banknote className="h-5 w-5" />;
    case "card":
      return <CreditCardIcon className="h-5 w-5" />;
    case "mobile_money":
      return <Smartphone className="h-5 w-5" />;
  }
};

const getPaymentMethodLabel = (method: SelectedPaymentMethod) => {
  switch (method) {
    case "cash":
      return "Cash";
    case "card":
      return "Card";
    case "mobile_money":
      return "Mobile Money";
  }
};

function PaidTotalBadge({
  formatter,
  totalPaid,
  compact = false,
}: {
  formatter: Intl.NumberFormat;
  totalPaid: number;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md bg-white/75 px-2.5 py-1 font-semibold text-foreground ring-1 ring-inset ring-border/70",
        compact ? "text-xs" : "text-sm",
      )}
    >
      Paid {formatStoredAmount(formatter, totalPaid)}
    </span>
  );
}

export const PaymentsAddedList = ({
  payments,
  formatter,
  totalAmountDue,
  balanceDue,
  selectedPaymentMethod = null,
  paymentAmountDraft,
  readOnly = false,
  isTransactionCompleted = false,
  editingPaymentId: controlledEditingPaymentId,
  onEditingPaymentIdChange,
  paymentsExpanded: controlledPaymentsExpanded,
  onUpdatePayment,
  onRemovePayment,
  onClearPayments,
  onEditingPaymentChange,
  onPaymentsExpandedChange,
  variant = "default",
}: PaymentsAddedListProps) => {
  const [internalEditingPaymentId, setInternalEditingPaymentId] = useState<
    string | null
  >(null);
  const [editingAmount, setEditingAmount] = useState<number | undefined>(
    undefined,
  );
  const [isPaymentsExpanded, setIsPaymentsExpanded] = useState(false);
  const [editingKeypadValue, setEditingKeypadValue] = useState("");
  const editingPaymentId =
    controlledEditingPaymentId ?? internalEditingPaymentId;
  const paymentsExpanded =
    controlledPaymentsExpanded ?? isPaymentsExpanded;

  useEffect(() => {
    return () => onEditingPaymentChange?.(false);
  }, [onEditingPaymentChange]);

  useEffect(() => {
    return () => onPaymentsExpandedChange?.(false);
  }, [onPaymentsExpandedChange]);

  const setPaymentsExpanded = (isExpanded: boolean) => {
    if (controlledPaymentsExpanded === undefined) {
      setIsPaymentsExpanded(isExpanded);
    }

    onPaymentsExpandedChange?.(isExpanded);
  };

  const setPaymentEditing = (paymentId: string | null) => {
    if (controlledEditingPaymentId === undefined) {
      setInternalEditingPaymentId(paymentId);
    }

    onEditingPaymentIdChange?.(paymentId);
    onEditingPaymentChange?.(paymentId !== null);
  };

  const handleStartEdit = (payment: Payment) => {
    setPaymentEditing(payment.id);
    setEditingAmount(payment.amount);
    setEditingKeypadValue("");
    setPaymentsExpanded(true);
  };

  const clearPaymentEditing = () => {
    setPaymentEditing(null);
    setEditingAmount(undefined);
    setEditingKeypadValue("");
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

    if (otherPaymentsTotal + editingAmount >= totalAmountDue) {
      setPaymentsExpanded(false);
    }

    onUpdatePayment(paymentId, editingAmount);
    clearPaymentEditing();
  };

  const handleCancelEdit = () => {
    const isSaleCovered = payments.reduce(
      (sum, payment) => sum + payment.amount,
      0,
    ) >= totalAmountDue;

    if (isSaleCovered) {
      setPaymentsExpanded(false);
    }

    clearPaymentEditing();
  };

  const resetPaymentCollectionControls = () => {
    clearPaymentEditing();
    setPaymentsExpanded(false);
  };

  const handleClearPayments = () => {
    resetPaymentCollectionControls();
    onClearPayments?.();
  };

  const handleRemovePayment = (paymentId: string) => {
    if (payments.length <= 1 || editingPaymentId === paymentId) {
      resetPaymentCollectionControls();
    }

    onRemovePayment?.(paymentId);
  };

  if (payments.length === 0) {
    return null;
  }

  const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const projectedTotalPaid =
    selectedPaymentMethod !== null &&
    paymentAmountDraft !== undefined &&
    paymentAmountDraft > 0
      ? totalPaid + paymentAmountDraft
      : totalPaid;
  const projectedChangeDue = Math.max(projectedTotalPaid - totalAmountDue, 0);
  const projectedRemainingDue = Math.max(totalAmountDue - projectedTotalPaid, 0);
  const hasProjectedChangeDue = projectedChangeDue > 0;
  const summaryLabel = hasProjectedChangeDue ? "Change due" : "Balance due";
  const summaryAmount = hasProjectedChangeDue
    ? projectedChangeDue
    : projectedRemainingDue;
  const summaryToneClass = hasProjectedChangeDue
    ? "border-green-200 bg-green-50"
    : "border-signal/20 bg-signal/5";
  const summaryLabelClass = hasProjectedChangeDue
    ? "text-green-700"
    : "text-signal";
  const summaryDividerClass = hasProjectedChangeDue
    ? "border-green-200"
    : "border-signal/10";
  const showSaleSummary = balanceDue !== undefined;
  const isMinimized = variant === "minimized";
  const editingPayment = payments.find(
    (payment) => payment.id === editingPaymentId,
  );
  const canCollapsePayments = showSaleSummary && !isTransactionCompleted;
  const showPaymentRows = !canCollapsePayments || paymentsExpanded;
  const togglePaymentsLabel = paymentsExpanded
    ? "Hide payments"
    : `Show payments (${payments.length})`;

  const renderPaymentsToggle = (compact = false) => {
    if (!canCollapsePayments) {
      return null;
    }

    return (
      <Button
        variant="outline"
        className={cn(
          "w-full rounded-lg bg-white/80 font-medium",
          compact ? "mt-3 h-10 text-sm" : "mt-4 h-12 text-sm",
        )}
        onClick={() => setPaymentsExpanded(!paymentsExpanded)}
      >
        {togglePaymentsLabel}
        {paymentsExpanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </Button>
    );
  };

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

  const setEditingAmountFromTouch = (
    amount: number | undefined,
    nextKeypadValue = "",
  ) => {
    if (!editingPayment) {
      return;
    }

    const otherPaymentsTotal = payments
      .filter((payment) => payment.id !== editingPayment.id)
      .reduce((sum, payment) => sum + payment.amount, 0);
    const editableRemainingDue = totalAmountDue - otherPaymentsTotal;

    if (
      amount !== undefined &&
      editingPayment.method !== "cash" &&
      amount > editableRemainingDue
    ) {
      return;
    }

    setEditingAmount(amount);
    setEditingKeypadValue(nextKeypadValue);
  };

  const handleEditingKeypadPress = (key: string) => {
    if (key === "clear") {
      setEditingAmountFromTouch(undefined);
      return;
    }

    if (key === "backspace") {
      const nextValue = editingKeypadValue.slice(0, -1);
      setEditingAmountFromTouch(parseDisplayAmountInput(nextValue), nextValue);
      return;
    }

    const nextValue =
      editingKeypadValue === "0" ? key : `${editingKeypadValue}${key}`;
    const normalizedValue = nextValue.replace(/^0+(?=\d)/, "");
    const parsedAmount = parseDisplayAmountInput(normalizedValue);

    if (parsedAmount === undefined) {
      return;
    }

    setEditingAmountFromTouch(parsedAmount, normalizedValue);
  };

  const handleEditingAmountChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsedAmount = parseDisplayAmountInput(event.target.value);
    setEditingAmountFromTouch(parsedAmount);
  };

  if (editingPayment) {
    const otherPaymentsTotal = payments
      .filter((payment) => payment.id !== editingPayment.id)
      .reduce((sum, payment) => sum + payment.amount, 0);
    const editableRemainingDue = totalAmountDue - otherPaymentsTotal;
    const editedAmount = editingAmount ?? 0;
    const remainingAfterEdit = Math.max(
      totalAmountDue - (otherPaymentsTotal + editedAmount),
      0,
    );
    const changeAfterEdit =
      editingPayment.method === "cash"
        ? Math.max(otherPaymentsTotal + editedAmount - totalAmountDue, 0)
        : 0;
    const isCompact = isMinimized;

    return (
      <div
        className={cn(
          "rounded-xl border border-gray-200 bg-white shadow-sm",
          isCompact ? "p-3" : "p-4",
        )}
      >
        {showSaleSummary && (
          <div
            className={cn(
              "rounded-lg border",
              summaryToneClass,
              isCompact ? "mb-3 p-3" : "mb-4 p-4",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <p
                className={cn(
                  "text-[11px] font-medium uppercase tracking-wide",
                  summaryLabelClass,
                )}
              >
                {summaryLabel}
              </p>
              <p
                className={cn(
                  "font-semibold leading-none text-gray-950",
                  isCompact ? "text-xl" : "text-2xl",
                )}
              >
                {formatStoredAmount(formatter, summaryAmount)}
              </p>
            </div>
            <div
              className={cn(
                "mt-2 flex justify-end border-t pt-2 text-xs text-muted-foreground",
                summaryDividerClass,
              )}
            >
              <PaidTotalBadge formatter={formatter} totalPaid={totalPaid} />
            </div>
          </div>
        )}

        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-base font-medium text-muted-foreground">
              Edit payment
            </p>
            <div className="flex min-w-0 items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-2 text-gray-950">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white shadow-sm">
                {getPaymentMethodIcon(editingPayment.method)}
              </span>
              <span className="truncate text-sm font-semibold">
                {getPaymentMethodLabel(editingPayment.method)}
              </span>
            </div>
          </div>

          <Input
            type="text"
            inputMode="decimal"
            value={
              editingAmount !== undefined
                ? formatStoredAmount(formatter, editingAmount)
                : ""
            }
            onChange={handleEditingAmountChange}
            className="mt-3 h-20 rounded-lg border-gray-200 bg-gray-50 px-5 !text-4xl font-semibold text-gray-950"
            placeholder={formatStoredAmount(formatter, editableRemainingDue)}
          />

          <div className="mt-3 grid grid-cols-3 gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-12 rounded-lg bg-white text-base font-medium"
              onClick={() => setEditingAmountFromTouch(editableRemainingDue)}
            >
              Due
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12 rounded-lg bg-white text-base font-medium"
              onClick={() => setEditingAmountFromTouch(editingPayment.amount)}
            >
              Original
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12 rounded-lg bg-white text-base font-medium text-red-700 hover:text-red-800"
              onClick={() => setEditingAmountFromTouch(undefined)}
            >
              Clear
            </Button>
          </div>

          <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span>
                {changeAfterEdit > 0
                  ? "Change after edit"
                  : "Remaining after edit"}
              </span>
              <span className="font-medium">
                {formatStoredAmount(
                  formatter,
                  changeAfterEdit > 0 ? changeAfterEdit : remainingAfterEdit,
                )}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {keypadKeys.map((key) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              className={cn(
                "h-12 rounded-xl bg-white text-lg font-semibold shadow-sm shadow-gray-200/60",
                key === "clear" && "text-red-700 hover:text-red-800",
              )}
              onClick={() => handleEditingKeypadPress(key)}
            >
              {key === "clear" ? "C" : key === "backspace" ? "Del" : key}
            </Button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            className="h-14 rounded-xl bg-green-600 text-base font-semibold text-white hover:bg-green-700 hover:text-white"
            variant="outline"
            onClick={() => handleSaveEdit(editingPayment.id)}
          >
            <Check className="h-4 w-4" />
            Save
          </Button>
          <Button
            className="h-14 rounded-xl text-base font-medium"
            variant="outline"
            onClick={handleCancelEdit}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (isMinimized) {
    return (
      <div className="space-y-3">
        {showSaleSummary && (
          <div
            className={cn(
              "rounded-lg border p-3",
              summaryToneClass,
              showPaymentRows && "mb-3",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <p
                className={cn(
                  "text-[11px] font-medium uppercase tracking-wide",
                  summaryLabelClass,
                )}
              >
                {summaryLabel}
              </p>
              <p className="text-xl font-semibold leading-none text-gray-950">
                {formatStoredAmount(formatter, summaryAmount)}
              </p>
            </div>
            <div
              className={cn(
                "mt-2 flex justify-end border-t pt-2 text-xs text-muted-foreground",
                summaryDividerClass,
              )}
            >
              <PaidTotalBadge
                formatter={formatter}
                totalPaid={totalPaid}
                compact
              />
            </div>
            {renderPaymentsToggle(true)}
          </div>
        )}

        {showPaymentRows && (
          <>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Payments
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {payments.length}{" "}
                  {payments.length === 1 ? "entry" : "entries"}
                </p>
              </div>
              {!isTransactionCompleted && !readOnly && onClearPayments && (
                <Button
                  variant="outline"
                  className="h-9 rounded-lg border-red-100 bg-white px-3 text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={handleClearPayments}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear all
                </Button>
              )}
            </div>

            <div className="space-y-2">
              {payments.map((payment) => (
                <div key={payment.id} className="rounded-lg bg-gray-50 p-2.5">
                  {editingPaymentId === payment.id ? (
                    <div className="grid gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-gray-950 shadow-sm">
                          {getPaymentMethodIcon(payment.method)}
                        </div>
                        <p className="text-sm font-medium">
                          {getPaymentMethodLabel(payment.method)}
                        </p>
                      </div>
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
                        className="h-12 rounded-lg bg-white text-lg font-semibold"
                        min={0}
                        step="0.01"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          className="h-12 rounded-lg bg-green-600 text-white hover:bg-green-700 hover:text-white"
                          variant="outline"
                          onClick={() => handleSaveEdit(payment.id)}
                        >
                          <Check className="h-4 w-4" />
                          Save
                        </Button>
                        <Button
                          className="h-12 rounded-lg"
                          variant="outline"
                          onClick={handleCancelEdit}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-gray-950 shadow-sm">
                          {getPaymentMethodIcon(payment.method)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-gray-950">
                            {getPaymentMethodLabel(payment.method)}
                          </p>
                          <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                            {formatStoredAmount(formatter, payment.amount)}
                          </p>
                        </div>
                      </div>

                      {!isTransactionCompleted && !readOnly && (
                        <div className="flex shrink-0 items-center gap-2">
                          {onUpdatePayment && (
                            <Button
                              variant="outline"
                              className="h-9 rounded-lg bg-white px-3 text-sm"
                              onClick={() => handleStartEdit(payment)}
                            >
                              Edit
                            </Button>
                          )}
                          {onRemovePayment && (
                            <Button
                              variant="outline"
                              className="h-9 w-9 rounded-lg bg-white p-0 text-red-600 hover:text-red-700"
                              aria-label={`Remove ${getPaymentMethodLabel(payment.method)} payment`}
                              onClick={() => handleRemovePayment(payment.id)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {showSaleSummary && (
        <div className={cn("grid gap-4", showPaymentRows && "mb-5")}>
          <div className={cn("rounded-xl border p-6", summaryToneClass)}>
            <div className="grid gap-3">
              <p
                className={cn(
                  "text-[11px] font-medium uppercase tracking-wide",
                  summaryLabelClass,
                )}
              >
                {summaryLabel}
              </p>
              <p className="text-4xl font-semibold leading-none text-gray-950">
                {formatStoredAmount(formatter, summaryAmount)}
              </p>
            </div>
            <div
              className={cn(
                "mt-5 flex justify-end border-t pt-4 text-sm text-muted-foreground",
                summaryDividerClass,
              )}
            >
              <PaidTotalBadge formatter={formatter} totalPaid={totalPaid} />
            </div>
            {renderPaymentsToggle()}
          </div>
        </div>
      )}

      {showPaymentRows && (
        <>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Payments
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {payments.length} {payments.length === 1 ? "entry" : "entries"}
              </p>
            </div>
            {!isTransactionCompleted && !readOnly && onClearPayments && (
              <Button
                variant="outline"
                className="h-11 rounded-lg border-red-100 bg-white px-4 text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={handleClearPayments}
              >
                <Trash2 className="h-4 w-4" />
                Clear all
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {payments.map((payment) => (
              <div key={payment.id} className="rounded-lg bg-gray-50 p-4">
                {editingPaymentId === payment.id ? (
                  <div className="grid gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-gray-950 shadow-sm">
                        {getPaymentMethodIcon(payment.method)}
                      </div>
                      <p className="text-sm font-medium">
                        {getPaymentMethodLabel(payment.method)}
                      </p>
                    </div>
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
                      className="h-12 rounded-lg bg-white text-lg font-semibold"
                      min={0}
                      step="0.01"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        className="h-12 rounded-lg bg-green-600 text-white hover:bg-green-700 hover:text-white"
                        variant="outline"
                        onClick={() => handleSaveEdit(payment.id)}
                      >
                        <Check className="h-4 w-4" />
                        Save
                      </Button>
                      <Button
                        className="h-12 rounded-lg"
                        variant="outline"
                        onClick={handleCancelEdit}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-gray-950 shadow-sm">
                        {getPaymentMethodIcon(payment.method)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-950">
                          {getPaymentMethodLabel(payment.method)}
                        </p>
                        <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                          {formatStoredAmount(formatter, payment.amount)}
                        </p>
                      </div>
                    </div>

                    {!isTransactionCompleted && !readOnly && (
                      <div className="flex shrink-0 items-center gap-3">
                        {onUpdatePayment && (
                          <Button
                            variant="outline"
                            className="h-11 rounded-lg bg-white px-4 text-sm"
                            onClick={() => handleStartEdit(payment)}
                          >
                            Edit
                          </Button>
                        )}
                        {onRemovePayment && (
                          <Button
                            variant="outline"
                            className="h-11 w-11 rounded-lg bg-white p-0 text-red-600 hover:text-red-700"
                            aria-label={`Remove ${getPaymentMethodLabel(payment.method)} payment`}
                            onClick={() => handleRemovePayment(payment.id)}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
