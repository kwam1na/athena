---
title: Athena Open Work Resolution Ownership
date: 2026-07-02
category: architecture-patterns
module: athena-webapp
problem_type: architecture_pattern
component: service_object
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "Adding or changing Open Work item types"
  - "Linking Operations rows to source workflows"
  - "Resolving review work created from POS sync, Daily Close, service, stock, or catalog workflows"
  - "Adding a source state that a destination workspace filters out"
tags:
  - athena-webapp
  - operations
  - open-work
  - work-items
  - resolution
  - convex
  - sync-conflicts
delivery_diff_fingerprint: 082a1b9fb1d04592ba0b2f897b6467dcb149987fe99cbf2bd1d0c27b1d59c331
---

# Athena Open Work Resolution Ownership

## Problem

Open Work is an aggregate workspace, but each row still belongs to a source
workflow with its own authority, evidence, and terminal states. Treating the
queue row as the owner of every resolution path creates stale rows, duplicate
reviews, or UI actions that send operators to the wrong workspace.

## Solution

Keep Open Work responsible for discovery, prioritization, sanitized row shape,
and cross-workflow navigation. Resolution belongs to the source workflow unless
there is a narrow Operations-owned decision with a stable source identity.

The baseline contract is:

- The queue returns sanitized row DTOs, deterministic ordering, stable
  `sourceIdentity`, and per-lane overflow metadata. UI rows should not infer
  action targets from raw metadata.
- Source workflows terminally patch their current work rows when their own
  action completes, cancels, or converts the underlying subject. Service
  appointments, service cases, purchase orders, receiving, and unresolved
  catalog decisions stay source-owned.
- POS synced inventory reviews are the exception that Operations owns.
  `synced_sale_inventory_review` is the shared synced inventory-review rail: it
  carries sale members and, since V26-1249, expense members. Each member
  declares `sourceKind` and validates against its own source. A sale member
  validates the current store, terminal, register session, sale, work item
  type/status, and canonical local mapping key
  `inventoryReviewWorkItem:${localTransactionId}:inventory-review`; an expense
  member validates store, terminal, expense session, expense transaction, and
  the key `inventoryReviewWorkItem:${localExpenseEventId}:inventory-review`
  written per terminal with no register session. A sale proof can never satisfy
  an expense member and vice versa, and a mixed-SKU logical group validates
  every member before any member is written.
- Open Work and its source conflicts settle together (V26-1248). The mutation
  that makes a synced inventory review terminal, whether a manual outcome, a
  qualifying stock adjustment, or a retry of already-terminal work, resolves the
  `posLocalSyncConflict` rows for the member's local event through the bounded,
  idempotent `resolveLocalSyncReview` primitive in the same transaction. The
  canonical mapping is the only settlement key: it must point at this exact work
  item, otherwise the settlement disposition is `unmapped` and no conflict row is
  touched. The resolution metadata and the operational event record
  `sourceSettlement` (disposition, local event ids, settled count) as the audit
  of convergence; a retry of terminal work returns `already_terminal`, keeps the
  recorded outcome, and settles only lingering rows.
- Source records may not transition into a state that hides open work from its
  destination workspace. Stock adjustments — where a sale inventory review is
  actually resolved — excludes SKUs whose product is `archived`, so product
  archival is blocked while any SKU under that product still has open or
  in-progress `synced_sale_inventory_review` work. The precondition is
  `guardProductArchiveTransition` in
  `packages/athena-webapp/convex/inventory/helpers/productArchivePrecondition.ts`,
  called by both public transitions into `archived` before any write. It is
  store-scoped, bounded, and fails closed when it cannot prove the scan saw
  every row. Blocking is returned as a `CommandResult` `user_error`
  (`conflict`), never thrown, because a thrown Convex rejection rolls back the
  `operationalEvent` row that explains it.
- Daily Close owns carry-forward completion and cancellation. It must consume
  manager proof bound to `daily_close_carry_forward` and the
  `dailyCloseId:sourceId` subject before mutating the row.
- Unsupported approval rows should fail closed or be suppressed. Do not surface
  `service_deposit_review` until there is a complete proof-bound source
  workflow for it.

## Read-Model Invariant: Counts And Destinations Must Agree

Discovery and resolution read eligibility from different places. Open Work and
the weekly `inventoryAttention` count read
`synced_sale_inventory_review` rows through
`listOpenSyncedSaleInventoryReviewGroupsWithCompleteness`
(`packages/athena-webapp/convex/operations/operationalWorkItems.ts`), while the
workspace that resolves them applies product availability filters of its own.

> Any count of actionable work and the workspace it links the operator to must
> agree on the set of actionable subjects.

When they disagree, the operator sees a number with no way to work it down.
Athena hit this in production as a **59-vs-58 mismatch**: the weekly
inventory-attention count reported one more actionable subject than Stock
adjustments could render, because a single archived product's SKU still carried
open sale inventory review work that collapsed into one attention group the
workspace filtered out. The count was right about the rows and wrong about
actionability; the archive transition was the missing guard, not the read
models.

