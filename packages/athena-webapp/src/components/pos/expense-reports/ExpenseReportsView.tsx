import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowUpRight, Receipt } from "lucide-react";

import View from "../../View";
import { FadeIn } from "../../common/FadeIn";
import { EmptyState } from "../../states/empty/empty-state";
import { GenericDataTable } from "../../base/table/data-table";
import { PageLevelHeader, PageWorkspace } from "../../common/PageLevelHeader";
import { Button } from "../../ui/button";
import { useExpenseLocalRuntime } from "@/hooks/useExpenseLocalRuntime";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useGetTerminal } from "@/hooks/useGetTerminal";
import { api } from "~/convex/_generated/api";
import { currencyFormatter } from "~/shared/currencyFormatter";
import { expenseReportColumns, ExpenseReportRow } from "./expenseReportColumns";
import { toExpenseReportRows } from "./expenseReportRows";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getOrigin } from "~/src/lib/navigationUtils";
import { RelativeTimestamp } from "../../ui/relative-timestamp";
import { MAX_EXPENSE_TRANSACTION_RESULTS } from "~/shared/operationalEvidenceLimits";

// Helper to check if timestamp is today
const isToday = (timestamp: number) => {
  const date = new Date(timestamp);
  const today = new Date();
  return date.toDateString() === today.toDateString();
};

function getStartOfOperatingDate(operatingDate?: string) {
  const match = operatingDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
}

function isOnOperatingDate(timestamp: number, operatingDateStartAt: number) {
  const nextOperatingDateStartAt = operatingDateStartAt + 24 * 60 * 60 * 1_000;

  return (
    timestamp >= operatingDateStartAt && timestamp < nextOperatingDateStartAt
  );
}

type ExpenseReportTimeFilter = "today" | "operatingDate" | "all";
const expenseReportBatchSize = 50;
const expenseReportPageSize = 10;
const maxExpenseReportPageIndex =
  MAX_EXPENSE_TRANSACTION_RESULTS / expenseReportPageSize - 1;

function getPageIndexFromSearch(page?: unknown) {
  const parsedPage = typeof page === "number" ? page : Number(page);

  return Number.isInteger(parsedPage) && parsedPage > 0
    ? Math.min(parsedPage - 1, maxExpenseReportPageIndex)
    : 0;
}

function getExpenseReportLimitForPage(pageIndex: number) {
  const requestedRows = (pageIndex + 1) * expenseReportPageSize;

  return Math.min(
    MAX_EXPENSE_TRANSACTION_RESULTS,
    Math.max(
      expenseReportBatchSize,
      Math.ceil(requestedRows / expenseReportBatchSize) *
        expenseReportBatchSize,
    ),
  );
}

function getExpenseReportTimeFilter({
  operatingDateStartAt,
  timeRange,
}: {
  operatingDateStartAt: number | null;
  timeRange?: unknown;
}): ExpenseReportTimeFilter {
  if (timeRange === "today" || timeRange === "all") {
    return timeRange;
  }

  if (timeRange === "operatingDate" && operatingDateStartAt !== null) {
    return "operatingDate";
  }

  if (operatingDateStartAt !== null) {
    return "operatingDate";
  }

  return "today";
}

function getNextExpenseReportPageSearch(
  current: Record<string, unknown>,
  pageIndex: number,
) {
  const next = { ...current };
  const page = pageIndex + 1;

  if (page <= 1) {
    delete next.page;
  } else {
    next.page = page;
  }

  return next;
}

