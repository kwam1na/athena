---
title: "Athena Reporting Separates Rendered Scope, Period Focus, and Day Lifecycle"
date: 2026-08-01
category: architecture-patterns
module: athena-webapp
problem_type: architecture_pattern
component: service_object
resolution_type: code_fix
severity: medium
applies_when:
  - "Changing date or date-range selection in the Reports workspace"
  - "Linking report metrics to Transactions or Daily Operations"
  - "Determining whether the current reporting day is still in progress"
related_components:
  - "reports-workspace-ui"
  - "convex-reports"
  - "tanstack-router-search-state"
tags:
  - reporting
  - operating-day
  - date-range
  - lifecycle-authority
  - navigation
delivery_diff_fingerprint: 0518c00b47d68ca87f8f53325b7e03594ceb75a6b0f49321a1aea48d7e5d7edc
---

# Athena Reporting Separates Rendered Scope, Period Focus, and Day Lifecycle

## Problem

A reporting date range serves two different purposes: it tells the operator
which days are in focus, and it can determine which rows are loaded. Coupling
those purposes makes the table replace its context whenever the selection
changes. The operator loses nearby dates, pagination can remain on a page that
does not contain the new selection, and selecting one day has no stable range
to return to.

The same ambiguity appears in outbound navigation. Browser time cannot decide
whether “today” is active for a store, and every report surface inventing that
decision independently can choose a different transaction sort order or
operational destination.

## Solution

Model the workspace with 3 explicit pieces of state:

1. **Rendered table scope** (`daysTableStart` / `daysTableEnd`) controls the
   bounded `listDays` query and stays stable while a new selection fits inside
   the 92-day reporting limit.
2. **Selected range** (`daysStart` / `daysEnd`) controls emphasis and aggregate
   detail. Rows inside the range remain prominent; other rendered rows are
   deemphasized rather than removed.
3. **Selected day** (`selectedDay`) temporarily narrows emphasis and detail to
   one date. Selecting it again clears only the day focus and returns to the
   selected range.

Range changes compute the page containing the range’s first date. This makes
the focus visible immediately without changing the newest-first ordering of
the day table.

Treat report-day lifecycle as the authority for current-day behavior:

```ts
export function isReportingTodayInProgress(
  status: ReportDayStatus | null | undefined,
): boolean {
  return status === "open";
}
```

The server-shaped Items result exposes that decision for a day period. An
in-progress day omits the Transactions `order` parameter so the destination
uses its newest-first default. Historic days and multi-day periods explicitly
request `oldestFirst`. Overview uses the same definition to expose Daily
Operations for an open day and EOD Review for a reconciled or amended day.
Both links carry the origin parameter so operators can return to Reports.

## Why This Matters

Rendered scope answers “what context can I still see?”, selection answers
“what am I analyzing?”, and lifecycle answers “what operational phase is this
day in?”. Keeping those concerns separate prevents a UI gesture from silently
changing the query universe and prevents wall-clock guesses from overriding
the store’s materialized reporting state.

The pattern also keeps navigation semantics deterministic. Transaction order
is a consequence of reporting lifecycle, not which component happened to
construct the link.

## Prevention

- Preserve rendered table bounds separately from selected range bounds.
- When a new range is outside the current table scope, expand only within the
  reporting query limit; otherwise start a fresh bounded scope.
- Recompute pagination from the first selected operating date after a range
  change.
- Do not use `new Date()` or browser timezone to classify a report day as open
  or closed.
- Put lifecycle classification in the shared reporting contract and carry the
  result through server-shaped query responses.
- Test range focus, single-day toggle-back, pagination targeting, open-day
  navigation, historic-day ordering, and origin preservation independently.

## Examples

Before, choosing July 3–16 could leave the operator on the page containing
July 31–17 or remove every non-selected row. After, the table navigates to the
page containing July 3, keeps its bounded surrounding scope, highlights July
3–16, and deemphasizes the remaining rows.

Before, every report metric link requested oldest-first transactions. After,
an `open` day renders newest-first by omitting `order`, while a reconciled day
still requests `order=oldestFirst`.

## Related

- [Athena reporting: read-optimized redesign](../architecture/athena-reporting-read-optimized-redesign-2026-07-28.md)
- [Athena Reports Bounds SKU Mix Aggregation Before Identity Hydration](athena-reports-sku-mix-aggregation-2026-07-30.md)
- [Athena Daily Close Is A Store-Day Boundary](../logic-errors/athena-daily-close-store-day-boundary-2026-05-07.md)
