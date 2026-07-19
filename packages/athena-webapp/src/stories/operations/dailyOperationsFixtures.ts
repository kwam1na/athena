/**
 * Screenshot fixtures for the Daily Operations workspace.
 *
 * These are authored prop bags, not seeded data — the workspace renders them without
 * issuing a single Convex query. See
 * `docs/plans/2026-07-19-001-feat-operations-screenshot-fixtures-plan.md`.
 *
 * The story is pinned to the shared demo store (Osu Studio — Atelier, GHS) so a capture
 * taken against `/demo` reads coherently alongside the real app chrome.
 *
 * Money is in minor units (pesewas), matching the rest of the app.
 */

import type { DailyOperationsViewContentProps } from "@/components/operations/DailyOperationsView";
import type { Id } from "~/convex/_generated/dataModel";

/** Saturday. The week runs Sunday 2026-07-12 → Saturday 2026-07-18. */
const OPERATING_DATE = "2026-07-18";

/** Mid-afternoon, so the day reads as still trading rather than wrapped up. */
export const BUSY_SATURDAY_CLOCK = new Date(2026, 6, 18, 15, 20);

const STORE_ID = "demo-store-osu-atelier" as Id<"store">;
// Matches the shared demo store's actual route params, so links in the fixture resolve
// against the session a capture is taken in.
const ORG_URL_SLUG = "demo";
const STORE_URL_SLUG = "central";

const DAY_START = new Date(2026, 6, 18, 0, 0).getTime();
const DAY_END = new Date(2026, 6, 19, 0, 0).getTime();

/** Minutes past local midnight → epoch millis, for readable timeline authoring. */
function at(hour: number, minute: number) {
  return new Date(2026, 6, 18, hour, minute).getTime();
}

const linkParams = {
  orgUrlSlug: ORG_URL_SLUG,
  storeUrlSlug: STORE_URL_SLUG,
};

/**
 * A week that builds toward the weekend — quiet Sunday, steady midweek, a strong
 * Friday, and a Saturday that is already the best day of the week by mid-afternoon.
 */
const weekMetrics: DailyOperationsViewContentProps["cachedWeekMetrics"] = [
  {
    currentDayCashTotal: 48200,
    currentDayCashTransactionCount: 6,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: true,
    isSelected: false,
    operatingDate: "2026-07-12",
    paymentTotals: [
      { amount: 48200, method: "cash", transactionCount: 6 },
      { amount: 80300, method: "mobile_money", transactionCount: 7 },
    ],
    salesTotal: 128500,
    transactionCount: 13,
  },
  {
    currentDayCashTotal: 31500,
    currentDayCashTransactionCount: 4,
    expenseTotal: 12000,
    expenseTransactionCount: 1,
    isClosed: true,
    isSelected: false,
    operatingDate: "2026-07-13",
    paymentTotals: [
      { amount: 31500, method: "cash", transactionCount: 4 },
      { amount: 64500, method: "mobile_money", transactionCount: 6 },
    ],
    salesTotal: 96000,
    transactionCount: 10,
  },
  {
    currentDayCashTotal: 42800,
    currentDayCashTransactionCount: 5,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: true,
    isSelected: false,
    operatingDate: "2026-07-14",
    paymentTotals: [
      { amount: 42800, method: "cash", transactionCount: 5 },
      { amount: 51600, method: "mobile_money", transactionCount: 5 },
      { amount: 18000, method: "card", transactionCount: 2 },
    ],
    salesTotal: 112400,
    transactionCount: 12,
  },
  {
    currentDayCashTotal: 55100,
    currentDayCashTransactionCount: 7,
    expenseTotal: 6500,
    expenseTransactionCount: 1,
    isClosed: true,
    isSelected: false,
    operatingDate: "2026-07-15",
    paymentTotals: [
      { amount: 55100, method: "cash", transactionCount: 7 },
      { amount: 66700, method: "mobile_money", transactionCount: 6 },
      { amount: 22000, method: "card", transactionCount: 2 },
    ],
    salesTotal: 143800,
    transactionCount: 15,
  },
  {
    currentDayCashTotal: 68400,
    currentDayCashTransactionCount: 8,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: true,
    isSelected: false,
    operatingDate: "2026-07-16",
    paymentTotals: [
      { amount: 68400, method: "cash", transactionCount: 8 },
      { amount: 83800, method: "mobile_money", transactionCount: 8 },
      { amount: 35000, method: "card", transactionCount: 3 },
    ],
    salesTotal: 187200,
    transactionCount: 19,
  },
  {
    currentDayCashTotal: 81900,
    currentDayCashTransactionCount: 10,
    expenseTotal: 15000,
    expenseTransactionCount: 2,
    isClosed: true,
    isSelected: false,
    operatingDate: "2026-07-17",
    paymentTotals: [
      { amount: 81900, method: "cash", transactionCount: 10 },
      { amount: 98700, method: "mobile_money", transactionCount: 9 },
      { amount: 44000, method: "card", transactionCount: 4 },
    ],
    salesTotal: 224600,
    transactionCount: 23,
  },
  {
    currentDayCashTotal: 121400,
    currentDayCashTransactionCount: 15,
    expenseTotal: 8500,
    expenseTransactionCount: 2,
    isClosed: false,
    isSelected: true,
    operatingDate: OPERATING_DATE,
    paymentTotals: [
      { amount: 121400, method: "cash", transactionCount: 15 },
      { amount: 142500, method: "mobile_money", transactionCount: 14 },
      { amount: 55000, method: "card", transactionCount: 5 },
    ],
    salesTotal: 318900,
    transactionCount: 34,
  },
];

