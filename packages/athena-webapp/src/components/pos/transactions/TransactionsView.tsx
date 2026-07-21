import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  ArrowUpRight,
  Banknote,
  CreditCardIcon,
  Smartphone,
  WalletCards,
} from "lucide-react";

import View from "../../View";
import { FadeIn } from "../../common/FadeIn";
import { EmptyState } from "../../states/empty/empty-state";
import { GenericDataTable } from "../../base/table/data-table";
import {
  PageLevelHeader,
  PageWorkspace,
} from "../../common/PageLevelHeader";
import { Button } from "../../ui/button";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { currencyFormatter, capitalizeWords } from "~/convex/utils";
import {
  transactionColumns,
  CompletedTransactionRow,
} from "./transactionColumns";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";
import { getOrigin } from "~/src/lib/navigationUtils";
import { formatRegisterSessionCode } from "~/src/lib/pos/presentation/registerSessionCode";
import { getRelativeTime } from "~/src/lib/utils";
import type { Id } from "~/convex/_generated/dataModel";
import { useSharedDemoContext } from "@/hooks/useSharedDemoContext";
import { createSharedDemoTransactionFixtures } from "@/components/shared-demo/sharedDemoTransactionsFixture";

function formatPaymentMethod(method: string | null) {
  if (!method) return "Unknown";
  return capitalizeWords(method.replace(/_/g, " "));
}

function formatRegisterFilterLabel(
  registerNumber?: string | null,
  terminalName?: string | null,
  registerSessionId?: string,
) {
  const trimmedRegisterNumber = registerNumber?.trim();
  const trimmedTerminalName = terminalName?.trim();
  const sessionCode = formatRegisterSessionCode(registerSessionId);

  if (!trimmedRegisterNumber) {
    if (trimmedTerminalName) {
      return sessionCode
        ? `${trimmedTerminalName} / ${sessionCode}`
        : trimmedTerminalName;
    }
    return sessionCode ? `Session ${sessionCode}` : "this register session";
  }

  const registerLabel = /^register\b/i.test(trimmedRegisterNumber)
    ? trimmedRegisterNumber
    : `Register ${trimmedRegisterNumber}`;

  const registerSessionLabel = sessionCode
    ? `${registerLabel} / ${sessionCode}`
    : registerLabel;

  return trimmedTerminalName
    ? `${trimmedTerminalName} / ${registerSessionLabel}`
    : registerSessionLabel;
}

const completedTransactionBatchSize = 100;
const completedTransactionPageSize = 10;
type TransactionTimeFilter = "today" | "fromDate" | "all";
type TransactionPaymentFilter = "all" | "cash" | "card" | "mobile_money";
const transactionPaymentFilters = [
  { value: "all", label: "All payments", Icon: WalletCards },
  { value: "cash", label: "Cash payments", Icon: Banknote },
  { value: "card", label: "Card payments", Icon: CreditCardIcon },
  {
    value: "mobile_money",
    label: "Mobile money payments",
    Icon: Smartphone,
  },
] satisfies ReadonlyArray<{
  value: TransactionPaymentFilter;
  label: string;
  Icon: typeof Banknote;
}>;

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

