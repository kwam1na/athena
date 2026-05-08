---
title: Athena Expense Register Search Shares The POS Local Catalog Index
date: 2026-05-08
category: performance
module: athena-webapp
problem_type: shared_register_search_parity
component: expense-register-search
symptoms:
  - "Expense product entry used debounced POS server-search hooks while POS used the browser-local catalog index"
  - "The shared POS register shell had different search readiness and exact-match behavior by workflow"
  - "Expense exact matches could depend on old barcode/product search timing instead of the local catalog snapshot"
root_cause: expense_adapter_kept_legacy_server_search_after_pos_local_index_migration
resolution_type: reuse_existing_local_index_with_expense_write_boundary
severity: medium
tags:
  - expense
  - pos
  - register
  - catalog
  - local-index
  - search
---

# Athena Expense Register Search Shares The POS Local Catalog Index

## Problem

The expense register renders through the same `POSRegisterView` and product-entry
contract as POS, but it continued using `usePOSProductSearch` and
`usePOSBarcodeSearch` after POS moved to a compact register catalog snapshot and
browser-local index. That left the overlapping product-entry surface with two
search engines: POS had synchronous local exact/text lookup, while expense still
paid server-search and debounce timing.

## Solution

Keep the workflow boundary split, but share the catalog lookup path:

- Use `useConvexRegisterCatalog` for the store-scoped catalog snapshot.
- Build the local index with `useRegisterCatalogIndex`.
- Resolve text and exact identifiers with `searchRegisterCatalog`.
- Overlay availability with `useConvexRegisterCatalogAvailability` only for the
  rows currently displayed or exact-matched.
- Map catalog rows to the existing `ProductEntry` product shape through a shared
  presentation helper.

Expense still adds through `useExpenseOperations.addProduct`; it must not call
POS add-item commands, introduce POS sessions, or reintroduce drawer/register
session gates. The local index chooses the product candidate, and the expense
cart/session mutation remains the durable authority for inventory and workflow
state.

## Exact Matches

For overlapping product-entry semantics, expense should mirror POS local search:

- A single available exact match can add once and clear the query.
- Unavailable exact matches stay visible but do not auto-add.
- Ambiguous product-id or product URL matches stay visible as selectable
  variants and do not auto-add.
- A per-query/SKU guard prevents rerenders from duplicating the expense cart
  mutation.

## Prevention

- Do not reintroduce `usePOSProductSearch` or `usePOSBarcodeSearch` into active
  expense product entry.
- Keep quick-add separate; expense currently leaves it disabled.
- Keep POS drawer/session invariants out of expense unless product direction
  explicitly changes. Current expense sessions are drawerless.
- When changing shared local-index helpers, run both POS and expense view-model
  tests so parity does not drift again.

## Related Validation

- `bun run --filter '@athena/webapp' test -- src/lib/pos/presentation/expense/useExpenseRegisterViewModel.test.ts src/lib/pos/presentation/register/catalogSearch.test.ts`
- Add `src/lib/pos/presentation/register/useRegisterViewModel.test.ts` when the
  shared local-index helper or POS exact-add semantics change.

## Related Issues

- Linear: V26-510, V26-511, V26-512, V26-513.
