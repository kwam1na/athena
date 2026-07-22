/**
 * Authored POS-hub data for the shared demo store (Osu Studio, GHS), pinned to
 * the story Wednesday (2026-07-15).
 *
 * The marketing landing renders a **live, interactive** manager pulse from this:
 * the real store-pulse tabs swap `posHubManagerPulseByWindow[window]` so Today /
 * This week / This month / All time each show their own metrics, trend, top
 * items and payment mix. Staff (no financial-details access) only ever see a
 * transaction count for today. Everything reconciles to the story day — today is
 * GH₵6,700 / 28 sales / 51 items; the week-to-date is GH₵23,500 / 97 / 180 (the
 * canon `cachedWeekStorePulse`).
 *
 * Also feeds the dev-only `?fixture=` screenshot route via `usePosHubFixture`.
 */

import {
  buildPosFeatures,
  type PointOfSaleViewContentProps,
} from "@/components/pos/PointOfSaleView";
import type {
  POSStorePulseSummary,
  POSStorePulseWindow,
} from "@/components/pos/sales-pulse/POSSalesPulseView";
import { currencyFormatter } from "@/lib/utils";

import { LINK_PARAMS } from "./operationsFixtureContext";

const WED_OPERATING_DATE = "2026-07-15";

// Mid-afternoon on the story Wednesday, after the traced 3:14 PM sale. Accra
// keeps GMT year-round, so a UTC instant renders as the same wall-clock time on
// any machine.
export const POS_HUB_NOW = new Date(Date.UTC(2026, 6, 15, 15, 20));

// Osu Studio trades in Ghana cedis; match the live formatter exactly (GH₵).
export const posHubCurrencyFormatter = currencyFormatter("GHS");

export const posHubScheduleSummary = {
  context: {
    nextWindow: { localDate: "2026-07-16", localStartLabel: "09:00" },
    timezone: "Africa/Accra",
  },
  schedule: { timezone: "Africa/Accra" },
};

export const posHubManagerFeatures = buildPosFeatures({
  canAccessPOS: true,
  hasFinancialDetailsAccess: true,
  liveLinkParams: LINK_PARAMS,
  posLinkParams: LINK_PARAMS,
  setupRequired: false,
});

export const posHubStaffFeatures = buildPosFeatures({
  canAccessPOS: true,
  hasFinancialDetailsAccess: false,
  liveLinkParams: LINK_PARAMS,
  posLinkParams: LINK_PARAMS,
  setupRequired: false,
});

type TrendSeed = {
  date: string;
  itemsSold: number;
  label: string;
  salesTotal: number;
  transactionCount: number;
};

function buildTrend(seeds: TrendSeed[]) {
  return seeds.map((day) => ({
    averageTransaction: Math.round(day.salesTotal / day.transactionCount),
    date: day.date,
    hasKnownItemCount: true,
    label: day.label,
    totalItemsSold: day.itemsSold,
    totalSales: day.salesTotal,
    transactionCount: day.transactionCount,
  }));
}

// The Today window plots just yesterday → today, matching the live product; the
// axis labels those two points "Yesterday"/"Today".
const todayTrend = buildTrend([
  { date: "2026-07-14", label: "Jul 14", salesTotal: 560000, transactionCount: 23, itemsSold: 43 },
  { date: WED_OPERATING_DATE, label: "Jul 15", salesTotal: 670000, transactionCount: 28, itemsSold: 51 },
]);

// Sunday → the story Wednesday: the elapsed days of the trading week.
const weekTrend = buildTrend([
  { date: "2026-07-12", label: "Jul 12", salesTotal: 640000, transactionCount: 26, itemsSold: 49 },
  { date: "2026-07-13", label: "Jul 13", salesTotal: 480000, transactionCount: 20, itemsSold: 37 },
  { date: "2026-07-14", label: "Jul 14", salesTotal: 560000, transactionCount: 23, itemsSold: 43 },
  { date: WED_OPERATING_DATE, label: "Jul 15", salesTotal: 670000, transactionCount: 28, itemsSold: 51 },
]);

