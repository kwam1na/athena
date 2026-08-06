import type {
  ReportDayMetrics,
  ReportDayStatus,
  ReportLiveOperatingDay,
  ReportLiveSkuIdentity,
  ReportLiveSkuStockRow,
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
 *  2. **No RAW Convex id crosses.** Live rows carry real `productSku` ids; the
 *     fixture is keyed by `shared-demo-sku-${slug}`. Rows are rewritten into
 *     fixture id space HERE, so `isSharedDemoReportsSkuId` — the gate that
 *     keeps unvalidated route params away from the throwing catalogue
 *     resolvers — stays true of every id downstream.
 *
 * ## Two id spaces, one gate
 *
 * The story catalogue is eight products, but the demo store's real catalogue is
 * not closed: a visitor can create a SKU at the register with POS quick add,
 * and it is a genuine part of their day. Such a SKU has no story to be named
 * from, so it gets the SECOND prefix — `shared-demo-live-sku-${realSkuId}` —
 * and is named from the identity the live queries now carry inline.
 *
 * Both prefixes pass `isSharedDemoReportsSkuId`, so the gate still holds: no
 * unprefixed route param ever reaches a throwing story resolver. What changed
 * is that failing to match the story is no longer the same as failing to exist.
 */

/** Demo SKU ids are `shared-demo-sku-${slug}` — see the transactions fixture. */
export const SHARED_DEMO_REPORTS_SKU_ID_PREFIX = "shared-demo-sku-";

/**
 * SKUs with no story — POS quick add — are `shared-demo-live-sku-${realSkuId}`.
 *
 * Deliberately NOT a suffix under the story prefix: `demoProductForSkuId`
 * slices that prefix and looks the remainder up as a slug, and a live id must
 * never be mistaken for a slug that merely failed to match.
 */
export const SHARED_DEMO_REPORTS_LIVE_SKU_ID_PREFIX = "shared-demo-live-sku-";

/**
 * Stock and identity for one SKU, keyed in fixture id space.
 *
 * `identity` is null for a story SKU: the catalogue fixture already names it,
 * and its story price is what every other demo surface quotes. It is present
 * only where the story cannot answer — which is what makes a quick-add SKU
 * nameable at all.
 */
export type SharedDemoLiveSkuEntry = {
  identity: ReportLiveSkuIdentity | null;
  quantityAvailable: number;
};

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
  /**
   * Identity for SKUs that sold today, by fixture sku id.
   *
   * Carried on the DAY as well as on the stock lane because the two reads
   * settle independently: a SKU quick-added and sold seconds ago must be
   * nameable in the mix without waiting on a second subscription.
   */
  liveSkuIdentityById: Map<string, ReportLiveSkuIdentity>;
  /** Fixture-space sku id to metrics, in first-seen order. */
  skus: Array<[string, ReportSkuDayMetrics]>;
  status: ReportDayStatus;
  /**
   * Completed transactions so far today, maintained per sale by ingest.
   *
   * NOT close-gated: a visitor who rings a sale and looks at Reports sees the
   * basket size move, exactly as a real store's does. `0` also means zero
   * here — an untouched day genuinely has none.
   */
  transactionCount: number;
  updatedAt: number;
};

const FIXTURE_SKU_ID_BY_CODE = new Map(
  SHARED_DEMO_PRODUCTS.map((product) => [
    product.sku,
    `${SHARED_DEMO_REPORTS_SKU_ID_PREFIX}${product.slug}`,
  ]),
);

/**
 * The fixture id for a live row: its story id when the code names one, and a
 * live id otherwise.
 *
 * The story is tried FIRST and by code, so a provisioned catalogue SKU always
 * lands on its story row no matter what its real Convex id is. Only a SKU the
 * story does not contain — a quick add — reaches the live id space.
 */
