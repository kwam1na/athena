---
title: Fact-only folds may own financial totals but never Daily Close-derived posture
date: 2026-08-10
category: logic-errors
module: athena-webapp/convex/reports
problem_type: logic_error
component: service_object
symptoms:
  - "Accepted weekly report froze every scheduled day as unclosed while completed Daily Closes existed for the whole week"
  - "Weekly email asserted closing cash matched when several days carried non-zero counted-cash variance"
  - "Sales-to-close reconciliation was displayed under a label managers read as counted cash"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [reports, weekly, daily-close, projection, coverage, immutable-baseline, evidence-lanes]
delivery_diff_fingerprint: 585867effd2927ae79e68b6d316fa1389c87d911378f21ed3773bbff0048b215
---

# Fact-only folds may own financial totals but never Daily Close-derived posture

## Problem

The first accepted weekly manager report produced for a real store asserted two
things it had no evidence for: that zero of six scheduled days were closed, when
six completed Daily Closes existed, and that closing cash matched, when several
of those days carried non-zero counted-cash variance. The report was already
accepted and emailed before anyone noticed, and accepted reports are immutable
by design.

## Symptoms

- A fully closed week persisted `dayClosed: false` for every scheduled date.
- The email rendered a confident "all good" cash statement for a week whose
  daily closes disagreed.
- The one number labelled as variance was the sales-fold reconciliation figure,
  not counted-versus-expected cash.

## What Didn't Work

- **Relabelling the existing variance metric.** The sales-to-close reconciliation
  is a real, separately useful signal. Renaming it to "cash variance" would have
  made one lane readable by destroying another, and still would not have
  surfaced counted-cash evidence.
- **Recomputing the accepted baseline from current data.** Tempting, and wrong:
  accepted rows are evidence. Rewriting them to look correct would have
  destroyed the record of what was actually asserted at acceptance time.

## Solution

Separate the evidence lanes and let each own only what it can observe.

1. **Take posture from the lane that has it.** `materializeAcceptedWeek` now
   freezes `scheduleLineage` from the resolved report-day fold (which carries
   close lineage) rather than the fact-only fold (which cannot). The fact fold
   still owns financial totals — that is what it *can* know.
2. **Add the missing lane rather than reinterpreting a neighbour.** A shared
   aggregator (`convex/reports/weeklyCloseEvidence.ts`) reads frozen Daily Close
   snapshots and produces counted-cash, payment-mix, and expense-product
   evidence. The pre-existing sales-fold variance keeps its name and semantics
   and stays visible independently.
3. **Give absence a vocabulary.** Every lane carries
   `complete | partial | unavailable` with its own usable-day and scheduled-day
   counts. A *certified zero* counts as covered; an *absent legacy field* does
   not. Renderers gate on coverage, so "we don't know" can never print as "it
   was nothing".
4. **Correct history beside itself, not on top of itself.** A set-once
   `correction` projection stores corrected lineage and evidence next to the
   untouched original values and fingerprint, following the existing amendment
   pattern. Reads resolve correction-over-baseline; live and amendment truth
   never consult it; the automatic email path is structurally baseline-only so a
   delayed retry cannot mail corrected content.

## Why This Works

The original defect was not arithmetic — every number was computed correctly
from the inputs it was given. The defect was **authority**: a projection built
from one evidence lane was allowed to populate a field whose truth lives in a
different lane, and the fold had no way to distinguish "no close evidence
reached me" from "there were no closes". Once a field's authority is pinned to
the lane that can actually observe it, and once absence is representable, both
symptoms become unreachable rather than merely fixed.

Storing the correction orthogonally preserves the invariant that made the bug
awkward in the first place: the accepted row remains a faithful record of what
was asserted, while the operator-visible surfaces render the corrected truth.

## Prevention

- When a projection field's name mentions a domain (`dayClosed`, `cashVariance`),
  verify the fold populating it actually reads that domain's records. If it
  cannot, it must not write the field at all.
- Never let a formatter coerce a missing cross-lane metric to `0`. Model
  coverage explicitly and make "certified zero" and "no evidence" different
  values.
- New projection fields need an explicit writer, a persisted-row test (not just
  a fold-level unit test), and a rollout path for rows written before the field
  existed — see
  [reports-fold-fields-need-an-explicit-write-and-a-version-nobody-has-seen-2026-08-05](reports-fold-fields-need-an-explicit-write-and-a-version-nobody-has-seen-2026-08-05.md).
- A correction to immutable history is a sibling field plus a fail-closed,
  dry-run-first, fingerprint-verified command — never an in-place recompute.
- Frozen display identity belongs in the snapshot. Anything hydrated from a
  mutable catalog at render time will silently change historical reports, and a
  later correction has to reconstruct it explicitly.

## Related Issues

- [V26-1183](https://linear.app/v26-labs/issue/V26-1183/fix-accepted-weekly-close-status-and-surface-weekly-cash-variance)
- `docs/plans/2026-08-09-001-feat-weekly-payment-expense-evidence-plan.md`
- [athena-schedule-day-driven-weekly-report-projection-lifecycle-2026-08-01](../architecture-patterns/athena-schedule-day-driven-weekly-report-projection-lifecycle-2026-08-01.md)
  — accepted baselines stay immutable; later truth is orthogonal.
- [athena-cross-lane-metric-in-a-frozen-snapshot-email-2026-08-04](../architecture-patterns/athena-cross-lane-metric-in-a-frozen-snapshot-email-2026-08-04.md)
  — missing asynchronous evidence must remain unavailable, never default to zero.
- [athena-daily-close-history-snapshots-2026-05-09](athena-daily-close-history-snapshots-2026-05-09.md)
  — historical reporting renders stored close snapshots, never mutable tables.
