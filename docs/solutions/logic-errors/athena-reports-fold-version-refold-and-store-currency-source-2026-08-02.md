---
title: "A Declared Fold Version With No Producer Made Every Report Change Non-Retroactive"
date: 2026-08-02
category: logic-errors
module: Athena Reports
problem_type: logic_error
component: database
symptoms:
  - "Production Weekly briefing renders no totals at all; every figure reads Unavailable"
  - "Weekly completeness reports `mixed_currency` for a store that only ever transacts in one currency"
  - "Bumping `REPORTS_FOLD_VERSION` changes nothing; already-folded days keep their pre-change values forever"
  - "The `fold_version_bump` dirty reason is declared in the schema union but never appears in `reportDirtyDay`"
  - "Dev looks correct because its report tables were cleared and rebuilt after the change"
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
related_components:
  - "report-day-fold"
  - "reports-sweeper"
  - "report-dirty-day"
  - "daily-close"
  - "store-currency"
  - "weekly-report-completeness"
tags:
  - "fold-version"
  - "refold"
  - "retroactive-projection"
  - "currency-normalization"
  - "mixed-currency"
  - "idempotent-migration"
  - "bounded-maintenance"
  - "normalize-at-the-source"
delivery_diff_fingerprint: 3f02ada70421128e0e91599ab9a40e2d9a49ccd66d3f2c03a4e0ab699d0721e4
---

# A Declared Fold Version With No Producer Made Every Report Change Non-Retroactive

## Problem

Athena's Reports model stores a materialized `reportDay` row per store-date, each
stamped with the `REPORTS_FOLD_VERSION` in force when it was folded. The
`reportDirtyDay` schema declared a `fold_version_bump` reason for exactly this
situation. Neither half was wired up: nothing ever produced that reason, and no
code path ever compared a stored row's `foldVersion` against the current
constant. The version was written and never read.

The consequence is that every change to what `foldDay` computes was silently
non-retroactive. Days folded before the change kept their old values and old
flags permanently, and bumping the constant did nothing at all. The gap was
invisible in development, where the report tables had been cleared and rebuilt
after each change, so every row happened to be current. It surfaced only on
production data that had been folded once and never revisited.

What surfaced it was a second defect. Production store Wigclub had
`store.currency = "ghs"` while its POS facts carried `"GHS"`. Daily Close stamps
its `close_snapshot` report facts from `store.currency`; the day fold compared
raw strings, concluded the day held two currencies, set `flags.mixedCurrency`,
and excluded those facts. That flag propagates into weekly `completeness`, and
the Weekly UI withholds **every** total for `mixed_currency`. The newly enabled
weekly surface therefore rendered no numbers at all. The root cause of the bad
stored value is mundane: the store-creation modal's currency field is free text
defaulting to empty, and `stores.create` inserted whatever it received verbatim.

## Symptoms

- Production Weekly reads `mixed_currency` and withholds net sales, units, payment posture, and variance — the whole briefing is `Unavailable`.
- `close_snapshot` facts are excluded from folds for a single-currency store.
- Normalizing the comparison in `foldDay` fixes new folds but leaves every historical day exactly as wrong as before.
- `REPORTS_FOLD_VERSION` can be edited to any value with no observable effect anywhere.
- `grep fold_version_bump` finds one schema literal and zero producers.

## What Didn't Work

- **Fixing only the fold comparison.** Normalizing currency inside `foldDay` is
  necessary but inert on its own: the affected days were already folded, so no
  read path recomputes them. The fix is correct and still changes nothing an
  operator can see.
- **Bumping `REPORTS_FOLD_VERSION` and expecting a refold.** The bump is the
  signal, not the mechanism. Without something that compares stored versions and
  enqueues work, the constant is decorative.
- **Trusting the dev environment as evidence.** Dev report tables had been
  cleared and rebuilt, so every row was already at the current version. Dev
  cannot reproduce a staleness bug whose precondition is stale rows.

## Solution

Two fixes, one per defect, plus the maintenance path each needs for data already
written.

**Close the refold gap.** Bump `REPORTS_FOLD_VERSION` 1 → 2 for the
currency-normalization change and add `convex/reports/foldVersionRepair.ts`: a
bounded, store-scoped, idempotent maintenance pass that pages `reportDay`, finds
rows whose `foldVersion` differs from the current constant, and marks them dirty
with `fold_version_bump` for the existing sweeper. A read-only
`countStaleFoldVersionDays` reports the same staleness without writing.

Three design points are load-bearing:

- It **marks rather than refolds inline**, so the sweeper remains the single fold
  authority and the work inherits its caps, failure handling, and retries.
- When a day is **already queued it writes nothing at all**. One mark per
  (store, day) already means "refold me", so there is nothing to add — and every
  possible write is harmful. The sweeper drains oldest-`markedAt` first, so
  refreshing recency would push an already-waiting day to the *back* of the
  queue and delay a pending `close_accepted` fold behind a bulk version repair.
  Patching the reason would erase that more specific cause. Inserting would
  duplicate the queue row and fold the day twice.
- Staleness is filtered **in memory per bounded page**, because `reportDay`'s
  only index is `by_storeId_operatingDate`. Adding an index to serve a one-shot
  maintenance path would tax every fold write forever.

**Normalize store currency at the source.** `stores.create` now routes the
incoming value through the existing shared `normalizeCurrencyCode` helper, so a
lowercase or whitespace-padded code cannot be stored again. For rows already
written, `convex/migrations/backfillStoreCurrencyCase.ts` is an idempotent
migration that defaults to dry run — only an explicit `dryRun: false` writes —
paired with a read-only verifier.

