---
title: "Review Evidence Binds to a Deliverable Identity, and Mechanical Checks Run Before It"
date: 2026-08-12
last_updated: 2026-08-12
category: harness
module: harness
problem_type: architecture_pattern
component: development_workflow
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "An authorization record binds to a content hash and later work changes that content"
  - "A cheap deterministic check runs behind an expensive gate it could have preceded"
  - "Delivery narration (a report, a solution note) is committed after the review that approved the code"
  - "Changing what counts as the same artifact for an approval record"
tags:
  - harness
  - review-evidence
  - gate-admission
  - authorization-identity
  - delivery-order
delivery_diff_fingerprint: 221e231d373ee69425a73ae7267aa1f95271cba1481cce9a7346718e80c8fe69
---

# Review Evidence Binds to a Deliverable Identity, and Mechanical Checks Run Before It

## Problem

Athena gates merge-grade validation behind a `review.green` obligation whose
evidence binds to the exact prepared candidate. Two consequences of that binding
cost the `live-weekly-payment-mix` delivery (PR #758) three extra full review
rounds:

1. **Cheap checks sat behind the expensive gate.** The deterministic per-package
   lint scripts ran only inside the heavy `pr:athena` provider, which
   `harness-gate-admission` will not start without current review evidence. So
   `@convex-dev/no-collect-in-query` could only fail *after* three reviewers had
   approved the tree. Fixing two comment lines then invalidated all three
   approvals. `pre-push:review` did not help: it runs at push time, which is
   after review in the delivery order.
2. **Two definitions of "changed" disagreed.** Evidence bound to the raw
   `treeSha`, while `isDeliverableFingerprintPath` in
   `scripts/delivery-diff-fingerprint.ts` already excluded `docs/reports/` and
   `docs/solutions/` from what counts as a deliverable change. Committing the
   landed-change report — a mandatory delivery artifact, written *after* the
   implementation it describes — invalidated the approval of code it did not
   touch.

## Solution

**Mechanical before review, enforced structurally.** `pr:athena:prepare` now
runs a mechanical stage (`scripts/harness-mechanical-check.ts`, also exposed as
`bun run pr:athena:mechanical`) that executes the deterministic checks for the
changed files: the per-package lint scripts the validation map selects, plus the
project typecheck of every package that has a changed file and declares one. Typecheck is
package-scoped, not scenario-scoped, because `tsc -p` is project-wide; scoping
it per scenario let a type error in an unlisted file reach review, which was
caught only by running a real type error through the stage. Preparation publishes
no receipt when that stage fails, and both `harness:review-context` and gate
admission require a current receipt. A tree that fails a mechanical rule selected
for its changed files therefore cannot reach review at all — the ordering is a
mechanism, not a reminder. Selection is per-package, so a branch touching no
package selects nothing and relies on the heavy provider as before. Tests and build stay in the heavy provider; typecheck does not. It was
excluded from the first draft on an unmeasured assumption that it was expensive,
which quietly under-delivered an acceptance criterion naming typecheck
explicitly. Measured, the athena-webapp project typecheck is ~45s — trivial
against the review round a late type error invalidates. Measure before calling a
deterministic check too expensive to run early.

**Evidence binds to a deliverable identity.**
`scripts/harness-review-identity.ts` defines `deliverable-tree/v1`: a SHA-256
digest over every tracked entry (mode, blob SHA, path) in the prepared tree,
excluding `docs/reports/` and `docs/solutions/`. Freshness now compares that
identity plus base ref, base tip, merge base, and worktree — the raw `treeSha`
is recorded for audit but no longer decides.

## Why This Matters

Loosening what "the same tree" means is a change to an **authorization record**,
not an ergonomic tweak. Three properties kept it honest:

- **The neutral set is narrower than the fingerprint's.** It would have been
  easy to reuse `isDeliverableFingerprintPath` wholesale. That set also excludes
  `_generated/`, `routeTree.gen.ts`, `graphify-out/`, and `artifacts/`, which
  are executable or gate-consumed content — and nothing in the identity
  re-derives them to prove they still match their reviewed sources. Two
  exclusion sets answering two questions is correct; one shared set would have
  silently widened an authorization rule to satisfy a reporting rule.
- **The loosening is auditable.** Both the reviewed raw tree and the deliverable
  identity are written into the existing gate decision event, so a past
  authorization stays interpretable after the identity changes again. No new
  event type was added.
- **The audit anchor is verified, not asserted.** The loosening is only needed
  at gate time, where the tree legitimately moves. Recording happens against the
  tree that was just prepared and reviewed, so `harness:review-evidence` keeps
  an exact `treeSha` match. An earlier draft dropped it there too, which would
  have written a provider-supplied raw tree that nothing ever checked into the
  obligation record and the decision event — destroying the very interpretability
  the previous bullet claims. Loosen at exactly one layer, and only the layer
  that needs it.
- **Do not add a mechanism for a failure you have not reproduced.** An earlier
  draft added a `superseded_record` diagnostic so records from an older identity
  would not be treated as tampering. The premise was wrong: the record digest is
  computed over whatever candidate fields a record carries, so a genuine
  pre-identity record still proves its own slot identity, stays readable, and
  simply fails closed as stale evidence — which is correct, because a re-review
  is required anyway. The extra classification only removed tamper evidence from
  the diagnostics. It was deleted.

The residual risk is stated rather than hidden: `docs/reports/**` and
`docs/solutions/**` ship in the in-app docs workspace bundle, so this admits
post-review edits to shipped content. Those paths still have live gate
obligations — the always-on `documentation.current`, whose
`delivery-documentation-check` provider wraps both `compound:check` and
`landed-report:check` — and the raw-tree divergence stays visible in the
decision event.

## Prevention

- Put a deterministic check in front of the thing it can invalidate. If a check
  needs no judgement, it must not be discoverable only after judgement has been
  recorded and paid for.
- When enforcing an order, prefer a structural precondition (no receipt → no
  review context → no admission) over documentation that asks an agent to
  remember the order.
- Before binding an approval to a hash, decide explicitly *what is being
  approved*. Derive the hash from that answer instead of from whatever the
  version-control system happens to hand you.
- Check what the existing record format actually does under the new rule before
  adding machinery for the transition. Here it already failed closed correctly,
  and the machinery would only have cost tamper evidence.
- Pin the rejection cases before writing the loosening: comment-only edits, mode
  changes, renames with identical contents, deletions, and moved base refs all
  have tests in `scripts/harness-review-identity.test.ts`, including against
  real Git.
- **Treat `git ls-tree -z` output as a NUL-delimited stream, not as lines.** The `-z` form is
  NUL-delimited precisely because a path may contain a newline or a trailing
  space, and it is unquoted. An independent review proved that splitting on `\n`
  as well as `\0`, `.trim()`ing each record, or rewriting `\` to `/` each
  produced a *digest collision* — two trees with different reviewed content
  sharing one identity, so a recorded approval would admit the tree nobody read.
  The backslash rewrite was the worst of the three: it folded a legal
  `docs\reports\x.html` onto the excluded `docs/reports/x.html` and dropped it
  out of the reviewed deliverable entirely. Sort by byte value too — 
  `localeCompare` makes the digest depend on the host ICU build. One collision
  class deliberately survives: stdout is decoded as UTF-8, so two paths that
  differ only in invalid UTF-8 bytes fold together. Closing it means decoding
  the stream as bytes, which this delivery did not do — the working tree cannot
  hold such names on APFS, and the raw-tree divergence stays visible in the
  decision event.

## Examples

Discovering the PR #758 failure class before any review is dispatched:

```sh
bun run pr:athena:mechanical
# [pr:athena] Mechanical check: @athena/webapp:lint:convex:changed
#   error  Avoid calling `.collect()` in a Convex query  @convex-dev/no-collect-in-query
# Mechanical checks failed for 1 command(s):
# - @athena/webapp:lint:convex:changed exited with code 1
```

The same failure inside preparation, which is what makes the order structural:

```sh
bun run pr:athena:prepare
# [pr:athena] Preparation blocked: Mechanical checks failed for 1 command(s):
# - @athena/webapp:lint:convex:changed exited with code 1
# (no receipt published, so harness:review-context and gate admission both refuse)
```

What the identity does and does not forgive:

```ts
// docs/reports/** and docs/solutions/** move the raw tree, not the identity
afterReport.deliverableTreeSha === reviewed.deliverableTreeSha; // true

// a comment-only edit to reviewed source does move it
afterComment.deliverableTreeSha === reviewed.deliverableTreeSha; // false
```

## Related

- `docs/harness.md` — gate ladder, mechanical stage, and identity contract
- [Athena Reporting Counts Tender Use by Participation Identity](../architecture/athena-reporting-payment-participation-identity-2026-08-12.md) — the delivery whose review rounds produced this evidence
- `AGENTS.md` and `.agents/skills/ce-code-review/SKILL.md` — the delivery order both providers follow
