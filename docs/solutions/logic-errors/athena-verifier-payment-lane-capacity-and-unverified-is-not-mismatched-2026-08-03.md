---
title: A Verifier Must Be Sized Against Production and Must Never Report Unchecked as Wrong
date: 2026-08-03
category: logic-errors
module: Athena Reports / Source Verification
problem_type: logic_error
component: payments
symptoms:
  - "`verifyCurrentWeekAgainstSources` on production returned `{ outcome: \"incomplete\", reason: \"source_cap_exceeded\" }` — no verdict for any day"
  - "Every per-day run for 2026-07-27..08-02 hit the same payment cap while the sales lane verified clean"
  - "The diff builder emitted `paymentsCollectedMinor` expected 0 against actual 396,000 with `matches: false` for a lane that had checked nothing"
  - "A capped read and a genuine data discrepancy produced byte-identical output"
  - "The full test suite was green throughout — 674 files, 7,535 tests"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - "payment-allocation-scan"
  - "weekly-source-verification"
  - "convex-index-range-reads"
  - "monitoring-output"
tags:
  - source-verification
  - read-caps
  - production-volume
  - unverified-not-mismatched
  - partial-verification
  - convex-pagination-limit
  - payment-allocation
  - observability
delivery_diff_fingerprint: 75b379367dc2942cfe9bc8d31ad843ea37227618487da43a773ead6b60855817
---

# A Verifier Must Be Sized Against Production and Must Never Report Unchecked as Wrong

## Problem

Athena's report source verifier recomputes each day's metrics from primary
sources and compares them to what the fold persisted. It had a complete test
suite and it was green. Then it was **run against production** for the first
time, and both of its defects appeared at once — neither of which any test could
have surfaced, because both are functions of real data volume.

`verifyCurrentWeekAgainstSources` on the production Wigclub store returned
`{ outcome: "incomplete", reason: "source_cap_exceeded" }`. Not a mismatch, not a
pass — **no verdict at all**, for the whole week. Running the per-day verifier
across 2026-07-27..08-02 gave the same answer on all seven days.

Worse, the per-day output did not say "unknown". It said this:

```
{ field: "paymentsCollectedMinor", expected: 0, actual: 396000 }   matches: false
```

An incomplete payment lane fell back to an `expected` of `0`, and `buildDifferences`
then diffed that zero against the real folded total. Production monitoring output
looked like GH₵3,960 of corrupted payment data when in fact **nothing had been
checked**. That is the worst output a verifier can produce: a cap and a genuine
discrepancy are indistinguishable, so a real finding would have been dismissed as
noise and this non-finding demanded an investigation.

The two defects have one shared cause — the verifier was built and tested at
fixture scale and never run at production scale until this branch.

## Symptoms

- `verifyCurrentWeekAgainstSources` returned `incomplete/source_cap_exceeded` on
  production; the weekly gate could not produce a verdict.
- All seven per-day runs for 2026-07-27..08-02 returned the same payment cap
  outcome. The **sales lane verified clean on every one of those days** — zero
  differences in net sales, gross, units, or refunds (Jul 27 GH₵4,240/36u,
  Jul 28 GH₵6,225/118u, Jul 29 GH₵1,295/20u, Jul 30 GH₵5,905/82u, Jul 31
  GH₵2,425/57u, Aug 1 GH₵3,960/77u, Aug 2 zero). Only payments were affected,
  and that run independently re-confirmed that the 106-day mass refold changed
  no values.
- A withheld field surfaced as a difference with `expected: 0`.
- The whole failure was invisible locally. The test suite passed.

## What Didn't Work

- **The date-bounding fix alone.** An earlier change had already bounded the
  allocation scan to the verified period rather than the store's lifetime,
  replacing an unbounded read. That was correct and necessary and it was still
  not enough: the window it settled on was `[startAt - 90d, endAt]`, and 90 days
  against a 500-document ceiling is arithmetically unusable for any store doing
  more than ~5.5 allocations a day. Production does ~12. Bounding a read is not
  the same as *sizing* it.
