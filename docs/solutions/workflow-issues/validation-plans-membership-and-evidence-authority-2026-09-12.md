---
title: Keep validation selection separate from membership and evidence authority
date: 2026-09-12
category: workflow-issues
module: repo
problem_type: workflow_issue
component: development_workflow
resolution_type: workflow_improvement
severity: medium
delivery_diff_fingerprint: 9a72933902d1e46fe7433d6107425c8c789a65c682e10e5cad9b15cc1c49f7e4
applies_when:
  - Changing validation selection or eliminating overlapping test execution
  - Integrating trusted repository health with candidate admission
tags: [validation, harness, evidence, health, qualification]
---

# Keep validation selection separate from membership and evidence authority

## Problem

Command strings do not describe correctness obligations or actual test membership.
Athena's aggregate coverage and mapped ordinary tests could execute the same
operator inventory twice. Removing the second command without checking its
profile and inputs would instead let changed configuration inherit an invalid
success. A proposed narrower plan must also avoid presenting qualification output
as activated policy or trusted passing evidence.

## Solution

Keep three explicit boundaries. The authored registry derives canonical check
selection and explains each required obligation. The plan combines overlapping
membership only for equivalent argv, cwd, profile and input declarations.
The delivery product owns source capture, evidence provenance and reuse admission.
The foundational planner is read-only and explicitly retains legacy gate authority.

The existing executor's same-invocation optimization retains only a successful,
qualified aggregate coverage observation. It checks the prepared tree/base,
configuration, dependencies, toolchain and private environment before coverage,
after it, and before reuse. A failed or unqualified observation runs no shortcut.
This creates no durable Athena receipt and does not replace the product's future
isolated snapshot implementation. Timing stress remains a separate profile.
Qualification includes the runner's lifecycle hooks. Source, dependency and private
file mutation metadata also matter: restoring bytes and modification time after
an intervening edit must not disguise a changed execution input. Private values
and metadata remain in memory rather than becoming exported evidence.

Trusted health adds another distinct boundary: a verified repair proof can discharge
a requirement for one candidate/profile without closing the repository-wide finding.
Global closure requires approved main resolution plus newer trusted revalidation.
Missing or revoked localization restores conservative scope; unavailable health
requests full-health recovery while retaining known failures.
Resolve the approval's exact historical revalidation independently of the latest
complete run. Otherwise a newer healthy cumulative digest can reopen a resolved
failure. Keep newer failure revisions open, and bound network and subprocess waits
so unavailable-health recovery remains reachable when an external reader stalls.

## Why This Matters

A plan fingerprint covers declarations and membership; it does not prove input bytes
or execution. Likewise a selected fixture, a source merge, and authoritative activation
are different outcomes. Treating them as interchangeable creates false green evidence.

## Prevention

- Characterize the current ladder before changing selection or reuse.
- Preserve coverage, timer and browser distinctions even when filenames overlap.
- Represent deletions and both rename paths; fail early when no obligation covers one.
- Reject malformed registries and prerequisite cycles before expensive execution.
- Keep candidate repair discharge separate from trusted-main health resolution.
- Mutation-test each decisive guard with one changed binding at a time; a broader
  dirty-tree guard can otherwise hide a missing configuration or revision check.
- Integrate concurrent source lanes before regenerating shared maps and graphs.

## Examples

`bun run harness:plan -- --input scripts/fixtures/affected-validation/planner/report-request.json --json`
prints publishing obligations for a report fixture with `authority: legacy-gate`
and `evidence: not-evaluated`. It runs no application test. The characterization
sensor still records aggregate coverage in the live legacy ladder.

The deduplication child-process fixture counts webapp, storefront and root coverage
once before a mapped ordinary webapp test is reused. Real Vitest discovery also
showed matching ordinary/coverage inventories. Neither observation by itself claims
that the entire final gate or hosted CI ran.

## Related

- [Repo validation rerun policy](../harness/repo-validation-rerun-policy-2026-05-07.md)
- [Coverage policy](../harness/repo-coverage-policy-2026-05-02.md)
- [V26-2063](https://linear.app/v26-labs/issue/V26-2063)
- [V26-2061](https://linear.app/v26-labs/issue/V26-2061)
- [V26-2068](https://linear.app/v26-labs/issue/V26-2068)
