---
title: Athena Register Closeout Pending Void Policy
date: 2026-06-25
category: logic-errors
module: athena-webapp
problem_type: lifecycle_state_error
component: cash-controls
symptoms:
  - "Queued completed-sale void approvals fail after closeout submission"
  - "Cash Controls can close a register before pending void approvals update expected cash"
  - "A stale Cash Controls form can try to record deposits while void review is pending"
root_cause: void_application_reused_pos_sale_usable_register_status_while_closeout_finalization_ignored_pending_void_approvals
resolution_type: code_fix
severity: high
tags:
  - cash-controls
  - pos
  - register-session
  - closeout
  - voids
  - approval-policy
related:
  - docs/solutions/logic-errors/athena-pos-completed-transaction-void-reversal-2026-05-21.md
  - docs/solutions/logic-errors/athena-pos-closeout-review-only-lifecycle-2026-06-25.md
  - docs/solutions/architecture/athena-pos-register-lifecycle-policy-2026-06-23.md
---

# Athena Register Closeout Pending Void Policy

## Problem

Completed-sale void replay and register closeout finalization are different
lifecycle decisions. A register session in `closing` is no longer sale-usable,
but it can still need an approved void so expected cash and variance remain
accurate before the final close.

The bug pattern appears when queued void approval replay reuses POS sale
usability, while Cash Controls finalization ignores pending
`pos_transaction_void` approvals. That combination can block the valid approved
void with drawer-closed copy, or close the register before pending void review
has updated the cash ledger.

## Solution

Use separate named policies for sale usability, void application, and final
closeout:

- Sales require an `open` or `active` drawer.
- Approved completed-sale void application allows `open`, `active`, and
  `closing`.
- `closed`, `closeout_rejected`, wrong-store, wrong-terminal, and missing
  session states still block void application.
- Pending `pos_transaction_void` approvals are a final-close blocker, not a
  closeout-submission blocker.
- Cashiers can submit the count and leave the register in `closing`; managers
  review or reject the voids; then finalization recomputes variance from the
  current register session before closing.
- Public closeout mutations bind client-supplied staff attribution to the
  authenticated Athena user before writing submitter, closer, requester, or
  audit fields.
- Final closeout verifies manager authority server-side even when recomputed
  variance is exact and no variance approval proof is required.
- Deposit recording checks pending register-scoped void approvals server-side
  before writing a new deposit, so stale mounted UI cannot bypass the lockout.

Expose pending voids in Cash Controls with a small safe summary keyed by
`registerSessionId`: count, approval id, transaction id/number, and optional work
item id. Do not expose approval notes, decision notes, raw metadata, proof ids,
or reviewer ids in the cash-controls register summary.

## Prevention

- Check every closeout closure boundary, not only the visible submit button:
  direct closeout submission, inline manager variance approval, async variance
  approval resolution, local-sync `register_closed` projection, and explicit
  finalization.
- Keep approved void application policy in shared lifecycle helpers rather than
  reusing sale usability in command branches.
- Recompute closeout review at finalization after pending void approvals settle,
  because approved voids can change expected cash after the original count.
- Add stale-client tests for UI lockouts that also need server enforcement, such
  as deposits while pending void approvals exist.
- Add negative auth tests for client-supplied staff profile ids at public Cash
  Controls mutation boundaries.
- Keep pending-void read models narrow; route managers to approval work without
  returning raw approval notes or proof metadata to Cash Controls summaries.

## Related

- `docs/solutions/logic-errors/athena-pos-completed-transaction-void-reversal-2026-05-21.md`
- `docs/solutions/logic-errors/athena-pos-closeout-review-only-lifecycle-2026-06-25.md`
- `docs/solutions/architecture/athena-pos-register-lifecycle-policy-2026-06-23.md`
