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
blockers, zero review items, and zero carry-forward items. Low-risk days require
every review item to be an allowlisted category inside configured thresholds.

## Safety Boundary

Carry-forward stays human-only in v1. Any existing carry-forward item or
non-zero carry-forward count skips automation completion, even when the day is
otherwise ready.

Automation re-reads the command-time Daily Close snapshot before mutating. If a
blocker, carry-forward item, unreviewed item, reopened/superseded lifecycle
state, or already-human-completed close appears, the automation path fails safe
or records a no-op without overwriting human attribution.

Read models may expose safe Athena attribution broadly, but restricted
financial/review evidence keeps the existing manager and financial-detail
access boundary. Cash variance amounts, voided sale totals, threshold
summaries, item snapshots, and source evidence must be redacted before reaching
users without access.

## Prevention

- Add completion automation as a distinct action; do not overload preparation.
- Persist structured decision evidence on the run before patching terminal
  outcomes, including applied outcomes.
- Keep event taxonomy stable and use actor metadata for automation attribution.
- Test clean completion, low-risk completion, full hard-blocker matrix,
  local-time window boundaries, idempotent retries, human attribution
  preservation, and read-side redaction together.
- Refresh generated Convex APIs and Graphify whenever schema, backend API, or
  read-model surfaces change.