// Jul 1 → the story Wednesday: month-to-date daily points (sum = 86,890 / 361 / 685).
const monthTrend = buildTrend([
  { date: "2026-07-01", label: "Jul 1", salesTotal: 540000, transactionCount: 22, itemsSold: 41 },
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
]);

// Since the store opened (May 12 → the story week), weekly points
// (sum = 367,000 / 1,530 / 2,879).
const allTimeTrend = buildTrend([
  { date: "2026-05-12", label: "May 12", salesTotal: 3600000, transactionCount: 150, itemsSold: 280 },
  { date: "2026-05-19", label: "May 19", salesTotal: 3900000, transactionCount: 163, itemsSold: 305 },
  { date: "2026-05-26", label: "May 26", salesTotal: 4050000, transactionCount: 169, itemsSold: 318 },
  { date: "2026-06-02", label: "Jun 2", salesTotal: 4200000, transactionCount: 175, itemsSold: 330 },
  { date: "2026-06-09", label: "Jun 9", salesTotal: 3950000, transactionCount: 165, itemsSold: 310 },
  { date: "2026-06-16", label: "Jun 16", salesTotal: 4300000, transactionCount: 179, itemsSold: 338 },
  { date: "2026-06-23", label: "Jun 23", salesTotal: 4450000, transactionCount: 185, itemsSold: 350 },
  { date: "2026-06-30", label: "Jun 30", salesTotal: 4100000, transactionCount: 171, itemsSold: 322 },
  { date: "2026-07-07", label: "Jul 7", salesTotal: 4150000, transactionCount: 173, itemsSold: 326 },
]);

const todaySummary: POSStorePulseSummary = {
  averageTransaction: 23929,
  date: WED_OPERATING_DATE,
  operatorSnapshot: {
    busiestHour: { hour: 12, label: "12 – 1 PM", totalSales: 148000, transactionCount: 7 },
    comparison: {
      // Deltas are pre-rounded to whole percents, matching how Daily Operations
      // renders them (getDeltaPercent → Math.round).
      averageTransactionDeltaPercent: -2,
      currentAverageTransaction: 23929,
      currentItemsSold: 51,
      currentSales: 670000,
      currentTransactions: 28,
      itemsSoldDeltaPercent: 19,
      salesDeltaPercent: 20,
      transactionDeltaPercent: 22,
      yesterdayAverageTransaction: 24348,
      yesterdayItemsSold: 43,
      yesterdaySales: 560000,
      yesterdayTransactions: 23,
    },
    historyDays: 14,
    isLimited: false,
    paymentMix: [
      { count: 15, label: "Mobile money", method: "mobile_money", share: 0.536, total: 330000 },
      { count: 8, label: "Cash", method: "cash", share: 0.286, total: 190000 },
      { count: 5, label: "Card", method: "card", share: 0.178, total: 150000 },
    ],
    // Order matches Daily Operations' today top-items exactly (Batik above
    // Hibiscus), so the two surfaces agree for the story day.
    topItems: [
      { name: "Kente Scarf", productSku: "FM5W-8QJ-4K7", quantity: 4, totalSales: 140000 },
      { name: "Bolga Woven Basket", productSku: "FM5W-6BX-5W1", quantity: 5, totalSales: 110000 },
      { name: "Batik Tote Bag", productSku: "FM5W-5K4-9T2", quantity: 4, totalSales: 72000 },
      { name: "Hibiscus Soy Candle", productSku: "FM5W-2MP-7F4", quantity: 7, totalSales: 84000 },
      { name: "Raw Shea Butter 250g", productSku: "FM5W-7K2-3Q9", quantity: 11, totalSales: 66000 },
    ],
    trend: todayTrend,
    usableHistoryDays: 14,
  },
  totalItemsSold: 51,
  totalSales: 670000,
  totalTransactions: 28,
};

