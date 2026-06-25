---
title: Athena Generic Product SKU Search Sidecar
date: 2026-06-25
category: performance
module: athena-webapp
problem_type: paginated_sku_lists_removed_global_search
component: convex-inventory-sku-search
symptoms:
  - "Product SKU pagination reduced Convex query load but prevented shared filter bars from searching all SKUs"
  - "Stock adjustment, procurement, quick-add, and product surfaces needed one adaptable SKU result contract"
  - "Searching by barcode, SKU, product metadata, taxonomy, or color should not require loading every SKU into the browser"
root_cause: browser_owned_sku_search_depended_on_full_sku_result_sets
resolution_type: store_scoped_convex_search_sidecar_with_canonical_hydration
severity: medium
tags:
  - sku
  - search
  - convex
  - performance
  - stock-adjustments
---

# Athena Generic Product SKU Search Sidecar

## Problem

Paginating product SKU lists solved broad Convex reads, but it removed the
ability for shared SKU filter controls to search outside the current page. The
next foundation needed to search every SKU for a store without coupling the
backend contract to the product table UI.

## Solution

Use `convex/inventory/skuSearch.ts` as the backend SKU search foundation.

- `productSkuSearch` is a derived sidecar table with exact indexes for
  productSkuId, normalized SKU, and normalized barcode, plus a store-filtered
  Convex text search index over a capped `searchText` projection.
- `searchProductSkus` accepts only `{ storeId, query, limit? }` in v1 and
  returns `{ results, limit, truncated, candidateOverflow }`.
- Search is exact-first, then text-search candidates, with dedupe by
  `productSkuId`. Direct product SKU id lookups read canonical `productSku`
  first, so exact id search can work before the sidecar is backfilled.
- Query results are hydrated from canonical `productSku` and joined product,
  category, subcategory, and color records before returning. The sidecar is
  never authoritative.
- Results intentionally include archived, draft, hidden, zero-price, and
  out-of-stock SKUs so consumers can decide how to present or filter them.

This foundation ships reusable projection maintenance helpers but does not wire
existing SKU/product/taxonomy/POS write paths yet. Follow-up integration work
must call those helpers from the relevant mutations. Until then, the repair
mutations are the deployment gate: run `repairProductSkuSearchPage` until
`isDone`, then `removeStaleProductSkuSearchPage` until `isDone`.

## Consumer Boundary

Product table search, stock adjustments, procurement, quick add, POS, and
homepage selectors should call `inventory.skuSearch.searchProductSkus` and adapt
the generic result locally. Do not add product-table-specific pagination,
visibility filtering, or UI labels to the foundation query.

## Prevention

- Keep the exported return validator on `searchProductSkus`; contract tests
  should fail when result fields are removed.
- Any future mutation that patches `productSku` fields returned by search should
  call `upsertProductSkuSearchProjection` after the patch.
- Any future mutation that changes product/category/subcategory/color labels
  shown in SKU search should refresh affected projections through the matching
  helper, then add focused write-path tests for that consumer integration.
- Keep search index tests/source guardrails in `convex/inventory/skuSearch.test.ts`.

## Related Validation

- `bun run --filter '@athena/webapp' test -- convex/inventory/skuSearch.test.ts`
- `bunx convex dev --once`
- `bun run --filter '@athena/webapp' typecheck`
- `bun run graphify:rebuild`
