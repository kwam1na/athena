import type { ComponentProps } from "react";

import type { CashControlsDashboardSnapshot } from "@/components/cash-controls/CashControlsDashboard";
import {
  RegisterSessionActivitySection,
  type RegisterSessionSnapshot,
} from "@/components/cash-controls/RegisterSessionView";
import type { DailyCloseSnapshot } from "@/components/operations/DailyCloseView";
import type { StorePulseSummary } from "@/components/store-pulse/StorePulseSummaryView";
import type { CartItem } from "@/components/pos/types";
import type { PosCartLineId } from "@/lib/pos/domain/types";
import {
  buildPosSyncStatusPresentation,
  type PosSyncStatusPresentation,
} from "@/lib/pos/presentation/syncStatusPresentation";
import {
  classifyPosRegisterSessionLocalEventType,
  toPosRegisterSessionActivityStatusLabel,
} from "~/shared/posRegisterSessionActivityContract";
import {
  SHARED_DEMO_PRODUCTS,
  SHARED_DEMO_STAFF_STORY,
  sharedDemoProductBySlug,
  sharedDemoStaffShortName,
} from "~/shared/sharedDemoStory";

import {
  dayTotals,
  demoStore,
  drawer,
  morningSnapshot,
  payments,
  topItems,
  tracedSale,
} from "./demoDay";

// Fixture props for the REAL workspace components rendered on the landing
// page. Everything derives from the demoDay story so the fixtures reconcile
// with the copy around them (see demoDay.test.ts).

// The busy Wednesday captured in the operations screenshot fixtures — the
// same day shown in the landing page's workspace shots.
export const STORY_OPERATING_DATE = "2026-07-15";

// The story day runs in the demo store's timezone (America/New_York, UTC-4
// on this date).
function storyTime(hour: number, minute: number) {
  return Date.UTC(2026, 6, 15, hour + 4, minute);
}

export const storyMoments = {
  close: storyTime(20, 3),
  closeout: storyTime(17, 40),
  dayEnd: storyTime(24, 0),
  dayStart: storyTime(0, 0),
  // Afua opens the drawer at 9:41 AM, a few minutes after Athena starts the
  // store day at 9:34 (both visible in the captured workspace shots).
  opening: storyTime(9, 41),
  sale: storyTime(15, 14),
} as const;

// Register 01's session for the story day. The _id's last six characters
// surface as the session code in the register session view, so the tail must
// read like one.
const STORY_SESSION_ID = "story-register-01-9k4wqz";

// ---------------------------------------------------------------------------
// Daily Operations · StorePulseSummaryView (mid-morning)

export const morningPaymentMix = [
  { count: 3, label: "Cash", method: "cash", share: 59, total: 40_000 },
  { count: 2, label: "Card", method: "card", share: 29, total: 20_000 },
  { count: 1, label: "Mobile money", method: "mobile_money", share: 12, total: 8_000 },
] as const;

export const morningTopItems = [
  { name: "Raw Shea Butter 250g", productSku: sharedDemoProductBySlug("demo-shea-butter").sku, quantity: 3, totalSales: 18_000 },
  { name: "Black Soap Bar", productSku: sharedDemoProductBySlug("demo-black-soap").sku, quantity: 4, totalSales: 14_000 },
  { name: "Beaded Bracelet", productSku: sharedDemoProductBySlug("demo-beaded-bracelet").sku, quantity: 2, totalSales: 11_000 },
  { name: "Hand-Thrown Clay Mug", productSku: sharedDemoProductBySlug("demo-clay-mug").sku, quantity: 1, totalSales: 9_500 },
] as const;

// The week behind the story day, matching the Daily Operations shot's trend
// (Sun Jul 12 GH₵6,400 · Mon 4,800 · Tue 5,600), with the Wednesday still in
// its morning state.
const morningTrend = [
  { date: "2026-07-09", label: "Jul 9", totalSales: 573_000, totalItemsSold: 46, transactionCount: 24 },
  { date: "2026-07-10", label: "Jul 10", totalSales: 702_000, totalItemsSold: 56, transactionCount: 29 },
  { date: "2026-07-11", label: "Jul 11", totalSales: 795_000, totalItemsSold: 63, transactionCount: 33 },
  { date: "2026-07-12", label: "Jul 12", totalSales: 640_000, totalItemsSold: 49, transactionCount: 26 },
  { date: "2026-07-13", label: "Jul 13", totalSales: 480_000, totalItemsSold: 37, transactionCount: 20 },
  { date: "2026-07-14", label: "Jul 14", totalSales: 560_000, totalItemsSold: 43, transactionCount: 23 },
  { date: STORY_OPERATING_DATE, label: "Jul 15", totalSales: morningSnapshot.netSales, totalItemsSold: morningSnapshot.itemsSold, transactionCount: morningSnapshot.transactions },
].map((day) => ({
  ...day,
  averageTransaction: Math.round(day.totalSales / day.transactionCount),
}));

