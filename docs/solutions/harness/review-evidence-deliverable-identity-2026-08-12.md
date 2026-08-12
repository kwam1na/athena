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
delivery_diff_fingerprint: bd80b829ea187627529fb289789362543f781b7d6fc0eff7b1d64ca0d6136a87
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
`bun run pr:athena:mechanical`) that executes the deterministic per-package lint
scripts the validation map selects for the changed files. Preparation publishes
no receipt when that stage fails, and both `harness:review-context` and gate
admission require a current receipt. A tree that cannot pass a mechanical rule
therefore cannot reach review at all — the ordering is a mechanism, not a
reminder. The stage stays cheap on purpose: tests, build, and typecheck remain
in the heavy provider.

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
- **Version transitions must be ignorable, not fatal.** Records written under an
  earlier identity are reported as `superseded_record` and skipped. The first
  implementation let them fall through to the record-identity digest check,
  which reports `malformed_record` — a *blocking* finding. That would have
  bricked the gate in every worktree holding an older record until someone
  deleted files by hand. Superseded is a version transition; malformed is
  tampering. They must not share a code path.

The residual risk is stated rather than hidden: `docs/reports/**` and
`docs/solutions/**` ship in the in-app docs workspace bundle, so this admits
post-review edits to shipped content. Those paths still have live gate
obligations (`delivery:documentation-check`, `landed-report:check`,
`compound:check`), and the raw-tree divergence stays visible in the decision
event.

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
- When an identity gains a version, give old records a distinct non-blocking
  diagnostic in the same change. Test the transition, not just the new format.
- Pin the rejection cases before writing the loosening: comment-only edits, mode
  changes, renames with identical contents, deletions, and moved base refs all
  have tests in `scripts/harness-review-identity.test.ts`, including against
  real Git.

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
- `.agents/skills/execute/SKILL.md` and `.agents/skills/ce-code-review/SKILL.md` — the delivery order both providers follow
