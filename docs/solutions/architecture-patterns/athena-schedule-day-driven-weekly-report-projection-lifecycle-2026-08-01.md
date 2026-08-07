---
title: "Athena Weekly Reports Use a Schedule-Day-Driven Projection Lifecycle"
date: 2026-08-01
category: architecture-patterns
module: Athena Reports
problem_type: architecture_pattern
component: database
resolution_type: code_fix
severity: medium
applies_when:
  - "Adding weekly or cycle-based reporting to Athena Reports"
  - "Preserving accepted reporting history while exposing later source changes"
  - "Building bounded report reads from existing materialized day projections"
  - "Rolling out projections across legacy evidence with incomplete coverage"
related_components:
  - "store-schedule"
  - "daily-close"
  - "report-fact-ledger"
  - "report-day-fold"
  - "reports-sweeper"
tags:
  - "weekly-reporting"
  - "schedule-aware"
  - "report-projections"
  - "bounded-reads"
  - "immutable-baseline"
  - "amendments"
  - "dirty-marker"
  - "legacy-evidence"
delivery_diff_fingerprint: fe76fccea7917f55e2d5fa687cef14fd82034e7c9e03d4782d8cca7a9c80ffb3
---

# Athena Weekly Reports Use a Schedule-Day-Driven Projection Lifecycle

## Problem

Weekly reporting needs a stable business-cycle definition, cheap reactive reads,
and a historical answer that does not change when facts arrive late or a final
close is reopened. Deriving membership from opening hours would exclude valid
financial activity, while rebuilding a screen from facts or operational domains
would violate the Reports workspace's bounded-read model. Legacy evidence can
also be insufficient to reconstruct what Athena knew at acceptance time.

## Solution

Resolve each seven-date frame from the effective Store Schedule cycle anchor,
recurring closed days, and date exceptions. A date exception overrides recurring
posture. Operating-hour windows are deliberately absent from the Reports adapter
and never filter financial facts. Activity on a date outside the operational
membership remains visible in a separately named outside-schedule total.

Build on the current Reports model with three stored shapes: one
`reportWeekCurrent` singleton per store, one immutable `reportWeekAccepted` row
per store and cycle, and one `reportDirtyWeek` marker per store. The existing
Reports sweeper replaces current truth atomically from bounded materialized day
inputs. The final scheduled Daily Close triggers a separate cutoff-bounded fact
fold before the accepted row is inserted. Facts observed later, a reopened close,
or a successor close update one current amendment and close posture; they never
rewrite accepted metrics, cutoff, or schedule lineage.

Keep public reads projection-only. The active briefing reads at most one current
singleton and its linked accepted baseline, history uses strict pagination, and
detail is one exact store-and-cycle lookup. Cap-plus-one probes and explicit
completeness states prevent a partial or legacy result from appearing exact.
Repair may rebuild current projections, but it cannot manufacture accepted
history.

Persist unavailable, lifecycle, and amendment posture in the same current
singleton instead of deriving it inside the public query. If a transient rebuild
cannot complete, retain the last verified values and identity while updating the
stored incomplete posture; only a store with no verified current truth receives
a reason-only unavailable singleton. This preserves fixed public read cost while
making retry and cap failures observable.

## Why This Matters

The model preserves three different truths without conflating them: schedule
rules define which dates belong to the business cycle, the accepted row records
what Athena knew at the final-close cutoff, and the amendment records what
Athena knows now. Operators can investigate late facts and revised close evidence
without losing the original end-of-week baseline.

Projection-only subscriptions keep UI read cost fixed and keep React out of
financial arithmetic. Reusing the existing dirty marker and sweeper also avoids
reintroducing the generation, activation, chunking, and second-scheduler
machinery that Athena's deterministic report-day model removed.

## Prevention

- Keep date membership in the Reports-owned weekly resolver; never pass operating hours into its contract.
- Keep current/prior values, comparability, variance, inventory posture, and owner routes in server-shaped projections.
- Require store-prefixed indexes, documented read formulas, and cap-plus-one probes on materialization and public reads.
- Insert an accepted baseline only after the complete cutoff fold succeeds; never patch its financial values or lineage.
- Treat later truth as one replaceable amendment and close posture, not a rewritten baseline or amendment ledger.
- Preserve incomplete or unavailable evidence explicitly; do not convert unknown coverage, legacy observation time, mixed currency, or capacity overflow into zero.
- Normalize store currency through the shared Reports helper both when facts are emitted and when incremental or authoritative folds compare legacy facts. Letter-case drift such as `ghs` versus `GHS` is not mixed currency; a genuinely different code still is.
- Route normal rebuild and missed-intent recovery through `reportDirtyWeek` and the existing Reports sweeper.

## Examples

A store closed every Sunday still includes a Sunday when an effective date
exception marks it open. If Sunday remains closed, financial facts on that date
are disclosed outside the reporting schedule instead of being discarded.

At acceptance, a fact with `observedAt` after the accepted close cutoff does not
enter the immutable baseline. Once normal folding catches up, that fact can
change current truth and produce an amendment delta while the baseline remains
unchanged.

A scheduled live date with no materialized activity is represented as a zero
slot only when the bounded frame has no pending dirty-day fold. A failed fold
re-inserts its marker, so current materialization returns unavailable instead of
publishing a false zero. Folded evidence that does exist still carries its
mixed-currency, payment-coverage, and other fail-closed posture. Accepted cutoff
folds derive every slot from bounded facts, including empty fact sets. Legacy
`observedAt` coverage is established by the bounded migration and independent
verifier before the store capability is enabled.

Legacy Daily Close snapshots may carry the store's lowercase configured code.
The fold canonicalizes that code before comparison, while new snapshots emit
the canonical form. This repairs existing evidence without weakening the
fail-closed behavior for actual foreign-currency facts.

## Related

- [Athena reporting read-optimized redesign](../architecture/athena-reporting-read-optimized-redesign-2026-07-28.md)
- [Athena Store Schedule foundation](../architecture/athena-store-schedule-foundation-2026-06-27.md)
- [Athena Daily Close history snapshots](../logic-errors/athena-daily-close-history-snapshots-2026-05-09.md)
- [Athena report prior-period comparisons](athena-report-prior-period-comparisons-2026-08-01.md)
- [Athena reporting period focus and lifecycle authority](athena-reporting-period-focus-and-lifecycle-authority-2026-08-01.md)

The older Reports workspace and fact/projection notes describe generation-era
mechanics. Their durable bounded-read and failure-isolation principles still
apply, but the weekly implementation follows the newer deterministic fact/day
fold, singleton, dirty-marker, and one-sweeper model above.
