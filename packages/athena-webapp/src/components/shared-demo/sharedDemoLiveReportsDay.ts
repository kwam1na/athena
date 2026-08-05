import type {
  ReportDayMetrics,
  ReportDayStatus,
  ReportLiveOperatingDay,
  ReportSkuDayMetrics,
} from "~/shared/reportsContract";
import { SHARED_DEMO_PRODUCTS } from "~/shared/sharedDemoStory";

/**
 * The boundary between the demo's live current day and its fixture history.
 *
 * The shared demo's own POS sales write real `reportFact` / `reportDay` rows,
 * so the current day is genuinely live while every date behind it is fixture.
 * This module is where the two meet, and it enforces the two rules that keep
 * that seam honest:
 *
 *  1. **Today only.** A payload for any other date is discarded outright. The
 *     fixture owns the 21-day history; a stray live row — a late fact, a
 *     client/server clock disagreement — must never shadow it.
 *
 *  2. **No Convex id crosses.** Live rows carry real `productSku` ids; the
 *     fixture is keyed by `shared-demo-sku-${slug}`. Rows are rewritten into
 *     fixture id space HERE, so `isSharedDemoReportsSkuId` — the gate that
 *     keeps unvalidated route params away from the throwing catalogue
 *     resolvers — stays true of every id downstream.
 */

/** Demo SKU ids are `shared-demo-sku-${slug}` — see the transactions fixture. */
export const SHARED_DEMO_REPORTS_SKU_ID_PREFIX = "shared-demo-sku-";

export type SharedDemoLiveReportsDay = {
  factCount: number;
  metrics: ReportDayMetrics;
  operatingDate: string;
  /**
   * Real `productSku` ids by fixture sku id, for QUERY ARGUMENTS only.
   *
   * Deliberately separate from `skus`: the identity space stays free of Convex
   * ids (rule 2 above), but a server read that drills into today's evidence
   * still has to name the row it wants. Nothing here is ever rendered or put
   * in a route param.
   */
  querySkuIdByFixtureSkuId: Map<string, string>;
  /** Fixture-space sku id to metrics, in first-seen order. */
  skus: Array<[string, ReportSkuDayMetrics]>;
  status: ReportDayStatus;
  /** Always 0: an open day has no settled count. See below. */
  transactionCount: number;
  updatedAt: number;
};

const FIXTURE_SKU_ID_BY_CODE = new Map(
  SHARED_DEMO_PRODUCTS.map((product) => [
    product.sku,
    `${SHARED_DEMO_REPORTS_SKU_ID_PREFIX}${product.slug}`,
  ]),
);

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

/**
 * Normalise a `getLiveOperatingDay` payload into the fixture's own vocabulary.
 *
 * Returns `null` when there is nothing to merge — still loading, or a payload
 * for the wrong day. An UNTOUCHED day is not null: it resolves to a real, empty
 * open day, because "the day exists and has sold nothing yet" is precisely what
 * the demo should show before a visitor's first sale.
 */
export function toSharedDemoLiveReportsDay(args: {
  result: ReportLiveOperatingDay | null | undefined;
  today: string;
}): SharedDemoLiveReportsDay | null {
  const { result, today } = args;
  if (!result || result.operatingDate !== today) return null;

  const skus = new Map<string, ReportSkuDayMetrics>();
  const querySkuIdByFixtureSkuId = new Map<string, string>();
  for (const row of result.skus) {
    // A row we cannot attribute to a catalogue story — a quick-add SKU, or one
    // whose document is gone — is dropped from the mix, never from the day.
    // Its money is already inside the day's own metrics, so the totals stay
    // whole while the breakdown honestly declines to name it.
    const fixtureSkuId = row.sku ? FIXTURE_SKU_ID_BY_CODE.get(row.sku) : undefined;
    if (!fixtureSkuId) continue;
    querySkuIdByFixtureSkuId.set(fixtureSkuId, row.productSkuId);
    const existing = skus.get(fixtureSkuId);
    skus.set(
      fixtureSkuId,
      existing ? addSkuMetrics(existing, row.metrics) : row.metrics,
    );
  }

  return {
    factCount: result.day?.factCount ?? 0,
    metrics: result.day?.metrics ?? zeroDayMetrics(),
    operatingDate: result.operatingDate,
    querySkuIdByFixtureSkuId,
    skus: [...skus],
    // An untouched day has no row yet, and a day that does have one is open
    // until rollover advances it.
    status: result.day?.status ?? "open",
    // A day with no close has no settled transaction count — the same rule
    // `reports/transactionCounts.ts` states for every store. The trend point
    // and the days rail already omit the count for an open day, so reporting
    // zero here matches the server rather than inventing a number.
    transactionCount: 0,
    updatedAt: result.day?.lastFactRecordedAt ?? 0,
  };
}

/**
 * Current stock per fixture SKU id, from `reports/liveDay:listLiveSkuStock`.
 *
 * The demo's SKU identity comes from a client fixture whose stock figure is a
 * story constant, while the demo's real `productSku` rows are decremented by a
 * visitor's sale like any other store's. This maps the live rows into fixture
 * id space so the workspace can show the number that actually moved.
 *
 * Returns `null` while the read is settling — "not known yet" has to stay
 * distinguishable from "every SKU is out of stock".
 */
export function toSharedDemoLiveSkuStock(
  rows: Array<{ quantityAvailable: number; sku: string }> | undefined,
): Map<string, number> | null {
  // Validated, not trusted — the same posture `toSharedDemoLiveReportsDay`
  // takes with its payload. Anything that is not a settled array of rows is
  // "not known yet", which is exactly what `null` means here.
  if (!Array.isArray(rows)) return null;

  const stock = new Map<string, number>();
  for (const row of rows) {
    const fixtureSkuId = FIXTURE_SKU_ID_BY_CODE.get(row.sku);
    // A code outside the demo catalogue (a quick-add SKU) has no story row to
    // attach to. A quantity of ZERO is kept: sold out is a fact, not an absence.
    if (fixtureSkuId) stock.set(fixtureSkuId, row.quantityAvailable);
  }

  return stock;
}
