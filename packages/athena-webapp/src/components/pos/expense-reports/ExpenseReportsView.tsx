import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowUpRight, Receipt } from "lucide-react";

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
import { getOrigin } from "~/src/lib/navigationUtils";
import { getRelativeTime } from "~/src/lib/utils";

// Helper to check if timestamp is today
const isToday = (timestamp: number) => {
  const date = new Date(timestamp);
  const today = new Date();
  return date.toDateString() === today.toDateString();
};

function ExpenseReportMobileCard({ report }: { report: ExpenseReportRow }) {
  const itemLabel = `${report.itemCount} ${
    report.itemCount === 1 ? "item" : "items"
  }`;

  return (
    <Link
      to="/$orgUrlSlug/store/$storeUrlSlug/pos/expense-reports/$reportId"
      params={(prev) => ({
        ...prev,
        orgUrlSlug: prev.orgUrlSlug!,
        storeUrlSlug: prev.storeUrlSlug!,
        reportId: report._id,
      })}
      search={{ o: getOrigin() }}
      aria-label={`Open expense report #${report.transactionNumber}`}
      className="block rounded-lg border border-border/70 bg-surface-raised p-layout-md shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-remote-assist-control="pos-expense-report"
      data-remote-assist-control-id={`pos-expense-report-${report._id}`}
      data-remote-assist-control-label={`Open expense report #${report.transactionNumber}`}
      data-remote-assist-control-role="link"
    >
      <div className="flex items-start justify-between gap-layout-md">
        <div className="min-w-0 space-y-1">
          <p className="flex min-w-0 items-center gap-1 text-lg font-semibold leading-6 text-foreground">
            <span className="truncate">#{report.transactionNumber}</span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {itemLabel}
          </p>
        </div>
        <p className="shrink-0 text-right text-lg font-semibold leading-6 text-foreground">
          {report.formattedTotal}
        </p>
      </div>

      <dl className="mt-layout-md grid gap-layout-sm border-t border-border/70 pt-layout-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-layout-sm">
          <dt className="text-xs font-medium uppercase leading-5 tracking-[0.12em] text-muted-foreground">
            Cashier
          </dt>
          <dd className="min-w-0 truncate text-right text-sm leading-5 text-foreground">
            {report.cashierName ?? "N/A"}
          </dd>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-layout-sm">
          <dt className="text-xs font-medium uppercase leading-5 tracking-[0.12em] text-muted-foreground">
            Completed
          </dt>
          <dd className="min-w-0 truncate text-right text-sm leading-5 text-foreground">
            {getRelativeTime(report.completedAt)}
          </dd>
        </div>
        {report.notes ? (
          <div className="space-y-1">
            <dt className="text-xs font-medium uppercase leading-5 tracking-[0.12em] text-muted-foreground">
              Notes
            </dt>
            <dd className="text-sm leading-5 text-foreground">
              {report.notes}
            </dd>
          </div>
        ) : null}
      </dl>
    </Link>
  );
}

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
                <TabsTrigger
                  data-remote-assist-control="pos-expense-report-filter"
                  data-remote-assist-control-id="pos-expense-reports-filter-today"
                  data-remote-assist-control-label="Today"
                  data-remote-assist-control-role="button"
                  value="today"
                >
                  Today
                </TabsTrigger>
                <TabsTrigger
                  data-remote-assist-control="pos-expense-report-filter"
                  data-remote-assist-control-id="pos-expense-reports-filter-all"
                  data-remote-assist-control-label="All Time"
                  data-remote-assist-control-role="button"
                  value="all"
                >
                  All Time
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {hasReports ? (
              <>
                <div className="grid gap-layout-sm md:hidden">
                  {filteredData.map((report) => (
                    <ExpenseReportMobileCard key={report._id} report={report} />
                  ))}
                </div>
                <div className="hidden md:block">
                  <GenericDataTable
                    data={filteredData}
                    columns={expenseReportColumns}
                    tableId="pos-expense-reports"
                  />
                </div>
              </>
            ) : (
              <div className="flex min-h-[50vh] items-center justify-center">
                <EmptyState
                  icon={
                    <Receipt className="h-16 w-16 text-muted-foreground" />
                  }
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
