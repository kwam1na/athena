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
root_cause: store_day_lifecycle_missing_authoritative_close_record
resolution_type: domain_model_plus_command_boundary
severity: medium
tags:
  - daily-close
  - operations
  - cash-controls
  - register-session
  - operating-date
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
- `registerSession` is the drawer/shift ledger behind cash-control closeout.

The close command should accept reviewed item keys and carry-forward work item
ids, then write a completed summary and operational events. Opening should read
the prior completed close and unresolved carry-forward work rather than
rebuilding yesterday's close from live operational state.

Use an explicit operating-day time range for the snapshot and completion
mutation. A local operating date is not the same as a UTC calendar day: a cash
sale completed after midnight UTC can still belong to the current local
operating day. The client should pass the local `startAt`/`endAt` bounds it is
using for the operating date, and the server should validate those bounds before
using them for transaction, register-session, expense, and variance reads.

For POS completion, recompute totals from normalized line items and compare the
submitted payment against that canonical total. The persisted transaction
summary, payment allocation, and cash metrics should derive from the final
server-side item totals, not from stale client cart state.

## Prevention

- Do not complete Daily Close from client-side readiness alone; re-read the
  snapshot in the mutation.
- Do not let open register sessions, pending closeout approvals, or unresolved
  POS sessions be soft warnings. They block completion.
- Keep variance, void, and exception records visible as review items so the
  operator acknowledges them before close.
- Preserve carry-forward work as operational work items so the later opening
  workflow has a durable handoff.
- Keep the snapshot query and completion mutation on the same validated
  operating-day range so the operator does not close against a different window
  than the UI displayed.
- Test local-day boundary cases with a completed transaction after UTC midnight
  but before the local operating day ends.
- Add query-index coverage whenever a new close-readiness source table is added.