const timeline: NonNullable<
  DailyOperationsViewContentProps["timelinePreviewSnapshot"]
>["timeline"] = [
  {
    createdAt: at(15, 12),
    id: "evt-sale-1184",
    message: "Sale #1184 completed on Register 01 — GHS 350.00.",
    subject: { id: "txn-1184", label: "#1184", type: "pos_transaction" },
    transactionLink: {
      label: "#1184",
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/txn-1184",
    },
    type: "pos_sale_completed",
  },
  {
    createdAt: at(14, 47),
    id: "evt-approval-req",
    message:
      "Efua Tetteh requested manager approval for a 15% discount on Sale #1183.",
    subject: { id: "apr-3391", label: "Discount approval", type: "approval" },
    transactionLink: {
      label: "#1183",
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/txn-1183",
    },
    type: "approval_requested",
  },
  {
    createdAt: at(14, 3),
    id: "evt-stock-low",
    message: "Kente Scarf dropped to 2 units in stock.",
    productLink: {
      label: "Kente Scarf",
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/products/demo-kente-scarf",
    },
    subject: { id: "sku-kente", label: "Kente Scarf", type: "product" },
    type: "stock_threshold_crossed",
  },
  {
    createdAt: at(13, 21),
    id: "evt-sale-1179",
    message: "Sale #1179 completed on Register 01 — GHS 220.00.",
    subject: { id: "txn-1179", label: "#1179", type: "pos_transaction" },
    transactionLink: {
      label: "#1179",
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/txn-1179",
    },
    type: "pos_sale_completed",
  },
  {
    createdAt: at(12, 40),
    id: "evt-expense",
    message: "Kwabena Osei recorded a GHS 55.00 expense for packaging supplies.",
    subject: { id: "exp-204", label: "Packaging supplies", type: "expense" },
    type: "expense_recorded",
  },
  {
    createdAt: at(11, 8),
    id: "evt-online-order",
    message: "Online order #A-2231 was marked ready for pickup.",
    onlineOrderLink: {
      label: "#A-2231",
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/orders/order-a2231",
    },
    subject: { id: "order-a2231", label: "#A-2231", type: "online_order" },
    type: "online_order_ready",
  },
  {
    createdAt: at(9, 52),
    id: "evt-drawer-open",
    message: "Efua Tetteh opened Register 01 with a GHS 500.00 float.",
    registerLink: {
      label: "Register 01",
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/session-9931",
    },
    subject: { id: "session-9931", label: "Register 01", type: "register_session" },
    type: "register_session_opened",
  },
  {
    createdAt: at(9, 45),
    id: "evt-day-open",
    message: "Kwabena Osei started the store day.",
    subject: { id: "opening-0718", label: "Store day", type: "daily_opening" },
    type: "store_day_started",
  },
];

