---
title: Athena Expense Flow Follows POS Local-First Session Semantics
date: 2026-06-17
category: architecture
module: athena-webapp
problem_type: expense_local_first_sync
component: pos-expense
symptoms:
  - "Expense product adds feel slower than POS because trusted items wait on Convex"
  - "Zero-stock trusted items cannot be expensed even when the cashier is physically holding the item"
  - "Expense sessions age out while POS sessions remain recoverable"
root_cause: expense_flow_kept_cloud_mutations_as_the_cashier_success_boundary
resolution_type: architecture_pattern
severity: high
tags:
  - pos
  - expense
  - local-first
  - sync
  - inventory
  - reconciliation
---

# Athena Expense Flow Follows POS Local-First Session Semantics

## Problem

The expense register shares the cashier context with POS, but it used a different
success boundary. Trusted expense items talked to Convex during the cashier path,
while POS records local events first and syncs later. That made trusted expense
adds slower than provisional adds, blocked the trusted zero-stock physical-item
case, and let old expense sessions expire even though POS sessions do not.

## Solution

Make the expense cashier path local-first:

- Append local expense events for session start, add/update/remove/clear,
  hold/resume, cancel/void, and completion.
- Render the active and held expense session from a local read model before
  cloud state.
- Use the local event append as the cashier success boundary. Convex projection
  is a sync concern, not the interaction boundary.
- Keep expense sessions non-expiring like POS. Old active and held sessions
  remain visible unless explicitly completed, canceled, voided, or expired by
  status.
- Preserve POS availability exceptions in expense search and cart lines:
  trusted inventory, active provisional import, and pending checkout sources are
  distinct source keys.
- Allow trusted zero-available exact matches locally when the cashier is
  physically holding the item, then route insufficient cloud stock to review
  evidence during projection.

## Inventory Projection

Expense projection must not convert exception sources into trusted stock:

- Pending checkout and provisional import expense lines preserve their source ids
  and never decrement trusted inventory.
- Trusted inventory lines decrement cloud stock only when aggregate requested
  quantity for that SKU is covered by both `inventoryCount` and
  `quantityAvailable`.
- Duplicate trusted SKU lines in one expense are aggregated before conflict
  checks and before product SKU patches.
- If trusted cloud stock is insufficient, preserve the completed local expense,
  mark trusted lines as no-hold, skip SKU patches, and create non-blocking review
  evidence with the requested quantity and cloud stock values.
- Reject a line that claims both `pendingCheckoutItemId` and
  `inventoryImportProvisionalSkuId`; a line has exactly one exception source.

## Boundaries

This pattern aligns expense with POS local-first semantics, but it does not make
expense a sale. Expense completion does not create customer receipts, payments,
or cash-control movements. It creates expense session, session item, transaction,
transaction item, mapping, and review evidence records during sync projection.

Do not reintroduce timestamp expiry as a hidden cleanup path. Cleanup can release
trusted inventory only when a session was explicitly canceled, voided, or
completed according to durable state.

## Prevention

- Keep expense local ids distinct from Convex ids until sync mappings return.
- Scope local expense replay by store, terminal, staff profile, and register.
- Keep source-aware cart matching; SKU-only matching collapses trusted,
  provisional, and pending lines incorrectly.
- Gate trusted stock projection on aggregate quantity per SKU, not per line.
- Use both `inventoryCount` and `quantityAvailable` before applying trusted
  stock effects.
- Run changed expense local tests, sync projection tests, changed-file lint, and
  graphify after changing this boundary.

## Related Issues

- Linear: V26-757, V26-758, V26-759, V26-760, V26-761, V26-762, V26-763.
