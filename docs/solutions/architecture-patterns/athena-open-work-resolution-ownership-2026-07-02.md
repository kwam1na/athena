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
- POS synced sale inventory reviews are the exception that Operations owns:
  resolution must validate the current store, terminal, register session, sale,
  work item type/status, and canonical local mapping key
  `inventoryReviewWorkItem:${localTransactionId}:inventory-review`.
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

## Related

- `docs/solutions/design-patterns/athena-open-work-row-context-metadata-2026-06-29.md`
- `docs/solutions/logic-errors/athena-pos-sync-review-workspace-boundaries-2026-06-19.md`
- `docs/solutions/architecture/athena-manager-approval-authority-standard-2026-07-01.md`
- `packages/athena-webapp/convex/operations/operationalWorkItems.ts`
- `packages/athena-webapp/convex/operations/openWorkInventoryReviews.ts`
- `packages/athena-webapp/src/components/operations/OperationsQueueView.tsx`
