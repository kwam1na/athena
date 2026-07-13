---
title: Static Harness Contracts Must Fail Before Provider Validation
date: 2026-07-13
category: workflow-issues
module: repository harness
problem_type: workflow_issue
component: development_workflow
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "A validation registry generates maps or documentation consumed by later gates"
  - "A heavy provider suite runs before deterministic repository-contract checks"
  - "One registry edit can drift generated docs, audit fixtures, and sibling tests together"
  - "A delivery workflow requires a landed-change report or durable learning artifact"
tags:
  - harness
  - fail-fast
  - preflight
  - pr-validation
  - diagnostics
  - delivery-report
delivery_diff_fingerprint: f25282af8f200818fd13b3f20587d06c9702b3d58e0eda4aa99aaab5d548e0c2
---

# Static Harness Contracts Must Fail Before Provider Validation

## Problem

Athena's `pr:athena` gate previously entered the expensive provider-validation
suite immediately after generated-artifact preparation. Deterministic harness
contract failures were discovered later: changed-file validation-map gaps,
registry paths missing from the audit fixture, and harness scripts changed
without their sibling tests. A single registry edit could therefore require
several full gate runs before all related repairs were visible.

## Solution

Give static repository contracts their own phase between preparation and
provider validation:

```text
prepare -> static contract preflight -> provider validation -> review -> proof
```

The preflight should run independent checks with all-settled semantics so one
failure does not hide another:

- changed-file mapping coverage through the no-execution self-review sensor;
- live registry, generated-map, and package-surface consistency through the
  harness audit;
- the real audit and registry tests, because fixture drift exists inside test
  setup and cannot be detected by auditing the live repository alone; and
- a narrowly exported sibling-test policy collector rather than the full
  inferential-review suite.

Aggregate those results into one human report and one machine artifact. Keep
the existing later review ladder as defense in depth. The delivery-run ledger
must record the preflight as a separate command span so a failed run proves
that provider validation never started and proof was never recorded.

For inferential review itself, print a concise blocking summary at the end of
terminal output. Include the file, finding title, reason, concrete repair, and
machine-artifact path so an agent does not need to open JSON before it can act.

Delivery artifacts follow the same fail-early principle. Applicable
landed-change reports, compounding notes, report review, and merge-ready Linear
evidence belong on the delivery branch before merge. Deferring them until a
merge SHA exists creates a second PR and means the required explanation was not
actually included with delivery. Use the PR URL and candidate head as the
pre-merge source, keep status wording accurate, and refresh fingerprints during
the review loop. After merge, restrict agent work to local root alignment and
the selected production deploys, except for either action the user or repo
workflow explicitly deferred.

## Why This Matters

Static contract checks are cheap, deterministic, and usually point directly to
the repair. Running them first shortens feedback without weakening the gate.
Aggregating independent findings prevents the sequential failure pattern where
each repair exposes only the next stale fixture or policy violation.

Narrow collectors also preserve diagnostic ownership. Calling an entire
inferential suite merely to reuse one policy can misclassify unrelated findings
and attach the wrong remediation. Export the smallest deterministic policy that
the preflight actually owns; leave the full suite in its existing review phase.

## Prevention

- Add a distinct ledger phase whenever cheap static checks must prove an
  expensive phase did not start.
- Exercise the real fixture tests when the contract drift lives in test setup;
  a live-repository audit cannot prove fixture completeness.
- Test the combined failure state and the repaired pass state with real
  detector-level fixtures, not only canned dependency outputs.
- Fail closed when changed-file or sibling-policy evidence cannot be computed.
- Keep terminal failure summaries actionable while retaining JSON artifacts
  for automation and deeper inspection.
- Do not remove the later merge-grade sensors merely because the preflight
  repeats a cheap contract check.
- Keep reports, solution notes, skill updates, and Linear closeout evidence in
  the delivery PR; guard this sequencing in the execute-workflow regression.
- Do not open a post-merge documentation PR by default. Once the delivery PR
  merges, align and clean local root, then run or explicitly defer production
  deploys.

## Examples

The focused sensor for this pattern is:

```bash
bun test scripts/harness-contract-preflight.test.ts \
  scripts/pr-athena-delivery-run.test.ts \
  scripts/harness-audit.test.ts \
  scripts/harness-app-registry.test.ts \
  scripts/harness-inferential-review.test.ts
```

A preflight failure should end with a repair contract naming
`scripts/harness-app-registry.ts`, generated harness docs,
`scripts/harness-app-registry.test.ts`, `scripts/harness-audit.test.ts`, and the
focused verification command. An inferential-review failure should end with a
terminal summary that contains `Why:` and `Fix:` lines plus the machine-output
path.

## Related

- [Repo Validation Reruns Need Explicit Proof Or Parent Ownership](../harness/repo-validation-rerun-policy-2026-05-07.md)
- [Repo Coverage Policy](../harness/repo-coverage-policy-2026-05-02.md)
- [V26-1040](https://linear.app/v26-labs/issue/V26-1040/make-prathena-fail-fast-on-harness-contract-drift)
