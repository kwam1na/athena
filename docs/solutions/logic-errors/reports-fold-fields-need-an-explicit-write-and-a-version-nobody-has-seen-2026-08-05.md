---
title: A New Fold Field Needs An Explicit Write And A Fold Version Nobody Has Seen
date: 2026-08-05
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: reports_fold
resolution_type: contract_correction
severity: high
applies_when:
  - Adding a field to DayFoldResult or any reportDay/reportSkuDay document
  - Bumping REPORTS_FOLD_VERSION to backfill history through foldVersionRepair
  - Deriving a period metric that mixes fact-folded numbers with close-settled ones
tags: [reports, fold-version, convex, migration, derived-metrics]
delivery_diff_fingerprint: 6dbde5fd5709d4b16daecc962e595a0ecf3b1972d904a8b84e62468f48c6a48f
---

# A New Fold Field Needs An Explicit Write And A Fold Version Nobody Has Seen

## Problem

Adding `transactionCount` to the reports fold looked like a one-line change: put the
field on `DayFoldResult`, have the fold populate it from the close summary, bump
`REPORTS_FOLD_VERSION` so `foldVersionRepair` marks existing days stale, done. That is
what version 4 was.

Version 4 shipped the field and stamped every repaired day with `foldVersion: 4` — and
persisted nothing. `foldAndReplaceDay` does not spread the fold result into the day
document; it builds an **explicit** document, field by field. A key absent from that
literal is dropped on write, silently, with no type error, because the schema field is
`v.optional(...)` for legacy reasons. Every day the repair touched came out carrying
version 4 and no count.

The second half of the trap is what makes it expensive rather than merely annoying.
Staleness is `day.foldVersion !== REPORTS_FOLD_VERSION`. Once the repair has stamped
history with 4, correcting the write is not enough: those days now match the constant
and are invisible to the repair forever. Recovering them requires a version they have
**not** seen — hence version 5, which is the same field, actually written.

A related mistake sat one layer up. `transactionCount` is settled at close, while every
other day metric is folded from facts the instant a sale lands. A period that sums units
across all its days and transactions across only its closed days, then divides, produces
a basket size that is not merely imprecise — on a day still trading it is arbitrarily
wrong, and it looks like a real measurement.

## Solution

Three rules, each enforced in code rather than left to reviewer memory:

- **Any new field on `DayFoldResult` must be added to the explicit document literal in
  `foldAndReplaceDay`.** The omission is silent. Treat the fold result type and that
  literal as one edit, never two.
- **A version bump only reaches days that have not already been stamped with it.** If a
  bump has shipped and its write was wrong, the fix needs a *new* version number. Do not
  attempt to re-run the repair at the same version; it is a no-op by construction. This
  is why the constant went `3 → 5` with no working 4.
- **Do not divide across a settlement seam.** `settledTransactionCount` and
  `unitsPerTransaction` in `shared/reportsContract.ts` both return `null` unless
  `transactionCoveredDayCount === dayCount`. Reads go through the *same* helper so the
  count and the ratio derived from it can never disagree about whether the evidence is
  whole. Absent means UNKNOWN, never zero — a closed day with no sales stores `0`.

The same "absent means unknown" rule governs the incremental path: `ingest` maintains the
count on an open day, but an existing day that carries no count stays absent rather than
starting a running total from an unknown base.

## Prevention

- When adding to `DayFoldResult`, grep for the day-document literal in `foldDay.ts`
  before writing the test — a fold-level unit test passes happily while the write drops
  the field. Assert on the **persisted row**, not the fold return value.
- Before bumping `REPORTS_FOLD_VERSION`, check whether the previous number ever reached
  production. If it did, the bump you need is one higher than what history carries, not
  one higher than what the last PR intended.
- Make the version bump and the `foldVersionRepair` run an explicit rollout step in the
  delivery handoff. Clean days never refold on their own; without the operator run,
  history keeps the old shape indefinitely and the new metric only ever covers days
  closed after the deploy.
- For any new period metric, ask which of its inputs are fact-folded and which are
  settled at close. If they differ, gate the metric on coverage and surface the gap
  ("3 of 7 days closed") rather than rendering a bare dash or a confident number.

## Examples

- `REPORTS_FOLD_VERSION = 5` with version 4 documented in the same comment block as a
  bump that stamped days without persisting the field — the history of the mistake is
  load-bearing for the next reader deciding what number to pick.
- `reportDay.transactionCount` and `periodSnapshot.transactionCount` /
  `transactionCoveredDayCount` are all `v.optional`, and every read treats absence as
  unknown.
- `ReportPeriodMetrics` places Transactions between Units sold and Units per sale so the
  ratio reads left to right and can be checked by eye, and shows the coverage helper
  instead of a value when the period is not fully closed.

## Related

- [Athena Shared Demo Polish Needs One Story Contract Across Seed Data, Policy, and UI](../workflow-issues/athena-shared-demo-cross-layer-polish-2026-07-22.md)
- [Athena Cross-Layer Delivery Needs Bounded Reads and Contract Proof](../workflow-issues/athena-cross-layer-delivery-contracts-2026-07-18.md)
