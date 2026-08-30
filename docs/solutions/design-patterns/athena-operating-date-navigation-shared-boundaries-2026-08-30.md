---
title: "Athena Shares Operating-Date Navigation Without Duplicating Date Boundaries"
date: 2026-08-30
category: design-patterns
module: athena-webapp
problem_type: design_pattern
component: frontend_stimulus
resolution_type: code_fix
severity: medium
applies_when:
  - "Adding historical operating-date controls to an Athena operator workspace"
  - "Moving reporting periods across day, week, or month boundaries"
related_components:
  - "daily-operations"
  - "reports-workspace"
  - "operating-date"
tags: [operating-date, reporting, daily-operations, navigation, frontend]
delivery_diff_fingerprint: 4196b4d58ffae846350621da3b8a4e509a4d72eaf6b85e640834cb32469a1760
---

# Athena Shares Operating-Date Navigation Without Duplicating Date Boundaries

## Problem

Daily Opening, Daily Close, and Daily Operations each needed the same historical
operating-date picker, while the Reports Items workspace needed adjacent
day/week/month controls. Duplicating the picker in each workspace made future
date guards, accessible labels, calendar focus, and boundary behavior drift.

## Solution

Keep presentation-level arrows in a shared `PeriodNavigation` component, while
the owner of the selected range provides the labels, arithmetic, availability,
and data-loading callback. `OperatingDatePicker` owns only the calendar-date
presentation and adjacent-day controls; callers still own their operating-date
search state and the bounded query they load.

For reporting periods, calculate the adjacent period from the selected date:

```ts
const nextPeriodDate = adjacentItemsPeriodDate(periodType, periodDate, 1);
const canMoveNext = nextPeriodRange.startDate <= getLocalOperatingDate();
```

Month movement clamps to the final valid day of the target month, so March 31
steps to February 28 (or February 29 in leap years) rather than skipping a
short month. Week and day movement use operating-date helpers, not browser UTC
arithmetic. A next control can return to the current operating day, but never
select a future date.

## Why This Matters

The store's operating date is a business boundary, not a browser-clock detail.
Sharing the controls preserves one accessible interaction pattern without
making a generic component decide which report period, lifecycle state, or
query should be active. Historical Daily Close and Opening reviews also open
the calendar around their selected date instead of the browser's current month.

## Prevention

- Keep date-period arithmetic in the owning reporting contract, not in button
  components.
- Use the same inclusive upper bound for calendar selection and the next-day
  arrow.
- Test month-end, leap-year, week, day, and current-day boundaries.
- Test keyboard activation and disabled/read-only controls for the shared
  picker.
- Preserve caller-owned search state, lifecycle semantics, and query loading
  when extracting a visual control.

## Examples

Reports can move from a historical week toward the current operating day, but a
period that would extend past that day is disabled. Daily Operations can use the
same arrows for its selected operating date while retaining its own live
current-day refresh behavior.

## Related

- [Athena Reporting Separates Rendered Scope, Period Focus, and Day Lifecycle](../architecture-patterns/athena-reporting-period-focus-and-lifecycle-authority-2026-08-01.md)
- [Athena Daily Close Is A Store-Day Boundary](../logic-errors/athena-daily-close-store-day-boundary-2026-05-07.md)
