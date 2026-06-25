---
title: Athena POS Closeout Review-Only Lifecycle
date: 2026-06-25
category: logic-errors
module: athena-webapp
problem_type: lifecycle_state_error
component: pos
symptoms:
  - "A rejected register closeout with variance can make the POS drawer look active again"
  - "POS can attach new sales to a session whose closeout is already submitted for review"
  - "Opening a replacement drawer can be blocked by the previous variance closeout that should be review-only"
root_cause: sale_usable_status_reused_for_reviewable_closeout_state
resolution_type: code_fix
severity: high
tags:
  - pos
  - cash-controls
  - register-session
  - closeout
  - lifecycle
---

# Athena POS Closeout Review-Only Lifecycle

## Problem

Register session status has to answer more than one question. `active` and
`open` mean POS can sell against the session. A submitted or rejected variance
closeout means managers still need review evidence, but cashiers should not
continue selling against that same session.

The bug pattern appears when rejection or variance review uses `active` as the
escape hatch. That keeps the session easy to find in POS, but it also makes the
drawer look sale-usable and can let future sales attach to closeout evidence
that should already be frozen for review.

## Solution

Separate reviewability from sale usability:

- Introduce a distinct review-only lifecycle status, such as
  `closeout_rejected`, for rejected variance closeouts.
- Keep POS sale-usable policy centralized in shared status helpers. Only `open`
  and `active` should satisfy sale attachment.
- Keep replacement-drawer conflict policy separate from sale usability. A
  `closing` session with a submitted closeout, and a `closeout_rejected`
  session, should not block opening a new register session.
- Preserve closeout evidence when moving into review-only states. Counted cash,
  variance, notes, closeout records, trace IDs, and review references are the
  audit trail.
- If managers reopen a rejected closeout for correction, move it back to
  `closing`, not `active`, unless a separately reviewed policy explicitly allows
  returning to sale-usable work.

## Prevention

- Add tests at every sale-attachment boundary: cloud commands, local event
  projection, checkout completion, correction flows, and POS public register
  queries.
- Add cash-control and operations read-model tests that prove review-only
  sessions remain visible to managers without counting as active drawers.
- Add replacement-drawer tests that prove prior submitted variance closeouts do
  not block opening the next drawer.
- Add negative manager-review tests for reopen paths so missing or unauthorized
  proof cannot move a rejected closeout forward.
- Keep lifecycle helpers in `shared/registerSessionStatus.ts` and
  `shared/registerSessionLifecyclePolicy.ts` as the single vocabulary for POS
  usability, cash-control visibility, and replacement blocking.

## Related

- `docs/solutions/logic-errors/athena-pos-register-sync-closeout-review-recovery-2026-05-23.md`
- `docs/solutions/logic-errors/athena-cash-controls-sale-sync-review-evidence-2026-06-18.md`
- `docs/solutions/architecture/athena-pos-register-viewmodel-boundaries-2026-06-17.md`
