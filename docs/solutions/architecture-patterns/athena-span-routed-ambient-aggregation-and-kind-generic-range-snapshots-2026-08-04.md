---
title: A Period Is Only Real When Every Surface It Reaches Admits Its Span, and an Ambient Aggregation Must Be Routed by Span Rather Than Migrated Wholesale
date: 2026-08-04
category: architecture-patterns
module: Athena Reports / Overview Windows and SKU Mix
problem_type: architecture_pattern
component: convex_backend
resolution_type: code_fix
severity: high
applies_when:
  - "A new selectable period, window, or scope is being added to a workspace that already drives several downstream surfaces from one enum"
  - "A synchronous aggregation is being moved onto asynchronous, admitted, resumable machinery"
  - "The aggregation in question fires ambiently — on page load and on every selection — rather than on explicit demand"
  - "A second or third consumer is about to reuse a bounded-work lifecycle that was written against one hard-coded kind"
  - "A read-time backfill fills fields that a background refresh may never write for quiet tenants"
  - "A span, row, or cardinality ceiling is being raised on a shared constant that several readers happen to share"
related_components:
  - "reports-range-result-lifecycle"
  - "reports-overview-windows"
  - "reports-sku-mix"
  - "reports-sweeper-fold-authority"
  - "shared-demo-fixtures"
tags:
  - contract
  - span-routing
  - ambient-vs-on-demand
  - admission-control
  - resumable-work
  - snapshot-identity
  - calendar-alignment
  - read-time-backfill
  - staged-rollout
delivery_diff_fingerprint: 63749b40754273f4634b51fd9eb0cdce2bd5cde31ee0f0dcabbec0d7d14947c1
---

# A Period Is Only Real When Every Surface It Reaches Admits Its Span, and an Ambient Aggregation Must Be Routed by Span Rather Than Migrated Wholesale

## Problem

Athena's Reports workspace offered four periods — Today, Week to date,
Trailing 30 days, Trailing 3 months. Owners reviewing seasonality had nothing
longer than a quarter. "Add a fifth period" reads like a one-line enum change
and is not one, for three independent reasons.

**The window enum is not a label list; it is a fan-out.**
`REPORT_OVERVIEW_WINDOWS` in `reportPeriodKeys.ts` drove two surfaces at once:
`ReportDateRangeField` derived its range-picker presets from it, and
`ReportsOverviewView` derived the overview tabs from it. Appending
`trailing6Months` therefore ships, in the same commit, a preset that the days
table rejects, a tab with no snapshot behind it, a SKU-detail view whose span
validation throws, and a Units moved sheet whose per-kind span ceiling denies
admission. The enum is the *last* thing that should land, not the first.

**The overview literally could not see that far.** Every period snapshot is an
in-memory filter over one descending read of `reportDay` bounded by
`OVERVIEW_DAY_SCAN_LIMIT = 184`, a number chosen to cover a three-month window
plus its prior-period comparison. A six-month window alone can consume all
184; with its comparison it needs roughly 368. The limit was not a safety
margin being approached — it was an exact fit for the old maximum.

**And the size of that window is not the number people assume.** These windows
are calendar-month aligned (`trailingThreeMonthsStart` returns the first of the
month, not "today minus 91 days"), so a six-month window's length is a sum of
six real month lengths. The four longest runs — Mar–Aug, May–Oct, Jul–Dec,
Aug–Jan — each contain **184** days, not 183. A 183-day ceiling passes every
test written in most months and fails in production only when the anchor date
lands in one of those runs: an intermittent, date-dependent rejection that
looks random and reproduces nowhere.

The hardest constraint was in SKU mix. `listRangeSkuMix` reads `reportSkuDay`
across the span with a 5,000-row cap and *throws* past it. Production moves
~391 distinct SKUs in 30 days (~1,033 rows); a 92-day range already
approaches the wall, and a six-month range clears it routinely. So mix needed
the same treatment Units moved received — bounded, resumable, admitted
snapshots.

Except mix is not Units moved, and this is where a plausible plan goes wrong.
**Units moved is on-demand; mix is ambient.** The mix chart is the Overview's
default content. It fires on every workspace visit and again on every day
click. Moving it wholesale onto the admitted lifecycle would convert the most
frequent interaction in the workspace — clicking a single day — into an
admission-budget-consuming, asynchronous, "computing…" round trip. The
migration that fixes the six-month case would regress the ninety-nine percent
case.

Underneath both sat a fourth problem: `skuMovementRange.ts` had exactly the
lifecycle mix needed — gate ordering, fencing, resumable batches, admission,
retry/backoff, cron backstop, child-first cleanup — and every one of its core
functions guarded on the `"sku_movement"` literal. Copying it would have
tripled that logic and guaranteed divergence on the next fix.

## Solution

Four moves, in dependency order: declare the ceilings, generalize the
lifecycle, add mix as configuration, and only then wire the enum.

### 1. The ceiling is a documented arithmetic fact, not a round number

