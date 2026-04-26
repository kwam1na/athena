import { useEffect, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Smartphone,
  User,
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
import { CardContent, CardHeader } from "../../ui/card";
import { currencyFormatter } from "~/convex/utils";
import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";
import { WorkflowTraceRouteLink } from "../../traces/WorkflowTraceRouteLink";
import { Button } from "../../ui/button";
import config from "~/src/config";

type RouteParams =
  | {
      transactionId: string;
    }
  | undefined;

export function TransactionView() {
  useEffect(() => {
    const htmlStyle = document.documentElement.style;
    const bodyStyle = document.body.style;
    const previousHtmlOverflow = htmlStyle.overflow;
    const previousHtmlOverscrollBehaviorY = htmlStyle.overscrollBehaviorY;
    const previousBodyOverflow = bodyStyle.overflow;
    const previousBodyOverscrollBehaviorY = bodyStyle.overscrollBehaviorY;

    htmlStyle.overflow = "hidden";
    htmlStyle.overscrollBehaviorY = "none";
    bodyStyle.overflow = "hidden";
    bodyStyle.overscrollBehaviorY = "none";

    return () => {
      htmlStyle.overflow = previousHtmlOverflow;
      htmlStyle.overscrollBehaviorY = previousHtmlOverscrollBehaviorY;
      bodyStyle.overflow = previousBodyOverflow;
      bodyStyle.overscrollBehaviorY = previousBodyOverscrollBehaviorY;
    };
  }, []);

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
    return transaction.items.map((item: (typeof transaction.items)[number]) => ({
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
      paymentMethod: transaction.paymentMethod || "cash",
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
  const storefrontReceiptUrl = `${config.storeFrontUrl.replace(
    /\/$/,
    "",
  )}/shop/receipt/${transactionId}`;

  return (
    <View
      className="h-[calc(100dvh-2.5rem)] max-h-[calc(100dvh-2.5rem)] min-h-0 overflow-hidden"
      header={
        <SimplePageHeader
          title={`Transaction #${transaction.transactionNumber}`}
        />
      }
      mainClassName="min-h-0 h-full overflow-hidden"
    >
      <FadeIn className="h-full">
      <div className="container mx-auto h-full min-h-0 p-6">
          <div className="grid h-full min-h-0 gap-8 xl:grid-cols-[380px,minmax(0,1fr)]">
            <div className="space-y-6">
              <section className="overflow-hidden rounded-[1.25rem] border border-border/80 bg-surface-raised shadow-surface">
                <CardHeader className="space-y-4 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Badge
                      variant="outline"
                      className="w-fit border-[hsl(var(--success)/0.22)] bg-[hsl(var(--success)/0.08)] text-[hsl(var(--success))] flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Completed
                      <p className="text-xs text-muted-foreground">
                        {getRelativeTime(transaction.completedAt)}
                      </p>
                    </Badge>
                    {transaction.sessionTraceId ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <WorkflowTraceRouteLink
                          traceId={transaction.sessionTraceId}
                        >
                          Session trace
                        </WorkflowTraceRouteLink>
                      </div>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 border-t border-border/70 pt-4 text-sm">
                  {transaction.cashier && (
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        <User className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-medium">
                          {`${transaction.cashier.firstName} ${transaction.cashier.lastName.charAt(0)}.`}
                        </p>
                        <p className="text-xs text-muted-foreground">Cashier</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <PaymentIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-medium capitalize">
                        {transaction.paymentMethod?.replace("_", " ") ||
                          "Unknown"}
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
                            {formatStoredAmount(
                              formatter,
                              transaction.changeGiven
                            )}
                          </p>
                        )}
                    </div>
                  </div>

                  <div>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() =>
                        window.open(storefrontReceiptUrl, "_blank", "noreferrer")
                      }
                    >
                      View receipt
                    </Button>
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
              </section>

              <OrderSummary
                cartItems={cartItems}
                readOnly
                presentation="rail"
                registerNumber={transaction.registerNumber}
                completedOrderNumber={transaction.transactionNumber}
                completedTransactionData={completedData}
                cashierName={
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

            <CartItems
              cartItems={cartItems}
              readOnly
              className="h-full min-h-0"
            />
          </div>
        </div>
      </FadeIn>
    </View>
  );
}

export default TransactionView;
