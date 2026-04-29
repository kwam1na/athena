import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Check } from "lucide-react";

import View from "../../View";
import { FadeIn } from "../../common/FadeIn";
import { SimplePageHeader } from "../../common/PageHeader";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { CartItems } from "../CartItems";
import type { CartItem } from "../types";
import type { Id } from "~/convex/_generated/dataModel";
import { currencyFormatter } from "~/convex/utils";
import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";
import { formatStaffDisplayName } from "~/shared/staffDisplayName";

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
      : "skip",
  );

  const formatter = useMemo(
    () => currencyFormatter(activeStore?.currency || "USD"),
    [activeStore],
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

  const staffProfileName = useMemo(() => {
    const staffProfile = expenseTransaction?.staffProfile;
    if (!staffProfile) return null;

    return formatStaffDisplayName(staffProfile);
  }, [expenseTransaction]);

  const totalQuantity = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems],
  );
  const completedAtDate = new Date(expenseTransaction?.completedAt ?? 0);
  const completedDateLabel = expenseTransaction
    ? completedAtDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";
  const completedTimeLabel = expenseTransaction
    ? completedAtDate.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "";

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

  return (
    <View
      header={
        <SimplePageHeader
          title={`Expense Report #${expenseTransaction.transactionNumber}`}
        />
      }
    >
      <FadeIn className="h-full">
        <div className="container mx-auto h-full min-h-0 p-6">
          <div className="grid h-full min-h-0 gap-8 xl:grid-cols-[380px,minmax(0,1fr)]">
            <div className="space-y-6">
              <section className="overflow-hidden rounded-[1.5rem] border border-border/80 bg-surface-raised shadow-surface">
                <div className="border-b border-border/70 bg-[linear-gradient(180deg,_hsl(var(--surface-raised)),_hsl(var(--surface)))] px-5 py-5">
                  <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]">
                      <Check className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                        Expense summary
                      </p>
                      <h2 className="text-xl font-semibold tracking-tight text-foreground">
                        Expense recorded
                      </h2>
                    </div>
                  </div>
                </div>

                <dl className="space-y-4 px-5 py-5">
                  <div className="flex items-start justify-between gap-4 text-sm">
                    <dt className="text-muted-foreground">Report</dt>
                    <dd className="max-w-[62%] text-right font-medium text-foreground">
                      #{expenseTransaction.transactionNumber}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4 text-sm">
                    <dt className="text-muted-foreground">Completed</dt>
                    <dd className="max-w-[62%] text-right font-medium text-foreground">
                      {completedDateLabel} • {completedTimeLabel}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4 text-sm">
                    <dt className="text-muted-foreground">Recorded by</dt>
                    <dd className="max-w-[62%] text-right font-medium text-foreground">
                      {staffProfileName || "Unassigned"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4 text-sm">
                    <dt className="text-muted-foreground">Items</dt>
                    <dd className="max-w-[62%] text-right font-medium text-foreground">
                      {totalQuantity} {totalQuantity === 1 ? "item" : "items"}
                    </dd>
                  </div>
                  {expenseTransaction.notes && (
                    <div className="flex items-start justify-between gap-4 text-sm">
                      <dt className="text-muted-foreground">Notes</dt>
                      <dd className="max-w-[62%] text-right font-medium text-foreground">
                        {expenseTransaction.notes}
                      </dd>
                    </div>
                  )}
                </dl>

                <div className="space-y-6 border-t border-border/70 bg-surface px-5 py-5">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Total
                    </span>
                    <span className="text-3xl font-semibold tracking-tight text-foreground">
                      {formatStoredAmount(
                        formatter,
                        expenseTransaction.totalValue,
                      )}
                    </span>
                  </div>
                </div>
              </section>
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

export default ExpenseReportView;
