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
delivery_diff_fingerprint: 63fa341b0538b4541ccdeb7d3b6559d76457c41bf7dfa6b18f1b0773958218a3
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

The third failure is subtler. A shadow delivery only measures the managed
product if the run actually consumed the run-pinned projection as its workflow
source. The only party that can honestly report that is the one that wrote the
bytes; a session asked whether it used them is exactly the wrong witness, and a
milestone that accepts its answer measures a claim rather than a run.

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
- **Consumption.** A delivery counts toward the comparison set only on a record
  that declares the binding as its source and carries the binding's marker
  fields for that delivery and fence. An agent-supplied claim is a finding and
  excludes the delivery; so does an absent record, and so does a record that
  honestly affirms non-consumption.

Exclusivity is deliberately **not** asserted as blocking, and nothing here
suppresses the vendored generation. Neither graded host can scope discovery to
one root, so ambient vendored discovery coexists inside a managed worktree.
During a read-only window that holds no authority, coexistence cannot corrupt
anything, so the guard records it as a non-blocking observation — and refuses an
activation that claims a blocking exclusivity position the graded host cannot
deliver. Coexistence becomes a finding the moment the proving host is graded
exclusivity-capable, and scoping is what such a grade would buy.

One honest limit on the consumption position: the guard reads the gate-record
artifact, so it checks the record's *declared* source and shape. What keeps a
session from writing that record is not the guard — it is that `.agents` is an
additionally protected path in every checkpoint grant, plus the binding-side
writer that emits the entry. That writer is not in the product yet, so the
comparison set is empty rather than provisionally populated.

## Why This Matters

The window's whole value is that it can run for as long as the migration takes
without ever being able to damage the thing it runs beside. Byte-neutrality is
what makes that reversible: the vendored generation is untouched, so abandoning
the migration costs nothing but deleting an installation. Scoping is what keeps
ordinary deliveries ordinary. And sourcing the consumption record from the
binding is what keeps the eventual improvement claim honest — the milestone
compares runs that provably used the managed product, not runs that said they
did.

## Prevention

- The pinned layout digest fails the guard on any change to the vendored
  discovery layout, staged or unstaged, so the removal gate cannot be reached
  early by accident.
- The guard's planted-failure suite ties each rejection to a concrete defect
  class: a claimed authority, a non-shadow mode, drift, a projection outside a
  managed worktree, an exclusivity claim the grade does not support, an
  agent-supplied consumption claim, a marker from another run, and a comparison
  set larger than the baseline mix.
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
