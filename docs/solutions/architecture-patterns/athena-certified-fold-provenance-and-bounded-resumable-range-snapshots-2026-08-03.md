---
title: Trust Metadata Written by a Fold Never Reaches History, and a Range Snapshot Must Own a Bounded Resumable Lifecycle
date: 2026-08-03
category: architecture-patterns
module: Athena Reports / SKU Movement
problem_type: architecture_pattern
component: convex_backend
resolution_type: code_fix
severity: high
applies_when:
  - "A synchronous aggregation query rejects a legitimate range because of a row or cardinality ceiling"
  - "New provenance, trust, or version metadata is being added to a derived projection written by a fold"
  - "A feature's correctness depends on a field that exists only on rows written after the change lands"
  - "An asynchronous request must publish one immutable snapshot rather than a moving aggregate"
  - "A client must observe a request whose waiting states deliberately write nothing durable"
  - "A background lane is being added beside an existing declarative dirty-mark sweeper"
related_components:
  - "reports-range-result-lifecycle"
  - "reports-sweeper-fold-authority"
  - "reports-fold-version-repair"
  - "reports-units-moved-sheet"
  - "shared-demo-fixtures"
tags:
  - fold-provenance
  - refold-gap
  - fold-version-bump
  - resumable-work
  - fencing
  - snapshot-identity
  - admission-control
  - poll-then-subscribe
  - direction-words
delivery_diff_fingerprint: 36ae45561f4545c5119d44f14ce3455afa3d116de092806e2b484dd291263155
---

# Trust Metadata Written by a Fold Never Reaches History, and a Range Snapshot Must Own a Bounded Resumable Lifecycle

## Problem

Athena's Units moved sheet aggregated an entire date range inside one Convex
query. `listRangeSkuMovement` in `convex/reports/queries.ts` read
`reportSkuDay` for the whole span with a 5,000-row ceiling, folded it in
memory, then refused any result with more than 100 distinct SKUs
(`RANGE_SKU_MOVEMENT_LIMIT`). A normal trailing-30-day period at a busy store
fails both checks — and it fails while the canonical reporting projections
contain every unit of the evidence needed to answer the question. The operator
sees "choose a shorter range" for a range the product explicitly supports.

The tempting fix is to delete the SKU-count check. That only moves the
failure: the 5,000-row read ceiling is still there behind it, the transaction
read budget is still there behind that, and every one of those ceilings then
resolves into full identity hydration and a complete result shipped to the
browser. The ceiling is not the bug. Doing an unbounded amount of work inside
one transaction, and calling the result trustworthy because it happened to
finish, is the bug.

Making it resumable exposes the harder problem. Work spread across many
transactions is work performed against evidence that can change underneath it.
Answering "what did this range move?" over ten batches is only meaningful if
every batch reads the same generation of source data as every other batch, and
if publication can prove it. That requires per-day provenance on the canonical
projections — and the projections had none. `reportDay` and `reportSkuDay`
carried `foldedAt` and a `foldVersion`, nothing that identifies *which fold*
produced a given row.

And this is where the lesson that generalizes lives. Adding
`certifiedFoldRevision` to `foldAndReplaceDay` makes every *future* fold
certify itself, which reads like a complete change and is not one. Athena's
sweeper folds a day only when that day is marked dirty. A clean historical day
is never refolded, so it never acquires the new field, so it is permanently
inadmissible as movement evidence. The plan for this work originally recorded
that "no historical backfill is required"; a planning review falsified that
claim before implementation started. Every store's entire history would have
been silently unusable — not broken loudly, just perpetually waiting.

The same reasoning has a corollary that is easy to miss. A store outside
`REPORTS_SWEEP_STORE_ALLOWLIST` never folds at all. It therefore can never
certify a day, so "wait for certification" is a state it can never leave. A
waiting state that is unreachable-by-construction is a hang wearing a spinner.

## Solution

