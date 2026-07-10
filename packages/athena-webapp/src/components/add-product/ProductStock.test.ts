import { describe, expect, it } from "vitest";

import {
  buildTrustedInventoryFinalizationPayload,
  buildTrustedInventoryMoneyPayload,
  parseVariantInputValue,
  resolveTrustedInventoryCommandError,
  resolveTrustedInventoryFinalizationPricingPolicy,
  resolveTrustedInventoryRefreshReviewState,
  resolveTrustedInventoryReviewClickAction,
  resolveTrustedInventoryReviewState,
  resolvePendingCheckoutSkuLinkPriceState,
  resolveStockInputUpdate,
  resolveVariantNumericInputValue,
} from "./ProductStockInput";
import type { Product } from "~/types";
import type { ProductVariant } from "./ProductStock";
import {
  mergeProductDataWithActiveProductRefresh,
  mergeProductVariantsWithActiveProductRefresh,
  mergeTrustedInventoryFinalizationIntoProduct,
  mergeTrustedInventoryFinalizationIntoVariants,
} from "@/contexts/ProductContext";

describe("ProductStock money inputs", () => {
  it("keeps SKU and barcode inputs as text", () => {
    expect(parseVariantInputValue("sku", "ABC-123")).toBe("ABC-123");
    expect(parseVariantInputValue("barcode", "00001234")).toBe("00001234");
  });

  it("parses money fields through display-money normalization", () => {
    expect(parseVariantInputValue("netPrice", "12.34")).toBe(12.34);
    expect(parseVariantInputValue("cost", "0.75")).toBe(0.75);
  });

  it("keeps raw stock fields as raw numbers", () => {
    expect(parseVariantInputValue("stock", "12.5")).toBe(12.5);
    expect(parseVariantInputValue("quantityAvailable", "3")).toBe(3);
  });

  it("preserves blank numeric fields as unset", () => {
    expect(parseVariantInputValue("netPrice", "")).toBeUndefined();
    expect(parseVariantInputValue("stock", " ")).toBeUndefined();
  });

  it("renders zero numeric values without turning missing values into zero", () => {
    expect(resolveVariantNumericInputValue(0)).toBe(0);
    expect(resolveVariantNumericInputValue(undefined)).toBe("");
  });

  it("keeps quantity available matched to the latest stock input", () => {
    expect(resolveStockInputUpdate(9)).toEqual({
      stock: 9,
      quantityAvailable: 9,
    });
    expect(resolveStockInputUpdate(90)).toEqual({
      stock: 90,
      quantityAvailable: 90,
    });
    expect(resolveStockInputUpdate(undefined)).toEqual({
      stock: undefined,
      quantityAvailable: undefined,
    });
  });

  it("keeps hidden provisional SKUs on the make-visible step", () => {
    const state = resolveTrustedInventoryReviewState({
      binding: undefined,
      variant: {
        id: "sku-1",
        existsInDB: true,
        posVisible: false,
        stock: 4,
        quantityAvailable: 4,
        netPrice: 25,
        cost: 10,
      },
    });

    expect(state).toMatchObject({
      action: "make_visible",
      ctaLabel: "Make SKU available in POS",
      disabled: false,
      message:
        "Make this SKU available in POS before reviewing trusted inventory.",
    });
  });

  it("treats linked pending checkout provisional SKUs as reviewed", () => {
    const state = resolveTrustedInventoryReviewState({
      binding: {
        state: "unique",
        activeRowCount: 1,
        row: {
          _id: "pending-1" as never,
          importKey: "pending-checkout",
          importedQuantity: 1,
          linkedTarget: {
            isArchived: false,
            productId: "product-linked-1" as never,
            productName: "Trusted item",
            sku: "TRUSTED-1",
            skuId: "sku-linked-1" as never,
          },
          provisionalSoldQuantity: 1,
          rowNumber: 1,
          saleCount: 1,
          status: "linked_to_catalog",
        },
        saleEvidenceFingerprint: "sale-fingerprint",
        trustedSkuFingerprint: "sku-fingerprint",
      },
      variant: {
        id: "sku-1",
        existsInDB: true,
        posVisible: false,
        stock: 0,
        quantityAvailable: 0,
        netPrice: 25,
        cost: 10,
      },
    });

    expect(state).toMatchObject({
      action: "none",
      ctaLabel: "Linked to SKU",
      disabled: true,
      message: "Pending checkout item is linked to a SKU.",
      status: "success",
    });
  });

  it("requires linked pending checkout SKU prices to match", () => {
    expect(
      resolvePendingCheckoutSkuLinkPriceState({
        pendingStoredPrice: 42000,
        trustedSkuStoredPrice: 42000,
      }),
    ).toMatchObject({
      canLink: true,
      status: "match",
    });

    expect(
      resolvePendingCheckoutSkuLinkPriceState({
        pendingStoredPrice: 420,
        trustedSkuStoredPrice: 40000,
      }),
    ).toMatchObject({
      canLink: false,
      status: "mismatch",
    });

    expect(
      resolvePendingCheckoutSkuLinkPriceState({
        pendingStoredPrice: null,
        trustedSkuStoredPrice: 42000,
      }),
    ).toMatchObject({
      canLink: false,
      status: "unknown",
    });
  });

  it("routes the trusted inventory CTA through make-visible, refresh, and finalize actions", () => {
    const makeVisibleState = resolveTrustedInventoryReviewState({
      binding: undefined,
      variant: {
        id: "sku-1",
        existsInDB: true,
        posVisible: false,
        stock: 4,
        quantityAvailable: 4,
        netPrice: 25,
        cost: 10,
      },
    });

    expect(
      resolveTrustedInventoryReviewClickAction({
        reviewState: makeVisibleState,
      }),
    ).toBe("make_visible");
    expect(
      resolveTrustedInventoryReviewClickAction({
        requiresReviewRefresh: true,
        reviewState: makeVisibleState,
      }),
    ).toBe("refresh_review");

    const finalizeState = resolveTrustedInventoryReviewState({
      binding: {
        state: "unique",
        activeRowCount: 1,
        row: {
          _id: "provisional-1" as never,
          importKey: "legacy-import",
          importedQuantity: 4,
          provisionalSoldQuantity: 0,
          rowNumber: 1,
          saleCount: 0,
        },
        saleEvidenceFingerprint: "sale-fingerprint",
        trustedSkuFingerprint: "sku-fingerprint",
      },
      variant: {
        id: "sku-1",
        existsInDB: true,
        isVisible: true,
        stock: 4,
        quantityAvailable: 4,
        netPrice: 25,
        cost: 10,
      },
    });

    expect(
      resolveTrustedInventoryReviewClickAction({
        reviewState: finalizeState,
      }),
    ).toBe("finalize");
  });

  it("maps stale finalization errors to a refresh-review CTA state", () => {
    expect(
      resolveTrustedInventoryCommandError({
        kind: "user_error",
        error: {
          code: "conflict",
          message: "Provisional sales changed. Refresh and review the counts again.",
        },
      }),
    ).toEqual({
      message: "Provisional sales changed. Refresh and review the counts again.",
      requiresReviewRefresh: true,
    });

    expect(
      resolveTrustedInventoryCommandError({
        kind: "user_error",
        error: {
          code: "precondition_failed",
          message: "Clear active checkout reservations before finalizing this SKU.",
        },
      }),
    ).toEqual({
      message: "Clear active reservations before finalizing this SKU.",
      requiresReviewRefresh: false,
    });
  });

  it("refreshes the review state by dropping stale request ids and bumping the binding nonce", () => {
    expect(
      resolveTrustedInventoryRefreshReviewState({
        conversionRequestIds: {
          "sku-1": "stale-request",
          "sku-2": "other-request",
        },
        refreshNonce: 3,
        variantId: "sku-1",
      }),
    ).toEqual({
      conversionRequestIds: {
        "sku-2": "other-request",
      },
      refreshNonce: 4,
    });
  });

  it("uses the persisted product fee policy for trusted inventory finalization", () => {
    const dirtyLocalPolicy = true;
    const persistedPolicy = false;

    expect(
      resolveTrustedInventoryFinalizationPricingPolicy({
        persistedAreProcessingFeesAbsorbed: persistedPolicy,
      }),
    ).not.toBe(dirtyLocalPolicy);
    expect(
      buildTrustedInventoryMoneyPayload(
        { netPrice: 100 },
        resolveTrustedInventoryFinalizationPricingPolicy({
          persistedAreProcessingFeesAbsorbed: persistedPolicy,
        }),
      ),
    ).toMatchObject({
      netPrice: 10000,
      price: 10200,
    });
  });

  it("enables finalization only for a visible persisted SKU with one active import row and valid reviewed values", () => {
    const state = resolveTrustedInventoryReviewState({
      binding: {
        state: "unique",
        activeRowCount: 1,
        row: {
          _id: "provisional-1" as never,
          importKey: "legacy-import",
          importedQuantity: 4,
          provisionalSoldQuantity: 0,
          rowNumber: 1,
          saleCount: 0,
        },
        saleEvidenceFingerprint: "sale-fingerprint",
        trustedSkuFingerprint: "sku-fingerprint",
      },
      variant: {
        id: "sku-1",
        existsInDB: true,
        isVisible: true,
        stock: 4,
        quantityAvailable: 4,
        netPrice: 25,
        cost: 10,
      },
    });

    expect(state).toMatchObject({
      action: "finalize",
      ctaLabel: "Finalize trusted inventory",
      disabled: false,
      message: "Review stock, quantity, price, and cost before finalizing.",
    });
  });

  it("shows concrete disabled reasons for missing, ambiguous, reserved, and invalid finalization states", () => {
    const baseVariant = {
      id: "sku-1",
      existsInDB: true,
      isVisible: true,
      stock: 4,
      quantityAvailable: 4,
      netPrice: 25,
      cost: 10,
    };

    expect(
      resolveTrustedInventoryReviewState({
        binding: { state: "none" },
        variant: baseVariant,
      }).message,
    ).toBe("No active provisional import row is linked to this SKU.");

    expect(
      resolveTrustedInventoryReviewState({
        binding: { state: "ambiguous", activeRowCount: 2 },
        variant: baseVariant,
      }).message,
    ).toBe(
      "Multiple active provisional rows are linked to this SKU. Resolve the import rows before finalizing.",
    );

    expect(
      resolveTrustedInventoryReviewState({
        binding: {
          state: "unauthorized",
          message:
            "Inventory import permission is required to finalize trusted inventory.",
        },
        variant: baseVariant,
      }).message,
    ).toBe("Inventory import permission is required to finalize trusted inventory.");

    expect(
      resolveTrustedInventoryReviewState({
        binding: {
          state: "unique",
          activeRowCount: 1,
          row: {
            _id: "provisional-1" as never,
            importKey: "legacy-import",
            importedQuantity: 4,
            provisionalSoldQuantity: 0,
            rowNumber: 1,
            saleCount: 0,
          },
          saleEvidenceFingerprint: "sale-fingerprint",
          trustedSkuFingerprint: "sku-fingerprint",
        },
        reservationType: "pos",
        variant: baseVariant,
      }).message,
    ).toBe("Clear active POS holds before finalizing this SKU.");

    expect(
      resolveTrustedInventoryReviewState({
        binding: {
          state: "unique",
          activeRowCount: 1,
          row: {
            _id: "provisional-1" as never,
            importKey: "legacy-import",
            importedQuantity: 4,
            provisionalSoldQuantity: 0,
            rowNumber: 1,
            saleCount: 0,
          },
          saleEvidenceFingerprint: "sale-fingerprint",
          trustedSkuFingerprint: "sku-fingerprint",
        },
        variant: {
          ...baseVariant,
          quantityAvailable: 5,
        },
      }).message,
    ).toBe("Quantity available cannot exceed stock.");
  });

  it("distinguishes finalization pending copy from product refresh copy", () => {
    const variant = {
      id: "sku-1",
      existsInDB: true,
      isVisible: true,
      stock: 4,
      quantityAvailable: 4,
      netPrice: 25,
      cost: 10,
    };

    expect(
      resolveTrustedInventoryReviewState({
        isFinalizing: true,
        variant,
      }),
    ).toMatchObject({
      ctaLabel: "Finalizing...",
      message: "Finalizing this SKU as trusted inventory.",
      status: "pending",
    });

    expect(
      resolveTrustedInventoryReviewState({
        isRefreshing: true,
        variant,
      }),
    ).toMatchObject({
      ctaLabel: "Finalize trusted inventory",
      message: "Refreshing product inventory state.",
      status: "blocked",
    });
  });

  it("builds the product-page finalization payload with reviewed SKU values and minor-unit money fields", () => {
    const variant: ProductVariant = {
      id: "sku-1",
      sku: "ATH-001",
      barcode: "000123",
      existsInDB: true,
      isVisible: true,
      stock: 10,
      quantityAvailable: 8,
      netPrice: 45.67,
      cost: 12.34,
      images: [],
    };

    expect(
      buildTrustedInventoryFinalizationPayload({
        areProcessingFeesAbsorbed: true,
        binding: {
          state: "unique",
          activeRowCount: 1,
          row: {
            _id: "provisional-1" as never,
            importKey: "legacy-import",
            importedQuantity: 10,
            provisionalSoldQuantity: 2,
            rowNumber: 1,
            saleCount: 1,
          },
          saleEvidenceFingerprint: "sale-fingerprint",
          trustedSkuFingerprint: "sku-fingerprint",
        },
        conversionRequestId: "conversion-1",
        productId: "product-1" as never,
        storeId: "store-1" as never,
        variant,
      }),
    ).toEqual({
      storeId: "store-1",
      productId: "product-1",
      productSkuId: "sku-1",
      provisionalSkuId: "provisional-1",
      conversionRequestId: "conversion-1",
      saleEvidenceFingerprint: "sale-fingerprint",
      trustedSkuFingerprint: "sku-fingerprint",
      reviewedInventoryCount: 10,
      reviewedQuantityAvailable: 8,
      reviewedPrice: 4567,
      reviewedNetPrice: 4567,
      reviewedUnitCost: 1234,
      reviewedIsVisible: true,
      reviewedPosVisible: true,
      sourceSurface: "product_edit",
    });
  });

  it("merges trusted finalization into only the finalized SKU and preserves unrelated dirty edits", () => {
    const variants: ProductVariant[] = [
      {
        id: "sku-finalized",
        existsInDB: true,
        sku: "ATH-001-dirty",
        stock: 2,
        quantityAvailable: 1,
        netPrice: 45,
        cost: 11,
        attributes: { texture: "dirty" },
        images: [{ preview: "dirty-image.webp" }],
      },
      {
        id: "sku-other",
        existsInDB: true,
        sku: "ATH-002-dirty",
        stock: 7,
        quantityAvailable: 6,
        netPrice: 50,
        cost: 20,
        attributes: { color: "unsaved" },
        images: [{ preview: "other-dirty-image.webp" }],
      },
    ];

    const merged = mergeTrustedInventoryFinalizationIntoVariants(variants, {
      sku: {
        id: "sku-finalized",
        stock: 10,
        quantityAvailable: 8,
        isVisible: true,
      },
    });

    expect(merged[0]).toMatchObject({
      id: "sku-finalized",
      sku: "ATH-001-dirty",
      stock: 10,
      quantityAvailable: 8,
      netPrice: 45,
      cost: 11,
      attributes: { texture: "dirty" },
      images: [{ preview: "dirty-image.webp" }],
    });
    expect(merged[1]).toBe(variants[1]);
  });

  it("applies trusted inventory product status updates to the active product snapshot", () => {
    const product = {
      _id: "product-1",
      availability: "draft",
      inventoryCount: 0,
      isVisible: false,
      name: "Apron Stylist",
      quantityAvailable: 0,
      skus: [],
    } as unknown as Product;

    const merged = mergeTrustedInventoryFinalizationIntoProduct(product, {
      availability: "live",
      inventoryCount: 1,
      posVisible: true,
      quantityAvailable: 1,
    });

    expect(merged).toMatchObject({
      _id: "product-1",
      availability: "live",
      inventoryCount: 1,
      isVisible: false,
      name: "Apron Stylist",
      posVisible: true,
      quantityAvailable: 1,
    });
  });

  it("preserves dirty product and SKU edits across a post-finalization product refresh", () => {
    const previousActiveProduct = {
      _id: "product-1",
      availability: "draft",
      inventoryCount: 2,
      isVisible: false,
      name: "Body Wave",
      quantityAvailable: 2,
      skus: [
        {
          _id: "sku-finalized",
          images: [],
          inventoryCount: 2,
          isVisible: true,
          price: 3000,
          productId: "product-1",
          productName: "Body Wave",
          quantityAvailable: 2,
          sku: "BW-18",
        },
        {
          _id: "sku-other",
          images: [],
          inventoryCount: 7,
          isVisible: true,
          price: 5000,
          productId: "product-1",
          productName: "Body Wave",
          quantityAvailable: 6,
          sku: "BW-20",
        },
      ],
    } as unknown as Product;
    const nextActiveProduct = {
      ...previousActiveProduct,
      inventoryCount: 17,
      quantityAvailable: 14,
      skus: [
        {
          ...previousActiveProduct.skus[0],
          inventoryCount: 10,
          price: 4500,
          quantityAvailable: 8,
        },
        previousActiveProduct.skus[1],
      ],
    } as unknown as Product;

    const productData = mergeProductDataWithActiveProductRefresh({
      localProductData: {
        ...previousActiveProduct,
        name: "Body Wave dirty edit",
        skus: undefined,
      },
      nextActiveProduct,
      previousActiveProduct,
    });
    const variants = mergeProductVariantsWithActiveProductRefresh({
      localVariants: [
        {
          id: "sku-finalized",
          existsInDB: true,
          sku: "BW-18-dirty",
          stock: 10,
          quantityAvailable: 8,
          netPrice: 45,
          cost: 11,
          attributes: { texture: "dirty" },
          images: [{ preview: "dirty-image.webp" }],
        },
        {
          id: "sku-other",
          existsInDB: true,
          sku: "BW-20-dirty",
          stock: 7,
          quantityAvailable: 6,
          netPrice: 50,
          cost: 20,
          images: [],
        },
      ],
      nextActiveProduct,
      previousActiveProduct,
    });

    expect(productData).toMatchObject({
      inventoryCount: 17,
      name: "Body Wave dirty edit",
      quantityAvailable: 14,
    });
    expect(variants[0]).toMatchObject({
      id: "sku-finalized",
      sku: "BW-18-dirty",
      stock: 10,
      quantityAvailable: 8,
      netPrice: 45,
      cost: 11,
      attributes: { texture: "dirty" },
      images: [{ preview: "dirty-image.webp" }],
    });
    expect(variants[1]).toMatchObject({
      id: "sku-other",
      sku: "BW-20-dirty",
      stock: 7,
      quantityAvailable: 6,
    });
  });
});
