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

import {
  DAY_END,
  DAY_START,
  LINK_PARAMS as linkParams,
  momentAt as at,
  OPERATING_DATE,
  ORG_URL_SLUG,
  REGISTER_DISPLAY_LABEL,
  STORE_ID,
  STORE_URL_SLUG,
} from "./operationsFixtureContext";

/** Mid-afternoon, so the day reads as still trading rather than wrapped up. */
export const BUSY_SATURDAY_CLOCK = new Date(2026, 6, 18, 15, 20);

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
    message: "Sale #1184 synced: 3 sale lines, GH₵350, cash and mobile money.",
    subject: { id: "txn-1184", label: "#1184", type: "pos_transaction" },
    transactionLink: {
      label: "#1184",
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/txn-1184",
    },
    type: "pos_local_sync.sale_projected",
  },
  {
    // The stored message is "Void requested for Transaction #N."; the daily-operations
    // snapshot splices in the requester's name at read time
    // (`normalizeTimelineEventMessage`, convex/operations/dailyOperations.ts). This is
    // the post-rewrite form the workspace actually renders.
    createdAt: at(14, 47),
    id: "evt-void-request",
    message: "Void requested by Afua O. for Transaction #1183.",
    subject: {
      id: "txn-1183",
      label: "Transaction #1183",
      type: "pos_transaction",
    },
    transactionLink: {
      label: "#1183",
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/txn-1183",
    },
    type: "pos_transaction_void_approval_requested",
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
    message: "Sale #1179 synced: 1 sale line, GH₵220, mobile money.",
    subject: { id: "txn-1179", label: "#1179", type: "pos_transaction" },
    transactionLink: {
      label: "#1179",
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/txn-1179",
    },
    type: "pos_local_sync.sale_projected",
  },
  {
    createdAt: at(12, 40),
    id: "evt-expense",
    message: "Kwabena A. recorded a GH₵55 expense for packaging supplies.",
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
    message:
      "Afua O. opened Studio Front Register / Register 01 with a GH₵500 float.",
    registerLink: {
      label: REGISTER_DISPLAY_LABEL,
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/session-9931",
    },
    subject: {
      id: "session-9931",
      label: REGISTER_DISPLAY_LABEL,
      type: "register_session",
    },
    type: "register_session_opened",
  },
  {
    createdAt: at(9, 45),
    id: "evt-day-open",
    message: "Athena started the store day automatically.",
    subject: { id: "opening-0718", label: "Store day", type: "daily_opening" },
    type: "store_day_started",
  },
];

/**
 * Opening auto-start, shown in the automation band.
 *
 * `outcome: "applied"` is required for an opening-lane status to stay visible once the
 * day is past `not_opened` (`getVisibleAutomationStatuses`), and `scheduled_later` is
 * filtered out entirely.
 */
const automationStatuses: NonNullable<
  NonNullable<DailyOperationsViewContentProps["snapshot"]>["automationStatuses"]