function getNextExpenseReportFilterSearch(
  current: Record<string, unknown>,
  timeRange: ExpenseReportTimeFilter,
) {
  return {
    ...getNextExpenseReportPageSearch(current, 0),
    timeRange,
  };
}

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
          <p className="text-xs leading-5 text-muted-foreground">{itemLabel}</p>
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
            <RelativeTimestamp value={report.completedAt} />
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
  const terminal = useGetTerminal();
  const navigate = useNavigate();
  useExpenseLocalRuntime({
    staffProfileId: null,
    storeId: activeStore?._id,
    terminalId: terminal?._id,
  });
  const { operatingDate, page, timeRange } = useSearch({ strict: false }) as {
    operatingDate?: string;
    page?: unknown;
    timeRange?: unknown;
  };
  const operatingDateStartAt = getStartOfOperatingDate(operatingDate);
  const [filter, setFilter] = useState<ExpenseReportTimeFilter>(() =>
    getExpenseReportTimeFilter({ operatingDateStartAt, timeRange }),
  );
  const tablePageIndex = getPageIndexFromSearch(page);
  const minimumLoadedLimit = getExpenseReportLimitForPage(tablePageIndex);
  const [loadedLimit, setLoadedLimit] = useState(minimumLoadedLimit);

  const expenseTransactions = useQuery(
    api.inventory.expenseTransactions.getExpenseTransactions,
    activeStore?._id
      ? { limit: loadedLimit, storeId: activeStore._id }
      : "skip",
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
    if (filter === "operatingDate" && operatingDateStartAt !== null) {
      return tableData.filter((t) =>
        isOnOperatingDate(t.completedAt, operatingDateStartAt),
      );
    }

    return tableData.filter((t) => isToday(t.completedAt));
  }, [tableData, filter, operatingDateStartAt]);
  const isLoadingExpenseReports = expenseTransactions === undefined;
  const isExpenseReportBatchFull =
    (expenseTransactions?.length ?? 0) >= loadedLimit;

  useEffect(() => {
    setFilter(getExpenseReportTimeFilter({ operatingDateStartAt, timeRange }));
  }, [operatingDateStartAt, timeRange]);

  useEffect(() => {
    setLoadedLimit(minimumLoadedLimit);
  }, [filter, minimumLoadedLimit, operatingDateStartAt]);

  useEffect(() => {
    setLoadedLimit((currentLimit) =>
      Math.max(currentLimit, minimumLoadedLimit),
    );
  }, [minimumLoadedLimit]);
  const handleTablePageIndexChange = useCallback(
    (pageIndex: number) => {
      void navigate({
        replace: true,
        search: ((current: Record<string, unknown>) =>
          getNextExpenseReportPageSearch(current, pageIndex)) as never,
      });
    },
    [navigate],
  );
  const handleFilterChange = useCallback(
    (value: string) => {
      const nextFilter = value as ExpenseReportTimeFilter;

      setFilter(nextFilter);
      void navigate({
        replace: true,
        search: ((current: Record<string, unknown>) =>
          getNextExpenseReportFilterSearch(current, nextFilter)) as never,
      });
    },
    [navigate],
  );

  useEffect(() => {
    if (
      isLoadingExpenseReports ||
      isExpenseReportBatchFull ||
      tablePageIndex === 0
    ) {
      return;
    }

    const maxPageIndex = Math.max(
      0,
      Math.ceil(filteredData.length / expenseReportPageSize) - 1,
    );

    if (tablePageIndex <= maxPageIndex) {
      return;
    }

    handleTablePageIndexChange(maxPageIndex);
  }, [
    filteredData.length,
    handleTablePageIndexChange,
    isExpenseReportBatchFull,
    isLoadingExpenseReports,
    tablePageIndex,
  ]);

  if (!activeStore || !formatter) return null;

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
            {!isLoadingExpenseReports &&
            isExpenseReportBatchFull &&
            loadedLimit < MAX_EXPENSE_TRANSACTION_RESULTS ? (
              <div className="flex flex-col gap-layout-sm rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Showing latest {loadedLimit.toLocaleString()} completed
                  expense reports.
                </span>
                <Button
                  data-remote-assist-control="pos-expense-report-history"
                  data-remote-assist-control-id="pos-expense-reports-load-more"
                  data-remote-assist-control-label="Load more expense report history"
                  data-remote-assist-control-role="button"
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setLoadedLimit((currentLimit) =>
                      Math.min(
                        MAX_EXPENSE_TRANSACTION_RESULTS,
                        currentLimit + expenseReportBatchSize,
                      ),
                    )
                  }
                >
                  Load more history
                </Button>
              </div>
            ) : null}

            <Tabs value={filter} onValueChange={handleFilterChange}>
              <TabsList>
                {operatingDateStartAt !== null ? (
                  <TabsTrigger
                    data-remote-assist-control="pos-expense-report-filter"
                    data-remote-assist-control-id="pos-expense-reports-filter-operating-date"
                    data-remote-assist-control-label="Selected day"
                    data-remote-assist-control-role="button"
                    value="operatingDate"
                  >
                    Selected day
                  </TabsTrigger>
                ) : null}
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

            {isLoadingExpenseReports ? null : hasReports ? (
              <GenericDataTable
                data={filteredData}
                columns={expenseReportColumns}
                pageIndex={tablePageIndex}
                onPageIndexChange={handleTablePageIndexChange}
                paginationItemLabel={
                  isExpenseReportBatchFull ? undefined : "expense report"
                }
                renderMobileCard={(report) => (
                  <ExpenseReportMobileCard report={report} />
                )}
                tableId="pos-expense-reports"
              />
            ) : (
              <div className="flex min-h-[50vh] items-center justify-center">
                <EmptyState
                  icon={<Receipt className="h-16 w-16 text-muted-foreground" />}
                  title={
                    <p className="text-muted-foreground">
                      {filter === "all"
                        ? "No expense reports"
                        : filter === "operatingDate"
                          ? "No expense reports for this day"
                          : "No expense reports today"}
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
