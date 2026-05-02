---
title: Athena Coverage Policy Uses a Baseline Gate Until 100 Percent Is Feasible
date: 2026-05-02
category: harness
module: repo
problem_type: coverage_policy
component: test-coverage
resolution_type: staged_guardrail
severity: medium
tags:
  - coverage
  - pr-validation
  - vitest
  - bun-test
---

# Athena Coverage Policy Uses a Baseline Gate Until 100 Percent Is Feasible

## Problem

Athena has app-level Vitest coverage commands, but the repo did not enforce coverage in the PR ladder. The root coverage summary also used a hard-coded checkout path, which let worktrees read stale coverage reports from another local checkout.

The repo is not currently at 100 percent coverage. Enforcing strict 100 percent immediately would block all delivery without first adding a large backlog of tests.

## Solution

`bun run test:coverage` is the named repo coverage command. It now:

- runs Athena webapp coverage
- runs storefront webapp coverage
- runs repo-root script tests with Bun LCOV coverage
- aggregates the reports from the current checkout
- fails if any covered surface regresses below the characterized baseline

The target policy remains 100 percent across lines, statements, functions, and branches. Until the repo reaches that target, the gate is a ratchet: no covered surface may move backward, and the printed summary shows the remaining gap.

The baseline should match CI output. GitHub Actions currently runs `bun install`, and the repository lockfile is ignored by Bun 1.1.29 as outdated, so CI can install slightly different test tooling than a local checkout. Use the lower CI-observed coverage baseline until the lockfile/install parity gap is fixed.

## Exclusions

Generated outputs, test files, route tree generation, coverage output, and Convex generated files stay excluded in the package coverage configs.

`packages/valkey-proxy-server` is not included yet because it uses `node --test` and has no coverage provider or summary artifact in the current toolchain. Treat that as a staged coverage gap, not as hidden compliance.

## Prevention

- Run `bun run test:coverage` before merge-ready handoff when coverage policy or testable source changes.
- Keep `scripts/coverage-summary.ts` path-relative to `process.cwd()` so worktrees and CI read their own coverage artifacts.
- When adding a new testable package, add its coverage artifact to `scripts/coverage-summary.ts` or document the explicit staged exclusion there.
