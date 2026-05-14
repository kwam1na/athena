---
title: Athena SKU Activity Must Explain Reservation Sources
date: 2026-05-13
category: logic-errors
module: athena-webapp
problem_type: sku_activity_traceability
component: inventory-activity
symptoms:
  - "A SKU can show available stock below on-hand stock without a source-linked explanation"
  - "POS reservations and checkout reservations use different storage models"
  - "Support inspection can require raw Convex data spelunking to identify whether stock is held, released, consumed, or unexplained"
root_cause: sku_affecting_mutations_did_not_write_one_store_scoped_source_aware_activity_trail
resolution_type: source_aware_activity_ledger_query_and_inspection_surface
severity: high
tags:
  - operations
  - inventory
  - sku-activity
  - checkout
  - point-of-sale
---

# Athena SKU Activity Must Explain Reservation Sources

## Problem

Athena has durable stock fields and workflow-specific records, but a support
operator should not have to inspect separate checkout sessions, POS holds,
inventory movements, and workflow traces to answer why a SKU is reserved.

The production shape that motivated this work was a SKU with historical POS
hold and release evidence, but a remaining `inventoryCount` and
`quantityAvailable` gap that no active source record could explain. Without a
source-aware SKU trail, the UI can either stay silent or imply a cause it cannot
prove.

## Solution

Record SKU activity at every mutation boundary that changes stock or reservation
state, then expose one read model for inspection:

- Keep `inventoryMovement` as the committed stock movement ledger.
- Use SKU activity events for transient reservations, releases, expirations,
  consumptions, and links to committed movement rows.
- Keep POS reservations and checkout reservations source-specific. POS remains
  tied to `inventoryHold`; checkout remains tied to checkout session items and
  current availability semantics until a separate migration changes that.
- Return a browser-safe view model with SKU identity, stock fields, active
  reservations by source, diagnostic warnings, and source-linked timeline rows.
- Render unexplained gaps as diagnostics. Do not invent a POS, checkout, sale,
  or stock-adjustment source when the query cannot prove one.

The inspection component is
`packages/athena-webapp/src/components/operations/SkuActivityTimeline.tsx`. It
accepts a view-model prop so the Convex query adapter can be wired at the route
or workspace boundary without coupling browser tests to generated client refs.

## Prevention

- Every SKU-affecting command path must write source-aware activity evidence in
  the same mutation boundary that changes the source record.
- Idempotent retries, cron cleanup, sync replay, and repeated command execution
  must reuse the same source/idempotency shape rather than creating duplicate
  activity rows.
- Checkout reservations must not be subtracted twice in read models:
  `quantityAvailable` already reflects checkout holds, while POS holds are
  separate ledger reservations.
- UI copy should name proven states such as `Reserved by checkout`, `Reserved by
  POS session`, `Released`, and `Consumed by sale`. Use `Unexplained
  availability gap` when stock fields disagree with active reservation evidence.

## Related Validation

- `bun run --filter '@athena/webapp' test -- src/components/operations/SkuActivityTimeline.test.tsx`
- Backend query and instrumentation changes should also run the focused Convex
  tests for the touched ledger, POS hold, checkout reservation, and movement
  files before broader package validation.
