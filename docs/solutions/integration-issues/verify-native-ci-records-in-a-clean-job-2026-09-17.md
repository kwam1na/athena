---
title: Verify native CI records in a clean job before projecting status contexts
date: 2026-09-17
last_updated: 2026-09-20
category: integration-issues
module: Athena affected-validation CI
problem_type: integration_issue
component: development_workflow
symptoms:
  - A successful guard command was reported as scoped readiness even when it selected legacy validation.
  - A fresh verification job could not find the candidate-keyed native record at the fixed artifact download path.
  - A later health revision could be confused with the revision used to plan execution.
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags: [delivery, ci, portability, health, evidence, scoped-validation]
delivery_diff_fingerprint: a37957f00ab8bbb0d3373719ed62564bc7417cd56c931bd63ab70e3f18ad6ba3
---

# Verify native CI records in a clean job before projecting status contexts

## Problem

Affected validation moves selection, execution and final admission across separate jobs. A successful orchestration command or uploaded summary cannot prove that the selected checks passed for the current candidate. The final job needs native evidence and must reconstruct its authority from the trusted base.

This note describes the implemented and locally tested qualification path. It does not establish hosted qualification or authorize the default switch; those remain V26-2071 acceptance requirements.

## Symptoms

The initial workflow wrote `base_guard_ready=true` whenever the guard exited successfully. A legitimate legacy fallback also exits successfully, so command success was being confused with the guard's decision. Separately, the product writes a candidate-keyed record, while the workflow transports `artifacts/validation-ci/delivery-record.json`; the real cold-verification fixture exposed that mismatch as `ENOENT`.

## What Didn't Work

Passing the execution job's `verified` output straight through to every required context left no independent verification boundary. Reading an arbitrary uploaded plan would let the artifact determine which checks count. Treating a current health revision as the revision of an older proof could discharge a newly observed failure without corresponding execution.

A stable canonical check ID alone is also insufficient repair evidence: selected unit-test membership can narrow while retaining that ID.

Putting the host telemetry check inside an isolated snapshot also failed: a SHA-based snapshot has no `origin/main`, and its private Git directory has no originating delivery journal. Aliasing the ref would fix only the first problem. Copying the journal or disabling CI would hide the admission boundary.

A permissive synthetic `.gitignore` also concealed a clean-checkout defect: Athena did not ignore `artifacts/validation-ci/`, so its native coordinator correctly refused record transport before running checks. The adopter now ignores that exact directory, and native lifecycle fixtures copy the real repository ignore policy. The unchanged fixture first reproduced seven failures, making this integration prerequisite part of the existing lifecycle regression coverage.

Private Graphify checking has two roots: immutable candidate source and a scratch directory for regenerated artifacts. Resolving the private Python wrapper from scratch fails before execution because dependencies belong to the original snapshot. Pass the original interpreter root explicitly while keeping generation in scratch, and retain the private regular-file and containment checks. Tiny executable-wrapper controls cover actual wrapper invocation and missing/escaping-wrapper refusal.

Backend fallback and timing-stress commands use the same package Vitest configuration as ordinary unit tests. Their root-owned command shapes must therefore allow the same exact results-cache file, while retaining full Git and broad inputs. Characterize those exact command/profile tuples; altered commands remain read-only, and this does not qualify backend checks for file-only snapshots.

Storybook's production manager builder also writes generated files into its default dependency-local cache. Installed-code probes demonstrate that `CACHE_DIR=.cache/storybook-build` moves that write into the package directory, because Bun's canonical filter executes there. Bind this flag only to the exact Storybook command and permit its dedicated cache namespace while keeping dependencies immutable. This bounded characterization does not replace a complete native build and snapshot verification.

Private execution also exposed test-fixture assumptions. Interpreter-selection tests must choose and restore their own environment instead of inheriting the harness's private mode. Under pinned Bun 1.1.29, changing `PATH` after startup did not select a fake `gh` executable: the timeout test accidentally invoked the host CLI. Start the test child with the fixture path already configured and require an invocation marker, so host authentication cannot make a false-green timeout result.

