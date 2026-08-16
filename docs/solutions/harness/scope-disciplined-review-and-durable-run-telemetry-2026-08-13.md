---
title: "Review Findings Carry a Scope Axis, and Delivery Runs Leave a Durable Record"
date: 2026-08-13
last_updated: 2026-08-15
category: harness
module: harness
problem_type: architecture_pattern
component: development_workflow
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "A merge gate counts unresolved findings and leaves fixing as the only disposition"
  - "A reviewer proposes valid work that grows the delivery past its ticket"
  - "Run telemetry lives only in gitignored artifacts or Git-private per-worktree storage"
  - "A registry flag is honored by code selected by a different registry field"
  - "Adding a gate obligation that humans as well as agents must satisfy"
tags:
  - harness
  - code-review
  - gate-obligations
  - delivery-telemetry
  - scope-discipline
  - github-actions
  - passkey-approval
  - job-summary
delivery_diff_fingerprint: 8977d1cd84767eb3439c956bb993892e9ef11a49d6eee437fa115ccb75a6ab6f
---

# Review Findings Carry a Scope Axis, and Delivery Runs Leave a Durable Record

## Problem

Two independent problems, joined because the second is how you measure the first.

**1. The review loop had no way to say "valid, but not this ticket."** Findings
carried severity (P0-P3) and routing (`autofix_class`), plus exactly one escape
hatch for out-of-scope work: `pre_existing`, which only covers untouched code.
Nothing classified a finding that is _in_ the diff, genuinely good, and whose fix
grows the delivery — "also handle X", "make this configurable", "extract and
generalize this". That gap met a merge gate requiring "zero blocking or
unresolved actionable findings" (`execute` step 6, and `harness-review-evidence`
rejecting any actionable finding not `resolved`/`pre_existing`). Deferral was not
a recognized resolution, so the only legal move was to implement the suggestion.
Each fix round then produced new diff, which the next round reviewed fresh — a
ratchet with no convergence definition beyond "unanimous".

**2. Nothing about how a delivery ran survived the delivery.** The delivery-run
ledger (`artifacts/harness-delivery-runs/latest.json`) is gitignored and
overwritten every run; its `baseline.json` was read by `harness:scorecard` but
written by nothing, and `writeDeliveryRunLedger`'s `historyPath` option had no
caller. Obligation records live in `.git/codex/...`, which for a linked worktree
resolves under `.git/worktrees/<name>/` — per-worktree, never pushed. Reviewer
findings live in `/tmp`. Since `execute` starts every ticket in a fresh worktree,
none of it answers "how has delivery cost moved across deliveries?". The
`review_iteration` / `critical_count` telemetry that `execute` posts to Linear
appears nowhere repo-side.

## Solution

**A scope axis, adjudicated at synthesis.** Every finding now carries
`scope: in_contract | adjacent | expansion`, judged against a delivery contract
passed into the review (`contract:` argument, else the plan's requirements, else
the intent summary). Personas propose; synthesis owns the final call and keeps the
more in-contract classification on disagreement — the same shape as routing.

Deferral eligibility is deliberately narrow: **P2/P3 AND `expansion` AND
`gated_auto`/`manual`**. Two rules make that safe:

- **P0/P1 block regardless of scope.** Newly shipped breakage is always the
  delivery's job; scope never softens a defect.
- **Deferral is not deletion.** In externalizing modes a validator-style scope
  check confirms each candidate before deferral (the orchestrator that wrote the
  code should not grade its own scope unchallenged), and the finding is resolved
  only by an actually filed follow-up ticket.
- **The eligibility rule is machine-checked, not trusted.** The final manifest
  carries each finding's `severity` and `scope`, and `harness-review-evidence`
  rejects a deferral that is blocking, non-actionable, P0/P1, non-`expansion`, or
  whose `deferredIssueId` is not tracker-shaped. This was the review's sharpest
  correction: the first cut carried neither severity nor scope in the manifest,
  so every rule above was prose an orchestrator could ignore by setting one
  boolean. A rule the same agent both authors and is judged by has to be
  enforced by something that agent does not write.

`execute` also gained reviewer churn control: a finding first raised in a later
round against already-approved code is adjudicated, not automatically blocking.

**Telemetry, then a durable home for it.** The final manifest carries a
`reviewLoopTelemetry` block — iteration count, finding counts by severity,
deferral facts, and a review cost — which the recorder validates and persists into
the obligation record; `pr:athena` folds the newest record into the ledger and
prints a `[pr:athena]` run summary that the delivery kernel relays verbatim in
handoffs.

Cost is **agent-harness agnostic** on purpose: `{ unit, total, byReviewer?,
reportedBy? }`, validated for shape rather than membership in a fixed unit set,
never converted between units. That neutrality is load-bearing in the summary,
which withholds a delta when the last passing run metered a different unit and
names the shift when the baseline came from another agent runtime.

Durability is its own artifact: `telemetry/delivery-runs/<YYYY-MM-DD>/<stamp>-<branch>.json`,
tracked, one file per run so parallel ticket worktrees never conflict. It lives
under `telemetry/` rather than `docs/` because `docs/` holds documents written to
be read and this is a machine record written to be aggregated, and it is a
separate artifact rather than a section inside the landed-change report because
reports are prose, written only for substantial work, and would make coverage
partial by construction. `telemetry/delivery-runs/` is registered review-neutral and
fingerprint-neutral, which breaks the otherwise-circular dependency: recording a
run must not invalidate the review evidence it describes. The run summary prefers
this tracked corpus over the worktree baseline, which is what makes the trend
cross-delivery rather than confined to one ticket's worktree.

