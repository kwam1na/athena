import { useState } from "react";
import { render } from "@react-email/components";
import {
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
  calculatePosChange,
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
import { TotalsDisplay } from "./TotalsDisplay";
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
}

export function OrderSummary({
  cartItems,
  customerInfo,
  registerNumber,
  subtotal: propSubtotal,
  tax: propTax,
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
}: OrderSummaryProps) {
  const { activeStore } = useGetActiveStore();
  const formatter = currencyFormatter(activeStore?.currency || "GHS");
  const { printReceipt } = usePrint();
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<SelectedPaymentMethod | null>(null);
  const [isSelectingPaymentMethod, setIsSelectingPaymentMethod] =
    useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  const effectiveCartItems =
    completedTransactionData?.cartItems && (readOnly || isTransactionCompleted)
      ? completedTransactionData.cartItems
      : cartItems;
  const effectiveCustomerInfo =
    completedTransactionData?.customerInfo ?? customerInfo;
  const subtotal = completedTransactionData?.subtotal ?? propSubtotal ?? 0;
  const tax = completedTransactionData?.tax ?? propTax ?? 0;
  const total = completedTransactionData?.total ?? propTotal ?? 0;
  const totalPaid = calculatePosTotalPaid(payments);
  const remainingDue = calculatePosRemainingDue(totalPaid, total);
  const changeDue =
    totalPaid > total ? calculatePosChange(totalPaid, total) : 0;
  const cartItemsCount = effectiveCartItems.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  const cartItemsCountText =
    cartItemsCount > 1 ? `${cartItemsCount} items` : `${cartItemsCount} item`;

  const showPaymentButtons =
    !readOnly &&
    !isTransactionCompleted &&
    selectedPaymentMethod === null &&
    (payments.length === 0 || isSelectingPaymentMethod);
  const showPaymentEditor =
    !readOnly && !isTransactionCompleted && !showPaymentButtons;

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
              ? receiptNumberOverride ?? completedOrderNumber ?? "Transaction"
              : completedOrderNumber ?? "Transaction"
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

      <CardHeader className="flex flex-row baseline justify-between">
        <p className="text-lg font-medium">Summary</p>
        {cartItemsCount > 0 && (
          <p className="text-gray-600">{cartItemsCountText}</p>
        )}
      </CardHeader>
      <div className="p-6 space-y-40">
        <div className="space-y-16">
          <TotalsDisplay
            items={[
              { label: "Subtotal", value: subtotal, formatter },
              ...(tax > 0 ? [{ label: "Tax", value: tax, formatter }] : []),
              { label: "Total", value: total, formatter, highlight: true },
            ]}
          />

          {payments.length > 0 && (
            <TotalsDisplay
              items={[
                {
                  label: "Total Paid",
                  value: totalPaid,
                  formatter,
                  highlight: true,
                },
                ...(totalPaid < total
                  ? [
                      {
                        label: "Remaining",
                        value: remainingDue,
                        formatter,
                        highlight: true,
                      },
                    ]
                  : []),
                ...(changeDue > 0
                  ? [
                      {
                        label: "Change Due",
                        value: changeDue,
                        formatter,
                        highlight: true,
                      },
                    ]
                  : []),
              ]}
            />
          )}

          {payments.length > 0 && (
            <PaymentsAddedList
              payments={payments}
              formatter={formatter}
              totalAmountDue={total}
              readOnly={readOnly}
              isTransactionCompleted={isTransactionCompleted}
              onUpdatePayment={onUpdatePayment}
              onRemovePayment={onRemovePayment}
            />
          )}
        </div>

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
          <div className="space-y-2">
            <Button
              onClick={() => {
                setSelectedPaymentMethod("cash");
                setIsSelectingPaymentMethod(false);
              }}
              disabled={cartItemsCount === 0}
              className="w-full py-10 bg-primary text-white hover:bg-primary/90 hover:text-white"
              size="lg"
              variant="outline"
            >
              <Banknote className="w-4 h-4 mr-2" />
              Pay with Cash
            </Button>
            <Button
              onClick={() => {
                setSelectedPaymentMethod("mobile_money");
                setIsSelectingPaymentMethod(false);
              }}
              disabled={cartItemsCount === 0}
              variant="outline"
              className="w-full py-10 bg-yellow-200 hover:bg-yellow-300 text-yellow-900 hover:text-yellow-800"
              size="lg"
            >
              <Smartphone className="w-4 h-4 mr-2" />
              Pay with Mobile Money
            </Button>
            <Button
              onClick={() => {
                setSelectedPaymentMethod("card");
                setIsSelectingPaymentMethod(false);
              }}
              disabled={cartItemsCount === 0}
              variant="outline"
              className="w-full py-10 bg-rose-200 hover:bg-rose-300 text-rose-900 hover:text-rose-800"
              size="lg"
            >
              <CreditCard className="w-4 h-4 mr-2" />
              Pay with Card
            </Button>
          </div>
        )}

        {showPaymentEditor && (
          <PaymentView
            cartItemCount={cartItemsCount}
            paymentCount={payments.length}
            totalPaid={totalPaid}
            remainingDue={remainingDue}
            amountDue={total}
            formatter={formatter}
            selectedPaymentMethod={selectedPaymentMethod}
            setSelectedPaymentMethod={setSelectedPaymentMethod}
            onAddPayment={(method, amount) => onAddPayment?.(method, amount)}
            onAddAnotherPaymentMethod={() => setIsSelectingPaymentMethod(true)}
            onClearPayments={() => {
              setSelectedPaymentMethod(null);
              setIsSelectingPaymentMethod(false);
              onClearPayments?.();
            }}
            onComplete={handleCompleteTransaction}
            isCompleting={isCompleting}
          />
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
