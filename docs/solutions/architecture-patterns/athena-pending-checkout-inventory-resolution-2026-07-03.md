---
title: Athena Pending Checkout Inventory Resolution
date: 2026-07-03
category: architecture-patterns
module: athena-webapp
problem_type: architecture_pattern
component: service_object
resolution_type: workflow_improvement
severity: high
applies_when:
  - "Finalizing POS pending checkout items from the product page"
  - "Resolving synced sale inventory review work"
  - "Linking checkout evidence to trusted catalog inventory"
tags:
  - athena-webapp
  - pos
  - pending-checkout
  - inventory
  - open-work
  - catalog
  - convex
---

# Athena Pending Checkout Inventory Resolution

## Problem

POS checkout recovery creates real sale evidence before the catalog has trusted
stock data. If product-page review, POS sync, and Open Work each invent their
own resolution rules, Athena can either trust cashier-created quantities too
early or leave inventory review work stuck after a manager has already repaired
the affected SKU.

## Solution

Keep the source of authority split by workflow:

- Product-page pending checkout finalization owns the transition from checkout
  evidence to trusted catalog inventory. It must validate the pending checkout
  item, the draft product/SKU anchors, the sale evidence fingerprint, and the
  reviewed SKU fingerprint before updating catalog fields or writing inventory
  movement.
- POS synced sale ingestion owns the durable local-to-cloud identity for skipped
  stock mutations. It should create an `inventoryReviewWorkItem` mapping for the
  completed sale so local precursor events can settle when the server accepts
  the sale with an inventory review conflict.
- Operations owns completion of synced sale inventory review work only after
  there is proof that stock has been repaired. A post-review stock movement is
  the strongest proof; a positive current SKU inventory state is an acceptable
  fallback when the movement was not attached to the original review.
- Open Work and Daily Operations should expose calm, source-aware rows with
  enough product, receipt, and provisional SKU metadata to route the operator,
  but they should not mutate catalog or inventory state directly.

The product page can reuse the existing trusted inventory preview shape for
both legacy import provisional SKUs and POS pending checkout items, but the
mutation reference must stay source-specific. Pending checkout finalization
returns the updated product/SKU state so the UI can immediately leave draft or
hidden stock copy behind after the manager commits trusted values.

## Why This Matters

The cashier flow stays unblocked while managers retain control over catalog
truth. Sale evidence remains auditable, pending checkout rows do not become
trusted stock by accident, and local POS review rows can settle without making
terminal health look blocked by inventory work that now belongs in Operations.

## Prevention

- Validate sale and SKU fingerprints before product-page finalization so stale
  product edits cannot overwrite newer catalog work.
- Write inventory movements only from manager/admin review boundaries, never
  from pending checkout sale creation or cashier reuse.
- Keep local sync settlement tests that prove inventory-review sale conflicts
  mark the sale and local precursor rows synced without persisting drawer
  authority blocks.
- Keep Open Work tests for missing stock proof, mismatched store or terminal
  context, stale work status, and already-reviewed pending checkout items.
- Keep UI tests for product-page pending checkout linking, Operations queue
  metadata, and terminal detail copy so operator surfaces do not regress into
  raw backend wording.

## Examples

A pending checkout item reviewed from the product page should call the POS
catalog finalization mutation, not a generic Open Work resolver. That mutation
patches the product, patches the SKU, records a trusted inventory movement when
the reviewed stock count changes, completes the pending checkout item, and
records an operational event tied to the original sale evidence.

A synced offline sale that skipped stock mutation should create a sale mapping
and an `inventoryReviewWorkItem` mapping:

```text
localIdKind = inventoryReviewWorkItem
localId = ${localTransactionId}:inventory-review
cloudTable = operationalWorkItem
```

When the operator later resolves the review from Operations, the resolver should
require a stock repair proof before completing the work item. It should not
require the original terminal, register session, or cloud sale ids when the work
item's metadata and affected SKU provide enough durable context to verify the
review.

## Related

- `docs/solutions/architecture-patterns/athena-open-work-resolution-ownership-2026-07-02.md`
- `docs/solutions/architecture/athena-pos-pending-checkout-item-recovery-2026-06-06.md`
- `docs/solutions/architecture/athena-pos-provisional-import-availability-2026-06-11.md`
- `docs/solutions/logic-errors/athena-terminal-sync-review-currentness-2026-06-28.md`
- `packages/athena-webapp/convex/pos/public/catalog.ts`
- `packages/athena-webapp/convex/operations/openWorkInventoryReviews.ts`
- `packages/athena-webapp/src/components/add-product/ProductStock.tsx`