Uppercasing stored values was confirmed safe by a consumer audit before the
migration was written: the currency symbol formatter already keys on uppercase
and looks up via `.toUpperCase()` (so lowercase was the fragile case, not the
safe one), every currency equality comparison normalizes both sides, and currency
appears in no Convex index, no `.eq()` filter, no URL, no filename, and no cache
key. Nothing derives a key from the stored letter case.

Both maintenance paths take the same opt-in `autoContinue` continuation as the
existing Reports migrations, self-scheduling the next page and carrying running
totals, so a production run is one fire-and-forget call rather than one
invocation per page.

### Also in this branch: a Monday-only crash in the shared-demo POS fixture

Unrelated to the two gaps above, but fixed here because it blocked this branch's
CI. `buildStorePulseSummary` read `history.at(-1)!` and `history.at(-2)!`. Those
non-null assertions are false for a short window: the `this_week` window starts
at Monday, so **on a Monday it contains exactly one day**, and
`dayBeforeYesterday` came back `undefined`, throwing on `.salesTotal`.

It reproduces deterministically — the fixture throws for `today = Monday` and
succeeds on all six other weekdays — and it is pre-existing on `main`, so CI
fails for anyone whose run lands on a Monday. The fixture's own coverage pinned
the clock to a Thursday, which is precisely why it never caught this.

**Why it looked like flake.** The trigger is the *local operating date* being a
Monday, and `getLocalOperatingDate` shifts the instant by the local UTC offset
before slicing the date. CI runs in UTC and saw Monday; a developer machine
behind UTC converts the same instant back to Sunday and sees nothing wrong. Three
local runs — plain, under coverage, and with a naively pinned clock — all passed
while CI failed twice in a row. Reproducing it required `TZ=UTC` *and* a midday
pin, since an early-morning pin lands on the previous local day.

The fix has two parts. The fixture falls back to a zeroed day so a short window
compares against nothing rather than crashing, with a test sweeping all seven
weekdays across all four pulse windows. Separately, `PointOfSaleView.test.tsx`
pins the operating clock to a Thursday via `setOperatingClockOverride`, because
its assertion — that fixture history renders in non-today windows — is simply
false on a Monday, when the week-to-date window legitimately holds one day.

**Open product question, not addressed here:** on Mondays the shared demo's
"This week" view is genuinely empty. It now degrades gracefully instead of
throwing, but whether a demo should show an empty week is a product call.

Two lessons worth carrying: a `!` on `Array.at()` is an assertion about array
length that the type system cannot check, and a date-relative fixture pinned to
a single weekday only ever tests one seventh of its behaviour.

## Why This Works

The stored `foldVersion` was always the right idea — it records which
computation produced a row. What was missing was the single step that turns a
recorded version into work: comparing it to the current one. Adding a producer
for the already-declared `fold_version_bump` reason completes a circuit the
schema had described but never energized, and it does so by feeding the existing
dirty-marker queue rather than by introducing a parallel refold path.

Normalizing in `stores.create` moves the invariant to the only place a bad value
can enter, which is what makes the fold's comparison trustworthy going forward.
The migration exists because normalizing at the source cannot retroactively fix
rows written before the boundary existed — the same shape of gap as the fold
version, handled the same way: fix the writer, then run a bounded idempotent pass
over what the old writer left behind.

The production blast radius is narrower than the symptom suggests, and that is
worth recording. Only `close_snapshot` facts carried the store's currency, and
those never contribute to sales totals. Revenue was never wrong. The entire
damage was the flag, and the flag's effect was that the surface withheld
everything — a fail-closed control doing exactly what it was designed to do, on
a false premise.

## Prevention

- Treat a stored version stamp as an obligation: if a row records the version that produced it, some path must compare that stamp to the current value and enqueue repair. A stamp with no reader is worse than no stamp, because it looks like the problem is handled.
- Treat a declared enum literal with no producer as an unfinished feature. Grep for producers when adding a `reason`, `status`, or `kind` union member.
- When changing what a fold or projection computes, ship the retroactivity plan in the same change: bump the version, and state which maintenance call must run per store and per environment.
- Never accept a clean dev environment as evidence for a staleness bug. Dev with rebuilt tables has no stale rows to find.
- Normalize external or operator-entered values at the write boundary, not at each comparison. Every un-normalized comparison site is a future defect.
- Before uppercasing or otherwise rewriting a stored field in place, audit its consumers for index terms, `.eq()` filters, URLs, filenames, and cache keys. In-place normalization is safe only when no derived key depends on the old form.
- Make maintenance passes bounded, store-scoped, idempotent, and dry-run-first, and give them the same `autoContinue` continuation as existing migrations so a production run is one call.
- Preserve a more specific pre-existing dirty reason rather than overwriting it with the generic one; refresh the marker's timestamp instead.
- When new internal registrations trip the exact-equality public-surface lock in `convex/reports/queries.test.ts`, extend the internal-only list. Do not loosen the assertion to a subset check — the exactness is the point.

## Related Issues

- [Athena weekly reports use a schedule-day-driven projection lifecycle](../architecture-patterns/athena-schedule-day-driven-weekly-report-projection-lifecycle-2026-08-01.md) — establishes the fold, dirty-marker, and sweeper model this repair plugs into, and the fail-closed completeness posture that made a stale flag withhold every total.
- [Athena reporting read-optimized redesign](../architecture/athena-reporting-read-optimized-redesign-2026-07-28.md) — introduced the deterministic `reportDay` fold and the single-sweeper authority this change deliberately does not bypass.