- **Raising `VERIFY_MAX_DOCS_PER_DOMAIN`.** The per-domain cap is shared by five
  other source scans. Raising it to cover the payment lane's worst case would
  have loosened four unrelated bounds to fix one, and would still have left one
  over-wide read answering two different questions under one ceiling.
- **Pagination on the in-period lane.** This was the shape the brief asked for
  and it is unavailable here — see the deviation recorded below.

## Solution

### 1. Two reads, bounded independently, failing differently

The single scan over `[startAt - 90d, endAt]` was doing two unrelated jobs. The
90-day lookback exists only because `paymentAllocation` is indexed on
`recordedAt`: a row **recorded long ago but voided during the verified period**
must still be found, since a void contributes its reversal at `voidedAt`. That
is a real case, but a rare one — and it was costing the entire lane.

It is now two `.take`-bounded range scans on `by_storeId_recordedAt`:

```ts
const inPeriodAllocations = await ctx.db
  .query("paymentAllocation")
  .withIndex("by_storeId_recordedAt", (q) =>
    q.eq("storeId", storeId).gte("recordedAt", startAt).lte("recordedAt", endAt),
  )
  .take(VERIFY_MAX_PAYMENT_ALLOCATIONS_IN_PERIOD + 1);   // 5_000

// Newest-first: a row voided during the period is far likelier to be recent,
// so when this read caps out the rows it keeps are the ones that matter.
const reversalLookbackProbe = await ctx.db
  .query("paymentAllocation")
  .withIndex("by_storeId_recordedAt", (q) =>
    q
      .eq("storeId", storeId)
      .gte("recordedAt", startAt - PAYMENT_VOID_LOOKBACK_MS)
      .lt("recordedAt", startAt),
  )
  .order("desc")
  .take(VERIFY_MAX_PAYMENT_REVERSAL_LOOKBACK_DOCS + 1);  // 3_000
```

Rows from the lookback contribute **only their reversal** — their original
event belongs to an earlier day by construction, so the loop over them starts
`if (allocation.status !== "voided") continue;`.

The two lanes now fail differently, which is the whole point:

| Read | Ceiling | Exhausting it costs |
|---|---|---|
| In-period (`startAt..endAt`) | `VERIFY_MAX_PAYMENT_ALLOCATIONS_IN_PERIOD = 5_000` | The day. A partial in-period read is a lower bound, never a total, so it sets `truncated` like any capped domain scan. |
| Reversal lookback (`[startAt - 90d, startAt)`) | `VERIFY_MAX_PAYMENT_REVERSAL_LOOKBACK_DOCS = 3_000` | Only reversal detection: `paymentPosture.reversalLookback = { outcome: "incomplete", reason: "lookback_cap_exceeded" }`. The in-period posture still verifies. |

The ranges are half-open against each other (`.lt("recordedAt", startAt)`), so no
row is counted twice. Only `inPeriodCapExceeded` sets `truncated`.

**One boundary is narrower than it first reads, and it is worth knowing.** It is
the lookback *cap* that is isolated from the in-period posture, not the lookback
lane as a whole. A pre-window row carrying a `voided_refund_unsupported` or
`legacy_void_missing_timestamp` condition still sets `paymentIncompleteReason`
and therefore still degrades the in-period posture to `incomplete`. That is
correct — those are unrepresentable facts, not a capacity limit — but "exhausting
the lookback degrades only reversal detection" is a statement about the ceiling
and nothing else.

**The ceiling arithmetic is recorded beside the constants**, which is the part
that would otherwise rot:

- The candidate window is one operating day plus `OPERATING_DAY_SLACK_MS` of
  ±18h — roughly 2.5 days, so ~30 rows at the measured 12/day. The in-period
  ceiling of 5,000 is ~2,000 allocations/day: **~165x the measured rate and 10x
  the old 500 cap.**
- 90 days at 12/day is ~1,080 rows. The lookback ceiling of 3,000 is ~33/day,
  **~2.8x measured** — deliberately tighter, because exhausting it is a soft
  degradation rather than a lost day.
