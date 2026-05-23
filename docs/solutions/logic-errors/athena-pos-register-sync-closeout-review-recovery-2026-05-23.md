---
title: Athena POS Register Sync Closeout Review Recovery
date: 2026-05-23
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: pos
symptoms:
  - "Synced register closeouts that need manager review can remain conflicted while the approval row is marked resolved"
  - "Cash controls can show an active register session even though the local terminal recorded a closeout"
  - "Operations approvals can omit register sync review work that still needs a manager decision"
root_cause: review_resolution_without_source_projection
resolution_type: code_fix
severity: high
tags:
  - pos
  - cash-controls
  - register-session
  - local-sync
  - approvals
---

# Athena POS Register Sync Closeout Review Recovery

## Problem

Register sync review commands must resolve the source local sync event, not only
the review row. A local `register_closed` event can carry the operator's counted
cash and notes after an offline closeout. If the review action marks the conflict
resolved without projecting that closeout, cash controls keeps showing the cloud
register session as active and the operator loses the visible path to approve or
reject the real local activity.

This is especially risky when the closeout has a variance. The variance is the
reason manager review is required, but the approval action is approving the
synced closeout event. The closeout projection then records the counted cash,
variance, notes, closeout records, and trace context in the register session.

## Solution

Treat register sync reviews as recoverable projections:

- The approval workspace should include register sync conflicts as manager work,
  with a link back to the register session and readable review-item context.
- Register detail should present explicit approve and reject actions for synced
  activity instead of a generic apply button.
- Approval must project supported local sync event types. For
  `register_closed`, pass an explicit closeout-variance override into local sync
  projection only after manager proof is accepted.
- Rejection should mark the conflicted source sync events rejected and resolve
  the review rows so the terminal activity is intentionally discarded.
- Resolved conflict rows whose source `posLocalSyncEvent` is still `conflicted`
  should stay visible as stale review work. This recovers production states where
  an earlier command resolved the review metadata without settling the source
  event.

## Prevention

- Add command-boundary tests for reviewed closeout projection with variance:
  session status, counted cash, variance, closeout records, notes, and source
  event status should all change together.
- Add read-model tests for stale resolved conflicts whose source event remains
  conflicted so they cannot disappear from cash controls or operations queues.
- Keep UI tests on both register detail and Operations approvals so approval
  routing cannot regress to sales-only behavior.
- When a sync-review command encounters an unsupported conflict shape, return a
  precondition error instead of silently resolving or skipping it.
