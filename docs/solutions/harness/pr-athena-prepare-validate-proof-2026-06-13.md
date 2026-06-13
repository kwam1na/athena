---
title: PR Athena Should Prepare The Proof Tree Before Heavy Validation
date: 2026-06-13
category: harness
module: repo
problem_type: validation_noise
component: pr-athena
resolution_type: explicit_prepare_validate_record_ladder
severity: medium
tags:
  - harness
  - pr-validation
  - pre-push
  - generated-artifacts
---

# PR Athena Should Prepare The Proof Tree Before Heavy Validation

## Problem

`bun run pr:athena` can spend a full validation cycle and still fail to record a
reusable pre-push proof when intended new files are left untracked or tracked
files remain unstaged. The next `git push` then falls through to
`pre-push:review`, which repeats the expensive validation suite for the same
logical change.

The waste is easy to miss because the heavy gate itself can pass. The proof
recording step is intentionally stricter: proof reuse is valid only for a clean
tree or a staged index that will become the pushed commit.

## Solution

Make the ladder explicit:

- `pr:athena:prepare` repairs generated artifacts, stages tracked changes only,
  and blocks before heavy validation if unstaged or untracked files remain.
- `pr:athena:validate` runs the expensive repo validation ladder.
- `pr:athena:record-proof` records the reusable pre-push proof.
- `pr:athena` composes those three steps in order.

This keeps the default command safe while giving advanced operators separate
entry points. It also moves the common failure earlier, before coverage,
harness, browser, and graphify checks consume time.

## Prevention

- Keep generated-artifact staging tracked-only. Do not replace it with
  `git add .` or `git add -A`.
- Do not auto-stage untracked files from `pr:athena:prepare`; list them and make
  the operator or agent stage the intended set explicitly.
- Preserve staged-index proof support. Requiring a fully clean tree would break
  the useful path where a staged index is validated and then committed.
- Keep `pre-push:review` fail-closed. If proof is missing, stale, dirty, or
  fingerprint-mismatched, pre-push should rerun and print the reason.
- Do not turn base-ref or `git diff origin/main...HEAD` failures into an empty
  changed-file set; block with an actionable fetch/base-ref error instead.