/** Fourteen trading days ending on the selected Saturday, for the sales-trend chart. */
const trend = [
  { date: "2026-07-05", label: "Jul 5", salesTotal: 114200, transactionCount: 12, itemsSold: 21 },
  { date: "2026-07-06", label: "Jul 6", salesTotal: 88400, transactionCount: 9, itemsSold: 16 },
  { date: "2026-07-07", label: "Jul 7", salesTotal: 101600, transactionCount: 11, itemsSold: 19 },
  { date: "2026-07-08", label: "Jul 8", salesTotal: 132900, transactionCount: 14, itemsSold: 25 },
  { date: "2026-07-09", label: "Jul 9", salesTotal: 168300, transactionCount: 17, itemsSold: 31 },
  { date: "2026-07-10", label: "Jul 10", salesTotal: 203100, transactionCount: 21, itemsSold: 38 },
  { date: "2026-07-11", label: "Jul 11", salesTotal: 287400, transactionCount: 29, itemsSold: 54 },
  { date: "2026-07-12", label: "Jul 12", salesTotal: 128500, transactionCount: 13, itemsSold: 24 },
  { date: "2026-07-13", label: "Jul 13", salesTotal: 96000, transactionCount: 10, itemsSold: 18 },
  { date: "2026-07-14", label: "Jul 14", salesTotal: 112400, transactionCount: 12, itemsSold: 22 },
  { date: "2026-07-15", label: "Jul 15", salesTotal: 143800, transactionCount: 15, itemsSold: 27 },
  { date: "2026-07-16", label: "Jul 16", salesTotal: 187200, transactionCount: 19, itemsSold: 35 },
  { date: "2026-07-17", label: "Jul 17", salesTotal: 224600, transactionCount: 23, itemsSold: 43 },
  { date: OPERATING_DATE, label: "Jul 18", salesTotal: 318900, transactionCount: 34, itemsSold: 61 },
].map((day) => ({
  averageTransaction: Math.round(day.salesTotal / day.transactionCount),
  date: day.date,
  hasKnownItemCount: true,
  label: day.label,
  totalItemsSold: day.itemsSold,
  totalSales: day.salesTotal,
  transactionCount: day.transactionCount,
}));

const storePulse = {
  averageTransaction: 9379,
  date: OPERATING_DATE,
  operatorSnapshot: {
    busiestHour: {
      hour: 14,
      label: "2 – 3 PM",
      totalSales: 74500,
      transactionCount: 8,
    },
    comparison: {
      averageTransactionDeltaPercent: 0.14,
      currentAverageTransaction: 9379,
      currentItemsSold: 61,
      currentSales: 318900,
      currentTransactions: 34,
      itemsSoldDeltaPercent: 0.42,
      salesDeltaPercent: 0.42,
      transactionDeltaPercent: 0.48,
      yesterdayAverageTransaction: 9765,
      yesterdayItemsSold: 43,
      yesterdaySales: 224600,
      yesterdayTransactions: 23,
    },
    historyDays: 14,
    isLimited: false,
    // `share` is share of transactions, not of value — that is what the payment-mix
    // panel renders beside each method's count.
    paymentMix: [
      { count: 14, label: "Mobile money", method: "mobile_money", share: 0.412, total: 142500 },
      { count: 15, label: "Cash", method: "cash", share: 0.441, total: 121400 },
      { count: 5, label: "Card", method: "card", share: 0.147, total: 55000 },
    ],
    topItems: [
      { name: "Kente Scarf", productSku: "FM5W-8QJ-4K7", quantity: 4, totalSales: 140000 },
      { name: "Bolga Woven Basket", productSku: "FM5W-6BX-5W1", quantity: 3, totalSales: 66000 },
      { name: "Batik Tote Bag", productSku: "FM5W-5K4-9T2", quantity: 3, totalSales: 54000 },
      { name: "Hibiscus Soy Candle", productSku: "FM5W-2MP-7F4", quantity: 5, totalSales: 60000 },
      { name: "Raw Shea Butter 250g", productSku: "FM5W-7K2-3Q9", quantity: 9, totalSales: 54000 },
    ],
    trend,
    usableHistoryDays: 14,
  },
  totalItemsSold: 61,
  totalSales: 318900,
  totalTransactions: 34,
};

