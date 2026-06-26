---
title: Athena Register Closeout Generic Holds
date: 2026-06-26
category: logic-errors
module: athena-webapp
problem_type: lifecycle_state_error
component: cash-controls
symptoms:
  - "Completed synced sales with missing register-session mappings can only be rejected"
  - "Closeout finalization can run before repairable synced sale corrections settle"
  - "New cash-affecting register corrections risk adding one-off closeout gates"
root_cause: closeout_hold_logic_was_encoded_as_pending_void_specific_branches
resolution_type: shared_closeout_hold_policy
severity: high
tags:
  - cash-controls
  - pos
  - register-session
  - closeout
  - local-sync
  - approval-policy
related:
  - docs/solutions/logic-errors/athena-register-closeout-pending-void-policy-2026-06-25.md
  - docs/solutions/logic-errors/athena-cash-controls-sale-sync-review-evidence-2026-06-18.md
  - docs/solutions/architecture/athena-pos-register-lifecycle-policy-2026-06-23.md
---

# Athena Register Closeout Generic Holds

## Problem

Register closeout finalization has to wait for any unresolved work that can
change expected cash. Pending completed-sale void approvals were the first case,
but synced completed sales with a missing register-session mapping have the same
cash effect: the business sale exists and should be repaired into the drawer
rather than rejected just to clear the review.

Keeping the lock as a pending-void branch makes the next correction type easy to
miss. Closeout submission, finalization, variance review approval, local-sync
closeout projection, and deposit recording all need the same answer.

## Solution

Represent unresolved register corrections as `RegisterSessionCloseoutHold`
records:

- Each provider returns a stable `kind`, `count`, `cashAffecting` flag, and safe
  operator metadata for one register session.
- Closeout submission can still move the drawer into `closing` while
  cash-affecting holds exist. It does not inline-consume manager variance proof
  or close the drawer until the holds clear.
- Finalization, async closeout approval completion, local-sync
  `register_closed` projection, and deposit recording all call the shared hold
  helper instead of checking only pending void approvals.
- Void-only holds keep the established void-specific operator copy. Mixed or
  non-void holds use generic pending register correction copy so future
  providers do not need new closeout strings at every boundary.
- Completed-sale register mapping repair is an `apply_or_reject` sync review
  kind. Manager approval creates or reuses the missing local register-session
  mapping for the already-completed transaction, then marks the source sync
  event projected when no sibling conflicts remain.

## Prevention

- Add new cash-affecting closeout gates as hold providers, not as separate
  checks in closeout, deposit, or local-sync projection code.
- Keep hold metadata narrow. Cash Controls needs counts, kind, and safe
  references, not raw approval notes, conflict payloads, proof ids, or reviewer
  internals.
- Test every closeout closure boundary for new hold kinds: closeout submission,
  finalization, async closeout review approval, `register_closed` projection,
  and stale deposit submission.
- For repairable synced sale reviews, retain completed sale records whenever a
  unique completed transaction can be matched. Reject remains available for
  manager cleanup, but it should not be the only path.
- Closed and closeout-rejected sessions remain terminal for mapping repair.
  `closing` is allowed only while the matching local closeout evidence keeps the
  sale before the closeout in the terminal sync sequence.

## Related

- `docs/solutions/logic-errors/athena-register-closeout-pending-void-policy-2026-06-25.md`
- `docs/solutions/logic-errors/athena-cash-controls-sale-sync-review-evidence-2026-06-18.md`
- `docs/solutions/architecture/athena-pos-register-lifecycle-policy-2026-06-23.md`
