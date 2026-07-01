---
title: Athena Register Closeout Shared Gate
date: 2026-07-01
category: logic-errors
module: athena-webapp
problem_type: closeout_policy_drift
component: cash-controls
symptoms:
  - "POS local-sync closeouts route every non-zero variance to manager review"
  - "Cash Controls applies configured closeout variance threshold and manager signoff flags"
  - "The closeout source path changes whether approval is required"
root_cause: pos_projection_and_cash_controls_encoded_closeout_variance_policy_separately
resolution_type: shared_closeout_gate
severity: high
tags:
  - cash-controls
  - pos
  - closeout
  - local-sync
  - approval-policy
related:
  - docs/solutions/architecture/athena-pos-closeout-hold-boundary-2026-07-01.md
  - docs/solutions/logic-errors/athena-register-closeout-generic-holds-2026-06-26.md
  - docs/solutions/logic-errors/athena-register-closeout-review-targeting-and-money-inputs-2026-06-27.md
---

# Athena Register Closeout Shared Gate

## Problem

Register closeout variance policy must not depend on whether the count came
from Cash Controls or POS local sync. Cash Controls uses store configuration for
`varianceApprovalThreshold`, `requireManagerSignoffForAnyVariance`,
`requireManagerSignoffForOvers`, and `requireManagerSignoffForShorts`. POS
projection previously treated any non-zero synced closeout variance as a
`register_closeout_variance` sync conflict.

That split created two approval rules for one drawer closeout. A variance that
Cash Controls would close below threshold could become manager-review work when
submitted through POS.

## Solution

Keep one pure server-side closeout gate in
`convex/operations/registerSessionCloseoutGate.ts`, then have Cash Controls and
POS projection both ask it for the variance decision.

The closeout decision order is:

1. Validate sync identity, duplicate, stale-session, and permission constraints.
2. Evaluate cash-affecting closeout holds.
3. If holds exist, keep submitted closeout ownership in `closing` and do not
   append final `closeoutRecords`.
4. If no holds exist, evaluate the shared variance gate.
5. If approval is not required, close the drawer and append final closeout
   history.
6. If approval is required, persist or reuse one Cash Controls-owned
   `variance_review` approval and mark the sync event `projected` with a
   closeout mapping. The unresolved business state lives on the closing register
   session through `managerApprovalRequestId`, not in a second POS sync conflict.

## POS Sync Approval Ownership

Approval-required POS closeout projection must be idempotent:

- Reuse a pending `variance_review` for the same register session and identical
  closeout facts.
- Do not create a second approval request when the same `localEventId` retries.
- Conflict/reject changed closeout facts for the same session before creating a
  new approval owner.
- Persist counted cash, expected cash, variance, notes, local event id, local
  register-session id, terminal id, closeout time, sync origin, and gate
  decision/reason in review metadata.
- Patch the register session to `closing` with `managerApprovalRequestId`,
  closeout ownership fields, counted cash, variance, and notes before treating
  the sync event as projected.

Legacy `allowRegisterCloseoutVarianceProjection` remains only for explicitly
approved historical `register_closeout_variance` conflicts. It bypasses the
variance-approval decision, not identity, duplicate, stale-session, or hold
checks.

## Prevention

- Add new closeout approval inputs to the shared gate, not directly to Cash
  Controls or POS projection.
- Keep cash-affecting holds ahead of variance approval. Holds can change
  expected cash and must defer final closure.
- Test every caller when the shared gate changes: Cash Controls submit/finalize,
  POS `register_closed` projection, deposits, Daily Close/Daily Operations
  readiness, and POS/Cash Controls presentation.
- Historical sync conflicts may keep compatibility paths, but new
  policy-managed closeouts should not create duplicate review queues.

## Related

- `docs/solutions/architecture/athena-pos-closeout-hold-boundary-2026-07-01.md`
- `docs/solutions/logic-errors/athena-register-closeout-generic-holds-2026-06-26.md`
- `docs/solutions/logic-errors/athena-register-closeout-review-targeting-and-money-inputs-2026-06-27.md`
