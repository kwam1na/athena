/**
 * Screenshot fixtures for the EOD Review workspace (daily close).
 *
 * Authored prop bags rendered directly by `DailyCloseView`'s `fixture` prop — no Convex
 * query runs. The evening bookend to the Opening Handoff and Daily Operations fixtures:
 * same Saturday, same store, the day's takings ready to reconcile and close.
 *
 * Item titles and messages are reproduced from the server helpers in
 * `convex/operations/dailyClose.ts`. The day's totals come from the shared context so
 * Daily Operations and EOD Review agree on what Saturday earned.
 *
 * Money is in minor units (pesewas).
 */

import type {
  DailyCloseItem,
  DailyCloseViewContentProps,
} from "@/components/operations/DailyCloseView";

import {
  DAY_END,
  DAY_START,
  LINK_PARAMS,
  OPERATING_DATE,
  ORG_URL_SLUG,
  REGISTER_DISPLAY_LABEL,
  SATURDAY_TOTALS,
  STORE_ID,
  STORE_URL_SLUG,
} from "./operationsFixtureContext";

/** Evening, after the register is counted and the day is ready to review. */
export const READY_TO_CLOSE_CLOCK = new Date(2026, 6, 18, 20, 30);

/** Cash expected in the drawer: opening float plus the day's cash takings. */
const EXPECTED_CASH = SATURDAY_TOTALS.openingFloat + SATURDAY_TOTALS.cashTotal;
/** A GH₵5 short — a small, realistic variance to surface without blocking close. */
const CASH_VARIANCE = -500;
const CASH_DEPOSITED = 120000;

/**
 * Ready items reproduce server copy from `dailyClose.ts`: closed register sessions and
 * completed sales are each surfaced as an included item. A couple of representative sales
 * stand in for the day's 34.
 */
const readyItems: DailyCloseItem[] = [
  {
    category: "register_session",
    id: "register_session:session-9931:closed",
    key: "register_session:session-9931:closed",
    message: "Closed register session is included in the end of day review.",
    severity: "ready",
    statusLabel: "Closed",
    subject: {
      id: "session-9931",
      label: REGISTER_DISPLAY_LABEL,
      type: "register_session",
    },
    title: "Register session closed",
  },
  {
    category: "completed_sale",
    id: "pos_transaction:txn-1184:completed",
    key: "pos_transaction:txn-1184:completed",
    link: {
      label: "View transaction",
      params: LINK_PARAMS,
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/txn-1184",
    },
    message: "Completed sale is included in the end of day review.",
    severity: "ready",
    subject: { id: "txn-1184", label: "#1184", type: "pos_transaction" },
    title: "Completed sale",
  },
  {
    category: "completed_sale",
    id: "pos_transaction:txn-1179:completed",
    key: "pos_transaction:txn-1179:completed",
    link: {
      label: "View transaction",
      params: LINK_PARAMS,
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/txn-1179",
    },
    message: "Completed sale is included in the end of day review.",
    severity: "ready",
    subject: { id: "txn-1179", label: "#1179", type: "pos_transaction" },
    title: "Completed sale",
  },
];

/**
 * The Kente scarf carried into tomorrow's opening — the same thread the Daily Operations
 * timeline flagged and the Opening Handoff fixture acknowledges.
 */
const carryForwardItems: DailyCloseItem[] = [
  {
    category: "inventory",
    description:
      "4 left after today's sales — restock before tomorrow's opening.",
    id: "carry_forward:kente",
    key: "carry_forward:kente",
    severity: "carry_forward",
    statusLabel: "Carried to Opening",
    subject: {
      id: "work-kente-restock",
      label: "Restock Kente Scarf",
      type: "operational_work_item",
    },
    title: "Restock Kente Scarf before tomorrow's opening",
  },
];

/**
 * A Saturday ready to close: register counted with a small approved variance, sales
 * reconciled, one item carried into tomorrow's opening. No blockers, so the Complete
 * action is available.
 */
export const readyToCloseFixture: DailyCloseViewContentProps = {
  canViewSummaryComparisons: true,
  currency: "GHS",
  hasFinancialDetailsAccess: true,
  hasFullAdminAccess: true,
  isAuthenticated: true,
  isCompleting: false,
  isLoadingAccess: false,
  isLoadingSnapshot: false,
  latestSelectableOperatingDate: READY_TO_CLOSE_CLOCK,
  onComplete: async () => ({ data: undefined, kind: "ok" }),
  // A no-op keeps the operating-date trigger enabled without a destination to navigate to.
  onOperatingDateChange: () => {},
  orgUrlSlug: ORG_URL_SLUG,
  storeId: STORE_ID,
  storeUrlSlug: STORE_URL_SLUG,
  snapshot: {
    blockers: [],
    carryForwardItems,
    endAt: DAY_END,
    operatingDate: OPERATING_DATE,
    readiness: {
      blockerCount: 0,
      carryForwardCount: 1,
      readyCount: readyItems.length,
      reviewCount: 0,
      status: "ready",
    },
    readyItems,
    reviewItems: [],
    startAt: DAY_START,
    // Friday 2026-07-17, matching the Daily Operations week fixture, so the tiles show a
    // day-over-day comparison instead of "No activity yesterday".
    priorDaySummary: {
      currentDayCashTotal: 81900,
      currentDayCashTransactionCount: 10,
      paymentTotals: [
        { amount: 81900, method: "cash", transactionCount: 10 },
        { amount: 98700, method: "mobile_money", transactionCount: 9 },
        { amount: 44000, method: "card", transactionCount: 4 },
      ],
      registerCount: 1,
      salesTotal: 224600,
      totalSales: 224600,
      transactionCount: 23,
    },
    summary: {
      cashDeposited: CASH_DEPOSITED,
      cashExpected: EXPECTED_CASH,
      closedRegisterSessionCount: 1,
      currentDayCashTotal: SATURDAY_TOTALS.cashTotal,
      currentDayCashTransactionCount: SATURDAY_TOTALS.cashTransactionCount,
      expectedCashTotal: EXPECTED_CASH,
      netCashVariance: CASH_VARIANCE,
      paymentTotals: [
        {
          amount: SATURDAY_TOTALS.cashTotal,
          method: "cash",
          transactionCount: SATURDAY_TOTALS.cashTransactionCount,
        },
        {
          amount: SATURDAY_TOTALS.mobileMoneyTotal,
          method: "mobile_money",
          transactionCount: SATURDAY_TOTALS.mobileMoneyTransactionCount,
        },
        {
          amount: SATURDAY_TOTALS.cardTotal,
          method: "card",
          transactionCount: SATURDAY_TOTALS.cardTransactionCount,
        },
      ],
      registerCount: 1,
      registerVarianceCount: 1,
      salesTotal: SATURDAY_TOTALS.salesTotal,
      totalSales: SATURDAY_TOTALS.salesTotal,
      transactionCount: SATURDAY_TOTALS.transactionCount,
      varianceTotal: CASH_VARIANCE,
    },
  },
};

export const eodReviewFixtures = {
  "ready-to-close": {
    clock: READY_TO_CLOSE_CLOCK,
    props: readyToCloseFixture,
  },
} as const;

export type EodReviewFixtureName = keyof typeof eodReviewFixtures;
