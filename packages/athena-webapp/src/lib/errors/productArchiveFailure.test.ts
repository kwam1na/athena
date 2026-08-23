import { describe, expect, it } from "vitest";

import {
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  GENERIC_UNEXPECTED_ERROR_TITLE,
} from "~/shared/commandResult";
import {
  OPEN_SYNCED_SALE_INVENTORY_REVIEW_ARCHIVE_REASON,
  SYNCED_SALE_INVENTORY_REVIEW_SCAN_INCOMPLETE_REASON,
} from "~/shared/productArchivePolicy";

import {
  ProductArchiveBlockedError,
  productArchiveBlockFromResult,
  resolveProductArchiveFailureToast,
} from "./productArchiveFailure";

describe("product archive failure copy", () => {
  it("names how many sale inventory review groups block the archive", () => {
    const toast = resolveProductArchiveFailureToast(
      new ProductArchiveBlockedError({
        openSyncedSaleInventoryReviewGroupCount: 3,
        reason: OPEN_SYNCED_SALE_INVENTORY_REVIEW_ARCHIVE_REASON,
      }),
    );

    expect(toast).toEqual({
      description:
        "Resolve 3 open sale inventory reviews for this product before archiving.",
      title: "Archiving on hold",
    });
  });

  it("keeps the single-review conflict copy singular", () => {
    const toast = resolveProductArchiveFailureToast(
      new ProductArchiveBlockedError({
        openSyncedSaleInventoryReviewGroupCount: 1,
        reason: OPEN_SYNCED_SALE_INVENTORY_REVIEW_ARCHIVE_REASON,
      }),
    );

    expect(toast.description).toBe(
      "Resolve 1 open sale inventory review for this product before archiving.",
    );
  });

  it("explains an unprovable review scan without raising alarm", () => {
    const toast = resolveProductArchiveFailureToast(
      new ProductArchiveBlockedError({
        openSyncedSaleInventoryReviewGroupCount: null,
        reason: SYNCED_SALE_INVENTORY_REVIEW_SCAN_INCOMPLETE_REASON,
      }),
    );

    expect(toast).toEqual({
      description:
        "Athena could not confirm this product's open sale inventory reviews. Try again shortly.",
      title: "Archiving on hold",
    });
  });

  it("collapses unexpected archive failures to the shared fallback", () => {
    const toast = resolveProductArchiveFailureToast(
      new Error(
        "[CONVEX M(inventory/products:archive)] Server Error: work item syncreview001",
      ),
    );

    expect(toast).toEqual({
      description: GENERIC_UNEXPECTED_ERROR_MESSAGE,
      title: GENERIC_UNEXPECTED_ERROR_TITLE,
    });
    expect(JSON.stringify(toast)).not.toContain("syncreview001");
  });

  it("reads the blocked decision off a command result without echoing server copy", () => {
    const block = productArchiveBlockFromResult({
      error: {
        code: "conflict",
        message: "Resolve 2 open sale inventory reviews before archiving.",
        metadata: {
          openSyncedSaleInventoryReviewGroupCount: 2,
          reason: OPEN_SYNCED_SALE_INVENTORY_REVIEW_ARCHIVE_REASON,
        },
        title: "Archiving on hold",
      },
      kind: "user_error",
    });

    expect(block).toEqual({
      openSyncedSaleInventoryReviewGroupCount: 2,
      reason: OPEN_SYNCED_SALE_INVENTORY_REVIEW_ARCHIVE_REASON,
    });
  });

  it("treats a successful archive result as unblocked", () => {
    expect(
      productArchiveBlockFromResult({ data: { _id: "product001" }, kind: "ok" }),
    ).toBeNull();
    expect(productArchiveBlockFromResult(null)).toBeNull();
  });
});
