import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  CreditCard,
  Wallet,
  Loader2,
  Check,
  Printer,
  Banknote,
  Plus,
} from "lucide-react";
import { CartItem } from "./types";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { currencyFormatter } from "~/convex/utils";
import { usePOSOperations } from "~/src/hooks/usePOSOperations";
import { usePrint } from "~/src/hooks/usePrint";
import { capitalizeWords } from "~/src/lib/utils";
import { Id } from "~/convex/_generated/dataModel";

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
  const formatter = currencyFormatter(activeStore?.currency || "GHS");
  const { transaction, state } = usePOSOperations();
  const { printReceipt } = usePrint();

  // Debug logging to track component updates
  console.log("📊 OrderSummary render:", {
    cartItemsCount: cartItems.length,
    stateCartItemsCount: state.cartItems.length,
    subtotal: propSubtotal,
    stateSubtotal: state.cartSubtotal,
    isTransactionCompleted: state.isTransactionCompleted,
    isTransactionCompleting: state.isTransactionCompleting,
  });

  // Use store state for most current data, fall back to props for compatibility
  const currentCartItems =
    state.cartItems.length > 0 ? state.cartItems : cartItems;
  const currentCustomerInfo = state.currentCustomer || customerInfo;

  console.log("💰 Totals debug:", {
    propSubtotal,
    propTax,
    propTotal,
    stateSubtotal: state.cartSubtotal,
    stateTax: state.cartTax,
    stateTotal: state.cartTotal,
    cartItemsInState: state.cartItems.map((item) => ({
      name: item.name,
      price: item.price,
      quantity: item.quantity,
    })),
  });

  // Use store state for real-time totals, fallback to props for session-based POS
  const subtotal = state.cartSubtotal || propSubtotal || 0;
  const tax = state.cartTax || propTax || 0;
  const total = state.cartTotal || propTotal || 0;

  console.log("💰 Final totals used:", { subtotal, tax, total });

  const handleCompleteTransaction = async (paymentMethod: string) => {
    // Prevent multiple concurrent calls
    if (
      state.isTransactionCompleting ||
      !activeStore ||
      currentCartItems.length === 0
    )
      return;

    // Use the transaction service to process payment
    const result = await transaction.processPayment(paymentMethod);

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

  const handlePrintReceipt = () => {
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

      const receiptItems = completedTransactionData.cartItems;
      const receiptSubtotal = completedTransactionData.subtotal;
      const receiptTax = completedTransactionData.tax;
      const receiptTotal = completedTransactionData.total;
      const receiptCustomerInfo = completedTransactionData.customerInfo;

      console.log("Receipt data:", {
        receiptItems: receiptItems.length,
        receiptSubtotal,
        receiptTax,
        receiptTotal,
        receiptCustomerInfo,
      });

      // Generate receipt HTML directly without React rendering issues
      const formatter = currencyFormatter(activeStore.currency || "GHS");

      const formatPaymentMethod = (method: string) => {
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
      };

      const receiptHTML = `
        <div class="text-center mb-6 border-b pb-4">
          <h1 class="text-lg font-bold mb-2">${activeStore.name || "Store Name"}</h1>
          ${
            activeStore.config?.address
              ? `
            <div class="text-xs space-y-1">
              <p>${activeStore.config.address.street || ""}</p>
              <p>${activeStore.config.address.city || ""}, ${activeStore.config.address.state || ""} ${activeStore.config.address.zipCode || ""}</p>
              <p>${activeStore.config.address.country || ""}</p>
              ${activeStore.config.phone ? `<p>Tel: ${activeStore.config.phone}</p>` : ""}
              ${activeStore.config.email ? `<p>Email: ${activeStore.config.email}</p>` : ""}
            </div>
          `
              : ""
          }
        </div>

        <div class="mb-4 border-b pb-4">
          <div class="flex justify-between">
            <span>Receipt #:</span>
            <span class="font-bold">${state.completedOrderNumber}</span>
          </div>
          <div class="flex justify-between">
            <span>Date:</span>
            <span>${completedTransactionData.completedAt.toLocaleDateString()}</span>
          </div>
          <div class="flex justify-between">
            <span>Time:</span>
            <span>${completedTransactionData.completedAt.toLocaleTimeString()}</span>
          </div>
          ${
            registerNumber
              ? `
            <div class="flex justify-between">
              <span>Register:</span>
              <span>${registerNumber}</span>
            </div>
          `
              : ""
          }
        </div>

        ${
          receiptCustomerInfo &&
          (receiptCustomerInfo.name ||
            receiptCustomerInfo.email ||
            receiptCustomerInfo.phone)
            ? `
          <div class="mb-4 border-b pb-4">
            <div class="font-bold mb-2">Customer Information:</div>
            ${
              receiptCustomerInfo.name
                ? `
              <div class="flex justify-between">
                <span>Name:</span>
                <span>${receiptCustomerInfo.name}</span>
              </div>
            `
                : ""
            }
            ${
              receiptCustomerInfo.email
                ? `
              <div class="flex justify-between">
                <span>Email:</span>
                <span class="text-xs">${receiptCustomerInfo.email}</span>
              </div>
            `
                : ""
            }
            ${
              receiptCustomerInfo.phone
                ? `
              <div class="flex justify-between">
                <span>Phone:</span>
                <span>${receiptCustomerInfo.phone}</span>
              </div>
            `
                : ""
            }
          </div>
        `
            : ""
        }

        <div class="mb-4 border-b pb-4">
          <div class="font-bold mb-3">Items:</div>
          ${receiptItems
            .map(
              (item, index) => `
            <div class="mb-3">
              <div class="flex justify-between">
                <span class="flex-1 truncate pr-2">${capitalizeWords(item.name)}</span>
                <span class="whitespace-nowrap">${formatter.format(item.price * item.quantity)}</span>
              </div>
              <div class="text-xs" style="color: #666;">
                <div class="flex justify-between">
                  <span>Qty: ${item.quantity} × ${formatter.format(item.price)}</span>
                  <span>${item.barcode}</span>
                </div>
              </div>
            </div>
          `
            )
            .join("")}
        </div>

        <div class="mb-4 border-b pb-4">
          <div class="flex justify-between">
            <span>Subtotal:</span>
            <span>${formatter.format(receiptSubtotal)}</span>
          </div>
          ${
            receiptTax > 0
              ? `
            <div class="flex justify-between">
              <span>Tax:</span>
              <span>${formatter.format(receiptTax)}</span>
            </div>
          `
              : ""
          }
          <div class="flex justify-between font-bold">
            <span>Total:</span>
            <span>${formatter.format(receiptTotal)}</span>
          </div>
        </div>

        <div class="mb-4 border-b pb-4">
          <div class="flex justify-between">
            <span>Payment Method:</span>
            <span>${formatPaymentMethod(completedTransactionData.paymentMethod)}</span>
          </div>
          <div class="flex justify-between">
            <span>Amount Paid:</span>
            <span>${formatter.format(receiptTotal)}</span>
          </div>
        </div>

        <div class="text-center text-xs">
          <p>Thank you for your business!</p>
          <p>Please keep this receipt for your records.</p>
        </div>
      `;

      console.log(
        "Calling printReceipt with HTML:",
        receiptHTML.substring(0, 100) + "..."
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

  console.log("cartItems", cartItems);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Order totals */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatter.format(subtotal)}</span>
          </div>
          {tax > 0 && (
            <div className="flex justify-between">
              <span>Tax</span>
              <span>{formatter.format(tax)}</span>
            </div>
          )}
          <Separator />
          <div className="flex justify-between font-semibold text-lg">
            <span>Total</span>
            <span>{formatter.format(total)}</span>
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
        {currentCartItems.length > 0 && (
          <div className="space-y-2">
            <Button
              onClick={() => handleCompleteTransaction("cash")}
              disabled={state.isTransactionCompleting}
              className="w-full"
              size="lg"
            >
              {state.isTransactionCompleting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Banknote className="w-4 h-4 mr-2" />
              )}
              Pay with Cash
            </Button>
            <Button
              onClick={() => handleCompleteTransaction("card")}
              disabled={state.isTransactionCompleting}
              variant="outline"
              className="w-full"
              size="lg"
            >
              {state.isTransactionCompleting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CreditCard className="w-4 h-4 mr-2" />
              )}
              Pay with Card
            </Button>
            <Button
              onClick={() => handleCompleteTransaction("digital_wallet")}
              disabled={state.isTransactionCompleting}
              variant="outline"
              className="w-full"
              size="lg"
            >
              {state.isTransactionCompleting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Wallet className="w-4 h-4 mr-2" />
              )}
              Digital Wallet
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
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