export const morningPulseSummary: StorePulseSummary = {
  averageTransaction: Math.round(morningSnapshot.netSales / morningSnapshot.transactions),
  date: STORY_OPERATING_DATE,
  operatorSnapshot: {
    busiestHour: null,
    comparison: {
      averageTransactionDeltaPercent: -3.9,
      currentAverageTransaction: Math.round(morningSnapshot.netSales / morningSnapshot.transactions),
      currentItemsSold: morningSnapshot.itemsSold,
      currentSales: morningSnapshot.netSales,
      currentTransactions: morningSnapshot.transactions,
      itemsSoldDeltaPercent: 22.2,
      salesDeltaPercent: 15.3,
      transactionDeltaPercent: 20,
      yesterdayAverageTransaction: 11_800,
      yesterdayItemsSold: 9,
      yesterdaySales: 59_000,
      yesterdayTransactions: 5,
    },
    historyDays: 14,
    isLimited: false,
    paymentMix: [...morningPaymentMix],
    topItems: [...morningTopItems],
    trend: morningTrend,
    usableHistoryDays: 14,
  },
  totalItemsSold: morningSnapshot.itemsSold,
  totalSales: morningSnapshot.netSales,
  totalTransactions: morningSnapshot.transactions,
};

// ---------------------------------------------------------------------------
// Point of Sale · CartItems + TotalsDisplay + sync status presentation

export const posCartLines: CartItem[] = tracedSale.items.map((item, index) => {
  const product = SHARED_DEMO_PRODUCTS.find((entry) => entry.name === item.name);
  return {
    barcode: product?.sku ?? item.name,
    id: `story-line-${index + 1}` as PosCartLineId,
    lineKind: "product" as const,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
    sku: product?.sku,
  };
});

export const offlinePresentation: PosSyncStatusPresentation = {
  description: "The register keeps selling; activity is saved on the device.",
  label: "Offline — sales continue",
  reconciliationItems: [],
  status: "pending_sync",
  tone: "warning",
};

export const pendingSyncPresentation = buildPosSyncStatusPresentation({
  pendingEventCount: 1,
  status: "pending_sync",
});

export const syncedPresentation = buildPosSyncStatusPresentation({
  status: "synced",
});

// ---------------------------------------------------------------------------
// Sync bridge · RegisterSessionActivitySection

type RegisterSessionActivityFixture = NonNullable<
  ComponentProps<typeof RegisterSessionActivitySection>["activity"]
>;

const emptyAttentionCounts = {
  activity_patch_failed: 0,
  conflicted: 0,
  held: 0,
  manager_applied: 0,
  manager_rejected: 0,
  mapping_pending: 0,
  rejected: 0,
} as const;

const emptyCategoryCounts = {
  cart: 0,
  cash: 0,
  closeout: 0,
  expense: 0,
  payment: 0,
  register: 0,
  reopen: 0,
  review: 0,
  sale: 0,
  service: 0,
  session: 0,
  sync: 0,
} as const;

const registerOpenedClassification =
  classifyPosRegisterSessionLocalEventType("register.opened");
const saleClassification =
  classifyPosRegisterSessionLocalEventType("transaction.completed");
const sessionStartedClassification =
  classifyPosRegisterSessionLocalEventType("session.started");
const cartItemClassification =
  classifyPosRegisterSessionLocalEventType("cart.item_added");
const paymentsUpdatedClassification =
  classifyPosRegisterSessionLocalEventType("session.payments_updated");
const projectedStatusLabel =
  toPosRegisterSessionActivityStatusLabel("projected");
// Fine-grained POS events surface as "Reported by terminal" until projection.
const terminalReportedStatus = {
  kind: "terminal_reported",
  label: toPosRegisterSessionActivityStatusLabel("terminal_reported"),
  tone: "default",
} as const;

