---
title: A Span Ceiling Is a Proxy for Cost, and a Rail That Already Loads the Range Can Measure the Cost Instead
date: 2026-08-04
category: architecture-patterns
module: Athena Reports / SKU Mix Routing and Day Fold
problem_type: architecture_pattern
component: convex_backend
resolution_type: code_fix
severity: high
applies_when:
  - "A read is routed to expensive machinery by a cheap proxy (span, page count, item count) rather than by its actual cost"
  - "A worst-case bound used for routing is orders of magnitude above what production tenants actually produce"
  - "Another already-loaded query covers the same range and could size the expensive read for free"
  - "A derived counter is written by more than one path (a batch fold and an incremental ingest) and must not drift"
  - "An optional field is added to a table whose historical rows are never revisited by normal traffic"
  - "A backfill refold would advance a provenance counter that other snapshots depend on"
related_components:
  - "reports-sku-mix"
  - "reports-days-rail"
  - "reports-sweeper-fold-authority"
  - "reports-ingest-incremental"
  - "reports-range-result-lifecycle"
  - "reports-fold-version-repair"
tags:
  - measured-vs-proxy-routing
  - read-sizing
  - admission-control
  - dual-writer-invariant
  - optional-field-backfill
  - sparse-tables
  - unknown-is-not-zero
  - provenance-invalidation
delivery_diff_fingerprint: c737a6d7b0f5dc71be442caf4e726ff10b0dcd40528a90a99ad324e74eff2b13
---

# A Span Ceiling Is a Proxy for Cost, and a Rail That Already Loads the Range Can Measure the Cost Instead

## Problem

The Reports SKU-mix pie chart was moved onto the bounded resumable
range-snapshot lifecycle that powers the Units moved sheet. Correct, but slow
to interact with: any selection longer than two days paid an `ensureMixRange`
admission, a `retryAfterMs` poll loop, and a scheduled snapshot build before
the first slice rendered.

The two-day threshold was not arbitrary. It was *provable*: the fold bounds
`reportSkuDay` at 2,000 rows per operating day, so a two-day span reads at most
4,000 rows, strictly under the synchronous reader's 5,000-row cap. Everything
wider went async because nothing could prove it was cheap.

The obvious-looking fix — "the days table loads the same range fast, use its
rail" — does not work, and the reason is worth stating precisely.

**`listDays` and the mix chart share a metric name, not a grain.** `reportDay`
holds one document per operating day with store-wide scalars; its `unitsSold`
means "the store sold 412 units that day". The pie slices *by SKU*, which only
exists in `reportSkuDay` — one row per (day, SKU). For a 184-day window that is
184 documents versus up to 368,000 rows. Routing the chart at the days rail
would yield a single total with nothing to divide it into.

**The pre-aggregated rail is also not the answer, and production says why.**
`reportPeriodSkuRollup` already stores per-SKU totals per `d:`/`w:`/`m:` period
key, and the trailing-six-month window is calendar-month aligned at its start.
Measured against production, month rollups compress only 1.0x–2.8x — across the
whole window, 2,366 rows collapse to 1,082. Wigclub's catalogue is long-tail
(628 distinct SKUs over 2,366 SKU-days, so a SKU sells on ~3.8 days total), and
pre-aggregating by month only helps when SKUs *repeat* across days. A hybrid
whole-months-plus-partial-tail fold to save ~1,300 row reads is not worth the
seam.

## Root Cause

The routing predicate answered the wrong question. It asked *how wide is this
range* as a stand-in for *how much will this read cost*, because cost was not
knowable without doing the read.

The proxy was calibrated to a worst case production sits far below. Wigclub's
busiest day in seventeen months folds **88** SKU rows against the 2,000-row
bound — roughly 23x below — with a median of 30. The entire 184-day window
reads 2,366 rows, comfortably inside the synchronous reader's own cap. The
chart was buying admission control to fold a few hundred rows.

## Solution

**The fold already knows the number; publish it.** `foldDay` returns a
`skuDays` map that *is* the day's row set — every entry patched or inserted,
every existing row absent from it deleted. So `result.skuDays.size` equals the
post-fold `reportSkuDay` count exactly, and the sweeper writes it onto the day
document in the same mutation that writes those rows.

No `REPORTS_FOLD_VERSION` bump. The fold's output is unchanged; refolding is
not a correctness repair, and bumping would have invalidated certified
provenance for stores already cleared for the movement lane.

**Route in two tiers.** The span rule survives as an unconditional floor that
never depends on loaded data, so a day click cannot regress because the days
rail has not answered yet. Above it, `skuMixSyncRowProbe` sums `skuDayRowCount`
across the selection from rows the panel already holds and routes synchronously
when the total clears `REPORT_SKU_MIX_SYNC_ROW_BUDGET`.

The days rail is the right source not because it holds the data, but because it
already covers the range for free. **The cheap query sizes the expensive one.**

### Four decisions that carry the design

**Unknown is not zero.** A day whose `skuDayRowCount` is absent makes the whole
range indeterminate — not "the sum of the rest". The probe returns `undefined`
and routing falls back to the span rule, so the worst case of an unproven probe
is exactly the prior behavior, never a read the reader might refuse.

**Absent rows, however, *are* zero.** `reportDay` is sparse: wigclub has 108
day documents across 511 calendar days. A day with no document had no activity
and therefore no SKU rows. Treating those gaps as unknown would make the
cheapest ranges unprovable. This is why coverage bounds are separate required
arguments — they prove the reader *looked* at the range, which row presence
alone cannot.

**The budget sits below the cap, not at it.** `REPORT_SKU_MIX_SYNC_ROW_BUDGET`
is 4,000 against a 5,000-row reader cap. The probe sizes rows folded a moment
before the read happens; a concurrent fold can add rows in between. The gap
absorbs that drift instead of letting the reader's fail-closed throw surface to
an operator as "choose a shorter range".

