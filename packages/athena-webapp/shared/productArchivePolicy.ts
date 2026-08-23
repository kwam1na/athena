/**
 * Product archival is blocked while the synced-sale inventory review work that
 * belongs to the product's SKUs is still open. The destination workspace for
 * that work (Stock adjustments) hides archived SKUs, so archiving first would
 * strand review work that no operator surface can render.
 *
 * The reason codes and operator copy live here so the Convex precondition and
 * the browser present the same normalized wording.
 */

export const OPEN_SYNCED_SALE_INVENTORY_REVIEW_ARCHIVE_REASON =
  "open_synced_sale_inventory_review_work";
export const SYNCED_SALE_INVENTORY_REVIEW_SCAN_INCOMPLETE_REASON =
  "open_synced_sale_inventory_review_scan_incomplete";
export const NO_OPEN_SYNCED_SALE_INVENTORY_REVIEW_REASON =
  "no_open_synced_sale_inventory_review_work";

export const PRODUCT_ARCHIVE_BLOCKED_TITLE = "Archiving on hold";
export const PRODUCT_ARCHIVE_REVIEW_SCAN_INCOMPLETE_DESCRIPTION =
  "Athena could not confirm this product's open sale inventory reviews. Try again shortly.";

export type ProductArchiveBlockedReason =
  | typeof OPEN_SYNCED_SALE_INVENTORY_REVIEW_ARCHIVE_REASON
  | typeof SYNCED_SALE_INVENTORY_REVIEW_SCAN_INCOMPLETE_REASON;

export type ProductArchiveBlock = {
  openSyncedSaleInventoryReviewGroupCount: number | null;
  reason: ProductArchiveBlockedReason;
};

export function isProductArchiveBlockedReason(
  value: unknown,
): value is ProductArchiveBlockedReason {
  return (
    value === OPEN_SYNCED_SALE_INVENTORY_REVIEW_ARCHIVE_REASON ||
    value === SYNCED_SALE_INVENTORY_REVIEW_SCAN_INCOMPLETE_REASON
  );
}

/**
 * Operator copy names how many sale inventory review groups are outstanding.
 * A group is one SKU's worth of review work, which is the unit an operator
 * actually resolves, not the individual work rows behind it.
 */
export function buildProductArchiveBlockedDescription(
  block: ProductArchiveBlock,
): string {
  if (block.reason === SYNCED_SALE_INVENTORY_REVIEW_SCAN_INCOMPLETE_REASON) {
    return PRODUCT_ARCHIVE_REVIEW_SCAN_INCOMPLETE_DESCRIPTION;
  }

  const count = Math.max(
    1,
    Math.trunc(block.openSyncedSaleInventoryReviewGroupCount ?? 1),
  );

  return `Resolve ${count} open sale inventory ${
    count === 1 ? "review" : "reviews"
  } for this product before archiving.`;
}
