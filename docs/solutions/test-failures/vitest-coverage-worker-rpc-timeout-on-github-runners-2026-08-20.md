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
resolution_type: dependency_update
severity: high
related_components:
  - GitHub Actions coverage workflow
  - Athena webapp Vitest configuration
  - storefront webapp Vitest configuration
tags: [vitest, vitest-4, coverage, github-actions, worker-rpc, ci]
delivery_diff_fingerprint: 9b443bd97ba45a15bce22c2487ad14ae2c48c2b5a7de1ee265851c61a1941e81
---

# Stabilize Vitest coverage worker RPC on GitHub runners

## Problem

Athena's GitHub coverage job completed the entire webapp suite and generated the coverage summary, then failed because a worker did not receive the main process's `onTaskUpdate` acknowledgement within Vitest's fixed RPC deadline. That made a healthy product suite look like a test failure and blocked PR delivery.

## Symptoms

- GitHub Actions reported `768 passed` files and `9191 passed` tests before emitting `[vitest-worker]: Timeout calling "onTaskUpdate"`.
- A retry failed at the same post-suite boundary even though CI already used the dot reporter and omitted HTML coverage generation.
- Local `bun run pr:athena` remained green, so the failure depended on GitHub-hosted runner resources rather than product behavior.

## What Didn't Work

- Reducing reporter work and retrying unchanged Vitest 3.2.4 jobs did not correct the fixed worker-RPC deadline.
- Disabling the deadline through `patches/vitest@3.2.4.patch` (`timeout: -1`) hid a coordination failure instead of replacing the limited runtime.
- Leaving GitHub coverage permanently at one worker traded throughput for a temporary resource-pressure mitigation without evidence for the upgraded toolchain.

## Solution

Upgrade the aligned Vitest family to `4.1.11` across the root, Athena, and storefront workspaces, with Vite 6-compatible package versions. Remove the Vitest 3.2.4 patch and retain explicit coverage includes, which replace the removed Vitest 4 `coverage.all` option without narrowing Athena's coverage scope.

Keep the local coverage default at two workers and make GitHub worker selection an explicit, reproducible benchmark input:

```json
"test:coverage": "vitest run --coverage --maxWorkers=${ATHENA_COVERAGE_MAX_WORKERS:-2}"
```

The workflow defaults to two workers, while `workflow_dispatch` can run the same complete coverage candidate at one, two, or four workers. It preserves GNU time diagnostics:

```yaml
env:
  ATHENA_COVERAGE_MAX_WORKERS: ${{ inputs.coverage_workers || '2' }}
run: |
  echo "Coverage worker limit: ${ATHENA_COVERAGE_MAX_WORKERS}"
  /usr/bin/time -v bun run test:coverage
```

Pin this workflow contract in `scripts/pre-push-review.test.ts` so future workflow edits cannot silently remove the constrained worker setting or diagnostics.

## Why This Works

Vitest 4 removes reliance on the patched Vitest 3 runtime behavior and makes timeout failures useful signals again. Exact aligned core, UI, and V8-coverage versions prevent a mismatched runner family. Parameterizing only worker count allows a like-for-like hosted comparison without changing test files, coverage thresholds, coverage includes, reporters, or failure handling; `/usr/bin/time -v` retains CPU and peak-RSS evidence.

The Vitest 3.2.4 one-worker result is historical incident evidence, not proof that two workers are safe after the native upgrade. V26-1256 must record hosted runs at one, two, and four workers before treating any default as the standing policy.

## Prevention

- Treat a post-suite `onTaskUpdate` timeout separately from a product-test failure only when the log proves every file and test completed.
- Keep Vitest core, coverage, and UI packages on the same exact version across workspace manifests; do not reintroduce an internal timeout-disabling patch.
- Preserve the complete coverage command, explicit source includes, thresholds, and `/usr/bin/time -v` diagnostics.
- Before changing the CI default, run the same hosted coverage candidate at one, two, and four workers, then repeat the proposed winner twice. Record pass/fail status, duration, CPU percentage, and peak RSS.
- Keep the workflow/package harness contract so version drift, patch reintroduction, or loss of benchmark controls fails locally.

## Related Issues

- [V26-1254](https://linear.app/v26-labs/issue/V26-1254/stabilize-athena-ci-coverage-worker-reporting-on-github-runners)
- [V26-1255](https://linear.app/v26-labs/issue/V26-1255/upgrade-athena-to-native-vitest-rpc-fix)
- [V26-1256](https://linear.app/v26-labs/issue/V26-1256/benchmark-and-raise-athena-coverage-workers)
- [V26-1257](https://linear.app/v26-labs/issue/V26-1257/document-athena-native-vitest-and-coverage-policy)
- [PR #777](https://github.com/kwam1na/athena/pull/777)
- [GitHub Actions run 32359398447](https://github.com/kwam1na/athena/actions/runs/32359398447)
