import type {
  DailyCloseItem,
  DailyCloseSnapshot,
  DailyCloseViewContentProps,
} from "@/components/operations/DailyCloseView";
import {
  getLocalDateFromOperatingDate,
  getLocalOperatingDate,
  getLocalOperatingDateRange,
} from "@/lib/operations/operatingDate";
import {
  SHARED_DEMO_STAFF_STORY,
  SHARED_DEMO_STORE_IDENTITY,
  sharedDemoStaffShortName,
} from "~/shared/sharedDemoStory";
import type { Id } from "~/convex/_generated/dataModel";

import {
  getSharedDemoHistoricalDayFixture,
  type SharedDemoHistoricalDayFixture,
} from "./sharedDemoOperationsFixture";
import { createSharedDemoTransactionFixtures } from "./sharedDemoTransactionsFixture";

const DEMO_CASHIER_DISPLAY_NAME = sharedDemoStaffShortName(
  SHARED_DEMO_STAFF_STORY.cashier,
);

function shiftOperatingDate(operatingDate: string, days: number) {
  const date = getLocalDateFromOperatingDate(operatingDate);
  if (!date) throw new Error(`Invalid operating date: ${operatingDate}`);
  date.setDate(date.getDate() + days);
  return getLocalOperatingDate(date);
}

function getOperatingDateTimestamp(
  operatingDate: string,
  hours: number,
  minutes: number,
) {
  const date = getLocalDateFromOperatingDate(operatingDate);
  if (!date) throw new Error(`Invalid operating date: ${operatingDate}`);
  return date.setHours(hours, minutes, 0, 0);
}

function formatPaymentMethod(method: string) {
  if (method === "mobile_money") return "Mobile Money";
  return method.charAt(0).toUpperCase() + method.slice(1);
}

function buildDemoTransactionNumber(
  operatingDate: string,
  transactionIndex: number,
) {
  const date = getLocalDateFromOperatingDate(operatingDate);
  if (!date) throw new Error(`Invalid operating date: ${operatingDate}`);
  const dayIndex = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000,
  );
  const transactionNumber = (dayIndex * 100 + transactionIndex) % 1_000_000;
  return transactionNumber.toString().padStart(6, "0");
}

function buildCompletedSaleItems(
  operatingDate: string,
): DailyCloseItem[] {
  const fixtureIdPrefix = `shared-demo-pos-${operatingDate.replaceAll("-", "")}-`;

  return createSharedDemoTransactionFixtures()
    .filter(
      (transaction) =>
        transaction.status === "completed" &&
        transaction._id.startsWith(fixtureIdPrefix),
    )
    .map((transaction) => ({
      category: "sale",
      id: `pos_transaction:${transaction._id}:completed`,
      key: `pos_transaction:${transaction._id}:completed`,
      link: {
        label: "View transaction",
        params: { transactionId: transaction._id },
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
      },
      message: "Completed sale is included in the end of day review.",
      metadata: {
        completedAt: transaction.completedAt,
        itemCount: transaction.itemCount,
        owner: transaction.cashierName,
        paymentMethods: formatPaymentMethod(transaction.paymentMethod),
        total: transaction.total,
        totalPaid: transaction.totalPaid,
        transaction: transaction.transactionNumber,
        transactionId: transaction._id,
      },
      severity: "ready" as const,
      subject: {
        id: transaction._id,
        label: transaction.transactionNumber,
        type: "pos_transaction",
      },
      title: "Completed sale",
    }));
}

function buildReadyItems(
  operatingDate: string,
  day: SharedDemoHistoricalDayFixture,
): DailyCloseItem[] {
  if (day.transactionCount === 0) return [];

  const items: DailyCloseItem[] = [
    {
      category: "register_session",
      id: `register_session:demo-${operatingDate}:closed`,
      key: `register_session:demo-${operatingDate}:closed`,
      message: "Closed register session is included in the end of day review.",
      metadata: {
        closedAt: getOperatingDateTimestamp(operatingDate, 20, 0),
        countedCash: day.currentDayCashTotal,
        expectedCash: day.currentDayCashTotal,
        openedAt: getOperatingDateTimestamp(operatingDate, 8, 30),
        operatingScope: "Opened today",
        status: "closed",
        terminal: "Front counter terminal",
        variance: 0,
      },
      severity: "ready",
      statusLabel: "Closed",
      subject: {
        id: `demo-${operatingDate}`,
        label: "Front counter register",
        type: "register_session",
      },
      title: "Register session closed",
    },
    ...buildCompletedSaleItems(operatingDate),
  ];

  if (day.expenseTransactionCount > 0) {
    const transactionNumber = buildDemoTransactionNumber(
      operatingDate,
      day.transactionCount + 1,
    );
    items.push({
      category: "expense",
      id: `expense_transaction:demo-${operatingDate}:completed`,
      key: `expense_transaction:demo-${operatingDate}:completed`,
      link: { disabled: true, label: "View expense" },
      message: "Completed expense is included in the end of day review.",
      metadata: {
        completedAt: getOperatingDateTimestamp(operatingDate, 15, 20),
        notes: "Store supplies.",
        owner: DEMO_CASHIER_DISPLAY_NAME,
        report: transactionNumber,
        total: day.expenseTotal,
      },
      severity: "ready",
      subject: {
        id: `demo-expense-${operatingDate}`,
        label: transactionNumber,
        type: "expense_transaction",
      },
      title: "Completed expense",
    });
  }

  return items;
}

