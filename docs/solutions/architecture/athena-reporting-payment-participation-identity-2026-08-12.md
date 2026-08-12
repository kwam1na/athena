---
title: "Athena Reporting Counts Tender Use by Participation Identity, Not by Allocation"
date: 2026-08-12
last_updated: 2026-08-12
category: architecture
module: athena-webapp
problem_type: architecture_pattern
component: service_object
resolution_type: code_fix
severity: medium
applies_when:
  - "A report aggregates a COUNT of distinct real-world events from per-row evidence"
  - "Payment method, tender mix, or allocation evidence enters a reporting projection"
  - "An incremental projection path and an authoritative refold must agree on a count"
  - "A destructive reseed replays sources that already carry a correction's outcome"
tags:
  - reporting
  - payment-mix
  - participation-identity
  - reseed
  - projections
delivery_diff_fingerprint: 99e422dc99ebbb67fe02294221ab5d7dd6705275e06781d324dd49ff252228e2
---

# Athena Reporting Counts Tender Use by Participation Identity, Not by Allocation

## Problem

Weekly Payment mix reports two different things per method: a VALUE and a COUNT
of tender uses. Value is additive, so it folds like every other metric. The
count is not: `paymentAllocation` holds one row per allocation, and a single POS
transaction routinely carries several allocations of the same method. Counting
rows would report one cash sale as two cash uses, disagreeing with Daily Close's
`buildPaymentTotals`, which counts the TRANSACTION.

Two further hazards sit behind that:

1. The incremental open-day path and the authoritative refold see facts in
   different orders and must still produce the same count.
2. The destructive reseed re-walks sources that already reflect an approved
   method correction, so replaying the correction's audit history would apply
   the same move twice.

## Solution

Separate the two aggregations. Value sums. Count is derived from a set of
`(participation identity, normalized method)` pairs, where participation
identity is the Daily Close-aligned unit of use:

- a POS-backed allocation uses its `posTransactionId`, so several same-method
  allocations on one transaction collapse to one use while keeping every
  allocation's value;
- an allocation with no POS transaction uses its own identity, so non-POS
  receipts stay independently countable.

The identity is derived centrally in the one allocation emitter every payment
domain already passes through, never asked of each source.

Order-independence comes from storing a NET COUNT per pair rather than adding
and removing set members. A receipt adds one to its pair; an approved method
correction subtracts one from the old pair and adds one to the new. A pair with
a positive net is exactly one tender use. This holds regardless of the order the
receipt and the correction are folded in — which matters because the correction
fact is dated to the original allocation's business time and therefore ties with
the receipt it corrects.

Publication is all-or-nothing against a reconciliation target: a `complete` mix
must sum exactly to the same frame's `paymentsCollectedMinor`, and anything
short of that is `unavailable`. A method breakdown that does not add up to the
total printed beside it is worse than no breakdown.

Two rules follow from that target and are easy to get backwards:

- **Gross mix follows the receipt, not the allocation's later fate.** An inbound
  allocation that was subsequently voided still contributes its gross method
  value on the day it was received, because `paymentsCollectedMinor` counts that
  receipt either way. Reducing gross mix for the reversal would leave the day
  unable to reconcile to its own total. Reversals and refunds move settlement.
- **The rendered mix covers the same frame as the total beside it.** Reports
  and the weekly email print Payments received for the whole labelled range —
  included plus outside-schedule — so the effective mix is both lanes combined
  at read time (and, on an accepted read with an amendment, the amendment's
  mix, because the reader sees amendment totals). Stored documents keep the
  lanes separate.
- **Absent is unknown, never zero.** A day, revision, or fact written before the
  mix landed carries no mix field, and that absence withholds its lane rather
  than reading as an empty breakdown. On an accepted or corrected report the
  absence is positive legacy authority: read the frozen `closeEvidence.payments`
  and never reconstruct.

Reseed keeps its purge-then-rebuild contract: an allocation's PERSISTED method
is already its final state, including after an approved correction, so the
rebuilt receipt carries that method directly and the correction's audit history
stays audit-only during reseed.

## Verification

The independent verifier recomputes method values and participation counts from
the source ledger and reports value and count disagreements separately per
method, so a drifted arithmetic rule and a drifted participation rule are
distinguishable. Legacy or unclassifiable evidence classifies as `unavailable`
rather than as a mismatched zero, and a field the source side could not
establish is reported as unchecked rather than as wrong.

## Consequences

An amendment must be raised only by a knowable-to-knowable difference. A lane
that went from `complete` to `unavailable`, or a legacy baseline that never had
a mix, is unknown — and nobody amends an accepted report because a fact stopped
being provable. Weekly truth fingerprinting therefore hashes a mix only when it
is `complete`, and the amendment gate compares both sides for known change.

## Prevention

- Never derive a COUNT of real-world events by counting evidence rows. Name the
  participation identity the count is about, and count distinct
  `(identity, dimension)` pairs.
- Derive that identity once, centrally, from fields the source row already
  carries. Asking each source domain for it invites per-source drift.
- Store a net count per pair rather than adding and removing set members, so an
  incremental path and an authoritative refold agree regardless of fold order.
- Never publish a breakdown that does not reconcile exactly to the total printed
  beside it. Withhold the whole breakdown instead.
- Treat an absent optional field as unknown, never as zero — and on an immutable
  accepted revision, as positive legacy authority to read the frozen evidence.
- Never let a projection go from knowable to unknowable and call that a change.
  An amendment claims the period MOVED; a fact that stopped being provable did
  not move anything. State that rule ONCE and apply it everywhere it belongs —
  here it had to hold in three places written at different times (the amendment
  gate, the truth fingerprint that dedupes the amendment's timestamp, and the
  verifier's expectation of when an amendment is legitimate), and each one was
  missed in a separate review round.
- A verifier must expect every cause of a projection's output, not just the
  causes that existed when the verifier was written. Adding a new reason for a
  projection to change without teaching the verifier about it converts correct
  behaviour into a standing alert.
- Never use the destructive reseed as a rollout backfill, and never replay a
  correction whose outcome the rebuilt source row already carries.