export const bridgeActivity: RegisterSessionActivityFixture = {
  continueCursor: "",
  integration: {
    activityReadModelAvailable: true,
    source: "activity_read_model",
  },
  isDone: true,
  page: [
    {
      _id: "story-activity-sale",
      actorStaffName: sharedDemoStaffShortName(SHARED_DEMO_STAFF_STORY.cashier),
      category: saleClassification?.category ?? "sale",
      // The transaction evidence link is what turns the receipt number into
      // the "#1154 ↗" chip the product renders in the sale row's subheader.
      evidenceLinks: [
        {
          id: "story-txn-1154",
          label: `#${tracedSale.receiptNumber}`,
          type: "transaction" as const,
        },
      ],
      label: saleClassification?.label ?? "Sale completed",
      localEventId: "story-evt-1154",
      localRegisterSessionId: "story-local-session",
      occurredAt: storyMoments.sale,
      reportedAt: storyMoments.sale + 45_000,
      sequence: 6,
      source: "activity_read_model",
      status: { kind: "projected", label: projectedStatusLabel, tone: "success" },
      // The product's read-model summary shape for a completed sale:
      // "Receipt {n} - {k} sale lines - {p} payment - {method}".
      summary: `Receipt ${tracedSale.receiptNumber} - ${tracedSale.items.length} sale lines - 1 payment - Cash`,
      terminalName: "Studio Front Counter",
    },
    {
      _id: "story-activity-payment",
      actorStaffName: sharedDemoStaffShortName(SHARED_DEMO_STAFF_STORY.cashier),
      category: paymentsUpdatedClassification?.category ?? "payment",
      evidenceLinks: [],
      label: paymentsUpdatedClassification?.label ?? "Payment updated",
      localEventId: "story-evt-1153",
      localRegisterSessionId: "story-local-session",
      occurredAt: storyMoments.sale - 30_000,
      reportedAt: storyMoments.sale - 30_000 + 20_000,
      sequence: 5,
      source: "activity_read_model",
      status: terminalReportedStatus,
      summary: "1 payment - Cash",
      terminalName: "Studio Front Counter",
    },
    {
      _id: "story-activity-cart-soap",
      actorStaffName: sharedDemoStaffShortName(SHARED_DEMO_STAFF_STORY.cashier),
      category: cartItemClassification?.category ?? "cart",
      evidenceLinks: [],
      // The product renders cart rows from `item`: "Black Soap Bar · GH₵35 · Qty 1".
      item: {
        label: tracedSale.items[1].name,
        quantity: tracedSale.items[1].quantity,
        unitPrice: tracedSale.items[1].price,
      },
      label: cartItemClassification?.label ?? "Cart item added",
      localEventId: "story-evt-1152",
      localRegisterSessionId: "story-local-session",
      occurredAt: storyMoments.sale - 75_000,
      reportedAt: storyMoments.sale - 75_000 + 20_000,
      sequence: 4,
      source: "activity_read_model",
      status: terminalReportedStatus,
      summary: null,
      terminalName: "Studio Front Counter",
    },
    {
      _id: "story-activity-cart-kente",
      actorStaffName: sharedDemoStaffShortName(SHARED_DEMO_STAFF_STORY.cashier),
      category: cartItemClassification?.category ?? "cart",
      evidenceLinks: [],
      item: {
        label: tracedSale.items[0].name,
        quantity: tracedSale.items[0].quantity,
        unitPrice: tracedSale.items[0].price,
      },
      label: cartItemClassification?.label ?? "Cart item added",
      localEventId: "story-evt-1151",
      localRegisterSessionId: "story-local-session",
      occurredAt: storyMoments.sale - 120_000,
      reportedAt: storyMoments.sale - 120_000 + 20_000,
      sequence: 3,
      source: "activity_read_model",
      status: terminalReportedStatus,
      summary: null,
      terminalName: "Studio Front Counter",
    },
    {
      _id: "story-activity-session",
      actorStaffName: sharedDemoStaffShortName(SHARED_DEMO_STAFF_STORY.cashier),
      category: sessionStartedClassification?.category ?? "session",
      evidenceLinks: [],
      label: sessionStartedClassification?.label ?? "POS session started",
      localEventId: "story-evt-1150",
      localRegisterSessionId: "story-local-session",
      // The checkout session begins mid-afternoon — hours after the drawer
      // opened at 9:41 AM, which stays the oldest row below.
      occurredAt: storyMoments.sale - 150_000,
      reportedAt: storyMoments.sale - 150_000 + 20_000,
      sequence: 2,
      source: "activity_read_model",
      status: terminalReportedStatus,
      summary: null,
      terminalName: "Studio Front Counter",
    },
    {
      _id: "story-activity-open",
      actorStaffName: sharedDemoStaffShortName(SHARED_DEMO_STAFF_STORY.cashier),
      category: registerOpenedClassification?.category ?? "register",
      evidenceLinks: [],
      label: registerOpenedClassification?.label ?? "Register opened",
      localEventId: "story-evt-0001",
      localRegisterSessionId: "story-local-session",
      occurredAt: storyMoments.opening,
      // With openingFloat present the product renders the subheader as
      // "Opening float recorded: GH₵500".
      openingFloat: drawer.openingFloat,
      reportedAt: storyMoments.opening + 30_000,
      sequence: 1,
      source: "activity_read_model",
      status: { kind: "projected", label: projectedStatusLabel, tone: "success" },
      summary: "Opening float recorded",
      terminalName: "Studio Front Counter",
    },
  ],
  registerSession: {
    _id: STORY_SESSION_ID,
    registerNumber: demoStore.registerNumber,
    terminalName: "Studio Front Counter",
  },
  summary: {
    attentionCounts: { ...emptyAttentionCounts },
    categoryCounts: {
      ...emptyCategoryCounts,
      cart: 2,
      payment: 1,
      register: 1,
      sale: 1,
      session: 1,
    },
    coverageState: "reported",
    lastActivityReportedAt: storyMoments.sale + 45_000,
    latestCloudStatusAt: storyMoments.sale + 45_000,
    reportedThroughSequence: 6,
    rowCount: 6,
  },
};