function buildSummary(day: SharedDemoHistoricalDayFixture) {
  return {
    carriedOverCashTotal: 0,
    carriedOverRegisterCount: 0,
    cashDeposited: day.currentDayCashTotal,
    cashDepositTotal: day.currentDayCashTotal,
    cashExpected: day.currentDayCashTotal,
    closedRegisterSessionCount: day.transactionCount > 0 ? 1 : 0,
    carryForwardCount: 0,
    currentDayCashTotal: day.currentDayCashTotal,
    currentDayCashTransactionCount: day.currentDayCashTransactionCount,
    expectedCashTotal: day.currentDayCashTotal,
    expenseStaffCount: day.expenseTransactionCount,
    expenseTotal: day.expenseTotal,
    expenseTransactionCount: day.expenseTransactionCount,
    netCashVariance: 0,
    openWorkItemCount: 0,
    paymentTotals: day.paymentTotals,
    pendingApprovalCount: 0,
    registerCount: day.transactionCount > 0 ? 1 : 0,
    registerVarianceCount: 0,
    salesTotal: day.salesTotal,
    staffCount: day.transactionCount > 0 ? 1 : 0,
    totalSales: day.salesTotal,
    transactionCount: day.transactionCount,
    varianceTotal: 0,
    voidedTransactionCount: 0,
  };
}

export function createSharedDemoDailyCloseFixture({
  operatingDate,
  orgUrlSlug,
  storeId,
  storeUrlSlug,
}: {
  operatingDate: string;
  orgUrlSlug: string;
  storeId: Id<"store">;
  storeUrlSlug: string;
}): DailyCloseViewContentProps | undefined {
  const day = getSharedDemoHistoricalDayFixture(operatingDate);
  if (!day) return undefined;

  const priorDay = getSharedDemoHistoricalDayFixture(
    shiftOperatingDate(operatingDate, -1),
  );
  const range = getLocalOperatingDateRange(
    getLocalDateFromOperatingDate(operatingDate)!,
  );
  const readyItems = buildReadyItems(operatingDate, day);
  const snapshot: DailyCloseSnapshot = {
    automationStatus: null,
    blockers: [],
    carryForwardItems: [],
    completedClose: {
      actorType: "automation",
      automationDecisionReason:
        "EOD Review has only low-risk review evidence within policy thresholds.",
      automationPolicyVersion: "daily-close-auto-complete.v1",
      completedAt: getOperatingDateTimestamp(operatingDate, 20, 15),
      dailyCloseId: `demo-close-${operatingDate}`,
      policyReviewedItemKeys: day.hasInventoryReview
        ? [`synced_sale_inventory_review:demo-${operatingDate}`]
        : undefined,
    },
    endAt: range.endAt,
    existingClose: {
      _id: `demo-close-${operatingDate}`,
      isCurrent: true,
      lifecycleStatus: "active",
    },
    operatingDate,
    openWorkMembership: {
      completeness: "complete",
      observedLogicalCount: 0,
    },
    priorDaySummary: priorDay ? buildSummary(priorDay) : null,
    readiness: {
      blockerCount: 0,
      carryForwardCount: 0,
      readyCount: readyItems.length,
      reviewCount: 0,
      status: "ready",
    },
    readyItems,
    reviewItems: [],
    startAt: range.startAt,
    status: "completed",
    summary: buildSummary(day),
  };

  return {
    canViewSummaryComparisons: true,
    currency: SHARED_DEMO_STORE_IDENTITY.currency,
    hasFinancialDetailsAccess: true,
    hasFullAdminAccess: true,
    isAuthenticated: true,
    isCompleting: false,
    isLoadingAccess: false,
    isLoadingSnapshot: false,
    latestSelectableOperatingDate: getLocalDateFromOperatingDate(
      getLocalOperatingDate(),
    )!,
    onComplete: async () => ({
      error: {
        code: "validation_failed",
        message: "This historical EOD Review is read-only.",
      },
      kind: "user_error",
    }),
    orgUrlSlug,
    snapshot,
    storeId,
    storeUrlSlug,
  };
}