export function sharedDemoFixtureSkuId(args: {
  productSkuId: string;
  sku: string | null;
}): string {
  const storyId = args.sku ? FIXTURE_SKU_ID_BY_CODE.get(args.sku) : undefined;
  return (
    storyId ?? `${SHARED_DEMO_REPORTS_LIVE_SKU_ID_PREFIX}${args.productSkuId}`
  );
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
  const liveSkuIdentityById = new Map<string, ReportLiveSkuIdentity>();
  for (const row of result.skus) {
    // A row whose SKU document is GONE is the one row still dropped from the
    // mix: with no identity there is nothing to name it by. Its money stays
    // inside the day's own metrics, so the totals remain whole.
    //
    // A row the story does not contain is NOT that case. A quick-add SKU is a
    // real part of the visitor's day and carries its own identity, so it takes
    // a live fixture id and appears in the breakdown like any other.
    if (!row.identity) continue;
    const fixtureSkuId = sharedDemoFixtureSkuId(row);
    querySkuIdByFixtureSkuId.set(fixtureSkuId, row.productSkuId);
    // Story SKUs are named by the story, here as in the stock lane: Reports
    // must not be the one surface quoting a different name or price for a
    // product the rest of the demo already describes.
    if (
      fixtureSkuId.startsWith(SHARED_DEMO_REPORTS_LIVE_SKU_ID_PREFIX) &&
      !liveSkuIdentityById.has(fixtureSkuId)
    ) {
      liveSkuIdentityById.set(fixtureSkuId, row.identity);
    }
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
    liveSkuIdentityById,
    skus: [...skus],
    // An untouched day has no row yet, and a day that does have one is open
    // until rollover advances it.
    status: result.day?.status ?? "open",
    // The day's own live count, not a close-gated one: `reports/ingest.ts`
    // maintains it per sale on the open day. The trend point and the days
    // rail still omit a count for an open day — that omission is about
    // SETTLED evidence, which this is not claiming to be.
    transactionCount: result.day?.transactionCount ?? 0,
    updatedAt: result.day?.lastFactRecordedAt ?? 0,
  };
}

/**
 * Stock and identity per fixture SKU id, from `liveDay:listLiveSkuStock`.
 *
 * The demo's SKU identity comes from a client fixture whose stock figure is a
 * story constant, while the demo's real `productSku` rows are decremented by a
 * visitor's sale like any other store's. This maps the live rows into fixture
 * id space so the workspace can show the number that actually moved.
 *
 * It is also what makes a SKU the story does not contain reachable when it has
 * NOT sold today: the day lane only knows SKUs with movement, so a quick-added
 * item a visitor searches for before selling it is named from here.
 *
 * Returns `null` while the read is settling — "not known yet" has to stay
 * distinguishable from "every SKU is out of stock".
 */
export function toSharedDemoLiveSkuStock(
  rows: ReportLiveSkuStockRow[] | undefined,
): Map<string, SharedDemoLiveSkuEntry> | null {
  // Validated, not trusted — the same posture `toSharedDemoLiveReportsDay`
  // takes with its payload. Anything that is not a settled array of rows is
  // "not known yet", which is exactly what `null` means here.
  if (!Array.isArray(rows)) return null;

  const stock = new Map<string, SharedDemoLiveSkuEntry>();
  for (const row of rows) {
    const fixtureSkuId = sharedDemoFixtureSkuId(row);
    const isStorySku = fixtureSkuId.startsWith(
      SHARED_DEMO_REPORTS_SKU_ID_PREFIX,
    );
    stock.set(fixtureSkuId, {
      // A story SKU keeps being named by the story: its price and name are
      // what every other demo surface quotes, and the live row must not make
      // Reports the one place that disagrees. Only a SKU the story cannot
      // name carries identity here.
      identity: isStorySku ? null : row.identity,
      // A quantity of ZERO is kept: sold out is a fact, not an absence.
      quantityAvailable: row.identity.quantityAvailable,
    });
  }

  return stock;
}
