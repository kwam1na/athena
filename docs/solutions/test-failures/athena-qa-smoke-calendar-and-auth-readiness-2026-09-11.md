---
title: QA smoke needs historical coverage and persisted demo authentication
module: Athena QA smoke
date: 2026-09-11
category: test-failures
problem_type: test_failure
component: testing_framework
symptoms:
  - "SKU journeys fail after midnight because yesterday has no sales for some products"
  - "A full-page demo navigation reaches login after an interrupted auth refresh"
root_cause: test_isolation
resolution_type: test_fix
severity: medium
tags: [qa-smoke, shared-demo, calendar, authentication]
---

# QA smoke needs historical coverage and persisted demo authentication

## Problem

The scheduled demo sweep passed on September 10 but repeatedly failed on
September 11. GitHub run 34631325845 retained two missing report-link failures
and an inventory-import route ending on the POS recovery screen.

## Symptoms

The September 10 report contained six products, while the test expected all
eight. The clay mug and batik tote had no sales that day. The navigation trace
also recorded an unfinished HTTP `auth:signIn` request with a `refreshToken`
argument when the test left the demo owner page.
Run 34547869536 also showed the valid "Store day not started" POS guard after
midnight, where the test expected only "Sign in required".

## What Didn't Work

A visible owner heading was not sufficient proof that authentication had been
persisted. Repeated instrumented navigation attempts also passed, so a passing
retry alone did not explain the intermittent GitHub failure.

## Solution

SKU journeys select the previous complete ISO week, within the fixture's
21-day historical window. A deterministic regression sweeps all weekdays and
a year boundary and requires that the selected report contains every story
SKU. All eight live product journeys remain in the suite.
The POS destination accepts both legitimate guard states; its regression still
rejects recovery and crash screens.

Demo setup observes the initial refresh response before opening `/demo`, checks
its success, and waits for the returned refresh token to reach local storage
before performing a full-page navigation. This removes the observed abort
window without adding retries or allowing login redirects. Application code
and its authentication rules are unchanged.

## Why This Works

A daily report is allowed to omit products with no sales, and Sunday is closed.
Testing a complete historical week preserves every product journey without
changing valid fixture behavior. The initial auth refresh is asynchronous;
a rendered heading and a durable refreshed session are different readiness
conditions. Full-page navigation should follow the latter in test setup.

## Prevention

Use calendar sweeps for time-relative fixtures. For browser setup, wait for the
state required by the next action, including persistence before a hard reload.
Keep destination and error assertions intact so genuine regressions still fail.

## Related Issues

- [V26-2054](https://linear.app/v26-labs/issue/V26-2054)
- [Failing GitHub run](https://github.com/kwam1na/athena/actions/runs/34631325845)
- [Fixture history and live current-day boundary](../architecture-patterns/athena-shared-demo-fixture-owns-history-live-owns-today-2026-08-05.md)
