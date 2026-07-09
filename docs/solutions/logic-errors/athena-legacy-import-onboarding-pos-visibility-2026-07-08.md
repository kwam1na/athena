---
title: Athena Legacy Import Onboarding POS Visibility
date: 2026-07-08
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: service_object
symptoms:
  - "A legacy import row is finalized into trusted inventory and assigned real taxonomy, but the SKU does not appear in POS register search"
  - "A hidden draft product can keep productSkuSearch.productIsVisible false after legacy taxonomy onboarding"
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
tags:
  - pos
  - inventory
  - legacy-import
  - catalog-search
---

# Athena Legacy Import Onboarding POS Visibility

## Problem

Legacy import products can start as hidden operational records. After a trusted import row is finalized and the product is assigned a normal Athena category/subcategory, the SKU must become visible in POS search.

If onboarding leaves the product hidden or draft, `productSkuSearch.productIsVisible` keeps the trusted SKU out of register search even though the inventory row is ready for sale.

## Symptoms

- A finalized trusted legacy import SKU does not appear in POS register search after taxonomy onboarding.
- The parent product has a normal category/subcategory but remains `isVisible: false` or `availability: "draft"`.
- Refreshing search projections alone does not help when the parent product visibility flags are still hidden.

## What Didn't Work

- Completing the catalog taxonomy setup work item alone was not enough because it did not promote the product's sale-facing visibility fields.
- Refreshing SKU search projections before fixing the parent product still preserved hidden product state in the projection.

## Solution

When product taxonomy moves out of the `legacy-import` category and finalized legacy import rows complete, promote the parent product to sale-facing visibility unless the current mutation explicitly requested `isVisible: false`.

The repair path should:

- promote eligible draft products to `availability: "live"`;
- set hidden onboarded products to `isVisible: true`;
- refresh every affected trusted SKU search projection;
- leave rows still in legacy taxonomy hidden, but ensure `catalog_taxonomy_setup` work remains open.

For already-onboarded rows, run the internal one-off repair after checking the dry-run output:

```bash
bunx convex run internal.inventory.catalogImport.repairOnboardedLegacyImportTrustedSkuVisibility '{"storeId":"<storeId>","dryRun":true,"limit":50}'
bunx convex run internal.inventory.catalogImport.repairOnboardedLegacyImportTrustedSkuVisibility '{"storeId":"<storeId>","dryRun":false,"limit":50}'
```

Use the production deploy flag only after confirming the dry-run result.

## Why This Works

POS search intentionally hides normal catalog products when their parent product is hidden. Legacy import taxonomy is the temporary exception that lets operators review imported stock without exposing unfinished catalog items.

Once a product leaves that legacy taxonomy, the exception no longer applies. Updating the parent product before refreshing affected SKU search projections makes the projection reflect the sale-ready state.

## Prevention

- Test taxonomy onboarding where a finalized active `inventoryImportProvisionalSku` row exists and the product starts hidden or draft.
- Assert the product becomes live/visible when a normal Athena category/subcategory is assigned.
- Assert `refreshProductSkuSearchForProduct` or the affected SKU projection refresh runs after the product visibility patch.
- Test the repair path with multiple finalized trusted SKUs on the same product so every affected SKU projection refreshes while the product patch remains deduplicated.

## Related Issues

- [Athena POS Catalog Visibility Policy](./athena-pos-catalog-visibility-policy-2026-07-08.md)
- [Athena POS Sale Inventory Review SKU Scope](./athena-pos-sale-inventory-review-sku-scope-2026-07-08.md)
