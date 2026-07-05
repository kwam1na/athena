---
title: Athena Legacy Import Cleanup Uses Product-Level Row Caps
date: 2026-07-05
category: performance-issues
module: athena-webapp
problem_type: performance_issue
component: database
symptoms:
  - "Product taxonomy cleanup can accidentally probe every SKU and every active provisional row in one Convex mutation"
  - "Ordinary product saves can inherit expensive legacy-import guard reads when trusted finalization state is checked SKU-by-SKU"
root_cause: missing_index
resolution_type: code_fix
severity: high
tags:
  - convex
  - inventory-import
  - product-taxonomy
  - stock-adjustments
  - read-amplification
---

# Athena Legacy Import Cleanup Uses Product-Level Row Caps

## Problem

Legacy import finalization and taxonomy cleanup often start from a product page,
but the active evidence rows live in `inventoryImportProvisionalSku`. A naive
implementation walks every `productSku` for the product and then probes active
provisional rows per SKU, which turns an ordinary product save or taxonomy save
into a nested read-amplification path.

## Symptoms

- A product with many SKUs could make `products.update` perform thousands of
  indexed SKU probes before deciding whether a legacy-import taxonomy save is
  allowed.
- `completeFinalizedLegacyImportRowsForProductTaxonomyWithCtx` could read a
  large per-SKU row page for every SKU before completing catalog setup.
- Reviewer checks correctly flagged that cap-plus-one reads were fail-closed but
  still too large for a single Convex mutation.

## What Didn't Work

- Adding only a SKU-count overflow guard made correctness fail closed, but it
  kept the nested SKU loop and left a large read surface in the mutation.
- Keeping the provisional-row cap at the same 5000-row import finalization limit
  was appropriate for batch import finalization, but too high for an ordinary
  product taxonomy cleanup.

## Solution

Index active provisional import rows by store, product, and status:

```ts
inventoryImportProvisionalSku: defineTable(inventoryImportProvisionalSkuSchema)
  .index("by_storeId_productId_status", ["storeId", "productId", "status"]);
```

Use that index for product-level guards and cleanup. Product update only needs
to know whether active finalized legacy rows exist or whether the bounded row
page overflowed:

```ts
const rows = await ctx.db
  .query("inventoryImportProvisionalSku")
  .withIndex("by_storeId_productId_status", (q) =>
    q
      .eq("storeId", storeId)
      .eq("productId", productId)
      .eq("status", "active"),
  )
  .take(PRODUCT_UPDATE_LEGACY_FINALIZED_ROW_SCAN_LIMIT + 1);
```

Catalog taxonomy cleanup uses the same product-level index with a small
cleanup-specific cap. If the product still has too many active rows to finish in
one mutation, throw a visible error instead of silently doing partial cleanup or
reading a large nested set:

```ts
if (rows.length > CATALOG_TAXONOMY_FINALIZATION_ROW_LIMIT) {
  throw new Error(
    "Cannot complete catalog setup because this product has too many active legacy import rows to finalize safely.",
  );
}
```

## Why This Works

The product page is the aggregate boundary for taxonomy setup. Querying active
legacy rows by product directly matches that boundary and avoids converting a
product-scoped operation into `productSku * provisionalRows` work. The small
cap keeps ordinary saves and taxonomy completion within a predictable mutation
budget while still failing closed when cleanup needs a batched workflow.

## Prevention

- When a Convex mutation is product-scoped, prefer a product-level index over
  nested per-SKU probes.
- Keep guard caps separate from batch import caps. Batch import finalization can
  have a larger explicit import limit; product update and taxonomy cleanup need
  small caps because they run on ordinary operator saves.
- Add regression tests for both branches: active finalized row detection and
  overflow fail-closed behavior.
- Re-run `bunx convex codegen`, focused Vitest files, `bun run typecheck`, and
  `bun run graphify:rebuild` after adding a Convex index.

## Related Issues

- `docs/solutions/performance/athena-convex-read-amplification-2026-06-29.md`
- `docs/solutions/architecture/athena-product-page-single-sku-provisional-trusted-finalization-2026-06-23.md`