The UTC day directory comes from the record's ISO `generatedAt` timestamp. It
keeps the corpus browsable as deliveries accumulate without weakening the
append-only filename identity. Readers recurse through day directories and
continue to accept legacy flat records so branches created before the layout
change remain comparable during migration.

**Enforcement matched to the house pattern.** A `telemetry.recorded` obligation
(live provider `delivery-run-telemetry-check`) plus a CI check demand a record —
but only at or above 150 changed source lines, the same threshold `compound:check` uses,
and only for a record whose `deliverableDiffFingerprint` matches the current
deliverable diff, so telemetry recorded before later fix rounds counts as stale
exactly as a stale report does. Locally the check stays quiet until a _passing_
gate run has completed against the current deliverable — the ledger records the
fingerprint it validated — because until then no honest record can exist; CI,
the merge authority, has no such leniency.

## Prevention

**Give every "valid but not now" a named disposition.** A gate that counts
unresolved findings without one converts every good suggestion into scope. The
fix is not a laxer gate — it is a vocabulary that distinguishes "must ship" from
"worth doing", plus a mechanically checkable resolution (a filed ticket id) so
deferral cannot degrade into silence.

**Match a new obligation's cost to the house pattern, and give humans a path.**
The first cut of `telemetry.recorded` fired on any deliverable change and set
`humanWaiverAllowed: false`, which made it _stricter than the review obligation_:
a human fixing one line would have had to run a 15-minute merge gate purely to
emit a bookkeeping record, with no waiver and no way for CI to produce one. Any
obligation whose remedy is expensive needs a size threshold and a human escape
hatch, or it taxes exactly the contributors it was not aimed at.

**A freshness rule can deadlock the process that satisfies it.** The first cut
demanded a current record as soon as any ledger existed. After the first record
is committed, the next deliverable edit stales it — and because the obligation is
evaluated at gate admission, the gate refused to run the very run that would
produce a fresh record. The only escape was recording a stale ledger under the
current fingerprint, i.e. fabricating exactly the misreported telemetry the rule
existed to prevent. The fix is to key the local leniency on whether a run has
completed _for this deliverable_ (the ledger now carries the fingerprint it
validated), keeping CI as the unconditional authority. Before adding a
precondition to a gate, trace the loop that clears it.

**A config flag is only real where the code that reads it runs.** Extending the
waiver to a live obligation exposed a latent bug: `evaluateGateObligations` forks
on `freshness.kind`, and `evaluateLiveObligation` was never passed `input`, so it
could not see `records` or `executionContext` — the two things a waiver needs.
`humanWaiverAllowed` was therefore inert on live obligations, and nothing said so:
the registry validator only checked referential integrity,
`enforceAllowedResolution` only rejects a produced-but-disallowed kind (never an
allowed-but-unproducible one), and at runtime the obligation just blocks —
indistinguishable from a declined waiver. It stayed hidden because the single
live obligation happened to declare the flag `false`.

The fix was a shared `humanWaiverFor` used by both paths, plus two complementary
guards worth copying: a **registry invariant** requiring `humanWaiverAllowed` to
agree with `allowedResolutionKinds.includes("waived")` (catches future
misdeclaration in both directions), and **behavioral coverage of the
cross-product** — obligation kind × waiver-allowed × human/agent — which is what
actually catches an evaluator gap. Single-instance coverage hides path-specific
holes; when a flag is honored by code selected by _another_ field, test the
combination, not the flag.

**An approval link must outlive the job that publishes it.** GitHub does not
surface a job summary while that job is still running. Publishing a passkey URL
to `$GITHUB_STEP_SUMMARY` and then polling for that approval in the same job
creates a UI deadlock: the human cannot see the link until the wait is over. Use
a short producer job that creates the approval request, publishes its link, and
uploads the request identity; make the polling job depend on and download that
artifact. Test the job boundary itself, not merely that summary output appears
textually before the polling step.

**Every blocking entrypoint must cross the admission boundary.** A pre-push
wrapper that calls the deterministic documentation sensor directly makes the
registry's human waiver unreachable even when `humanWaiverAllowed` is correct.
Route interactive pre-push checks through `delivery:documentation-admission`,
keep the raw sensor for CI, and test that agents never receive the prompt. When
a hook or nested delivery runner captures validator output, resolve human
interactivity from the controlling terminal at the shared execution-context
boundary; `stdout.isTTY` can be false by construction and cannot identify the
invoking human. Agent signals and authorized CI classification must take
precedence so a controlling terminal never upgrades automation authority.

**Do not hold a remote transport open while proving a local candidate.** Git
opens the SSH connection before invoking `pre-push`, so a merge-grade local
suite can finish successfully after the remote has already closed an idle
connection. Terminal heartbeats do not keep that transport alive. Run
`pr:athena` before push and make the hook proof-only: it should admit an exact,
reusable candidate proof or fail immediately with the preparation command.

**Capture and visibility are separate responsibilities.** The delivery runner
needs provider stdout to parse skip telemetry, but waiting for the whole stream
before forwarding it makes healthy multi-minute validation look hung. Consume
each stdout and stderr chunk once, forward it immediately, and accumulate the
same decoded bytes for post-run parsing. A regression test should hold the
second chunk open and prove the first chunk is visible before stream completion.
