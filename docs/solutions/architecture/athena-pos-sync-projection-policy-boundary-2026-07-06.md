---
title: "Athena POS Sync Projection Policy Boundary"
date: 2026-07-06
category: architecture
module: athena-webapp
problem_type: architecture_pattern
component: service_object
resolution_type: code_fix
severity: high
applies_when:
  - "POS local sync projection needs to classify sale-line inventory authority"
  - "A provisional import row has become trusted inventory before an offline sale syncs"
  - "Cash Controls review is tempted to bypass an upstream projection invariant"
tags:
  - pos
  - local-sync
  - inventory-import
  - projection-policy
  - cash-controls
---

# Athena POS Sync Projection Policy Boundary

## Problem

POS local sync projection used inline checks to decide whether a sale line was
trusted inventory, active provisional import evidence, or a manager-review
conflict. That made finalized provisional import rows look like stale active
rows, so Cash Controls could not apply a reviewed sale even after the product
had become trusted inventory.

## Solution

Keep sale-line inventory authority in a projection policy module, not scattered
through persistence code or Cash Controls review code:

- Active provisional import rows remain evidence-only. Projection preserves the
  `inventoryImportProvisionalSkuId`, records sale evidence to the provisional
  row, and does not decrement trusted stock.
- Finalized provisional lineage becomes trusted demand. Projection preserves the
  lineage id on session and transaction items, but stock validation, inventory
  movements, and SKU decrement use the trusted SKU.
- If the sale occurred before the provisional row finalized, or finalized-lineage
  stock preconditions fail, projection still records the sale and creates the
  canonical `synced_sale_inventory_review` Operations work item instead of
  requiring Cash Controls manager approval.
- Invalid lineage stays blocking. Store, product, SKU, and non-finalization
  lifecycle mismatches still produce a blocking inventory conflict.

The implementation anchor is
`convex/pos/application/sync/projectionPolicies.ts`. Callers should pass the
policy map through catalog validation, inventory validation, and sale
persistence rather than re-deriving provisional behavior from the presence of an
`inventoryImportProvisionalSkuId`.

## Why This Matters

Cash Controls reviews drawer and sale-session activity. It should not be the
workspace that decides whether a SKU has become trusted inventory. Product and
inventory finalization own trust conversion; POS projection consumes that fact.

This boundary lets Athena repair finalized-lineage sales behind the scenes while
still preserving the inventory review queue for real stock uncertainty. It also
prevents a tempting broad bypass such as "manager approved inventory projection"
from masking catalog lineage bugs.

## Prevention

- Add policy-level tests for new inventory sources before changing projection
  persistence.
- Keep mixed-source checks source-aware. A finalized lineage line can mix with
  trusted inventory for the same SKU; an active provisional import line cannot.
- Preserve lineage ids on persisted sale records even when the row is now
  trusted demand.
- Use trusted SKU price as the price basis after finalization; use provisional
  imported price only while the row is active evidence.
- Route unsafe stock mutation to the canonical `synced_sale_inventory_review`
  work item so Cash Controls review can clear and Operations owns the remaining
  inventory correction.

## Examples

Before the policy extraction, projection treated all provisional ids as active
provisional sources:

```ts
!item.inventoryImportProvisionalSkuId;
```

That made finalized rows fail the stale-row guard and kept the reviewed sale in
Cash Controls.

After the extraction, projection asks the policy whether the sale line is active
provisional evidence or finalized trusted demand:

```ts
const classification = classifyProvisionalImportLineage({
  item,
  provisionalImportSku,
  saleOccurredAt: args.event.occurredAt,
  storeId: args.storeId,
});
```

Only active provisional rows record provisional sale evidence. Finalized rows
participate in trusted demand, and unsafe stock mutation creates the Operations
inventory review work item.

## Related

- [POS Sync Finalized-Lineage Remediation](../../operations/pos-sync-finalized-lineage-remediation-2026-07-06.md)
- [Athena POS Provisional Import Trust Boundary](../architecture/athena-pos-provisional-import-trust-boundary-2026-06-10.md)
- [Athena Product Page Single-SKU Provisional Trusted Finalization](../architecture/athena-product-page-single-sku-provisional-trusted-finalization-2026-06-23.md)
- [Athena POS Sync Review Workspace Boundaries](../logic-errors/athena-pos-sync-review-workspace-boundaries-2026-06-19.md)
- [Athena Open Work Resolution Ownership](./athena-open-work-resolution-ownership-2026-07-02.md)