Two halves that only work together: force history to re-earn its provenance,
and make the snapshot a bounded, fenced, resumable object whose identity
includes that provenance.

### 1. Provenance is stamped by the fold and migrated by a version bump

`foldAndReplaceDay` (`convex/reports/sweeper.ts`) now computes a per-day
monotonic counter and stamps it on the day document *and* on every
`reportSkuDay` row the fold replaces, in the same transaction:

```ts
const certifiedFoldRevision = (existingDay?.certifiedFoldRevision ?? 0) + 1;
```

A counter, not the fold timestamp — two folds in the same millisecond must not
collide, and a counter is deterministic inside the mutation. Because the fold
already rewrites a day's SKU rows wholesale, the SKU rows ride along at no
extra cost, and `movementSourceRowMatchesRevision` can later prove a given SKU
row belongs to exactly the day generation the snapshot admitted.

The migration is the load-bearing half. `REPORTS_FOLD_VERSION` went 2 → 3 in
the same change, purely so that `foldVersionRepair`'s staleness predicate sees
every pre-revision day. The predicate is now explicit about both causes:

```ts
export function needsCertifiedRefold(day: {
  foldVersion: number;
  certifiedFoldRevision?: number | null;
}): boolean {
  return (
    day.foldVersion !== REPORTS_FOLD_VERSION ||
    day.certifiedFoldRevision === undefined ||
    day.certifiedFoldRevision === null
  );
}
```

The repair marks stale days `reason: "fold_version_bump"` and lets the sweeper
— the single fold authority — rewrite them. No second writer was introduced;
an in-place backfill script would have been exactly that, and the module
forbids it. A read-only `countUncertifiedDays` reports, per page,
`staleFoldVersionCount`, `missingRevisionCount`, and their sum, so "is this
store ready" is an observable fact rather than an assumption.

That makes the rollout a hard sequence, documented in the module docstring:
deploy schema → deploy stamping + the version bump → run the repair per
allowlisted store and let the sweeper drain (bounded by `SWEEP_DIRTY_BATCH`
days per five-minute tick, so the drain window is predictable from history
length) → confirm `uncertifiedCount: 0` on every page → only then enable the
backend and UI for that store.

Admission's treatment of an uncertified day is deliberately asymmetric with
the not-allowlisted case. An allowlisted, mid-repair store returns `waiting`,
because the repair genuinely will finish. A non-allowlisted store returns a
distinct, sanitized, non-retrying `not_available` before any validation or
read — because for that store, waiting is forever.

### 2. One admitted request is one immutable snapshot

`convex/reports/skuMovementRange.ts` extends the existing `reportRangeResult`
header with `kind: "sku_movement"` rather than building a second request
framework. A row with no `kind` is a legacy custom-summary request and keeps
its exact prior semantics, including failed-row reuse until TTL and the
366-day span; span limits are now per-kind
(`REPORT_RANGE_MAX_DAYS_BY_KIND`: 92 for movement, 366 for summary).

The snapshot's identity is the whole point. `computeMovementRequestKey` hashes
a fixed-order tuple of kind, store, start, end, fold version, movement
contract version, **and the certified revision of every included operating
day**. Consequences fall straight out of that: reopening with unchanged
sources reuses the completed snapshot; any included day changing revision
produces a *successor* request rather than mutating a published one; a
summary and a movement request over identical dates cannot collide; and an
absent day is represented by an explicit `"empty"` sentinel, so "this day had
no fold" is part of the identity rather than an omission from it.

Work proceeds one operating day at a time — `reportSkuDay` is already capped
at 2,000 rows per day by the fold, so a day is a naturally bounded unit — with
phases `queued → aggregating → ranking → completed`, plus `retry_wait`,
`terminal_error`, and `cleaning`. Every committed batch increments a fence,
and every batch is dispatched with an expected `{phase, fence}` pair:

```ts
if (row.movementPhase !== args.expectedPhase || row.movementFence !== args.expectedFence) {
  return { next: "stale" };
}
```

