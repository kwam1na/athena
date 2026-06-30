---
title: Athena Duplicate POS Session Sale Review Preservation
date: 2026-06-30
category: logic-errors
module: athena-webapp
problem_type: duplicate_pos_session_sale_review_conflation
component: cash-controls
symptoms:
  - "Cash Controls combines duplicate register-opening evidence with a synced sale that reused the same local POS session id"
  - "Rejecting the visible duplicate-opening review can also clear sale evidence that should remain a business fact"
  - "A preserved sale can appear to require reusing or mutating the duplicated POS session"
root_cause: duplicate_local_id_review_classification_treated_register_lifecycle_and_sale_projection_as_one_decision
resolution_type: scoped_review_kind_and_sale_preservation_projection
severity: high
tags:
  - cash-controls
  - local-sync
  - pos
  - review
  - business-facts
---

# Athena Duplicate POS Session Sale Review Preservation

## Problem

Offline POS sync can report one local event with two different facts:

- duplicated register lifecycle evidence, such as a reused local register
  session id or duplicate register opening;
- a completed sale that used a local POS session id already mapped to another
  transaction.

Those facts require different review actions. Duplicate register-opening
evidence is reject-only because applying it would reuse drawer lifecycle state.
The completed sale is a business fact: if the receipt is valid, manager review
must preserve it without reusing the duplicated POS session.

When both facts are collapsed into generic `duplicate_local_id` review, the UI
can surface the wrong action and the resolver can clear sale evidence while the
operator thinks they are only rejecting duplicate opening evidence.

## Solution

Classify the sale conflict separately from duplicate register-opening evidence:

- `duplicate_register_open` remains reject-only.
- `duplicate_pos_session_sale` is apply-or-reject.
- The resolver must group open same-event sale conflicts before approval so the
  sale projects once and sibling conflicts do not remain stale.
- Approving `duplicate_pos_session_sale` lets the projector create the completed
  transaction with no `posSession.sessionId` reuse when the local POS session id
  is already owned by another transaction.
- Rejecting duplicate sale evidence may restore an already projected event only
  when a transaction or receipt mapping proves the completed transaction already
  exists on the target register session. Unprojected evidence should remain
  rejected.
- UI actions should send the grouped sale-review conflict ids for approval, but
  duplicate register-opening evidence should remain an evidence-only, reject
  path.

Keep permission, terminal, staff, and register-number guards ahead of the
duplicate POS-session preservation bypass. The bypass is only for the reused
local POS session id; it is not general permission repair.

## Regression Targets

- `convex/pos/application/sync/registerSessionSyncReview.ts` should classify
  duplicate POS-session sale conflicts by structured detail and legacy summary
  text.
- `convex/pos/application/sync/projectLocalEvents.test.ts` should prove an
  approved duplicate POS-session sale creates a completed transaction without
  patching or reusing the existing POS session.
- `convex/cashControls/deposits.test.ts` should prove approval resolves grouped
  same-event sale review conflicts together, rejects partial approval with a
  clear precondition, and preserves already projected completed-sale facts only
  when the mapping proves they exist.
- `src/components/cash-controls/RegisterSessionView.test.tsx` should prove
  duplicate-opening evidence is shown separately from synced sale preservation
  and that the preserve action submits grouped review ids.
- `src/lib/pos/presentation/syncStatusPresentation.test.ts` should prove
  duplicate POS-session sale copy does not fall back to duplicate register
  opening copy.

## Prevention

- Do not decide Cash Controls review behavior from `conflictType` alone when a
  structured `reviewKind` can distinguish lifecycle evidence from sale facts.
- Do not clear or reject sale business facts as a side effect of resolving
  duplicate register lifecycle evidence.
- Do not reuse a duplicated local POS session id to preserve a sale. Preserve the
  transaction and receipt mapping, not the conflicting local session identity.
- Prefer grouped same-event approval for sale projection. A sale with multiple
  open review items should either project once or not project at all.

## Related

- [Athena POS Sync Review Workspace Boundaries](./athena-pos-sync-review-workspace-boundaries-2026-06-19.md)
- [Athena POS Terminal Recovery Readiness Boundary](../architecture/athena-pos-terminal-recovery-readiness-boundary-2026-06-14.md)
