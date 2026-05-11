---
title: CI Package Test Jobs Should Not Duplicate the Repo Coverage Policy
date: 2026-05-10
category: harness
module: github-actions
problem_type: ci_runtime
component: athena-pr-tests
resolution_type: workflow_pruning
severity: medium
tags:
  - ci
  - github-actions
  - coverage
  - vitest
  - workflow-runtime
---

# CI Package Test Jobs Should Not Duplicate the Repo Coverage Policy

## Problem

Athena PR validation grew by accretion: app package test jobs were added first,
then the repo coverage policy was wired in later. That left GitHub Actions
running the same Vitest suites twice:

- `bun run --filter '@athena/webapp' test`
- `bun run --filter '@athena/webapp' test:coverage` through `bun run test:coverage`
- `bun run --filter '@athena/storefront-webapp' test`
- `bun run --filter '@athena/storefront-webapp' test:coverage` through `bun run test:coverage`

The no-coverage runs still provide a clean package-test signal, but they do not
cover a distinct sensor once coverage is mandatory in the same PR workflow.

## Solution

Keep `bun run test:coverage` as the package-test authority in PR CI. It runs the
Athena webapp coverage suite, the storefront coverage suite, root script
coverage, coverage toolchain parity, and the characterized baseline policy.

Keep workflow syntax validation as its own cheap sensor. `bun run workflow:check`
parses every `.github/workflows/*.yml` and `.github/workflows/*.yaml` file through
Ruby's built-in YAML parser. That keeps workflow syntax checks available in local
and GitHub runners without adding PyYAML or another dependency just for CI file
validation. Include it in the repo-owned harness validation selection too, so
standalone `harness:review` catches workflow syntax drift even when the full
`pr:athena` wrapper is not the command being run.

Remove standalone package test steps or jobs only when all of these stay true:

- the same package suite still runs through the coverage command
- the coverage summary still enforces the current baseline
- package-specific lint and audit gates remain separate when they check
  behavior that coverage does not check
- workflow guard tests assert that the duplicate no-coverage jobs do not return

If branch protection requires separate app check contexts, keep those contexts
honest without reintroducing duplicated work. Name the consolidated job after the
work it performs, update the required status checks to match, and use a small
dependent context job only when GitHub needs a separate app-level status.

Do not remove the local package `test` scripts. They remain useful for focused
developer feedback and app-local validation maps. The CI optimization is only
about avoiding repeated full-suite execution in the same remote PR run.

## Prevention

- Audit package test jobs against `bun run test:coverage` before adding new CI
  jobs.
- When `harness:review` runs inside the Athena PR workflow, pass
  `--validation-provided-by athena-pr-tests` only after the workflow provides the
  corresponding broad package gates directly: coverage, changed-file lint,
  architecture checks, and app builds. This keeps harness review responsible for
  coverage-map integrity and selected runtime behavior scenarios without
  rerunning package test/build commands already enforced by sibling CI steps.
- Run `bun run workflow:check` for workflow edits; do not rely on ad hoc
  PyYAML-based validation unless the repo explicitly adds that dependency.
- Prefer one authoritative CI gate per behavioral sensor, with focused local
  commands left available for agents and developers.
- If a no-coverage package test job is reintroduced, document the distinct
  signal it catches that coverage cannot catch.
- Keep workflow-sensitive changes covered by `compound:check` so future CI
  runtime changes leave a reusable note.
