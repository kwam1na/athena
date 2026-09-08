---
title: Retain verbose validation logs outside the delivery runner buffer
date: 2026-09-08
category: test-failures
module: Athena validation harness
problem_type: test_failure
component: development_workflow
symptoms:
  - "The full gate stopped with ERR_CHILD_PROCESS_STDIO_MAXBUFFER after extensive successful sensor output."
root_cause: config_error
resolution_type: code_fix
severity: medium
tags: [validation, delivery, subprocess, logs]
delivery_diff_fingerprint: 93bc9c92b58bfe3982163c4b898baf91b2429620bd2d0939f0a9a880eafc1808
---

# Retain verbose validation logs outside the delivery runner buffer

## Problem

The delivery product captures the output of Athena's validation provider with a 1 MiB buffer. The provider runs many sensors through `harness-review`; inheriting all child output can exhaust that buffer before validation completes.

## Symptoms

- `pr:athena` failed with `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`.
- The retained error showed passing test output rather than a failing assertion.
- The failed invocation supplied no successful final validation evidence.

## What Didn't Work

Successful individual sensors did not establish that the full gate passed. Retrying unchanged would leave the same output-volume failure. Editing the installed generated runtime or suppressing checks would not be a valid repository repair.

## Solution

`spawnLoggedValidation` in `scripts/harness-review.ts` gives each spawned validation command a unique temporary directory and mode-0600 log file. Both stdout and stderr use the same open file descriptor. The parent closes its descriptor after spawning and prints only the retained path and eventual exit result.

Package scripts, raw validation commands, and behavior scenarios selected by `harness-review` use this wrapper. Other repository commands do not automatically gain log retention. Existing nonzero-exit checks remain: a failing child still fails the gate. Open the printed log path for full diagnostics; preserve the file separately when evidence must outlive the execution host's temporary storage.

## Why This Works

Verbose sensor output no longer accumulates in the product's captured console buffer. No checks, assertions, or exit statuses are discarded. Regression cases drive the real raw, package-script, and behavior-scenario launchers. They produce 1,200,000 stdout bytes plus a stderr marker, retain the exact content, bound the aggregate console output below 16 KiB, and verify exit statuses 0 and 7. All 48 focused tests and 1,306 harness tests passed; each intentional launcher-wiring reversion fails exactly its two regression cases. The full gate must still be rerun before claiming delivery validation.

## Prevention

- Distinguish transport failures from assertion failures using the original error code.
- Keep full diagnostics on disk while bounding aggregate console output.
- Verify both successful and failing verbose children at the subprocess integration point.
- Never infer full gate success from passing lines emitted before an aborted run.

## Related Issues

- [V26-1921](https://linear.app/v26-labs/issue/V26-1921)
- [Harness guide](../../harness.md)