A duplicate scheduled worker, a superseded attempt, or a replayed continuation
observes the mismatch and no-ops. Ranking resumes off the maximum already
assigned rank and continues exactly across the compound sort-key index (the
remainder of the resume key's group, then strictly greater keys), so a rank is
never assigned twice. Convex indexes ascend only, so the sort key is the
negated absolute net (`-Math.abs(netUnits) || 0`, normalizing `-0`) with
`productSkuId` as the tie-break — one deterministic ordering shared by both
tabs and directly addressable as a 20-row rank interval.

Publication is the second provenance check, not the first one trusted twice.
Rank finalization re-reads the bounded revision vector and compares it entry
for entry against the admitted one; a mismatch, or any dirty marker in range,
goes terminal with `movement_source_stale` and erases the running totals
rather than publishing them. A header only reads as completed when phase,
totals, and completion time are all present together — `deriveMovementRequestLifecycle`
is conservative by construction, so partial state can only ever surface as
pending.

### 3. Atomic work and failure recording are different transactions

The module's first `internalAction` is a wrapper that never touches the
database. It calls one batch mutation, and that mutation deliberately does not
catch unexpected exceptions — Convex rolls back aggregates, cursor, and fence
together. The action then records retry state in a *separate* mutation:

```ts
} catch (error) {
  const outcome = await ctx.runMutation(MOVEMENT_FAILURE_REF, {
    rangeResultId: args.rangeResultId,
    expectedFence: args.expectedFence,
  });
  console.error(`[reports.skuMovementRange] worker batch failed ...`, error);
}
```

Attempt count, capped exponential backoff, and eligibility time therefore
survive a rollback that discards the work itself. Five failures go terminal
with a sanitized code and an opaque correlation id; the exception text stays in
backend logs. The failure mutation is itself fenced, so a late failure report
from a superseded attempt records nothing.

### 4. A cron backstop that only schedules

Movement departs from the sweeper's documented dirty-marks-only stance, and
the sweeper's header comment was rewritten to say so rather than left to
contradict the code. The division is now explicit: **declarative dirty marks
own folds; the movement lifecycle owns its own globally indexed eligible-work
queue.** The sweeper's movement section runs *unconditionally*, not gated on
`touchedStores`, because a dropped continuation must be recoverable at a store
with no dirty days. It only ever schedules workers and deletes expired rows —
`computePendingRanges` and `expireRangeResults` both skip `sku_movement` rows,
and `computeRange` short-circuits on them as defense in depth, so the summary
path can never overwrite movement lifecycle state. Cleanup is child-first:
children carry their own `expiresAt` and are found without loading headers, and
a header passes through an explicit `cleaning` phase until none remain.

### 5. Waiting states write nothing, so the client polls before it subscribes

`waiting`, `backpressure`, and `not_available` are returned by the ensure
mutation with zero writes and zero schedules. There is no document to
subscribe to, and inventing one would make backpressure durable. So the sheet
polls the idempotent ensure mutation on a server-supplied, jittered interval,
and switches to a subscription only once a request key exists. The polling
timer belongs to the effect that armed it, so closing the sheet cancels it and
a StrictMode double effect tears down its first timer before arming the
second — timers cannot stack, and duplicate ensures land on the same request
because dedupe is checked *before* admission budget is consumed.

Admission itself is three fixed-window counters (principal, store, global)
checked across all scopes before anything is written; saturation returns
retryable backpressure having written nothing. Reuse of an existing request
never spends budget; a retry does, because a retry creates work.

### 6. Signs are a data property; direction is a presentation decision

Ranking is by absolute net movement and the stored value keeps its sign, so
outbound movement and net returns stay distinguishable and a fully cancelled
SKU (equal sold and returned) still appears at net zero. But in retail copy a
leading `+` reads as *stock received*, which inverts the meaning for the
reader. The UI therefore never shows a sign:

```ts
export function formatNetUnitsMoved(netUnits: number): string {
  if (netUnits > 0) return `${formatUnits(netUnits)} out`;
  if (netUnits < 0) return `${formatUnits(-netUnits)} returned`;
  return "0 net";
}
```

with a matching spoken form ("289 units out"), direction-aware bar geometry on
a zero-centered axis, and axis labels reading `returned` / `out` where the
ticks no longer carry direction. The signed number is untouched in the data,
the ranking, and the contract.

## Prevention

- **Assume new fold-time metadata is invisible on history until proven
  otherwise.** Clean days never refold. Any field a fold writes reaches only
  rows written after the change, so "no backfill required" is a claim that
  must be falsified against the refold trigger, not asserted from the diff. The
  vehicle is a `REPORTS_FOLD_VERSION` bump plus the existing per-store repair,
  and the acceptance evidence is a coverage query reading zero, not a
  successful deploy.
- **Ship the migration as an ordered rollout step with an observable gate.**
  Schema → stamping + version bump → repair → drain → coverage zero → enable.
  Write the expected drain rate down (batch size per tick × history length) so
  the window is a plan, not a surprise.
- **Never add a second writer for a projection that has a single fold
  authority.** A bespoke in-place backfill is a second fold authority even when
  it only touches one field.
- **Check the never-reachable case before the wait state.** If a precondition
  can never be satisfied for some tenants — a store outside the sweep
  allowlist can never certify — return a distinct, sanitized, non-retrying
  outcome. A wait that cannot end is a hang.
- **Put provenance inside the request identity, not beside it.** Folding the
  per-day revision vector into the request key makes reuse, invalidation, and
  successor creation fall out of one hash comparison instead of becoming
  bespoke freshness logic.
- **Verify provenance at admission, at every batch, and again at
  publication.** Evidence that was clean when the work started is not evidence
  that was clean when it finished.
- **Fence every phase transition and make the fence advance on every commit.**
  Duplicate schedulers, replayed continuations, and superseded attempts are
  the normal case in a resumable worker, not an edge case.
- **Let the atomic batch fail and record the retry separately.** A mutation
  that catches its own defect cannot roll back cleanly; a rollback that also
  discards attempt counters cannot back off.
- **A completed state must require every field that makes it meaningful.**
  Derive the public lifecycle conservatively: phase plus totals plus
  completion time, together, or it is still pending.
- **When a new lane contradicts a module's written design stance, rewrite the
  stance.** The sweeper's header now names the split — dirty marks own folds,
  movement owns its queue, the cron only schedules — because a comment that
  disagrees with the code teaches the next reader the wrong invariant.
- **Waiting states that write nothing need a poll, not a subscription.** Give
  the server control of the interval, add jitter, own exactly one timer per
  effect, and dedupe before charging admission so duplicate effects are free.
- **Keep signs in the data and words in the UI.** Where a `+` has a domain
  meaning that conflicts with the reader's, render direction words and leave
  the signed value as the ranking basis.

## Related

- [A declared fold version with no producer made every report change non-retroactive](../logic-errors/athena-reports-fold-version-refold-and-store-currency-source-2026-08-02.md) — the earlier instance of the same refold gap, and the origin of the repair mechanism this migration rides on.
- [Athena reports workspace read-model boundary](./athena-reports-workspace-read-model-boundary-2026-07-11.md) — the server-shaped meaning, bounded indexed reads, and explicit trust boundaries the movement page reader conforms to.
- [Athena reports SKU mix aggregation](./athena-reports-sku-mix-aggregation-2026-07-30.md) — complete server-owned aggregation with identity hydration only after the visible subset is known; the movement page hydrates at most 20 identities after rank selection for the same reason.
- [A client-side demo read model must derive everything and assert only what it can earn](./athena-shared-demo-client-derived-reports-and-honesty-boundary-2026-08-03.md) — the shared-demo movement page derives from the same transaction fixture and is denied generation authority server-side.
