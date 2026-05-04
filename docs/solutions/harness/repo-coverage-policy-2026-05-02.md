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
  - ci-parity
---

# Athena Coverage Policy Uses a Baseline Gate Until 100 Percent Is Feasible

## Problem

Athena has app-level Vitest coverage commands, but the repo did not enforce coverage in the PR ladder. The root coverage summary also used a hard-coded checkout path, which let worktrees read stale coverage reports from another local checkout.

The repo is not currently at 100 percent coverage. Enforcing strict 100 percent immediately would block all delivery without first adding a large backlog of tests.

## Solution

`bun run test:coverage` is the named repo coverage command. It now:

- runs Athena webapp coverage
- runs storefront webapp coverage
- runs first-party repo-root script tests with Bun LCOV coverage
- aggregates the reports from the current checkout
- fails if any covered surface regresses below the characterized baseline

The target policy remains 100 percent across lines, statements, functions, and branches. Until the repo reaches that target, the gate is a ratchet: no covered surface may move backward, and the printed summary shows the remaining gap. Repo-script coverage is characterized from first-party `scripts/*.test.ts` files only, so local worktrees cannot inflate or deflate the baseline.

The baseline should match CI output. GitHub Actions installs dependencies with `bun install --frozen-lockfile`, and `bun run test:coverage` first runs `scripts/coverage-toolchain-parity.ts` so stale local installs or mismatched Vitest-family versions fail before coverage reports are generated.

Remote CI can still diverge if local pre-push routing does not select the same coverage command for files that affect the repo harness itself. Repo-owned workflow changes under `scripts/`, package agent docs, GitHub workflow files, Husky hooks, and top-level repo wiring should route through `harness:review`, and that repo-level selection must include `bun run test:coverage`. A green `pre-push:review` is only merge-equivalent when it actually runs the same coverage gate that Actions will run for the touched surface.

## Exclusions

Generated outputs, test files, route tree generation, coverage output, and Convex generated files stay excluded in the package coverage configs.

`packages/valkey-proxy-server` is not included yet because it uses `node --test` and has no coverage provider or summary artifact in the current toolchain. Treat that as a staged coverage gap, not as hidden compliance.

## Prevention

- Run `bun run test:coverage` before merge-ready handoff when coverage policy or testable source changes.
- Keep repo-owned harness validation selection wired to `bun run test:coverage`; otherwise script coverage regressions can pass local pre-push and fail only in GitHub Actions.
- Keep Vitest-family coverage tooling on exact, aligned versions across the root, Athena webapp, and storefront webapp manifests.
- Keep root script coverage file selection explicit so local `worktrees/` tests cannot change local-only coverage totals.
- Keep `scripts/coverage-summary.ts` path-relative to `process.cwd()` so worktrees and CI read their own coverage artifacts.
- When adding a new testable package, add its coverage artifact to `scripts/coverage-summary.ts` or document the explicit staged exclusion there.
