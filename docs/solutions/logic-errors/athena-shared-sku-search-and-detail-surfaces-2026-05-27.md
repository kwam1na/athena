---
title: Athena SKU Search And Detail Surfaces Share One Matcher
date: 2026-05-27
category: logic-errors
module: athena-webapp
problem_type: shared_search_and_detail_drift
component: sku-search-and-admin-detail-surfaces
symptoms:
  - "Searching a multi-word SKU query such as hair bands returned broad category-only matches"
  - "Stock adjustment and procurement search controls repeated the same SKU filtering UI"
  - "Product, procurement, stock count, and quick-add surfaces did not expose the same SKU metadata"
root_cause: sku_search_and_presentation_logic_was_reimplemented_by_surface
resolution_type: shared_matcher_plus_shared_filter_bar_and_metadata_projection
severity: medium
tags:
  - sku
  - search
  - procurement
  - stock-adjustments
  - products
  - service-operations
---

# Athena SKU Search And Detail Surfaces Share One Matcher

## Problem

SKU search had drifted across admin surfaces. Stock adjustment and procurement
workspaces each owned their own search/filter controls, while product and SKU
tables assembled searchable metadata in slightly different ways. The shared
fuzzy scorer also treated multi-word input as an OR search: if one token matched,
the row stayed visible. That made a query like `hair bands` return every row with
`hair` in category or product metadata even when `bands` was absent.

At the same time, detail surfaces were missing fields operators needed for the
same SKU identity checks: product detail, stock count rows, attach-barcode
options, and procurement recommendations did not consistently carry size,
length, color, price, category, and barcode.

## Solution

Keep one browser-safe SKU matcher and one reusable SKU search/filter bar:

- Use `matchesSkuSearchTerms` for admin SKU/product filtering instead of local
  `toLowerCase().includes(...)` checks.
- Keep barcode-shaped queries exact so a mistyped barcode does not fuzzy-match
  numeric SKU fragments.
- Require every meaningful text query token to match somewhere in the row before
  ranking. Fuzzy tolerance still applies per token, but unmatched query words
  drop the row.
- Route stock adjustment and procurement filters through `SkuSearchFilterBar` so
  the search input, scanner slot, availability/status select, quick action, and
  result summary do not fork again.
- Include SKU detail metadata in the searchable term arrays and option labels:
  name, SKU, barcode, category, color, size, length, and price where relevant.

This makes broad category terms useful only when they are the whole query. When
operators type a product phrase, each word must be represented in the candidate
row, which keeps prod inventory counts from exploding into unrelated categories.

## Service Catalog Boundary

The same branch also normalized service-operation form handling. Keep service
catalog form helpers in a local presentation module and let Convex service
commands own durable validation, price normalization, and case/intake status
changes. Browser components should present clean operator labels and reuse the
form parser rather than duplicating raw command payload shaping in each view.

## Prevention

- Add shared matcher tests for any SKU search behavior change, especially
  multi-word queries and barcode-shaped input.
- Pair helper tests with at least one consuming surface test for stock
  adjustment, procurement, products, or quick-add when their term arrays change.
- Do not add new SKU search inputs as bespoke `Input` plus `Select` blocks when
  `SkuSearchFilterBar` can represent the workflow.
- Keep generated graphify artifacts refreshed after broad code edits.

## Related Validation

- `bun run --filter '@athena/webapp' test -- src/lib/stockOps/skuSearch.test.ts src/lib/pos/presentation/register/catalogSearch.test.ts`
- `bun run --filter '@athena/webapp' test -- src/components/operations/StockAdjustmentWorkspace.test.tsx src/components/procurement/ProcurementView.test.tsx src/components/products/Products.test.tsx src/components/product/QuickAddProductDialog.test.tsx`
- `bun run --filter '@athena/webapp' test -- convex/operations/serviceIntake.test.ts convex/serviceOps/serviceCases.test.ts src/components/services/ServiceCatalogView.test.tsx src/components/services/ServiceIntakeView.test.tsx src/components/services/ServicesWorkspaceView.test.tsx`
- `bun run pr:athena`
