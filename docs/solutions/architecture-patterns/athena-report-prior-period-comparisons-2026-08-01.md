---
title: Athena Report Comparisons Belong in Bounded Server-Shaped Read Models
date: 2026-08-01
category: architecture-patterns
module: Athena Reports
problem_type: architecture_pattern
component: service_object
resolution_type: code_fix
severity: medium
applies_when:
  - "Adding current-versus-prior metrics to a report surface"
  - "Supporting fixed, calendar, rolling, or custom reporting windows"
  - "Rolling out new fields on persisted Convex report projections"
tags:
  - reports
  - convex
  - period-comparison
  - bounded-reads
  - read-models
delivery_diff_fingerprint: befb171571c19a2e5596ec293846291f6c1cd03047aa8f28ec11bec896280117
---

# Athena Report Comparisons Belong in Bounded Server-Shaped Read Models

## Problem

A report metric cannot produce a trustworthy change label from the current value alone. If each React view derives its own prior window, fixed periods, calendar periods, rolling windows, and custom ranges can disagree about what “prior” means. Client-side reconstruction also hides database read amplification and can turn missing source data into an apparently real zero.

## Solution

Shape the current and prior values together at the reporting boundary, then let presentation code format that explicit contract.

Use period meaning to choose the comparison range:

- A day compares with the preceding operating day.
- A week compares with the preceding seven-day week.
- A calendar month compares with the preceding calendar month, not an equal number of days.
- A rolling window compares with the adjacent rolling window of the same size.
- A custom range compares with the immediately preceding equal-length range.

For persisted overview projections, materialize both rolling snapshots during the same bounded rebuild. New fields can remain optional in the stored schema during rollout, while the public query enriches legacy documents from one indexed, explicitly capped day read. Return a required typed snapshot to clients after enrichment so rollout complexity stays at the backend boundary.

For on-demand item and SKU queries, compute both ranges on the server and return `priorPeriodTotals` beside current totals. Preserve `null` or optional values where the source fact is unknown; do not substitute catalog price for missing net price or current cost for missing historical cost.

Presentation components should receive current and prior numeric values and only own formatting, comparison language, and restrained transitions. When report args change, keep the last settled result paired with its original period key until the new result arrives; this prevents stale data from being labeled with the newly selected period.

## Why This Matters

The server owns period semantics, source selection, completeness, and read budgets. Keeping comparison ranges there gives all clients the same financial meaning and makes bounds testable. Pairing stale-while-refresh data with its settled context also prevents a subtle but serious UI lie: showing old totals with a new comparison label during a Convex query refresh.

This pattern keeps missing data distinct from zero. A real zero prior period can support “no activity” language, while an unavailable profit basis stays unavailable rather than becoming a percentage or dollar change.

## Prevention

- Add boundary tests for month length changes, year changes, empty ranges, and zero baselines whenever a comparison period is introduced.
- Assert the `.take(...)` cap and indexed range in Convex tests when expanding a report query’s history window.
- Keep current/prior values in shared report contracts instead of recalculating totals in React.
- Carry a settled period or range key with stale-while-refresh data and key comparison transitions from that settled context.
- Treat optional persisted fields as rollout compatibility only; normalize the public query result to the required client contract.

## Examples

Before: a rolling metric is current-only, or React infers a prior range from the selected label.

After: the overview projection contains adjacent current/prior rolling snapshots, the item query returns prior day/week/month totals, and SKU detail returns the preceding equal-length range. React formats the explicit values and never owns report arithmetic.

Before: a changed query argument leaves old values on screen while comparison copy immediately switches to the new period.

After: the stable query hook retains both the settled data and its settled context key, so values and labels transition together.

## Related

- [Reporting period focus and lifecycle authority](athena-reporting-period-focus-and-lifecycle-authority-2026-08-01.md)
- [Reports workspace read-model boundary](athena-reports-workspace-read-model-boundary-2026-07-11.md)
- [Reports item workspace evidence](athena-reports-item-workspace-evidence-2026-07-29.md)
- [Reports SKU mix aggregation](athena-reports-sku-mix-aggregation-2026-07-30.md)
