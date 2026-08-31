---
title: Hold a read-only shadow window with a byte-neutral discovery guard and binding-sourced consumption records
date: 2026-08-30
category: harness
module: delivery-harness-policy
problem_type: architecture_pattern
component: tooling
resolution_type: tooling_addition
severity: medium
applies_when:
  - "A repository runs a managed delivery product alongside its existing vendored agent tooling before any cutover"
  - "A migration milestone must decide which shadow runs are admissible evidence without trusting the agent that produced them"
tags: [delivery-harness, shadow-window, discovery-guard, projection-consumption, byte-neutrality]
delivery_diff_fingerprint: 2091c94e96cccfb31b6fb8131c056508effced51bb2c4e410f6e793a2d059b88
---

# Hold a read-only shadow window with a byte-neutral discovery guard and binding-sourced consumption records

## Problem

Athena's layered policy projection compiles and compares read-only, but the
shadow deliveries that are supposed to measure the managed product against the
frozen manual-choreography baseline need three things the projection alone does
not provide, and each one fails in a different direction if left implicit.

The managed product materializes a run-pinned workflow projection into the
worktree it runs in. Materialize it in the wrong place and the repository root
— which still runs every ordinary delivery on the vendored generation — starts
carrying an untracked second source of agent instructions. Suppress the
vendored generation the obvious way, by moving or editing its tracked bytes,
and the shadow window silently becomes a cutover with no removal gate and no
way back.

The third failure is subtler and crosses three trust boundaries. A shadow
delivery only measures the managed product if a model-external binding or
interceptor event proves that the exact receipted path and digest were actually
loaded or read as the run's workflow source. The current binding source label,
path name, and marker prove only that the projection was available; they are
diagnostic evidence, not consumption proof. Even a trustworthy read must be
written only to a gate record whose derived repository identity matches the
delivery, and blocked-share measurement must stop at the same first
merge-ready-report endpoint for baseline and shadow. Otherwise a repeated path
name, a cross-repository record target, or post-report idle time can manufacture
an apparent improvement without measuring the managed journey.

## Solution

Three artifacts, and one read-only guard that holds four positions and nothing
else.

- `.agents/policy/shadow-activation.json` — Athena's activation metadata for the
  window: shadow installation mode, `none` for delivery authority with
  `bun run pr:athena` named as the comparison authority, the disposable-only
  rule for installation paths, the projection root and the managed delivery
  worktree root it may appear under, the proving host and both hosts'
  exclusivity grades with their source, and the recorded characterization of one
  real shadow install.
- `.agents/policy/shadow-milestone-gate-record.json` — the milestone measurement
  artifact: the baseline it is scored against, the comparison-set mix, the gate
  metrics, the consumption-record contract, and one entry per shadow delivery.
  It is a measurement artifact rather than a journal, written outside every
  execution grant's writable paths.
- `scripts/shadow-discovery-guard.ts` plus its suite — the pre-cutover
  exactly-one-discovery guard.

The guard's four positions:

- **Posture.** The activation must still say shadow and must not claim delivery
  authority.
- **Byte-neutrality.** The vendored discovery layout — every tracked entry of
  the vendored generation tree plus the exposure symlinks that point into it,
  and deliberately not the repository's own skills living beside them — is
  pinned by digest over the index and checked again against the working tree.
  Both halves are needed: the guard's real execution context is an operator's
  dirty tree during a live shadow install, where an unstaged retarget of an
  exposure symlink is exactly the change the position exists to catch and is
  invisible to the index.
- **Scope.** The projection root may exist only inside a managed delivery
  worktree. The repository root and every non-managed worktree keep the vendored
  generation authoritative. What is checked is the root of the tree the guard
  runs in, not every directory beneath it.
