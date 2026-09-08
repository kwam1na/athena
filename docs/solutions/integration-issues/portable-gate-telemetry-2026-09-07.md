---
title: Verify transported gate telemetry without the original staged Git tree
date: 2026-09-07
category: integration-issues
module: Athena delivery product cutover
problem_type: integration_issue
component: development_workflow
symptoms:
  - A fresh clone cannot resolve the staged tree named by an otherwise valid gate observation.
  - Telemetry transport fails after the coordinator commits its delivery artifacts.
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [delivery, telemetry, git, portability, evidence]
delivery_diff_fingerprint: 1b4fe6216ae0ec2e51dc5cbc5c9df4466e1515456f654ed574fc944f1e364687
---

# Verify transported gate telemetry without the original staged Git tree

## Problem

A gate can validate a staged tree that never becomes a commit. The delivery coordinator then adds its telemetry and portable record before committing. A fresh clone receives that commit but may not receive the earlier staged tree object. Recomputing telemetry applicability by looking up that old object makes local success depend on an object CI does not have.

## Symptoms

- Local validation succeeds while a fresh clone rejects the transported telemetry.
- The run export names an earlier staged tree, but `git cat-file` cannot find it in the clone.
- Broadening the excluded paths can hide real report or source changes instead of fixing the transport boundary.

## What Didn't Work

Comparing two raw tree identifiers rejects the legitimate record-writing step. Recomputing both historical and current projections still depends on the uncommitted historical tree. Reimplementing preparation or run accounting in Athena would recreate the engines the cutover removes.

## Solution

The installed product emits the strict validation projection digest when its actual `gate` command finishes successfully. Athena's telemetry adapter compares that retained digest with the product's computation for the current candidate, excluding only the configured `recordNeutral` paths. It also requires a successful CLI gate event immediately preceded by the coordinator's `athena-gate` saved context. The export remains observability; product evidence submission and admission remain the gate authority.

The coordinator saves the accepted context, runs the gate, exports and stages telemetry, and uses product `prepare --refresh-record-neutral` before writing and staging the product record. The same product refresh and verifier finish the sequence. Product preparation decides whether a prior mechanical success is reusable; the wrapper does not issue its own receipt.

## Why This Works

The current clone contains everything needed to calculate its own strict projection. It does not need the old staged tree. Record-only changes preserve that projection, while a source or report change outside `recordNeutral` invalidates the observation. Review-neutral paths and record-neutral paths have different purposes; never expand the latter merely to reuse evidence.

This is freshness and process evidence with self-attestation. A provider label, journal actor field, or digest does not authenticate the execution host.

When a product update occurs during a delivery, preserve the first workflow
release binding and every acquired review round. Use the current prepared
candidate, policy, and release binding for gate evidence; do not rewrite old
rounds to match a later installation.

## Prevention

- Keep the product as the owner of candidate identity, preparation, evidence and run projection.
- Exercise a real `git clone --no-local` whose object database lacks the pre-gate tree; a local clone sharing objects can conceal the defect.
- Keep positive transport and negative stale-candidate tests together.
- Exercise the installed coordinator through gate, export, record and verification, including a legitimate human exception and preserved unrelated staging.
- After candidate changes, ask the product whether evidence is current. Do not infer reuse from narration or a prior green test run.

## Related Issues

- [V26-1888: deferred preparation-telemetry follow-up](https://linear.app/v26-labs/issue/V26-1888)

- [V26-1849: Athena delivery product cutover](https://linear.app/v26-labs/issue/V26-1849)
- [Telemetry applicability and fresh-clone regressions](../../../scripts/delivery-run-telemetry.ts)
- [Installed coordinator and integration tests](../../../scripts/pr-athena-delivery-run.test.ts)
- [Delivery contract and acceptance criteria](../../plans/2026-09-06-001-feat-athena-delivery-product-cutover-plan.md)
