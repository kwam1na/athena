import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Receipt } from "lucide-react";

import View from "../../View";
import { FadeIn } from "../../common/FadeIn";
import { EmptyState } from "../../states/empty/empty-state";
import { GenericDataTable } from "../../base/table/data-table";
import {
  PageLevelHeader,
  PageWorkspace,
} from "../../common/PageLevelHeader";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { currencyFormatter } from "~/convex/utils";
import { expenseReportColumns, ExpenseReportRow } from "./expenseReportColumns";
import { toExpenseReportRows } from "./expenseReportRows";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Helper to check if timestamp is today
const isToday = (timestamp: number) => {
  const date = new Date(timestamp);
  const today = new Date();
  return date.toDateString() === today.toDateString();
};

export function ExpenseReportsView() {
  const { activeStore } = useGetActiveStore();
  const [filter, setFilter] = useState<"today" | "all">("today");

  const expenseTransactions = useQuery(
    api.inventory.expenseTransactions.getExpenseTransactions,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  );

  const formatter = useMemo(
    () => (activeStore ? currencyFormatter(activeStore.currency) : null),
    [activeStore],
  );

  const tableData: ExpenseReportRow[] = useMemo(() => {
    if (!expenseTransactions || !formatter) return [];

    return toExpenseReportRows(expenseTransactions, formatter);
  }, [expenseTransactions, formatter]);

  const filteredData = useMemo(() => {
    if (filter === "all") return tableData;
    return tableData.filter((t) => isToday(t.completedAt));
  }, [tableData, filter]);

  if (!activeStore || !expenseTransactions || !formatter) return null;

  const hasReports = filteredData.length > 0;

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Point of sale"
            showBackButton
            title="Expense Reports"
            description="Review completed POS expense reports by operating day and staff member."
          />

          <section className="space-y-layout-md">
          <Tabs
            value={filter}
            onValueChange={(v) => setFilter(v as "today" | "all")}
          >
            <TabsList>
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="all">All Time</TabsTrigger>
            </TabsList>
          </Tabs>

          {hasReports ? (
            <GenericDataTable
              data={filteredData}
              columns={expenseReportColumns}
              tableId="pos-expense-reports"
            />
          ) : (
            <div className="flex items-center justify-center min-h-[50vh]">
              <EmptyState
                icon={<Receipt className="w-16 h-16 text-muted-foreground" />}
                title={
                  <p className="text-muted-foreground">
                    {filter === "today"
                      ? "No expense reports today"
                      : "No expense reports"}
                  </p>
                }
              />
            </div>
          )}
          </section>
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

export default ExpenseReportsView;
