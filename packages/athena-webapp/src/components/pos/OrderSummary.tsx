import { useEffect, useState } from "react";
import { render } from "@react-email/components";
import {
  ArrowRight,
  Banknote,
  Check,
  CreditCard,
  Plus,
  Printer,
  Smartphone,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import {
  calculatePosRemainingDue,
  calculatePosTotalPaid,
} from "@/lib/pos/domain";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { usePrint } from "~/src/hooks/usePrint";
import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";
import { capitalizeWords, cn } from "~/src/lib/utils";
import config from "~/src/config";
import PosReceiptEmail from "~/convex/emails/PosReceiptEmail";
import { currencyFormatter } from "~/convex/utils";

import { PaymentView, type SelectedPaymentMethod } from "./PaymentView";
import { PaymentsAddedList } from "./PaymentsAddedList";
import type { CartItem, Payment } from "./types";

interface OrderSummaryProps {
  cartItems: CartItem[];
  customerInfo?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  registerNumber?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  payments?: Payment[];
  hasTerminal?: boolean;
  isTransactionCompleted?: boolean;
  readOnly?: boolean;
  completedOrderNumber?: string | null;
  completedTransactionData?: {
    paymentMethod: string;
    payments?: Payment[];
    completedAt: Date | number;
    cartItems: CartItem[];
    subtotal: number;
    tax: number;
    total: number;
    customerInfo?: {
      name?: string;
      email?: string;
      phone?: string;
    };
  } | null;
  cashierName?: string;
  receiptNumberOverride?: string;
  onAddPayment?: (method: SelectedPaymentMethod, amount: number) => void;
  onUpdatePayment?: (paymentId: string, amount: number) => void;
  onRemovePayment?: (paymentId: string) => void;
  onClearPayments?: () => void;
  onCompleteTransaction?: () => Promise<boolean>;
  onStartNewTransaction?: () => void;
  onPaymentFlowChange?: (isActive: boolean) => void;
}

export function OrderSummary({
  cartItems,
  customerInfo,
  registerNumber,
  total: propTotal,
  payments = [],
  hasTerminal = true,
  isTransactionCompleted = false,
  readOnly = false,
  completedOrderNumber,
  completedTransactionData,
  cashierName,
  receiptNumberOverride,
  onAddPayment,
  onUpdatePayment,
  onRemovePayment,
  onClearPayments,
  onCompleteTransaction,
  onStartNewTransaction,
  onPaymentFlowChange,
}: OrderSummaryProps) {
  const { activeStore } = useGetActiveStore();
  const formatter = currencyFormatter(activeStore?.currency || "GHS");
  const { printReceipt } = usePrint();
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<SelectedPaymentMethod | null>(null);
  const [isSelectingPaymentMethod, setIsSelectingPaymentMethod] =
    useState(false);
  const [isEditingPaymentAmount, setIsEditingPaymentAmount] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  const effectiveCartItems =
    completedTransactionData?.cartItems && (readOnly || isTransactionCompleted)
      ? completedTransactionData.cartItems
      : cartItems;
  const effectiveCustomerInfo =
    completedTransactionData?.customerInfo ?? customerInfo;
  const total = completedTransactionData?.total ?? propTotal ?? 0;
  const totalPaid = calculatePosTotalPaid(payments);
  const remainingDue = calculatePosRemainingDue(totalPaid, total);
  const cartItemsCount = effectiveCartItems.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );

  const showPaymentButtons =
    !readOnly &&
    !isTransactionCompleted &&
    !isEditingPaymentAmount &&
    selectedPaymentMethod === null &&
    (payments.length === 0 || isSelectingPaymentMethod || remainingDue > 0);
  const showPaymentEditor =
    !readOnly && !isTransactionCompleted && !showPaymentButtons;
  const shouldDockPaymentButtons = payments.length > 0 && showPaymentButtons;
  const isPaymentFlowActive =
    !readOnly &&
    !isTransactionCompleted &&
    (showPaymentEditor || payments.length > 0);

  useEffect(() => {
    onPaymentFlowChange?.(isPaymentFlowActive);
  }, [isPaymentFlowActive, onPaymentFlowChange]);

  useEffect(() => {
    return () => onPaymentFlowChange?.(false);
  }, [onPaymentFlowChange]);

  const handleCompleteTransaction = async () => {
    if (!onCompleteTransaction) {
      return;
    }

    setIsCompleting(true);
    try {
      const success = await onCompleteTransaction();
      if (success) {
        setSelectedPaymentMethod(null);
        setIsSelectingPaymentMethod(false);
      }
    } finally {
      setIsCompleting(false);
    }
  };

  const handleStartNewTransaction = () => {
    setSelectedPaymentMethod(null);
    setIsSelectingPaymentMethod(false);
    onStartNewTransaction?.();
  };

  const handlePrintReceipt = async () => {
    const completedData = completedTransactionData;
    if (!completedData || !activeStore) {
      return;
    }

    try {
      const completedAtDate =
        completedData.completedAt instanceof Date
          ? completedData.completedAt
          : new Date(completedData.completedAt);

      const receiptItems = completedData.cartItems.map((item) => {
        const attributeParts: string[] = [];
        if (item.size) {
          attributeParts.push(`${item.size}`);
        }
        if (item.length) {
          attributeParts.push(`${item.length}"`);
        }

        return {
          name: capitalizeWords(item.name),
          totalPrice: formatStoredAmount(formatter, item.price * item.quantity),
          quantityLabel: `${item.quantity} × ${formatStoredAmount(formatter, item.price)}`,
          skuOrBarcode: item.sku || item.barcode,
          attributes:
            attributeParts.length > 0 ? attributeParts.join(" • ") : undefined,
        };
      });

      const paymentMethodLabel = formatPaymentMethod(
        completedData.paymentMethod,
      );
      const receiptPayments = completedData.payments ?? payments;
      const formattedPayments =
        receiptPayments.length > 0
          ? receiptPayments.map((payment) => ({
              method: payment.method,
              amount: formatStoredAmount(formatter, payment.amount),
            }))
          : undefined;
      const totalPaidFromPayments = receiptPayments.reduce(
        (sum, payment) => sum + payment.amount,
        0,
      );
      const changeGiven =
        formattedPayments &&
        totalPaidFromPayments > completedData.total &&
        receiptPayments.length > 0
          ? formatStoredAmount(
              formatter,
              totalPaidFromPayments - completedData.total,
            )
          : undefined;

      const storeContact = activeStore.config?.contactInfo;
      const [street, city, addressState, zipCode, country] =
        storeContact?.location?.split(",") || [];

      const receiptHTML = await render(
        <PosReceiptEmail
          amountPaid={formatStoredAmount(
            formatter,
            totalPaidFromPayments || completedData.total,
          )}
          storeName={activeStore.name || "Store Name"}
          storeContact={
            activeStore.config
              ? {
                  street,
                  city,
                  state: addressState,
                  zipCode,
                  country,
                  phone: storeContact?.phoneNumber,
                  website: config.storeFrontUrl.replace("https://", "wwww."),
                }
              : undefined
          }
          receiptNumber={
            readOnly
              ? (receiptNumberOverride ?? completedOrderNumber ?? "Transaction")
              : (completedOrderNumber ?? "Transaction")
          }
          completedDate={completedAtDate.toLocaleDateString()}
          completedTime={completedAtDate.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })}
          itemsCount={cartItemsCount}
          cashierName={cashierName || "Unassigned"}
          registerNumber={registerNumber || undefined}
          customerInfo={completedData.customerInfo}
          items={receiptItems}
          subtotal={formatStoredAmount(formatter, completedData.subtotal)}
          tax={
            completedData.tax > 0
              ? formatStoredAmount(formatter, completedData.tax)
              : undefined
          }
          total={formatStoredAmount(formatter, completedData.total)}
          paymentMethodLabel={paymentMethodLabel}
          payments={formattedPayments}
          changeGiven={changeGiven}
        />,
      );

      printReceipt(receiptHTML);
    } catch (error) {
      console.error("Error in handlePrintReceipt:", error);
    }
  };

  return (
    <div
      className={cn(
        "min-h-0",
        isPaymentFlowActive && "flex flex-1 flex-col",
        isTransactionCompleted && "border rounded-lg",
        !hasTerminal && !readOnly && "opacity-60 transition-all duration-300",
      )}
    >
      {isTransactionCompleted && (
        <CardHeader className="space-y-4 mt-8 mb-16">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <Check className="w-6 h-6 text-green-600" />
          </div>
          <CardTitle className="text-green-600">Transaction complete</CardTitle>
        </CardHeader>
      )}

      <div
        className={cn(
          "flex flex-col gap-5 p-0",
          isPaymentFlowActive && "min-h-0 flex-1 gap-3",
        )}
      >
        {showPaymentEditor && payments.length === 0 && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Items
              </p>
              <p className="mt-2 text-2xl font-semibold leading-none text-gray-950">
                {cartItemsCount}
              </p>
            </div>
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-primary">
                Balance due
              </p>
              <p className="mt-2 text-2xl font-semibold leading-none text-gray-950">
                {formatStoredAmount(formatter, remainingDue)}
              </p>
            </div>
          </div>
        )}

        {payments.length > 0 && (
          <PaymentsAddedList
            payments={payments}
            formatter={formatter}
            totalAmountDue={total}
            itemCount={isPaymentFlowActive ? cartItemsCount : undefined}
            balanceDue={isPaymentFlowActive ? remainingDue : undefined}
            readOnly={readOnly}
            isTransactionCompleted={isTransactionCompleted}
            onUpdatePayment={onUpdatePayment}
            onRemovePayment={onRemovePayment}
            onClearPayments={() => {
              setSelectedPaymentMethod(null);
              setIsSelectingPaymentMethod(false);
              onClearPayments?.();
            }}
            onEditingPaymentChange={setIsEditingPaymentAmount}
            variant={selectedPaymentMethod ? "minimized" : "default"}
          />
        )}

        {effectiveCustomerInfo &&
          (effectiveCustomerInfo.name || effectiveCustomerInfo.email) && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-sm mb-2">Customer</h4>
              {effectiveCustomerInfo.name && (
                <p className="text-sm">{effectiveCustomerInfo.name}</p>
              )}
              {effectiveCustomerInfo.email && (
                <p className="text-xs text-gray-600">
                  {effectiveCustomerInfo.email}
                </p>
              )}
            </div>
          )}

        {showPaymentButtons && (
          <div
            className={cn(
              shouldDockPaymentButtons
                ? "flex min-h-0 flex-1 flex-col gap-5"
                : "grid grid-cols-2 gap-3",
            )}
          >
            {!shouldDockPaymentButtons && (
              <div className="col-span-2 rounded-xl border border-primary/20 bg-primary/5 p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-primary">
                  Balance due
                </p>
                <p className="mt-2 text-4xl font-semibold leading-none text-gray-950">
                  {formatStoredAmount(formatter, remainingDue)}
                </p>
              </div>
            )}

            <div
              className={cn(
                "grid grid-cols-2 gap-3",
                shouldDockPaymentButtons && "mt-auto",
                !shouldDockPaymentButtons && "contents",
              )}
            >
              <Button
                onClick={() => {
                  setSelectedPaymentMethod("cash");
                  setIsSelectingPaymentMethod(false);
                }}
                disabled={cartItemsCount === 0}
                className="flex h-28 flex-col items-start justify-between rounded-xl bg-primary p-4 text-left text-white shadow-md shadow-primary/20 hover:bg-primary/90 hover:text-white"
                size="lg"
                variant="outline"
              >
                <Banknote className="h-5 w-5" />
                <span className="text-base font-semibold">Cash</span>
              </Button>
              <Button
                onClick={() => {
                  setSelectedPaymentMethod("card");
                  setIsSelectingPaymentMethod(false);
                }}
                disabled={cartItemsCount === 0}
                variant="outline"
                className="flex h-28 flex-col items-start justify-between rounded-xl border-gray-200 bg-white p-4 text-left text-gray-950 shadow-sm shadow-gray-200/80 hover:bg-gray-50"
                size="lg"
              >
                <CreditCard className="h-5 w-5 text-rose-600" />
                <span className="text-base font-semibold">Card</span>
              </Button>
              <Button
                onClick={() => {
                  setSelectedPaymentMethod("mobile_money");
                  setIsSelectingPaymentMethod(false);
                }}
                disabled={cartItemsCount === 0}
                variant="outline"
                className="col-span-2 flex h-24 items-center justify-between rounded-xl border-yellow-200 bg-yellow-50 p-4 text-left text-yellow-950 shadow-sm shadow-yellow-200/70 hover:bg-yellow-100 hover:text-yellow-950"
                size="lg"
              >
                <span className="flex items-center gap-3">
                  <Smartphone className="h-5 w-5" />
                  <span className="text-base font-semibold">Mobile Money</span>
                </span>
                <ArrowRight className="h-5 w-5" />
              </Button>
            </div>
          </div>
        )}

        {showPaymentEditor && (
          <div
            className={cn(selectedPaymentMethod ? "min-h-0 flex-1" : "mt-auto")}
          >
            <PaymentView
              cartItemCount={cartItemsCount}
              totalPaid={totalPaid}
              remainingDue={remainingDue}
              amountDue={total}
              formatter={formatter}
              selectedPaymentMethod={selectedPaymentMethod}
              setSelectedPaymentMethod={setSelectedPaymentMethod}
              onAddPayment={(method, amount) => onAddPayment?.(method, amount)}
              onComplete={handleCompleteTransaction}
              isCompleting={isCompleting}
            />
          </div>
        )}

        {(readOnly || isTransactionCompleted) && (
          <div className="space-y-4">
            <Button
              onClick={handlePrintReceipt}
              className="w-full py-12 text-lg"
              size="lg"
              variant="outline"
            >
              <Printer className="w-10 h-10 mr-2" />
              Print Receipt
            </Button>
            {!readOnly && (
              <Button
                onClick={handleStartNewTransaction}
                variant="outline"
                className="w-full py-12 text-lg"
                size="lg"
              >
                <Plus className="w-10 h-10 mr-2" />
                New Transaction
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  function formatPaymentMethod(method: string) {
    switch (method) {
      case "card":
        return "Card Payment";
      case "cash":
        return "Cash Payment";
      case "mobile_money":
        return "Mobile Money";
      default:
        return method;
    }
  }
}
