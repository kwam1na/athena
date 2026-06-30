---
title: Athena Daily Operations Uses Store-Day Currentness for Refreshable Facts
date: 2026-06-30
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: operations
symptoms:
  - "The POS pulse could show sales for today when there were no current store-day sales"
  - "Daily Operations cached week analytics could age while the timeline continued updating"
  - "Operators needed refreshed current-day sales trend, top item, and payment mix facts without a full live query"
root_cause: stale_current_day_boundary
resolution_type: code_fix
severity: medium
tags:
  - daily-operations
  - store-day
  - pos
  - cache
  - convex
---

# Athena Daily Operations Uses Store-Day Currentness for Refreshable Facts

## Problem

Athena operations surfaces mix two kinds of data:

- Live operational events, such as the store-day timeline.
- Cached or compact analytics, such as sales totals, sales trend, top items,
  and payment mix.

If "today" is inferred from wall-clock date or stale history alone, the UI can
show the wrong facts for the active store day. If cached analytics are only
hydrated on initial page load, operators may see an updated timeline beside
stale current-day sales facts.

## Solution

Use the store-day window as the current-day boundary, and refresh only the
current-day facts that age:

- Resolve POS "today" from the active Opening Handoff store-day object when it
  contains the current time.
- Ignore stale unclosed openings whose expected store-day window is no longer
  active.
- Add a narrow current-day refresh query for Daily Operations instead of
  refetching the full weekly detail snapshot.
- Merge the refresh payload into the local display cache for the selected day:
  summary cards, selected week metric, sales trend, top items, and payment mix.
- Leave timeline refresh on its existing path; do not route it through the
  analytics refresh button.
- Treat cached current-day analytics as stale after a bounded interval and
  trigger the same scoped refresh path automatically.

## Prevention

- Do not key POS or operations "today" from a bare date comparison when a
  store-day object exists. Validate that the store-day window contains `now`
  before using it as the current operating day.
- Do not add a broad live query for the full Daily Operations page just to
  refresh current-day analytics. Return the selected day metric, prior-day
  comparison metric, summary cards, and store pulse payload only.
- Keep the manual refresh control and stale-time auto refresh on the same query
  path so tests cover both operator and timer-triggered updates.
- The timestamp may update after either initial week hydration or current-day
  refresh, but operator copy should remain generic: "Data refreshed at ...".
- Add regression coverage for stale store-day windows, clear no-sales copy, the
  scoped refresh query, and the stale timer boundary.

## Related Validation

- `bun run test -- convex/operations/dailyOperations.test.ts`
- `bun run test -- src/components/operations/DailyOperationsView.test.tsx`
- `bun run test -- convex/pos/application/getTransactions.test.ts`
- `bun run test -- src/components/pos/sales-pulse/POSSalesPulseView.test.tsx`
- `bun run pr:athena`
