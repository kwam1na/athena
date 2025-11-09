import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { render } from "@react-email/components";
import {
  CreditCard,
  Wallet,
  Loader2,
  Check,
  Printer,
  Banknote,
  Plus,
  Smartphone,
} from "lucide-react";
import { CartItem } from "./types";
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
}: OrderSummaryProps) {
  const { activeStore } = useGetActiveStore();
  const terminal = useGetTerminal();
  const formatter = currencyFormatter(activeStore?.currency || "GHS");
  const { transaction, state } = usePOSOperations();
  const { printReceipt } = usePrint();

  const activeSession = usePOSActiveSession(
    activeStore?._id as Id<"store">,
    terminal?._id as Id<"posTerminal">
  );

  const cashier = usePOSCashier();
  // Use store state for most current data, fall back to props for compatibility
  const currentCartItems =
    state.cartItems.length > 0 ? state.cartItems : cartItems;
  const currentCustomerInfo = state.currentCustomer || customerInfo;

  // Use store state for real-time totals, fallback to props for session-based POS
  const subtotal = state.cartSubtotal || propSubtotal || 0;
  const tax = state.cartTax || propTax || 0;
  const total = state.cartTotal || propTotal || 0;

  const cartItemsCount = state.cartItems.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  const cartItemsCountText =
    cartItemsCount > 1 ? `${cartItemsCount} items` : `${cartItemsCount} item`;

  const handleCompleteTransaction = async (
    paymentMethod: string,
    session: POSSession
  ) => {
    // Prevent multiple concurrent calls
    if (
      state.isTransactionCompleting ||
      !activeStore ||
      currentCartItems.length === 0
    )
      return;

    // Use the transaction service to process payment
    const result = await transaction.processPayment(paymentMethod, session);

    if (result.success) {
      // Notify parent that transaction is completed
      onTransactionStateChange?.(true);
    }
  };

  const handleNewTransaction = () => {
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
      !state.completedOrderNumber ||
      !state.transaction.completedTransactionData ||
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
      const completedTransactionData =
        state.transaction.completedTransactionData!;

      const formatter = currencyFormatter(activeStore.currency || "GHS");
      const completedAtDate =
        completedTransactionData.completedAt instanceof Date
          ? completedTransactionData.completedAt
          : new Date(completedTransactionData.completedAt);

      const receiptItems = completedTransactionData.cartItems.map(
        (item, index) => {
          const attributeParts: string[] = [];
          if (item.size) {
            attributeParts.push(`${item.size}`);
          }
          if (item.length) {
            attributeParts.push(`${item.length}"`);
          }

          return {
            name: capitalizeWords(item.name),
            totalPrice: formatter.format(item.price * item.quantity),
            quantityLabel: `${item.quantity} × ${formatter.format(item.price)}`,
            skuOrBarcode: item.sku || item.barcode,
            attributes:
              attributeParts.length > 0
                ? attributeParts.join(" • ")
                : undefined,
          };
        }
      );

      const paymentMethodLabel = formatPaymentMethod(
        completedTransactionData.paymentMethod
      );

      const storeContact = activeStore.config?.contactInfo;
      const [street, city, addressState, zipCode, country] =
        storeContact?.location?.split(",") || [];

      const receiptHTML = await render(
        <PosReceiptEmail
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
          receiptNumber={state.completedOrderNumber}
          completedDate={completedAtDate.toLocaleDateString()}
          completedTime={completedAtDate.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })}
          itemsCount={cartItemsCount}
          cashierName={`${cashier?.firstName} ${cashier?.lastName.charAt(0)}.`}
          registerNumber={registerNumber || undefined}
          customerInfo={completedTransactionData.customerInfo}
          items={receiptItems}
          subtotal={formatter.format(completedTransactionData.subtotal)}
          tax={
            completedTransactionData.tax > 0
              ? formatter.format(completedTransactionData.tax)
              : undefined
          }
          total={formatter.format(completedTransactionData.total)}
          paymentMethodLabel={paymentMethodLabel}
        />
      );

      printReceipt(receiptHTML);
    } catch (error) {
      console.error("Error in handlePrintReceipt:", error);
    }
  };

  // Show completed transaction state
  if (state.isTransactionCompleted) {
    return (
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <Check className="w-6 h-6 text-green-600" />
          </div>
          <CardTitle className="text-green-600">
            Transaction Complete!
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <p className="text-sm text-gray-600">Order Number</p>
            <p className="text-lg font-semibold">
              {state.completedOrderNumber}
            </p>
          </div>

          {state.transaction.completedTransactionData && (
            <div className="text-center text-sm text-gray-600">
              <p>
                Completed at{" "}
                {state.transaction.completedTransactionData.completedAt.toLocaleTimeString()}
              </p>
              <p>
                Payment:{" "}
                {formatPaymentMethod(
                  state.transaction.completedTransactionData.paymentMethod
                )}
              </p>
            </div>
          )}

          <Separator />

          <div className="flex gap-2">
            <Button
              onClick={handlePrintReceipt}
              variant="outline"
              className="flex-1"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print Receipt
            </Button>
            <Button onClick={handleNewTransaction} className="flex-1">
              <Plus className="w-4 h-4 mr-2" />
              New Transaction
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div
      className={cn(
        "border rounded-lg",
        terminal === null && "opacity-60 transition-all duration-300"
      )}
    >
      <CardHeader className="flex flex-row baseline justify-between">
        <p className="text-lg font-medium">Summary</p>
        {cartItemsCount > 0 && (
          <p className="text-sm text-gray-600">{cartItemsCountText}</p>
        )}
      </CardHeader>
      <div className="p-6 space-y-40">
        {/* Order totals */}
        <div className="space-y-8">
          <div className="flex justify-between">
            <span className="text-lg">Subtotal</span>
            <span className="text-xl">{formatter.format(subtotal)}</span>
          </div>
          {tax > 0 && (
            <div className="flex justify-between">
              <span>Tax</span>
              <span>{formatter.format(tax)}</span>
            </div>
          )}
          {/* <Separator /> */}
          <div className="flex justify-between items-baseline">
            <span className="text-xl">Total</span>
            <span className="text-3xl">{formatter.format(total)}</span>
          </div>
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
        <div className="space-y-2">
          <Button
            onClick={() =>
              handleCompleteTransaction("cash", activeSession as POSSession)
            }
            disabled={state.isTransactionCompleting || cartItemsCount == 0}
            className="w-full py-8 bg-green-200 hover:bg-green-300 text-green-900 hover:text-green-800"
            size="lg"
            variant="outline"
          >
            <Banknote className="w-4 h-4 mr-2" />
            Pay with Cash
          </Button>
          <Button
            onClick={() =>
              handleCompleteTransaction(
                "digital_wallet",
                activeSession as POSSession
              )
            }
            disabled={state.isTransactionCompleting || cartItemsCount == 0}
            variant="outline"
            className="w-full py-8 bg-yellow-200 hover:bg-yellow-300 text-yellow-900 hover:text-yellow-800"
            size="lg"
          >
            <Smartphone className="w-4 h-4 mr-2" />
            Pay with Mobile Money
          </Button>

          <Button
            onClick={() =>
              handleCompleteTransaction("card", activeSession as POSSession)
            }
            disabled={state.isTransactionCompleting || cartItemsCount == 0}
            variant="outline"
            className="w-full py-8 bg-blue-200 hover:bg-blue-300 text-blue-900 hover:text-blue-800"
            size="lg"
          >
            <CreditCard className="w-4 h-4 mr-2" />
            Pay with Card
          </Button>
        </div>
      </div>
    </div>
  );

  function formatPaymentMethod(method: string) {
    switch (method) {
      case "card":
        return "Card Payment";
      case "cash":
        return "Cash Payment";
      case "digital_wallet":
        return "Digital Wallet";
      default:
        return method;
    }
  }
}