- Worst-case read budget for the payment lane, per day: `(5,000 + 1) + (3,000 + 1)`
  index-backed documents. Measured in practice: ~30. Neither read collects.

The 90-day `PAYMENT_VOID_LOOKBACK_MS` and its documented blind spot (a reversal
of a row recorded more than 90 days ago is invisible — bounded staleness, not
unbounded drift) are unchanged. What changed is that the window now governs
*only* the reversal read.

### 2. Unverified is a third state, and it is not a difference

`VerifyUnverifiedField` names every field whose source-side expectation can be
**unknown rather than wrong**. All of them are payment-side, because the payment
lane is the only one that can be withheld while the rest of the day still
verifies. There are seven:

```ts
export const VERIFY_PAYMENT_METRIC_KEYS = [
  "paymentsCollectedMinor", "paymentsRefundedMinor", "paymentAllocatedMinor",
] as const;

export const VERIFY_PAYMENT_POSTURE_FIELDS = [
  "paymentUnsettledMinor", "paymentAllocationCoverage",
  "paymentAllocationOmittedMinor", "paymentHasInvalidAllocation",
] as const;
```

`unverifiedPaymentFields(posture)` maps a posture to the fields it declines to
make a claim about, and the two degradations are **deliberately unequal**:

```ts
if (posture.outcome === "incomplete") {
  return [...VERIFY_PAYMENT_METRIC_KEYS, ...VERIFY_PAYMENT_POSTURE_FIELDS];  // all seven
}
if (posture.reversalLookback.outcome === "incomplete") {
  return [
    ...VERIFY_PAYMENT_METRIC_KEYS.filter((f) => f !== "paymentsCollectedMinor"),
    ...VERIFY_PAYMENT_POSTURE_FIELDS,
  ];                                                                          // six
}
return [];
```

The asymmetry is the interesting part and it is not cosmetic. **In-period
collection cannot be moved by an unseen historical void.** A void of a row
recorded before the window lands as a *reversal* — it adds to
`paymentsRefundedMinor` and subtracts from `paymentAllocatedMinor` — and it
never touches what was collected inside the period. So an exhausted lookback
withholds refunds, allocation, and every posture field derived from them, but
keeps `paymentsCollectedMinor` verified. Withholding it too would have been the
easy, symmetrical, and less useful choice.

Withheld fields are removed **before diffing, not filtered after**, and from
every channel:

- `differences` and `paymentDifferences` on `VerifyDayResult`
- the weekly `includedDifferences` and `outsideScheduleDifferences`
- the weekly `includedPaymentDifferences` and `outsideSchedulePaymentDifferences`
- the accepted-baseline comparison
- the amendment comparison — because an amendment is a claim that the week
  *moved*, and a field nobody checked has not moved

The weekly result unions the withheld fields across the frame's days onto
`unverifiedFields`, and a day with an incomplete payment lane **no longer sinks
the whole week**. `payment_source_incomplete` and `invalid_payment_allocation`
became unreachable as weekly reasons and were deleted from the union.

### 3. What `matches` now means

`matches` means **"everything checked agreed."** `matches: true` alongside a
non-empty `unverifiedFields` is **partial verification, not a clean bill of
health**, and alerting has to read the two together. The types say so at the
declaration site rather than in a wiki:

```ts
/**
 * Fields no comparison was made on, because the source side could not be
 * established. These NEVER appear in `differences` or `paymentDifferences`
 * and never flip `matches` — "we could not check payments" must not be
 * readable as "payments are wrong".
 */
unverifiedFields: VerifyUnverifiedField[];
```

A capped in-period read still sets `truncated`, and `truncated` still forces
`matches: false`. A lower bound is never blessed as a total.

### 4. Deviation: pagination was unavailable

The brief called for pagination on the in-period lane. **Convex permits only one
`.paginate()` per function execution**, and this lane runs seven times inside a
single `verifyCurrentWeekAgainstSources` — so pagination was structurally
unavailable, not merely inconvenient. `convex-test` enforces the rule in the mock
rather than letting it pass locally and fail in a deployed backend
(`node_modules/convex-test/dist/index.js:951`):

