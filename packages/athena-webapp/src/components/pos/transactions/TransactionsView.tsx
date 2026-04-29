import { useEffect, useMemo, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Receipt } from "lucide-react";

import View from "../../View";
import { FadeIn } from "../../common/FadeIn";
import { EmptyState } from "../../states/empty/empty-state";
import { GenericDataTable } from "../../base/table/data-table";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { currencyFormatter, capitalizeWords } from "~/convex/utils";
import {
  transactionColumns,
  CompletedTransactionRow,
} from "./transactionColumns";
import { SimplePageHeader } from "../../common/PageHeader";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";
import type { Id } from "~/convex/_generated/dataModel";

function formatPaymentMethod(method: string | null) {
  if (!method) return "Unknown";
  return capitalizeWords(method.replace(/_/g, " "));
}

// Helper to check if timestamp is today
const isToday = (timestamp: number) => {
  const date = new Date(timestamp);
  const today = new Date();
  return date.toDateString() === today.toDateString();
};

export function TransactionsView() {
  const { activeStore } = useGetActiveStore();
  const { registerSessionId } = useSearch({ strict: false }) as {
    registerSessionId?: string;
  };
  const [filter, setFilter] = useState<"today" | "all">(
    registerSessionId ? "all" : "today",
  );

  const transactions = useQuery(
    api.inventory.pos.getCompletedTransactions,
    activeStore?._id
      ? {
          storeId: activeStore._id,
          ...(registerSessionId
            ? {
                registerSessionId:
                  registerSessionId as Id<"registerSession">,
              }
            : {}),
        }
      : "skip",
  );

  const formatter = useMemo(
    () => (activeStore ? currencyFormatter(activeStore.currency) : null),
    [activeStore],
  );

  const tableData: CompletedTransactionRow[] = useMemo(() => {
    if (!transactions || !formatter) return [];

    return transactions.map((transaction: any) => ({
      _id: transaction._id,
      transactionNumber: transaction.transactionNumber,
      formattedTotal: formatStoredAmount(formatter, transaction.total),
      paymentMethodLabel: transaction.hasMultiplePaymentMethods
        ? "Multiple payment methods"
        : formatPaymentMethod(transaction.paymentMethod),
      paymentMethod: transaction.paymentMethod || "cash",
      hasMultiplePaymentMethods: Boolean(transaction.hasMultiplePaymentMethods),
      cashierName: transaction.cashierName,
      customerName: transaction.customerName,
      itemCount: transaction.itemCount,
      completedAt: transaction.completedAt,
      hasTrace: transaction.hasTrace,
      sessionTraceId: null,
    }));
  }, [transactions, formatter]);

  const filteredData = useMemo(() => {
    if (filter === "all") return tableData;
    return tableData.filter((t) => isToday(t.completedAt));
  }, [tableData, filter]);

  useEffect(() => {
    if (registerSessionId) {
      setFilter("all");
    }
  }, [registerSessionId]);

  if (!activeStore || !transactions || !formatter) return null;

  const hasTransactions = filteredData.length > 0;

  return (
    <View header={<SimplePageHeader title="Completed Transactions" />}>
      <FadeIn>
        <div className="container mx-auto p-6 space-y-4">
          {registerSessionId ? (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Showing transactions linked to this register session.
            </div>
          ) : null}

          <Tabs
            value={filter}
            onValueChange={(v) => setFilter(v as "today" | "all")}
          >
            <TabsList>
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="all">All Time</TabsTrigger>
            </TabsList>
          </Tabs>

          {hasTransactions ? (
            <GenericDataTable
              data={filteredData}
              columns={transactionColumns}
              tableId="pos-completed-transactions"
            />
          ) : (
            <div className="flex items-center justify-center min-h-[50vh]">
              <EmptyState
                icon={<Receipt className="w-16 h-16 text-muted-foreground" />}
                title={
                  <p className="text-muted-foreground">
                    {filter === "today"
                      ? "No completed transactions today"
                      : registerSessionId
                        ? "No transactions for this register session"
                      : "No completed transactions"}
                  </p>
                }
              />
            </div>
          )}
        </div>
      </FadeIn>
    </View>
  );
}

export default TransactionsView;
