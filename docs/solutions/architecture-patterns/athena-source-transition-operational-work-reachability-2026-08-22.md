---
title: Athena Source Transition Operational Work Reachability
date: 2026-08-22
category: architecture-patterns
module: athena-webapp
problem_type: architecture_pattern
component: service_object
resolution_type: workflow_improvement
severity: high
applies_when:
  - "A source entity gains a state that a destination workspace filters out"
  - "Adding or changing product availability transitions"
  - "Adding an operational work type whose resolution workspace has its own visibility rules"
  - "Deciding whether a Convex mutation should throw or return a rejection"
tags:
  - athena-webapp
  - product-archive
  - open-work
  - operational-work
  - stock-adjustments
  - convex
  - command-result
delivery_diff_fingerprint: 082a1b9fb1d04592ba0b2f897b6467dcb149987fe99cbf2bd1d0c27b1d59c331
---

# Athena Source Transition Operational Work Reachability

## Problem

Operational work is discovered in one place and resolved in another. Open Work
and the weekly inventory-attention count both read
`synced_sale_inventory_review` rows directly, but an operator resolves a sale
inventory review inside Stock adjustments, and Stock adjustments deliberately
excludes SKUs whose product is `archived`.

That gives the product record a state transition with a side effect nobody
declared: archiving a product removes the destination for review work that is
still open. The work keeps counting, and no operator surface can render the
subject it points at. Athena hit this in production as a **59-vs-58 mismatch** —
the weekly inventory-attention count reported one more actionable subject than
the Stock adjustments workspace could show. One archived product's SKU still
carried open synced-sale inventory review rows that collapsed into a single
attention group; the count included that group, the workspace filtered it out,
and the operator had no path to close the gap.

The failure mode is general. Any transition on a *source* record that makes the
subject ineligible in a *destination* workspace will strand whatever unresolved
work points at that subject, and the mismatch surfaces as an off-by-one (or
worse) between an attention count and the queue that is supposed to satisfy it.

## Solution

Treat "does this transition strand open work?" as a precondition of the
transition itself, decided by the source workflow, before any write.

For each transition on a source record, choose exactly one of three
dispositions and make it explicit in code:

1. **Terminate the work.** The transition makes the subject genuinely
   non-actionable and the source owns a terminal outcome for it. Product
   archive does this for `pos_pending_checkout_item_review` — see
   [Athena Pending Checkout Archive Work Lifecycle](../logic-errors/athena-pending-checkout-archive-work-lifecycle-2026-07-04.md).
2. **Block the transition.** The work still needs a real operator decision with
   evidence the transition cannot supply. Product archive does this for
   `synced_sale_inventory_review`.
3. **Prove the work cannot exist.** Only valid when the transition is creation,
   not a transition of a record that could already own work.

Silently completing the work is never a fourth option. Completing a sale
inventory review without a stock decision fabricates the evidence that
resolution is supposed to carry, and it does so at exactly the moment nobody is
looking at the subject.

In Athena the blocking precondition is
`packages/athena-webapp/convex/inventory/helpers/productArchivePrecondition.ts`,
exposed as one entry point, `guardProductArchiveTransition`. Every public path
into `archived` — the dedicated `archive` mutation and the generic `update`
mutation in `packages/athena-webapp/convex/inventory/products.ts` — calls it
before it writes anything. Two entry points sharing one guard is the point: a
second unguarded transition is the same bug again.

Three properties make the guard trustworthy:

- **Every anchor counts.** Work rows attach to a product through the indexed
  `productId`, through the canonical SKU id the resolver treats as
  authoritative, or (on older rows) through `metadata.productId`. The
  precondition matches on all three; missing one makes the block bypassable.
- **It counts what an operator resolves.** Rows are collapsed into conflict
  groups using the same grouping rule Open Work uses, so the operator-facing
  count is a count of decisions, not of rows.
- **It fails closed.** Both scans are store-scoped, indexed, and bounded. Each
  reads one row past its budget; going over budget means completeness cannot be
  proven, and an unprovable scan rejects the archive rather than archiving over
  work it never saw.

### Rejections are returned, not thrown

A Convex mutation that throws rolls back its own writes. So "reject the
transition" and "audit the rejection" are mutually exclusive if you throw: the
`operationalEvent` row explaining the rejection would be rolled back with
everything else, and the block would leave no trace.

