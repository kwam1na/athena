---
title: Athena POS Register Sync And Catalog Recovery Surfaces
date: 2026-05-26
category: logic-errors
module: athena-webapp
problem_type: pos_register_reconciliation_and_catalog_recovery
component: pos-register
symptoms:
  - "Zero-variance closeouts can sync after the server has already closed the register"
  - "Cash Controls and POS can disagree about whether a register is in closeout review"
  - "Unknown scanned barcodes force operators into product creation even when the SKU already exists"
  - "Operational workspaces drift into bespoke status and table layouts"
root_cause: register_state_and_catalog_recovery_were_split_across_ui_surfaces
resolution_type: shared_projection_and_compact_recovery_surfaces
severity: medium
tags:
  - pos
  - cash-controls
  - local-sync
  - catalog
  - operations
---

# Athena POS Register Sync And Catalog Recovery Surfaces

## Problem

The POS register and Cash Controls are two views of one drawer lifecycle. When
they independently infer closeout and sync state, the operator can see a drawer
as closed in one place, still sellable in another, or stuck in review after the
closeout already applied.

The same split showed up in catalog recovery. A scanned barcode that is not yet
linked to a SKU should give the operator a compact recovery path: attach the
barcode to an existing SKU or create the missing product. Sending every unknown
scan through full product creation creates duplicate catalog risk.

## Solution

Use shared register sync review state and idempotent projection semantics:

- Build Cash Controls and POS register state from the same local sync review
  helper so `needs_review`, closeout review, and blocked-selling states use the
  same source of truth.
- Treat zero-variance local closeout sync as idempotent when the server already
  closed the mapped register with the same counted cash and variance. The later
  uploaded `register_closed` event should create the local closeout mapping and
  project cleanly, not open a duplicate manager review.
- Keep true mismatches as review conflicts. If a later synced closeout count no
  longer matches the closed register's counted cash and variance, the conflict is
  real evidence and should not be auto-applied.
- Normalize backend conflict wording before it reaches operators. A stale
  duplicate closeout is not "more manager attention"; it is duplicate synced
  activity to reject or clear.
- In POS, block selling from the same closeout review source rather than from a
  separate register-session interpretation.

Use compact catalog recovery for unknown scanned identifiers:

- Keep a store-scoped catalog snapshot and local search index for active register
  lookup, but let the server command remain the durable authority for inventory,
  drawer, staff, and trace validation.
- When an unknown barcode is scanned, provide a compact existing-SKU link path
  before product creation. The recovery surface should search by product name or
  SKU, attach the scanned barcode to the selected SKU, and avoid redundant helper
  copy that repeats placeholders.
- Create product variants through the same quick-add command path so the new SKU
  enters the catalog snapshot and remains visible to POS and Products.

Use shared operational workspace patterns for broad store work:

- Prefer page-level operational primitives and compact review rows over bespoke
  cards or dense nested panels.
- Keep list cards scan-first: primary status, object label, count or amount, and
  one direct action. Move secondary detail behind the existing detail or trace
  routes.
- Preserve command-boundary tests when reshaping UI so inventory reservations,
  closeout state, POS item adjustments, receipt messaging, and operational work
  items remain covered by focused regressions.

## Regression Targets

- `projectLocalEvents.test.ts` should prove a synced closeout projects
  idempotently when the register is already closed with the same counted cash and
  variance, and still conflicts when the closeout differs.
- `ingestLocalEvents.test.ts` should prove sync results only return validator-safe
  mapping and conflict shapes, never raw Convex documents with system fields.
- `RegisterSessionView.test.tsx`, `CashControlsDashboard.test.tsx`,
  `POSRegisterView.test.tsx`, and `useRegisterViewModel.test.ts` should prove
  closeout review state is visible consistently and blocks register selling.
- `QuickAddProductDialog.test.tsx`, `ProductEntry.test.tsx`, and `Products.test.tsx`
  should prove unknown barcode recovery supports linking an existing SKU and
  creating a new product or variant without requiring unrelated product fields.
- Operational workspace tests should cover the route state and compact review
  row behavior, not just render snapshots.

## Prevention

- Do not add a second POS closeout status model in a view component. Add to the
  shared sync review presentation or projection layer first.
- Do not conflict duplicate closeout sync merely because the register is closed;
  compare the applied count and variance before deciding.
- Do not surface raw conflict summaries as final operator copy when the system
  knows the next action.
- Do not make barcode recovery create-only. Existing SKU linking is the safer
  first path when the catalog item already exists.
- Run `bun run pr:athena` for main-bound batches and add or update
  `docs/solutions` whenever a root-dirty delivery crosses POS sync, catalog, and
  operations boundaries.

## Related

- [Athena POS Local Sync Drains From The Hub](../architecture/athena-pos-hub-owned-local-sync-drain-2026-05-18.md)
- [Athena POS Register Search Uses A Local Catalog Index](./athena-pos-register-local-catalog-search-2026-05-04.md)
- [Athena POS Register Review And Adjusted Sale Projection](./athena-pos-register-review-and-adjusted-sale-projection-2026-05-21.md)
- [Athena POS Register Sync Closeout Review Recovery](./athena-pos-register-sync-closeout-review-recovery-2026-05-23.md)
