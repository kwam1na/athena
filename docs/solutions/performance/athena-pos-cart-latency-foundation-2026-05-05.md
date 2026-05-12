---
title: Athena POS Cart Operations Avoid Full-Catalog Reactivity
date: 2026-05-05
category: performance
module: athena-webapp
problem_type: hot_path_reactivity
component: pos-cart
symptoms:
  - "POS cart add, quantity, and remove operations felt slow in production stores with many SKUs"
  - "Cart edits patched productSku.quantityAvailable and invalidated full-store register catalog subscriptions"
  - "Existing cart-line lookup scanned session items instead of using a session-plus-SKU index"
root_cause: cart_hold_writes_mutated_full_catalog_read_model
resolution_type: read_model_split_plus_hold_ledger
severity: high
tags:
  - pos
  - register
  - cart
  - inventory
  - convex
  - performance
---

# Athena POS Cart Operations Avoid Full-Catalog Reactivity

## Problem

The active register is a production hot path. A cashier changing one cart line
should create work proportional to that cart line, not proportional to the
store's whole SKU catalog.

The register catalog snapshot originally included volatile availability fields.
POS cart holds patched `productSku.quantityAvailable` during add, update, and
remove. Because the register subscribed to the full store catalog, each cart
hold could invalidate and rerun the large catalog query in production.

## Solution

Keep the register search index stable and make cart operations optimistic:

- Build local search from metadata-only catalog rows.
- Fetch availability through a bounded query for the displayed or exact-match
  skus.
- Compute bounded availability through the same hold-aware availability helper
  used by POS commands.
- Represent POS cart holds as `inventoryHold` rows instead of patching
  `productSku.quantityAvailable` while the cart is being edited.
- Consume holds during session completion, and decrement SKU inventory exactly
  once at the sale boundary.
- Release or expire POS ledger holds without restoring `productSku.quantityAvailable`;
  ledger holds never subtracted that field during cart editing, so adding it
  back can make available quantity exceed on-hand quantity.
- Find existing cart lines with `posSessionItem.by_sessionId_productSkuId`.

The UI may update instantly, but command success remains the durable truth.
Rollback optimistic state on inventory, drawer, staff, or session conflicts.

## Compatibility

Keep legacy expense-session helper calls compatible until those flows are
migrated. The POS session path should use ledger-backed hold arguments; legacy
quantity-patch calls can remain for older non-POS callers as long as tests
protect the difference.

When deploying across active POS sessions, avoid double-consuming inventory:
session completion should only subtract `quantityAvailable` for rows backed by a
consumed POS hold. Legacy sessions that already patched availability during cart
editing still decrement `inventoryCount` at completion, but do not subtract
availability a second time.

Do not route POS release, void, clear-cart, manual expiry, cron expiry, or
cashier-recovery expiry through a quantity-patch fallback. If a matching ledger
hold is expired, terminalize the hold as expired and leave SKU availability
unchanged. If a ledger hold is missing during non-completion cleanup, complete
the cleanup without compensating stock availability. Completion is different: it
must reject missing or expired required ledger holds before creating the sale.

## Prevention

- Do not add cart-mutated fields back to the full-store register catalog
  snapshot.
- Put volatile availability behind bounded SKU-id queries.
- Keep cart mutations behind command validation and optimistic rollback tests.
- Add schema/index tests for hot-path lookup indexes.
- Add release-path tests that prove expired POS ledger holds do not restore SKU
  availability.
- Run graphify after changing these command/read-model boundaries.

## Related Issues

- Linear: V26-469, V26-470, V26-471, V26-472, V26-473.