Calling Vitest's API also requires its CLI bootstrap semantics. The pinned CLI sets `TEST` and `VITEST` to `true` and defaults `NODE_ENV` to `test` before loading configuration; direct `createVitest` otherwise loaded the same config under development. Compare config-loading and worker environments against the actual CLI, including explicit and empty overrides. Matching test filenames and passing counts alone cannot establish equivalent execution or justify removing a fallback.

When a conservative plan selects both the complete ordinary unit suite and its authored fallback, keep the authored Bun command rather than emulate Bun lifecycle variables in the helper. Normalize the overlapping obligations only after both snapshots satisfy the pinned script, runner, configuration and complete membership contract. Preserve every covered check ID, reason, input, absence and prerequisite. Changed or unknown contracts retain independent executions; coverage, timing and browser checks remain distinct.

## Solution

The pinned-base guard emits readiness from its authenticated result. Explicit legacy fallback retains broad validation; malformed or changed bindings fail. The native controller runs from the pinned base, with candidate source treated as data.

CI uses a separate check-only gate and identity, preserving the delivery gate's review and documentation obligations. After actual native verification, the adapter serializes the verified record value into the fixed transport file using an exclusive temporary write and atomic rename. It does not reread an unchecked record path after verification.

A fresh final job downloads that file, independently authenticates base and candidate, and reconstructs the canonical plan and native configuration. The product's `deliveryRecordPathFor` derives the candidate-keyed destination from a fresh capture under the CI identity. The verifier stages the exact transported bytes there, invokes public native verification, and rejects local attempt history, incomplete selected checks, raw failures, attribution, and mismatched bindings. It rechecks authority after verification.

The selection guard records `ATHENA_VALIDATION_HEALTH_REVISION` as a native-observed flag. Full-health execution additionally binds every check to an invocation flag containing the authenticated repository, run, attempt, mode and a fresh UUID. Downloaded flag values are hints until native verification accepts them and selected-attempt observations match them.

Final admission reads current protected health and projects proofs with the original verified health revision. It refuses a changed revision when new or unavailable health requires fresh proof. Repair proofs require the recomputed full inventory; a narrowed check with the same ID cannot stand in for the full health check. Local candidate discharge never removes a global finding.

Local configuration reads a generated check inventory from authenticated, pinned main and uses current health to choose comparison or full validation. A mandatory live provider recollects authority and selection, comparing them with the original context and the product's candidate request. The product independently requires every selected native check. The live provider asserts current context, not a fabricated successful repair. Health context excludes record-neutral transport changes but retains the deliverable, base, inventory and semantic validation configuration.

Telemetry now has two explicit responsibilities. A data-only isolated command validates changed JSON through the product's parsers against `refs/delivery/base`. The host live obligation and final hosted verifier separately require the current delivery export. The source command loads neither candidate configuration nor a run store; real subprocess tests poison those environment settings to ensure that separation holds.

The same private-base boundary applies to ordinary repository commands. A SHA-based capture does not promise an `origin/main` alias. The command adapter passes `--base refs/delivery/base` to the characterized report and inferential-review scripts, and supplies the existing base-ref environment options to changed-file lint. It preserves Bun's script invocation and records the projected command in native configuration. Exact root script definitions are checked before projection; opaque or extended command shapes are left unchanged. A real Git fixture containing only the private base ref demonstrates the original failures and successful explicit-base execution.

## Why This Works

Actual frontend qualification also exposed Vitest writing timing results inside
`node_modules/.vite/vitest/`. Passing child tests still failed native snapshot
verification because this changed installed dependencies. Both package configs
now relocate their caches to `.cache`; separate unit profiles permit only the
pinned unnamed project's exact `results.json`, and coverage permits those result
files alongside coverage reports. Never make a dependency directory writable to
hide this failure. Real focused package tests confirm the relocated paths; native
mutation controls and complete qualification remain separate evidence.

