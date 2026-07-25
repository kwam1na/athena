---
title: A Burned Upload Sequence Wedges A POS Terminal Forever Unless Something Decides To Skip It
date: 2026-07-25
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: pos-local-sync
resolution_type: code_fix
severity: high
applies_when:
  - Designing an ordered, gap-free delivery protocol where the producer allocates sequence numbers before the payload is durable
  - A POS terminal reports sync held/out_of_order indefinitely and its cursor stops advancing
  - Adding a time-window-bounded automation whose blockers can outlive the window
tags: [pos, local-sync, upload-sequence, ordering, reconciliation, daily-close, convex]
delivery_diff_fingerprint: cbaf2f1d9235b4d91fef8512a01d33cf0a22c5a13482fe25703368f69d3fc9e3
---

# A Burned Upload Sequence Wedges A POS Terminal Forever Unless Something Decides To Skip It

## Problem

POS terminals upload offline events under a per-cursor `uploadSequence`, and the server only
projects sequence `acceptedThroughSequence + 1`. Anything ahead of that is parked as
`held`/`out_of_order` until its predecessor arrives. That rule is what keeps offline POS history
in causal order, and it is correct **as long as every allocated sequence eventually shows up**.

It does not always show up. A local event can be purged by ledger maintenance, dropped by a torn
write, or rejected client-side *after* its upload sequence was allocated — burning that number
permanently. The successors then wait on a predecessor that no longer exists anywhere. The
terminal wedges: sales and register closes stay local forever while the scheduler loops the same
held batch behind exponential backoff. Nothing in the system was empowered to conclude "that
sequence is never coming"; the only exit was a human noticing a `sync_stuck` alert.

The terminal made this worse by guessing. It learned only that its batch was blocked, not by
what, and assumed the blocker was a stuck `needs_review` precursor — so it drove a
review-inclusive drain, which is a no-op when the real cause is a missing sequence.

The wedge then took out an unrelated subsystem. `runConfiguredDailyOperationsAutomation` closes a
store day inside a roughly four-hour eligibility window. On 2026-07-24 a wedged terminal held the
register-close event, so the day carried a `register_session` blocker through all five
eligibility runs, and the wedge cleared 76 minutes after the last one. Nothing ever revisited the
day, so the books stayed open permanently.

## Solution

Three cooperating pieces, none of which trusts the others to be right:

1. **Durable gap state.** `ingestLocalEvents` records a `gap` on the sync cursor whenever events
   are parked behind a missing predecessor: which sequence is missing, when it was first and last
   observed, how many times, and whether a probe was issued. It is cleared as soon as the cursor
   reaches the awaited sequence. Absent on the overwhelming majority of cursors.

2. **A pure escalation policy.** `sequenceGapPolicy.ts` decides from durable state alone —
   no clock, no database — following `observe → probe the terminal → skip only on evidence or
   timeout`. It is slow to skip (a gap must persist 15 minutes and be seen at least twice before
   a probe; an unanswered probe waits 24 hours) and refuses to skip more than
   `SEQUENCE_GAP_MAX_SKIP_SPAN` (5) consecutive sequences, because a large contiguous run means
   something structural is wrong and a human should look before history is written past it.

3. **Terminal-side diagnosis.** `syncGapDiagnosis.ts` turns the guess into an answer. The cloud
   already says which sequence it is waiting on (`acceptedThroughSequence + 1`); checking that
   against the local ledger yields a `HeldSyncBlocker` reported on the heartbeat as
   `heldBlockerKind` / `heldBehindMissingUploadSequence`. `missing_locally` is the terminal
   asserting the event is gone, which lets reconciliation skip without a probe round trip.

The `reconcilePosLocalSyncSequenceGaps` cron is the I/O around that decision: gather terminal
evidence, ask the policy, then probe, skip, or do nothing.

Separately, `owedDailyCloseSweep` removes the eligibility cliff. Instead of asking "is now the
right time to close today?", it asks "which store days are still owed a close, and is each one
closeable now?", delegating each owed date to the existing support-hardened
`runHistoricEodAutoCloseForDate`.

## Why This Works

**Skipping is never silent.** Every skip records a `sequence_gap_skipped` conflict naming the
exact sequences that were stepped over, surfaced to managers through `RegisterSessionView`. That
conflict is the entire safety story: history moves again, and if one of those burned sequences
was a real sale, it surfaces as a drawer discrepancy to investigate rather than a number that
quietly never existed. The failure mode degrades from "terminal is silently dead" to "manager has
a specific thing to check."

**Positive assertions are never overridden.** `awaiting_local_upload` and `awaiting_review` are
the terminal stating it still holds the awaited event. The policy must not skip past either — only
`missing_locally` evidence or an unanswered-probe timeout permits a skip.

**The owed set is derived, never stored.** `dailyClose` rows are already the authority on which
days are closed. A parallel "owed days" table could drift from them, and drift in an accounting
ledger is worse than the original bug. A day is only ever closed when the decision adapter judges
it eligible, so a real cash variance or pending approval keeps it open no matter how old it gets;
past the staleness threshold it escalates to an operational event instead of retrying invisibly.

## Prevention

- Any protocol that allocates a sequence number *before* the payload is durable must have a
  documented, automated answer to "what if this number never arrives?" Strict ordering without a
  reconciliation path converts a single lost event into permanent, unbounded data loss.
- When a client can only observe *that* it is blocked, give it enough information to determine
  *why* before it acts. A remediation driven by a guessed cause is a no-op at best.
- A time-windowed automation needs a companion sweep whenever its blockers can outlive the window.
  Ask "what happens if the blocker clears one minute after the last run?" — if the answer is
  "nothing, ever", the window is a cliff.
- Keep escalation thresholds in a pure, clock-free module so the ladder is unit-testable and every
  threshold is readable in one place.

## Examples

The refusal rules are the interesting part of the policy — it declines to act far more often than
it acts:

```ts
// The terminal says it still has the event. Never skip past that.
if (evidence.blockerKind === "awaiting_local_upload") return { action: "wait" };
if (evidence.blockerKind === "awaiting_review") return { action: "wait" };

// A structural run, not a handful of burned numbers. Escalate to a human.
if (skipSpan > SEQUENCE_GAP_MAX_SKIP_SPAN) return { action: "escalate" };
```

And a superseded clear still uploads rather than being dropped locally, precisely to avoid
creating a new gap:

```ts
export type PosLocalSyncSaleClearedPayload = {
  localPosSessionId: string;
  reason?: string;
  // The event still uploads — skipping it would burn its upload sequence and
  // wedge every later event behind the gap — but the server must not void the
  // session, or the superseding sale would land in review.
  supersededByLocalTransactionId?: string;
};
```

## Related

- [Anonymous Callers Need An Explicit Public Actor In Operation Admission](../architecture-patterns/athena-public-operation-admission-2026-07-24.md)
