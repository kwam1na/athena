---
title: Athena Daily Close History Uses Stored Close Snapshots
date: 2026-05-09
category: logic-errors
module: athena-webapp
problem_type: historical_record_drift
component: daily-operations
symptoms:
  - "Completed End-of-Day Reviews disappear after a new store day starts"
  - "Historical close reports can drift if rebuilt from live operational state"
  - "Operators cannot audit prior operating days from the operations workspace"
root_cause: daily_close_report_only_rendered_from_current_workspace_state
resolution_type: durable_snapshot_read_model
severity: medium
tags:
  - daily-close
  - operations
  - history
  - convex
  - store-day
---

# Athena Daily Close History Uses Stored Close Snapshots

## Problem

The End-of-Day Review report is only useful as an operating-day record if the
same report can be viewed after the store moves on. Recomputing the historical
screen from current transactions, work items, or register state risks changing
the past when source records are corrected, hidden, or reclassified.

## Solution

Persist the completed Daily Close report snapshot at the moment the close
command succeeds, then serve history from that stored snapshot. The historical
view should list completed close records only, load details by store and
`dailyCloseId`, and render the same report sections in read-only mode.

When a completed close is reopened, the stored `reportSnapshot` remains the
historical record. Reopen metadata can be displayed on that historical record,
but the history surface stays read-only and does not expose the reopen command.
If the reopened operating day is closed again, the revised completion produces a
separate completed snapshot and marks the earlier record as superseded.

This is the going-forward behavior. There is no legacy fallback requirement for
older completed close rows without `reportSnapshot`; the detail query should
return no historical report for those rows instead of rebuilding one from live
state.

## Prevention

- Store the report snapshot inside the completed `dailyClose` row during the
  completion mutation.
- Keep the history list and detail queries scoped by store.
- Sort history newest-first by operating date.
- Do not expose incomplete days in this first history version.
- Do not recompute historical reports from live operational tables.
- Do not edit a stored historical snapshot when the close is reopened or
  superseded; use lifecycle metadata to explain the state.
- Keep reopen actions out of Daily Close History. Reopen belongs to the active
  End-of-Day Review workspace.
- Add harness coverage for the history component, route, backend queries, and
  generated API surface whenever Daily Close history changes.