const weekSummary: POSStorePulseSummary = {
  averageTransaction: 24227,
  date: WED_OPERATING_DATE,
  operatorSnapshot: {
    busiestHour: { hour: 12, label: "12 – 1 PM", totalSales: 512000, transactionCount: 23 },
    comparison: {
      averageTransactionDeltaPercent: 1,
      currentAverageTransaction: 24227,
      currentItemsSold: 180,
      currentSales: 2350000,
      currentTransactions: 97,
      itemsSoldDeltaPercent: 8,
      salesDeltaPercent: 12,
      transactionDeltaPercent: 11,
      yesterdayAverageTransaction: 24069,
      yesterdayItemsSold: 167,
      yesterdaySales: 2094000,
      yesterdayTransactions: 87,
    },
    historyDays: 14,
    isLimited: false,
    paymentMix: [
      { count: 52, label: "Mobile money", method: "mobile_money", share: 0.536, total: 1255000 },
      { count: 28, label: "Cash", method: "cash", share: 0.289, total: 665000 },
      { count: 17, label: "Card", method: "card", share: 0.175, total: 430000 },
    ],
    topItems: [
      { name: "Kente Scarf", productSku: "FM5W-8QJ-4K7", quantity: 14, totalSales: 490000 },
      { name: "Bolga Woven Basket", productSku: "FM5W-6BX-5W1", quantity: 17, totalSales: 374000 },
      { name: "Hibiscus Soy Candle", productSku: "FM5W-2MP-7F4", quantity: 24, totalSales: 288000 },
      { name: "Batik Tote Bag", productSku: "FM5W-5K4-9T2", quantity: 14, totalSales: 252000 },
      { name: "Raw Shea Butter 250g", productSku: "FM5W-7K2-3Q9", quantity: 38, totalSales: 228000 },
    ],
    trend: weekTrend,
    usableHistoryDays: 14,
  },
  totalItemsSold: 180,
  totalSales: 2350000,
  totalTransactions: 97,
};

const monthSummary: POSStorePulseSummary = {
  averageTransaction: 24070,
  date: WED_OPERATING_DATE,
  operatorSnapshot: {
    busiestHour: { hour: 13, label: "1 – 2 PM", totalSales: 1180000, transactionCount: 52 },
    comparison: {
      averageTransactionDeltaPercent: 1,
      currentAverageTransaction: 24070,
      currentItemsSold: 685,
      currentSales: 8689000,
      currentTransactions: 361,
      itemsSoldDeltaPercent: 10,
      salesDeltaPercent: 10,
      transactionDeltaPercent: 9,
      yesterdayAverageTransaction: 23939,
      yesterdayItemsSold: 620,
      yesterdaySales: 7900000,
      yesterdayTransactions: 330,
    },
    historyDays: 15,
    isLimited: false,
    paymentMix: [
      { count: 193, label: "Mobile money", method: "mobile_money", share: 0.535, total: 4650000 },
      { count: 103, label: "Cash", method: "cash", share: 0.285, total: 2480000 },
      { count: 65, label: "Card", method: "card", share: 0.180, total: 1559000 },
    ],
    topItems: [
      { name: "Kente Scarf", productSku: "FM5W-8QJ-4K7", quantity: 52, totalSales: 1820000 },
      { name: "Bolga Woven Basket", productSku: "FM5W-6BX-5W1", quantity: 63, totalSales: 1386000 },
      { name: "Hibiscus Soy Candle", productSku: "FM5W-2MP-7F4", quantity: 89, totalSales: 1068000 },
      { name: "Batik Tote Bag", productSku: "FM5W-5K4-9T2", quantity: 51, totalSales: 918000 },
      { name: "Raw Shea Butter 250g", productSku: "FM5W-7K2-3Q9", quantity: 141, totalSales: 846000 },
    ],
    trend: monthTrend,
    usableHistoryDays: 15,
  },
  totalItemsSold: 685,
  totalSales: 8689000,
  totalTransactions: 361,
};

