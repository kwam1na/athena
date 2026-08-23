import {
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  GENERIC_UNEXPECTED_ERROR_TITLE,
} from "~/shared/commandResult";
import {
  buildProductArchiveBlockedDescription,
  isProductArchiveBlockedReason,
  PRODUCT_ARCHIVE_BLOCKED_TITLE,
  type ProductArchiveBlock,
} from "~/shared/productArchivePolicy";

/**
 * Thrown by the archive hook when the server declined the transition. It
 * carries the decision, never the server's wording, so operator copy is always
 * rebuilt in the browser.
 */
export class ProductArchiveBlockedError extends Error {
  readonly openSyncedSaleInventoryReviewGroupCount: number | null;
  readonly reason: ProductArchiveBlock["reason"];

  constructor(block: ProductArchiveBlock) {
    super(buildProductArchiveBlockedDescription(block));
    this.name = "ProductArchiveBlockedError";
    this.openSyncedSaleInventoryReviewGroupCount =
      block.openSyncedSaleInventoryReviewGroupCount;
    this.reason = block.reason;
  }
}

function readGroupCount(metadata: Record<string, unknown>) {
  const value = metadata.openSyncedSaleInventoryReviewGroupCount;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Reads the archive decision off a command result, ignoring server copy. */
export function productArchiveBlockFromResult(
  result: unknown,
): ProductArchiveBlock | null {
  if (!result || typeof result !== "object") return null;

  const candidate = result as {
    error?: { metadata?: Record<string, unknown> };
    kind?: string;
  };
  if (candidate.kind !== "user_error") return null;

  const metadata = candidate.error?.metadata ?? {};
  if (!isProductArchiveBlockedReason(metadata.reason)) return null;

  return {
    openSyncedSaleInventoryReviewGroupCount: readGroupCount(metadata),
    reason: metadata.reason,
  };
}

export function resolveProductArchiveFailureToast(error: unknown): {
  description: string;
  title: string;
} {
  if (error instanceof ProductArchiveBlockedError) {
    return {
      description: buildProductArchiveBlockedDescription({
        openSyncedSaleInventoryReviewGroupCount:
          error.openSyncedSaleInventoryReviewGroupCount,
        reason: error.reason,
      }),
      title: PRODUCT_ARCHIVE_BLOCKED_TITLE,
    };
  }

  return {
    description: GENERIC_UNEXPECTED_ERROR_MESSAGE,
    title: GENERIC_UNEXPECTED_ERROR_TITLE,
  };
}
