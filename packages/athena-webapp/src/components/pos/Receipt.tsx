import React from "react";
import { CartItem } from "./types";
import { currencyFormatter } from "~/convex/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { capitalizeWords } from "~/src/lib/utils";

interface ReceiptProps {
  transactionNumber: string;
  cartItems: CartItem[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string;
  customerInfo?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  registerNumber?: string;
  completedAt?: Date;
}

export const Receipt: React.FC<ReceiptProps> = ({
  transactionNumber,
  cartItems,
  subtotal,
  tax,
  total,
  paymentMethod,
  customerInfo,
  registerNumber,
  completedAt = new Date(),
}) => {
  const { activeStore } = useGetActiveStore();
  const formatter = currencyFormatter(activeStore?.currency || "GHS");

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

  return (
    <div className="max-w-sm mx-auto bg-white p-6 font-mono text-sm leading-tight print:max-w-none print:shadow-none print:p-4">
      {/* Header */}
      <div className="text-center mb-6 border-b border-dashed border-gray-400 pb-4">
        <h1 className="text-lg font-bold mb-2">
          {activeStore?.name || "Store Name"}
        </h1>
        {activeStore?.config?.address && (
          <div className="text-xs space-y-1">
            <p>{activeStore.config.address.street}</p>
            <p>
              {activeStore.config.address.city},{" "}
              {activeStore.config.address.state}{" "}
              {activeStore.config.address.zipCode}
            </p>
            <p>{activeStore.config.address.country}</p>
            {activeStore.config.phone && <p>Tel: {activeStore.config.phone}</p>}
            {activeStore.config.email && (
              <p>Email: {activeStore.config.email}</p>
            )}
          </div>
        )}
      </div>

      {/* Transaction Info */}
      <div className="mb-4 border-b border-dashed border-gray-400 pb-4">
        <div className="flex justify-between">
          <span>Receipt #:</span>
          <span className="font-bold">{transactionNumber}</span>
        </div>
        <div className="flex justify-between">
          <span>Date:</span>
          <span>{completedAt.toLocaleDateString()}</span>
        </div>
        <div className="flex justify-between">
          <span>Time:</span>
          <span>{completedAt.toLocaleTimeString()}</span>
        </div>
        {registerNumber && (
          <div className="flex justify-between">
            <span>Register:</span>
            <span>{registerNumber}</span>
          </div>
        )}
      </div>

      {/* Customer Info */}
      {customerInfo &&
        (customerInfo.name || customerInfo.email || customerInfo.phone) && (
          <div className="mb-4 border-b border-dashed border-gray-400 pb-4">
            <div className="font-bold mb-2">Customer Information:</div>
            {customerInfo.name && (
              <div className="flex justify-between">
                <span>Name:</span>
                <span>{customerInfo.name}</span>
              </div>
            )}
            {customerInfo.email && (
              <div className="flex justify-between">
                <span>Email:</span>
                <span className="text-xs">{customerInfo.email}</span>
              </div>
            )}
            {customerInfo.phone && (
              <div className="flex justify-between">
                <span>Phone:</span>
                <span>{customerInfo.phone}</span>
              </div>
            )}
          </div>
        )}

      {/* Items */}
      <div className="mb-4 border-b border-dashed border-gray-400 pb-4">
        <div className="font-bold mb-3">Items:</div>
        {cartItems.map((item, index) => (
          <div key={index} className="mb-3">
            <div className="flex justify-between">
              <span className="flex-1 truncate pr-2">
                {capitalizeWords(item.name)}
              </span>
              <span className="whitespace-nowrap">
                {formatter.format(item.price * item.quantity)}
              </span>
            </div>
            <div className="text-xs text-gray-600">
              <div className="flex justify-between">
                <span>
                  {item.barcode}
                  {(item.size || item.length) && (
                    <span className="ml-2">
                      {item.size && `Size: ${item.size}`}
                      {item.size && item.length && " • "}
                      {item.length && `Length: ${item.length}"`}
                    </span>
                  )}
                </span>
                <span>
                  {item.quantity} x {formatter.format(item.price)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="mb-4 border-b border-dashed border-gray-400 pb-4">
        <div className="flex justify-between mb-1">
          <span>Subtotal:</span>
          <span>{formatter.format(subtotal)}</span>
        </div>
        {tax > 0 && (
          <div className="flex justify-between mb-1">
            <span>Tax:</span>
            <span>{formatter.format(tax)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-base mt-2 pt-2 border-t border-solid border-gray-400">
          <span>TOTAL:</span>
          <span>{formatter.format(total)}</span>
        </div>
      </div>

      {/* Payment Method */}
      <div className="mb-4 border-b border-dashed border-gray-400 pb-4">
        <div className="flex justify-between">
          <span>Payment Method:</span>
          <span className="font-bold">
            {formatPaymentMethod(paymentMethod)}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs mt-6">
        <p className="mb-1">Thank you for your business!</p>
        <p className="mb-1">Please keep this receipt for your records</p>
        <p>Returns accepted within 30 days with receipt</p>
      </div>

      <div className="text-center text-xs mt-4 pt-4 border-t border-dashed border-gray-400">
        <p>Powered by Athena POS</p>
      </div>
    </div>
  );
};

export default Receipt;
