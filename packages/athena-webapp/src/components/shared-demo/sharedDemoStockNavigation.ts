import { SHARED_DEMO_PRODUCTS } from "~/shared/sharedDemoStory";
import { isValidConvexId } from "~/src/lib/pos/barcodeUtils";
import {
  SHARED_DEMO_REPORTS_LIVE_SKU_ID_PREFIX,
  SHARED_DEMO_REPORTS_SKU_ID_PREFIX,
} from "./sharedDemoLiveReportsDay";

/** Resolve old report links before stock queries interpret `sku` as a database ID. */
export function resolveSharedDemoStockSearch<T extends { sku?: string; query?: string }>(search: T): T {
  const id = search.sku;
  if (!id) return search;
  if (id.startsWith(SHARED_DEMO_REPORTS_SKU_ID_PREFIX)) {
    const slug = id.slice(SHARED_DEMO_REPORTS_SKU_ID_PREFIX.length);
    const product = SHARED_DEMO_PRODUCTS.find((entry) => entry.slug === slug);
    return { ...search, sku: undefined, query: product?.sku ?? id };
  }
  if (id.startsWith(SHARED_DEMO_REPORTS_LIVE_SKU_ID_PREFIX)) {
    const liveId = id.slice(SHARED_DEMO_REPORTS_LIVE_SKU_ID_PREFIX.length);
    return isValidConvexId(liveId)
      ? { ...search, sku: liveId }
      : { ...search, sku: undefined, query: id };
  }
  return search;
}
