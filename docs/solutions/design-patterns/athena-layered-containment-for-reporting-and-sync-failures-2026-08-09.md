---
title: Escalate contained failures instead of retrying them silently
date: 2026-08-09
category: design-patterns
module: athena-webapp reporting ingestion and POS local sync
problem_type: design_pattern
component: backend_boundary
resolution_type: code_fix
severity: medium
applies_when:
  - "A contained failure degrades to a marker that itself fails to write"
  - "A client retries an upload the server rejects on every attempt"
  - "A wedged pipeline is visible only to someone who opens a detail page"
tags: [containment, reporting-ingest, pos-sync, dead-letter, health-alerts]
related_components: [reports, pos-sync, terminal-runtime, notifications]
delivery_diff_fingerprint: ff9ce790f0780d08b49e41a03119346bcc3efcff5025de449dde843e2864e527
---

# Escalate contained failures instead of retrying them silently

## Problem

`recordFacts` contains every internal failure so a reporting bug can never roll
back a sale: the failure degrades to a `write_failure` dirty mark and a normal
return. The containment had one hole and one blind spot.

The hole: if the dirty mark itself could not be written, the throw propagated
and aborted the domain transaction. That is the right call over a silent data
hole, but it made a single unhappy table able to reject a sync batch.

The blind spot: an aborted ingestion escapes the whole POS sync mutation, so
nothing commits — no sync event, no conflict, no review item. The terminal's
cursor never advances and it resubmits forever under exponential backoff. For a
transient fault that is correct and self-healing. For a persistent one the
batch retries indefinitely, and the only signal is `lastFailureMessage` on the
terminal detail page. `sync_stuck` did not fire, because that condition means a
*held* batch behind an unadvanced cursor, not a batch the server throws away.

## Solution

Add a layer below containment, and turn "retried too long" into a first-class
observable state at both ends.

**Third containment layer.** The catch block in `recordFacts` now tries the
inline dirty mark, and on failure enqueues a durable scheduled mutation instead
of throwing:

```ts
try {
  for (const date of dates) await markDirty(ctx, storeId, date, "write_failure");
} catch {
  await ctx.scheduler.runAfter(0, internal.reports.marks.markWriteFailureDays, {
    storeId,
    dates,
  });
}
```

The enqueue is a write to a different table than the one that just refused, and
a scheduled mutation is durable once the transaction commits. The throw is
still reachable — if the enqueue also fails — so the atomic-abort backstop
survives, now requiring two independent write paths to refuse.

**Failure streak as reported state.** The sync scheduler already counted
consecutive failures, but only for backoff. That count now rides the heartbeat
into `posTerminalRuntimeStatus.sync.consecutiveFailureCount` and feeds a third
health-alert condition, `sync_failing`, on the existing edge-trigger plus
cooldown machinery. `sync_stuck` keeps its meaning; the new condition covers the
throwing case it never described.

**Dead-letter for poison batches.** After the same threshold of consecutive
*upload* failures, `onPersistentFailure` fires once per streak. The runtime
parks the batch's events `needs_review` locally first, then best-effort records
a `needs_review` conflict through a deliberately tiny mutation, so the wedge
reaches the register-session review surface a manager already watches.

## Why the streak lives in the hook

The runtime creates a fresh drain scheduler per trigger. A per-instance counter
resets on every drain and never reaches the threshold, so the streak is held in
a ref and seeds each instance through `initialFailureCount`. Seeding at or past
the threshold marks the streak already-escalated, so a new instance cannot
re-fire an escalation a previous one already made.

## Boundaries worth preserving

- Only failures thrown by `uploadBatch` count toward the dead-letter. Local
  read and settlement failures are excluded by a batch-in-flight guard, so a
  failing IndexedDB read never looks like a poison batch.
- Parking happens before the cloud report. Leaving the retry loop must not
  depend on a network call that is failing by definition.
- The dead-letter conflict is idempotent while open and classified
  `reject_only`: the server never accepted the batch, so there is nothing to
  apply or override.
- `consecutiveFailureCount` is sanitized with `positiveCount`, not
  `nonNegativeInteger`. An absent or invalid report must stay absent rather
  than become an asserted "zero failures".
- Review-only escalation drains do not dead-letter; they already operate on
  parked events.

## Result

The failure that motivated this now has a full path: retries with backoff, then
at the threshold a `sync_failing` manager email *and* a dead-lettered batch in
the review queue. After the underlying fix the review flow re-drains it, and
structural fact identity makes the replay a no-op.

## Prevention

Three checks catch this class of gap before it ships.

**Put each fallback on a different write path from the layer above it.** A
fallback that writes to the table that just refused shares the fault it exists
to survive. When adding a containment layer, name the resource the previous
layer failed on and confirm the new one does not touch it.

**Ask what a retry loop looks like after the tenth attempt, not the first.**
Backoff makes transient faults invisible, which is its job, and makes permanent
faults invisible too, which is not. Any unbounded client retry needs a
threshold at which it stops being a retry and becomes a report. The tests here
assert the escalation fires once per streak and re-arms after a success —
both directions matter, since an escalation that cannot re-arm silently stops
working after the first incident.

**Verify an alert actually covers the case you think it does.** `sync_stuck`
looked like coverage for "sync is broken" and was really coverage for one
specific shape of broken. Reading the classifier's predicate against the code
path that produces the failure is what separated them; assuming from the
condition's name would not have.

Finally, when a counter drives a threshold, check that it outlives the object
holding it. The per-instance streak here was correct in isolation and unable to
ever reach its threshold in production, which only running the real path
revealed.

Related: [[athena-reports-refold-gap]], [[verify-by-running-not-asserting]]
