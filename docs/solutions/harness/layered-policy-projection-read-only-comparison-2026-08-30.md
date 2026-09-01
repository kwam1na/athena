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
delivery_diff_fingerprint: c21ae907e88878d73430fbd2c5715d92bd23028bf11ad4b4529e516753650885
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

The first manual-shadow bootstrap keeps that projection deliberately smaller
than a managed execution lane. The coding host runs Athena's existing workflow
and owns sessions, agents, tools, sequencing, worktrees, and remediation.
`bun run pr:athena` remains repository-policy authority and GitHub remains
merge authority. The product materializes portable workflow definitions,
normalizes exact candidate-bound evidence, and returns deterministic decisions
for comparison; it does not add a second admission system or preparation
sensor inside Athena.

A counting shadow uses a manual operator admission condition: before recording
a counted derived summary, the operator independently verifies and retains the complete
`projection-consumption-observation/1` artifact: `spec`, `deliveryId`,
`fence`, `entry` `workflows/delivery-v1.json`, `canonicalProjectionPath`,
`projectionDigest`, `hostInvocationId`, and `observedAt`, alongside
immutable candidate and GitHub/`pr:athena` evidence. The M1 gate entry retains
only a derived source/affirmative/digest/marker summary plus that candidate and
GitHub evidence. The guard and scorer validate those recorded inputs, not
external artifact retention; an accepted entry means the operator asserted the
manual precondition and the tools accepted the derived input, and neither proves
nor preserves the complete envelope. The operator must not record
unsupported-host, path-only, echoed, cross-repository, symlinked/hardlinked,
or protected-target-mismatched evidence; those are manual admission
prohibitions that the guard and scorer cannot independently detect after a
shape-valid summary is represented. The
qualified Claude PostToolUse adapter produces the normalized contract now. A
future qualified Codex native adapter must emit the same contract; Codex is
excluded from counting now because it has no qualified binding or producer,
and unqualified hosts remain excluded. The comparison does not claim trusted
operator intent, delivery registration, takeover authority, or model
isolation. V26-1527's opaque pre-registration confirmation is therefore
deferred to a future higher-assurance trust tier.

The manual operator loop is: materialize the pinned projection, compose the
qualified Claude PostToolUse adapter, let it emit
`projection-consumption-observation/1` for the exact full Read, then after
final immutable delivery evidence independently verify and retain the complete
artifact outside the model grant and manually record only its derived M1
summary with immutable candidate and GitHub/`pr:athena` evidence before running
the deterministic scorer. This remains an operator assertion: the guard and
scorer do not inspect external retention or exclude a summary solely because
the artifact is later lost or unavailable, and they do not independently
verify host provenance or underlying path conditions. Repeat once each for a code, documentation, and
operations delivery. Do not add a launcher, registry, scheduler, daemon,
callback framework, control plane, session manager, automatic binding-side
writer, or automated scorer unless field data exposes a concrete failure.

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
- Keep the shadow comparison non-authoritative: host orchestration,
  `pr:athena`, and GitHub retain their current ownership.
- Preserve `projection-consumption-observation/1` as the host-neutral
  exact-read contract. The qualified Claude PostToolUse adapter produces it
  today; a future qualified Codex native adapter must emit that same normalized
  contract. Codex currently has no qualified binding or producer, and hosts
  without a qualified producer remain excluded rather than emitting weaker
  evidence. Before recording a counted summary, the operator independently
  verifies and retains the complete artifact outside model grants; this is a
  manual admission condition, while the guard and scorer validate only derived
  and candidate/GitHub inputs. The M1 summary does not replace or independently
  prove the full artifact. An automatic writer is a future non-MVP tier.
- Add machinery only after one of the three real shadows demonstrates a named
  failure the existing workflow and evidence contracts cannot express.

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
