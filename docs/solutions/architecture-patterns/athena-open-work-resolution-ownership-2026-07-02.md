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
tags:
  - athena-webapp
  - operations
  - open-work
  - work-items
  - resolution
  - convex
  - sync-conflicts
delivery_diff_fingerprint: be3af648a60da1ad1abd9cdf56464891ac18687319f716373e7d847d42cb8a2f
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
- Daily Close owns carry-forward completion and cancellation. It must consume
  manager proof bound to `daily_close_carry_forward` and the
  `dailyCloseId:sourceId` subject before mutating the row.
- Unsupported approval rows should fail closed or be suppressed. Do not surface
  `service_deposit_review` until there is a complete proof-bound source
  workflow for it.

## Why This Matters

Operators need one place to see unresolved work, but that does not mean one
mutation can safely resolve every workflow. Keeping ownership explicit preserves
audit evidence, prevents stale rows after source actions, and avoids using
receipt numbers, product names, or internal ids as accidental idempotency keys.

## Prevention

- Add source-workflow tests whenever a source action should complete, cancel,
  or continue an Open Work row.
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

- `docs/solutions/design-patterns/athena-open-work-row-context-metadata-2026-06-29.md`
- `docs/solutions/logic-errors/athena-pos-sync-review-workspace-boundaries-2026-06-19.md`
- `docs/solutions/architecture/athena-manager-approval-authority-standard-2026-07-01.md`
- `packages/athena-webapp/convex/operations/operationalWorkItems.ts`
- `packages/athena-webapp/convex/operations/openWorkInventoryReviews.ts`
- `packages/athena-webapp/convex/pos/application/sync/resolveLocalSyncReview.ts`
- `docs/solutions/logic-errors/athena-terminal-sync-review-currentness-2026-06-28.md`
- `packages/athena-webapp/src/components/operations/OperationsQueueView.tsx`
