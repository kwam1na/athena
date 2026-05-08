---
title: Athena Daily Close Is A Store-Day Boundary
date: 2026-05-07
category: logic-errors
module: athena-webapp
problem_type: workflow_scope_boundary
component: daily-operations
symptoms:
  - "Daily operations can be confused with drawer closeout when both involve cash readiness"
  - "Opening handoff work can be lost if Daily Close is treated as a transient screen summary"
  - "Register, POS session, and store-day close data can drift without a server-owned snapshot"
  - "Late-night local transactions can be omitted when the server interprets an operating date as a UTC day"
  - "An empty operating day can look accidentally ready instead of intentionally closable"
  - "Expense totals can appear in Daily Close metrics without the underlying expense transactions appearing in the ready list"
root_cause: store_day_lifecycle_missing_authoritative_close_record
resolution_type: domain_model_plus_command_boundary
severity: medium
tags:
  - daily-close
  - operations
  - cash-controls
  - register-session
  - operating-date
  - approval-policy
  - convex
---

# Athena Daily Close Is A Store-Day Boundary

## Problem

Daily Close needs to summarize the whole store day, not just one drawer or one
POS session. If it is implemented as a UI-only checklist, the business loses the
handoff between closing and the next opening workflow. If it is implemented
inside Cash Controls, it inherits drawer/session scope and cannot confidently
answer whether the store day is ready to close.

## Solution

Model Daily Close as a durable store-day record. The server owns the readiness
snapshot, classifies blockers, review items, carry-forward work, and ready
inputs, then revalidates that snapshot inside the completion command before
persisting a completed close.

Keep the scopes explicit:

- Daily Close is store-day scoped.
- Cash Controls is drawer/session scoped.
- A POS session is the sale/cart lifecycle.
- An expense transaction is a completed store-day outflow that must be visible
  alongside completed sales.
- `registerSession` is the drawer/shift ledger behind cash-control closeout.

The close command should accept reviewed item keys and carry-forward work item
ids, then write a completed summary and operational events. Opening should read
the prior completed close and unresolved carry-forward work rather than
rebuilding yesterday's close from live operational state.

Completing Daily Close is still a store-day lifecycle mutation even when the
readiness snapshot is clean. Gate it through the shared command approval layer:
the mutation returns `approval_required`, the UI presents the manager approval
dialog through `useApprovedCommand`, and the mutation consumes the one-use
approval proof before persisting the close record. Do not rely on a
screen-local manager prompt as the enforcement boundary.

An all-zero store day is allowed to close when the server snapshot has no
blockers, review items, carry-forward work, ready inputs, sales, cash activity,
expenses, or variances. Treat that as an explicit zero-activity close in the UI
so operators understand they are recording "nothing happened today," not
bypassing missing reconciliation work.

Use an explicit operating-day time range for the snapshot and completion
mutation. A local operating date is not the same as a UTC calendar day: a cash
sale completed after midnight UTC can still belong to the current local
operating day. The client should pass the local `startAt`/`endAt` bounds it is
using for the operating date, and the server should validate those bounds before
using them for transaction, register-session, expense, and variance reads.

Every source table that contributes to close totals should also contribute
operator-visible close evidence unless the source is intentionally hidden by
policy. Completed expense transactions are not enough as an aggregate expense
total; they should create `readyItems` with the expense report number, staff
owner, register when available, amount, completion time, notes, and a link back
to the expense report. Query them through a store/status/completed-at index so
the snapshot cannot miss valid expenses after a broad store-level limit.

For POS completion, recompute totals from normalized line items and compare the
submitted payment against that canonical total. The persisted transaction
summary, payment allocation, and cash metrics should derive from the final
server-side item totals, not from stale client cart state.

## Prevention

- Do not complete Daily Close from client-side readiness alone; re-read the
  snapshot in the mutation.
- Require a consumed manager approval proof before persisting a completed close.
- Do not let open register sessions, pending closeout approvals, or unresolved
  POS sessions be soft warnings. They block completion.
- Keep variance, void, and exception records visible as review items so the
  operator acknowledges them before close.
- Let a true zero-activity day close, but label it explicitly as no activity to
  close instead of reusing ordinary completed-work copy.
- Preserve carry-forward work as operational work items so the later opening
  workflow has a durable handoff.
- Keep the snapshot query and completion mutation on the same validated
  operating-day range so the operator does not close against a different window
  than the UI displayed.
- Test local-day boundary cases with a completed transaction after UTC midnight
  but before the local operating day ends.
- Test expense transactions with the same local-day boundary, store filtering,
  and completed-status filtering used for POS transactions.
- Add query-index coverage whenever a new close-readiness source table is added.