> = [
  {
    bucket: "action_taken",
    id: "auto-opening-0718",
    lane: "opening",
    occurredAt: at(9, 45),
    outcome: "applied",
    sourceLink: {
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
    },
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
  // Renders the open-drawer attention row. The workspace synthesises the row label,
  // severity and link itself; the fixture supplies only the session identity.
  //
  // `displayLabel` follows the server's own `{terminalName} / Register {registerNumber}`
  // construction (convex/operations/dailyOperations.ts), using the shared demo store's
  // terminal name and register number so it matches what a real session would show.
  openRegisterSessionsSnapshot: {
    operatingDate: OPERATING_DATE,
    sessions: [
      { displayLabel: REGISTER_DISPLAY_LABEL, id: "session-9931" },
    ],
  },
  // The operating-date trigger is rendered `disabled={disabled || !onChange}`, so the
  // control only looks live when a handler is present. A fixture has nowhere to navigate
  // to, so this is a no-op that exists purely to keep the trigger enabled.
  onOperatingDateChange: () => {},
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
    automationStatuses,
    attentionItems: [
      {
        // Shape and copy follow `queueAttentionItems` in
        // convex/operations/dailyOperations.ts: the label is the approval's `reason`
        // verbatim (set in completeTransaction.ts for a void), and the message is fixed.
        id: "approval_request:apr-3391:pending",
        label: "Manager approval is required to void a completed sale.",
        message: "Resolve the pending approval in Operations.",
        owner: "operations_queue",
        params: linkParams,
        severity: "critical",
        source: {
          id: "apr-3391",
          label: "Manager approval is required to void a completed sale.",
          type: "approval_request",
        },
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
    // Lane keys, labels, descriptions and statuses follow `buildLanes` /
    // `buildApprovalsLane` in convex/operations/dailyOperations.ts. Copy is reproduced
    // from those branches rather than invented, so the fixture reads like real output.
    lanes: [
      {
        count: 0,
        description: "Opening Handoff is complete.",
        key: "opening",
        label: "Opening Handoff",
        status: "ready",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
      },
      {
        count: 0,
        description: "The end of day review is available for review.",
        key: "close",
        label: "EOD Review",
        status: "ready",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
      },
      {
        count: 1,
        countLabel: "1",
        description: "1 open item.",
        key: "queue",
        label: "Open work",
        status: "needs_attention",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
      },
      {
        count: 1,
        countLabel: "1",
        description: "1 approval pending.",
        key: "approvals",
        label: "Approvals",
        status: "blocked",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
      },
      {
        count: 0,
        description: "No register blockers.",
        key: "registers",
        label: "Registers",
        status: "ready",
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls",
      },
      {
        count: 0,
        description: "No unresolved POS sessions.",
        key: "pos_sessions",
        label: "POS sessions",
        status: "ready",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
      },
      {
        count: 0,
        description: "No expense exceptions.",
        key: "expenses",
        label: "Expenses",
        status: "ready",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
      },
    ],
    lifecycle: {
      description: "Register 01 is trading. Close opens once the drawer is counted.",
      label: "Store day open",
      status: "operating",
    },
    operatingDate: OPERATING_DATE,
    // `primaryAction` in convex/operations/dailyOperations.ts maps lifecycle status to a
    // fixed label; "operating" falls through to the default.
    primaryAction: {
      label: "Start EOD Review",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    },
    startAt: DAY_START,
    storeId: STORE_ID,
    storePulse,
    timeline,
    timelineHasMore: true,
    weekMetrics,
  },
};

// ---------------------------------------------------------------------------
// Busy Wednesday — a mid-week day, live at lunchtime.
//
// Self-contained: the shared `operationsFixtureContext` is pinned to the
// Saturday story that Opening Handoff and EOD Review also read, so a mid-week
// day authors its own dates rather than repurposing (and drifting) those. Only
// the non-date identity/routing constants are reused.
// ---------------------------------------------------------------------------

/** Wednesday 2026-07-15. The trading week runs Sunday 2026-07-12 → Saturday 2026-07-18. */
const WED_OPERATING_DATE = "2026-07-15";
const WED_DAY_START = new Date(2026, 6, 15, 0, 0).getTime();
const WED_DAY_END = new Date(2026, 6, 16, 0, 0).getTime();

/** Minutes past local midnight on the Wednesday → epoch millis. */
function wedAt(hour: number, minute: number) {
  return new Date(2026, 6, 15, hour, minute).getTime();
}

/** Lunchtime, so the day reads as actively trading with the afternoon still ahead. */
export const BUSY_WEDNESDAY_CLOCK = new Date(2026, 6, 15, 13, 10);

/**
 * The full Sunday→Saturday week around the selected Wednesday. Sunday through
 * Tuesday are closed; Wednesday is the selected, still-open day; Thursday
 * through Saturday are future dates the strip renders dimmed — the honest shape
 * of a week glanced at mid-week.
 */
const wednesdayWeekMetrics: DailyOperationsViewContentProps["cachedWeekMetrics"] =
  [
    {
      currentDayCashTotal: 250000,
      currentDayCashTransactionCount: 10,
      expenseTotal: 0,
      expenseTransactionCount: 0,
      isClosed: true,
      isSelected: false,
      operatingDate: "2026-07-12",
      paymentTotals: [
        { amount: 250000, method: "cash", transactionCount: 10 },
        { amount: 300000, method: "mobile_money", transactionCount: 13 },
        { amount: 90000, method: "card", transactionCount: 3 },
      ],
      salesTotal: 640000,
      transactionCount: 26,
    },
    {
      currentDayCashTotal: 180000,
      currentDayCashTransactionCount: 8,
      expenseTotal: 12000,
      expenseTransactionCount: 1,
      isClosed: true,
      isSelected: false,
      operatingDate: "2026-07-13",
      paymentTotals: [
        { amount: 180000, method: "cash", transactionCount: 8 },
        { amount: 240000, method: "mobile_money", transactionCount: 10 },
        { amount: 60000, method: "card", transactionCount: 2 },
      ],
      salesTotal: 480000,
      transactionCount: 20,
    },
    {
      currentDayCashTotal: 213000,
      currentDayCashTransactionCount: 9,
      expenseTotal: 0,
      expenseTransactionCount: 0,
      isClosed: true,
      isSelected: false,
      operatingDate: "2026-07-14",
      paymentTotals: [
        { amount: 213000, method: "cash", transactionCount: 9 },
        { amount: 237000, method: "mobile_money", transactionCount: 10 },
        { amount: 110000, method: "card", transactionCount: 4 },
      ],
      salesTotal: 560000,
      transactionCount: 23,
    },
    {
      currentDayCashTotal: 190000,
      currentDayCashTransactionCount: 8,
      expenseTotal: 6500,
      expenseTransactionCount: 1,
      isClosed: false,
      isSelected: true,
      operatingDate: WED_OPERATING_DATE,
      paymentTotals: [
        { amount: 190000, method: "cash", transactionCount: 8 },
        { amount: 330000, method: "mobile_money", transactionCount: 15 },
        { amount: 150000, method: "card", transactionCount: 5 },
      ],
      salesTotal: 670000,
      transactionCount: 28,
    },
    {
      currentDayCashTotal: 0,
      currentDayCashTransactionCount: 0,
      expenseTotal: 0,
      expenseTransactionCount: 0,
      isClosed: false,
      isSelected: false,
      operatingDate: "2026-07-16",
      paymentTotals: [],
      salesTotal: 0,
      transactionCount: 0,
    },
    {
      currentDayCashTotal: 0,
      currentDayCashTransactionCount: 0,
      expenseTotal: 0,
      expenseTransactionCount: 0,
      isClosed: false,
      isSelected: false,
      operatingDate: "2026-07-17",
      paymentTotals: [],
      salesTotal: 0,
      transactionCount: 0,
    },
    {
      currentDayCashTotal: 0,
      currentDayCashTransactionCount: 0,
      expenseTotal: 0,
      expenseTransactionCount: 0,
      isClosed: false,
      isSelected: false,
      operatingDate: "2026-07-18",
      paymentTotals: [],
      salesTotal: 0,
      transactionCount: 0,
    },
  ];

const wednesdayTimeline: NonNullable<
  DailyOperationsViewContentProps["timelinePreviewSnapshot"]
>["timeline"] = [
  {
    createdAt: wedAt(12, 58),
    id: "evt-sale-1149",
    message: "Sale #1149 synced: 2 sale lines, GH₵420, cash and mobile money.",
    subject: { id: "txn-1149", label: "#1149", type: "pos_transaction" },
    transactionLink: {
      label: "#1149",
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/txn-1149",
    },
    type: "pos_local_sync.sale_projected",
  },
  {
    // The stored message is "Void requested for Transaction #N."; the daily-operations
    // snapshot splices in the requester's name at read time
    // (`normalizeTimelineEventMessage`, convex/operations/dailyOperations.ts). This is
    // the post-rewrite form the workspace actually renders.
    createdAt: wedAt(12, 31),
    id: "evt-void-request",
    message: "Void requested by Afua O. for Transaction #1147.",
    subject: {
      id: "txn-1147",
      label: "Transaction #1147",
      type: "pos_transaction",
    },
    transactionLink: {
      label: "#1147",
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/txn-1147",
    },
    type: "pos_transaction_void_approval_requested",
  },
  {
    createdAt: wedAt(11, 47),
    id: "evt-stock-low",
    message: "Kente Scarf dropped to 3 units in stock.",
    productLink: {
      label: "Kente Scarf",
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/products/demo-kente-scarf",
    },
    subject: { id: "sku-kente", label: "Kente Scarf", type: "product" },
    type: "stock_threshold_crossed",
  },
  {
    createdAt: wedAt(11, 15),
    id: "evt-sale-1143",
    message: "Sale #1143 synced: 1 sale line, GH₵180, mobile money.",
    subject: { id: "txn-1143", label: "#1143", type: "pos_transaction" },
    transactionLink: {
      label: "#1143",
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/txn-1143",
    },
    type: "pos_local_sync.sale_projected",
  },
  {
    createdAt: wedAt(10, 52),
    id: "evt-expense",
    message: "Kwabena A. recorded a GH₵65 expense for packaging supplies.",
    subject: { id: "exp-198", label: "Packaging supplies", type: "expense" },
    type: "expense_recorded",
  },
  {
    createdAt: wedAt(10, 20),
    id: "evt-online-order",
    message: "Online order #A-2214 was marked ready for pickup.",
    onlineOrderLink: {
      label: "#A-2214",
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/orders/order-a2214",
    },
    subject: { id: "order-a2214", label: "#A-2214", type: "online_order" },
    type: "online_order_ready",
  },
  {
    createdAt: wedAt(9, 41),
    id: "evt-drawer-open",
    message:
      "Afua O. opened Studio Front Register / Register 01 with a GH₵500 float.",
    registerLink: {
      label: REGISTER_DISPLAY_LABEL,
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/session-9847",
    },
    subject: {
      id: "session-9847",
      label: REGISTER_DISPLAY_LABEL,
      type: "register_session",
    },
    type: "register_session_opened",
  },
  {
    createdAt: wedAt(9, 34),
    id: "evt-day-open",
    message: "Athena started the store day automatically.",
    subject: { id: "opening-0715", label: "Store day", type: "daily_opening" },
    type: "store_day_started",
  },
];

const wednesdayAutomationStatuses: NonNullable<
  NonNullable<DailyOperationsViewContentProps["snapshot"]>["automationStatuses"]
> = [
  {
    bucket: "action_taken",
    id: "auto-opening-0715",
    lane: "opening",
    occurredAt: wedAt(9, 34),
    outcome: "applied",
    sourceLink: {
      params: linkParams,
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
    },
  },
];

/** Fourteen trading days ending on the selected Wednesday, for the sales-trend chart. */
const wednesdayTrend = [
  { date: "2026-07-02", label: "Jul 2", salesTotal: 495000, transactionCount: 21, itemsSold: 40 },
  { date: "2026-07-03", label: "Jul 3", salesTotal: 528000, transactionCount: 22, itemsSold: 43 },
  { date: "2026-07-04", label: "Jul 4", salesTotal: 612000, transactionCount: 26, itemsSold: 49 },
  { date: "2026-07-05", label: "Jul 5", salesTotal: 549000, transactionCount: 23, itemsSold: 44 },
  { date: "2026-07-06", label: "Jul 6", salesTotal: 438000, transactionCount: 18, itemsSold: 35 },
  { date: "2026-07-07", label: "Jul 7", salesTotal: 501000, transactionCount: 21, itemsSold: 40 },
  { date: "2026-07-08", label: "Jul 8", salesTotal: 606000, transactionCount: 25, itemsSold: 48 },
  { date: "2026-07-09", label: "Jul 9", salesTotal: 573000, transactionCount: 24, itemsSold: 46 },
  { date: "2026-07-10", label: "Jul 10", salesTotal: 702000, transactionCount: 29, itemsSold: 56 },
  { date: "2026-07-11", label: "Jul 11", salesTotal: 795000, transactionCount: 33, itemsSold: 63 },
  { date: "2026-07-12", label: "Jul 12", salesTotal: 640000, transactionCount: 26, itemsSold: 49 },
  { date: "2026-07-13", label: "Jul 13", salesTotal: 480000, transactionCount: 20, itemsSold: 37 },
  { date: "2026-07-14", label: "Jul 14", salesTotal: 560000, transactionCount: 23, itemsSold: 43 },
  { date: WED_OPERATING_DATE, label: "Jul 15", salesTotal: 670000, transactionCount: 28, itemsSold: 51 },
].map((day) => ({
  averageTransaction: Math.round(day.salesTotal / day.transactionCount),
  date: day.date,
  hasKnownItemCount: true,
  label: day.label,
  totalItemsSold: day.itemsSold,
  totalSales: day.salesTotal,
  transactionCount: day.transactionCount,
}));

const wednesdayStorePulse = {
  averageTransaction: 23929,
  date: WED_OPERATING_DATE,
  operatorSnapshot: {
    busiestHour: {
      hour: 12,
      label: "12 – 1 PM",
      totalSales: 148000,
      transactionCount: 7,
    },
    comparison: {
      averageTransactionDeltaPercent: -0.02,
      currentAverageTransaction: 23929,
      currentItemsSold: 51,
      currentSales: 670000,
      currentTransactions: 28,
      itemsSoldDeltaPercent: 0.19,
      salesDeltaPercent: 0.2,
      transactionDeltaPercent: 0.22,
      yesterdayAverageTransaction: 24348,
      yesterdayItemsSold: 43,
      yesterdaySales: 560000,
      yesterdayTransactions: 23,
    },
    historyDays: 14,
    isLimited: false,
    // `share` is share of transactions, not of value — that is what the payment-mix
    // panel renders beside each method's count.
    paymentMix: [
      { count: 15, label: "Mobile money", method: "mobile_money", share: 0.536, total: 330000 },
      { count: 8, label: "Cash", method: "cash", share: 0.286, total: 190000 },
      { count: 5, label: "Card", method: "card", share: 0.178, total: 150000 },
    ],
    topItems: [
      { name: "Kente Scarf", productSku: "FM5W-8QJ-4K7", quantity: 4, totalSales: 140000 },
      { name: "Bolga Woven Basket", productSku: "FM5W-6BX-5W1", quantity: 5, totalSales: 110000 },
      { name: "Batik Tote Bag", productSku: "FM5W-5K4-9T2", quantity: 4, totalSales: 72000 },
      { name: "Hibiscus Soy Candle", productSku: "FM5W-2MP-7F4", quantity: 7, totalSales: 84000 },
      { name: "Raw Shea Butter 250g", productSku: "FM5W-7K2-3Q9", quantity: 11, totalSales: 66000 },
    ],
    trend: wednesdayTrend,
    usableHistoryDays: 14,
  },
  totalItemsSold: 51,
  totalSales: 670000,
  totalTransactions: 28,
};

/**
 * A busy Wednesday at lunchtime: one register trading, a void approval waiting on a
 * manager, and a low-stock nudge. The day is already outpacing the days before it and
 * is only half done.
 */
export const busyWednesdayFixture: DailyOperationsViewContentProps = {
  cachedWeekAnalyticsFetchedAt: wedAt(13, 8),
  cachedWeekMetrics: wednesdayWeekMetrics,
  cachedWeekStorePulse: {
    averageTransaction: 24227,
    totalItemsSold: 180,
    totalSales: 2350000,
    totalTransactions: 97,
  },
  canViewAutomationStatuses: true,
  currency: "GHS",
  hasDetailSnapshot: true,
  hasFinancialDetailsAccess: true,
  hasFullAdminAccess: true,
  isAuthenticated: true,
  isLoadingAccess: false,
  isLoadingSnapshot: false,
  openRegisterSessionsSnapshot: {
    operatingDate: WED_OPERATING_DATE,
    sessions: [{ displayLabel: REGISTER_DISPLAY_LABEL, id: "session-9847" }],
  },
  onOperatingDateChange: () => {},
  orgUrlSlug: ORG_URL_SLUG,
  storePulseWindow: "today",
  storeUrlSlug: STORE_URL_SLUG,
  timelinePreviewSnapshot: {
    operatingDate: WED_OPERATING_DATE,
    timeline: wednesdayTimeline.slice(0, 5),
    timelineHasMore: true,
  },
  timelineSnapshot: {
    operatingDate: WED_OPERATING_DATE,
    timeline: wednesdayTimeline,
  },
  snapshot: {
    automationStatuses: wednesdayAutomationStatuses,
    attentionItems: [
      {
        id: "approval_request:apr-3372:pending",
        label: "Manager approval is required to void a completed sale.",
        message: "Resolve the pending approval in Operations.",
        owner: "operations_queue",
        params: linkParams,
        severity: "critical",
        source: {
          id: "apr-3372",
          label: "Manager approval is required to void a completed sale.",
          type: "approval_request",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
      },
      {
        id: "att-stock",
        label: "Kente Scarf running low",
        message: "3 units left after today's sales.",
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
      currentDayCashTotal: 190000,
      currentDayCashTransactionCount: 8,
      expenseTotal: 6500,
      expenseTransactionCount: 1,
      netCashVariance: 0,
      paymentTotals: [
        { amount: 190000, method: "cash", transactionCount: 8 },
        { amount: 330000, method: "mobile_money", transactionCount: 15 },
        { amount: 150000, method: "card", transactionCount: 5 },
      ],
      registerVarianceCount: 0,
      salesTotal: 670000,
      transactionCount: 28,
    },
    currency: "GHS",
    endAt: WED_DAY_END,
    lanes: [
      {
        count: 0,
        description: "Opening Handoff is complete.",
        key: "opening",
        label: "Opening Handoff",
        status: "ready",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
      },
      {
        count: 0,
        description: "The end of day review is available for review.",
        key: "close",
        label: "EOD Review",
        status: "ready",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
      },
      {
        count: 1,
        countLabel: "1",
        description: "1 open item.",
        key: "queue",
        label: "Open work",
        status: "needs_attention",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
      },
      {
        count: 1,
        countLabel: "1",
        description: "1 approval pending.",
        key: "approvals",
        label: "Approvals",
        status: "blocked",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
      },
      {
        count: 0,
        description: "No register blockers.",
        key: "registers",
        label: "Registers",
        status: "ready",
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls",
      },
      {
        count: 0,
        description: "No unresolved POS sessions.",
        key: "pos_sessions",
        label: "POS sessions",
        status: "ready",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
      },
      {
        count: 0,
        description: "No expense exceptions.",
        key: "expenses",
        label: "Expenses",
        status: "ready",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
      },
    ],
    lifecycle: {
      description: "Register 01 is trading. Close opens once the drawer is counted.",
      label: "Store day open",
      status: "operating",
    },
    operatingDate: WED_OPERATING_DATE,
    primaryAction: {
      label: "Start EOD Review",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    },
    startAt: WED_DAY_START,
    storeId: STORE_ID,
    storePulse: wednesdayStorePulse,
    timeline: wednesdayTimeline,
    timelineHasMore: true,
    weekMetrics: wednesdayWeekMetrics,
  },
};

export const dailyOperationsFixtures = {
  "busy-saturday": {
    clock: BUSY_SATURDAY_CLOCK,
    props: busySaturdayFixture,
  },
  "busy-wednesday": {
    clock: BUSY_WEDNESDAY_CLOCK,
    props: busyWednesdayFixture,
  },
} as const;

export type DailyOperationsFixtureName = keyof typeof dailyOperationsFixtures;
