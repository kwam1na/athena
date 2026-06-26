---
title: Athena Register Closeout Correction Approval Boundary
date: 2026-06-25
category: logic-errors
module: athena-webapp
problem_type: authorization_and_lifecycle_state_error
component: cash-controls
symptoms:
  - "Shared POS users hit staff actor mismatch errors while submitting closeouts"
  - "Rejected closeouts can be mistaken for editable closeouts instead of manager-reopened corrections"
  - "Repeated closeout submissions can replace a pending manager approval"
root_cause: closeout_staff_identity_reopen_authority_and_async_approval_retry_were_treated_as_one_boundary
resolution_type: code_fix
severity: high
tags:
  - cash-controls
  - register-session
  - closeout
  - approval-policy
  - staff-credentials
related:
  - docs/solutions/logic-errors/athena-register-closeout-pending-void-policy-2026-06-25.md
  - docs/solutions/logic-errors/athena-command-approval-policy-boundary-2026-05-01.md
  - docs/solutions/architecture/athena-pos-local-staff-authority-2026-05-14.md
---

# Athena Register Closeout Correction Approval Boundary

## Problem

Register closeout has three separate authority checks that can look similar in
the UI:

- staff identity for the cashier or manager who is recording the count
- manager approval for reopening or correcting a rejected closeout
- async manager review for a variance approval request

When those boundaries collapse into one check, shared POS accounts can fail with
staff actor mismatch errors, rejected closeouts can become directly editable, or
stale retries can cancel and recreate manager approval requests that are already
being reviewed.

## Solution

Keep each closeout boundary explicit:

- Public closeout mutations may accept staff username and PIN hash when the
  signed-in Athena user is a shared POS or admin account, but the server must
  re-authenticate those credentials and bind the resulting staff profile before
  writing submitter, closer, requester, or audit fields.
- `closeout_rejected` is not an editable count state. It must require the
  manager-controlled reopen path before a corrected count can be submitted.
- Reopened closeout correction can use the manager reopen proof as correction
  authority. Do not require that proof to also be the cashier actor.
- Duplicate variance submissions while an async approval is pending should be
  idempotent. If the submitted count and notes match the pending request
  metadata, return the existing approval requirement. If they differ, reject the
  stale submit instead of replacing the manager queue item.
- Approval queue cards for transaction-linked register work should include safe
  register-session context, such as terminal/register name and session code, so
  managers can navigate to the drawer without exposing proof ids or raw approval
  metadata.

## Prevention

- Add negative mutation tests for direct `closeout_rejected` submit attempts.
- Add shared-POS credential tests for both submit and finalize, including staff
  profiles that are not linked to the signed-in Athena user.
- Add duplicate pending-approval tests that assert no approval request is
  cancelled, inserted, or patched for an exact retry.
- In the register detail UI, render previous submitted closeout data separately
  from the correction form so operators can see the historical count while
  entering the corrected one.
- Keep rejected-state display and submit availability keyed to
  `registerSession.status`, not only to timeline text or cached approval data.

## Related

- `docs/solutions/logic-errors/athena-register-closeout-pending-void-policy-2026-06-25.md`
- `docs/solutions/logic-errors/athena-command-approval-policy-boundary-2026-05-01.md`
- `docs/solutions/architecture/athena-pos-local-staff-authority-2026-05-14.md`
