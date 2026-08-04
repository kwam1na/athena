/**
 * Client-side Reports fixtures for the shared demo store.
 *
 * ## Single source of truth
 *
 * Every number this module returns is DERIVED, never seeded. The chain is:
 *
 *   sharedDemoOperationsFixture (`getSharedDemoHistoricalDayFixture`)
 *     -> sharedDemoTransactionsFixture (`createSharedDemoTransactionFixtures`)
 *       -> this module
 *
 * The transactions fixture already reconciles line-for-line to each day's
 * `salesTotal`, `transactionCount`, `totalItemsSold`, and `paymentTotals`, so
 * folding its completed transactions back up reproduces the Operations day
 * exactly. There is deliberately NO second sales table here: if Reports and
 * Operations could disagree for the same date, the demo would contradict
 * itself in front of a prospect.
 *
 * Cost basis comes from `unitCost` on `SHARED_DEMO_PRODUCTS` (minor units,
 * pesewas — like every other amount in this file). Nothing else in the demo
 * consumes `unitCost`; merchandise margin is exactly what it exists for.
 * Gross profit is `null`, never `0`, whenever a contributing revenue line has
 * no resolvable cost basis, and the uncovered revenue is disclosed in
 * `uncostedRevenueMinor`. Every shared-demo SKU currently carries a unit cost,
 * so in practice the demo's margin is always fully covered — the null path is
 * the guard for a catalogue line that ever stops resolving.
 *
 * ## Weekly: what is deliberately ABSENT, and why
 *
 * `createSharedDemoWeeklyBriefing` returns a LIVE week-to-date projection only:
 * `{ status: "available", current, acceptedBaseline: null }` with
 * `lifecyclePosture: "live"` and `amendmentPosture: "none"`.
 *
 * These fields are never emitted:
 *   - `acceptedBaseline` (always `null`), and therefore `acceptedAt`,
 *     `cutoffObservedAt`, `closeId`, and `reportId`
 *   - `closePosture`
 *   - `amendment`
 *
 * They are all earned server-side from an accepted register close and an
 * observed-at cutoff. A browser fixture has no close to accept and no cutoff to
 * observe, so minting them would misrepresent the product: an operator would be
 * shown an "accepted baseline" that no close ever produced. Everything a client
 * CAN honestly derive from the shared history is populated: both lane metrics
 * and summaries, `scheduleLineage`, `completeness`, `inventoryAttention`,
 * `priorPeriod`, `variancePosture`, and `ownerRoutes`.
 *
 * The demo store trades Monday–Saturday: the shared history forces Sunday sales
 * to zero. Sunday is therefore reported as OUTSIDE the schedule rather than as a
 * scheduled day that happened to sell nothing.
 */

import {
  getLocalOperatingDate,
  getLocalDateFromOperatingDate,
} from "@/lib/operations/operatingDate";
import {
  addWeekMetrics,
  combineWeekCompleteness,
  isReportingTodayInProgress,
  movementAbsNetUnitsSortKey,
  movementPageCount,
  REPORT_MOVEMENT_PAGE_SIZE,
  REPORT_SKU_PAGE_SIZE,
  REPORTS_FOLD_VERSION,
  trailingThreeMonthsStart,
  type ReportDayMetrics,
  type ReportDayRow,
  type ReportDayStatus,
  type ReportMovementLifecycle,
  type ReportMovementTotals,
  type ReportOverviewData,
  type ReportPeriodSnapshot,
  type ReportSkuDayMetrics,
  type ReportSkuIdentity,
  type ReportSkuMixData,
  type ReportSkuMovementData,
  type ReportSkuMovementRow,
  type ReportSkuPeriodRow,
  type ReportSkuSortBy,
  type ReportSkuTransactionEvidence,
  type ReportTrendPoint,
  type ReportWeekBriefing,
  type ReportWeekCompleteness,
  type ReportWeekInventoryAttention,
  type ReportWeekLineage,
  type ReportWeekMetrics,
  type ReportWeekOwnerRoutes,
  type ReportWeekPriorPeriod,
  type ReportWeekSummary,
  type ReportWeekVariancePosture,
} from "~/shared/reportsContract";
import {
  SHARED_DEMO_PRODUCTS,
  SHARED_DEMO_STORE_IDENTITY,
  type SharedDemoProductStory,
} from "~/shared/sharedDemoStory";
import {
  getSharedDemoHistoricalDayFixture,
  getSharedDemoHistoryStartOperatingDate,
  SHARED_DEMO_HISTORY_DAYS,
} from "./sharedDemoOperationsFixture";
import {
  createSharedDemoTransactionFixtures,
  type SharedDemoTransactionFixture,
} from "./sharedDemoTransactionsFixture";

/** Demo SKU ids are `shared-demo-sku-${slug}` — see the transactions fixture. */
export const SHARED_DEMO_REPORTS_SKU_ID_PREFIX = "shared-demo-sku-";

const SHARED_DEMO_PRODUCT_ID_PREFIX = "shared-demo-product-";
const SHARED_DEMO_SCHEDULE_VERSION_ID = "shared-demo-schedule-v1";
const SHARED_DEMO_CURRENCY = SHARED_DEMO_STORE_IDENTITY.currency;

/** Mirrors the server's `RANGE_SKU_MIX_VISIBLE_LIMIT`. */
const SKU_MIX_VISIBLE_LIMIT = 5;
/** Mirrors the server's `SKU_DAY_EVIDENCE_FACT_LIMIT`. */
const SKU_DAY_EVIDENCE_LIMIT = 500;
const OVERVIEW_TREND_DAYS = 30;
const CURSOR_VERSION = 1;

// ---------------------------------------------------------------------------
// Result shapes declared inline on the server queries
// ---------------------------------------------------------------------------

/** Matches `convex/reports/queries.ts` `listPeriodSkus`. */
export type SharedDemoPeriodSkusResult = {
  rows: ReportSkuPeriodRow[];
  continueCursor: string | null;
  totalNetSalesMinor: number;
  totalUnitsSold: number;
  totalTransactions: number;
  priorPeriodTotals: {
    netSalesMinor: number;
    unitsSold: number;
    transactions: number;
  };
  updatedAt: number | null;
  isTodayInProgress: boolean;
};

/** Matches `convex/reports/queries.ts` `getSkuDetail`. */
export type SharedDemoSkuDetailResult = {
  days: (ReportSkuPeriodRow & { operatingDate: string })[];
  totals: ReportSkuPeriodRow | null;
  priorPeriodTotals: ReportSkuPeriodRow | null;
  identity?: ReportSkuIdentity;
};

