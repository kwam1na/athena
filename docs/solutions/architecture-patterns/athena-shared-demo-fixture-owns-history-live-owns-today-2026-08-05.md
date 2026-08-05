---
title: A Demo Fixture Should Own History and Nothing Else — the Current Day Belongs to the Live Rows
date: 2026-08-05
category: architecture-patterns
module: Athena Shared Demo / Reports, POS Hub, Daily Operations
problem_type: architecture_pattern
component: full_stack
resolution_type: code_fix
severity: high
applies_when:
  - "A demo or seeded experience answers a surface entirely from a client fixture while the same store also accumulates real rows"
  - "A fixture's history window ends at yesterday and the current day renders as a confident zero"
  - "Two sibling components derive the same document through separate hook instances and can settle on different commits"
  - "A client derives an operating date from the browser clock while the server derives it from the store timezone"
  - "Derived or projected rows are written by domain mutations but are absent from a restore/reset registry"
  - "A fixture mints synthetic ids that are handed to a route backed by real rows"
related_components:
  - "shared-demo-reports-fixture"
  - "shared-demo-operations-fixture"
  - "reports-live-day"
  - "shared-demo-restore-registry"
  - "operating-date-authority"
  - "reports-overview-route"
tags:
  - fixture-history-live-today
  - seam-ownership
  - zero-is-not-absence
  - single-source-single-settle
  - clock-authority
  - derived-state-restore
  - identity-bridge
  - layout-stability
delivery_diff_fingerprint: ba308d9799fbcf7540100641c37b4f5e86c87a35b6ba71ffe1683ad7c6b8cda2
---

# A Demo Fixture Should Own History and Nothing Else — the Current Day Belongs to the Live Rows

## Problem

The shared demo store is a real Convex store. A visitor rings sales on a real
POS register, and those sales write real `posTransaction` rows, real
`reportFact` rows, and an incrementally-patched `reportDay`. But three
surfaces — Reports, the POS Hub pulse, and Daily Operations — answered from a
client fixture whose history window ends at **yesterday**.

So the current day rendered as zero on all three, while the visitor's own sales
sat in the database a few hundred milliseconds away.

The symptom was hard to notice for a specific reason worth naming: **the wrong
value was always a zero.** GH₵0 with "No transactions" reads as *nothing
happened today*, not as *this surface cannot see today*. It is indistinguishable
from a genuine quiet day, and the demo has genuine quiet days (Sundays are
closed). Nobody reported it as a bug for months.

Each surface expressed it through a different mechanism, which is why fixing
one did not fix the others:

| Surface | Mechanism |
| --- | --- |
| Reports | Fixture emits an empty `createEmptyMetric(today)` for the current day |
| POS Hub | The live read is **skipped entirely** for any window other than "Today" |
| Daily Operations | The week rail is built from `buildFixtureHistoricalMetric`, whose `hasFixtureHistory` excludes today by design |

## Root Cause

The fixture was written as *the* answer for the demo, rather than as the answer
for the part of the timeline the database cannot supply. Once a demo store
accrues real rows, that framing is wrong: the fixture is a **history
substitute**, and history stops at yesterday.

Two supporting facts made the live path viable and were not obvious:

1. **`recordFacts` has no store gating.** A demo sale runs the same ingestion as
   any other store's, patching `reportDay` and `reportSkuDay` *inside the sale's
   own transaction* (`reports/ingest.ts`, the "open day is a preview"
   invariant). The demo's current day was already materialized — nothing was
   reading it.

2. **The sweeper-written artifacts are the wrong source.** `reportOverview` and
   `reportPeriodSkuRollup` are rebuilt on a five-minute cron and are
   allowlist-gated (`REPORTS_SWEEP_STORE_ALLOWLIST`, fail-closed). A visitor who
   rings a sale and looks at Reports must see it immediately, so the read has to
   be the incrementally-patched day tables, not the rollups. This also means the
   demo needs **no allowlist entry** for the feature to work.

## Solution

One rule, applied to every surface: **the fixture owns every date before today;
the store's live rows own today.**

`reports/liveDay:getLiveOperatingDay` returns the single open day's
`reportDay` + `reportSkuDay` rows. `sharedDemoLiveReportsDay` normalises that
payload into the fixture's vocabulary, and `getModel(today, liveDay, liveStock)`
folds it onto the cached history **by copying** — the cache holds fixture
history only, so a merged read can never poison a later fixture-only one.
Because the injection happens at the model, all eight projections (overview,
day rows, trend, SKU mix, items, movement, detail, weekly) inherit it with no
per-projection logic.

