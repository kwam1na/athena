---
title: Athena Pending Checkout Archive Work Lifecycle
date: 2026-07-04
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: service_object
symptoms:
  - "Archived POS pending checkout products still appeared as open review work in EOD carry-forward."
  - "The Open Work workspace and EOD review could disagree because one read model filtered archived products while another consumed stale operational work snapshots."
  - "Completed or archived pending checkout review subjects left `posPendingCheckoutItem.operationalWorkItemId` pointing at open work."
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
tags: [athena-webapp, pending-checkout, open-work, eod-review, convex]
---

# Athena Pending Checkout Archive Work Lifecycle

## Problem
POS pending checkout review work is source-owned by the pending checkout item and
its provisional product/SKU anchors. When a provisional product is archived, the
review subject is no longer actionable, but the product archive path only patched
catalog availability and refreshed projections. It did not terminally update the
associated `operationalWorkItem` rows or clear the pending item work pointer.

That allowed EOD Review carry-forward to preserve stale open work for archived
pending checkout products even after the operator-facing Open Work workspace no
longer showed the same items.

## Symptoms
- EOD Review showed many `pos_pending_checkout_item_review` carry-forward rows
  for provisional products that had already been archived.
- Open Work returned only the currently actionable synced-sale inventory review
  rows, making EOD look stale by comparison.
- `posPendingCheckoutItem.operationalWorkItemId` could continue pointing at an
  open or in-progress work row after the provisional product was archived.

## What Didn't Work
- Filtering archived provisional products out of a read model by itself. That
  hides stale work in one workspace but leaves the underlying operational work
  open for other consumers such as Daily Close.
- Treating work item metadata as the only source identity. Metadata can be stale
  or malformed; the pending checkout row's current `operationalWorkItemId`
  pointer is also part of the lifecycle contract.
- Running a mutating repair over whatever appears on a paginated query page at
  execution time. The reviewed dry-run candidates can drift before the live
  repair runs.

## Solution
Make product availability changes own the pending checkout review work lifecycle.
When a provisional pending checkout product crosses into `archived`, cancel every
matching open or in-progress `pos_pending_checkout_item_review` row and clear the
pending item pointer. When the product is unarchived, reattach existing review
work or create a fresh open review row.

The lifecycle helper should use both source anchors:

- Follow `posPendingCheckoutItem.operationalWorkItemId` first, validating store,
  type, and open/in-progress status before cancellation or reattachment.
- Also scan open/in-progress pending checkout review work by metadata to catch
  duplicate rows.
- Discover pending checkout items through targeted indexes:
  `by_storeId_provisionalProductSkuId` for SKU anchors and
  `by_storeId_provisionalProductId` for product-only anchors.
- Refresh title, priority, and metadata when reattaching an existing work row so
  Open Work and EOD see the same normalized row context.

The repair path should be dry-run first:

1. Dry run pages open or in-progress pending checkout review work and returns
   candidate work item ids plus skip reasons.
2. Mutating repair requires a `repairRunId` and explicit `workItemIds` from the
   reviewed dry run.
3. Each explicit id is revalidated for store, type, status, actionable pending
   item, valid ids, and archived provisional product before cancellation.
4. Malformed metadata is reported as a skip reason instead of aborting the batch.

## Why This Works
Open Work is an aggregate read surface, not the owner of every source workflow.
The source workflow must terminally update its own work item when the underlying
subject stops being actionable. Product archive is the transition that makes a
pending checkout provisional product non-actionable, so that transition is the
right place to cancel review work and clear the source pointer.

Following the pointer first handles the row the source currently believes is its
review work even when metadata drifted. Scanning duplicate metadata afterward
keeps older duplicate rows from surviving. Requiring explicit repair candidates
keeps production cleanup aligned with the reviewed dry-run output.

## Prevention
- Whenever a source subject becomes non-actionable, patch its current work item
  to a terminal status instead of relying on read-model filters.
- Treat `operationalWorkItemId` pointers and stable metadata identities as
  complementary; use the pointer for the current row and metadata scans for
  duplicates.
- Add lifecycle tests for both `open` and `in_progress` work statuses.
- Add repair tests for dry-run candidates, explicit mutating candidate ids,
  malformed metadata skip reasons, stale candidate scope revalidation, and
  pointer clearing.
- Keep EOD and Open Work agreement tests near source lifecycle changes so stale
  snapshots do not reappear in carry-forward workflows.

## Related Issues
- [Athena Open Work Resolution Ownership](../architecture-patterns/athena-open-work-resolution-ownership-2026-07-02.md)
- [Athena Pending Checkout Inventory Resolution](../architecture-patterns/athena-pending-checkout-inventory-resolution-2026-07-03.md)
- [Athena POS Pending Checkout Item Recovery](../architecture/athena-pos-pending-checkout-item-recovery-2026-06-06.md)
