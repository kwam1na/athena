import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { render } from "@react-email/components";
import {
  CreditCard,
  Check,
  Printer,
  Banknote,
  Plus,
  Smartphone,
} from "lucide-react";
import { CartItem, Payment } from "./types";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { currencyFormatter } from "~/convex/utils";
import { usePOSOperations } from "~/src/hooks/usePOSOperations";
import { usePrint } from "~/src/hooks/usePrint";
import { capitalizeWords, cn } from "~/src/lib/utils";
import { Id } from "~/convex/_generated/dataModel";
import { POSSession } from "~/types";
import { usePOSActiveSession } from "~/src/hooks/usePOSSessions";
import { useGetTerminal } from "~/src/hooks/useGetTerminal";
import PosReceiptEmail from "~/convex/emails/PosReceiptEmail";
import { usePOSCashier } from "./hooks";
import config from "~/src/config";
import { useEffect, useState } from "react";
import { usePOSStore } from "~/src/stores/posStore";
import { PaymentView, type SelectedPaymentMethod } from "./PaymentView";
import { TotalsDisplay } from "./TotalsDisplay";
import { PaymentsAddedList } from "./PaymentsAddedList";
import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";

interface OrderSummaryProps {
  cartItems: CartItem[];
  onClearCart: () => void;
  onClearCustomer?: () => void;
  customerId?: Id<"posCustomer">;
  customerInfo?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  registerNumber?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  currentSessionId?: string | null;
  onTransactionStateChange?: (isCompleted: boolean) => void;
  readOnly?: boolean;
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
  };
  cashierNameOverride?: string;
  receiptNumberOverride?: string;
}

