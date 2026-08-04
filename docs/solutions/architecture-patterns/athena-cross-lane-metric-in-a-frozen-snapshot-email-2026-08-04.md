---
title: A Trust Boundary Built for One Claim Does Not Automatically Gate a Weaker One
date: 2026-08-04
category: architecture-patterns
module: Athena Operations / Daily Manager Report Email and Approvals Email
problem_type: architecture_pattern
component: convex_backend
resolution_type: code_fix
severity: medium
applies_when:
  - "An email or report built from a frozen snapshot needs a metric that lives in a separately-folded derived lane"
  - "A provenance/certification field guards a strong claim and is about to be reused verbatim for a much weaker one"
  - "Two lanes are coupled by a shared trigger but neither awaits the other, and a producer looks like it guarantees a consumer's data"
  - "A metric may be genuinely unknown at render time and a formatter would coerce the absence to zero"
  - "The same domain value (payment method, transaction number) is surfaced by more than one email and is formatted independently in each"
related_components:
  - "operations-daily-manager-report-email"
  - "operations-approval-request-email"
  - "reports-sweeper-fold-authority"
  - "notifications-rail-prepare-email"
tags:
  - cross-lane-reads
  - trust-boundary-scope
  - unknown-is-not-zero
  - fail-closed-rollout-gates
  - frozen-snapshot-vs-live-read
  - email-presentation-consistency
delivery_diff_fingerprint: c7a29e132a238b9aed7120ee3e962761fe3a524446561d8dff7e96aa46f97266
---

# A Trust Boundary Built for One Claim Does Not Automatically Gate a Weaker One

## Problem

The daily manager report email is assembled entirely from `dailyClose.reportSnapshot`
— a frozen record written at close — and carried Sales, Expenses and Voids but no
units. Adding "units sold for the operating day" meant reaching across into the
reports lane, whose `reportDay` rows are written by a *separate* cron (the reports
sweeper) off `reportDirtyDay` marks.

Two questions had to be answered before a single line was written, and the obvious
answer to each was wrong.

## Solution

**1. Closing a day does not guarantee the day is folded — but the reason is not timing.**

The intuition "the email only sends when a close record exists, so the fold must be
done" is nearly right and still unsafe. Completing a close calls `recordFacts` with a
`close_snapshot` fact, which *marks the day dirty for the next sweeper tick*. The
causal arrow is close → dirty → fold; nothing in the close path reads or awaits
`reportDay`.

For units specifically the timing genuinely is benign: `unitsSold` accumulates from
sale facts folded within minutes of each transaction, hours before close, and the
`close_snapshot` fact carries `quantity: 0` so it cannot move the number. A
dirty-but-already-folded day still holds the correct total.

The real hole is the **rollout gate**. The sweeper's store allowlist is fail-closed —
"Empty or unset allows NOTHING" — and marks for a non-allowlisted store are skipped
without being deleted. A store that closes every day, on time, forever, has zero
`reportDay` rows if it is not on `REPORTS_SWEEP_STORE_ALLOWLIST`. Close records and
folds are independent rollouts. That, not the 5-minute cron, is why the read must
tolerate absence.

**2. `certifiedFoldRevision` guards movement evidence, not every scalar on the row.**

The first implementation required a `certifiedFoldRevision` before trusting
`unitsSold`, reasoning that the schema calls a missing revision "not admissible
evidence". Re-reading the field's purpose corrected this: the revision is the
*movement* trust boundary, and it exists so a day's `reportSkuDay` rows and its
header can be proven to come from the same fold. A day **total** read off the header
alone makes no cross-row claim. If the row exists, `unitsSold` is exactly what the
fold computed, whichever generation stamped it. Requiring a revision only dropped
legacy days that predate stamping, buying nothing.

The gate is now existence of the row and nothing more:

```ts
async function readUnitsSoldForDay(ctx, args): Promise<number | undefined> {
  const reportDay = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", args.storeId).eq("operatingDate", args.operatingDate),
    )
    .unique();

  return reportDay?.unitsSold;
}
```

**3. Unknown must not route through a formatter that coerces to zero.**

Every other metric compares against yesterday via a `priorDaySummary` record read by
`numberFromSummary`, which returns `0` for a missing key. Feeding units through that
record would have rendered an unfolded prior day as "No activity on prior day" — a
confident false statement rather than a missing one. The units comparison is built
from the two numbers directly, so the metric and its comparison drop *independently*:
an unknown prior day yields a metric with no comparison line.

The prior day is the prior **completed close**, not the prior calendar day, so the
comparison anchors to the same day Sales and Expenses already use.

## Why This Matters

A provenance field is scoped to a claim, not to a table. Reusing one verbatim because
it sits on the row you are reading imports a stricter contract than the read needs and
silently narrows availability — here, dropping a metric on every legacy day for a
guarantee that was never relevant.

Separately, "producer X ran, therefore consumer Y's data is ready" is only sound when
something enforces it. A shared trigger that fans out to two independent lanes feels
like a guarantee and is not one, and a fail-closed rollout allowlist turns the
occasional race into a permanent absence for whole tenants.

## Prevention

- Before reusing a certification/provenance gate, state the claim it was built to
  protect and the claim you are making. If yours is weaker, the gate is probably wrong.
- When reading across an async lane boundary, find what *enforces* the ordering. If
  nothing does, treat absence as a normal render path, not an edge case.
- Never let an unknown value enter a summary record whose accessor defaults to zero;
  keep it typed as `| undefined` until the moment it is formatted.
- Check rollout gates (allowlists, feature flags) when deciding whether a cross-lane
  read can be assumed present — they outrank cron timing as a cause of absence.
- Shared presentation helpers beat per-email formatting: `formatPaymentMethod` is now
  exported from the daily report module and reused by the approvals email so a method
  renders identically in both rather than drifting.
- Format an identifier once at the builder, not per render site. The approvals email's
  `#` transaction prefix is applied in `buildApprovalRequestPendingData`, so the
  subject line, header subtitle, and detail row cannot disagree.

## Examples

Label collision caught in review: the reports UI shows **Units moved** meaning *net*
units (`unitsSold - unitsReturned`). The email metric is gross `unitsSold`, so shipping
it under the same label would have put two different numbers behind one name. The email
row is titled **Units sold**. The regression test seeds `unitsReturned: 40` precisely so
a net calculation would read 960 while the assertion demands 1,000 — the test fails if
the metric ever silently becomes net.

## Related

- [[athena-reports-refold-gap]] — changing fold semantics does not refold existing rows
- `docs/solutions/architecture-patterns/athena-certified-fold-provenance-and-bounded-resumable-range-snapshots-2026-08-03.md`
  — the note that introduced `certifiedFoldRevision` as the movement trust boundary
