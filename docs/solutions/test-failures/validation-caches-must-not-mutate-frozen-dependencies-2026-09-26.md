---
title: Validation caches must not mutate frozen dependencies
date: 2026-09-26
category: test-failures
module: affected validation
problem_type: test_failure
component: testing_framework
symptoms:
  - Successful commands fail post-command verification with check_snapshot_drift
  - Temporary Vitest fixtures leave results in shared dependencies after cleanup
root_cause: test_isolation
resolution_type: config_change
severity: high
tags: [affected-validation, vite, vitest, cache, snapshot]
delivery_diff_fingerprint: 8304cb0353dd0408d2d7e0e40c1f2e0193a4f28cf6f60131ac10f28c88d38968
---

# Validation caches must not mutate frozen dependencies

## Problem

Native validation freezes source and dependency inputs before running each check.
A command can exit successfully and still fail admission if it changes those
inputs. Hosted health run 35516273775 reported eight such failures. Its bounded
diagnostics did not retain changed paths, so exact attribution of every hosted
failure remains unproven; successful command exit codes do not close them.

## Symptoms

- The root-invoked storefront fallback suite selected a profile with no mutable
  outputs, although its Vitest config writes a results cache.
- A real storefront Vite startup wrote 104 optimized dependency files under
  `packages/storefront-webapp/node_modules/.vite/deps`.
- Membership-test fixtures symlinked installed dependencies and used Vitest's
  default cache. Their results escaped through that symlink and survived fixture
  cleanup. Both the harness suite and aggregate coverage execute these fixtures.

## What Didn't Work

Treating raw exit zero as a pass would bypass snapshot integrity. Granting write
access to `node_modules` would also permit dependency mutation. Neither is an
acceptable repair. A local cache probe proves a write mechanism, not the complete
hosted failure chain or current native qualification.

## Solution

Map only the exact root-invoked storefront fallback command to the existing
storefront unit profile. It retains full Git context and permits only the pinned
Vitest timing-results file. Altered command arguments retain conservative fallback.

Give every membership fixture configuration `cacheDir: './.cache'`, including
bootstrap and project overrides. Its results then belong to the fixture and are
removed with it. The regression executes a real test and checks both private
results creation and unchanged shared dependency-cache bytes.

Set storefront Vite's `cacheDir` to `.cache/vite`. Only the behavior and storefront
browser profiles allow that generated directory. Native workspaces start fresh;
the cache remains separate from frozen source and installed dependency inputs.
The real startup probe wrote the same 104 generated files there after the change,
without changing the old dependency cache. This probe is not a browser-flow test.

## Why This Works

Execution profiles describe actual command outputs, not just the command's launch
directory. A root command can execute a package config, and a temporary fixture
can write through a dependency symlink. Moving generated caches to private output
locations preserves dependency verification instead of weakening it.

The focused harness checks passed 31 tests with 261 assertions. They require the
Vite cache permission on exactly two profiles and reject dependency-directory
write permissions across all profiles. The complete harness suite also passed
1,924 tests across 101 files with 6,238 assertions. Hosted health and full affected-validation
qualification must be established separately against the repaired candidate.

## Prevention

When a command passes but snapshot verification fails, retain the failure and
compare actual writes with its selected profile. Inspect cache defaults and
symlink targets. Do not infer unchanged dependencies from temporary-directory
cleanup or infer passing validation from the subprocess exit code.

## Related Issues

- [V26-2071](https://linear.app/v26-labs/issue/V26-2071)
- [Affected consumers and input soundness](../architecture-patterns/affected-consumers-and-input-soundness-2026-09-12.md)
