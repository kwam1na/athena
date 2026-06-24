---
title: "Athena Product Page Single-SKU Provisional Trusted Finalization"
date: 2026-06-23
category: architecture
module: athena-webapp
problem_type: provisional_inventory_import
component: product-edit
resolution_type: single_sku_trusted_inventory_conversion
severity: high
tags:
  - inventory-import
  - product-edit
  - pos
  - sku-activity
  - stock-adjustments
---

# Athena Product Page Single-SKU Provisional Trusted Finalization

## Problem

Legacy import review can create an active provisional POS row for a real product
SKU before trusted stock is finalized. If product edit only saves SKU fields, the
page can look reviewed while the provisional row remains active. POS continues
using `active_provisional_import` availability, stock adjustments remain blocked,
and support cannot tell which reviewed values became the trusted baseline.

## Solution

Treat product-page finalization as a dedicated single-SKU inventory import
conversion, not as an ordinary product save:

- Bind exactly one active `inventoryImportProvisionalSku` row to the persisted
  product and SKU.
- Submit reviewed stock, quantity available, price, cost, visibility, sale
  evidence fingerprint, trusted SKU fingerprint, and conversion request id in one
  command.
- Patch the trusted SKU and close the provisional row in the same mutation.
- Mark the provisional row finalized and hidden so downstream POS and stock
  operations stop seeing provisional policy.
- Record source-aware SKU activity with the provisional row as `sourceId`,
  `sourceSurface: "product_edit"`, sale evidence, final trusted quantity, and the
  conversion idempotency key.

The reviewed product-page stock is the final trusted on-hand count. Product-page
conversion records provisional sold quantity for audit and freshness checks, but
does not subtract it again. Batch import finalization keeps its separate
semantics: imported quantity is the baseline and provisional sold quantity is
subtracted before writing trusted counts.

## Boundaries

Do not use stock adjustments as the conversion mechanism. Active provisional
rows intentionally block stock adjustments until finalization closes the
provisional lifecycle.

Do not leave finalized rows POS-available. A finalized product-page conversion
must set the provisional row to `status: "finalized"` and
`posExposureStatus: "hidden"` so register catalog, availability reads, and local
snapshots use `trusted_inventory`.

Do not make POS visibility depend on customer storefront visibility for
legacy-import cleanup anchors. Finalized legacy-import products can remain
`draft` and hidden from the storefront while POS still needs to find the trusted
SKU. POS catalog and search paths should treat `legacy-import` as a staff
operational category after the active provisional row closes, while continuing
to suppress the trusted row when an active provisional row still owns the sale
policy.

Do not require `netPrice` for POS search when register catalog rows already use
`price` as the fallback. Finalized import SKUs created from product edit may
only have `price`, and POS search, barcode lookup, and register snapshots must
agree on the sellable price rule.

Do not rely only on operational events for support review. Stock-affecting trust
transitions need SKU activity evidence even when the trusted stock delta is zero
and no inventory movement is written.

## Prevention

- Add downstream tests whenever conversion semantics change: stock adjustment
  blockers, POS catalog/availability/snapshot policy, SKU activity metadata, and
  batch import subtraction semantics.
- Keep product-page and batch import finalization tests separate because their
  quantity basis intentionally differs.
- Expected command failures must occur before any mutation writes trusted SKU
  fields, provisional lifecycle state, inventory movements, SKU activity, or
  operational events.
- Idempotent retries must reuse the same conversion request id without duplicating
  SKU activity or inventory movement evidence.