- **Consumption.** The current binding source label and marker fields are
  diagnostic only and cannot fill a comparison slot. Before any delivery can
  count, [V26-1519](https://linear.app/v26-labs/issue/V26-1519) must provide a
  model-external exact-path-and-digest workflow-source read event,
  [V26-1520](https://linear.app/v26-labs/issue/V26-1520) must bind the writer to
  the derived target repository identity, and
  [V26-1521](https://linear.app/v26-labs/issue/V26-1521) must align baseline and
  shadow measurement at the first merge-ready report. All three are required
  pre-M1 blockers. The current enforcement is a declarative
  `openPreM1Blockers` list in the gate record: while it is non-empty, the guard
  rejects any non-empty delivery list with one finding and counts nothing. The
  list is emptied only after all three implementations and their planted
  sensors land; the existing per-entry checks govern after that. An
  agent-supplied claim is still a finding and excludes the delivery; so does an
  absent record or a trustworthy event that affirms non-consumption.

Exclusivity is deliberately **not** asserted as blocking, and nothing here
suppresses the vendored generation. Neither graded host can scope discovery to
one root, so ambient vendored discovery coexists inside a managed worktree.
During a read-only window that holds no authority, coexistence cannot corrupt
anything, so the guard records it as a non-blocking observation — and refuses an
activation that claims a blocking exclusivity position the graded host cannot
deliver. Coexistence becomes a finding the moment the proving host is graded
`exclusivity-graded`, the affirmative value both consumers key on, and scoping is what such a grade would buy.

One honest limit on the consumption position: the guard reads the gate-record
artifact, so it checks only the record's *declared* source and shape. It cannot
prove that the receipted projection was read, that the writer targeted the same
repository as the delivery, or that the measurement ended at the merge-ready
report. The `.agents` checkpoint protection and the binding-side writer in the
pinned product preserve the guard-versus-writer provenance boundary, but they
do not close those three semantic gaps. Athena's current comparison set is
empty because no binding-admitted Athena shadow delivery is recorded, not
because the writer is absent. Until V26-1519, V26-1520, and V26-1521 all land,
no delivery may count and M1 remains incomplete. Nothing in this pre-cutover
note claims delivery authority, runtime parity, or cutover readiness.

## Why This Matters

The window's whole value is that it can run for as long as the migration takes
without ever being able to damage the thing it runs beside. Byte-neutrality is
what makes that reversible: the vendored generation is untouched, so abandoning
the migration costs nothing but deleting an installation. Scoping is what keeps
ordinary deliveries ordinary. Binding-sourced records preserve custody, but
custody alone does not prove use. The eventual improvement claim becomes honest
only when a model-external event proves the exact workflow-source read, the
writer proves the record belongs to the same repository, and both cohorts stop
at the merge-ready report. Those conditions close the path-name,
cross-repository, and post-report-dilution false positives without asserting
runtime parity or cutover readiness.

## Prevention

- The pinned layout digest fails the guard on any change to the vendored
  discovery layout, staged or unstaged, so the removal gate cannot be reached
  early by accident.
- The guard's planted-failure suite ties each rejection to a concrete defect
  class: a claimed authority, a non-shadow mode, drift, a projection outside a
  managed worktree, an exclusivity claim the grade does not support, an
  agent-supplied consumption claim, a marker from another run, and a comparison
  set larger than the baseline mix.
- The three pre-M1 blockers add planted sensors for a non-consuming path-name
  observation, a cross-repository write that leaves both records unchanged, and
  post-report waiting that cannot dilute blocked share. Until those sensors and
  their corresponding behavior land, `openPreM1Blockers` remains non-empty and
  the comparison set remains empty.
- An incomplete comparison set is reported as an observation rather than passing
  silently, so the gate cannot be scored on a partial set.

## Examples

```bash
bun scripts/shadow-discovery-guard.ts    # read-only; exits non-zero on any finding
bun test scripts/shadow-discovery-guard.test.ts
```

## Related

- `docs/solutions/harness/layered-policy-projection-read-only-comparison-2026-08-30.md`
  — the policy mapping and frozen pre-cutover oracle this window sits on
- `.agents/policy/shadow-activation.json` — the recorded characterization of the
  shadow install and the projection's observed scope
