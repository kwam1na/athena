---
title: Expected Console Output in Tests Must Be Asserted and Suppressed
date: 2026-05-02
category: harness
module: athena-webapp
problem_type: noisy_test_output
component: vitest
symptoms:
  - "negative-path tests pass but print expected warnings or errors"
  - "useful harness failures are hard to spot in noisy package output"
  - "debug console.log calls leak from app code into routine test runs"
root_cause: unscoped_expected_console_output
resolution_type: test_harness_cleanup
severity: low
tags:
  - harness
  - vitest
  - console-output
  - webapp
---

# Expected Console Output in Tests Must Be Asserted and Suppressed

## Problem

Expected failure-path tests often exercise code that logs warnings or errors. When those logs are left unsuppressed, the package test suite can pass while still looking broken. That makes real harness failures harder to notice and weakens the signal from pre-push output.

Debug-only `console.log` calls in core app paths create the same problem. They do not describe expected behavior and should not ship in code covered by routine package tests.

## Solution

For expected warnings or errors, spy on the matching console method inside the specific test, replace its implementation with a no-op, and assert the exact log shape that proves the expected path ran. Keep the spy scoped to that test or restore it before the test exits.

Do not add broad suite-level console suppression. Broad suppression can hide unexpected failures or interfere with module-level `vi.fn()` mocks that late cleanup work still depends on.

Remove debug `console.log` calls from production or test-covered runtime paths unless the log is intentional product instrumentation.

## Prevention

- Treat visible stderr/stdout during `bun run --filter '@athena/webapp' test` as a harness issue unless it is an actual failing assertion.
- For negative-path tests, pair every expected `console.warn` or `console.error` with a local spy and an assertion.
- Prefer focused console spies over global `vi.restoreAllMocks()` in files with shared command mocks and async unmount cleanup.
