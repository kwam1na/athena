---
title: Athena Daily Opening Readiness Should Reuse Close Handoff Evidence
date: 2026-05-08
category: logic-errors
module: athena-webapp
problem_type: workflow_boundary
component: store-operations
symptoms:
  - "Opening can drift into a second drawer-open or register-session flow instead of a store-day acknowledgement"
  - "Operators need the prior close handoff, carry-forward work, and pending approval state in one place before starting the day"
  - "Frontend acknowledgement can become stale if the command trusts the client snapshot"
root_cause: missing_workflow_record
resolution_type: design_pattern
severity: medium
tags:
  - daily-opening
  - daily-close
  - store-operations
  - readiness-gate
---

# Athena Daily Opening Readiness Should Reuse Close Handoff Evidence

## Problem

Daily Opening is a store-day readiness gate, not a cash drawer command. The
workflow needs to answer whether the store can start operating today by reading
the prior Daily Close, unresolved carry-forward work, and pending approval
state. If Opening creates register-session behavior or trusts only the browser's
last snapshot, it can start a day while blockers have appeared or duplicate
responsibility that belongs to POS and cash-controls commands.

## Solution

Model Opening as a durable acknowledgement record that reuses close handoff
evidence:

- The query builds a readiness snapshot from prior Daily Close context,
  unresolved carry-forward work, and pending closeout approvals.
- The command re-reads the snapshot before insert, blocks on hard blockers, and
  requires acknowledgement keys for review and carry-forward items.
- The persisted `dailyOpening` record stores the operating date, local range,
  prior close reference, readiness counts, source subjects, carry-forward work
  item ids, acknowledged keys, actor ids, and notes.
- Opening records an operational event but does not mutate register sessions,
  drawers, or the carry-forward work item status.
- The operator view should treat Opening as a review-and-confirm workspace with
  tabs for blockers, review items, carry-forward work, and ready evidence.

This keeps the opening MVP narrow while still giving Store OS future extension
points: the stored source subjects can feed timelines, SOP checks, manager
review, and store-day analytics without changing the POS drawer lifecycle.

## Prevention

- Do not let Daily Opening directly open drawers, start POS sessions, or close
  carry-forward work. Those belong to dedicated commands.
- Do not complete Opening from client-side readiness alone. Re-read the server
  readiness snapshot inside the command.
- Include operating-date range fields in the backend contract when the frontend
  sends local store-day bounds, even if the first slice only keys records by
  `operatingDate`.
- Add a lifecycle harness scenario when Daily Opening, Daily Close, or their
  route wiring changes so readiness gates, generated Convex API refs, and
  operator views are validated together.
- Keep query-index tests aligned with each readiness source table so the gate
  does not regress into unbounded scans as more Store OS signals are added.