The invariant is maintained at the source transition, not by adding filters to
the count. Filtering archived subjects out of the count would hide the work
from the one surface that was still reporting it while leaving the rows open for
Daily Close and every other consumer.

## Operator Contract

- Resolve a product's open sale inventory reviews before archiving it. Archive
  is not a way to clear the queue.
- A blocked archive returns calm, normalized copy naming how many sale
  inventory review groups are outstanding — a group is one SKU's worth of
  review work, the unit an operator actually resolves. The browser rebuilds
  that sentence from `packages/athena-webapp/shared/productArchivePolicy.ts`
  rather than rendering server wording, so no backend identifier reaches the
  operator.
- Athena will not silently complete inventory work to let an archive through.
  Completing a sale inventory review asserts a stock decision; an availability
  change carries no stock evidence, so auto-completion would write an inventory
  outcome no one made and destroy the audit trail for the real discrepancy.
- If discovery cannot prove it saw every row, the archive is refused and the
  operator is asked to retry shortly. Failing closed is preferred to archiving
  over work the scan never observed.

## Why This Matters

Operators need one place to see unresolved work, but that does not mean one
mutation can safely resolve every workflow. Keeping ownership explicit preserves
audit evidence, prevents stale rows after source actions, and avoids using
receipt numbers, product names, or internal ids as accidental idempotency keys.

It also cuts the other way: a source workflow that cannot resolve the work must
not be allowed to make it unreachable. Ownership means owning the decision,
including the decision to refuse.

## Prevention

- Add source-workflow tests whenever a source action should complete, cancel,
  or continue an Open Work row.
- Before adding a state to a source record, check every workspace that filters
  on it. If the filter would hide an open work subject, the transition must
  block, not proceed. Route every public path into that state through one guard
  and audit both the allowed and the blocked decision.
- Add negative tests for wrong terminal, wrong store, wrong source metadata,
  stale work status, and receipt-only or SKU-only matching.
- When adding a member kind to the synced inventory-review rail, give it its
  own mapping identity and validation branch and extend
  `inventoryReviewSourceMappingIdentity`; never add a parallel settlement
  helper or a new work type.
- Assert settlement evidence in tests: `settledConflictCount` on the result and
  `sourceSettlement.disposition` in the resolution metadata and event. An
  `unmapped` disposition means the mapping is wrong, not the conflict.
- Treat manager proof as consumed evidence at the command boundary that owns
  the decision.
- Keep unsupported work types out of the visible queue, or render them without
  a primary action while backend mutations fail closed.
- Preserve the existing Open Work UI direction: calm rows, type-specific copy,
  explicit next actions, and no raw proof or internal metadata in collapsed
  row content.

## Examples

When a pending checkout item is linked to a real catalog product, the POS
catalog mutation completes the matching current
`pos_pending_checkout_item_review` row. Open Work links the operator to the
unresolved catalog workflow, but it does not invent a separate review decision.

When a synced sale creates an inventory review, Operations may resolve it only
through the canonical local mapping:

```text
storeId
terminalId
localRegisterSessionId
localIdKind = inventoryReviewWorkItem
localId = ${localTransactionId}:inventory-review
```

That mapping is the durable source identity. Receipt numbers, cloud transaction
ids, and product SKU ids are useful context, not resolution keys.

When a synced expense skips a stock decrement, projection keeps the expense
transaction, creates one work item on the same rail with `sourceKind: expense`,
and maps it per terminal:

```text
storeId
terminalId
localRegisterSessionId = "" (expense events carry no register session)
localIdKind = inventoryReviewWorkItem
localId = ${localExpenseEventId}:inventory-review
```

Settlement then reads that mapping through the per-terminal index
(`by_store_terminal_localKindId`) while sale members keep the
register-session-keyed proof. Settlement is keyed by the member's local event,
so every open conflict row raised by that event settles with the work; it is
not scoped by conflict type, matching the terminal review primitive it reuses.

## Related

- `docs/solutions/architecture-patterns/athena-source-transition-operational-work-reachability-2026-08-22.md`
- `docs/solutions/logic-errors/athena-pending-checkout-archive-work-lifecycle-2026-07-04.md`
- `docs/solutions/design-patterns/athena-open-work-row-context-metadata-2026-06-29.md`
- `docs/solutions/logic-errors/athena-pos-sync-review-workspace-boundaries-2026-06-19.md`
- `docs/solutions/architecture/athena-manager-approval-authority-standard-2026-07-01.md`
- `packages/athena-webapp/convex/operations/operationalWorkItems.ts`
- `packages/athena-webapp/convex/operations/openWorkInventoryReviews.ts`
- `packages/athena-webapp/convex/inventory/helpers/productArchivePrecondition.ts`
- `packages/athena-webapp/convex/stockOps/adjustments.ts`
- `packages/athena-webapp/convex/pos/application/sync/resolveLocalSyncReview.ts`
- `docs/solutions/logic-errors/athena-terminal-sync-review-currentness-2026-06-28.md`
- `packages/athena-webapp/src/components/operations/OperationsQueueView.tsx`