function formatOperatingDateFilterLabel(operatingDate: string) {
  return new Date(`${operatingDate}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getPageIndexFromSearch(page?: unknown) {
  const parsedPage = typeof page === "number" ? page : Number(page);

  return Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage - 1 : 0;
}

function getCompletedTransactionLimitForPage(pageIndex: number) {
  const requestedRows = (pageIndex + 1) * completedTransactionPageSize;

  return Math.max(
    completedTransactionBatchSize,
    Math.ceil(requestedRows / completedTransactionBatchSize) *
      completedTransactionBatchSize,
  );
}

function getNextTransactionPageSearch(
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

function getTransactionTimeFilter({
  operatingDateStartAt,
  registerSessionId,
  timeRange,
}: {
  operatingDateStartAt: number | null;
  registerSessionId?: string;
  timeRange?: unknown;
}): TransactionTimeFilter {
  if (timeRange === "today" || timeRange === "all") {
    return timeRange;
  }

  if (timeRange === "fromDate" && operatingDateStartAt !== null) {
    return "fromDate";
  }

  if (operatingDateStartAt !== null) {
    return "fromDate";
  }

  if (registerSessionId) {
    return "all";
  }

  return "today";
}

function getNextTransactionTimeFilterSearch(
  current: Record<string, unknown>,
  timeRange: TransactionTimeFilter,
) {
  return {
    ...getNextTransactionPageSearch(current, 0),
    timeRange,
  };
}

function getNextTransactionPaymentFilterSearch(
  current: Record<string, unknown>,
  paymentMethod: TransactionPaymentFilter,
) {
  const next = getNextTransactionPageSearch(current, 0);

  if (paymentMethod === "all") {
    delete next.paymentMethod;
  } else {
    next.paymentMethod = paymentMethod;
  }

  return next;
}

type CompletedTransaction = {
  _id: Id<"posTransaction">;
  transactionNumber: string;
  total: number;
  paymentMethod: string | null;
  paymentMethods?: string[];
  hasMultiplePaymentMethods: boolean;
  cashierName: string | null;
  customerName: string | null;
  itemCount: number;
  serviceLineCount?: number;
  completedAt: number;
  hasTrace: boolean;
  sessionTraceId: string | null;
  status?: string;
  voidedAt?: number | null;
  voidReason?: string | null;
};

function getPaymentMethodIcon({
  paymentMethod,
  hasMultipleMethods,
  className = "h-4 w-4",
}: {
  paymentMethod: string;
  hasMultipleMethods?: boolean;
  className?: string;
}) {
  if (hasMultipleMethods) return <WalletCards className={className} />;

  switch (paymentMethod) {
    case "cash":
      return <Banknote className={className} />;
    case "card":
      return <CreditCardIcon className={className} />;
    case "mobile_money":
      return <Smartphone className={className} />;
    default:
      return null;
  }
}

function getEmptyTransactionTitle({
  filter,
  operatingDate,
  paymentMethod,
  registerFilterLabel,
  registerSessionId,
}: {
  filter: TransactionTimeFilter;
  operatingDate?: string;
  paymentMethod?: string;
  registerFilterLabel: string;
  registerSessionId?: string;
}) {
  const paymentLabel = paymentMethod
    ? formatPaymentMethod(paymentMethod).toLocaleLowerCase()
    : null;

  if (filter === "today") {
    return paymentLabel
      ? `No ${paymentLabel} transactions today`
      : "No completed transactions today";
  }

  if (filter === "fromDate" && operatingDate) {
    const dateLabel = formatOperatingDateFilterLabel(operatingDate);
    return paymentLabel
      ? `No ${paymentLabel} transactions from ${dateLabel}`
      : `No completed transactions from ${dateLabel}`;
  }

  if (registerSessionId) {
    return paymentLabel
      ? `No ${paymentLabel} transactions for ${registerFilterLabel}`
      : `No transactions for ${registerFilterLabel}`;
  }

  return paymentLabel
    ? `No ${paymentLabel} transactions`
    : "No completed transactions";
}

function TransactionMobileCard({
  transaction,
}: {
  transaction: CompletedTransactionRow;
}) {
  const isVoided = transaction.status === "void";
  const itemLabel = `${transaction.itemCount} ${
    transaction.itemCount === 1 ? "item" : "items"
  }`;

  return (
    <Link
      to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
      params={(prev) => ({
        ...prev,
        orgUrlSlug: prev.orgUrlSlug!,
        storeUrlSlug: prev.storeUrlSlug!,
        transactionId: transaction._id,
      })}
      search={{ o: getOrigin() }}
      aria-label={`Open transaction #${transaction.transactionNumber}`}
      className="block rounded-lg border border-border/70 bg-surface-raised p-layout-md shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-layout-md">
        <div className="min-w-0 space-y-1">
          <p className="flex min-w-0 items-center gap-1 text-lg font-semibold leading-6 text-foreground">
            <span className="truncate">#{transaction.transactionNumber}</span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {transaction.customerName
              ? `${itemLabel} - ${transaction.customerName}`
              : itemLabel}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={`text-lg font-semibold leading-6 text-foreground ${
              isVoided ? "line-through" : ""
            }`}
          >
            {transaction.formattedTotal}
          </p>
          {isVoided ? (
            <span className="mt-1 inline-flex rounded-sm border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-xs font-medium leading-4 text-destructive">
              Voided
            </span>
          ) : null}
        </div>
      </div>

      <dl className="mt-layout-md grid gap-layout-sm border-t border-border/70 pt-layout-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-layout-sm">
          <dt className="text-xs font-medium uppercase leading-5 tracking-[0.12em] text-muted-foreground">
            Payment
          </dt>
          <dd className="flex min-w-0 items-center justify-end gap-2 text-right text-sm leading-5 text-foreground">
            <span className="text-muted-foreground">
              {getPaymentMethodIcon({
                paymentMethod: transaction.paymentMethod,
                hasMultipleMethods: transaction.hasMultiplePaymentMethods,
              })}
            </span>
            <span className="truncate text-sm leading-5">
              {transaction.paymentMethodLabel}
            </span>
          </dd>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-layout-sm">
          <dt className="text-xs font-medium uppercase leading-5 tracking-[0.12em] text-muted-foreground">
            Cashier
          </dt>
          <dd className="min-w-0 truncate text-right text-sm leading-5 text-foreground">
            {transaction.cashierName ?? "N/A"}
          </dd>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-layout-sm">
          <dt className="text-xs font-medium uppercase leading-5 tracking-[0.12em] text-muted-foreground">
            Completed
          </dt>
          <dd className="min-w-0 truncate text-right text-sm leading-5 text-foreground">
            {getRelativeTime(transaction.completedAt)}
          </dd>
        </div>
      </dl>
    </Link>
  );
}

