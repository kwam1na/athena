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
  KENTE_CARRY_FORWARD,
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

/** When the Kente inventory review became actionable. Matches the opening handoff
 * fixture: the review carried from Friday evening's close (Jul 17, 7:15 PM), so the
 * Saturday close shows the same "Open since" instead of a same-day birth. */
const KENTE_OPEN_SINCE = new Date(2026, 6, 17, 19, 15).getTime();

/**
 * The Kente scarf carried into tomorrow's opening — the same thread the Daily Operations
 * timeline flagged and the Opening Handoff fixture acknowledges.
 *
 * A synced-sale inventory review with a product SKU projects as a single-member logical
 * work group, so this follows the group branch of `logicalGroupAsCarryForwardItem` in
 * convex/operations/dailyClose.ts: `subject.type` is `logical_operational_work_group`,
 * `category` is "open_work", and the metadata carries `oldestActionableAt`. EOD Review
 * renders that as "Open since" and shows only priority / open-since / work type — no
 * status, no link, no description, no `statusLabel`.
 */
const carryForwardItems: DailyCloseItem[] = [
  {
    // Real group items carry their member work-item ids (dailyClose.ts builds
    // `carryForwardWorkItemIds` from the group members); the id is what makes
    // the row selectable, so the workspace renders its carry-forward checkbox
    // — checked by default, matching the product.
    carryForwardWorkItemIds: ["woi-kente-inventory-review"],
    category: "open_work",
    id: `logical_operational_work:${KENTE_CARRY_FORWARD.groupKey}:carry_forward`,
    key: `logical_operational_work:${KENTE_CARRY_FORWARD.groupKey}:carry_forward`,
    message:
      "Open operational work will carry forward after the end of day review.",
    // memberCount / sourceCount are group-internal; the workspace filters them out of the
    // row (they are not operator-facing). Kept here as real snapshot data.
    metadata: {
      memberCount: 1,
      oldestActionableAt: KENTE_OPEN_SINCE,
      priority: KENTE_CARRY_FORWARD.priority,
      sourceCount: 1,
      status: KENTE_CARRY_FORWARD.status,
      type: KENTE_CARRY_FORWARD.workItemType,
    },
    severity: "carry_forward",
    subject: {
      id: KENTE_CARRY_FORWARD.groupKey,
      label: KENTE_CARRY_FORWARD.title,
      type: "logical_operational_work_group",
    },
    title: KENTE_CARRY_FORWARD.title,
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

// ---------------------------------------------------------------------------
// Wednesday evening — the close for the mid-week day the hero, Opening Handoff,
// and Daily Operations fixtures tell. Totals match `busy-wednesday`: net GH₵6,700
// across 28 sales (cash GH₵1,900, mobile money GH₵3,300, card GH₵1,500), with the
// Kente carry-forward heading into tomorrow's opening. Self-contained dates so it
// doesn't repurpose the shared Saturday story.
// ---------------------------------------------------------------------------

const WED_OPERATING_DATE = "2026-07-15";
const WED_DAY_START = new Date(2026, 6, 15, 0, 0).getTime();
const WED_DAY_END = new Date(2026, 6, 16, 0, 0).getTime();

/** Evening, after the register is counted and the day is ready to review. */
export const WEDNESDAY_READY_TO_CLOSE_CLOCK = new Date(2026, 6, 15, 20, 30);

const WED_OPENING_FLOAT = 50000;
const WED_CASH_TOTAL = 190000;
const WED_EXPECTED_CASH = WED_OPENING_FLOAT + WED_CASH_TOTAL;
const WED_CASH_VARIANCE = -500;
const WED_CASH_DEPOSITED = 200000;
/** When the Kente inventory review became actionable. Matches the Wednesday opening
 * handoff fixture: the review was born at Tuesday's close (Jul 14, 7:15 PM) and carried
 * through the opening, so the close shows the same "Open since". The 11:47 AM Daily
 * Operations stock alert is a later event on the same item, not its start. */
const WED_KENTE_OPEN_SINCE = new Date(2026, 6, 14, 19, 15).getTime();

const wednesdayReadyItems: DailyCloseItem[] = [
  {
    category: "register_session",
    id: "register_session:session-9847:closed",
    key: "register_session:session-9847:closed",
    message: "Closed register session is included in the end of day review.",
    severity: "ready",
    statusLabel: "Closed",
    subject: {
      id: "session-9847",
      label: REGISTER_DISPLAY_LABEL,
      type: "register_session",
    },
    title: "Register session closed",
  },
  {
    category: "completed_sale",
    id: "pos_transaction:txn-1149:completed",
    key: "pos_transaction:txn-1149:completed",
    link: {
      label: "View transaction",
      params: LINK_PARAMS,
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/txn-1149",
    },
    message: "Completed sale is included in the end of day review.",
    severity: "ready",
    subject: { id: "txn-1149", label: "#1149", type: "pos_transaction" },
    title: "Completed sale",
  },
  {
    category: "completed_sale",
    id: "pos_transaction:txn-1143:completed",
    key: "pos_transaction:txn-1143:completed",
    link: {
      label: "View transaction",
      params: LINK_PARAMS,
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/txn-1143",
    },
    message: "Completed sale is included in the end of day review.",
    severity: "ready",
    subject: { id: "txn-1143", label: "#1143", type: "pos_transaction" },
    title: "Completed sale",
  },
];

const wednesdayCarryForwardItems: DailyCloseItem[] = [
  {
    // Member work-item ids make the row selectable, so the workspace renders
    // its carry-forward checkbox — checked by default, matching the product.
    carryForwardWorkItemIds: ["woi-kente-inventory-review"],
    category: "open_work",
    id: `logical_operational_work:${KENTE_CARRY_FORWARD.groupKey}:carry_forward`,
    key: `logical_operational_work:${KENTE_CARRY_FORWARD.groupKey}:carry_forward`,
    message:
      "Open operational work will carry forward after the end of day review.",
    metadata: {
      memberCount: 1,
      oldestActionableAt: WED_KENTE_OPEN_SINCE,
      priority: KENTE_CARRY_FORWARD.priority,
      sourceCount: 1,
      status: KENTE_CARRY_FORWARD.status,
      type: KENTE_CARRY_FORWARD.workItemType,
    },
    severity: "carry_forward",
    subject: {
      id: KENTE_CARRY_FORWARD.groupKey,
      label: KENTE_CARRY_FORWARD.title,
      type: "logical_operational_work_group",
    },
    title: KENTE_CARRY_FORWARD.title,
  },
];

export const wednesdayReadyToCloseFixture: DailyCloseViewContentProps = {
  canViewSummaryComparisons: true,
  currency: "GHS",
  hasFinancialDetailsAccess: true,
  hasFullAdminAccess: true,
  isAuthenticated: true,
  isCompleting: false,
  isLoadingAccess: false,
  isLoadingSnapshot: false,
  latestSelectableOperatingDate: WEDNESDAY_READY_TO_CLOSE_CLOCK,
  onComplete: async () => ({ data: undefined, kind: "ok" }),
  onOperatingDateChange: () => {},
  orgUrlSlug: ORG_URL_SLUG,
  storeId: STORE_ID,
  storeUrlSlug: STORE_URL_SLUG,
  snapshot: {
    blockers: [],
    carryForwardItems: wednesdayCarryForwardItems,
    endAt: WED_DAY_END,
    operatingDate: WED_OPERATING_DATE,
    readiness: {
      blockerCount: 0,
      carryForwardCount: 1,
      readyCount: wednesdayReadyItems.length,
      reviewCount: 0,
      status: "ready",
    },
    readyItems: wednesdayReadyItems,
    reviewItems: [],
    startAt: WED_DAY_START,
    // Tuesday 2026-07-14, matching the Daily Operations week fixture, so the tiles
    // show a day-over-day comparison instead of "No activity yesterday".
    priorDaySummary: {
      currentDayCashTotal: 213000,
      currentDayCashTransactionCount: 9,
      paymentTotals: [
        { amount: 213000, method: "cash", transactionCount: 9 },
        { amount: 237000, method: "mobile_money", transactionCount: 10 },
        { amount: 110000, method: "card", transactionCount: 4 },
      ],
      registerCount: 1,
      salesTotal: 560000,
      totalSales: 560000,
      transactionCount: 23,
    },
    summary: {
      cashDeposited: WED_CASH_DEPOSITED,
      cashExpected: WED_EXPECTED_CASH,
      closedRegisterSessionCount: 1,
      currentDayCashTotal: WED_CASH_TOTAL,
      currentDayCashTransactionCount: 8,
      expectedCashTotal: WED_EXPECTED_CASH,
      netCashVariance: WED_CASH_VARIANCE,
      paymentTotals: [
        { amount: WED_CASH_TOTAL, method: "cash", transactionCount: 8 },
        { amount: 330000, method: "mobile_money", transactionCount: 15 },
        { amount: 150000, method: "card", transactionCount: 5 },
      ],
      registerCount: 1,
      registerVarianceCount: 1,
      salesTotal: 670000,
      totalSales: 670000,
      transactionCount: 28,
      varianceTotal: WED_CASH_VARIANCE,
    },
  },
};

export const eodReviewFixtures = {
  "ready-to-close": {
    clock: READY_TO_CLOSE_CLOCK,
    props: readyToCloseFixture,
  },
  "wednesday-close": {
    clock: WEDNESDAY_READY_TO_CLOSE_CLOCK,
    props: wednesdayReadyToCloseFixture,
  },
} as const;

export type EodReviewFixtureName = keyof typeof eodReviewFixtures;
