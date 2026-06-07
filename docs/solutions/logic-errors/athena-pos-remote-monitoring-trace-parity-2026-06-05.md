---
title: Athena POS Remote Monitoring Trace Parity
date: 2026-06-05
category: logic-errors
module: athena-webapp
component: pos-monitoring
problem_type: pos_trace_parity
resolution_type: sale_and_closeout_evidence_contract
severity: medium
tags:
  - pos
  - workflow-traces
  - operational-events
  - local-sync
  - monitoring
---

# Athena POS Remote Monitoring Trace Parity

## Problem

Remote POS monitoring breaks down when sale completion, offline sync projection,
and register closeout evidence are not emitted through the same operator-visible
surfaces. Cash-only traces can make non-cash sales look invisible, and register
closeouts projected from local history can update drawer state without leaving a
Daily Operations event to explain what happened.

## Boundary

Use workflow traces for lifecycle evidence owned by a POS session or register
session. Use operational events for durable monitoring rows that should appear in
Daily Operations and other operator review surfaces. A completed sale may need
both: a register-session workflow trace for drawer/session lifecycle context and
a `pos_transaction_completed` operational event for the transaction timeline.

## Solution

Completed POS sales should record sale evidence even when the cash drawer delta
is zero. Pass the sale total, payment count, normalized payment-method labels,
transaction id, transaction number, and sync origin into the register-session
trace. Keep `amount` and `cashDelta` as the cash impact, not the sale total, so
card-only and mixed-tender sales are monitorable without inflating expected cash.

Online completion should also emit a `pos_transaction_completed` operational
event with the transaction as the subject, the register session as context, and
payment metadata. Daily Operations can then route the event to the transaction
first while still showing register context.

Offline sync projection should mirror the same sale evidence contract when it
replays local `sale_completed` history. For offline register closeout, update the
register session and record the closeout trace, then create a
`register_session_closed` operational event using the synced occurrence time.
That prevents closeout history from depending only on synthesized register
session rows.

## Prevention

When adding POS sale or register-session monitoring, test online completion and
local-sync projection separately. Include at least one non-cash sale case where
`saleTotal` is non-zero and `cashDelta` is zero. For closeouts, assert both the
register-session trace and the operational event so Daily Operations has a
durable row to display.
