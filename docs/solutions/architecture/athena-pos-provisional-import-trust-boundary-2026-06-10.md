---
title: "Athena POS Provisional Import Trust Boundary"
date: 2026-06-10
category: architecture
module: athena-webapp
problem_type: provisional_inventory_import
component: pos
resolution_type: sale_evidence_without_trusted_stock
severity: high
tags:
  - pos
  - inventory-import
  - local-sync
  - audit
---

# Athena POS Provisional Import Trust Boundary

## Problem

Legacy inventory imports can identify real products that cashiers need to sell
before Athena has finalized trusted stock counts. Blocking checkout on zero
Athena `quantityAvailable` creates avoidable sale friction, but inflating SKU
counts with imported quantities would make unreviewed legacy data look trusted.

## Solution

Treat active provisional import rows as POS sale evidence, not trusted
inventory:

- POS sale item payloads may carry `inventoryImportProvisionalSkuId` beside the
  product and SKU identity used on the receipt.
- Local sync preserves that reference through upload, ingestion, session items,
  and transaction items.
- Projection records completed sale evidence back to the provisional import row.
- Provisional import sale lines bypass inventory holds, stock decrement, and
  trusted inventory movement creation while the row is active.
- Normal product/SKU validation still runs so the receipt points at a real
  store-owned catalog identity.

This mirrors the pending checkout item boundary, but uses the import row as the
reconciliation anchor instead of a cashier-created pending item.

## Boundaries

Do not copy imported quantities into `productSku.inventoryCount` or
`productSku.quantityAvailable` to make POS availability work. The provisional
row owns imported quantity and provisional sold quantity until an operator
finalizes the import.

Do not let finalized, rejected, or closed provisional rows bypass stock
enforcement. Once the provisional row is no longer active, POS must use normal
trusted inventory rules or another explicit review path.

Do not skip catalog identity validation. The provisional row reference explains
why stock enforcement is bypassed; it does not make arbitrary product/SKU ids
safe.

## Integration Notes

The local sync slice assumes the schema/main integration provides an
`inventoryImportProvisionalSku` table and optional
`inventoryImportProvisionalSkuId` fields on POS session and transaction items.
If generated Convex types are stale, keep adapter casts narrow and regenerate
the Convex client/types as part of the schema integration work.

## Prevention

- Add focused local-sync tests whenever provisional import payload fields change.
- Keep provisional import rows out of general storefront and trusted stock
  reporting queries until finalization.
- Record sale evidence with transaction id, quantity sold, and timestamp so
  finalization can reconcile imported quantity against actual POS sales.
- Preserve pending checkout items as the fallback for products absent from both
  Athena catalog and the provisional import.