`REPORT_TRAILING_SIX_MONTHS_MAX_DAYS = 184` carries the derivation at the
constant, including all four 184-day month runs, and an explicit instruction
not to "simplify" it to 183. `REPORT_DRILLDOWN_RANGE_MAX_DAYS` is defined
*from* it, and `OVERVIEW_DAY_SCAN_LIMIT` becomes `2 * 184 = 368` with the
"current window plus its prior-period comparison" derivation written down —
so the sweep scan and `getOverview`'s read-time backfill read from one
constant and cannot drift apart.

Crucially, raising a ceiling was **not** done by editing one shared constant.
`RANGE_MAX_SPAN_DAYS = 92` in `queries.ts` was serving four readers with
different capabilities. It was renamed to `RANGE_SYNC_READER_MAX_SPAN_DAYS`,
kept at 92, and `requireValidDateRange` gained an explicit `maxSpanDays`
parameter so **each query names its own ceiling at its own call site**:

```ts
requireValidDateRange(args.startDate, args.endDate, REPORT_DRILLDOWN_RANGE_MAX_DAYS);
```

`listDays` and `getSkuDetail` widen to 184; `listRangeSkuMix` and the legacy
`listRangeSkuMovement` stay at 92 by construction. A shared constant would
have widened the synchronous readers past what they can actually serve, in
silence.

### 2. The lifecycle is generalized before the third consumer arrives

`convex/reports/rangeSnapshotLifecycle.ts` extracts the kind-generic seams
behind one `RangeSnapshotKindConfig`: gate ordering (allowlist → validate →
revision vector → dedupe → admission → insert + schedule), phase/fence
transitions, retry and backoff, eligible-work scheduling, the sweeper
backstop, child-first cleanup, and sanitized error mapping. Kind-specific
behavior — the source projection and child writer, the totals accumulator,
the phase set, and every batch/admission/backoff/cleanup constant — lives in
the config. `skuMovementRange.ts` shrank by ~570 net lines onto that rail with
no behavior change.

Two decisions inside the generalization are the load-bearing ones.

**A kind may omit ranking.** `hasRankingPhase` lets a config transition
`aggregating → completed` directly. Movement needs ranks because it paginates
by 20-row intervals; mix shows top 5 plus Other and has no ordinal addressing
at all, so a rank field, rank pass, and rank index would be machinery with no
consumer.

**Stored column names stay historical.** The header's `movementPhase`,
`movementFence`, `movementTotals`, and the `reportMovementAdmission` table
keep their names and are documented as the generic rail for any kind.
Renaming stored columns is a migration for zero behavioral benefit; the
docstring carries the explanation so the next reader does not mistake the
prefix for a type.

The sweeper's skips were tightened in the same pass, from `kind ===
"sku_movement"` to `kind !== undefined`, in all three places (`computeRange`,
`computePendingRanges`, `expireRangeResults`). The old form was correct only
until a second kind existed; the new form is exhaustive, so **a future kind
cannot leak into the legacy summary lane** by omission. The kind registry is
deliberately a function rather than a module-level const, because the sweeper
and the kind modules import each other and a top-level read would race module
initialization order.

### 3. Mix routes by span — and the sync path is permanent, not transitional

The client computes the inclusive span and picks a path:

```ts
const isSyncMixSpan =
  inclusiveOperatingDaySpan(skuMixStartDate, skuMixEndDate) <=
  REPORT_SKU_MIX_SYNC_MAX_DAYS; // 2
