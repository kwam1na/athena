---
title: Proof-Aware Delivery Metrics Should Separate Validation Success From Proof Reuse
date: 2026-06-18
category: harness
module: repo-harness
problem_type: proof_telemetry_ambiguity
component: pre-push-validation-proof
resolution_type: structured_status_handoff
severity: medium
tags:
  - harness
  - pre-push
  - pr-athena
  - proof-telemetry
---

# Proof-Aware Delivery Metrics Should Separate Validation Success From Proof Reuse

## Problem

`pre-push:review` can finish successfully for two different reasons:

- a current local `pr:athena` proof was reused, so the expensive suite was
  skipped
- the proof was missing, stale, dirty, or invalid, so the suite reran and passed

Both outcomes are acceptable, but they mean different things for delivery
metrics. A passed validation rerun is not proof reuse, and a missing or stale
proof is not a validation failure by itself.

## Solution

Keep proof evaluation local to the worktree and expose a structured status next
to the existing human-readable reason. Use statuses such as `reusable`,
`missing`, `dirty`, `stale`, `base_changed`, `validation_wiring_changed`,
`generated_repaired`, `source_registry_drift`, and `proof_not_recorded` for
run-metrics ledgers and handoff summaries.

Log the final handoff as two fields:

```text
validation=passed|skipped
proof=<status>
```

That lets downstream summaries distinguish "validation passed after rerun" from
"proof was reusable and validation was skipped."

For same-gate dedupe, write provider evidence only after the provider command
has passed, then consume it in the later review command. Evidence should be tied
to the staged index tree and ignored when the tree is dirty, stale, incomplete,
or includes untracked files. The delivery-run wrapper should write a current
ledger before running the scorecard, so the scorecard summarizes the run that
just happened rather than a previous local artifact.

## Prevention

- Do not treat proof ledger/provider records as portable CI evidence. The proof
  is git-private, worktree-local metadata tied to the validated tree,
  `origin/main`, Bun version, command wiring, and validation fingerprint.
- Keep the human-readable reason for operator action, but use the structured
  status for dashboards, delivery metrics, and handoff summaries.
- Do not emit provider evidence before the provider command succeeds. Early
  evidence can make a later retry skip validation that never actually passed.
- Run scorecard after the delivery-run ledger is written when scorecard health
  depends on delivery-run telemetry.
- Run focused tests after reviewer fixes, then run full `pr:athena` at
  merge-ready, base-sync, proof-stale, or validation-wiring boundaries.
- If generated artifacts are repaired locally during pre-push, report
  `generated_repaired` and block until the repaired tracked artifacts are
  reviewed and committed.
