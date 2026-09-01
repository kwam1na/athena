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
- **Consumption.** The marker alone remains diagnostic and cannot fill a
  comparison slot. The pinned harness product now owns a host-neutral observation
  contract and admits affirmative evidence only when its Claude-qualified
  adapter reports a completed full Read of the direct receipt-derived canonical
  workflow path, bound to the delivery, fence, host invocation, and projection
  digest. Its existing writer derives the delivery repository identity and
  accepts only the real repository's literal protected gate target with one
  link before mutation. The frozen scorer measures the baseline and shadow
  through the first merge-ready report. `openPreM1Blockers` is therefore empty;
  ordinary per-entry checks now govern admission. An agent-supplied claim, an
  absent record, a negative event, an unsupported host, or an aliasing target
  still excludes the delivery. None of those mechanisms supplies a delivery by
  itself, so Athena remains at zero of three and M1 remains incomplete.

The sole proving delivery host is Claude Code 2.1.252 under the qualified
`--restricted`, empty-setting-sources binding profile. That profile scopes the
M1 lane to the run-pinned projection, so coexistence with ambient vendored
discovery in a managed worktree is blocking evidence rather than a diagnostic
observation. No other host is in Athena's M1 delivery lane: a capability-only
host may be inventoried separately but cannot supply an affirmative record or a
fallback discovery posture.

One honest limit on the consumption position: the guard reads the gate-record
artifact, so it checks only the record's *declared* source and shape. It does
not reproduce the host callback, the writer's repository/target checks, or the
scorer's window computation. Those are installed-product boundaries. Athena's
current comparison set is empty because no binding-admitted Athena shadow
delivery is recorded, not because the producer or writer is absent. Nothing in
this pre-cutover note claims delivery authority, runtime parity, or cutover
readiness.

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
- The harness product's planted sensors cover a non-consuming or partial
  workflow Read, a cross-repository/symlink/hardlink write that leaves records
  unchanged, and post-report waiting that cannot dilute blocked share. The
  Athena record keeps `openPreM1Blockers` empty because those behaviors are
  landed, while its still-empty delivery set honestly preserves the incomplete
  result.
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