The execution job and independent verification job must both succeed before required contexts pass. Uploaded summaries remain diagnostic. The product owns record validity, selected-attempt binding and portable evidence; Athena supplies impact selection, trusted workflow coordinates and health policy.

Binding health on the selection guard avoids invalidating otherwise reusable application checks merely because the health ledger advanced. It still binds the complete record to the health state used for execution. Git context is a separate reuse constraint: full-Git profiles bind candidate HEAD and tree, so file-only reuse requires actual profile qualification rather than a broader neutrality list.

Qualify and adopt the exact executed command and complete test membership together.
The six frontend cases established 33 matching scoped/full pairs and 14 prior
attempt selections across report follow-ups. Their groups include specific Convex
contract tests, so neither a package-wide grant nor a frontend-directory filter
matches the evidence. The normal runtime now selects file-only unit/build profiles
only for cataloged tuples, retaining private Git for other combinations. Bind the
catalog into preparation wiring, preserve all declared inputs, and omit the
qualification-only diagnostic output permission from production profiles.
Exercise catalog loading through Node as well as Bun: the public Node path
requires an explicit JSON import attribute that Bun-only tests can overlook.

## Prevention

- Exercise real native prepare, gate, record and verify, then verify in a fresh clone with no attempt store.
- Test legacy fallback, authentication failure and malformed arguments separately from scoped readiness.
- Keep raw-failure, foreign-invocation, missing-check, changed-health and record-path negative controls alongside positive cold verification.
- Mutation-test workflow changes that replace the pinned controller, omit execution-job success, or use execution outputs instead of final verification.
- Preserve release-specific evidence. Installing a successor does not relabel earlier qualification as having run on that release.
- Test the real local provider with a health revision change between parent configuration and child admission, including record-neutral refresh and a raw failing check.
- Check generated health-inventory completeness and whole-file deletion; a parser alone cannot prove that all canonical checks are present.
- Keep source-artifact validation separate from current-run admission, and ensure missing hosted telemetry withholds successful required contexts.
- Exercise base-aware commands in a real Git repository without `origin/main`; a checkout with familiar remote refs can conceal private-snapshot failures.
- Start rejection fixtures from a valid clean workspace, then introduce only the condition under test and assert its specific rejection reason. The dependency-isolation fixture omitted the Python requirements lock, so deleting either author-state guard still produced a generic error and passed the test. Supplying the lock, validating the clean fixture first, and independently removing each guard in memory demonstrated that the corrected assertions detect both regressions.
- Exercise normalized full-suite plans against the generated protected health inventory. Preserving check IDs alone does not preserve profile equivalence. The characterized normalizer now carries the complete original-profile declaration, bound into grouping and identity; local admission verifies its command, membership, and coverage before accepting the profile change. All normalized members carry the same declaration so they still share one execution.
- Treat a default import as executable even when every named import in the same declaration is type-only. Regression tests must check both transitive consumer selection and the native provider's input files; otherwise an omitted runtime dependency can leave stale evidence reusable.

Focused root sensors use the documented Bun harness:

```sh
bun run harness:test --test-file scripts/harness-validation-ci-final.test.ts --test-file scripts/harness-validation-ci-admission.test.ts --test-file scripts/harness-validation-ci.test.ts --test-file scripts/harness-validation-ci-adapter.test.ts --test-file scripts/github-workflows-check.test.ts
```

## Related Issues

- [V26-2069: CI and full-health integration](https://linear.app/v26-labs/issue/V26-2069)
- [V26-2071: qualification and activation](https://linear.app/v26-labs/issue/V26-2071)
- [Portable gate telemetry](portable-gate-telemetry-2026-09-07.md)
- [Final verifier](../../../scripts/harness-validation-ci-final.ts)
- [Final health admission](../../../scripts/harness-validation-ci-admission.ts)
- [Local health context](../../../scripts/harness-validation-local-health.ts)
- [Source telemetry integrity](../../../scripts/delivery-telemetry-artifacts.ts)
- [Workflow contract mutations](../../../scripts/github-workflows-check.test.ts)