**Span ceilings are per-caller, and only the proxy moves.** `listRangeSkuMix`
moved from the 92-day `RANGE_SYNC_READER_MAX_SPAN_DAYS` to the 184-day
drill-down ceiling, because span is no longer how it proves cost. The
5,000-row cap still fails closed and always was the real bound. The legacy
movement reader keeps 92 — it has no probe, so span remains its only proxy.

## The dual-writer invariant

The trap: `reportDay` has **two** writers. The sweeper folds it, and
`ingest.ts` maintains it incrementally between folds — including inserting new
`reportSkuDay` rows as facts arrive for the open day. A count written only by
the fold goes stale-low all day on exactly the day operators watch most.

Ingest's SKU upserts were moved *ahead of* the day write so the count lands in
the same patch, with three cases:

- **new day** — this batch's inserts are its only rows;
- **counted day** — base plus inserts (ingest patches existing rows and never
  deletes; only the fold removes rows);
- **pre-U8 day** — stays absent. The base is unknown, so base-plus-inserts
  would be a guess presented as a measurement.

Rule: *when a derived counter has more than one writer, every writer must
maintain it in the same transaction as the rows it counts, or the counter is
only trustworthy at the moment the slowest writer ran.*

## Backfill and its blast radius

Historical settled days never refold under normal traffic, so they never
acquire the count on their own. Without a backfill the probe is permanently
indeterminate for any range touching them — the feature self-heals forward at
one day per day, reaching full six-month coverage in six months.

`skuDayRowCountBackfillNeeded` is deliberately **separate** from
`needsCertifiedRefold` and reported as its own counter. Certification is the
movement lane's *trust* boundary; this is the mix lane's *sizing* hint. A day
missing the count is fully trustworthy. Merging them would make
`countUncertifiedDays` report a movement-readiness failure for a performance
shortfall.

This also exposed a latent bug: `missingRevisionCount` inferred "missing
revision" from *stale AND current fold version*, which after U8 also matches a
certified day that only wants the count. It now tests the revision directly.

**The cost of the backfill is not the refold.** Each refold advances
`certifiedFoldRevision`, which is the movement trust boundary. The changed
revision fails `sameRevisionVector`, so every completed Units moved and
multi-day mix snapshot covering a refolded day goes `terminal_source_stale` and
rebuilds on next ensure. Self-healing, but visible — run it off-peak.

## Verification

Dev wigclub, 73 days: all marked, drained, and reconciled — **73/73 published
counts equal the actual `reportSkuDay` row count**, 830 rows total against 830
summed, no SKU-day date lacking a day document. The `min 0` day matters: zero
stored as a measurement, not a gap.

Post-backfill the probe routes every dev window synchronously (184 days = 830
rows). Dev is small — median 9 rows/day — so this validates the mechanism, not
the budget.

Worth recording: the dev deployment's 5-minute sweep cron was not firing, so
the drain had to be driven by hand. `reports/sweeper:sweep` invoked directly
folded 10 days per call with zero failures. Any dev verification of
cron-driven behavior should confirm the cron actually ticks first.

## What this does not fix

At wigclub's current run rate (55.3 facts, 33.8 SKU rows per active day, open
every day since ~2026-05-12) a fully operating 184-day window is ~6,214 SKU
rows — genuinely over the 5,000 cap. The full six-month window legitimately
belongs on the async rail from roughly 2026-10-07 onward.

The probe's win is everything narrower: day, week, month and quarter
selections stay synchronous through realistic growth, where previously anything
over two days did not. That is the ambient-interaction complaint, and it is the
part that was never actually expensive.

## Prevention

**Before routing on a proxy, ask what the proxy stands in for and whether
something already loaded can measure it.** Span, page count, and item count are
all stand-ins for cost. If another query on screen already covers the same
range, the cost is usually knowable for free. Reach for the proxy only when
nothing can measure.

**Check a worst-case bound against production before building on it.** The
2,000-rows-per-day fold ceiling is real and correctly enforced, but production
sits 23x below it. A routing rule derived from a safety ceiling will be wrong
by that same factor. Pull the real distribution — median, p95, max — before
deciding a range is expensive.

**When adding a derived counter, enumerate every writer of the table first.**
`grep` for `insert("<table>"` and `patch("<table>"` across the backend. Here
that surfaced `ingest.ts` maintaining `reportSkuDay` incrementally between
folds — invisible from the fold path, and the difference between a counter
that is exact and one that silently drifts low all day.

**Keep an optional field's absence meaning "unknown", and make callers prove
coverage separately.** Defaulting absence to zero converts a gap into a
confident wrong answer. On a sparse table the distinction is subtle: a missing
*row* legitimately means zero, while a missing *field* means unknown. Encode
both, and require explicit coverage bounds so "the reader never looked" cannot
masquerade as "there was nothing there".

**Separate trust predicates from performance predicates even when they share a
repair path.** Both send a day through the same refold, so merging them is
tempting. But they answer different questions, and a merged predicate makes a
missing performance hint read as a trust failure on the rollout gate.

**Before backfilling, trace what the refold invalidates.** A refold that
advances a provenance counter cascades into every snapshot whose revision
vector includes that day. Follow the counter to its consumers and schedule
accordingly.

## Related

- [[athena-span-routed-ambient-aggregation-and-kind-generic-range-snapshots-2026-08-04]] —
  established the span-routing rule this note supersedes for the mix lane.
  Its ambient-vs-on-demand reasoning still holds; only the cost predicate changed.
- [[athena-certified-fold-provenance-and-bounded-resumable-range-snapshots-2026-08-03]] —
  the `certifiedFoldRevision` provenance the backfill perturbs.