> "Only a single paginated query (`.paginate()`) is allowed per function
> execution. Calling `.paginate()` more than once in a single Convex function
> fails at runtime in a deployed backend."

A single bounded `.take(ceiling + 1)` is used instead. **Anyone planning to
paginate a per-day read inside a per-week aggregate in Convex will hit this**,
and the honest answer is a well-sized bounded read with the arithmetic written
down.

## Why This Works

The capacity fix works because it stops making one read answer two questions
under one ceiling. The in-period rows and the pre-period rows have completely
different volumes (~30 vs ~1,080), completely different purposes, and completely
different costs when they run out. Giving them one bound meant the rare, cheap
question — "was an old allocation voided today?" — got to veto the common,
essential one. Splitting them lets the expensive lookback degrade without taking
the posture with it.

The reporting fix works because it introduces the state that was actually
missing. The verifier only ever had two answers, `agreed` and `differs`, so an
unestablished expectation had nowhere to go but `differs` with a fallback value.
Once `unverified` exists as a first-class output, `expected: 0` stops being
something the code has to invent, and `matches` recovers a meaning you can
actually alert on.

## Prevention

- **A green test suite does not establish that a tool works at production scale.
  Run it against production.** Both defects here were arithmetic against real row
  counts. Every test passed, at every stage, the entire time. For any read-bounded
  tool, a production dry run is a delivery step, not a follow-up.
- **Never choose a cap without measuring the volume it has to clear.** Record the
  measurement, the date, the store, and the derivation next to the constant — as
  `VERIFY_MAX_PAYMENT_ALLOCATIONS_IN_PERIOD` now does — so the next person can
  tell a considered headroom multiple from a round number someone liked. A cap
  with no recorded arithmetic is indistinguishable from a guess.
- **A window and a ceiling are one decision, not two.** `[startAt - 90d, endAt]`
  under 500 docs is a statement that the store does under ~5.5 allocations a day.
  Nobody wrote that down or checked it. Whenever you widen a range read, re-derive
  the ceiling; whenever you tighten a ceiling, re-derive the range.
- **A verifier whose failure mode is indistinguishable from a finding is worse
  than no verifier.** It cries wolf, and the cost is not the false alarm — it is
  that the next *genuine* mismatch arrives in the same shape and gets dismissed.
  "Could not check" and "checked, and it is wrong" must be different outputs.
- **Never fall back to a sentinel value in a comparison path.** `expected: 0` for
  an unestablished expectation is an assertion that the source side is zero. If a
  value cannot be computed, withhold the field; do not invent one and compare it.
- **Withhold before comparing, not after.** Filtering a difference list after the
  fact leaves every future channel — a new report, an amendment check, an
  accepted-baseline diff — free to reintroduce the bug. Six channels needed the
  filter here; a seventh added later must not have to remember.
- **When one lane of a multi-lane check degrades, degrade that lane.** The old
  weekly gate discarded six clean lanes to say nothing about one. Partial results
  with named gaps beat a global `incomplete`.
- **Ask what a degradation can actually move.** The unequal withholding —
  six fields for an exhausted lookback, seven for an incomplete lane — came from
  reasoning about causality (an unseen historical void cannot alter in-period
  collection), not from picking the safe symmetrical answer. Symmetry is usually
  a sign nobody worked it out.
- **A new output field is not delivered until something reads it.**
  `unverifiedFields` currently has no consumer outside `verify.ts` and its two
  test files — no dashboard, alert, or UI branches on it yet. Until one does, the
  distinction between "unchecked" and "wrong" exists in the return shape and not
  in anything an operator sees. Whoever adds that surface must render the two
  states differently, or the fix is only half landed.
- **Residual risk, recorded honestly:** the other five source domains
  (completed transactions, voided transactions, adjustments, storefront orders,
  service cases) still read under `VERIFY_MAX_DOCS_PER_DOMAIN = 500`, and none of
  those bounds has been checked against production volume. They were not the lane
  that failed; that is not evidence they are sized right.
