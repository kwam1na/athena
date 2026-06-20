---
title: Athena POS Cashier Continuity Uses Review Deferral For Recoverable Invariants
date: 2026-06-20
category: architecture
module: athena-webapp
problem_type: pos_cashier_continuity_review_deferral
component: pos
symptoms:
  - "A cashier can encounter a recoverable invariant mismatch while completing an otherwise recordable sale"
  - "A client-side guard can block the cashier even though sync review can preserve the evidence for later manager resolution"
  - "Review rows can say a sale was rejected without showing the collected amount versus the expected sale total"
root_cause: cashier_flow_guards_were_treated_as_cloud_sync_invariants_instead_of_deferrable_review_evidence
resolution_type: best_effort_local_repair_with_review_deferral
severity: high
tags:
  - pos
  - local-first
  - cash-controls
  - local-sync
  - review
---

# Athena POS Cashier Continuity Uses Review Deferral For Recoverable Invariants

## Problem

Cashier-facing POS flows were treating recoverable cloud sync invariants as
hard completion blockers. That meant a sale with durable local evidence could
stop the cashier even though Athena had enough context to complete locally,
upload the event, and let Cash Controls manager review resolve the mismatch
later.

The same gap made review rows under-explain payment mismatches: managers could
see that a sale was rejected, but not the collected payment amount compared
with the expected sale total.

## Solution

POS should block the cashier only when continuing would lose required local
data, corrupt the local event log, violate drawer authority, or make the sale
unrecoverable. If Athena can durably record what the cashier did and a later
manager review can resolve the invariant, keep the cashier moving and promote
the issue into review with enough context to explain the decision.

This is a product rule, not only an error-handling preference. The POS is
local-first: cashier continuity is the default, and review is the preferred
path for recoverable mismatches.

## Pattern

- Attempt deterministic local repair first when the repair is safe and durable.
  For example, when a non-cash payment is greater than the current cart total
  after the cart is reduced, reduce the non-cash payment to the payable total.
- Do not silently invent cash behavior. Cash overpayment remains a change-due
  state because change can be handed back at the register.
- If the deterministic repair cannot be persisted locally, do not block sale
  completion only to satisfy a cloud sync invariant. Complete the sale with the
  evidence Athena has and let sync create the review item.
- Review evidence must explain the mismatch in operator terms: collected
  amount, expected sale total, payment method, receipt, cashier, completed time,
  upload order, item count, item lines, and the reason the sale needs review.
- When manager review approves a rejected non-cash overpayment, projection
  should apply the expected sale total as the collected amount. The overpaid
  local payment remains review evidence; it should not be replayed into the
  transaction ledger.
- Cash Controls should present the reviewed sale as a decision with evidence,
  not as raw backend wording. A manager should not need a support trace to see
  that Mobile Money collected `GHc1,895` against an expected sale total of
  `GHc1,850`.
- Cash Controls copy should describe the affected register session. Do not
  imply the drawer is closed unless the session status or closeout evidence
  specifically proves that state.

## Current Example

A cashier can add a non-cash payment, then reduce the cart total before
completion. The original payment entry flow correctly prevented entering more
than the cart total at the time of entry, but the cart mutation can make the
existing non-cash payment greater than the new total.

The desired behavior is:

- While the sale is still open, Athena automatically normalizes non-cash
  overpayment when it can persist the updated payment state.
- At completion, Athena repeats that normalization as a final best-effort
  repair.
- If that repair cannot be persisted, Athena still completes the sale locally
  and uploads the original payment evidence.
- Cloud sync can then reject the sale into Cash Controls review, where the
  review item must show the collected amount versus the expected total.
- Manager approval applies the expected sale total as the collected amount, so
  the reviewed transaction reconciles without carrying forward the cashier's
  stale non-cash payment amount.

## Implementation Anchors

- `src/lib/pos/domain/payments.ts` owns deterministic payment normalization
  through `normalizeNonCashOverpayment`.
- `src/lib/pos/presentation/register/useRegisterViewModel.ts` runs the
  non-cash normalization when the payable total changes and again during final
  completion. The final completion path is best effort: failed repair
  persistence does not block the cashier.
- `convex/pos/application/sync/ingestLocalEvents.ts` owns server validation
  that can reject unreconciled payment mismatches into review.
- `convex/pos/application/sync/projectLocalEvents.ts` owns reviewed projection
  of rejected non-cash overpayments by capping collected payments to the
  expected sale total when Cash Controls approves the review.
- `convex/pos/application/sync/registerSessionSyncReview.ts` and
  `src/components/cash-controls/RegisterSessionView.tsx` promote rejected sale
  details into manager-readable review evidence.

## Regression Targets

- `src/lib/pos/domain/cart.test.ts` should cover non-cash overpayment
  normalization, zeroed non-cash payment removal, and cash overpayment
  preservation.
- `src/lib/pos/presentation/register/useRegisterViewModel.test.ts` should prove
  cart-total reductions adjust non-cash payments when persistence succeeds and
  still complete the sale when final adjustment persistence fails.
- `src/components/cash-controls/RegisterSessionView.test.tsx` should prove
  payment mismatch review rows show the collected payment amount against the
  expected sale total.
- `convex/pos/application/sync/projectLocalEvents.test.ts` should prove
  reviewed non-cash overpayments project at the expected sale total without
  increasing expected cash.

## Prevention

- Before adding a cashier-facing POS blocker, decide whether the state is
  unrecoverable locally or merely unreconciled for sync. Only the first category
  should block by default.
- Keep review payloads rich enough for a later decision. Deferring without
  receipt, cashier, tender, totals, item lines, and reason only moves confusion
  from POS to Cash Controls.
- Prefer review deferral for cloud-only invariants, late synced sales,
  manager-owned reconciliation, and anomalies where the local event can still be
  recorded faithfully.
- Add a regression for both paths whenever a repair is introduced: the repaired
  durable path and the unrepaired review-deferral path.
