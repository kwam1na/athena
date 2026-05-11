---
title: Daily Operations State Must Come From Store-Day Snapshots
date: 2026-05-11
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: frontend
symptoms:
  - "Daily Operations could report future-day sales when local operating dates were derived from UTC ranges."
  - "Reopened or completed EOD Review records could show the wrong status because UI state was inferred from route context or stale close records."
  - "Stored historical item copy could leak older End-of-Day Review phrasing after the UI moved to EOD Review titles and end of day review body copy."
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - daily-operations
  - eod-review
  - operating-date
  - store-day
  - snapshot-state
---

# Daily Operations State Must Come From Store-Day Snapshots

## Problem

The Daily Operations surface sits above several workflows: opening handoff,
EOD Review, open work, approvals, registers, POS sessions, expenses, and weekly
operating metrics. Small UI inferences can drift quickly when they are based on
route origin, UTC date ranges, or stale record labels instead of the store-day
snapshot.

This showed up while refining the May 10 and May 11 store-day flow. Reopening a
closed EOD Review needed to use the current daily close record, state badges
needed to reflect reopened/blocked/ready cases, and week metrics needed to
bucket sales by the store's operating date rather than by a future UTC date.

## Symptoms

- Reopening a closed day errored when `dailyCloseId` was missing from the
  mutation arguments.
- A reopened EOD Review could display as needs review even when the snapshot was
  blocked or ready to close.
- The week strip could show sales on a future operating date because the bucket
  boundary did not include the store's operating timezone offset.
- EOD Review copy was mixed between title copy (`EOD Review`) and body copy
  (`end of day review`), especially in stored historical item messages.
- Reopen controls briefly depended on the `o=` route origin, which hid a domain
  action for the wrong reason.

## Solution

Keep Daily Operations and EOD Review UI state tied to the snapshot fields that
represent store-day truth:

- Reopen actions pass the current `dailyCloseId` and are shown only when the
  snapshot status is completed, the close is current, and the close lifecycle is
  neither reopened nor superseded.
- Daily close lookups prefer the current close record before falling back to
  older records, so reopened/superseded records do not masquerade as the active
  close.
- Week metrics accept the operating timezone offset and bucket transaction
  totals into the local operating date.
- Status cards and icons render from lane/status values, not from incidental
  label text.
- Historical stored item copy is normalized at render time so old
  `End-of-Day Review` messages do not leak into the current copy system.

The important boundary is that route origin can help navigation, but it should
not decide whether an EOD Review can be reopened. The snapshot already carries
the authoritative lifecycle/currentness information; use that.

## Why This Works

Daily Operations is an aggregate read model. The UI should present the current
store-day state, not reconstruct it from whichever workflow linked into the
page. Keeping status, reopenability, and metrics tied to snapshot fields makes
the behavior stable across direct navigation, opening handoff links, daily close
links, and historical week navigation.

The same rule applies to copy. Titles and navigation can use `EOD Review`, while
sentences in item messages can use `end of day review`; render-time
normalization protects older stored snapshots without rewriting historical data.

## Prevention

- When adding Daily Operations UI state, first look for an existing field on the
  Daily Operations, Daily Opening, or Daily Close snapshot. Add one to the
  backend read model if the UI needs a new domain decision.
- Do not use `o=` or any route-origin parameter to decide domain permissions,
  lifecycle state, or reopenability. Route origin is navigation context only.
- For operating-day metrics, pass the store-day timezone/offset through the
  backend boundary and test with current, historical, and future local dates.
- Keep EOD Review copy split by context: title/navigation/button text uses
  `EOD Review`; body sentences use `end of day review`.
- Add tests for both active snapshots and persisted historical report snapshots
  whenever changing EOD Review display logic.
