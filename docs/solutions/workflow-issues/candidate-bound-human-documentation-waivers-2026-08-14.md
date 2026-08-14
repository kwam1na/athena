---
title: Candidate-bound human documentation waivers
date: 2026-08-14
category: workflow-issues
module: Athena delivery harness
problem_type: workflow_issue
component: development_workflow
resolution_type: workflow_improvement
severity: high
applies_when:
  - "A human must accept a documentation exception that CI can verify"
tags: [waiver, attestation, github-actions, candidate-identity, human-approval]
delivery_diff_fingerprint: 003705c5e573e86af9ba1f3feaa0f3a6c439cd5a12b573d138aefdf25581db8d
---

# Candidate-bound human documentation waivers

## Problem

A local prompt, PTY, or authenticated `gh` command cannot prove that a human approved an exception: an agent can operate all three. A portable waiver also becomes unsafe if it is reusable after the pull-request head, base, deliverable identity, or live findings change.

## Solution

Treat the command as a request, not the approval. Dispatch a workflow that already exists on the default branch, pause it behind a protected GitHub Environment, and require a distinct authorized reviewer. The resulting artifact records `requestedBy` separately from the environment reviewer in `approvedBy` and binds the decision to the repository, PR, head, base tip, merge base, deliverable-tree identity, and exact finding codes.

CI independently re-fetches the workflow run and its environment review history, downloads the immutable artifact, and recomputes the PR-head deliverable identity even while the rest of CI validates GitHub's synthetic merge commit. It fails closed on self-approval, missing approval history, untrusted workflow provenance, candidate drift, or uncovered findings. The success check is published only after the artifact upload succeeds.

The first PR that introduces the default-branch workflow cannot use it. That bootstrap candidate must satisfy the ordinary documentation obligations; later candidates may request the waiver.

## Why This Matters

The external protected-environment review is the authority boundary. Candidate identity limits what that authority approves, while the synthetic merge checkout preserves normal merge-safety validation. Neither the dispatcher identity nor an interactive terminal substitutes for human review.

## Prevention

- Configure `athena-documentation-waiver` with required reviewers, self-review prevention, and no unsafe bypass before relying on the path.
- Keep the waiver workflow on the default branch and verify its artifact, workflow-run provenance, and approval history in CI.
- Recompute identity from the immutable PR head without changing the checkout used by the rest of required CI.
- Bootstrap changes to the waiver workflow through normal documentation.

## Examples

An agent may run `bun run harness:waive-documentation`, but that only opens a pending protected-environment deployment. A different authorized GitHub user must approve it. If the head or base moves afterward, CI rejects the old attestation.

## Related

- `docs/harness.md`
- `docs/solutions/architecture-patterns/candidate-bound-gate-obligations-before-expensive-validation-2026-08-11.md`