/**
 * A busy Saturday, mid-afternoon: one register trading, a discount approval waiting on
 * a manager, and a low-stock nudge. The day is the strongest of the week and not yet
 * closed.
 */
export const busySaturdayFixture: DailyOperationsViewContentProps = {
  cachedWeekAnalyticsFetchedAt: at(15, 18),
  cachedWeekMetrics: weekMetrics,
  cachedWeekStorePulse: {
    averageTransaction: 8674,
    totalItemsSold: 248,
    totalSales: 1211400,
    totalTransactions: 126,
  },
  canViewAutomationStatuses: true,
  currency: "GHS",
  hasDetailSnapshot: true,
  hasFinancialDetailsAccess: true,
  hasFullAdminAccess: true,
  isAuthenticated: true,
  isLoadingAccess: false,
  isLoadingSnapshot: false,
  orgUrlSlug: ORG_URL_SLUG,
  storePulseWindow: "today",
  storeUrlSlug: STORE_URL_SLUG,
  timelinePreviewSnapshot: {
    operatingDate: OPERATING_DATE,
    timeline: timeline.slice(0, 5),
    timelineHasMore: true,
  },
  // Supplied so the "Show more" affordance opens a populated sheet rather than the
  // "Timeline detail is not loaded yet" empty state.
  timelineSnapshot: {
    operatingDate: OPERATING_DATE,
    timeline,
  },
  snapshot: {
    attentionItems: [
      {
        id: "att-approval",
        label: "Discount approval waiting",
        message: "Sale #1183 needs a manager decision before the drawer closes.",
        owner: "operations_queue",
        params: linkParams,
        severity: "warning",
        source: { id: "apr-3391", label: "Discount approval", type: "approval" },
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
      },
      {
        id: "att-stock",
        label: "Kente Scarf running low",
        message: "2 units left after today's sales.",
        owner: "operations_queue",
        params: linkParams,
        severity: "info",
        source: { id: "sku-kente", label: "Kente Scarf", type: "product" },
        to: "/$orgUrlSlug/store/$storeUrlSlug/products/demo-kente-scarf",
      },
    ],
    closeSummary: {
      carriedOverCashTotal: 50000,
      carriedOverRegisterCount: 1,
      currentDayCashTotal: 121400,
      currentDayCashTransactionCount: 15,
      expenseTotal: 8500,
      expenseTransactionCount: 2,
      netCashVariance: 0,
      paymentTotals: [
        { amount: 121400, method: "cash", transactionCount: 15 },
        { amount: 142500, method: "mobile_money", transactionCount: 14 },
        { amount: 55000, method: "card", transactionCount: 5 },
      ],
      registerVarianceCount: 0,
      salesTotal: 318900,
      transactionCount: 34,
    },
    currency: "GHS",
    endAt: DAY_END,
    lanes: [
      {
        count: 0,
        description: "Opening checks cleared at 9:45 AM.",
        key: "opening",
        label: "Opening",
        status: "ready",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
      },
      {
        count: 1,
        countLabel: "1 waiting",
        description: "A discount needs a manager decision.",
        key: "approvals",
        label: "Store requests",
        status: "needs_attention",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
      },
      {
        count: 1,
        countLabel: "1 open",
        description: "Register 01 is still trading.",
        key: "registers",
        label: "Cash controls",
        status: "needs_attention",
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls",
      },
      {
        count: 0,
        description: "Available once the drawer is counted.",
        key: "close",
        label: "EOD review",
        status: "unknown",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
      },
    ],
    lifecycle: {
      description: "Register 01 is trading. Close opens once the drawer is counted.",
      label: "Store day open",
      status: "operating",
    },
    operatingDate: OPERATING_DATE,
    primaryAction: {
      label: "Review store requests",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
    },
    startAt: DAY_START,
    storeId: STORE_ID,
    storePulse,
    timeline,
    timelineHasMore: true,
    weekMetrics,
  },
};

export const dailyOperationsFixtures = {
  "busy-saturday": {
    clock: BUSY_SATURDAY_CLOCK,
    props: busySaturdayFixture,
  },
} as const;

export type DailyOperationsFixtureName = keyof typeof dailyOperationsFixtures;