// ---------------------------------------------------------------------------
// Cash Controls · CashControlsDashboardContent

// At 5:40 PM the day's drawer is mid-closeout: counted, in review, with the
// GH₵5 shortage surfaced but not yet approved (EOD Review settles it).
// Yesterday's session sits in the closed history, priced off the Jul 14 trend
// day; the GH₵500 float carries into Wednesday's opening.
const closingSession = {
  _id: STORY_SESSION_ID,
  countedCash: drawer.countedCash,
  expectedCash: drawer.expectedCash,
  openedAt: storyMoments.opening,
  openedByStaffName: sharedDemoStaffShortName(SHARED_DEMO_STAFF_STORY.cashier),
  openingFloat: drawer.openingFloat,
  // The submitted count is GH₵5 short — past the store's GH₵1 variance
  // threshold — so the session waits in "manager approval pending", the
  // judgment the EOD Review act then settles. The raw reason is the backend's
  // stored shape; the view formats the amount to currency.
  pendingApprovalRequest: {
    _id: "story-approval-variance",
    reason: `Variance of ${drawer.variance} exceeded the closeout approval threshold.`,
    requestedByStaffName: sharedDemoStaffShortName(SHARED_DEMO_STAFF_STORY.cashier),
    status: "pending",
  },
  registerNumber: demoStore.registerNumber,
  status: "closing",
  terminalName: "Studio Front Counter",
  totalDeposited: drawer.depositAmount,
  totalSales: dayTotals.netSales,
  variance: drawer.variance,
  workflowTraceId: "register_session:story-register-01",
};

export const cashDashboardSnapshot: CashControlsDashboardSnapshot = {
  openSessions: [],
  pendingCloseouts: [closingSession],
  // No deposit yet in this story day — the counted cash still sits in the drawer.
  recentDeposits: [],
  registerSessions: [
    closingSession,
    {
      _id: "story-register-session-prev",
      // Closed Tuesday 8:12 PM, before the prior EOD Review completed at 8:40
      // (the completion time visible in the Opening Handoff shot).
      closedAt: storyTime(20, 12) - 86_400_000,
      closedByStaffName: sharedDemoStaffShortName(SHARED_DEMO_STAFF_STORY.manager),
      countedCash: 263_000,
      expectedCash: 263_000,
      openedAt: storyMoments.opening - 86_400_000,
      openedByStaffName: sharedDemoStaffShortName(SHARED_DEMO_STAFF_STORY.cashier),
      openingFloat: drawer.openingFloat,
      registerNumber: demoStore.registerNumber,
      status: "closed",
      terminalName: "Studio Front Counter",
      // No deposit recorded; the counted cash carried straight into the close.
      totalDeposited: 0,
      totalSales: 560_000,
      variance: 0,
    },
  ],
  unresolvedVariances: [closingSession],
};

// ---------------------------------------------------------------------------
// Cash Controls · RegisterSessionViewContent (Register 01, mid-closeout)

