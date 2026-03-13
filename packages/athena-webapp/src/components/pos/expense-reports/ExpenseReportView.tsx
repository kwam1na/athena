import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { CheckCircle2, User, FileText } from "lucide-react";

import View from "../../View";
import { FadeIn } from "../../common/FadeIn";
import { SimplePageHeader } from "../../common/PageHeader";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { Badge } from "../../ui/badge";
import { getRelativeTime } from "~/src/lib/utils";
import { CartItems } from "../CartItems";
import type { CartItem } from "../types";
import type { Id } from "~/convex/_generated/dataModel";
import { Card, CardContent, CardHeader } from "../../ui/card";
import { currencyFormatter } from "~/convex/utils";
import { TotalsDisplay } from "../TotalsDisplay";

type RouteParams =
  | {
      reportId: string;
    }
  | undefined;

export function ExpenseReportView() {
  const params = useParams({
    strict: false,
  }) as RouteParams;
  const reportId = params?.reportId;
  const { activeStore } = useGetActiveStore();

  const expenseTransaction = useQuery(
    api.inventory.expenseTransactions.getExpenseTransactionById,
    reportId
      ? {
          transactionId: reportId as Id<"expenseTransaction">,
        }
      : "skip"
  );

  const formatter = useMemo(
    () => currencyFormatter(activeStore?.currency || "USD"),
    [activeStore]
  );

  const cartItems: CartItem[] = useMemo(() => {
    if (!expenseTransaction) return [];
    return expenseTransaction.items.map((item: any) => ({
      id: item._id,
      name: item.productName,
      barcode: "",
      sku: item.productSku,
      price: item.costPrice,
      quantity: item.quantity,
      productId: item.productId,
      color: item.color,
      skuId: item.productSkuId,
      image: item.image || undefined,
      size: item.size,
      length: item.length,
    }));
  }, [expenseTransaction]);

  if (!reportId) {
    return null;
  }

  if (!expenseTransaction) {
    return (
      <View>
        <FadeIn>
          <div className="container mx-auto p-6 min-h-[50vh]" />
        </FadeIn>
      </View>
    );
  }

  const statusBadge =
    expenseTransaction.status === "completed" ? (
      <Badge
        variant="outline"
        className="w-fit text-green-600 flex items-center gap-2"
      >
        <CheckCircle2 className="w-4 h-4" />
        Completed
      </Badge>
    ) : expenseTransaction.status === "void" ? (
      <Badge
        variant="outline"
        className="w-fit text-red-600 flex items-center gap-2"
      >
        Voided
      </Badge>
    ) : null;

  return (
    <View
      header={
        <SimplePageHeader
          title={`Expense Report #${expenseTransaction.transactionNumber}`}
        />
      }
    >
      <FadeIn>
        <div className="container mx-auto p-6 space-y-8">
          <div className="grid gap-8 lg:grid-cols-[380px,1fr]">
            <div className="space-y-6">
              <div>
                <CardHeader className="space-y-3">
                  {statusBadge && (
                    <div className="flex items-center gap-2">
                      {statusBadge}
                      <p className="text-xs text-muted-foreground">
                        {getRelativeTime(expenseTransaction.completedAt)}
                      </p>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {expenseTransaction.cashier && (
                    <div className="flex items-center gap-3">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">
                          {`${expenseTransaction.cashier.firstName} ${expenseTransaction.cashier.lastName.charAt(0)}.`}
                        </p>
                        <p className="text-xs text-muted-foreground">Cashier</p>
                      </div>
                    </div>
                  )}

                  {expenseTransaction.notes && (
                    <div className="flex items-start gap-3">
                      <FileText className="w-4 h-4 text-muted-foreground mt-1" />
                      <div className="space-y-1">
                        <p className="font-medium">Notes</p>
                        <p className="text-sm text-muted-foreground">
                          {expenseTransaction.notes}
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </div>

              <Card>
                <CardHeader>
                  <h3 className="text-lg font-medium">Summary</h3>
                </CardHeader>
                <CardContent>
                  <TotalsDisplay
                    items={[
                      {
                        label: "Total Value",
                        value: expenseTransaction.totalValue,
                        formatter,
                        highlight: true,
                      },
                    ]}
                  />
                </CardContent>
              </Card>
            </div>

            <CartItems cartItems={cartItems} readOnly />
          </div>
        </div>
      </FadeIn>
    </View>
  );
}

export default ExpenseReportView;