Athena therefore returns the block as a `CommandResult` `user_error` with code
`conflict`. `archive` and `update` return `ok(...)` on success for the same
reason — the two outcomes have to share a return channel. The decision is
audited on the `operationalEvent` rail either way, as
`product_availability_archive_allowed` or
`product_availability_archive_blocked`, with sanitized product, store, actor,
prior and requested availability, the group count, and whether discovery was
complete.

**Standing rule: in Convex, if a rejection must be audited, it must be
returned.** Throwing is only safe when losing the audit row is acceptable.

## Why This Matters

The read-model invariant behind all of this is simple to state and easy to
break:

> An attention count and the workspace it sends the operator to must agree on
> the set of actionable subjects. If a count can include a subject its
> destination filters out, the count is wrong and the operator has no recovery
> path.

Counting work is cheap; rendering it is subject to product state. Whenever
those two get their eligibility rules from different places, the invariant
depends on a lifecycle guarantee somewhere else in the system. Making the
source transition responsible is what keeps that guarantee local to the code
that can actually enforce it.

Blocking rather than auto-resolving also keeps the audit honest. A blocked
archive is a recorded decision an operator can act on; a silently completed
review is an inventory adjustment nobody made.

## Prevention

- When adding a state to a source record, list every workspace that filters on
  it, and every work type whose subject that filter would hide. Pick terminate
  or block for each; write the choice down.
- Route every public transition into the guarded state through a single guard
  function. Audit both directions of the decision, not just the rejection.
- Bound and index discovery scans, read one row past the budget, and reject
  when completeness cannot be proven.
- Match work to its subject on every anchor the system has written over time —
  indexed column, canonical resolver identity, and legacy metadata.
- Do not guard creation-time inserts of an already-terminal state. Creating a
  product that is already archived is not a transition of a product that could
  own work, which is why `packages/athena-webapp/convex/inventory/catalogImport.ts`
  is deliberately unguarded.
- Add a test that a count read model and its destination workspace agree for a
  subject in the newly guarded state.
- Never resolve operational work as a side effect of a state change on its
  subject unless the state change itself carries the evidence the resolution
  requires.

## Examples

The three dispositions, as product archive actually implements them:

```text
product -> archived
  pos_pending_checkout_item_review   -> terminate (cancel + clear source pointer)
  synced_sale_inventory_review       -> block     (operator must resolve first)
  catalogImport insert of `archived` -> no guard  (creation, not a transition)
```

Blocked archive, end to end:

```text
convex/inventory/products.ts (archive | update)
  -> guardProductArchiveTransition
       -> evaluateProductArchivePrecondition   (bounded, store-scoped, fails closed)
       -> recordProductArchiveDecision         (operationalEvent, allowed | blocked)
       -> userError({ code: "conflict", ... }) (returned, so the audit survives)
  -> src/lib/errors/productArchiveFailure.ts
       -> ProductArchiveBlockedError
       -> shared/productArchivePolicy.ts rebuilds the operator copy in the browser
```

The browser never renders the server's wording. It reads `reason` and
`openSyncedSaleInventoryReviewGroupCount` off the command result and rebuilds
the sentence from `shared/productArchivePolicy.ts`, so Convex and the UI cannot
drift and no backend identifier reaches the operator.

## Related

- `docs/solutions/logic-errors/athena-pending-checkout-archive-work-lifecycle-2026-07-04.md`
- `docs/solutions/architecture-patterns/athena-open-work-resolution-ownership-2026-07-02.md`
- `docs/solutions/architecture-patterns/athena-pending-checkout-inventory-resolution-2026-07-03.md`
- `docs/solutions/architecture-patterns/athena-sku-activity-untrusted-sales-read-model-2026-07-04.md`
- `packages/athena-webapp/convex/inventory/helpers/productArchivePrecondition.ts`
- `packages/athena-webapp/shared/productArchivePolicy.ts`
- `packages/athena-webapp/src/lib/errors/productArchiveFailure.ts`
- `packages/athena-webapp/convex/inventory/products.ts`
- `packages/athena-webapp/convex/stockOps/adjustments.ts`
- `packages/athena-webapp/convex/operations/operationalWorkItems.ts`
- `packages/athena-webapp/convex/reports/weekly.ts`