// The same session the dashboard shows in review, opened up: the day's sales
// summary and payment mix, the traced sale among the linked transactions, and
// the GH₵5 shortage awaiting judgment. No deposit is recorded yet — the counted
// cash still sits in the drawer.
export const registerSessionSnapshot: RegisterSessionSnapshot = {
  closeoutReview: {
    hasVariance: true,
    reason: null,
    requiresApproval: true,
    variance: drawer.variance,
  },
  deposits: [],
  financialPosition: {
    averageTransaction: Math.round(dayTotals.netSales / dayTotals.transactions),
    // Share of session sales value; sums to 100.
    paymentMix: [
      { method: "mobile_money", share: 49, total: payments.mobileMoney, transactionCount: 15 },
      { method: "cash", share: 28, total: payments.cash, transactionCount: 8 },
      { method: "card", share: 23, total: payments.card, transactionCount: 5 },
    ],
    totalSales: dayTotals.netSales,
    transactionCount: dayTotals.transactions,
  },
  itemsBreakdown: topItems.map((item) => ({
    name: item.name,
    productSku:
      SHARED_DEMO_PRODUCTS.find((product) => product.name === item.name)?.sku ??
      null,
    quantity: item.quantity,
    totalSales: item.total,
  })),
  registerSession: {
    ...closingSession,
    netExpectedCash: drawer.expectedCash,
  },
  // The traced 3:14 PM sale beside the two morning sales the Daily Operations
  // shot's timeline mentions (#1143 and #1149).
  transactions: [
    {
      _id: "story-txn-1154",
      cashierName: sharedDemoStaffShortName(SHARED_DEMO_STAFF_STORY.cashier),
      completedAt: storyMoments.sale,
      itemCount: tracedSale.items.length,
      paymentMethod: "cash",
      status: "completed",
      total: tracedSale.total,
      transactionNumber: tracedSale.receiptNumber,
    },
    {
      _id: "story-txn-1149",
      cashierName: sharedDemoStaffShortName(SHARED_DEMO_STAFF_STORY.cashier),
      completedAt: storyTime(12, 58),
      hasMultiplePaymentMethods: true,
      itemCount: 2,
      status: "completed",
      total: 42_000,
      transactionNumber: "1149",
    },
    {
      _id: "story-txn-1143",
      cashierName: sharedDemoStaffShortName(SHARED_DEMO_STAFF_STORY.cashier),
      completedAt: storyTime(11, 15),
      itemCount: 1,
      paymentMethod: "mobile_money",
      status: "completed",
      total: 18_000,
      transactionNumber: "1143",
    },
  ],
};

// ---------------------------------------------------------------------------
// EOD Review · DailyCloseReadOnlyReport

export const eodSnapshot: DailyCloseSnapshot = {
  blockers: [],
  carryForwardItems: [
    {
      category: "inventory",
      description: "2 left after today's sales; restock before tomorrow's opening.",
      id: "story-carry-kente",
      key: "story-carry-kente",
      severity: "carry_forward",
      statusLabel: "Carried to Opening",
      title: "Kente Scarf running low",
    },
  ],
  completedClose: {
    actorType: "automation",
    automationDecisionReason: "Every end-of-day check passed under store policy.",
    completedAt: storyMoments.close,
    completedByStaffName: null,
  },
  endAt: storyMoments.dayEnd,
  operatingDate: STORY_OPERATING_DATE,
  readiness: {
    blockerCount: 0,
    carryForwardCount: 1,
    readyCount: 3,
    reviewCount: 0,
    status: "ready",
  },
  readyItems: [
    {
      description: `${dayTotals.transactions} transactions · ${dayTotals.itemsSold} items sold.`,
      id: "story-ready-sales",
      key: "story-ready-sales",
      severity: "ready",
      statusLabel: "Reconciled",
      title: "Sales reconciled",
    },
    {
      description: "Counted cash reviewed against expected; variance approved.",
      id: "story-ready-drawer",
      key: "story-ready-drawer",
      severity: "ready",
      statusLabel: "Closed",
      title: `Register ${demoStore.registerNumber} closed`,
    },
    {
      description: `${topItems[0].name} led the day.`,
      id: "story-ready-items",
      key: "story-ready-items",
      severity: "ready",
      statusLabel: "Posted",
      title: "Top items posted",
    },
  ],
  reviewItems: [],
  startAt: storyMoments.dayStart,
  status: "completed",
  summary: {
    cashDeposited: drawer.depositAmount,
    cashExpected: drawer.expectedCash,
    closedRegisterSessionCount: 1,
    currentDayCashTotal: payments.cash,
    currentDayCashTransactionCount: 8,
    expectedCashTotal: drawer.expectedCash,
    netCashVariance: drawer.variance,
    paymentTotals: [
      { amount: payments.cash, method: "cash", transactionCount: 8 },
      { amount: payments.card, method: "card", transactionCount: 5 },
      { amount: payments.mobileMoney, method: "mobile_money", transactionCount: 15 },
    ],
    registerCount: 1,
    salesTotal: dayTotals.netSales,
    totalSales: dayTotals.netSales,
    transactionCount: dayTotals.transactions,
    varianceTotal: drawer.variance,
  },
};
