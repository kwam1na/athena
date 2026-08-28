---
title: "Portable Workflow Shadow Evidence Remains Observational"
date: 2026-08-28
last_updated: 2026-08-28
category: harness
module: harness
problem_type: architecture_pattern
component: development_workflow
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "Comparing an extracted workflow with an authoritative repository workflow before an authority switch"
  - "Projecting shadow results into tracked delivery telemetry"
tags:
  - harness
  - shadow-mode
  - delivery-telemetry
  - candidate-identity
  - authority-boundary
delivery_diff_fingerprint: 165035993f4514ca9219c8f7cc1edd08999591f415aa74ae78c55ece9cebcb45
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
binds the claimed observation time. The detailed artifact is a sibling of the
existing delivery ledger, so observation cannot rewrite the gate result.

The existing delivery telemetry command projects the complete redacted
comparison into the tracked corpus. It validates the comparison hash and
requires the nested candidate fingerprint to equal the containing delivery
record's fingerprint. Historical reads validate this durable structure and its
self-consistency without comparing old evidence to today's release pins. A
stale comparison therefore cannot ride inside a current record, while a valid
older comparison remains readable after later releases.

## Prevention

- Give a shadow evaluator fewer capabilities, not a competing decision path.
- Recompute semantic parity from decisions; never accept a stored `match` label.
- Bind every evidence layer to the same candidate identity, including nested
  telemetry projections.
- Keep exact-current release validation separate from durable historical-record
  validation so advancing a pin cannot erase older evidence from reads.
- Keep mismatch disposition separate from observation. A match does not itself
  authorize a canary switch, and an unresolved mismatch blocks one.
- Reuse the existing delivery ledger and telemetry lifecycle instead of adding a
  shadow-specific orchestration or telemetry plane.