- **Regression tests must be sized like the defect.** The three new large-fixture
  tests seed thousands of allocations to exercise the real ceilings, and each
  carries an explicit `60_000` timeout because they outran vitest's 5s default
  under full-suite load. A ceiling test that only seeds ten rows tests nothing
  about the ceiling.

## Examples

**Before — one read, one ceiling, two jobs:**

```ts
const allocations = await ctx.db
  .query("paymentAllocation")
  .withIndex("by_storeId_recordedAt", (q) =>
    q.eq("storeId", storeId)
      .gte("recordedAt", startAt - PAYMENT_VOID_LOOKBACK_MS)  // 90 days
      .lte("recordedAt", endAt),
  )
  .take(VERIFY_MAX_DOCS_PER_DOMAIN + 1);                      // 500
// Production: 1,050 rows in that window → incomplete, every day, forever.
```

**Before — the fallback that turned unknown into wrong:**

```ts
const differences = diffMetrics(expected, foldedMetrics(day));
// expected.paymentsCollectedMinor is 0 because the lane never completed.
// → { field: "paymentsCollectedMinor", expected: 0, actual: 396000 }
matches: !truncated
  && differences.length === 0
  && paymentDifferences.length === 0
  && paymentPosture.outcome === "complete",   // any incomplete lane = "wrong"
```

**After — withheld before the comparison exists:**

```ts
const unverifiedFields = unverifiedPaymentFields(paymentPosture);
const unverified = new Set<string>(unverifiedFields);
const differences = diffMetrics(expected, foldedMetrics(day)).filter(
  (difference) => !unverified.has(difference.field),
);
matches: !truncated && differences.length === 0 && paymentDifferences.length === 0,
```

**The two behaviours, as asserted:**

```ts
it("withholds payment fields rather than diffing them against a fallback 0", ...)
  // posture incomplete → differences [] , paymentDifferences [] ,
  // all seven fields on unverifiedFields, matches true (PARTIAL)

it("still reports a genuine payment mismatch when the lane completes", ...)
  // posture complete → unverifiedFields [] ,
  // differences [{ expected: 9_000, actual: 396_000, ... }] , matches false
```

The pair matters more than either test alone: withholding must not silence a
real mismatch, and only the second test proves it does not.

## Related Issues

- [Athena reporting read-optimized redesign](../architecture/athena-reporting-read-optimized-redesign-2026-07-28.md) — the direct design ancestor, and the source of the rule this branch is an application of: *verify against sources, not against the pipeline*.
- [Athena reporting read-optimized implementation plan](../architecture/athena-reporting-read-optimized-implementation-plan-2026-07-28.md) — defines Slice F (`convex/reports/verify.ts`) and makes independent verification the cutover gate; the gate this payment lane was blocking.
- [Athena weekly reports use a schedule-day-driven projection lifecycle](../architecture-patterns/athena-schedule-day-driven-weekly-report-projection-lifecycle-2026-08-01.md) — the accepted-baseline and amendment semantics whose comparisons now also filter withheld fields.
- [A declared fold version with no producer made every report change non-retroactive](./athena-reports-fold-version-refold-and-store-currency-source-2026-08-02.md) — the 106-day mass refold whose output this production verifier run was cross-checking, and which it re-confirmed as value-neutral.
- [Athena reporting fact/projection boundary](../architecture/athena-reporting-fact-projection-boundary-2026-07-09.md) — why an independent recompute from sources is meaningful in the first place.
- [Athena Convex read amplification](../performance/athena-convex-read-amplification-2026-06-29.md) — the closest prior art on bounded Convex reads and read caps.
- [Athena register closeout pending-void policy](./athena-register-closeout-pending-void-policy-2026-06-25.md) — the void semantics behind `voidedAt` reversal handling.
- Commit `766bfe61` (squash of `90d2823a`), *[V26-1142..V26-1152] Close EOW report audit gaps and total the weekly headline* — introduced `PAYMENT_VOID_LOOKBACK_MS` and the date-bounded window. That is the "earlier fix" this branch sizes correctly.