The same shape, twice more: `createSharedDemoPointOfSaleStorePulseSummary` and
`createSharedDemoDailyOperationsFixture` accept the live day and substitute it
for their empty current-day metric *before* their summaries are folded, so
trend, totals, payment mix and comparisons all derive from one consistent
array.

### The seam has to be enforced, not just intended

`toSharedDemoLiveReportsDay` discards any payload whose `operatingDate` is not
today. A late fact or a clock disagreement must never let a live row shadow the
fixture's history.

### Five things that had to move with it

**Facts must be purged with the transactions.** The reporting tables were absent
from `SHARED_DEMO_MUTABLE_TABLES`, so the hourly restore wiped `posTransaction`
and left `reportFact` behind. Harmless while nothing read them; the moment
Reports went live it would have shown revenue for sales that no longer existed.
`reportFact` is the load-bearing one — `foldDay` rebuilds a day *from surviving
facts*, so the next dirty-day sweep would have resurrected the deleted revenue.
These tables are registered as `derived: true`: restored (purged) but never
*captured* into a baseline, since freezing them would pin phantom revenue that
every later restore faithfully reinstates.

**Clock authority.** The client derived "today" from the browser clock; the
server derives it from the store timezone. One demo store is served worldwide,
so a visitor west of Accra asked for a day the server had already closed. The
store timezone is now published on the demo context and installed as an
override inside `getLocalOperatingDate`, which every one of ~30 call sites
already routes through — so the whole app converges with no per-site edits.
Epoch *bounds* (`completedFrom`) are the exception a formatting override cannot
reach and were fixed explicitly.

**Identity bridges, in both directions.** Live rows carry Convex ids; the
fixture is keyed by `shared-demo-sku-<slug>`. Rows are rewritten into fixture id
space at the boundary so `isSharedDemoReportsSkuId` — the gate keeping route
params away from throwing resolvers — stays true downstream. The reverse leak
existed too: the SKU detail page linked out with a fixture-invented
`shared-demo-product-<slug>`, which `getByIdOrSlug` cannot resolve, rendering a
live product as "This product has been deleted". The demo's provisioned rows
carry the story slug, so emitting the slug resolves with no new query.

**A demo-only value is a bug, not a shortcut.** `quantityAvailable` was declared
on the contract but populated *only* by the fixture. `resolveSkuIdentity`
already reads the `productSku` document, so publishing it cost zero extra reads
and made the field real for every store.

**Stock is not day-scoped.** It is one current value per SKU, unaffected by the
selected date, so it is its own read (`listLiveSkuStock`) rather than a lane on
the operating day.

## Two Defects Found While Verifying

Both pre-existed this work and are worth recording because both were *animating
the arrival of data as though the data had moved*.

**`FlipNumber` defaulted `transitionFromZero` to `"flip"`.** The house pattern
is `value={total ?? 0}`, so a metric mounts holding a placeholder zero and the
real figure is mechanically its first *change* — a full glyph flip on every page
load. 58 of 67 `OperationsSummaryMetric` call sites took the default; nine had
already opted into `"fade"` one at a time. The default is now `"fade"`; a change
between two real values still flips.

**Two hook instances of the same document settle on different commits.** The
Reports route gated the page on its own `useStableReportQuery(overview)`, and
`ReportsOverviewView` re-derived the same document through *its own* instances —
justified as free because the Convex client dedups the read. Dedup makes the
second read free; it does not make it **simultaneous**. On a fresh mount the
view's instance settled one commit later, and for that commit the view returned
`null` while its sibling panels — which have no such gate — painted their
reserved shells at the top of the page. Measured 0.21 CLS, demo-only because a
real store's route cannot un-gate until the server answers, by which time
everything is warm.

The fix is not a delay or a placeholder: the route passes its settled document
down as a prop and the view holds no query at all. One source, one settle.

## Prevention

- **Ask what a zero means on every seeded surface.** "Nothing happened" and "I
  cannot see this" must not render identically. The three bugs here survived
  because they rendered as plausible quiet days.
- **A fixture is a history substitute.** Scope it to dates the database cannot
  answer, and enforce the boundary in code rather than trusting callers.
- **Derived rows belong in the reset registry** the moment anything reads them —
  and especially when a fold can reconstruct them from a source you *did* purge.
- **Two components deriving the same document is a layout-stability hazard**,
  not merely a redundant read. Pass settled data down instead.
- **Free-because-deduped is not free-because-synchronous.**
