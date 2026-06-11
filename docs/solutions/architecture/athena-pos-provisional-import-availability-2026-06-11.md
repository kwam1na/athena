---
title: Athena POS Provisional Import Availability Keeps Sale Flow Separate From Count Finalization
date: 2026-06-11
category: architecture
module: athena-webapp
problem_type: provisional_import_pos_availability
component: pos
symptoms:
  - "Imported legacy inventory needs to be searchable in POS before final Athena counts are trusted"
  - "Trusted stock mismatches can block checkout even when field reality says the product is being sold"
  - "Inventory import review decisions can accidentally look like they mutate existing Athena SKUs"
root_cause: provisional_inventory_was_modeled_like_final_trusted_stock
resolution_type: provisional_catalog_projection_with_reviewable_stock_exceptions
severity: high
tags:
  - pos
  - inventory-import
  - provisional-stock
  - local-first
  - reconciliation
---

# Athena POS Provisional Import Availability Keeps Sale Flow Separate From Count Finalization

## Problem

During legacy inventory migration, cashiers need imported products available in
checkout before every physical count is finalized. Treating those imported rows
as normal trusted stock creates two bad outcomes:

- provisional products disappear or show as unavailable while the count is
  intentionally pending;
- trusted-stock mismatches can hard-block a real sale that should complete and
  become review evidence.

Import review decisions also need to stay attached to the provisional SKU
projection. They should not silently rewrite existing Athena SKUs while the
import remains staged.

## Solution

Model provisional import availability as a checkout projection, not as final
inventory truth:

- Store staged imported rows in the provisional import table and project them
  into POS catalog search with generated Athena SKU values.
- Preserve the import review decision as the source of the provisional SKU's
  fields until finalization. Decisions remain draftable and restageable before
  the import is finalized.
- Keep existing Athena SKUs intact. The staging flow can create or update the
  provisional projection, but final inventory replacement is a later explicit
  finalization step.
- Let POS add known provisional items without enforcing `quantityAvailable`.
  Surface `Count pending` instead of `0 available` for provisional and pending
  checkout rows whose counts are not trusted yet.
- Let trusted-stock mismatches complete the local sale. Cloud sync should mark
  the sale event for review with inventory mismatch evidence, not write drawer
  authority blocks or force the cashier into the drawer gate.
- Keep product lookup deduplicated when the same generated Athena SKU appears
  through both trusted catalog and provisional projections. Prefer trusted count
  copy when the trusted catalog row is the source of truth, and only use
  provisional availability copy when the row is actually provisional.

## Prevention

- Do not use imported legacy SKU text as the Athena SKU when creating
  provisional products. Generate Athena SKUs so staging is idempotent and does
  not collide with old-system identifiers.
- Do not show raw placeholder values such as `NULL` in POS cards or cart rows.
  Omit absent variant/category values instead.
- Do not cap checkout quantity controls for known provisional or trusted rows
  solely because `quantityAvailable` is zero. Unknown availability may still
  block because the register lacks a product identity to reconcile.
- Do not classify `transaction.completed` sync review as drawer lifecycle
  review. Drawer authority blocks are for register lifecycle events such as
  open, closeout, and reopen.
- Do not let provisional rows duplicate trusted catalog rows in search results.
  Deduplicate by product/SKU identity at the query boundary and cover both
  provisional-first and trusted-first ordering in tests.

## Validation

Use this focused slice when changing provisional import POS availability:

- `convex/inventory/catalogImport.test.ts`
- `convex/pos/application/queries/listRegisterCatalog.test.ts`
- `convex/pos/application/queries/searchCatalog.test.ts`
- `convex/pos/public/sync.test.ts`
- `src/components/operations/InventoryImportView.test.tsx`
- `src/components/pos/SearchResultsSection.test.tsx`
- `src/components/pos/CartItems.test.tsx`
- `src/components/products/ProductsListView.test.ts`
- `src/lib/pos/infrastructure/local/localCommandGateway.test.ts`
- `src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.test.ts`
- `src/lib/pos/presentation/register/useRegisterViewModel.test.ts`

Run `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json` and
`bun run pr:athena` before delivery. The sync runtime test should include a
sale inventory review conflict assertion proving no drawer authority block is
persisted.

## Related

- [Athena POS Provisional Import Trust Boundary](./athena-pos-provisional-import-trust-boundary-2026-06-10.md)
- [Athena POS Pending Checkout Item Recovery](./athena-pos-pending-checkout-item-recovery-2026-06-06.md)
- [Athena POS Offline Sales Continuity Separates Local Authority From Cloud Validation](./athena-pos-offline-sales-continuity-2026-06-04.md)
