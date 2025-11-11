import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  Banknote,
  CalendarClock,
  CheckCircle,
  CheckCircle2,
  CreditCard,
  Receipt,
  Smartphone,
  User,
  Wallet,
} from "lucide-react";

import View from "../../View";
import { FadeIn } from "../../common/FadeIn";
import { SimplePageHeader } from "../../common/PageHeader";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { Badge } from "../../ui/badge";
import { getRelativeTime } from "~/src/lib/utils";
import { OrderSummary } from "../OrderSummary";
import { CartItems } from "../CartItems";
import type { CartItem } from "../types";
import type { Id } from "~/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { EmptyState } from "../../states/empty/empty-state";
import { currencyFormatter } from "~/convex/utils";

type RouteParams =
  | {
      transactionId: string;
    }
  | undefined;

export function TransactionView() {
  const params = useParams({
    strict: false,
  }) as RouteParams;
  const transactionId = params?.transactionId;
  const { activeStore } = useGetActiveStore();

  const transaction = useQuery(
    api.inventory.pos.getTransactionById,
    transactionId
      ? {
          transactionId: transactionId as Id<"posTransaction">,
        }
      : "skip"
  );

  const formatter = useMemo(
    () => currencyFormatter(activeStore?.currency || "USD"),
    [activeStore]
  );

  const cartItems: CartItem[] = useMemo(() => {
    if (!transaction) return [];
    return transaction.items.map((item) => ({
      id: item._id,
      name: item.productName,
      barcode: item.barcode || "",
      sku: item.productSku,
      price: item.unitPrice,
      quantity: item.quantity,
      productId: item.productId,
      skuId: item.productSkuId,
      image: item.image || undefined,
    }));
  }, [transaction]);

  const completedData = useMemo(() => {
    if (!transaction) return undefined;
    return {
      paymentMethod: transaction.paymentMethod,
      completedAt: transaction.completedAt,
      cartItems,
      subtotal: transaction.subtotal,
      tax: transaction.tax,
      total: transaction.total,
      customerInfo:
        transaction.customerInfo ??
        (transaction.customer
          ? {
              name: transaction.customer.name ?? undefined,
              email: transaction.customer.email ?? undefined,
              phone: transaction.customer.phone ?? undefined,
            }
          : undefined),
    };
  }, [transaction, cartItems]);

  if (!transactionId) {
    return null;
  }

  if (!transaction) {
    return (
      <View>
        <FadeIn>
          <div className="container mx-auto p-6 min-h-[50vh]" />
        </FadeIn>
      </View>
    );
  }

  const paymentMethodIcon =
    transaction.paymentMethod === "cash"
      ? Banknote
      : transaction.paymentMethod === "card"
        ? CreditCard
        : Smartphone;

  const PaymentIcon = paymentMethodIcon;

  return (
    <View
      header={
        <SimplePageHeader
          title={`Transaction #${transaction.transactionNumber}`}
        />
      }
    >
      <FadeIn>
        <div className="container mx-auto p-6 space-y-8">
          <div className="grid gap-8 lg:grid-cols-[380px,1fr]">
            <div className="space-y-6">
              <div>
                <CardHeader className="space-y-3">
                  <Badge
                    variant="outline"
                    className="w-fit text-green-600 flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Completed
                    <p className="text-xs text-muted-foreground">
                      {getRelativeTime(transaction.completedAt)}
                    </p>
                  </Badge>
                  {/* <CardTitle className="text-lg">Transaction details</CardTitle> */}
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {transaction.cashier && (
                    <div className="flex items-center gap-3">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">
                          {`${transaction.cashier.firstName} ${transaction.cashier.lastName.charAt(0)}.`}
                        </p>
                        <p className="text-xs text-muted-foreground">Cashier</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <PaymentIcon className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium capitalize">
                        {transaction.paymentMethod.replace("_", " ")}
                      </p>
                      {/* {transaction.amountPaid !== undefined && (
                        <p className="text-xs text-muted-foreground">
                          Amount paid:{" "}
                          {formatter.format(transaction.amountPaid)}
                        </p>
                      )} */}
                      {transaction.changeGiven !== undefined &&
                        transaction.changeGiven > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Change given:{" "}
                            {formatter.format(transaction.changeGiven)}
                          </p>
                        )}
                    </div>
                  </div>

                  {(transaction.customer || transaction.customerInfo) && (
                    <div className="flex flex-col gap-1">
                      <p className="font-medium">Customer</p>
                      <p className="text-sm">
                        {transaction.customer?.name ||
                          transaction.customerInfo?.name ||
                          "Walk-in customer"}
                      </p>
                      {(transaction.customer?.email ||
                        transaction.customer?.phone ||
                        transaction.customerInfo?.email ||
                        transaction.customerInfo?.phone) && (
                        <p className="text-xs text-muted-foreground">
                          {transaction.customer?.email ||
                            transaction.customerInfo?.email}
                          {(transaction.customer?.email ||
                            transaction.customerInfo?.email) &&
                          (transaction.customer?.phone ||
                            transaction.customerInfo?.phone)
                            ? " • "
                            : ""}
                          {transaction.customer?.phone ||
                            transaction.customerInfo?.phone}
                        </p>
                      )}
                    </div>
                  )}

                  {/* {transaction.notes && (
                    <div className="space-y-1">
                      <p className="font-medium">Notes</p>
                      <p className="text-sm text-muted-foreground">
                        {transaction.notes}
                      </p>
                    </div>
                  )} */}
                </CardContent>
              </div>

              <OrderSummary
                cartItems={cartItems}
                onClearCart={() => {}}
                onClearCustomer={() => {}}
                readOnly
                completedTransactionData={completedData}
                cashierNameOverride={
                  transaction.cashier
                    ? `${transaction.cashier.firstName} ${transaction.cashier.lastName.charAt(0)}.`
                    : undefined
                }
                receiptNumberOverride={transaction.transactionNumber}
                customerInfo={
                  transaction.customer
                    ? {
                        name: transaction.customer.name ?? "",
                        email: transaction.customer.email ?? "",
                        phone: transaction.customer.phone ?? "",
                      }
                    : transaction.customerInfo
                      ? {
                          name: transaction.customerInfo.name ?? "",
                          email: transaction.customerInfo.email ?? "",
                          phone: transaction.customerInfo.phone ?? "",
                        }
                      : undefined
                }
              />
            </div>

            <CartItems cartItems={cartItems} readOnly />
          </div>
        </div>
      </FadeIn>
    </View>
  );
}

export default TransactionView;