```

Two days is not a guess. The fold bounds `reportSkuDay` at 2,000 rows per
operating day, so a two-day span reads at most 4,000 rows — strictly under the
synchronous reader's 5,000-row cap. The bound is *provable from an invariant
the fold already enforces*, which is what makes the sync reader a permanent
principled path rather than a deprecation waiting to happen. Every single-day
click — the dominant ambient interaction — stays instant and never touches
admission budget. Only multi-day ranges reach the snapshot lifecycle, whose
184-day ceiling the server enforces independently via
`REPORT_RANGE_MAX_DAYS_BY_KIND.sku_mix`.

Multi-day mix uses the same poll-then-subscribe shape the Units moved sheet
established, for the same reason: `waiting` and `backpressure` deliberately
write nothing durable, so there is no document to subscribe to. One timer per
effect, server-supplied interval, dedupe before admission is charged.

`reportRangeMixSku` is a **sibling** of `reportRangeMovementSku`, not a reuse
of it: movement's `netUnits`/`absNetUnitsSortKey` mean signed movement, which
mix does not have. Mix children carry `unitsSold` and the negated
`unitsSoldSortKey`, the header accumulates `totalUnitsSold` and `skuCount`
*during aggregation* (there is no ranking pass to accumulate in), and the
reader derives the Other bucket arithmetically as total minus visible. The
complete result never crosses to the browser. Admission keys are now
kind-scoped so a third consumer cannot eat Units moved's budget — with no
migration, because buckets are fixed 10-minute windows and rows under a
superseded key age out within one window. Movement's raw keys are
grandfathered for exactly that reason.

### 4. The enum lands last, and presets are decoupled from tabs

`REPORT_DATE_RANGE_PRESET_WINDOWS` was introduced as an explicit list — at
first the existing four — so the window enum could drive the overview tabs
while the range picker stayed narrow. `trailing6Months` was appended to it
only in the final unit, once `listDays`, `getSkuDetail`, Units moved, and
async mix all served 184 days. The invariant "no preset or tab may exist
before every surface it reaches can serve it" therefore holds at *every* unit
boundary, not merely at ship time.

### 5. The read-time backfill computes for quiet stores

`getOverview` enriches legacy singletons at read time. The subtlety: the
sweeper refreshes a store's singleton only when that store has dirty days, so
a quiet store's document may **never** be rewritten — for those stores the
read-time backfill is the only source of the new fields, and it must compute
them rather than default to empties. The backfill's start date is chosen by
"deepest missing field wins" (prior six-month reaches furthest back, then
prior three-month, then three-month, then trend), so one bounded read fills
every shallower gap at once.

## Prevention

- **Treat a period/window/scope enum as a fan-out, not a vocabulary.** Before
  appending a value, enumerate every surface that derives from the enum and
  confirm each admits the new value's extremes. If one cannot yet, split the
  list: one list for what is displayed, one for what is offered, and append to
  the offered list last.
- **Derive calendar-aligned spans arithmetically and write the arithmetic
  down.** A month-aligned window's length is a sum of real month lengths.
  Compute the worst case, enumerate the runs that hit it, and put both at the
  constant — a ceiling that is one short fails only in certain months and
  reproduces nowhere.
- **Never widen a shared ceiling constant. Parameterize the validator
  instead.** When several readers share a limit only because they were written
  at the same time, raising it silently widens the ones that cannot serve the
  wider span. Give each call site its own named ceiling.
- **Classify the workload as ambient or on-demand before choosing a
  mechanism.** Ambient work fires on load and on every selection. Putting it
  behind admission control, asynchrony, and a pending state regresses the
  common case to fix the rare one.
- **Route by span, and prove the fast path's bound from an invariant that is
  already enforced.** "Two days is under the cap because the fold caps a day
  at 2,000 rows" makes the synchronous path permanent and principled. A fast
  path justified only by "it usually fits" is a latent outage.
- **Generalize a bounded-work lifecycle when the second consumer appears, not
  the third.** Extract the kind-generic seams behind one config and add the
  consumer as configuration. Copying fencing, admission, cleanup, and backoff
  guarantees they diverge at the first fix applied to one copy.
- **Make exclusion predicates exhaustive over the open dimension.** `kind ===
  "sku_movement"` was correct until a second kind existed; `kind !== undefined`
  stays correct as kinds are added. An exclusion that enumerates known members
  fails by omission the moment the set grows.
- **Keep historical stored names and explain them.** Renaming columns because
  the abstraction outgrew its first consumer is a migration for a comment's
  worth of benefit. Write the comment.
- **Give a new kind its own admission budget, and let fixed windows do the
  migration.** Kind-scoped keys keep one consumer from starving another;
  short fixed windows mean a key-shape change needs no migration machinery.
- **A read-time backfill must compute, not default, when the background
  refresh is conditional.** If the sweeper only touches dirty tenants, a quiet
  tenant's row may never be rewritten, and defaulting to empties makes the new
  field permanently, silently zero.
- **Register cross-importing modules through a function, not a const.** A
  module-level read of a peer module's export races initialization order when
  the import graph is cyclic.

## Related

- [Trust metadata written by a fold never reaches history, and a range snapshot must own a bounded resumable lifecycle](./athena-certified-fold-provenance-and-bounded-resumable-range-snapshots-2026-08-03.md) — the movement lifecycle this delivery generalized, and the snapshot-identity, fencing, and atomic-batch-vs-failure-record pattern mix inherits unchanged.
- [Athena reports workspace read-model boundary](./athena-reports-workspace-read-model-boundary-2026-07-11.md) — server-shaped meaning, bounded indexed reads, and the coherent continuation context the widened drill-down surfaces still conform to.
- [Athena reports SKU mix aggregation](./athena-reports-sku-mix-aggregation-2026-07-30.md) — the synchronous mix contract this delivery preserves exactly and now routes to by span.
- [A client-side demo read model must derive everything and assert only what it can earn](./athena-shared-demo-client-derived-reports-and-honesty-boundary-2026-08-03.md) — why shared demo serves the new window and the mix lifecycle from derived fixtures without opening a live read or gaining generation authority.
- [A declared fold version with no producer made every report change non-retroactive](../logic-errors/athena-reports-fold-version-refold-and-store-currency-source-2026-08-02.md) — the refold-gap precedent behind the "no fold-version bump, verified rather than assumed" precondition this delivery checked before landing mix.
