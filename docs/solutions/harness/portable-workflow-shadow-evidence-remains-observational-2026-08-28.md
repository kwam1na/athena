---
title: "Portable Workflow Shadow Evidence Remains Observational"
date: 2026-08-28
last_updated: 2026-08-29
category: harness
module: harness
problem_type: architecture_pattern
component: development_workflow
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "Comparing an extracted workflow with an authoritative repository workflow before an authority switch"
  - "Projecting shadow results into tracked delivery telemetry"
  - "Switching one reversible portable workflow canary while preserving the accepted characterization baseline"
  - "Migrating the remaining portable workflows in dependency-ordered batches with offline rollback"
tags:
  - harness
  - shadow-mode
  - delivery-telemetry
  - candidate-identity
  - authority-boundary
  - portable-canary
  - reversible-migration
delivery_diff_fingerprint: b16ada944a6c2d6291d6e526d2eeeeb14ac113c4f15e7f4c206e960dfa16f685
---

# Portable Workflow Shadow Evidence Remains Observational

## Problem

A shadow path is useful only if it observes the candidate without becoming a
second authority. A comparison artifact that can affect the authoritative gate,
mutate tracker state, or claim a match from its own unverified label turns a
reversible migration check into another orchestration path.

Tracked telemetry creates a second identity hazard. The outer delivery record
may describe the current diff while carrying a valid comparison from an older
candidate unless the two fingerprints are required to agree.

## Solution

Run the authoritative Athena evaluator and the verified portable evaluator over
the same frozen input, but keep their capabilities asymmetric. Athena decides;
the portable side receives no ticket mutation, status, merge, deployment, or
authority-switch capability. It may return only routing, posture, gate, evidence,
and mutation-attempt observations.

The current-candidate validator pins the release archive, release metadata,
source commit, Athena baseline, and frozen input. It recomputes decision parity
and the mismatch list instead of trusting the stored verdict, and its digest
binds the claimed observation time. Before evaluation, the runner recomputes
the current deliverable fingerprint using the delivery telemetry rules and
requires it to match the passing ledger. The detailed artifact is a sibling of
the existing delivery ledger, so observation cannot rewrite the gate result or
mislabel a changed candidate with stale gate identity.

The existing delivery telemetry command projects the complete redacted
comparison into the tracked corpus. It validates the comparison hash and
requires the nested candidate fingerprint to equal the containing delivery
record's fingerprint. The validator is closed to unknown fields at each defined
object boundary, so the single-copy persistence path cannot carry unreviewed or
unredacted fields into the tracked corpus. Historical reads validate this
durable structure and its self-consistency without comparing old evidence to
today's release pins. A stale comparison therefore cannot ride inside a current
record, while a valid older comparison remains readable after later releases.

For the first authority canary, keep the accepted characterization document
immutable. Record the exact qualified release, accepted shadow digest, active
lifecycle receipt, exposed hosts, retained predecessor, and rollback command in
one narrow migration record. The current-canary sensor validates that record,
the existing shadow telemetry, both host exposures, and the installed lifecycle
status. The characterization sensor projects the retained predecessor only
after those canary invariants pass, so it continues to evaluate the accepted
Athena baseline instead of silently redefining the portable body as the new
baseline.

Rehearse rollback in a disposable Git repository. Remove the copied release
archive, metadata, and extraction driver before invoking rollback through the
installed generation. This proves rollback is source-independent while an
unrelated sentinel file proves the lifecycle leaves other repository bytes
alone.

After the canary is accepted, migrate only the remaining characterized
workflow surface. Keep the migration record bound to the same exact release,
accepted shadow comparison, and canary. Use the smallest dependency order that
preserves a useful rollback boundary: expose the planning, execution, review,
and compounding primitives first, then switch the delivery entry point. Retain
the exact prior entry-point bundle by content digest; workflows that did not
previously exist need removal, not synthetic predecessors.

Reconstruct the accepted characterization baseline through the existing
projection. The projection may substitute only verified predecessor bytes and
ignore only the exposure links named by the exact batch record. It must not
rewrite the characterization documents or treat the portable result as a new
baseline. A separate current-batch sensor validates the active release,
exposures, complete disposition inventory, and rollback rehearsal. Repository
policy remains local: Athena's harness, gate, review, telemetry, reporting,
deployment, generated-artifact, pull-request, domain, and full Linear workflow
capabilities are not migrated into the portable core.

## Prevention

- Give a shadow evaluator fewer capabilities, not a competing decision path.
- Recompute semantic parity from decisions; never accept a stored `match` label.
- Bind every evidence layer to the same candidate identity, including nested
  telemetry projections.
- Keep exact-current release validation separate from durable historical-record
  validation so advancing a pin cannot erase older evidence from reads.
- Keep exact-current canary validation separate from characterization. A
  verified predecessor projection preserves the old baseline without weakening
  checks on the active portable authority.
- Keep batch adoption equally narrow. Record exact workflow digests, host
  exposures, predecessor identity, dependency order, and every baseline
  disposition in one manifest; do not add a second lifecycle or cache.
- Roll back entry points before their dependencies. Restore only an actual
  predecessor and remove newly introduced exposures; prove this after the
  portable source has been removed.
- Keep qualification-fixture hygiene separate from runtime capability. A bound
  on disposable test issues must never limit policy-authorized Linear create,
  read, update, search, relation, or reconciliation behavior.
- Fingerprint managed symlinks by their exact link target. Following a directory
  symlink as though it were a file makes delivery identity unavailable at the
  authority-switch boundary.
- Keep mismatch disposition separate from observation. A match does not itself
  authorize a canary switch, and an unresolved mismatch blocks one.
- Reuse the existing delivery ledger and telemetry lifecycle instead of adding a
  shadow-specific orchestration or telemetry plane.
