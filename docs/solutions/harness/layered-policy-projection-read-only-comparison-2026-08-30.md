---
title: Project delivery authority into a layered policy model with a frozen pre-cutover oracle
date: 2026-08-30
last_updated: 2026-09-01
category: harness
module: delivery-harness-policy
problem_type: architecture_pattern
component: tooling
resolution_type: tooling_addition
severity: medium
applies_when:
  - "A repository plans to hand delivery routing to an external policy compiler without changing its live authority yet"
  - "A migration needs an independent record of pre-cutover behavior that later parity claims can be judged against"
tags: [delivery-harness, policy-projection, pre-cutover-oracle, read-only-comparison]
delivery_diff_fingerprint: c48b7a1a0b91d7d6accca0de700cffbfe355c3327401c3113358826e2a7d7f33
---

# Project delivery authority into a layered policy model with a frozen pre-cutover oracle

## Problem

Athena's delivery authority lives in an aggregate command graph (`bun run
pr:athena` and the scripts it chains). Migrating to the managed delivery
product requires expressing that authority as a declarative policy document
plus typed executable adapters — but doing so while the legacy aggregate is
still the only real authority creates two risks: the projection quietly
drifts from what the repository actually runs, and the "truth" the eventual
cutover is compared against gets recharacterized after the fact to match
whatever the new system does.

## Solution

Three artifacts under `.agents/policy/`, plus one read-only sensor:

- `repository-policy.json` — the `repository-policy-document/1` declarative
  layer: merge-ready as the only granted finish line, pr-creation as the only
  granted authority, merge and deploy explicitly forbidden, the live gate
  obligations activated by name, and checkpoint grant overrides that protect
  the vendored discovery layout and every generated tree.
- `adapters.json` — twelve typed `adapter-capability/1` leaf descriptors
  (focused tests, generated-artifact repair, harness preparation, harness
  admission, Graphify, Convex admission/audit, delivery reporting, telemetry,
  hosted-check observation, PR creation, merge, deploy). Registering merge and
  deploy adapters grants nothing: discovery never grants authority.
- `pre-cutover-oracle.json` — the frozen independent truth: the exact
  `pr:athena` phase order, obligation activation vectors, per-candidate-class
  mechanical selection vectors, seeded failing candidates with the blocker or
  finding codes they must produce, the leaf-to-adapter mapping, and the
  generated-artifact ownership table. Its sha256 is pinned inside
  `scripts/policy-projection-check.ts`, so any edit is a deliberate two-place
  change rather than silent drift.
- `compiled-snapshot.json` and `comparison-report.json` record the compile
  through the real harness policy compiler (digest-bound, with input digests)
  and the read-only comparison results, including a disposition for every
  observed-only mismatch.

`bun scripts/policy-projection-check.ts` re-runs the comparison read-only on
every invocation: oracle immutability, snapshot/report staleness against the
current input bytes, phase and obligation parity against the live registry
and delivery-run source, exactly-once leaf mapping with the aggregate
excluded, live mechanical-selection probes, generated-artifact ownership, and
adjudication completeness. `scripts/policy-projection-check.test.ts` plants
each failure class and also proves the seeded oracle candidates against the
live gate functions (telemetry findings, preparation receipt blockers,
waivability parity).

The first managed-shadow bootstrap extends that projection through four narrow
seams rather than introducing a second delivery workflow:

- the existing policy document admits exactly product-native `review.green`
  from the currently qualified Claude Code producer; hosts without a qualified
  producer remain excluded, and the shared evidence contract stays
  host-neutral;
- one trusted sensor invokes `bun run pr:athena:prepare`, while the existing
  aggregate remains Athena's wider authority;
- the sensor refuses candidates that change `package.json` or any `scripts/**`
  file, which closes transitive executable rewrites without maintaining a
  dependency registry; and
- if preparation repairs or stages candidate bytes, the sensor returns a
  failing observation so the host can remediate and checkpoint again instead
  of advancing a dirty candidate into review.

Managed product records may share the neutral `telemetry/delivery-runs/` tree,
but Athena's telemetry parser ignores their distinct schema and still requires
an authentic Athena delivery-run record. Installation evidence likewise does
not count as registration, workflow consumption, or a completed shadow
delivery.

## Why This Matters

The oracle is the template any adopter can use to freeze its pre-cutover
truth: capture the routing the repository actually runs, pin the bytes, and
make the projection prove itself against both the frozen truth and the live
code. Because the sensor is read-only and `pr:athena` is untouched, the
projection can exist, compile, and stay honest for as long as the migration
takes, without ever holding delivery authority. A mismatch found later is
adjudicated with a recorded disposition before it can become blocking policy,
instead of being silently absorbed.

## Prevention

- The pinned oracle digest fails the projection sensor (and its test) on any
  oracle edit, so recharacterization cannot happen casually.
- Input digests recorded in the compiled snapshot and comparison report fail
  the sensor when the document or adapters change without recompilation.
- The planted-failure tests keep the oracle's blocker codes tied to what the
  live gate can actually emit, so blocker parity cannot rot.
- Fence the entire executable preparation surface for the MVP. Broaden that
  lane only after a real delivery demonstrates the need; do not grow a script
  dependency registry pre-emptively.
- After a mutation-capable preparation command succeeds, verify the candidate
  is still clean before emitting a passing sensor result.

## Examples

Recompiling after a deliberate document change (requires a checkout of the
harness policy compiler):

```bash
# compile through agent-delivery-harness packages/kernel/src/policy/compile.ts,
# then re-record .agents/policy/compiled-snapshot.json and comparison-report.json
bun scripts/policy-projection-check.ts   # must return to green afterwards
```

## Related

- `.agents/policy/comparison-report.json` — the recorded adjudications
- `scripts/harness-gate-registry.ts` — the live obligation registry the
  projection is compared against
- V26-1524 — Athena's first production-install-backed managed-shadow bootstrap
