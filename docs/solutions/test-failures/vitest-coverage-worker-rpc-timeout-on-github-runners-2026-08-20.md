---
title: Stabilize Vitest coverage worker RPC on GitHub runners
date: 2026-08-20
category: test-failures
module: Athena CI coverage
problem_type: test_failure
component: testing_framework
symptoms:
  - "All 768 test files and 9,191 tests pass before `[vitest-worker]: Timeout calling onTaskUpdate` fails the job"
  - Re-running the same GitHub Actions job reproduces the post-suite RPC timeout
root_cause: async_timing
resolution_type: config_change
severity: high
tags: [vitest, coverage, github-actions, worker-rpc, ci]
delivery_diff_fingerprint: a8af10b6fa05f0b0cb9c289692643f828734e98e1941d67bf04f3d75c4fe555f
---

# Stabilize Vitest coverage worker RPC on GitHub runners

## Problem

Athena's GitHub coverage job completed the entire webapp suite and generated the coverage summary, then failed because a worker did not receive the main process's `onTaskUpdate` acknowledgement within Vitest's fixed RPC deadline. That made a healthy product suite look like a test failure and blocked PR delivery.

## Symptoms

- GitHub Actions reported `768 passed` files and `9191 passed` tests before emitting `[vitest-worker]: Timeout calling "onTaskUpdate"`.
- A retry failed at the same post-suite boundary even though CI already used the dot reporter and omitted HTML coverage generation.
- Local `bun run pr:athena` remained green, so the failure depended on GitHub-hosted runner resources rather than product behavior.

## What Didn't Work

- Reducing reporter rendering and skipping the CI-only HTML report lowered main-thread work but did not remain sufficient as the suite grew.
- Retrying the unchanged two-worker job reproduced the same timeout, so an unclassified blanket retry would only spend another full coverage cycle without addressing resource contention.

## Solution

Keep the local coverage default at two workers, but let CI select one worker through an explicit environment variable:

```json
"test:coverage": "vitest run --coverage --maxWorkers=${ATHENA_COVERAGE_MAX_WORKERS:-2}"
```

Set `ATHENA_COVERAGE_MAX_WORKERS: "1"` only in the GitHub coverage step. Run the unchanged root coverage policy through GNU time so failures and successes expose peak resident memory and other runner resource data:

```yaml
env:
  ATHENA_COVERAGE_MAX_WORKERS: "1"
run: |
  echo "Coverage worker limit: ${ATHENA_COVERAGE_MAX_WORKERS}"
  /usr/bin/time -v bun run test:coverage
```

Pin this workflow contract in `scripts/pre-push-review.test.ts` so future workflow edits cannot silently remove the constrained worker setting or diagnostics.

## Why This Works

Each jsdom/V8 coverage worker has substantial memory and CPU demand, while the Vitest main process must also process and acknowledge task-update RPCs. Restricting the GitHub job to one worker reduces peak concurrent pressure and leaves the main process responsive without skipping a file, changing coverage scope, reducing thresholds, or ignoring unhandled errors. The representative `CI=true` run completed all 9,191 Athena tests without the RPC timeout; the enclosing root sensor still failed on a deliberately stale workflow assertion, proving genuine downstream failures remain visible.

## Prevention

- Treat a post-suite `onTaskUpdate` timeout separately from a product-test failure only when the log proves every file and test completed.
- Preserve the full coverage command and thresholds; tune GitHub worker concurrency before adding retries or suppressing unhandled errors.
- Keep `/usr/bin/time -v` around the authoritative CI command so peak RSS and runtime remain available in failed-job logs.
- When the suite grows materially, compare CI duration and maximum resident set size before raising worker concurrency.

## Related Issues

- [V26-1254](https://linear.app/v26-labs/issue/V26-1254/stabilize-athena-ci-coverage-worker-reporting-on-github-runners)
- [PR #777](https://github.com/kwam1na/athena/pull/777)
- [GitHub Actions run 32359398447](https://github.com/kwam1na/athena/actions/runs/32359398447)
