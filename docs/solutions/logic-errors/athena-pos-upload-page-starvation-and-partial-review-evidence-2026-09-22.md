---
title: Athena POS Upload Page Starvation And Partial Review Evidence
date: 2026-09-22
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: service_object
symptoms:
  - "A terminal reports an empty upload queue while retryable events sit behind a full page of non-actionable rows"
  - "Terminal runtime status reports zero local reviews while the same runtime publishes review samples"
  - "A recovery claim guard refuses forever because it reads heartbeat review details the runtime never emits"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - pos
  - local-sync
  - terminal-recovery
  - pagination
  - evidence
  - observability
delivery_diff_fingerprint: 3f7ad5f57e15567fd51f3357fa5323291039569831dc3a1d92cb9dd1aae7095c
---

# Athena POS Upload Page Starvation And Partial Review Evidence

## Problem

A POS terminal stopped draining its local event log. Retryable uploads sat
behind 250 older non-actionable rows, terminal health reported zero local
reviews while the same runtime was publishing review samples, and the recovery
command that would have cleared the stale markers could never be claimed. The
terminal only reached a healthy state after manual reconciliation.

Three independent defects compounded. Each one alone is survivable; together
they removed every path back to health, including the operator's repair path.

**This change fixes the first two and adds the diagnostic that makes the
failure visible. The third — the unclaimable repair command — is not fixed
here; it is tracked in full as V26-2114.** An implementation of it was written
and reviewed, but review established that it was unreachable from any client,
so it was removed rather than shipped as dead code. See Open Follow-Ups.

## Symptoms

- The drain loop concluded "queue empty" on every tick while `uploadSequence`
  rows above 250 never uploaded.
- `sync.reviewEventCount` read `0` on a terminal that was simultaneously
  publishing `syncDebug.reviewEvents` samples.
- A `clear_local_review_items` claim guard returned a precondition failure on
  every attempt because it required heartbeat review details that the runtime
  does not publish.

## What Didn't Work

- **Raising the page size.** The queue is ordered by `sequence`, so a bigger
  window only moves the cliff. Any fixed window starves once the non-actionable
  prefix exceeds it.
- **Trusting `syncDebug.reviewEventCount` as the review count.** It is one
  observer among several and can be stale or partial. A nullish chain
  (`debug ?? ledger`) lets the *less* complete source win whenever it is
  merely present.
- **Reading review details from the runtime heartbeat.** The heartbeat carries
  counts, not samples. A guard written against data the publisher never sends
  is unconditionally closed.

## Solution

**1. Continue the page, do not stop at it.** A bounded read that returns only
non-actionable rows is not an empty queue. `readScopedPosLocalUploadEvents`
now keeps a page only when it holds a drain or activity candidate, or is short
(the end of the log); otherwise it advances `afterSequence` to the page's max
sequence and reads again.

```ts
if (page.value.some((event) =>
  isPosLocalRuntimeDrainCandidate(event, input.drainOptions, input.uploadSupport) ||
  isPosLocalRuntimeActivityReportCandidate(event),
) || page.value.length < 250) return page;
afterSequence = Math.max(...page.value.map((event) => event.sequence));
```

A companion fix removes a common way to reach that non-actionable prefix:
expense events appended without a `localRegisterSessionId` are no longer given
a pending activity state, and are excluded from the activity-candidate
predicate on the same condition, so the two decisions cannot drift apart.

**2. Fold multi-observer counts with `max`, never `??`.** Where several
observers report the same quantity at different completeness, the most
complete one must win:

```ts
const reviewEventCount = Math.max(
  input.syncDebug?.reviewEventCount ?? 0,
  input.events.filter((event) => event.sync.status === "needs_review").length,
  getRuntimeReviewDiagnosticsEvents(input).length,
);
```

**3. Bound the diagnostic.** A read-only upload-page diagnostic (at most 2
pages of 250 per terminal in scope, fixed non-PII projection, `pageSize` and
`includeReviewEvents` pinned as literals in a shared Convex validator) makes
"why did the drain look empty" answerable without a terminal-side code change.
Collecting it changes and retries nothing. The service checks count, page
index and string length explicitly and **rejects** an acknowledgement that
exceeds them rather than truncating it.

## Why This Works

Each fix removes an assumption that only holds on a healthy terminal:

- Paging assumed the first page is representative. It is representative only
  when the log has no long non-actionable prefix — that is, only when the
  terminal is already healthy.
- The nullish count chain assumed a present observer is a complete observer.

Degraded terminals violate both, which is why the failures appeared together
and why each masked the next: the drain could not clear the backlog, and the
count could not show the backlog.

The diagnostic bounds fail **closed** — an oversized or ambiguous payload is
refused, never silently trimmed — so a corrupt or hostile local store degrades
to manual handling rather than to a quietly wrong diagnosis.

## Prevention

- When a paged read feeds a "is there work to do" decision, the exit condition
  must be *end of log*, not *end of page*. A short page ends the scan; a full
  page never does.
- Fold counts from several observers with `max`. Reserve `??` for a single
  authoritative source with a genuine default.
- Derive a flag from the data it describes. The expense-event defect existed
  because the initial activity state was decided from the event type while
  whether the report could ever succeed depended on the register session.
- Diagnostics that persist terminal-supplied data need explicit bounds on
  count, index range, and string length, and must be rejected — not truncated —
  when they exceed them.
- Before writing a guard against a payload field, confirm the publisher
  actually populates it. Prefer re-deriving from a durable server-side record.
- A server path with no client caller is not a partial feature, it is an
  undelivered one. Trace the call graph before believing that server-side tests
  mean a feature works.

## Related Issues

- [POS upload sequence gap reconciliation](../logic-errors/athena-pos-upload-sequence-gap-reconciliation-2026-07-25.md)
- [POS terminal register recovery and review cleanup](../logic-errors/athena-pos-terminal-register-recovery-and-review-cleanup-2026-07-01.md)
- [Terminal sync review currentness](../logic-errors/athena-terminal-sync-review-currentness-2026-06-28.md)
- [Recovery must not require what it restores](../architecture-patterns/athena-recovery-must-not-require-what-it-restores-2026-08-24.md)
- [Terminal health reconciliation lanes](../logic-errors/athena-terminal-health-reconciliation-lanes-2026-06-27.md)

## Open Follow-Ups

- **V26-2114** — deliver the server-settled local review recovery path. This
  covers the whole path, not just its UI wiring: settlement detection, the
  preview action, the claim-time revalidation gate, and an operator-reachable
  surface. V26-2087's "converge without manual intervention" acceptance
  criterion is carried entirely by this issue. A reviewed implementation is
  preserved at commit `d5681c5e`; its round-1 and round-2 findings (append to
  `terminalActions` rather than replacing, cache the page read per register
  session, scan newest-first, make the claim gate all-or-nothing) are recorded
  on the issue and must not be reintroduced as defects.
- **V26-2117** — the diagnostics collector emits 2 pages per terminal id in
  scope while the service rejects above 4 pages total, so a scope resolving to
  three or more ids can have its whole acknowledgement refused.