export function OrderSummary({
  cartItems,
  onClearCart,
  onClearCustomer,
  customerId,
  customerInfo,
  registerNumber,
  subtotal: propSubtotal,
  tax: propTax,
  total: propTotal,
  currentSessionId,
  onTransactionStateChange,
  readOnly = false,
  completedTransactionData,
  cashierNameOverride,
  receiptNumberOverride,
}: OrderSummaryProps) {
  const { activeStore } = useGetActiveStore();
  const terminal = useGetTerminal();
  const formatter = currencyFormatter(activeStore?.currency || "GHS");
  const { transaction, state } = usePOSOperations();
  const { printReceipt } = usePrint();
  const store = usePOSStore();
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<SelectedPaymentMethod | null>(null);

  const activeSession = usePOSActiveSession(
    activeStore?._id as Id<"store">,
    terminal?._id as Id<"posTerminal">
  );

  const cashier = usePOSCashier();
  // Use store state for most current data, fall back to props for compatibility
  const currentCartItems = readOnly
    ? cartItems
    : state.cartItems.length > 0
      ? state.cartItems
      : cartItems;
  const currentCustomerInfo =
    readOnly && customerInfo
      ? customerInfo
      : state.currentCustomer || customerInfo;

  // Use store state for real-time totals, fallback to props for session-based POS
  const subtotal = readOnly
    ? (completedTransactionData?.subtotal ?? propSubtotal ?? 0)
    : state.cartSubtotal || propSubtotal || 0;
  const tax = readOnly
    ? (completedTransactionData?.tax ?? propTax ?? 0)
    : state.cartTax || propTax || 0;
  const total = readOnly
    ? (completedTransactionData?.total ?? propTotal ?? 0)
    : state.cartTotal || propTotal || 0;

  const cartItemsCount = currentCartItems.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  const cartItemsCountText =
    cartItemsCount > 1 ? `${cartItemsCount} items` : `${cartItemsCount} item`;

  const handleCompleteTransaction = async (session: POSSession) => {
    if (readOnly) return;
    // Prevent multiple concurrent calls
    if (
      state.isTransactionCompleting ||
      !activeStore ||
      currentCartItems.length === 0
    )
      return;

    // Use the transaction service to process payment with payments array
    const result = await transaction.processPayment(session);

    if (result.success) {
      // Clear payments after successful transaction
      // store.clearPayments();
      setSelectedPaymentMethod(null);
      // Notify parent that transaction is completed
      onTransactionStateChange?.(true);
    }
  };

  const handleSelectedPaymentMethod = (
    method: SelectedPaymentMethod | null
  ) => {
    if (method) {
      store.setTransactionCompleting(true);
    } else {
      store.setTransactionCompleting(false);
    }

    setSelectedPaymentMethod(method);
  };

  const handleNewTransaction = () => {
    if (readOnly) return;
    transaction.startNewTransaction();

    onClearCart();
    onClearCustomer?.();
    onTransactionStateChange?.(false);
  };

  const handlePrintReceipt = async () => {
    console.log("Print receipt clicked");
    console.log("State check:", {
      completedOrderNumber: state.completedOrderNumber,
      hasTransactionData: !!state.transaction.completedTransactionData,
      hasActiveStore: !!activeStore,
      cartItemsLength: currentCartItems.length,
    });

    if (
      (!readOnly && !state.completedOrderNumber) ||
      (!readOnly && !state.transaction.completedTransactionData) ||
      !activeStore
    ) {
      console.error("Missing required data for receipt:", {
        completedOrderNumber: state.completedOrderNumber,
        completedTransactionData: state.transaction.completedTransactionData,
        activeStore: activeStore,
      });
      return;
    }

    try {
      // Use the completed transaction data for accurate totals
      // Get the totals from the stored completed transaction, not current cart state
      const completedData = readOnly
        ? completedTransactionData
        : state.transaction.completedTransactionData!;

      if (!completedData) {
        console.error("No completed transaction data available for receipt");
        return;
      }

      const formatter = currencyFormatter(activeStore.currency || "GHS");
      const completedAtDate =
        completedData.completedAt instanceof Date
          ? completedData.completedAt
          : new Date(completedData.completedAt);

      const receiptItems = completedData.cartItems.map((item, index) => {
        const attributeParts: string[] = [];
        if (item.size) {
          attributeParts.push(`${item.size}`);
        }
        if (item.length) {
          attributeParts.push(`${item.length}"`);
        }

        return {
          name: capitalizeWords(item.name),
          totalPrice: formatStoredAmount(
            formatter,
            item.price * item.quantity
          ),
          quantityLabel: `${item.quantity} × ${formatStoredAmount(formatter, item.price)}`,
          skuOrBarcode: item.sku || item.barcode,
          attributes:
            attributeParts.length > 0 ? attributeParts.join(" • ") : undefined,
        };
      });

      const paymentMethodLabel = formatPaymentMethod(
        completedData.paymentMethod
      );

      // Format payments - use completedTransactionData payments if transaction is completed,
      // otherwise use store payments for active transactions
      const paymentsToFormat =
        readOnly && completedTransactionData?.payments
          ? completedTransactionData.payments
          : !readOnly &&
              state.isTransactionCompleted &&
              state.transaction.completedTransactionData?.payments
            ? state.transaction.completedTransactionData.payments
            : !readOnly &&
                !state.isTransactionCompleted &&
                store.payment.payments.length > 0
              ? store.payment.payments
              : undefined;

      const formattedPayments =
        paymentsToFormat && paymentsToFormat.length > 0
          ? paymentsToFormat.map((payment: Payment) => ({
              method: payment.method,
              amount: formatStoredAmount(formatter, payment.amount),
            }))
          : undefined;

      // Calculate change given if payments exist
      const totalPaidFromPayments = paymentsToFormat
        ? paymentsToFormat.reduce(
            (sum: number, p: Payment) => sum + p.amount,
            0
          )
        : 0;
      const changeGiven =
        formattedPayments &&
        formattedPayments.length > 0 &&
        totalPaidFromPayments > completedData.total
          ? formatStoredAmount(
              formatter,
              totalPaidFromPayments - completedData.total
            )
          : undefined;

      const storeContact = activeStore.config?.contactInfo;
      const [street, city, addressState, zipCode, country] =
        storeContact?.location?.split(",") || [];

      const receiptHTML = await render(
        <PosReceiptEmail
          amountPaid={formatStoredAmount(formatter, totalPaidFromPayments)}
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
              ? (receiptNumberOverride ??
                state.completedOrderNumber ??
                "Transaction")
              : (state.completedOrderNumber ?? "Transaction")
          }
          completedDate={completedAtDate.toLocaleDateString()}
          completedTime={completedAtDate.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })}
          itemsCount={cartItemsCount}
          cashierName={
            cashierNameOverride ??
            `${cashier?.firstName ?? ""} ${
              cashier?.lastName ? `${cashier.lastName.charAt(0)}.` : ""
            }`.trim()
          }
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
        />
      );

      printReceipt(receiptHTML);
    } catch (error) {
      console.error("Error in handlePrintReceipt:", error);
    }
  };

  const changeDue = store.payment.totalPaid - total;

  const hasProvidedPayment =
    store.payment.payments.length > 0 && store.payment.remainingDue == 0;

  const showPaymentButtons =
    !readOnly && !hasProvidedPayment && !state.isTransactionCompleting;

  return (
    <div
      className={cn(
        state.isTransactionCompleted && "border rounded-lg",
        terminal === null &&
          !readOnly &&
          "opacity-60 transition-all duration-300"
        // state.isTransactionCompleted && "h-[70vh]"
      )}
    >
      {state.isTransactionCompleted && (
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
        {/* Order totals and payment totals */}
        <div className="space-y-16">
          <TotalsDisplay
            items={[
              { label: "Subtotal", value: subtotal, formatter },
              ...(tax > 0 ? [{ label: "Tax", value: tax, formatter }] : []),
              { label: "Total", value: total, formatter, highlight: true },
            ]}
          />

          {/* Payment totals - shown when payments exist */}
          {store.payment.payments.length > 0 && (
            <TotalsDisplay
              items={[
                {
                  label: "Total Paid",
                  value: store.payment.totalPaid,
                  formatter,
                  highlight: true,
                },
                ...(store.payment.totalPaid < total
                  ? [
                      {
                        label: "Remaining",
                        value: total - store.payment.totalPaid,
                        formatter,
                        highlight: true,
                      },
                    ]
                  : []),
                ...(store.payment.totalPaid > total
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

          {/* Payments Added List - shown when payments exist */}
          {store.payment.payments.length > 0 && (
            <PaymentsAddedList
              formatter={formatter}
              totalAmountDue={total}
              readOnly={readOnly}
            />
          )}
        </div>

        {/* Customer info if present */}
        {currentCustomerInfo &&
          (currentCustomerInfo.name || currentCustomerInfo.email) && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-sm mb-2">Customer</h4>
              {currentCustomerInfo.name && (
                <p className="text-sm">{currentCustomerInfo.name}</p>
              )}
              {currentCustomerInfo.email && (
                <p className="text-xs text-gray-600">
                  {currentCustomerInfo.email}
                </p>
              )}
            </div>
          )}

        {/* Payment buttons */}
        {showPaymentButtons && (
          <div className="space-y-2">
            <Button
              onClick={() => handleSelectedPaymentMethod("cash")}
              disabled={cartItemsCount == 0}
              className="w-full py-10 bg-primary text-white hover:bg-primary/90 hover:text-white"
              size="lg"
              variant="outline"
            >
              <Banknote className="w-4 h-4 mr-2" />
              Pay with Cash
            </Button>
            <Button
              onClick={() => handleSelectedPaymentMethod("mobile_money")}
              disabled={cartItemsCount == 0}
              variant="outline"
              className="w-full py-10 bg-yellow-200 hover:bg-yellow-300 text-yellow-900 hover:text-yellow-800"
              size="lg"
            >
              <Smartphone className="w-4 h-4 mr-2" />
              Pay with Mobile Money
            </Button>

            <Button
              onClick={() => handleSelectedPaymentMethod("card")}
              disabled={cartItemsCount == 0}
              variant="outline"
              className="w-full py-10 bg-rose-200 hover:bg-rose-300 text-rose-900 hover:text-rose-800"
              size="lg"
            >
              <CreditCard className="w-4 h-4 mr-2" />
              Pay with Card
            </Button>
          </div>
        )}

        {!showPaymentButtons && !readOnly && !state.isTransactionCompleted && (
          <PaymentView
            amountDue={total}
            formatter={formatter}
            selectedPaymentMethod={selectedPaymentMethod}
            onAddAnotherPaymentMethod={() => handleSelectedPaymentMethod(null)}
            onCancel={() => {
              handleSelectedPaymentMethod(null);
              store.clearPayments();
            }}
            onComplete={async () => {
              if (activeSession && activeSession.status === "active") {
                await handleCompleteTransaction(activeSession as POSSession);
              }
            }}
            setSelectedPaymentMethod={handleSelectedPaymentMethod}
          />
        )}

        {(readOnly || state.isTransactionCompleted) && (
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
                onClick={handleNewTransaction}
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
