---
title: "Athena EOD Review automation completes only through policy evidence"
date: 2026-06-22
category: architecture
module: athena-webapp
problem_type: automation_completion_boundary
component: daily-operations
resolution_type: policy_gated_completion
severity: high
tags:
  - automation
  - daily-operations
  - daily-close
  - eod-review
  - audit
  - redaction
---

## Problem

Athena can prepare EOD Review through Daily Operations automation, but some
store days are clean enough that requiring a manager proof creates busywork.
The risk is that automation completion could look like manager approval, close a
day before operators expect EOD to happen, hide low-risk review evidence, or
leak restricted financial detail through widened read models.

## Solution

Model EOD completion as its own Daily Operations action:

- `eod.auto_complete` is separate from `eod.prepare`.
- Manual EOD completion still requires the existing manager approval proof.
- Automation completion uses policy evidence, not a fake proof or staff profile.
- `automationRun.decisionEvidence` records structured eligibility facts,
  thresholds, timing status, and item keys.
- Completed `dailyClose` records and report snapshots carry Athena attribution,
  automation run id, policy version, decision reason, and policy-reviewed item
  keys.
- The operational event remains `daily_close_completed`; `actorType:
  "automation"` and automation metadata provide attribution.

The action is disabled by default. Enabled policies can complete only after the
configured store-local completion window opens. Clean days require zero
blockers and zero review items. Low-risk days require every review item to be an
allowlisted category inside configured thresholds. Carry-forward work is not a
completion approval signal: automation may complete the EOD boundary only when
the blockers/review gates pass, and it must preserve carry-forward work as
unresolved Opening Handoff evidence.

## Safety Boundary

Automation re-reads the command-time Daily Close snapshot before mutating. If a
blocker, unsupported review item, threshold-exceeding review item, unreviewed
policy item, reopened/superseded lifecycle state, or already-human-completed
close appears, the automation path fails safe or records a no-op without
overwriting human attribution.

Carry-forward remains unresolved operational work. Automation must not create,
resolve, approve, or hide it. The command-time snapshot must map every
carry-forward item one-to-one to an existing same-store, same-organization,
non-terminal `operationalWorkItem`; otherwise completion fails closed. Applied
runs patch final `automationRun.decisionEvidence` from the command-time
snapshot so the run, completed close, report snapshot, and Opening Handoff all
describe the same preserved work.

Read models may expose safe Athena attribution and neutral carry-forward counts
broadly, but restricted financial/review evidence and raw carry-forward
identifiers keep the existing manager/evidence access boundary. Cash variance
amounts, voided sale totals, threshold summaries, policy-reviewed keys, raw
work-item IDs, source-subject IDs, link parameters, decision evidence, item
metadata, and source evidence must be redacted before reaching users without
access.

## Prevention

- Add completion automation as a distinct action; do not overload preparation.
- Persist structured decision evidence on the run before patching terminal
  outcomes, and replace it with command-time evidence for applied outcomes.
- Keep event taxonomy stable and use actor metadata for automation attribution.
- Test clean completion, low-risk completion, full hard-blocker matrix,
  preserved carry-forward work, local-time window boundaries, idempotent
  retries, human attribution preservation, Opening Handoff continuity, and
  read-side redaction together.
- Refresh generated Convex APIs and Graphify whenever schema, backend API, or
  read-model surfaces change.
