---
title: Repo Validation Reruns Need Explicit Proof Or Parent Ownership
date: 2026-05-07
category: harness
module: repo
problem_type: validation_noise
component: pr-validation
resolution_type: fail_closed_optimization
severity: medium
tags:
  - harness
  - pre-push
  - pr-validation
  - ci-parity
---

# Repo Validation Reruns Need Explicit Proof Or Parent Ownership

## Problem

Repo-owned harness changes can select broad validation in more than one place.
`pr:athena` runs coverage, harness implementation tests, and inferential review
directly, then `harness:review` can select the same repo-level commands again
for `scripts/`, package agent docs, workflow files, Husky hooks, and top-level
repo wiring.

The same class of noise can happen after a clean `pr:athena` run when the next
push repeats the full local pre-push suite even though the head and base have
not changed. Removing reruns blindly would weaken a fail-closed guardrail:
rebases, dirty generated artifacts, changed validation wiring, or an advanced
`origin/main` all need a fresh run.

## Solution

Treat deduplication as an explicit proof problem.

Inside `pr:athena`, the parent command owns the repo-level commands it already
ran. It passes `--repo-validation-provided-by pr:athena` into
`harness:review`; standalone `harness:review` still selects and runs the full
repo validation command set for repo-owned changes.

After a clean or staged-only `pr:athena`, the repo records a git-private proof
under the current worktree's git metadata. A staged-only run is valid because
`pre-commit:generated-artifacts` stages the exact index tree that the next
commit will contain. `pre-push:review` may reuse that proof only when all of
these still match:

- validated tree SHA
- `origin/main` SHA
- clean tracked and untracked working tree status
- Bun version
- the exact `pr:athena` script
- validation-wiring file fingerprint

If any field is missing or stale, pre-push prints the reason and runs normally.
Generated-doc and graphify auto-repair still block for review and commit instead
of reusing a stale proof. Proof recording refuses mixed states with unstaged or
untracked files, because those files were not guaranteed to become the pushed
commit tree.

## Prevention

- Keep standalone harness commands fail-closed; only parent commands that
  already ran the exact repo validation set should pass a provider flag.
- Keep pre-push proof files git-private and worktree-local. Do not write proof
  state into tracked files or shared temp paths.
- Include command wiring, hooks, harness scripts, coverage scripts, graphify
  scripts, package metadata, and lock/runtime inputs in the proof fingerprint.
- Reject proof reuse on dirty status at push time, rebases, advanced
  `origin/main`, missing proof, unsupported proof shape, changed Bun version, or
  changed validation wiring.
- When recording proof before commit, allow staged-only changes by proving the
  staged index tree; refuse proof recording if any unstaged or untracked files
  are present.
- When repeated validation feels noisy, add a characterization test before
  removing any command from the ladder.
