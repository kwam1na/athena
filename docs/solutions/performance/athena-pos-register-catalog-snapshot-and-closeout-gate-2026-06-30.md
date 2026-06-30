---
title: Athena POS Register Catalog Uses Projection Snapshots
date: 2026-06-30
category: performance
module: athena-webapp
problem_type: performance_issue
component: database
symptoms:
  - "Convex warned that pos/public/catalog:listRegisterCatalogSnapshot was nearing the single-function read limit"
  - "The register closeout sync gate could take over the full POS body instead of preserving the register shell"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - convex
  - performance
  - pos
  - catalog
  - closeout
---

# Athena POS Register Catalog Uses Projection Snapshots

## Problem

The POS register catalog snapshot is a register boot hot path. It must not scan
every SKU and then read each related product, category, color, and provisional
import row one document at a time.

The same register boot surface can also show blocking local runtime states. A
local closeout sync gate should block sale actions without replacing the POS
shell context that cashiers use to orient themselves.

## Symptoms

- Convex emitted `Many reads in a single function execution` for
  `pos/public/catalog:listRegisterCatalogSnapshot`.
- The warning reported roughly 3,472 reads against a 4,096 limit on a local
  register catalog load.
- The locally closed pending sync gate rendered as a full-width screen, hiding
  the customer/totals strip and cart/payment rail used by other drawer gates.

## What Didn't Work

- Bounded frontend search and local IndexedDB caching did not remove the backend
  warning because the snapshot query itself still hydrated catalog rows from
  `productSku` plus per-row related documents.
- Treating the closeout sync state as a special full-body workspace solved the
  block but diverged from the drawer gate interaction pattern.

## Solution

Build the register catalog snapshot from the already-denormalized
`productSkuSearch` projection:

- Query `productSkuSearch.by_storeId` once for the store.
- Filter trusted register rows from projection fields such as
  `productAvailability`, `productIsVisible`, `categorySlug`, and `isVisible`.
- Map register catalog row fields directly from projection fields such as
  `productName`, `categoryName`, `colorName`, `images`, `price`, and `netPrice`.
- Read active provisional imports separately and hydrate them from matching
  projection rows when available.
- Keep explicit category reads only for pending checkout item labels, and cache
  those category documents by id.

For the local closeout sync UI, keep the gate inside
`register-main-workspace`. Do not special-case it as a two-column full-body
state. The POS header, customer attribution, totals strip, empty cart, and
payment rail should remain visible while sale entry/search actions stay blocked.

## Why This Works

The search projection already carries the denormalized fields needed by the POS
catalog row. Reusing it converts the snapshot from many per-row document reads
into one store-scoped projection read plus the small amount of pending-checkout
and provisional-import evidence that is genuinely separate.

Keeping the local closeout sync state in the main workspace also matches the
drawer gate contract: the gate owns the action area, not the whole POS shell.
That preserves operator context while still preventing new sale work until the
closeout sync state clears.

## Prevention

- Do not rebuild POS catalog snapshots from `productSku` plus per-row product,
  category, and color reads when a denormalized projection already exists.
- Add high-cardinality tests that fail if register catalog snapshot generation
  reads once per SKU through related documents.
- Keep POS blocker states inside the established shell unless the blocker is
  truly outside register context, such as store-day setup.
- Run focused tests for both backend read shape and frontend shell layout before
  rerunning `pr:athena`.

## Related Validation

- `bun run test -- convex/pos/application/queries/listRegisterCatalog.test.ts -t "uses the catalog snapshot to avoid reading every active SKU"`
- `bun run test -- src/components/pos/register/POSRegisterView.test.tsx -t "locally closed sync gate"`
- `bun run --filter '@athena/webapp' typecheck`
- `bun run pr:athena`

## Related

- `docs/solutions/performance/athena-convex-read-amplification-2026-06-29.md`
- `docs/solutions/logic-errors/athena-pos-synced-closeout-readiness-2026-06-17.md`
