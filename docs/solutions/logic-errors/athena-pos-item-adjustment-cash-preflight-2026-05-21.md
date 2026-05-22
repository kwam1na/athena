---
title: Athena POS Item Adjustment Cash Preflight Must Enforce Drawer Invariants
date: 2026-05-21
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: pos
symptoms:
  - "Approving a queued item adjustment can fail with register session expected cash cannot be negative"
  - "A failed approval leaves the pending item adjustment in place, so later edits report that an adjustment is already waiting for approval"
root_cause: validate_only_cash_settlement_preflight_returned_before_checking_expected_cash_invariant
resolution_type: code_fix
severity: high
tags:
  - pos
  - item-adjustments
  - cash-controls
  - approvals
---

# Athena POS Item Adjustment Cash Preflight Must Enforce Drawer Invariants

## Problem

Item adjustment submission validates settlement effects before creating the
manager approval request. Cash refunds must not be queued when applying them
would make the register session's expected cash negative, because the approval
resolver later runs the real settlement mutation and will fail against the
drawer invariant.

When the preflight path skips that invariant, operators can create an approval
request that cannot currently apply. The approval attempt then returns the
negative expected-cash error, while the still-pending approval blocks follow-up
edits with the existing pending-adjustment message.

The public mutation must also map the invariant failure into the shared command
result shape. If it rethrows the domain error, browser `runCommand` treats it as
unexpected and the transaction view renders generic retry copy instead of the
operator-actionable backend message.

Approval-time failures need their own cleanup path. A request that was queued
before the preflight fix, or that became invalid because drawer cash changed
after queueing, can still fail when a manager approves it. If that failure is
returned as a user error without retiring the approval request, the request
stays pending and the next edit attempt is blocked by the duplicate pending
approval message.

## Solution

Keep `validateOnly` side-effect free, but do not let it bypass the same
precondition checks as the mutating path. Compute the proposed expected-cash
balance, reject negative balances, and only then return without patching the
register session.

Before running cash preflight, preserve idempotency and conflict ordering:

- Return the already-applied adjustment when the same payload is retried.
- Report an existing applied item adjustment before drawer-cash preconditions.
- Return an existing matching pending approval instead of creating another one.
- Run the cash preflight before creating any new approval request.
- Include the same domain invariant in the public mutation's user-error mapper
  so the transaction view can surface it inline.
- When an approval-time item adjustment apply fails on the drawer-cash
  invariant, mark that approval request cancelled before returning the user
  error so it no longer blocks a corrected submission and is not represented as
  a manager rejection.

## Prevention

- Any `validateOnly` path must enforce invariants and skip only writes.
- Tests for approval-gated commands should prove invalid state cannot be queued
  for later approval.
- Public mutation tests should cover every domain invariant that the browser is
  expected to render inline.
- Approval command tests should assert that approval-time item adjustment
  precondition failures retire the pending request while still returning the
  operator-actionable error.
- Keep retry/idempotency assertions next to preflight assertions so a new
  precondition does not hide the more specific applied-or-pending state.
