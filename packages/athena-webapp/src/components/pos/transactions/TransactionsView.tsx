import { useEffect, useMemo, useState } from "react";
import { useSearch } from "@tanstack/react-router";
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
import { currencyFormatter, capitalizeWords } from "~/convex/utils";
import {
  transactionColumns,
  CompletedTransactionRow,
} from "./transactionColumns";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";
import type { Id } from "~/convex/_generated/dataModel";

function formatPaymentMethod(method: string | null) {
  if (!method) return "Unknown";
  return capitalizeWords(method.replace(/_/g, " "));
}

function formatRegisterFilterLabel(registerNumber?: string | null) {
  const trimmedRegisterNumber = registerNumber?.trim();

  if (!trimmedRegisterNumber) {
    return "this register";
  }

  return /^register\b/i.test(trimmedRegisterNumber)
    ? trimmedRegisterNumber
    : `Register ${trimmedRegisterNumber}`;
}

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
  completedAt: number;
  hasTrace: boolean;
  sessionTraceId: string | null;
};

export function TransactionsView() {
  const { activeStore } = useGetActiveStore();
  const { operatingDate, paymentMethod, registerSessionId } = useSearch({
    strict: false,
  }) as {
    operatingDate?: string;
    paymentMethod?: string;
    registerSessionId?: string;
  };
  const operatingDateStartAt = getStartOfOperatingDate(operatingDate);
  const [filter, setFilter] = useState<"today" | "fromDate" | "all">(
    operatingDateStartAt ? "fromDate" : registerSessionId ? "all" : "today",
  );
  const paymentMethodFilter = paymentMethod?.trim();
  const isOperatingDateFilterActive =
    filter === "fromDate" && operatingDateStartAt !== null;

  const transactions = useQuery(
    api.inventory.pos.getCompletedTransactions,
    activeStore?._id
      ? {
          storeId: activeStore._id,
          ...(registerSessionId
            ? {
                registerSessionId: registerSessionId as Id<"registerSession">,
              }
            : {}),
          ...(isOperatingDateFilterActive
            ? { completedFrom: operatingDateStartAt }
            : {}),
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
  );
  const hasActiveFilter = Boolean(
    registerSessionId || paymentMethodFilter || operatingDate,
  );
  const activeFilterSummary = hasActiveFilter
    ? [
        paymentMethodFilter
          ? `${formatPaymentMethod(paymentMethodFilter)} transactions`
          : "transactions",
        registerSessionId ? `linked to ${registerFilterLabel}` : null,
        operatingDate && operatingDateStartAt !== null
          ? `from ${formatOperatingDateFilterLabel(operatingDate)}`
          : null,
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  const tableData: CompletedTransactionRow[] = useMemo(() => {
    if (!transactions || !formatter) return [];

    return transactions.map((transaction: CompletedTransaction) => ({
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
    if (operatingDateStartAt) {
      setFilter("fromDate");
    } else if (registerSessionId) {
      setFilter("all");
    }
  }, [operatingDateStartAt, registerSessionId]);

  if (!activeStore || !transactions || !formatter) return null;

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

          <Tabs
            value={filter}
            onValueChange={(v) => setFilter(v as "today" | "fromDate" | "all")}
          >
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
                      : filter === "fromDate" && operatingDate
                        ? `No completed transactions from ${formatOperatingDateFilterLabel(operatingDate)}`
                      : registerSessionId
                        ? `No transactions for ${registerFilterLabel}`
                        : "No completed transactions"}
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
