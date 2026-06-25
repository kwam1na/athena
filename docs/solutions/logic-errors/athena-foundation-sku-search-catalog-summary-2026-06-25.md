---
title: Athena Foundation SKU Search And Catalog Summary Boundaries
date: 2026-06-25
category: logic-errors
module: athena-webapp
problem_type: catalog_search_and_metrics_drift
component: products
root_cause: workspace_owned_catalog_reads_diverged_from_foundation_sku_search_and_mutation_owned_summary_refresh
resolution_type: shared_search_read_model_and_materialized_summary_refresh
severity: medium
tags:
  - catalog
  - products
  - stock-ops
  - sku-search
  - convex
---

# Athena Foundation SKU Search And Catalog Summary Boundaries

## Problem

Catalog workspaces can drift when each surface owns its own product matching,
inventory snapshot hydration, and sidebar metrics. The products workspace used
local full-product matching while stock adjustments used a stock-ops snapshot,
so the same query could return in products but not in stock adjustments.

Metrics can drift in the other direction: switching the products landing page to
search-first removes the full product list that used to feed sidebar counts. A
new count query must not scan the full catalog on every render, but a
materialized summary is only truthful if every catalog and inventory writer keeps
it fresh.

## Solution

Use the foundation SKU search projection as the search boundary and treat
workspace-specific snapshots as hydration layers:

- Product and stock-ops search should call `inventory/skuSearch` first. Workspace
  rows may hydrate extra counts, blockers, or category labels after the
  foundation result identifies the SKU.
- Do not reintroduce a full-catalog fuzzy matcher in React to compensate for a
  missing search projection. Backfill or repair the projection instead.
- Keep exact SKU and barcode fallback bounded and indexed. Product-name fuzzy
  matching belongs in the sidecar projection, not in an ad hoc scan.

For product sidebar metrics, use a store-scoped materialized summary row:

- `getCatalogSummary` should read the materialized row in steady state and must
  not compute the full catalog inside the query. If the row is missing, return a
  stale/pending placeholder that the UI does not render as real zero metrics.
- Provide an admin repair mutation to seed or repair the row during rollout, and
  run it as part of deploying the schema change for existing stores.
- Refresh exact summary counts from admin/catalog mutation boundaries where the
  operator is already changing catalog structure.
- For hot sales, order, receiving, stock adjustment, and offline sync paths,
  mark the summary as needing refresh. Do not schedule an immediate full-store
  recompute from checkout or fulfillment; repair/backfill should run outside
  those hot paths.

## Refresh Boundaries

Refresh the catalog summary after successful writes in these families:

- product, SKU, category create/update/archive/delete paths
- inventory import apply and trusted finalization
- stock adjustments and purchase-order receiving via dirty marker
- POS sale completion, voids, item adjustments, quick-add, and offline sync via
  dirty marker
- expense completion and voids via dirty marker
- storefront fulfillment, return, exchange, and restock helpers via dirty marker
- product-edit SKU image updates

Prefer one refresh per command or per dirty store. Do not refresh inside every
line item loop unless the command has no cleaner completion boundary.

## Prevention

- Products landing should not load all products just to search or show metrics.
- Products search and stock adjustments should both resolve through foundation
  SKU search.
- Missing summary rows should not show zero as if it were accurate; seed them
  with repair/backfill and render a pending state until then.
- Inventory writers that change `productSku.inventoryCount` should update the
  out-of-stock count or mark the summary stale for async repair.
- SKU image writers should update the missing-info count.
