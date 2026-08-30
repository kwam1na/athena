---
title: Reduce reports read amplification without publishing partial truth
date: 2026-08-29
category: performance-issues
module: Reports pipeline
problem_type: performance_issue
component: background_job
symptoms:
  - "A bounded reports sweep still hydrated large frozen closes repeatedly."
  - "Weekly refreshes and wholesale period rollups amplified the same source payload."
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [convex, reports, read-amplification, projections, checkpoints, migration]
delivery_diff_fingerprint: 9be94add912f28cc4a360931ded0ffbeb41d98c9dcc8a36098feb0f29e254087
---

# Reduce reports read amplification without publishing partial truth

## Problem

PR #811 contained a reports sweep failure but left expensive repeated reads. Bounding the number of days or closes does not bound their total payload. Splitting a large sweep into workers can also merely redistribute reads unless the complete recurring workload is measured.

## Symptoms

- Post-hotfix point samples still read megabytes during a sweep. Point samples were diagnostic, not matched usage windows.
- Weekly processing repeatedly read frozen close snapshots, and period rollups reread prior days after a single day changed.
- A maximum-cardinality test initially consumed 5.7 MB because validated compact children were hydrated a second time in the same acceptance execution.

## What Didn't Work

- A count cap alone did not establish byte headroom.
- Function isolation alone did not establish aggregate savings.
- Seeding new delta checkpoints against mutable legacy totals could double-apply changes.
- A paged rebuild without publication and activation fences could expose mixed generations.

## Solution

Keep financial source commands atomic. Move only derived reporting work behind exact durable identities and independently retryable transactions:

```text
source transaction -> fact/compact invalidation
one-day fold -> canonical rows + immutable input + exact obligations -> dirty acknowledgement
bounded worker -> checkpoint delta -> period complete -> publish revision
```

Normalize frozen close evidence outside `reportDay`; invalidate its scalar header in the source lifecycle transaction, then hydrate one full close per materialization generation. Reuse the validated compact snapshot within an execution. Keep live inventory attention in Operations-owned compact contributions and a separate Reports frame-fenced companion.

Build delta rollups from zero in a fresh epoch. Track exact day/SKU contributions, including reversible unknown profit and deletions. A period stays pending until all obligations drain; cursors bind to publication revision. Summary ranges similarly keep partial totals private and verify their captured range input basis before publishing.

Migration proves authoritative source-date coverage, accepted-cutoff replay and checkpoint/output parity. Source/accepted watermarks and the control fence bind all proof pages to activation. A destructive reseed retains the lost-observation boundary; unverifiable historical accepted evidence blocks instead of being rewritten. Reset/deletion paths fence workers, and child-first cleanup excludes poisoned/expired work from healthy queues.

## Why This Works

Compact immutable inputs eliminate repeated wide payload hydration, while checkpoints eliminate whole-period recomputation. Exact work identities, separate failure transactions and publication gates preserve correctness when a worker retries, a source changes mid-batch or a continuation is dropped.

The deterministic registered-worker fixture measured three busy weekly refreshes at 8,489,472 → 307,073 returned UTF-8 bytes and three period changes at 344,228 → 128,481 bytes. Calls increase; weekly returned-document counts also increase. This is bandwidth evidence, not a universal query-count, latency or billing reduction. Initial materialization has a separate cost. Production acceptance still needs matched 24-hour and 72-hour windows.

## Prevention

- Measure the whole pipeline, including source projections, dispatch, retries, materialization, recovery and maintenance. Keep bytes, documents, calls and writes distinct.
- Test the admitted cardinalities and state exactly which payload shape the byte fixture proves. Preserve completeness with sentinels/cursors; never silently truncate money to fit a budget.
- Assert that duplicate delivery does not change output or evidence counts, and that failed data work cannot commit partial output.
- Test quiet history, missing derived rows, stale proof, in-flight expiry, poisoned ownership and deletion through every lifecycle entry point.
- Preserve activation history separately from live epoch pointers and per-attempt resume policy. Repeated reseeds must not target deleted epochs or erase eligibility for proved reactivation.
- Carry recovery posture through every reader: formerly active shadow control without a live epoch is not legacy authority. Keep period rows unavailable and weekly freshness pending through pause/rebuild; test the registered public queries as well as worker helpers.
- Resolve a folded date against every overlapping immutable accepted frame after schedule-anchor changes; latest-only lookup loses exact refresh work.
- Keep rollback as a proved fresh rebuild. Never make stale legacy rows current by flipping a flag.

## Related Issues

- [Implementation plan and review record](../../plans/2026-08-29-001-refactor-reports-pipeline-read-containment-plan.md)
- [Operational runbook and production acceptance](../../operations/reports-pipeline-read-efficiency.md)
- [Reporting fact/projection boundary](../architecture/athena-reporting-fact-projection-boundary-2026-07-09.md)
- [V26-1452](https://linear.app/v26-labs/issue/V26-1452)
