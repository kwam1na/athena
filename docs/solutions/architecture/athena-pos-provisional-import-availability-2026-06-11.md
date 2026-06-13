---
title: Athena POS Provisional Import Availability Keeps Sale Flow Separate From Count Finalization
date: 2026-06-11
category: architecture
module: athena-webapp
problem_type: provisional_import_pos_availability
component: pos
symptoms:
  - "Imported legacy inventory needs to be searchable in POS before final Athena counts are trusted"
  - "Reserved operational categories such as legacy import or pending checkout look empty when staff views inherit storefront visibility filters"
  - "Trusted stock mismatches can block checkout even when field reality says the product is being sold"
  - "Inventory import review decisions can accidentally look like they mutate existing Athena SKUs"
root_cause: provisional_inventory_and_reserved_categories_were_modeled_like_final_storefront_catalog
resolution_type: provisional_catalog_projection_with_staff_visible_reserved_category_controls
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
- Treat reserved operational categories as staff catalog views, not storefront
  merchandising shelves. Catalog Ops and POS recovery surfaces should include
  products in those categories even when the products or categories are hidden
  from the storefront.
- Treat server-projected pending checkout anchors as reusable checkout evidence,
  not trusted stock. Those anchors are intentionally draft, hidden products with
  hidden zero-stock SKUs; register catalog predicates must still include them
  when the product belongs to the reserved `POS pending checkout` category and
  there is an active pending-review or flagged `posPendingCheckoutItem` for the
  provisional SKU.
- Carry a distinct pending-checkout availability policy through register
  catalog rows, availability rows, local snapshot cache, and product-card
  presentation. The row should be sellable as `Review pending` with
  `quantityAvailable: 0`; it should not be rendered as trusted inventory or
  blocked as out of stock.
- Keep storefront visibility as an explicit category control. Staff can hide or
  reveal the category on the customer storefront without losing access to the
  operational product list needed for cleanup.
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
- Do not reuse customer storefront hidden filters for staff catalog operations.
  Hidden storefront state is a merchandising decision; reserved-category cleanup
  and pending-checkout recovery still need the full operational list.
- Do not let a generic `draft` product filter run before the reserved pending
  checkout exception. Ordinary draft products must stay out of POS, but pending
  checkout anchors must remain searchable from other terminals after they are
  projected to the server.
- Do not fix only the fuzzy-search path. Cross-terminal pending checkout reuse
  depends on the register snapshot, requested availability, full availability
  snapshot, direct barcode/SKU lookup, and exact product-id lookup staying
  aligned.

## Validation

Use this focused slice when changing provisional import POS availability:

- `convex/inventory/catalogImport.test.ts`
- `convex/pos/application/queries/listRegisterCatalog.test.ts`
- `convex/pos/application/queries/searchCatalog.test.ts`
- `convex/pos/public/sync.test.ts`
- `convex/http/domains/core/routes/storefrontHidden.test.ts`
- `convex/inventory/products.sku.test.ts`
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
