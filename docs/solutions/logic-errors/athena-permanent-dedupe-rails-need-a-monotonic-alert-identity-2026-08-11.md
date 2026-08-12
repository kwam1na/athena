---
title: Permanent-dedupe rails need a monotonic alert identity
date: 2026-08-11
category: logic-errors
module: athena-webapp/convex/reports
problem_type: logic_error
component: service_object
symptoms:
  - "A discrepancy whose fingerprint oscillated A -> B -> A with no intervening clean run produced only two alerts; the third (the return to A) was silently dropped by the notifications rail"
  - "The dedupe key (subject + fingerprint + reArmEpoch) rebuilt a byte-identical string for the second A, and the rail's permanent unique lookup swallowed it"
  - "The existing flap test passed while the hole existed, because its flap path bumped the re-arm epoch and never exercised a frozen-epoch oscillation"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - notifications
  - dedupe
  - alerting
  - verification-sweep
  - fingerprint
  - streaks
  - test-blind-spot
delivery_diff_fingerprint: 156727f93f449cf2cc389d9b79e3e4d9ef2c2bce955dfe6f4baf1af9d1fa564d
---

# Permanent-dedupe rails need a monotonic alert identity

## Problem

The report verification sweep (V26-1188..V26-1192) routes discrepancy alerts
through the admin notifications rail, whose dedupe is a **permanent unique
lookup with no expiry**: any emission whose `dedupeKey` string was ever seen is
dropped forever. The sweep's key was built from subject + unexplained-set
fingerprint + `reArmEpoch`, which looks complete — the epoch bumps whenever a
clean run re-arms alerting, so a recurring identical discrepancy after recovery
gets a fresh key. Adversarial review found the case that identity misses: a
fingerprint that oscillates A → B → A **without any intervening clean run**
leaves the epoch frozen, rebuilds a byte-identical key for the second A, and
the rail drops a genuinely new alert on the floor.

## Symptoms

- Streak logic decided to alert (fingerprint changed, alerting armed), an
  intent was recorded, and no email ever went out for the third transition.
- No error anywhere: permanent dedupe drops are silent by design, so the loss
  is invisible unless you know to look for the missing intent.
- The test suite was green. The flap test "proving" re-alerting exercised the
  clean-run path, where the epoch bump makes the key fresh — it never pinned
  the epoch and oscillated the fingerprint underneath it.

## What Didn't Work

- **Treating fingerprint + re-arm epoch as sufficient identity.** The epoch
  only advances on clean-run re-arm. Any alert-worthy transition that does not
  pass through a clean run (fingerprint churn inside one continuous streak)
  reuses the frozen epoch, and a revisited fingerprint reconstructs an
  already-consumed key.
- **Relying on the existing flap test as proof.** A test that re-alerts via the
  epoch path proves the epoch path. It says nothing about the oscillation path,
  because the two paths differ exactly in whether the epoch moves.

## Solution

Add a **never-reset monotonic sequence** to the alert identity. The run row
carries `alertSeq`, incremented every time the streak logic decides to emit and
never reset — not by clean runs, not by re-arms
(`convex/reports/verificationSweep.ts`). The registry folds it into the key
(`convex/notifications/registry.ts`):

```ts
return joinKeyComponents([
  "reports.verification_discrepancy",
  String(p.storeId),
  p.subjectKind,
  p.subjectKey,
  p.fingerprint,
  String(p.reArmEpoch),
  // `?? 0` because the run row's column is optional: rows written before
  // it landed have no honest value, and a missing component must not
  // stringify to "undefined" inside a permanent unique key.
  String(p.alertSeq ?? 0),
]);
```

Two ordering details matter:

1. `alertSeq` is optional on pre-existing rows, so the key builder must give
   the missing case an explicit honest value (`?? 0`) rather than letting
   `undefined` stringify into a permanent key.
2. The tests now cover the actual hole: the pure-layer test gives an A → B → A
   oscillation three distinct alert identities, and the orchestrator test
   (`verificationSweep.test.ts`, "T2b") drives the oscillation **inside one
   streak with the epoch frozen** and asserts three intents distinguished only
   by `alertSeq`.

## Why This Works

A dedupe key is a claim about identity: two emissions with the same key *are
the same alert*. Every component the sweep previously used was **state-derived**
(subject, current fingerprint, epoch), and state can revisit earlier values —
so identity built purely from state cannot distinguish "same alert" from "state
happens to look the same again." Against a rail whose dedupe never expires,
that distinction is the whole game. A monotonic counter is the one component
that is **event-derived**: it encodes "this is the Nth time we decided to
alert," which can never recur. With it in the key, byte-identical collisions
require the decision counter itself to repeat, which it structurally cannot.

## Prevention

- When the consumer of a dedupe key is a **permanent** unique lookup, audit
  every key component: if all of them are derived from current state, some
  state cycle will rebuild an old key. Include at least one monotonic,
  never-reset component (sequence, decision counter).
- A monotonic column added to an existing table is optional on old rows; the
  key builder must map absence to a stable explicit value, never let
  `String(undefined)` into a permanent key.
- When a state machine has two re-alert paths (epoch bump vs. fingerprint
  churn), a test per path — the flap test must *freeze* the variable the other
  path relies on, otherwise it proves the wrong path and greenwashes the hole.
- Same delivery, adjacent trap: streak state carried across runs must persist
  its tracked **field list**, not just the fingerprint (a hash is not
  invertible). Carrying only the hash makes the next run's
  "still-the-same-fields" check a vacuous `.every` over `[]`, which clears
  streaks unchecked (`verificationClassify.ts`,
  `VerificationStreakState.unexplainedFields`).

## Related Issues

- Linear [V26-1190](https://linear.app/v26-labs/issue/V26-1190) — review round
  that surfaced the oscillation hole; V26-1193 tracks the follow-up per-date
  execution split for the aggregate transaction budget.
- `docs/plans/2026-08-10-001-feat-report-verification-sweep-plan.md` — the
  delivery this was found in.
- [athena-admin-notifications-rail-2026-07-29](../architecture-patterns/athena-admin-notifications-rail-2026-07-29.md)
  — the rail whose permanent intent-ledger dedupe makes key identity
  load-bearing.
- [athena-verifier-payment-lane-capacity-and-unverified-is-not-mismatched-2026-08-03](athena-verifier-payment-lane-capacity-and-unverified-is-not-mismatched-2026-08-03.md)
  — earlier verifier learning: a capped scan supplies no attribution; a lower
  bound must never be used as an explanation ceiling.
