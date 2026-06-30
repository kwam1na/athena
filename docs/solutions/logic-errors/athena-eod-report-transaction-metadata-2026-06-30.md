---
title: Athena EOD Report Transaction Metadata
date: 2026-06-30
category: logic-errors
module: athena-webapp
problem_type: ui_state_and_report_snapshot
component: daily-close
resolution_type: pattern
severity: medium
tags:
  - daily-close
  - eod-review
  - report-snapshot
  - url-state
---

# Athena EOD Report Transaction Metadata

## Problem

The EOD Review transaction report is a drill-in sheet that operators use while
moving between transaction detail pages and the close workspace. If the sheet
open state lives only in component state, returning from a transaction detail
page collapses the report and loses the operator's context.

Transaction report rows also depend on metadata captured into the daily-close
report snapshot. New fields such as item counts need to be written when the
close snapshot is built; old completed snapshots should not silently trigger
extra read-time backfills for every historical row.

## Solution

Keep report sheet state in route search:

- Use a narrow enum-style search value such as `report=transactions`.
- Let the open button add that value while preserving existing search params.
- Let sheet close remove only that report key so `o`, `tab`, `page`, and
  `operatingDate` survive.

Persist transaction row metadata at snapshot-build time:

- Add item counts to current sale, voided-sale, and expense report items before
  completion stores the report snapshot.
- Render counts only when present and positive.
- Treat historic snapshots without item counts as legacy data instead of adding
  per-row item-table queries to completed-close reads.

## Prevention

When extending EOD report rows, cover both the backend snapshot metadata and the
sheet rendering path. Include a route-search test for any report sheet state that
must survive navigation. Avoid historical read-time enrichment unless the UX gain
justifies the extra indexed reads on every completed close view.