export function TransactionsView() {
  const { activeStore } = useGetActiveStore();
  const sharedDemoContext = useSharedDemoContext();
  const isSharedDemo = Boolean(sharedDemoContext);
  const navigate = useNavigate();
  const { operatingDate, page, paymentMethod, registerSessionId, timeRange } =
    useSearch({
      strict: false,
    }) as {
    operatingDate?: string;
    page?: unknown;
    paymentMethod?: string;
    registerSessionId?: string;
    timeRange?: unknown;
  };
  const operatingDateStartAt = getStartOfOperatingDate(operatingDate);
  const [filter, setFilter] = useState<TransactionTimeFilter>(() =>
    getTransactionTimeFilter({
      operatingDateStartAt,
      registerSessionId,
      timeRange,
    }),
  );
  const tablePageIndex = getPageIndexFromSearch(page);
  const minimumLoadedLimit = getCompletedTransactionLimitForPage(tablePageIndex);
  const [loadedLimit, setLoadedLimit] = useState(minimumLoadedLimit);
  const paymentMethodFilter = paymentMethod?.trim();
  const selectedPaymentMethodFilter: TransactionPaymentFilter =
    paymentMethodFilter === "cash" ||
    paymentMethodFilter === "card" ||
    paymentMethodFilter === "mobile_money"
      ? paymentMethodFilter
      : "all";
  const isOperatingDateFilterActive =
    filter === "fromDate" && operatingDateStartAt !== null;
  const todayStartAt = useMemo(() => {
    const today = new Date();
    return new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    ).getTime();
  }, []);
  const completedFrom =
    isSharedDemo
      ? todayStartAt
      : isOperatingDateFilterActive
        ? operatingDateStartAt
        : filter === "today"
          ? todayStartAt
          : undefined;

  const transactions = useQuery(
    api.inventory.pos.getCompletedTransactions,
    activeStore?._id && sharedDemoContext !== undefined
      ? {
          limit: loadedLimit,
          storeId: activeStore._id,
          ...(registerSessionId
            ? {
                registerSessionId: registerSessionId as Id<"registerSession">,
              }
            : {}),
          ...(completedFrom !== undefined ? { completedFrom } : {}),
        }
      : "skip",
  );
  const registerSessionSnapshot = useQuery(
    api.cashControls.deposits.getRegisterSessionSnapshot,
    activeStore?._id && registerSessionId
      ? {
          registerSessionId: registerSessionId as Id<"registerSession">,
          storeId: activeStore._id,
        }
      : "skip",
  );

  const formatter = useMemo(
    () => (activeStore ? currencyFormatter(activeStore.currency) : null),
    [activeStore],
  );
  const registerFilterLabel = formatRegisterFilterLabel(
    registerSessionSnapshot?.registerSession?.registerNumber,
    registerSessionSnapshot?.registerSession?.terminalName,
    registerSessionId,
  );
  const isTransactionBatchFull = (transactions?.length ?? 0) >= loadedLimit;
  const activeFilterSummary = registerSessionId
    ? [
        paymentMethodFilter
          ? `${formatPaymentMethod(paymentMethodFilter)} transactions`
          : "transactions",
        registerSessionId ? `linked to ${registerFilterLabel}` : null,
        isOperatingDateFilterActive && operatingDate
          ? `from ${formatOperatingDateFilterLabel(operatingDate)}`
          : null,
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  const tableData: CompletedTransactionRow[] = useMemo(() => {
    if (!transactions || !formatter) return [];

    const fixtureTransactions =
      isSharedDemo && !registerSessionId
        ? createSharedDemoTransactionFixtures()
        : [];

    return [...transactions, ...fixtureTransactions]
      .sort((first, second) => second.completedAt - first.completedAt)
      .map((transaction: CompletedTransaction) => ({
        _id: transaction._id,
        transactionNumber: transaction.transactionNumber,
        formattedTotal: formatStoredAmount(formatter, transaction.total),
        paymentMethodLabel: transaction.hasMultiplePaymentMethods
          ? "Multiple payment methods"
          : formatPaymentMethod(transaction.paymentMethod),
        paymentMethod: transaction.paymentMethod || "cash",
        paymentMethods:
          (transaction.paymentMethods?.length ?? 0) > 0
            ? transaction.paymentMethods
            : [transaction.paymentMethod || "cash"],
        hasMultiplePaymentMethods: Boolean(
          transaction.hasMultiplePaymentMethods,
        ),
        cashierName: transaction.cashierName,
        customerName: transaction.customerName,
        itemCount: transaction.itemCount + (transaction.serviceLineCount ?? 0),
        completedAt: transaction.completedAt,
        hasTrace: transaction.hasTrace,
        sessionTraceId: null,
        status: transaction.status === "void" ? "void" : "completed",
        voidedAt: transaction.voidedAt,
        voidReason: transaction.voidReason,
      }));
  }, [formatter, isSharedDemo, registerSessionId, transactions]);

  const filteredData = useMemo(() => {
    const dateFilteredData =
      filter === "all"
        ? tableData
        : filter === "fromDate" && operatingDateStartAt !== null
          ? tableData.filter((t) => t.completedAt >= operatingDateStartAt)
          : tableData.filter((t) => isToday(t.completedAt));

    if (!paymentMethodFilter) return dateFilteredData;

    return dateFilteredData.filter((transaction) =>
      (transaction.paymentMethods ?? [transaction.paymentMethod]).includes(
        paymentMethodFilter,
      ),
    );
  }, [tableData, filter, operatingDateStartAt, paymentMethodFilter]);

  useEffect(() => {
    setFilter(
      getTransactionTimeFilter({
        operatingDateStartAt,
        registerSessionId,
        timeRange,
      }),
    );
  }, [operatingDateStartAt, registerSessionId, timeRange]);

  useEffect(() => {
    setLoadedLimit(minimumLoadedLimit);
  }, [
    filter,
    minimumLoadedLimit,
    operatingDateStartAt,
    paymentMethodFilter,
    registerSessionId,
  ]);

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
          getNextTransactionPageSearch(current, pageIndex)) as never,
      });
    },
    [navigate],
  );

  const handleFilterChange = useCallback(
    (value: string) => {
      const nextFilter = value as TransactionTimeFilter;

      setFilter(nextFilter);
      void navigate({
        replace: true,
        search: ((current: Record<string, unknown>) =>
          getNextTransactionTimeFilterSearch(current, nextFilter)) as never,
      });
    },
    [navigate],
  );

  const handlePaymentMethodFilterChange = useCallback(
    (value: string) => {
      if (!value) return;

      void navigate({
        replace: true,
        search: ((current: Record<string, unknown>) =>
          getNextTransactionPaymentFilterSearch(
            current,
            value as TransactionPaymentFilter,
          )) as never,
      });
    },
    [navigate],
  );

  useEffect(() => {
    if (!transactions || isTransactionBatchFull || tablePageIndex === 0) {
      return;
    }

    const maxPageIndex = Math.max(
      0,
      Math.ceil(filteredData.length / completedTransactionPageSize) - 1,
    );

    if (tablePageIndex <= maxPageIndex) {
      return;
    }

    handleTablePageIndexChange(maxPageIndex);
  }, [
    filteredData.length,
    handleTablePageIndexChange,
    isTransactionBatchFull,
    tablePageIndex,
    transactions,
  ]);

  if (!activeStore || !formatter) return null;

  const isLoadingTransactions = transactions === undefined;
  const hasTransactions = filteredData.length > 0;

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Point of sale"
            showBackButton
            title="Completed Transactions"
            description="Review completed POS transactions by operating day, register session, or payment method."
          />

          <section className="space-y-layout-md">
            {activeFilterSummary ? (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                Showing {activeFilterSummary}
              </div>
            ) : null}
            {!isLoadingTransactions && isTransactionBatchFull ? (
              <div className="flex flex-col gap-layout-sm rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Showing latest {loadedLimit.toLocaleString()} completed
                  transactions.
                </span>
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setLoadedLimit(
                      (currentLimit) =>
                        currentLimit + completedTransactionBatchSize,
                    )
                  }
                >
                  Load more history
                </Button>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-layout-sm">
              <Tabs value={filter} onValueChange={handleFilterChange}>
                <TabsList>
                  <TabsTrigger value="today">Today</TabsTrigger>
                  {operatingDate && operatingDateStartAt !== null ? (
                    <TabsTrigger value="fromDate">
                      From {formatOperatingDateFilterLabel(operatingDate)}
                    </TabsTrigger>
                  ) : null}
                  <TabsTrigger value="all">All Time</TabsTrigger>
                </TabsList>
              </Tabs>

              <ToggleGroup
                aria-label="Filter by payment method"
                className="inline-flex gap-0 rounded-md bg-muted p-1 text-muted-foreground"
                type="single"
                value={selectedPaymentMethodFilter}
                onValueChange={handlePaymentMethodFilterChange}
              >
                {transactionPaymentFilters.map(({ Icon, label, value }) => (
                  <ToggleGroupItem
                    aria-label={label}
                    className="h-8 w-8 rounded-sm px-0 data-[state=on]:!bg-background data-[state=on]:!text-foreground data-[state=on]:shadow-sm data-[state=on]:ring-1 data-[state=on]:ring-border"
                    key={value}
                    value={value}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" />
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            {isLoadingTransactions ? null : hasTransactions ? (
              <GenericDataTable
                data={filteredData}
                columns={transactionColumns}
                pageIndex={tablePageIndex}
                onPageIndexChange={handleTablePageIndexChange}
                renderMobileCard={(transaction) => (
                  <TransactionMobileCard transaction={transaction} />
                )}
                tableId="pos-completed-transactions"
              />
            ) : (
              <div className="flex min-h-[50vh] items-center justify-center">
                <EmptyState
                  icon={
                    getPaymentMethodIcon({
                      paymentMethod: selectedPaymentMethodFilter,
                      className: "h-16 w-16 text-muted-foreground",
                    }) ?? (
                      <WalletCards className="h-16 w-16 text-muted-foreground" />
                    )
                  }
                  title={
                    <p className="text-muted-foreground">
                      {getEmptyTransactionTitle({
                        filter,
                        operatingDate,
                        paymentMethod: paymentMethodFilter,
                        registerFilterLabel,
                        registerSessionId,
                      })}
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

export default TransactionsView;