// ---------------------------------------------------------------------------
// Operating-date arithmetic over calendar labels
//
// Reimplemented from `convex/reports/rollups.ts` (`addDaysToDate`,
// `isoWeekStart`, `periodDateRange`) rather than imported: that module is a
// Convex server module, and client source may not reach into one — the
// browser-boundary test enforces it. Operating dates are calendar labels, so
// UTC math over the label is correct by construction and no store timezone
// enters here, exactly as the server module documents.
// ---------------------------------------------------------------------------

function toUtcDate(operatingDate: string): Date {
  return new Date(`${operatingDate}T00:00:00.000Z`);
}

function addDaysToDate(operatingDate: string, days: number): string {
  const date = toUtcDate(operatingDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Monday (ISO weekday 1) of the ISO week containing `operatingDate`. */
function isoWeekStart(operatingDate: string): string {
  const isoDay = toUtcDate(operatingDate).getUTCDay() || 7;
  return addDaysToDate(operatingDate, 1 - isoDay);
}

/**
 * Inclusive range covered by a calendar period key
 * ("d:2026-07-28" | "w:2026-W31" | "m:2026-07"). Null for anything else — a
 * period key arrives from route search and is never trusted.
 */
function periodDateRange(
  periodKey: string,
): { startDate: string; endDate: string } | null {
  const body = periodKey.slice(2);

  if (periodKey.startsWith("d:")) {
    return /^\d{4}-\d{2}-\d{2}$/.test(body)
      ? { startDate: body, endDate: body }
      : null;
  }

  if (periodKey.startsWith("m:")) {
    const [yearRaw, monthRaw] = body.split("-");
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    // Day 0 of the next month is the last day of this one.
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      startDate: `${body}-01`,
      endDate: `${body}-${String(lastDay).padStart(2, "0")}`,
    };
  }

  if (periodKey.startsWith("w:")) {
    const [yearRaw, weekRaw] = body.split("-W");
    const year = Number(yearRaw);
    const week = Number(weekRaw);
    if (!Number.isFinite(year) || !Number.isFinite(week)) return null;
    // ISO-8601: January 4th always falls in week 1.
    const startDate = addDaysToDate(
      isoWeekStart(`${yearRaw}-01-04`),
      (week - 1) * 7,
    );
    return { startDate, endDate: addDaysToDate(startDate, 6) };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Catalogue lookups that never throw
// ---------------------------------------------------------------------------

/**
 * Whether an id could name a shared-demo SKU.
 *
 * Route search params reach these fixtures unvalidated, and
 * `sharedDemoProductBySku`/`BySlug` THROW on a miss — so no arbitrary URL value
 * is ever handed to them. This prefix test is the gate, and
 * `demoProductForSkuId` is the non-throwing resolver behind it.
 */
export function isSharedDemoReportsSkuId(id: string): boolean {
  return (
    typeof id === "string" && id.startsWith(SHARED_DEMO_REPORTS_SKU_ID_PREFIX)
  );
}

function demoProductForSkuId(
  productSkuId: string,
): SharedDemoProductStory | undefined {
  if (!isSharedDemoReportsSkuId(productSkuId)) return undefined;
  const slug = productSkuId.slice(SHARED_DEMO_REPORTS_SKU_ID_PREFIX.length);
  return SHARED_DEMO_PRODUCTS.find((product) => product.slug === slug);
}

// ---------------------------------------------------------------------------
// Guarded arithmetic
//
// Sundays sell nothing and "today" is always empty in the shared history, so
// every ratio here can legitimately divide by zero. These mirror the guards in
// `sharedDemoOperationsFixture` (`averageTransaction`, `percentageChange`),
// which are module-private there and so cannot be imported.
// ---------------------------------------------------------------------------

/** Relative change in basis points; null when the prior period is zero. */
function changeBasisPoints(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return Math.round(((current - prior) / Math.abs(prior)) * 10_000);
}

/** Share of a total in basis points; zero when the total is zero. */
function shareBasisPoints(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 10_000);
}

function zeroDayMetrics(): ReportDayMetrics {
  return {
    grossSalesMinor: 0,
    netSalesMinor: 0,
    refundsMinor: 0,
    unitsSold: 0,
    unitsReturned: 0,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 0,
    paymentsCollectedMinor: 0,
    paymentsRefundedMinor: 0,
    paymentAllocatedMinor: 0,
  };
}

function zeroSkuMetrics(): ReportSkuDayMetrics {
  return {
    unitsSold: 0,
    unitsReturned: 0,
    grossSalesMinor: 0,
    netSalesMinor: 0,
    refundsMinor: 0,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 0,
  };
}

// ---------------------------------------------------------------------------
// The derived model — one aggregation pass per `today`, cached
// ---------------------------------------------------------------------------

type SharedDemoReportsDay = {
  operatingDate: string;
  status: ReportDayStatus;
  transactionCount: number;
  factCount: number;
  hasInventoryReview: boolean;
  metrics: ReportDayMetrics;
  skus: Map<string, ReportSkuDayMetrics>;
};

type SharedDemoReportsModel = {
  today: string;
  updatedAt: number;
  /** History start through today inclusive, ascending. */
  orderedDates: string[];
  days: Map<string, SharedDemoReportsDay>;
  transactionsByDate: Map<string, SharedDemoTransactionFixture[]>;
  imageBySkuId: Map<string, string>;
};

/**
 * Views re-render on every search-param change and this folds 21 days x 8 SKUs,
 * so the model is built once per `today` — the same idiom as
 * `transactionFixtureCache` in the transactions fixture.
 */
const reportsFixtureCache = new Map<string, SharedDemoReportsModel>();

function operatingDateForTimestamp(timestamp: number): string {
  return getLocalOperatingDate(new Date(timestamp));
}

function buildDay(
  operatingDate: string,
  today: string,
  transactions: SharedDemoTransactionFixture[],
): SharedDemoReportsDay {
  const dayFixture = getSharedDemoHistoricalDayFixture(operatingDate, today);
  const metrics = zeroDayMetrics();
  const skus = new Map<string, ReportSkuDayMetrics>();
  let costMinor: number | null = 0;
  let factCount = 0;
  let transactionCount = 0;

  for (const transaction of transactions) {
    // Voids are evidence, not revenue: the Operations day excludes the voided
    // sale from `salesTotal`, so recognising it here would break reconciliation.
    if (transaction.status !== "completed") {
      factCount += 1;
      continue;
    }

    transactionCount += 1;
    // One payment fact per completed transaction, plus one sale fact per line.
    factCount += 1 + transaction.items.length;
    metrics.paymentsCollectedMinor += transaction.total;
    metrics.paymentAllocatedMinor += transaction.total;

    for (const item of transaction.items) {
      const product = demoProductForSkuId(item.productSkuId);
      const lineCostMinor = product
        ? product.unitCost * item.quantity
        : null;

      metrics.grossSalesMinor += item.totalPrice;
      metrics.netSalesMinor += item.totalPrice;
      metrics.unitsSold += item.quantity;
      if (lineCostMinor === null) {
        metrics.uncostedRevenueMinor += item.totalPrice;
        costMinor = null;
      } else if (costMinor !== null) {
        costMinor += lineCostMinor;
      }

      const sku = skus.get(item.productSkuId) ?? zeroSkuMetrics();
      sku.grossSalesMinor += item.totalPrice;
      sku.netSalesMinor += item.totalPrice;
      sku.unitsSold += item.quantity;
      if (lineCostMinor === null) {
        sku.uncostedRevenueMinor += item.totalPrice;
        sku.grossProfitMinor = null;
      } else if (sku.grossProfitMinor !== null) {
        sku.grossProfitMinor += item.totalPrice - lineCostMinor;
      }
      skus.set(item.productSkuId, sku);
    }
  }

  metrics.grossProfitMinor =
    costMinor === null ? null : metrics.netSalesMinor - costMinor;

  return {
    operatingDate,
    // The current operating day stays `open` until rollover advances it; every
    // fixture day behind it was closed by the demo's automated EOD Review.
    status: operatingDate < today ? "reconciled" : "open",
    transactionCount,
    factCount,
    hasInventoryReview: dayFixture?.hasInventoryReview ?? false,
    metrics,
    skus,
  };
}

function buildModel(today: string): SharedDemoReportsModel {
  const transactions = createSharedDemoTransactionFixtures(today);
  const transactionsByDate = new Map<string, SharedDemoTransactionFixture[]>();
  const imageBySkuId = new Map<string, string>();
  let updatedAt = 0;

  for (const transaction of transactions) {
    const operatingDate = operatingDateForTimestamp(transaction.completedAt);
    const bucket = transactionsByDate.get(operatingDate);
    if (bucket) bucket.push(transaction);
    else transactionsByDate.set(operatingDate, [transaction]);
    updatedAt = Math.max(updatedAt, transaction.completedAt);
    for (const item of transaction.items) {
      if (!imageBySkuId.has(item.productSkuId)) {
        imageBySkuId.set(item.productSkuId, item.image);
      }
    }
  }

  const historyStart = getSharedDemoHistoryStartOperatingDate(today);
  const orderedDates = Array.from(
    // The history window plus the still-open current day.
    { length: SHARED_DEMO_HISTORY_DAYS + 1 },
    (_, index) => addDaysToDate(historyStart, index),
  );
  const days = new Map<string, SharedDemoReportsDay>();
  for (const operatingDate of orderedDates) {
    days.set(
      operatingDate,
      buildDay(
        operatingDate,
        today,
        transactionsByDate.get(operatingDate) ?? [],
      ),
    );
  }

  return {
    today,
    // The freshest thing reporting has seen: the last recorded sale. A demo day
    // with no history at all falls back to the start of the current day.
    updatedAt:
      updatedAt || (getLocalDateFromOperatingDate(today)?.getTime() ?? 0),
    orderedDates,
    days,
    transactionsByDate,
    imageBySkuId,
  };
}

function getModel(today: string): SharedDemoReportsModel {
  const cached = reportsFixtureCache.get(today);
  if (cached) return cached;
  const model = buildModel(today);
  reportsFixtureCache.set(today, model);
  return model;
}

/** Days on record inside an inclusive range, ascending. Never throws. */
function daysInRange(
  model: SharedDemoReportsModel,
  startDate: string,
  endDate: string,
): SharedDemoReportsDay[] {
  if (startDate > endDate) return [];
  return model.orderedDates
    .filter((date) => date >= startDate && date <= endDate)
    .map((date) => model.days.get(date)!)
    .filter((day): day is SharedDemoReportsDay => Boolean(day));
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function snapshotForDays(days: SharedDemoReportsDay[]): ReportPeriodSnapshot {
  const snapshot: ReportPeriodSnapshot = {
    ...zeroDayMetrics(),
    dayCount: 0,
    unsettledDayCount: 0,
  };
  let grossProfitMinor: number | null = 0;

  for (const day of days) {
    snapshot.grossSalesMinor += day.metrics.grossSalesMinor;
    snapshot.netSalesMinor += day.metrics.netSalesMinor;
    snapshot.refundsMinor += day.metrics.refundsMinor;
    snapshot.unitsSold += day.metrics.unitsSold;
    snapshot.unitsReturned += day.metrics.unitsReturned;
    snapshot.uncostedRevenueMinor += day.metrics.uncostedRevenueMinor;
    snapshot.paymentsCollectedMinor += day.metrics.paymentsCollectedMinor;
    snapshot.paymentsRefundedMinor += day.metrics.paymentsRefundedMinor;
    snapshot.paymentAllocatedMinor += day.metrics.paymentAllocatedMinor;
    // A partial sum would read as a real margin.
    grossProfitMinor =
      grossProfitMinor === null || day.metrics.grossProfitMinor === null
        ? null
        : grossProfitMinor + day.metrics.grossProfitMinor;
    snapshot.dayCount += 1;
    if (day.status === "open" || day.status === "provisional") {
      snapshot.unsettledDayCount += 1;
    }
  }

  snapshot.grossProfitMinor = grossProfitMinor;
  return snapshot;
}

export function createSharedDemoReportsOverview(
  today = getLocalOperatingDate(),
): ReportOverviewData {
  const model = getModel(today);
  const weekStart = isoWeekStart(today);
  const priorWeekStart = addDaysToDate(weekStart, -7);
  const trailing30Start = addDaysToDate(today, -29);
  const priorTrailing30End = addDaysToDate(today, -30);
  const trailing3MonthsStart = trailingThreeMonthsStart(today);
  const priorTrailing3MonthsEnd = addDaysToDate(trailing3MonthsStart, -1);

  const weekToDate = snapshotForDays(daysInRange(model, weekStart, today));
  const priorWeek = snapshotForDays(
    daysInRange(model, priorWeekStart, addDaysToDate(weekStart, -1)),
  );
  const trendDays = daysInRange(
    model,
    addDaysToDate(today, -(OVERVIEW_TREND_DAYS - 1)),
    today,
  );
  const dailyTrend: ReportTrendPoint[] = trendDays.map((day) => ({
    operatingDate: day.operatingDate,
    netSalesMinor: day.metrics.netSalesMinor,
    status: day.status,
    unitsSold: day.metrics.unitsSold,
    // An in-progress day has no settled transaction count to report.
    ...(day.status === "open" ? {} : { transactionCount: day.transactionCount }),
  }));
  const allDays = daysInRange(
    model,
    model.orderedDates[0] ?? today,
    model.orderedDates.at(-1) ?? today,
  );
  const unreconciled = allDays.find((day) => day.status !== "reconciled");

  return {
    updatedAt: model.updatedAt,
    currency: SHARED_DEMO_CURRENCY,
    today: snapshotForDays(daysInRange(model, today, today)),
    yesterday: snapshotForDays(
      daysInRange(model, addDaysToDate(today, -1), addDaysToDate(today, -1)),
    ),
    weekToDate,
    priorWeek,
    trailing30: snapshotForDays(daysInRange(model, trailing30Start, today)),
    priorTrailing30: snapshotForDays(
      daysInRange(model, addDaysToDate(today, -59), priorTrailing30End),
    ),
    trailing3Months: snapshotForDays(
      daysInRange(model, trailing3MonthsStart, today),
    ),
    priorTrailing3Months: snapshotForDays(
      daysInRange(
        model,
        trailingThreeMonthsStart(priorTrailing3MonthsEnd),
        priorTrailing3MonthsEnd,
      ),
    ),
    comparisons: {
      netSalesVsPriorWeekBp: changeBasisPoints(
        weekToDate.netSalesMinor,
        priorWeek.netSalesMinor,
      ),
      unitsSoldVsPriorWeekBp: changeBasisPoints(
        weekToDate.unitsSold,
        priorWeek.unitsSold,
      ),
    },
    dailyTrend,
    trust: {
      reconciledDays: allDays.filter((day) => day.status === "reconciled")
        .length,
      provisionalDays: allDays.filter((day) => day.status === "provisional")
        .length,
      amendedDays: allDays.filter((day) => day.status === "amended").length,
      ...(unreconciled
        ? { oldestUnreconciledDate: unreconciled.operatingDate }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Day rows
// ---------------------------------------------------------------------------

function toReportDayRow(day: SharedDemoReportsDay): ReportDayRow {
  return {
    operatingDate: day.operatingDate,
    status: day.status,
    currency: SHARED_DEMO_CURRENCY,
    flags: {
      mixedCurrency: false,
      hasUncostedRevenue: day.metrics.uncostedRevenueMinor > 0,
      quarantinedFactCount: 0,
    },
    factCount: day.factCount,
    // The demo's automated closes settle to the cent; an open day has no close.
    ...(day.status === "open" ? {} : { closeVarianceMinor: 0 }),
    ...day.metrics,
  };
}

export function createSharedDemoReportDays(args: {
  startDate: string;
  endDate: string;
  today?: string;
}): ReportDayRow[] {
  const today = args.today ?? getLocalOperatingDate();
  const model = getModel(today);
  return daysInRange(model, args.startDate, args.endDate).map(toReportDayRow);
}

// ---------------------------------------------------------------------------
// SKU identity and range aggregation
// ---------------------------------------------------------------------------

function skuIdentity(
  model: SharedDemoReportsModel,
  productSkuId: string,
): ReportSkuIdentity | undefined {
  const product = demoProductForSkuId(productSkuId);
  if (!product) return undefined;
  const imageUrl = model.imageBySkuId.get(productSkuId);

  return {
    displayName: product.name,
    sku: product.sku,
    netPriceMinor: product.price,
    unitCostMinor: product.unitCost,
    ...(imageUrl ? { imageUrl } : {}),
    productId: `${SHARED_DEMO_PRODUCT_ID_PREFIX}${product.slug}`,
    quantityAvailable: product.inventoryCount,
  };
}

function addSkuMetrics(
  into: ReportSkuDayMetrics,
  from: ReportSkuDayMetrics,
): ReportSkuDayMetrics {
  return {
    unitsSold: into.unitsSold + from.unitsSold,
    unitsReturned: into.unitsReturned + from.unitsReturned,
    grossSalesMinor: into.grossSalesMinor + from.grossSalesMinor,
    netSalesMinor: into.netSalesMinor + from.netSalesMinor,
    refundsMinor: into.refundsMinor + from.refundsMinor,
    uncostedRevenueMinor:
      into.uncostedRevenueMinor + from.uncostedRevenueMinor,
    grossProfitMinor:
      into.grossProfitMinor === null || from.grossProfitMinor === null
        ? null
        : into.grossProfitMinor + from.grossProfitMinor,
  };
}

function skuTotalsForRange(
  model: SharedDemoReportsModel,
  startDate: string,
  endDate: string,
): Map<string, ReportSkuDayMetrics> {
  const totals = new Map<string, ReportSkuDayMetrics>();
  for (const day of daysInRange(model, startDate, endDate)) {
    for (const [productSkuId, metrics] of day.skus) {
      totals.set(
        productSkuId,
        addSkuMetrics(totals.get(productSkuId) ?? zeroSkuMetrics(), metrics),
      );
    }
  }
  return totals;
}

// ---------------------------------------------------------------------------
// SKU mix
// ---------------------------------------------------------------------------

export function createSharedDemoReportSkuMix(args: {
  startDate: string;
  endDate: string;
  today?: string;
}): ReportSkuMixData {
  const today = args.today ?? getLocalOperatingDate();
  const model = getModel(today);
  const totals = skuTotalsForRange(model, args.startDate, args.endDate);
  const ranked = Array.from(totals, ([productSkuId, metrics]) => ({
    productSkuId,
    unitsSold: metrics.unitsSold,
  }))
    .filter((row) => row.unitsSold > 0)
    .sort(
      (left, right) =>
        right.unitsSold - left.unitsSold ||
        left.productSkuId.localeCompare(right.productSkuId),
    );
  const totalUnitsSold = ranked.reduce((total, row) => total + row.unitsSold, 0);
  const rows: ReportSkuMixData["rows"] = ranked
    .slice(0, SKU_MIX_VISIBLE_LIMIT)
    .map((row) => {
      const identity = skuIdentity(model, row.productSkuId);
      return {
        key: row.productSkuId,
        productSkuId: row.productSkuId,
        label: identity?.sku ?? identity?.displayName ?? row.productSkuId,
        unitsSold: row.unitsSold,
        shareBasisPoints: shareBasisPoints(row.unitsSold, totalUnitsSold),
        ...(identity ? { identity } : {}),
      };
    });
  const otherUnitsSold = ranked
    .slice(SKU_MIX_VISIBLE_LIMIT)
    .reduce((total, row) => total + row.unitsSold, 0);

  if (otherUnitsSold > 0) {
    rows.push({
      key: "other",
      label: "Other SKUs",
      unitsSold: otherUnitsSold,
      shareBasisPoints: shareBasisPoints(otherUnitsSold, totalUnitsSold),
    });
  }

  return { rows, totalUnitsSold, skuCount: ranked.length };
}

export function createSharedDemoReportSkuMovement(args: {
  startDate: string;
  endDate: string;
  today?: string;
}): ReportSkuMovementData {
  const today = args.today ?? getLocalOperatingDate();
  const model = getModel(today);
  const totals = skuTotalsForRange(model, args.startDate, args.endDate);
  const rows = Array.from(totals, ([productSkuId, metrics]) => ({
    productSkuId,
    metrics,
  }))
    .filter(
      (row) =>
        row.metrics.unitsSold !== 0 || row.metrics.unitsReturned !== 0,
    )
    .sort(
      (left, right) =>
        right.metrics.unitsSold +
          right.metrics.unitsReturned -
          (left.metrics.unitsSold + left.metrics.unitsReturned) ||
        left.productSkuId.localeCompare(right.productSkuId),
    )
    .map(({ productSkuId, metrics }) => {
      const identity = skuIdentity(model, productSkuId);
      return {
        key: productSkuId,
        productSkuId,
        label: identity?.sku ?? identity?.displayName ?? productSkuId,
        unitsSold: metrics.unitsSold,
        unitsReturned: metrics.unitsReturned,
        netUnits: metrics.unitsSold - metrics.unitsReturned,
        ...(identity ? { identity } : {}),
      };
    });
  const totalUnitsSold = rows.reduce(
    (total, row) => total + row.unitsSold,
    0,
  );
  const totalUnitsReturned = rows.reduce(
    (total, row) => total + row.unitsReturned,
    0,
  );

  return {
    rows,
    totalUnitsSold,
    totalUnitsReturned,
    netUnits: totalUnitsSold - totalUnitsReturned,
    skuCount: rows.length,
  };
}

// ---------------------------------------------------------------------------
// SKU movement — paged, absolute-net-ranked lifecycle (U4)
//
// Mirrors U1's public `ReportMovementLifecycle` "completed" shape and paging
// (`REPORT_MOVEMENT_PAGE_SIZE`, `movementPageCount`) so the shared sheet reads
// live and demo movement pages identically. The demo has no async work, so it
// always returns an immediately-completed lifecycle over its already-local,
// finite transaction fixture — never a live subscription.
//
// `rankSignedMovementRows` is extracted as a pure function, independent of
// the demo model, because the shared-demo catalogue never carries a returned
// unit (`buildDay` never increments `unitsReturned`): the negative-net and
// zero-net ordering rules can only be exercised with synthetic input.
// ---------------------------------------------------------------------------

export type SharedDemoSignedMovementEntry = {
  productSkuId: string;
  unitsSold: number;
  unitsReturned: number;
};

export type SharedDemoRankedMovementEntry = SharedDemoSignedMovementEntry & {
  netUnits: number;
};

/**
 * Absolute-net descending, stable productSkuId tie-break — the exact ordering
 * `movementAbsNetUnitsSortKey` defines. Excludes SKUs with zero of both sold
 * and returned units; a SKU whose sold and returned cancel to net zero but
 * has nonzero activity on either side is kept.
 */
export function rankSignedMovementRows(
  entries: readonly SharedDemoSignedMovementEntry[],
): SharedDemoRankedMovementEntry[] {
  return entries
    .filter((entry) => entry.unitsSold !== 0 || entry.unitsReturned !== 0)
    .map((entry) => ({ ...entry, netUnits: entry.unitsSold - entry.unitsReturned }))
    .sort(
      (left, right) =>
        movementAbsNetUnitsSortKey(left.netUnits) -
          movementAbsNetUnitsSortKey(right.netUnits) ||
        left.productSkuId.localeCompare(right.productSkuId),
    );
}

/** Clamp a requested 1-based page into `[1, pageCount]`; non-finite → 1. */
function canonicalizeMovementPage(
  requestedPage: number | undefined,
  pageCount: number,
): number {
  if (requestedPage === undefined || !Number.isFinite(requestedPage)) return 1;
  return Math.min(Math.max(Math.floor(requestedPage), 1), pageCount);
}

/**
 * A single 20-row movement page plus the immediately-completed public
 * lifecycle it belongs to. Top movers is page 1 of this same ordering — call
 * with no `page` (or `page: 1`).
 */
export type SharedDemoReportMovementPage = {
  lifecycle: Extract<ReportMovementLifecycle, { state: "completed" }>;
  page: number;
  rows: ReportSkuMovementRow[];
};

export function createSharedDemoReportMovementPage(args: {
  startDate: string;
  endDate: string;
  page?: number;
  today?: string;
}): SharedDemoReportMovementPage {
  const today = args.today ?? getLocalOperatingDate();
  const model = getModel(today);
  const totals = skuTotalsForRange(model, args.startDate, args.endDate);

  const ranked = rankSignedMovementRows(
    Array.from(totals, ([productSkuId, metrics]) => ({
      productSkuId,
      unitsSold: metrics.unitsSold,
      unitsReturned: metrics.unitsReturned,
    })),
  );

  const rows: ReportSkuMovementRow[] = ranked.map((entry) => {
    const identity = skuIdentity(model, entry.productSkuId);
    return {
      key: entry.productSkuId,
      productSkuId: entry.productSkuId,
      label: identity?.sku ?? identity?.displayName ?? entry.productSkuId,
      unitsSold: entry.unitsSold,
      unitsReturned: entry.unitsReturned,
      netUnits: entry.netUnits,
      ...(identity ? { identity } : {}),
    };
  });

  const skuCount = rows.length;
  const pageCount = movementPageCount(skuCount);
  const canonicalPage = canonicalizeMovementPage(args.page, pageCount);
  const offset = (canonicalPage - 1) * REPORT_MOVEMENT_PAGE_SIZE;

  const totalsSummary: ReportMovementTotals = {
    unitsSold: rows.reduce((total, row) => total + row.unitsSold, 0),
    unitsReturned: rows.reduce((total, row) => total + row.unitsReturned, 0),
    netUnits: rows.reduce((total, row) => total + row.netUnits, 0),
    skuCount,
  };

  return {
    lifecycle: {
      state: "completed",
      totals: totalsSummary,
      completedAt: model.updatedAt,
      pageCount,
    },
    page: canonicalPage,
    rows: rows.slice(offset, offset + REPORT_MOVEMENT_PAGE_SIZE),
  };
}

// ---------------------------------------------------------------------------
// Period SKUs (paged)
//
// The cursor round-trips through the route's search params, so it must survive
// a stale, foreign, or hand-edited value. It is opaque but deterministic, and
// validation FALLS BACK to the first page rather than throwing: a demo must
// never blank out because an old link carried yesterday's cursor.
// ---------------------------------------------------------------------------

type SharedDemoSkuCursor = {
  v: number;
  periodKey: string;
  sortBy: ReportSkuSortBy;
  afterSkuId: string;
};

function encodeSkuCursor(cursor: SharedDemoSkuCursor): string {
  return btoa(JSON.stringify(cursor));
}

function decodeSkuCursor(
  cursor: string | null | undefined,
  periodKey: string,
  sortBy: ReportSkuSortBy,
): SharedDemoSkuCursor | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(atob(cursor));
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<SharedDemoSkuCursor>;
    if (
      candidate.v !== CURSOR_VERSION ||
      candidate.periodKey !== periodKey ||
      candidate.sortBy !== sortBy ||
      typeof candidate.afterSkuId !== "string"
    ) {
      return null;
    }
    return {
      v: CURSOR_VERSION,
      periodKey,
      sortBy,
      afterSkuId: candidate.afterSkuId,
    };
  } catch {
    return null;
  }
}

function priorPeriodRange(
  periodKey: string,
  range: { startDate: string; endDate: string } | null,
) {
  if (!range) return null;
  if (periodKey.startsWith("d:")) {
    const operatingDate = addDaysToDate(range.startDate, -1);
    return { startDate: operatingDate, endDate: operatingDate };
  }
  if (periodKey.startsWith("w:")) {
    return {
      startDate: addDaysToDate(range.startDate, -7),
      endDate: addDaysToDate(range.endDate, -7),
    };
  }
  if (periodKey.startsWith("m:")) {
    const priorEndDate = addDaysToDate(range.startDate, -1);
    return periodDateRange(`m:${priorEndDate.slice(0, 7)}`);
  }
  return null;
}

export function createSharedDemoPeriodSkus(args: {
  periodKey: string;
  sortBy: ReportSkuSortBy;
  cursor?: string | null;
  today?: string;
}): SharedDemoPeriodSkusResult {
  const today = args.today ?? getLocalOperatingDate();
  const model = getModel(today);
  const range = periodDateRange(args.periodKey);
  const prior = priorPeriodRange(args.periodKey, range);
  const totals = range
    ? skuTotalsForRange(model, range.startDate, range.endDate)
    : new Map<string, ReportSkuDayMetrics>();

  const sorted = Array.from(totals, ([productSkuId, metrics]) => ({
    productSkuId,
    metrics,
  }))
    .filter(
      (row) => row.metrics.unitsSold > 0 || row.metrics.netSalesMinor !== 0,
    )
    // Same ordering the server's descending sort keys produce: measure
    // descending, then SKU id ascending so a tie group pages consistently.
    .sort((left, right) => {
      const measure =
        args.sortBy === "revenue"
          ? right.metrics.netSalesMinor - left.metrics.netSalesMinor
          : right.metrics.unitsSold - left.metrics.unitsSold;
      return measure || left.productSkuId.localeCompare(right.productSkuId);
    });

  const cursor = decodeSkuCursor(args.cursor, args.periodKey, args.sortBy);
  const cursorIndex = cursor
    ? sorted.findIndex((row) => row.productSkuId === cursor.afterSkuId)
    : -1;
  // A cursor naming a SKU that has since dropped out of the period is stale;
  // it restarts at page one instead of paging past unseen rows.
  const offset = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const page = sorted.slice(offset, offset + REPORT_SKU_PAGE_SIZE);
  const hasMore = sorted.length > offset + REPORT_SKU_PAGE_SIZE;
  const last = page.at(-1);

  const periodDays = range
    ? daysInRange(model, range.startDate, range.endDate)
    : [];
  const priorDays = prior
    ? daysInRange(model, prior.startDate, prior.endDate)
    : [];
  const selectedDayDate =
    range && range.startDate === range.endDate ? range.startDate : null;

  return {
    rows: page.map((row) => {
      const identity = skuIdentity(model, row.productSkuId);
      return {
        productSkuId: row.productSkuId,
        periodKey: args.periodKey,
        ...row.metrics,
        ...(identity ? { identity } : {}),
      };
    }),
    continueCursor:
      hasMore && last
        ? encodeSkuCursor({
            v: CURSOR_VERSION,
            periodKey: args.periodKey,
            sortBy: args.sortBy,
            afterSkuId: last.productSkuId,
          })
        : null,
    totalNetSalesMinor: periodDays.reduce(
      (total, day) => total + day.metrics.netSalesMinor,
      0,
    ),
    totalUnitsSold: periodDays.reduce(
      (total, day) => total + day.metrics.unitsSold,
      0,
    ),
    totalTransactions: periodDays.reduce(
      (total, day) => total + day.transactionCount,
      0,
    ),
    priorPeriodTotals: {
      netSalesMinor: priorDays.reduce(
        (total, day) => total + day.metrics.netSalesMinor,
        0,
      ),
      unitsSold: priorDays.reduce(
        (total, day) => total + day.metrics.unitsSold,
        0,
      ),
      transactions: priorDays.reduce(
        (total, day) => total + day.transactionCount,
        0,
      ),
    },
    updatedAt: model.updatedAt,
    isTodayInProgress:
      selectedDayDate !== null &&
      periodDays.some(
        (day) =>
          day.operatingDate === selectedDayDate &&
          isReportingTodayInProgress(day.status),
      ),
  };
}

// ---------------------------------------------------------------------------
// SKU detail
// ---------------------------------------------------------------------------

function skuRangeTotals(
  rows: ReportSkuDayMetrics[],
  productSkuId: string,
  periodKey: string,
): ReportSkuPeriodRow | null {
  if (rows.length === 0) return null;
  const totals = rows.reduce(
    (into, row) => addSkuMetrics(into, row),
    zeroSkuMetrics(),
  );
  return { productSkuId, periodKey, ...totals };
}

/** The immediately preceding range of equal length. */
function precedingEqualRange(startDate: string, endDate: string) {
  const dayCount =
    Math.round(
      (Date.parse(`${endDate}T00:00:00.000Z`) -
        Date.parse(`${startDate}T00:00:00.000Z`)) /
        86_400_000,
    ) + 1;
  const priorEndDate = addDaysToDate(startDate, -1);
  return {
    startDate: addDaysToDate(priorEndDate, 1 - dayCount),
    endDate: priorEndDate,
  };
}

export function createSharedDemoSkuDetail(args: {
  productSkuId: string;
  startDate: string;
  endDate: string;
  today?: string;
}): SharedDemoSkuDetailResult | null {
  const today = args.today ?? getLocalOperatingDate();
  // An unknown id is a `null` detail, never a throw: this value arrives from a
  // route param and the story lookups throw on a miss.
  if (!demoProductForSkuId(args.productSkuId)) return null;

  const model = getModel(today);
  const identity = skuIdentity(model, args.productSkuId);
  if (args.startDate > args.endDate) {
    return { days: [], totals: null, priorPeriodTotals: null, identity };
  }

  const days = daysInRange(model, args.startDate, args.endDate)
    .map((day) => ({ day, metrics: day.skus.get(args.productSkuId) }))
    .filter(
      (entry): entry is { day: SharedDemoReportsDay; metrics: ReportSkuDayMetrics } =>
        Boolean(entry.metrics),
    )
    .map(({ day, metrics }) => ({
      productSkuId: args.productSkuId,
      periodKey: `d:${day.operatingDate}`,
      operatingDate: day.operatingDate,
      ...metrics,
    }));

  const prior = precedingEqualRange(args.startDate, args.endDate);
  const priorRows = daysInRange(model, prior.startDate, prior.endDate)
    .map((day) => day.skus.get(args.productSkuId))
    .filter((metrics): metrics is ReportSkuDayMetrics => Boolean(metrics));

  return {
    days,
    totals: skuRangeTotals(
      days,
      args.productSkuId,
      `range:${args.startDate}:${args.endDate}`,
    ),
    priorPeriodTotals: skuRangeTotals(
      priorRows,
      args.productSkuId,
      `range:${prior.startDate}:${prior.endDate}`,
    ),
    identity,
  };
}

// ---------------------------------------------------------------------------
// SKU day evidence
// ---------------------------------------------------------------------------

export function createSharedDemoSkuDayTransactions(args: {
  productSkuId: string;
  operatingDate: string;
  today?: string;
}): { transactions: ReportSkuTransactionEvidence[]; truncated: boolean } {
  const today = args.today ?? getLocalOperatingDate();
  if (!demoProductForSkuId(args.productSkuId)) {
    return { transactions: [], truncated: false };
  }

  const model = getModel(today);
  const dayTransactions =
    model.transactionsByDate.get(args.operatingDate) ?? [];
  const matching = dayTransactions.filter((transaction) =>
    transaction.items.some((item) => item.productSkuId === args.productSkuId),
  );
  const truncated = matching.length > SKU_DAY_EVIDENCE_LIMIT;

  const transactions = matching
    .slice(0, SKU_DAY_EVIDENCE_LIMIT)
    .map((transaction): ReportSkuTransactionEvidence => {
      const lines = transaction.items.filter(
        (item) => item.productSkuId === args.productSkuId,
      );
      // A void is disclosed as evidence but recognises nothing — the same rule
      // the day fold applies, so evidence rows sum to the SKU-day net sales.
      const isVoid = transaction.status !== "completed";
      const quantity = isVoid
        ? 0
        : lines.reduce((total, line) => total + line.quantity, 0);
      const netSalesMinor = isVoid
        ? 0
        : lines.reduce((total, line) => total + line.totalPrice, 0);
      const product = demoProductForSkuId(args.productSkuId);
      const costMinor = product ? product.unitCost * quantity : null;

      return {
        sourceDomain: "pos",
        sourceId: String(transaction._id),
        reference: transaction.transactionNumber,
        occurredAt: transaction.completedAt,
        status: transaction.status,
        quantity,
        netSalesMinor,
        costMinor,
        grossProfitMinor: costMinor === null ? null : netSalesMinor - costMinor,
        hasRefunds: false,
        hasAdjustments: isVoid,
      };
    })
    .sort(
      (left, right) =>
        right.occurredAt - left.occurredAt ||
        left.reference.localeCompare(right.reference),
    );

  return { transactions, truncated };
}

// ---------------------------------------------------------------------------
// Weekly briefing — live week-to-date only. See the file header for the fields
// this deliberately does not emit and why.
// ---------------------------------------------------------------------------

function weekMetricsForDays(days: SharedDemoReportsDay[]): ReportWeekMetrics {
  const snapshot = snapshotForDays(days);
  return {
    grossSalesMinor: snapshot.grossSalesMinor,
    netSalesMinor: snapshot.netSalesMinor,
    refundsMinor: snapshot.refundsMinor,
    unitsSold: snapshot.unitsSold,
    unitsReturned: snapshot.unitsReturned,
    uncostedRevenueMinor: snapshot.uncostedRevenueMinor,
    grossProfitMinor: snapshot.grossProfitMinor,
    paymentsCollectedMinor: snapshot.paymentsCollectedMinor,
    paymentsRefundedMinor: snapshot.paymentsRefundedMinor,
    paymentAllocatedMinor: snapshot.paymentAllocatedMinor,
    // Every demo sale is tendered in full at the counter, so collected less
    // refunded is fully allocated and nothing is left unsettled.
    paymentUnsettledMinor: Math.max(
      0,
      snapshot.paymentsCollectedMinor -
        snapshot.paymentsRefundedMinor -
        snapshot.paymentAllocatedMinor,
    ),
    paymentAllocationCoverage: "complete",
    paymentAllocationOmittedMinor: 0,
    paymentHasInvalidAllocation: false,
  };
}

function weeklySummary(metrics: ReportWeekMetrics): ReportWeekSummary {
  return {
    grossSalesMinor: metrics.grossSalesMinor,
    merchandiseMarginMinor: metrics.grossProfitMinor,
    netSalesMinor: metrics.netSalesMinor,
    netUnits: metrics.unitsSold - metrics.unitsReturned,
    paymentAllocatedMinor: metrics.paymentAllocatedMinor,
    paymentAllocationCoverage: metrics.paymentAllocationCoverage,
    paymentUnsettledMinor: metrics.paymentUnsettledMinor,
    paymentsCollectedMinor: metrics.paymentsCollectedMinor,
    paymentsRefundedMinor: metrics.paymentsRefundedMinor,
    refundsMinor: metrics.refundsMinor,
    unitsReturned: metrics.unitsReturned,
    unitsSold: metrics.unitsSold,
  };
}

/** Sunday is the demo store's closed day: the shared history sells nothing. */
function isScheduledDate(operatingDate: string): boolean {
  return getLocalDateFromOperatingDate(operatingDate)?.getDay() !== 0;
}

function weekFrameDates(today: string): string[] {
  const cycleStartDate = isoWeekStart(today);
  return Array.from({ length: 7 }, (_, index) =>
    addDaysToDate(cycleStartDate, index),
  );
}

function scheduleLineage(
  model: SharedDemoReportsModel,
  frameDates: string[],
): ReportWeekLineage[] {
  return frameDates.map((localDate) => {
    const day = localDate <= model.today ? model.days.get(localDate) : undefined;
    return {
      localDate,
      included: isScheduledDate(localDate),
      scheduleVersionId: SHARED_DEMO_SCHEDULE_VERSION_ID,
      dayStatus: day?.status ?? null,
      dayAvailable: Boolean(day),
      activityPosture: !day
        ? ("unavailable" as const)
        : day.metrics.netSalesMinor !== 0 || day.metrics.unitsSold !== 0
          ? ("recorded" as const)
          : ("zero_activity" as const),
    };
  });
}

function inventoryAttention(
  days: SharedDemoReportsDay[],
): ReportWeekInventoryAttention {
  const reviewDays = days.filter((day) => day.hasInventoryReview);
  return {
    carriedForwardCount: 0,
    // Every date in the frame that has happened is on record, so the lane's
    // evidence is as complete as the week itself.
    completeness: "complete",
    groups: reviewDays.map((day) => ({
      classification: "new_this_week" as const,
      evidenceLimited: false,
      hasNewActivity: true,
      key: `synced-sale-inventory-review:${day.operatingDate}`,
      memberCount: 1,
      productSkuId: null,
    })),
    newCount: reviewDays.length,
    observedCount: reviewDays.length,
    overflow: false,
  };
}

function variancePosture(
  includedDays: SharedDemoReportsDay[],
  outsideDays: SharedDemoReportsDay[],
): ReportWeekVariancePosture {
  const closed = includedDays.filter((day) => day.status !== "open");
  const outsideClosed = outsideDays.filter((day) => day.status !== "open");
  return {
    // The demo's automated closes settle to the cent on every store day.
    closeVarianceMinor: 0,
    coverage:
      includedDays.length === 0
        ? "unavailable"
        : closed.length === includedDays.length
          ? "complete"
          : "partial",
    coveredIncludedDayCount: closed.length,
    includedDayCount: includedDays.length,
    scheduledVarianceMinor: 0,
    outsideScheduleVarianceMinor: 0,
    outsideScheduleCoveredDayCount: outsideClosed.length,
  };
}

function ownerRoutes(args: {
  cycleStartDate: string;
  cycleEndDate: string;
  finalScheduledDate: string | null;
}): ReportWeekOwnerRoutes {
  return {
    transactions: {
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions",
      search: {
        startDate: args.cycleStartDate,
        endDate: args.cycleEndDate,
        order: "oldestFirst",
      },
    },
    // A live week routes to the working Daily Close for the most recent
    // scheduled date that has actually happened — never a future frame date.
    dailyClose: args.finalScheduledDate
      ? {
          to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
          search: { operatingDate: args.finalScheduledDate },
        }
      : null,
    cashControls: { to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls" },
    openWork: {
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
      search: { workType: "synced_sale_inventory_review" },
    },
  };
}

function priorPeriod(
  model: SharedDemoReportsModel,
  frameDates: string[],
  currentTotal: ReportWeekMetrics,
): ReportWeekPriorPeriod {
  const priorDates = frameDates.map((date) => addDaysToDate(date, -7));
  const priorDays = priorDates
    .map((date) => model.days.get(date))
    .filter((day): day is SharedDemoReportsDay => Boolean(day));
  const includedPrior = priorDays.filter((day) =>
    isScheduledDate(day.operatingDate),
  );
  const outsidePrior = priorDays.filter(
    (day) => !isScheduledDate(day.operatingDate),
  );
  const scheduledPositionCount = frameDates.filter(isScheduledDate).length;
  const values = weekMetricsForDays(includedPrior);
  const outsideScheduleValues = weekMetricsForDays(outsidePrior);
  const priorTotal = addWeekMetrics(values, outsideScheduleValues);
  // The prior cycle sits entirely inside the shared history window, so it is
  // comparable whenever every one of its dates is on record.
  const comparabilityReason =
    priorDays.length === frameDates.length
      ? ("comparable" as const)
      : ("missing_prior_day_fold" as const);

  return {
    cycleStartDate: priorDates[0]!,
    cycleEndDate: priorDates.at(-1)!,
    comparabilityReason,
    currentScheduledPositionCount: scheduledPositionCount,
    equivalentScheduledPositions: true,
    priorScheduledPositionCount: scheduledPositionCount,
    values,
    outsideScheduleValues,
    summary: weeklySummary(values),
    totalSummary: weeklySummary(priorTotal),
    netSalesChange:
      comparabilityReason === "comparable"
        ? {
            amountMinor: Math.abs(
              currentTotal.netSalesMinor - priorTotal.netSalesMinor,
            ),
            direction:
              currentTotal.netSalesMinor > priorTotal.netSalesMinor
                ? ("higher" as const)
                : currentTotal.netSalesMinor < priorTotal.netSalesMinor
                  ? ("lower" as const)
                  : ("unchanged" as const),
          }
        : null,
  };
}

export function createSharedDemoWeeklyBriefing(
  today = getLocalOperatingDate(),
): ReportWeekBriefing {
  const model = getModel(today);
  const frameDates = weekFrameDates(today);
  const cycleStartDate = frameDates[0]!;
  const cycleEndDate = frameDates.at(-1)!;
  const lineage = scheduleLineage(model, frameDates);

  // Week to date: dates in the frame that have actually happened. On a Monday
  // that is exactly ONE date, and on a Monday with no history at all it is a
  // legitimately empty week — never a reason to index backwards off the end.
  const elapsedDays = frameDates
    .filter((date) => date <= today)
    .map((date) => model.days.get(date))
    .filter((day): day is SharedDemoReportsDay => Boolean(day));
  const includedDays = elapsedDays.filter((day) =>
    isScheduledDate(day.operatingDate),
  );
  const outsideDays = elapsedDays.filter(
    (day) => !isScheduledDate(day.operatingDate),
  );

  const included = weekMetricsForDays(includedDays);
  const outsideSchedule = weekMetricsForDays(outsideDays);
  const total = addWeekMetrics(included, outsideSchedule);
  const missingIncludedFold = frameDates.some(
    (date) =>
      date <= today && isScheduledDate(date) && !model.days.has(date),
  );
  const completeness: ReportWeekCompleteness = {
    complete: !missingIncludedFold,
    reason: missingIncludedFold ? "missing_day_fold" : "complete",
    outsideSchedule: { complete: true, reason: "complete" },
  };
  const finalScheduledDate =
    includedDays.at(-1)?.operatingDate ?? null;

  return {
    status: "available",
    current: {
      cycleStartDate,
      cycleEndDate,
      currency: SHARED_DEMO_CURRENCY,
      metricVersion: REPORTS_FOLD_VERSION,
      materializedAt: model.updatedAt,
      included,
      summary: weeklySummary(included),
      outsideSchedule,
      outsideScheduleSummary: weeklySummary(outsideSchedule),
      total: weeklySummary(total),
      totalCompleteness: combineWeekCompleteness(completeness),
      scheduleLineage: lineage,
      completeness,
      lifecyclePosture: "live",
      amendmentPosture: "none",
      inventoryAttention: inventoryAttention(elapsedDays),
      priorPeriod: priorPeriod(model, frameDates, total),
      variancePosture: variancePosture(includedDays, outsideDays),
      ownerRoutes: ownerRoutes({
        cycleStartDate,
        cycleEndDate,
        finalScheduledDate,
      }),
    },
    // Deliberately null. An accepted baseline is earned from a register close
    // and an observed-at cutoff; a client cannot produce either honestly.
    acceptedBaseline: null,
  };
}
