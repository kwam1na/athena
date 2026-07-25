---
title: waitFor Headroom Gated on process.env.CI Makes the Local Gate Flakier Than the CI It Mirrors
date: 2026-07-25
category: workflow-issues
module: athena-webapp
problem_type: workflow_issue
component: test-environment
resolution_type: workflow_improvement
severity: medium
applies_when:
  - A waitFor/findBy assertion times out locally at just over 1000ms but passes in CI
  - bun run pr:athena fails test:coverage on a test that passes standalone and in CI
  - A test-environment allowance is wrapped in if (process.env.CI)
tags: [vitest, testing-library, waitFor, asyncUtilTimeout, test-determinism, pr-athena, flaky-tests]
delivery_diff_fingerprint: 615f240bea97887757c4fea636eac844f1a40f2f4a516a2cff4d7c4b4275a327
---

# waitFor Headroom Gated on process.env.CI Makes the Local Gate Flakier Than the CI It Mirrors

## Problem

`usePosLocalSyncRuntimeStatus > ignores stale runtime check-in publish results
after the runtime scope is invalidated` failed the local `pr:athena` gate at
**1023ms** — a hair over Testing Library's 1000ms `asyncUtilTimeout` default —
while the same commit passed CI with 6839/6839 tests green. The test also passed
6/6 when run standalone, and the failing case exists unchanged on `origin/main`,
so it was not a regression in the branch.

`vitest.setup.ts` already carried the correct allowance, but behind the wrong
condition:

```ts
if (process.env.CI) {
  configure({ asyncUtilTimeout: 5000 });
}
```

The load that pushes those async effects past 1000ms comes from running 661 test
files in parallel under coverage. The local `pr:athena` gate does exactly that
sweep — but without `CI` set, so it ran on the unextended default. The
environment variable was standing in for "is this a heavy parallel run", and the
two are not the same thing. The result is backwards: the gate meant to predict
CI was strictly more flake-prone than CI.

## Solution

Apply the headroom unconditionally:

```ts
configure({ asyncUtilTimeout: 5000 });
```

`waitFor` resolves as soon as its callback passes, so this does not slow passing
tests. The only cost is that a genuinely failing async assertion takes up to 5s
to report instead of 1s.

## Why This Works

The allowance is now tied to the property that actually causes the timeout —
contended async settling under a parallel suite — rather than to an environment
variable that merely correlates with it. Anywhere the full suite runs, the
ceiling matches the load.

## Prevention

- Before wrapping a test-environment allowance in `if (process.env.CI)`, ask
  what the allowance is really for. If the answer is load, parallelism, or
  machine speed, gate on that or do not gate at all — `CI` is not a proxy for
  any of them, and local gates run the same sweeps.
- A local gate that is flakier than CI is a bug in the gate, not a reason to
  rerun until green. Repeated reruns to dodge a flake hide the signal that the
  two environments have drifted.
- A test failing just over a round-numbered timeout (1023ms against a 1000ms
  ceiling) is a timeout-budget symptom, not a logic failure. Check the ceiling
  before reading the assertion.

## Related

- [A Dev .env.local Leaks Into Vitest and Breaks Env-Gated Tests](./athena-env-local-leaks-into-vitest-pin-with-env-test-2026-07-23.md)
- [Orphaned Harness Grandchildren Squat Scenario Ports](./harness-behavior-orphaned-grandchildren-squat-scenario-ports-2026-07-24.md)