const allTimeSummary: POSStorePulseSummary = {
  averageTransaction: 23987,
  date: WED_OPERATING_DATE,
  operatorSnapshot: {
    // All-time has no prior period, so the pulse hides comparisons; this object
    // is required by the type but never rendered for the all-time window.
    busiestHour: { hour: 13, label: "1 – 2 PM", totalSales: 4900000, transactionCount: 218 },
    comparison: {
      averageTransactionDeltaPercent: 0,
      currentAverageTransaction: 23987,
      currentItemsSold: 2879,
      currentSales: 36700000,
      currentTransactions: 1530,
      itemsSoldDeltaPercent: 0,
      salesDeltaPercent: 0,
      transactionDeltaPercent: 0,
      yesterdayAverageTransaction: 0,
      yesterdayItemsSold: 0,
      yesterdaySales: 0,
      yesterdayTransactions: 0,
    },
    historyDays: 64,
    isLimited: false,
    paymentMix: [
      { count: 819, label: "Mobile money", method: "mobile_money", share: 0.535, total: 19650000 },
      { count: 436, label: "Cash", method: "cash", share: 0.285, total: 10450000 },
      { count: 275, label: "Card", method: "card", share: 0.180, total: 6600000 },
    ],
    topItems: [
      { name: "Kente Scarf", productSku: "FM5W-8QJ-4K7", quantity: 220, totalSales: 7700000 },
      { name: "Bolga Woven Basket", productSku: "FM5W-6BX-5W1", quantity: 266, totalSales: 5852000 },
      { name: "Hibiscus Soy Candle", productSku: "FM5W-2MP-7F4", quantity: 376, totalSales: 4512000 },
      { name: "Batik Tote Bag", productSku: "FM5W-5K4-9T2", quantity: 216, totalSales: 3888000 },
      { name: "Raw Shea Butter 250g", productSku: "FM5W-7K2-3Q9", quantity: 597, totalSales: 3582000 },
    ],
    trend: allTimeTrend,
    usableHistoryDays: 64,
  },
  totalItemsSold: 2879,
  totalSales: 36700000,
  totalTransactions: 1530,
};

export const posHubManagerPulseByWindow: Record<
  POSStorePulseWindow,
  POSStorePulseSummary
> = {
  all_time: allTimeSummary,
  this_month: monthSummary,
  this_week: weekSummary,
  today: todaySummary,
};

// Staff can't change the window; their pulse always reads today, and only the
// transaction count is exposed.
export const posHubStaffSummary = todaySummary;

// --- Dev-only screenshot registry (`?fixture=` route via usePosHubFixture) ---

type PosHubFixtureEntry = { clock: Date; props: PointOfSaleViewContentProps };

const sharedProps = {
  currencyFormatter: posHubCurrencyFormatter,
  nowOverride: POS_HUB_NOW,
  onPulseWindowChange: () => {},
  scheduleSummary: posHubScheduleSummary,
};

export const posHubFixtures: Record<string, PosHubFixtureEntry> = {
  "wednesday-hub-manager": {
    clock: POS_HUB_NOW,
    props: {
      ...sharedProps,
      hasFullAdminAccess: true,
      posFeatures: posHubManagerFeatures,
      pulseWindow: "this_week",
      todaySummary: weekSummary,
    },
  },
  "wednesday-hub-staff": {
    clock: POS_HUB_NOW,
    props: {
      ...sharedProps,
      hasFullAdminAccess: false,
      posFeatures: posHubStaffFeatures,
      pulseWindow: "today",
      todaySummary: todaySummary,
    },
  },
};

export type PosHubFixtureName = keyof typeof posHubFixtures;
