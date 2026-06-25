---
title: Athena Generic SKU Search Consumer Integration
date: 2026-06-25
category: architecture
module: athena-webapp
problem_type: shared_search_foundation_needs_surface_owned_adapters
component: admin-sku-search-surfaces
symptoms:
  - "Admin SKU search surfaces needed global SKU/barcode/product lookup after SKU pagination"
  - "Each surface still owned different business rules for stock blockers, procurement queues, product grouping, and picker selection"
  - "Projection freshness had to follow product, taxonomy, import, POS recovery, and quick-add write paths"
root_cause: generic_search_contract_was_available_but_consumers_needed_safe_surface_boundaries
resolution_type: generic_search_with_surface_owned_hydration_and_projection_refresh
severity: medium
tags:
  - sku
  - search
  - convex
  - admin
  - stock-adjustments
  - procurement
---

# Athena Generic SKU Search Consumer Integration

## Problem

`inventory.skuSearch.searchProductSkus` gives store-scoped global SKU lookup, but
admin consumers cannot all render the raw result directly. Stock adjustments
need reservation and blocker state, procurement needs to separate queue actions
from catalog-only matches, product search groups by product, and admin pickers
need local selection models.

Using the generic result as the source of truth inside each UI would bypass
surface-owned invariants.

## Solution

Keep the generic search result as a candidate finder, then adapt or rehydrate
inside the owning surface:

- Stock adjustments pass generic candidate SKU ids back through
  `stockOps.adjustments.listInventorySnapshotForProductSkus`, which reuses the
  stock snapshot builder for reservation labels, POS holds, checkout holds, and
  stock-adjustment blockers.
- Product and homepage pickers adapt generic results into their existing
  product/SKU row models, preserving local behavior when no generic search props
  or store opt-in is provided.
- Quick-add barcode recovery uses generic search only when an admin caller opts
  in with a store id; POS callers keep their local index path.
- Procurement uses generic matches to surface both queue-backed rows and
  catalog-only matches that have no procurement action.
- SKU activity resolves typed SKU/barcode/product queries through generic
  search first, then falls back to the direct SKU lookup when there is no
  catalog match.

## Freshness

The sidecar projection must be refreshed from every durable write path that
changes searchable SKU/product metadata:

- Product SKU create/update/delete and product visibility/taxonomy changes.
- Category, subcategory, and color label updates.
- Catalog import create/update/finalize paths.
- POS pending checkout and quick-add recovery writes that create SKUs or attach
  lookup codes.

Quantity-only movements do not need projection refresh unless the search result
contract starts ranking or filtering on quantity.

## Prevention

- Do not let UI surfaces infer stock-adjustment availability from raw generic
  search results; stock-owned queries must hydrate the final rows.
- Keep POS product entry on its local index. Generic search can support admin
  quick-add recovery, but it should not replace register-local lookup.
- Add focused tests at each mutation boundary that patches searchable fields and
  each consumer adapter that maps generic results into local row models.

## Related Validation

- `bun run --filter '@athena/webapp' test -- convex/inventory/skuSearch.test.ts convex/inventory/products.sku.test.ts convex/inventory/catalogImport.test.ts convex/stockOps/adjustments.test.ts`
- `bun run --filter '@athena/webapp' test -- src/components/products/Products.test.tsx src/components/operations/OperationsQueueView.test.tsx src/components/procurement/ProcurementView.test.tsx src/components/product/QuickAddProductDialog.test.tsx src/components/homepage/HomepageProductPickerDialog.test.tsx`
- `bun run --filter '@athena/webapp' typecheck`
- `bun run pre-commit:generated-artifacts`
