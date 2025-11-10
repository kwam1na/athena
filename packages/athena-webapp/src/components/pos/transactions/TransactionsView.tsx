import { useMemo } from "react";
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

function formatPaymentMethod(method: string) {
  return capitalizeWords(method.replace(/_/g, " "));
}

export function TransactionsView() {
  const { activeStore } = useGetActiveStore();

  const transactions = useQuery(
    api.inventory.pos.getCompletedTransactions,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const formatter = useMemo(
    () => (activeStore ? currencyFormatter(activeStore.currency) : null),
    [activeStore]
  );

  const tableData: CompletedTransactionRow[] = useMemo(() => {
    if (!transactions || !formatter) return [];

    return transactions.map((transaction) => ({
      _id: transaction._id,
      transactionNumber: transaction.transactionNumber,
      formattedTotal: formatter.format(transaction.total),
      paymentMethodLabel: formatPaymentMethod(transaction.paymentMethod),
      paymentMethod: transaction.paymentMethod,
      cashierName: transaction.cashierName,
      customerName: transaction.customerName,
      itemCount: transaction.itemCount,
      completedAt: transaction.completedAt,
    }));
  }, [transactions, formatter]);

  if (!activeStore || !transactions || !formatter) return null;

  const hasTransactions = tableData.length > 0;

  console.log(tableData);

  return (
    <View
      header={
        <SimplePageHeader
          title="Completed Transactions"
          className="text-lg font-semibold"
        />
      }
    >
      <FadeIn>
        <div className="container mx-auto p-6">
          {hasTransactions ? (
            <GenericDataTable
              data={tableData}
              columns={transactionColumns}
              tableId="pos-completed-transactions"
            />
          ) : (
            <div className="flex items-center justify-center min-h-[50vh]">
              <EmptyState
                icon={<Receipt className="w-16 h-16 text-muted-foreground" />}
                title={
                  <p className="text-muted-foreground">
                    No completed transactions
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
